// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../../../../src/main/providers/anthropic/AnthropicProvider';
import { configuration, input, fakeKey, response, success, collect } from './fixtures';

export function setup(fetcher: typeof fetch, extra: Partial<ConstructorParameters<typeof AnthropicProvider>[0]> = {}) {
  const resolveKey = vi.fn(async () => fakeKey);
  return { resolveKey, provider: new AnthropicProvider({ configuration, confirmedBaseUrl: 'https://api.anthropic.com', resolveKey, fetch: fetcher, ...extra }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Anthropic adapter trust boundary', () => {
  it('does not force a thinking mode on a custom model that forbids disabled', async () => {
    const { provider } = setup(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      return body.thinking === undefined ? response(success()) : new Response('fixture-mode-rejected', { status: 400 });
    });
    expect((await collect(provider.streamChat({ ...input, modelId: 'manual-model-with-default-thinking' }))).at(-1)).toMatchObject({ type: 'finish' });
  });

  it('preserves roles and leading system blocks, uses the actual output limit and only the Main request id', async () => {
    let captured: {url: string; init: RequestInit} | undefined;
    const { provider, resolveKey } = setup(async (url, init) => {
      captured = { url: String(url), init: init! };
      return response(success(), { headers: { 'request-id': 'vendor-request-id' }, fragmentBytes: 1 });
    });
    expect(await collect(provider.streamChat(input))).toEqual([
      { type: 'start', requestId: input.requestId, providerRequestId: 'vendor-request-id' },
      { type: 'text_delta', requestId: input.requestId, text: '你好🙂' },
      { type: 'usage', requestId: input.requestId, inputTokens: 7, outputTokens: 3 },
      { type: 'finish', requestId: input.requestId, reason: 'stop' },
    ]);
    expect(captured?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(captured?.init.redirect).toBe('error');
    expect(new Headers(captured?.init.headers).get('x-api-key')).toBe(fakeKey);
    expect(JSON.parse(captured!.init.body as string)).toEqual({
      model: input.modelId, stream: true, max_tokens: 23,
      system: [{ type: 'text', text: '可信指令' }, { type: 'text', text: '第二条指令' }], messages: input.messages.slice(2),
    });
    expect(resolveKey).toHaveBeenCalledWith(configuration.id, configuration.keyReference);
  });

  it('keeps consecutive public user and assistant messages in their original order', async () => {
    let body: Record<string, unknown> | undefined;
    const { provider } = setup(async (_url, init) => { body = JSON.parse(init!.body as string); return response(success()); });
    const messages = [{ role: 'user', content: 'u1' }, { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a1' }, { role: 'assistant', content: 'a2' }, { role: 'user', content: 'u3' }] as const;
    await collect(provider.streamChat({ ...input, messages: [...messages], agentRole: 'mock-only', turnIndex: 9 }));
    expect(body?.messages).toEqual(messages);
    expect(body).not.toHaveProperty('system'); expect(body).not.toHaveProperty('agentRole'); expect(body).not.toHaveProperty('turnIndex');
  });

  it.each([
    ['empty', [], 'invalid_input'], ['system only', [{ role: 'system', content: 's' }], 'invalid_input'],
    ['assistant first', [{ role: 'assistant', content: 'a' }, { role: 'user', content: 'u' }], 'unsupported'],
    ['interleaved system', [{ role: 'user', content: 'u' }, { role: 'system', content: 's' }, { role: 'user', content: 'u2' }], 'unsupported'],
  ] as const)('rejects %s before reading a Key or sending a request', async (_name, messages, code) => {
    const fetcher = vi.fn(async () => response(success())); const { provider, resolveKey } = setup(fetcher);
    const events = await collect(provider.streamChat({ ...input, messages: [...messages] }));
    expect(events).toMatchObject([{ type: 'error', error: { code } }]);
    expect(resolveKey).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([1, 2])('retains %i prior Agent messages and starts a new current-agent reply', async count => {
    let body: Record<string, unknown> | undefined;
    const { provider } = setup(async (_url, init) => { body = JSON.parse(init!.body as string); return response(success()); });
    const messages = [{ role: 'user' as const, content: 'task' }, ...Array.from({ length: count }, (_, i) => ({ role: 'assistant' as const, content: `Agent ${i}: public answer` }))];
    await collect(provider.streamChat({ ...input, messages }));
    expect(body?.messages).toEqual([...messages, { role: 'user', content: 'Respond to the public discussion above as the current agent.' }]);
  });

  it.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects output limit %s before credentials', async outputTokenLimit => {
    const fetcher = vi.fn(async () => response(success())); const { provider, resolveKey } = setup(fetcher);
    expect(await collect(provider.streamChat({ ...input, outputTokenLimit }))).toMatchObject([{ type: 'error', error: { code: 'invalid_input' } }]);
    expect(resolveKey).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { configuration: { ...configuration, kind: 'openai' } }, { configuration: { ...configuration, enabled: false } },
    { confirmedBaseUrl: 'https://api.anthropic.com/v1' }, { configuration: { ...configuration, baseUrl: 'https://api.anthropic.com/v1' } },
    { configuration: { ...configuration, baseUrl: 'https://unconfirmed.invalid' } }, { confirmedBaseUrl: 'http://api.anthropic.com' },
    { confirmedBaseUrl: 'https://api.anthropic.com?api_key=fixture-secret' }, { timeoutMs: 0 }, { timeoutMs: Infinity },
  ])('rejects invalid constructor configuration without side effects (%j)', extra => {
    const fetcher = vi.fn(); const resolveKey = vi.fn();
    expect(() => setup(fetcher, { ...extra, resolveKey } as never)).toThrow();
    expect(resolveKey).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'bad key', 'bad\nkey'])('rejects an unavailable or unsafe Key without sending', async key => {
    const fetcher = vi.fn(); const { provider } = setup(fetcher, { resolveKey: async () => key });
    expect(await collect(provider.streamChat(input))).toMatchObject([{ type: 'error', error: { code: 'authentication_failed' } }]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('overrides SDK environment credentials, base URL, auth token and logging defaults', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'environment-key'); vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'environment-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://environment.invalid'); vi.stubEnv('ANTHROPIC_LOG', 'debug');
    const logs = ['debug', 'log', 'warn', 'error', 'info'].map(method => vi.spyOn(console, method as 'log').mockImplementation(() => {}));
    const fetcher = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
      const headers = new Headers(init?.headers);
      expect(headers.get('x-api-key')).toBe(fakeKey); expect(headers.has('authorization')).toBe(false);
      return response(success());
    });
    const { provider } = setup(fetcher);
    await collect(provider.streamChat({ ...input, modelId: 'claude-3-opus-20240229' }));
    expect(fetcher).toHaveBeenCalledTimes(1); logs.forEach(log => expect(log).not.toHaveBeenCalled());
  });
});
