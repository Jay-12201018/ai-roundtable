// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../../../../src/main/providers/anthropic/AnthropicProvider';
import { connectionTestResultSchema } from '../../../../src/shared/schemas/provider';
import { configuration, fakeKey, models, response, success } from './fixtures';

const setup = (fetcher: typeof fetch, extra: Partial<ConstructorParameters<typeof AnthropicProvider>[0]> = {}) => {
  const resolveKey = vi.fn(async () => fakeKey);
  return { resolveKey, provider: new AnthropicProvider({ configuration, confirmedBaseUrl: 'https://api.anthropic.com', resolveKey, fetch: fetcher, ...extra }) };
};
afterEach(() => vi.restoreAllMocks());

describe('Anthropic discovery and connection levels', () => {
  it('maps bounded paginated models by display name without treating discovery as generation', async () => {
    const urls: URL[] = [];
    const { provider } = setup(async (resource, init) => {
      expect(init?.method).toBe('GET'); const url = new URL(String(resource)); urls.push(url);
      expect(url.origin).toBe('https://api.anthropic.com'); expect(url.pathname).toBe('/v1/models');
      expect(url.searchParams.get('limit')).toBe('1000');
      return urls.length === 1 ? models([{ id: 'claude-one', display_name: 'Claude One' }], { has_more: true, last_id: 'claude-one' })
        : models([{ id: 'claude-two', display_name: 'Claude Two' }]);
    });
    expect(await provider.listModels({ requestId: 'list' })).toEqual([{ id: 'claude-one', name: 'Claude One' }, { id: 'claude-two', name: 'Claude Two' }]);
    expect(urls).toHaveLength(2); expect(urls[0].searchParams.has('after_id')).toBe(false); expect(urls[1].searchParams.get('after_id')).toBe('claude-one');
  });

  it('configuration is local; authentication is GET; explicit generation uses a small fixed prompt', async () => {
    const calls: Array<{method: string; body?: unknown}> = [];
    const { provider, resolveKey } = setup(async (_resource, init) => {
      calls.push({ method: init!.method!, ...(init!.body ? { body: JSON.parse(init!.body as string) } : {}) });
      return init?.method === 'POST' ? response(success('OK')) : models();
    });
    expect(await provider.testConnection({ requestId: 'config', level: 'configuration' })).toEqual({ requestId: 'config', level: 'configuration', ok: true });
    expect(resolveKey).not.toHaveBeenCalled(); expect(calls).toEqual([]);
    expect(await provider.testConnection({ requestId: 'auth', level: 'authentication' })).toEqual({ requestId: 'auth', level: 'authentication', ok: true });
    const result = await provider.testConnection({ requestId: 'gen', level: 'generation', modelId: 'manual-unlisted' });
    expect(result).toEqual({ requestId: 'gen', level: 'generation', ok: true });
    expect(connectionTestResultSchema.safeParse(result).success).toBe(true);
    expect(calls).toEqual([{ method: 'GET' }, { method: 'POST', body: { model: 'manual-unlisted', messages: [{ role: 'user', content: 'Reply OK.' }],
      stream: true, max_tokens: 8 } }]);
  });

  it('rejects generation without model before credentials or HTTP', async () => {
    const fetcher = vi.fn(); const { provider, resolveKey } = setup(fetcher);
    expect(await provider.testConnection({ requestId: 'gen', level: 'generation' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(resolveKey).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not call silent generation after list or authentication rejection', async () => {
    const fetcher = vi.fn(async (_resource: unknown, _init?: RequestInit) => new Response('sensitive-body', { status: 404 })); const { provider } = setup(fetcher);
    await expect(provider.listModels({ requestId: 'list' })).rejects.toMatchObject({ code: 'unsupported' });
    expect(await provider.testConnection({ requestId: 'auth', level: 'authentication' })).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it.each([
    { data: [] }, { data: [], has_more: 'false' }, { data: [{ id: 'bad id', display_name: 'Bad' }], has_more: false },
    { data: [{ id: 'same' }, { id: 'same' }], has_more: false }, { data: [], has_more: true, last_id: 'missing' },
    { data: [{ id: 'first' }], has_more: true }, { data: [{ id: 'first' }], has_more: true, last_id: 'other' },
    { data: [{ id: 'x', display_name: '' }], has_more: false },
  ])('rejects invalid model page without exposing its body (%j)', async body => {
    const { provider } = setup(async () => Response.json(body));
    await expect(provider.listModels({ requestId: 'list' })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects duplicates across pages rather than silently dropping a model', async () => {
    let page = 0; const { provider } = setup(async () => ++page === 1
      ? models([{ id: 'same' }], { has_more: true, last_id: 'same' }) : models([{ id: 'same' }]));
    await expect(provider.listModels({ requestId: 'list' })).rejects.toMatchObject({ code: 'invalid_response' }); expect(page).toBe(2);
  });

  it('bounds pagination to 100 pages', async () => {
    let page = 0; const { provider } = setup(async () => { const id = `page-${++page}`; return models([{ id }], { has_more: true, last_id: id }); });
    await expect(provider.listModels({ requestId: 'list' })).rejects.toMatchObject({ code: 'invalid_response' }); expect(page).toBeLessThanOrEqual(100);
  });

  it('bounds model count to 10000 across pages', async () => {
    let page = 0; const { provider } = setup(async () => {
      const data = Array.from({ length: 1000 }, (_, i) => ({ id: `page-${page}-${i}` })); page++;
      return models(data, { has_more: true, last_id: data.at(-1)!.id });
    });
    await expect(provider.listModels({ requestId: 'list' })).rejects.toMatchObject({ code: 'invalid_response' }); expect(page).toBeLessThanOrEqual(11);
  });

  it('rejects a model response over 2MiB', async () => {
    const { provider } = setup(async () => models([{ id: 'model', display_name: 'x'.repeat(2 * 1024 * 1024) }]));
    await expect(provider.listModels({ requestId: 'list' })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it.each(['text/plain', 'text/event-stream'])('rejects model response content type %s', async contentType => {
    const { provider } = setup(async () => new Response('{"data":[],"has_more":false}', { headers: { 'content-type': contentType } }));
    await expect(provider.listModels({ requestId: 'list' })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it.each(['abort', 'timeout'] as const)('settles %s on a stalled model JSON body and cancels the reader', async mode => {
    const controller = new AbortController(); let cancelled = false;
    const { provider } = setup(async () => new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode('{')); if (mode === 'abort') queueMicrotask(() => controller.abort());
    }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }), { timeoutMs: 30 });
    await expect(provider.listModels({ requestId: 'list', signal: controller.signal })).rejects.toMatchObject({ code: mode === 'abort' ? 'cancelled' : 'timeout' });
    expect(cancelled).toBe(true);
  });

  it.each(['{broken', new Uint8Array([0xc3, 0x28])])('rejects malformed model JSON and invalid UTF8', async body => {
    const { provider } = setup(async () => new Response(body, { headers: { 'content-type': 'application/json' } }));
    await expect(provider.listModels({ requestId: 'list' })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects missing list input safely', async () => {
    const fetcher = vi.fn(); const { provider } = setup(fetcher);
    await expect(provider.listModels(null as never)).rejects.toMatchObject({ code: 'invalid_input' }); expect(fetcher).not.toHaveBeenCalled();
  });
});
