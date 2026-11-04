// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompatibleProvider } from '../../../../src/main/providers/compatible/CompatibleProvider';
import { normalizedChunkSchema, connectionTestResultSchema } from '../../../../src/shared/schemas/provider';
import { configuration, input, chunk, sse, collect } from './fixtures';

const fakeKey = 'fixture-secret-only';
function setup(fetcher: typeof fetch, extra: Partial<ConstructorParameters<typeof CompatibleProvider>[0]> = {}) {
  const resolveKey = vi.fn(async () => fakeKey);
  return { resolveKey, provider: new CompatibleProvider({ configuration, confirmedBaseUrl: 'https://service.example/v1', resolveKey, fetch: fetcher, ...extra }) };
}
afterEach(() => vi.restoreAllMocks());

describe('compatible adapter over a stream', () => {
  it('maps trusted context/model/real token limit, fragmented Unicode, usage and one terminal event', async () => {
    const requests: Array<{url:string; body:unknown; headers:Headers; redirect:unknown}> = [];
    const { provider, resolveKey } = setup(async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init!.body as string), headers: new Headers(init!.headers), redirect: init!.redirect });
      return sse(chunk('你好👋'), chunk(''), chunk(null, 'stop'), { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }, '[DONE]');
    });
    const events = await collect(provider.streamChat(input));
    expect(events).toEqual([
      { type: 'start', requestId: 'main-request' }, { type: 'text_delta', requestId: 'main-request', text: '你好👋' },
      { type: 'usage', requestId: 'main-request', inputTokens: 12, outputTokens: 3 }, { type: 'finish', requestId: 'main-request', reason: 'stop' },
    ]);
    events.forEach(e => expect(normalizedChunkSchema.safeParse(e).success).toBe(true));
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://service.example/v1/chat/completions');
    expect(requests[0].redirect).toBe('error');
    expect(requests[0].headers.get('authorization')).toBe(`Bearer ${fakeKey}`);
    expect(requests[0].body).toEqual({ model: 'manual-model', messages: input.messages, stream: true, max_tokens: 23, stream_options: { include_usage: true } });
    expect(resolveKey).toHaveBeenCalledWith('service-instance', { id: 'fixture-reference' });
    expect(JSON.stringify(events)).not.toContain(fakeKey);
  });

  it.each(['length', 'content_filter'] as const)('retains %s without inventing missing usage', async reason => {
    const { provider } = setup(async () => sse(chunk('partial'), chunk(null, reason), '[DONE]'));
    const events = await collect(provider.streamChat(input));
    expect(events.at(-1)).toEqual({ type: 'finish', requestId: input.requestId, reason });
    expect(events.filter(e => e.type === 'usage')).toEqual([]);
  });

  it.each([[401, 'authentication_failed'], [403, 'forbidden'], [429, 'rate_limited'], [500, 'internal_error'], [503, 'internal_error'], [400, 'invalid_input'], [404, 'not_found']] as const)(
    'normalizes HTTP %s without retrying or logging sensitive bodies', async (status, code) => {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: fakeKey, authorization: fakeKey } }), { status }));
      const log = vi.spyOn(console, 'error');
      const { provider } = setup(fetcher);
      const events = await collect(provider.streamChat(input));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'error', requestId: input.requestId, error: { code } });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(events)).not.toContain(fakeKey);
      expect(log).not.toHaveBeenCalled();
    });

  it.each([
    () => sse(chunk('partial')),
    () => sse(chunk('partial'), '[DONE]'),
    () => sse(chunk('partial'), '{malformed'),
    () => sse(chunk('partial'), { choices: [], usage: { prompt_tokens: -1, completion_tokens: 1 } }, '[DONE]'),
    () => new Response('{"secret":"fixture-secret-only"}', { headers: { 'content-type': 'application/json' } }),
  ])('rejects incomplete/malformed streams with no false finish or secret details', async response => {
    const { provider } = setup(async () => response());
    const events = await collect(provider.streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_response' } });
    expect(events.filter(e => e.type === 'finish')).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain(fakeKey);
  });

  it('retains partial text on body disconnect', async () => {
    let reads = 0;
    const { provider } = setup(async () => new Response(new ReadableStream({ pull(c) {
      if (reads++ === 0) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk('partial'))}\n\n`));
      else c.error(new Error(fakeKey));
    } }), { headers: { 'content-type': 'text/event-stream' } }));
    const events = await collect(provider.streamChat(input));
    expect(events).toContainEqual({ type: 'text_delta', requestId: input.requestId, text: 'partial' });
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'network_error' } });
    expect(JSON.stringify(events)).not.toContain(fakeKey);
  });

  it.each(['cancel', 'timeout'] as const)('interrupts stalled body on %s, keeps partial, cancels transport', async kind => {
    const abort = new AbortController(); let cancelled = false; let networkSignal: AbortSignal | null | undefined;
    const { provider } = setup(async (_url, init) => {
      networkSignal = init?.signal;
      return new Response(new ReadableStream({ start(c) {
        c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk('partial'))}\n\n`));
      }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    }, { timeoutMs: kind === 'timeout' ? 30 : 500 });
    const events = [];
    for await (const event of provider.streamChat({ ...input, signal: abort.signal })) {
      events.push(event);
      if (event.type === 'text_delta' && kind === 'cancel') abort.abort(new Error(fakeKey));
    }
    expect(events).toContainEqual({ type: 'text_delta', requestId: input.requestId, text: 'partial' });
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: kind === 'cancel' ? 'cancelled' : 'timeout' } });
    expect(networkSignal?.aborted).toBe(true); expect(cancelled).toBe(true);
  });

  it('aborts a pending header fetch with no retries', async () => {
    let networkSignal: AbortSignal | null | undefined;
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit): Promise<Response> => {
      networkSignal = init?.signal; return new Promise(() => {});
    });
    const { provider } = setup(fetcher, { timeoutMs: 20 });
    const events = await collect(provider.streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'timeout' } });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(networkSignal?.aborted).toBe(true);
  });

  it('keeps the SDK transport timeout distinct from an ordinary network error', async () => {
    const fetcher = vi.fn(async (): Promise<Response> => { throw new TypeError('fetch failed', { cause: new Error('Connect Timeout Error (attempted address: fixture:443, timeout: 10000ms)') }); });
    const { provider } = setup(fetcher);
    const events = await collect(provider.streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'timeout' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('discards late key resolution after abort and never starts fetch', async () => {
    const abort = new AbortController(); let release!: (key: string) => void;
    const fetcher = vi.fn(async () => sse(chunk(null, 'stop'), '[DONE]'));
    const { provider } = setup(fetcher, { resolveKey: () => new Promise(resolve => { release = resolve; queueMicrotask(() => abort.abort()); }) });
    const events = await collect(provider.streamChat({ ...input, signal: abort.signal }));
    release(fakeKey); await Promise.resolve();
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'cancelled' } }); expect(fetcher).not.toHaveBeenCalled();
  });

  it('cancels a late response body even if a transport ignored the timeout signal', async () => {
    let release!: (response: Response) => void; let cancelled = false;
    const { provider } = setup(() => new Promise(resolve => { release = resolve; }), { timeoutMs: 20 });
    const events = await collect(provider.streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'timeout' } });
    release(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }));
    await vi.waitFor(() => expect(cancelled).toBe(true), { timeout: 200 });
  });

  it('cancels an unread sensitive error body before the SDK can buffer it', async () => {
    let cancelled = false; let reads = 0;
    const body = new ReadableStream({ pull() { reads++; }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const { provider } = setup(async () => new Response(body, { status: 401 }));
    const events = await collect(provider.streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'authentication_failed' } });
    expect(reads).toBe(0); expect(cancelled).toBe(true);
  });

  it.each([
    { data: [{ id: 'duplicate' }, { id: 'duplicate' }] }, { data: [{ id: 'bad id' }] }, { data: [] , has_more: true }, { invalid: 'fixture-secret-only' },
  ])('rejects malformed or unsupported model lists safely (%j)', async body => {
    const { provider } = setup(async () => Response.json(body));
    await expect(provider.listModels({ requestId: 'list' })).rejects.toMatchObject({ code: body.has_more ? 'unsupported' : 'invalid_response' });
  });

  it('configuration does not resolve credentials; auth and models never POST; generation is explicit and bounded', async () => {
    const methods: string[] = [];
    const { provider, resolveKey } = setup(async (_url, init) => {
      methods.push(init?.method ?? 'GET');
      return init?.method === 'POST' ? sse(chunk('ok'), chunk(null, 'length'), '[DONE]')
        : Response.json({ data: [{ id: 'listed-model', secret: fakeKey }] });
    });
    expect(await provider.testConnection({ requestId: 'config', level: 'configuration' })).toEqual({ requestId: 'config', level: 'configuration', ok: true });
    expect(resolveKey).not.toHaveBeenCalled(); expect(methods).toEqual([]);
    expect(await provider.listModels({ requestId: 'list' })).toEqual([{ id: 'listed-model', name: 'listed-model' }]);
    expect(await provider.testConnection({ requestId: 'auth', level: 'authentication' })).toMatchObject({ ok: true, level: 'authentication' });
    const result = await provider.testConnection({ requestId: 'gen', level: 'generation', modelId: 'manual-unlisted' });
    expect(result).toEqual({ requestId: 'gen', level: 'generation', ok: true });
    expect(connectionTestResultSchema.safeParse(result).success).toBe(true); expect(methods).toEqual(['GET', 'GET', 'POST']);
  });

  it('rejects missing limits/credentials and unconfirmed endpoints without Mock or network', async () => {
    const fetcher = vi.fn(async () => sse(chunk('unexpected'), chunk(null, 'stop'), '[DONE]'));
    const { provider } = setup(fetcher);
    expect((await collect(provider.streamChat({ ...input, outputTokenLimit: undefined }))).at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_input' } });
    expect(() => setup(fetcher, { confirmedBaseUrl: 'https://other.invalid/v1' })).toThrow();
    expect(() => setup(fetcher, { configuration: { ...configuration, baseUrl: 'https://other.invalid/v1' } })).toThrow();
    const missing = setup(fetcher, { resolveKey: async () => undefined }).provider;
    expect((await collect(missing.streamChat(input))).at(-1)).toMatchObject({ type: 'error', error: { code: 'authentication_failed' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a missing list input as a safe contract error', async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [] }));
    const { provider } = setup(fetcher);
    await expect(provider.listModels(null as never)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
