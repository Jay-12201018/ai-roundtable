// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../../../../src/main/providers/anthropic/AnthropicProvider';
import { ContractError } from '../../../../src/shared/contracts/errors';
import { configuration, input, fakeKey, start, blockStart, text, frame, response, success, collect } from './fixtures';

const setup = (fetcher: typeof fetch, extra: Partial<ConstructorParameters<typeof AnthropicProvider>[0]> = {}) => {
  const resolveKey = vi.fn(async () => fakeKey);
  return { resolveKey, provider: new AnthropicProvider({ configuration, confirmedBaseUrl: 'https://api.anthropic.com', resolveKey, fetch: fetcher, timeoutMs: 500, ...extra }) };
};
afterEach(() => vi.restoreAllMocks());

describe('Anthropic cancellation, cleanup and safe failures', () => {
  it('pre-aborted signal does not read credentials or touch transport', async () => {
    const controller = new AbortController(); controller.abort(); const fetcher = vi.fn(); const { provider, resolveKey } = setup(fetcher);
    expect(await collect(provider.streamChat({ ...input, signal: controller.signal }))).toMatchObject([{ type: 'error', error: { code: 'cancelled' } }]);
    expect(resolveKey).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['abort', 'timeout'] as const)('settles %s during pending Key and rejects a late credential', async mode => {
    const controller = new AbortController(); const fetcher = vi.fn(); let release!: (key: string) => void;
    const { provider } = setup(fetcher, { timeoutMs: mode === 'timeout' ? 25 : 500, resolveKey: () => new Promise(resolve => { release = resolve; }) });
    const collecting = collect(provider.streamChat({ ...input, signal: controller.signal }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (mode === 'abort') controller.abort();
    expect((await collecting).at(-1)).toMatchObject({ type: 'error', error: { code: mode === 'abort' ? 'cancelled' : 'timeout' } });
    release(fakeKey); await Promise.resolve(); await Promise.resolve(); expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['abort', 'timeout'] as const)('settles %s while headers stall and cancels a late body', async mode => {
    const controller = new AbortController(); let release!: (response: Response) => void; let cancelled = false;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
    const { provider } = setup(fetcher, { timeoutMs: mode === 'timeout' ? 25 : 500 });
    const collecting = collect(provider.streamChat({ ...input, signal: controller.signal }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (mode === 'abort') controller.abort();
    expect((await collecting).at(-1)).toMatchObject({ type: 'error', error: { code: mode === 'abort' ? 'cancelled' : 'timeout' } });
    release(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }));
    await vi.waitFor(() => expect(cancelled).toBe(true), { timeout: 200 }); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('Stop during pending body preserves partial output and cancels transport exactly once', async () => {
    const controller = new AbortController(); let networkSignal: AbortSignal | null | undefined; let cancelled = 0;
    const fetcher = vi.fn(async (_resource, init) => {
      networkSignal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({ start(c) {
        c.enqueue(new TextEncoder().encode([start(), blockStart(), text('retained partial')].map(e => frame(e)).join('')));
      }, cancel() { cancelled++; } }), { headers: { 'content-type': 'text/event-stream' } });
    });
    const { provider } = setup(fetcher); const events = [];
    for await (const event of provider.streamChat({ ...input, signal: controller.signal })) { events.push(event); if (event.type === 'text_delta') controller.abort(); }
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'cancelled' } });
    expect(events.filter(e => e.type === 'text_delta').map(e => e.text)).toEqual(['retained partial']);
    expect(events.filter(e => e.type === 'finish')).toEqual([]); expect(cancelled).toBe(1); expect(networkSignal?.aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses a total deadline even while ping frames continue to arrive', async () => {
    let interval: ReturnType<typeof setInterval> | undefined; let cancelled = false;
    const { provider } = setup(async () => new Response(new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new TextEncoder().encode(frame(start())));
      interval = setInterval(() => c.enqueue(new TextEncoder().encode(frame({ type: 'ping' }))), 4);
    }, cancel() { cancelled = true; clearInterval(interval); } }), { headers: { 'content-type': 'text/event-stream' } }), { timeoutMs: 50 });
    try {
      const chunks = await collect(provider.streamChat(input)); expect(chunks.at(-1)).toMatchObject({ type: 'error', error: { code: 'timeout' } }); expect(cancelled).toBe(true);
    } finally { clearInterval(interval); }
  });

  it.each(['start', 'text_delta'])('closes body and aborts signal after consumer breaks on %s', async type => {
    let cancelled = false; let signal: AbortSignal | null | undefined;
    const { provider } = setup(async (_url, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode([start(), blockStart(), text('partial')].map(e => frame(e)).join(''))); },
        cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    });
    for await (const event of provider.streamChat(input)) if (event.type === type) break;
    expect(cancelled).toBe(true); expect(signal?.aborted).toBe(true);
  });

  it('does not wait for a stalled body cancel promise on consumer break', async () => {
    const { provider } = setup(async () => new Response(new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new TextEncoder().encode(frame(start())));
    }, cancel() { return new Promise(() => {}); } }), { headers: { 'content-type': 'text/event-stream' } }));
    for await (const event of provider.streamChat(input)) if (event.type === 'start') break;
  });

  it.each([[401, 'authentication_failed'], [403, 'forbidden'], [429, 'rate_limited'], [500, 'internal_error'], [503, 'internal_error'], [400, 'invalid_input'], [404, 'not_found']] as const)(
    'sanitizes HTTP %i without reading error body or retrying', async (status, code) => {
      let reads = 0; let cancelled = false;
      const fetcher = vi.fn(async () => new Response(new ReadableStream({ pull() { reads++; }, cancel() { cancelled = true; } }, { highWaterMark: 0 }),
        { status, headers: { 'x-sensitive-fixture': fakeKey } }));
      const logs = ['debug', 'log', 'warn', 'error'].map(method => vi.spyOn(console, method as 'log').mockImplementation(() => {}));
      const chunks = await collect(setup(fetcher).provider.streamChat(input));
      expect(chunks).toMatchObject([{ type: 'error', requestId: input.requestId, error: { code } }]);
      expect(JSON.stringify(chunks)).not.toContain(fakeKey); expect(reads).toBe(0); expect(cancelled).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
      logs.forEach(log => expect(log).not.toHaveBeenCalled());
    });

  it('rejects redirects and cancels the body without following location', async () => {
    let cancelled = false;
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 307, headers: { location: `https://unconfirmed.invalid/${fakeKey}` } }));
    const chunks = await collect(setup(fetcher).provider.streamChat(input));
    expect(chunks).toMatchObject([{ type: 'error', error: { code: 'invalid_response' } }]);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(cancelled).toBe(true); expect(JSON.stringify(chunks)).not.toMatch(/unconfirmed|fixture-anthropic-secret/);
  });

  it('sanitizes network and Key exceptions without retrying', async () => {
    const fetcher = vi.fn(async () => { throw new Error(`${fakeKey} internal path /private/fixture`); });
    const chunks = await collect(setup(fetcher).provider.streamChat(input));
    expect(chunks).toMatchObject([{ type: 'error', error: { code: 'network_error' } }]); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(chunks)).not.toMatch(/fixture-anthropic-secret|private/);
    const keyFailure = await collect(setup(fetcher, { resolveKey: async () => { throw new ContractError('forbidden'); } }).provider.streamChat(input));
    expect(keyFailure).toMatchObject([{ type: 'error', error: { code: 'forbidden' } }]); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
