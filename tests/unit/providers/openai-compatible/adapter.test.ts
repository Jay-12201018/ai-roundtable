// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../../../../src/main/providers/openai-compatible/OpenAICompatibleProvider';
import type { ProviderConfiguration } from '../../../../src/shared/contracts/configuration';
import type { NormalizedChunk, StreamChatInput, TestConnectionInput } from '../../../../src/shared/contracts/provider';
import { ContractError } from '../../../../src/shared/contracts/errors';
import { apiErrorSchema } from '../../../../src/shared/schemas/error';
import { normalizedChunkSchema } from '../../../../src/shared/schemas/provider';

const baseUrl = 'https://compatible.example/v1/';
const fixtureKey = 'fixture-compatible-secret';
const configuration: ProviderConfiguration = {
  id: 'compatible-one', name: 'Compatible fixture', kind: 'openai-compatible',
  baseUrl, enabled: true, isDefault: false, defaultModelId: null, customModels: [],
  keyReference: { id: 'key-reference-one' },
  createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z',
};
const input: StreamChatInput = {
  requestId: 'main-request', modelId: 'manual-chat-model', outputTokenLimit: 31,
  messages: [
    { role: 'system', content: '主持人指令' },
    { role: 'user', content: '公开讨论' },
    { role: 'assistant', content: '先前成员回复' },
  ],
};
const capabilities = {
  outputTokenParameter: 'max_tokens', streamUsage: false, listModels: true, authentication: 'models',
} as const;
type Options = ConstructorParameters<typeof OpenAICompatibleProvider>[0];
type Outbound = { url: string; method: string; headers: Headers; body: Record<string, unknown> | null; redirect: RequestRedirect };

function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: 'vendor-request', object: 'chat.completion.chunk', created: 1, model: 'manual-chat-model',
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
  };
}

function frame(value: unknown): string { return `data: ${JSON.stringify(value)}\r\n\r\n`; }

function sse(values: unknown[], splitBytes = false): Response {
  const bytes = new TextEncoder().encode(values.map(frame).join('') + 'data: [DONE]\r\n\r\n');
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      if (splitBytes) for (let offset = 0; offset < bytes.length; offset += 3) controller.enqueue(bytes.slice(offset, offset + 3));
      else controller.enqueue(bytes);
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

function networkFixture(response: (request: Request) => Response | Promise<Response> = () => sse([chunk({ content: 'OK' }), chunk({}, 'stop')])) {
  const requests: Outbound[] = [];
  const fetcher = vi.fn<typeof fetch>(async (resource, init) => {
    const request = new Request(resource, init);
    requests.push({
      url: request.url, method: request.method, headers: new Headers(request.headers), redirect: request.redirect,
      body: request.method === 'GET' ? null : JSON.parse(await request.clone().text()) as Record<string, unknown>,
    });
    return response(request);
  });
  return { fetcher, requests };
}

function provider(fetcher: typeof fetch, overrides: Partial<Options> = {}) {
  return new OpenAICompatibleProvider({
    configuration, confirmedBaseUrl: baseUrl, resolveKey: async () => fixtureKey,
    capabilities, fetch: fetcher, ...overrides,
  });
}

async function collect(stream: AsyncIterable<NormalizedChunk>) {
  const events: NormalizedChunk[] = [];
  for await (const event of stream) {
    expect(normalizedChunkSchema.safeParse(event).success).toBe(true);
    events.push(event);
  }
  return events;
}

function expectError(events: NormalizedChunk[], code: string) {
  expect(events.at(-1)).toMatchObject({ type: 'error', requestId: 'main-request', error: { code } });
  expect(events.filter(event => event.type === 'finish')).toEqual([]);
  expect(events.filter(event => event.type === 'error')).toHaveLength(1);
}

function expectSanitized(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of [fixtureKey, 'raw-vendor-secret', 'hidden-thought', '/private/provider-key.txt']) expect(text).not.toContain(secret);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network outside the fixture'); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('OpenAI Compatible endpoint and capability boundaries', () => {
  it.each([null, { ...input, requestId: 'invalid identity' }])('rejects invalid streaming identity (%j) without yielding an invalid DTO', async invalid => {
    const { fetcher } = networkFixture();
    const emitted: NormalizedChunk[] = [];
    const consume = async () => {
      for await (const event of provider(fetcher).streamChat(invalid as unknown as StreamChatInput)) emitted.push(event);
    };
    await expect(consume()).rejects.toMatchObject({ name: 'ContractError', code: 'invalid_input' });
    expect(emitted).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { requestId: 'invalid identity', level: 'configuration' },
    { requestId: 'connection-request', level: 'unknown-level' },
  ])('rejects invalid connection identity (%j) without constructing an invalid result', async invalid => {
    const { fetcher } = networkFixture();
    await expect(provider(fetcher).testConnection(invalid as TestConnectionInput)).rejects.toMatchObject({ name: 'ContractError', code: 'invalid_input' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns a structured failure for valid generation identity with a missing model', async () => {
    const { fetcher } = networkFixture();
    const result = await provider(fetcher).testConnection({ requestId: 'connection-request', level: 'generation' });
    expect(result).toMatchObject({ requestId: 'connection-request', level: 'generation', ok: false, error: { code: 'invalid_input' } });
    if (!result.ok) expect(apiErrorSchema.safeParse(result.error).success).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('checks valid configuration locally without resolving a key or making a request', async () => {
    const { fetcher } = networkFixture();
    const resolveKey = vi.fn(async () => fixtureKey);
    const result = await provider(fetcher, { resolveKey }).testConnection({ requestId: 'local-check', level: 'configuration' });
    expect(result).toEqual({ requestId: 'local-check', level: 'configuration', ok: true });
    expect(resolveKey).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['unconfirmed target', {}, 'https://other.example/v1/'],
    ['changed target', { baseUrl: 'https://other.example/v1/' }, baseUrl],
    ['remote HTTP', { baseUrl: 'http://remote.example/v1/' }, 'http://remote.example/v1/'],
    ['credentials', { baseUrl: 'https://user:password@compatible.example/v1/' }, 'https://user:password@compatible.example/v1/'],
    ['query', { baseUrl: 'https://compatible.example/v1/?token=raw-vendor-secret' }, 'https://compatible.example/v1/?token=raw-vendor-secret'],
    ['disabled provider', { enabled: false }, baseUrl],
    ['wrong provider kind', { kind: 'openai' }, baseUrl],
    ['missing target', { baseUrl: null }, baseUrl],
  ])('rejects %s before network or key access', async (_label, changes, confirmedBaseUrl) => {
    const { fetcher } = networkFixture();
    const resolveKey = vi.fn(async () => fixtureKey);
    let failure: unknown;
    try { provider(fetcher, { configuration: { ...configuration, ...changes } as ProviderConfiguration, confirmedBaseUrl, resolveKey }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ContractError);
    if (failure instanceof ContractError) expect(apiErrorSchema.safeParse(failure.detail).success).toBe(true);
    expect(resolveKey).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expectSanitized(failure);
  });

  it.each([
    undefined,
    { outputTokenParameter: 'max_tokens', streamUsage: false, listModels: true },
    { outputTokenParameter: 'guessed_parameter', streamUsage: false, listModels: true, authentication: 'models' },
  ])('requires a complete explicit compatible capability profile (%j)', async profile => {
    const { fetcher } = networkFixture();
    expect(() => provider(fetcher, { capabilities: profile as Options['capabilities'] })).toThrow(ContractError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('treats a trailing slash confirmation as the same effective endpoint', async () => {
    const { fetcher, requests } = networkFixture();
    const events = await collect(provider(fetcher, { confirmedBaseUrl: 'https://compatible.example/v1' }).streamChat(input));
    expect(events.at(-1)).toEqual({ type: 'finish', requestId: 'main-request', reason: 'stop' });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://compatible.example/v1/chat/completions');
  });

  it('uses the canonical loopback HTTP endpoint when explicitly confirmed', async () => {
    const { fetcher, requests } = networkFixture();
    const localUrl = 'http://127.0.0.1:1234/v1/';
    const events = await collect(provider(fetcher, {
      configuration: { ...configuration, baseUrl: localUrl }, confirmedBaseUrl: localUrl,
    }).streamChat(input));
    expect(events.at(-1)).toEqual({ type: 'finish', requestId: 'main-request', reason: 'stop' });
    expect(requests[0].url).toBe('http://127.0.0.1:1234/v1/chat/completions');
  });

  it('refuses an unknown output limit parameter before resolving a key', async () => {
    const { fetcher } = networkFixture();
    const resolveKey = vi.fn(async () => fixtureKey);
    const events = await collect(provider(fetcher, {
      resolveKey, capabilities: { ...capabilities, outputTokenParameter: null },
    }).streamChat(input));
    expectError(events, 'unsupported');
    expect(resolveKey).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, -1, 1.5])('refuses an absent or invalid output limit (%s) before making a request', async outputTokenLimit => {
    const { fetcher } = networkFixture();
    const events = await collect(provider(fetcher).streamChat({ ...input, outputTokenLimit }));
    expectError(events, 'invalid_input');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'fixture\nunsafe-key'])('rejects an unusable resolved key (%j) without a request', async key => {
    const { fetcher } = networkFixture();
    const events = await collect(provider(fetcher, { resolveKey: async () => key }).streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'error' });
    expect(fetcher).not.toHaveBeenCalled();
    expectSanitized(events);
  });
});

describe('OpenAI Compatible request mapping and stream normalization', () => {
  it.each(['max_tokens', 'max_completion_tokens'] as const)('sends model, public roles and the actual %s limit', async outputTokenParameter => {
    const { fetcher, requests } = networkFixture();
    const resolveKey = vi.fn(async () => fixtureKey);
    const events = await collect(provider(fetcher, {
      resolveKey, capabilities: { ...capabilities, outputTokenParameter },
    }).streamChat(input));
    expect(resolveKey).toHaveBeenCalledWith('compatible-one', { id: 'key-reference-one' });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'https://compatible.example/v1/chat/completions', method: 'POST', redirect: 'error',
      body: {
        model: 'manual-chat-model', stream: true,
        messages: [
          { role: 'system', content: '主持人指令' }, { role: 'user', content: '公开讨论' }, { role: 'assistant', content: '先前成员回复' },
        ],
      },
    });
    expect(requests[0].body?.[outputTokenParameter]).toBe(31);
    expect(requests[0].body).not.toHaveProperty(outputTokenParameter === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens');
    expect(requests[0].body).not.toHaveProperty('stream_options');
    expect(requests[0].headers.get('authorization')).toBe('Bearer fixture-compatible-secret');
    expect(events.every(event => event.requestId === 'main-request')).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'finish', requestId: 'main-request', reason: 'stop' });
    expectSanitized(events);
  });

  it('ignores OpenAI environment credentials, endpoint, organization and project', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'raw-vendor-secret');
    vi.stubEnv('OPENAI_BASE_URL', 'https://environment.example/secret/');
    vi.stubEnv('OPENAI_ORG_ID', 'raw-vendor-secret');
    vi.stubEnv('OPENAI_PROJECT_ID', 'raw-vendor-secret');
    const { fetcher, requests } = networkFixture();
    await collect(provider(fetcher).streamChat(input));
    expect(requests[0].url).toBe('https://compatible.example/v1/chat/completions');
    expect(requests[0].headers.get('authorization')).toBe('Bearer fixture-compatible-secret');
    expect(requests[0].headers.has('openai-organization')).toBe(false);
    expect(requests[0].headers.has('openai-project')).toBe(false);
    expect(JSON.stringify([...requests[0].headers])).not.toContain('raw-vendor-secret');
  });

  it('keeps provider instance endpoint, key reference and model independent', async () => {
    const { fetcher, requests } = networkFixture();
    const resolveKey = vi.fn(async (providerId: string) => providerId === 'compatible-two' ? 'fixture-second-key' : fixtureKey);
    const first = provider(fetcher, { resolveKey });
    const second = provider(fetcher, {
      configuration: { ...configuration, id: 'compatible-two', baseUrl: 'https://second.example/api/', keyReference: { id: 'key-reference-two' } },
      confirmedBaseUrl: 'https://second.example/api/', resolveKey,
    });
    await collect(second.streamChat({ ...input, modelId: 'second-model' }));
    await collect(first.streamChat(input));
    expect(resolveKey.mock.calls).toEqual([
      ['compatible-two', { id: 'key-reference-two' }], ['compatible-one', { id: 'key-reference-one' }],
    ]);
    expect(requests.map(request => [request.url, request.headers.get('authorization'), request.body?.model])).toEqual([
      ['https://second.example/api/chat/completions', 'Bearer fixture-second-key', 'second-model'],
      ['https://compatible.example/v1/chat/completions', 'Bearer fixture-compatible-secret', 'manual-chat-model'],
    ]);
  });

  it('normalizes fragmented UTF-8 SSE and real usage while hiding undocumented reasoning fields', async () => {
    const { fetcher, requests } = networkFixture(() => sse([
      chunk({ role: 'assistant', content: '' }),
      chunk({ reasoning_content: 'hidden-thought', reasoning: 'hidden-thought' }),
      chunk({ content: '你好🙂' }), chunk({ content: '完成' }), chunk({}, 'stop'),
      { id: 'vendor-request', object: 'chat.completion.chunk', created: 1, model: 'manual-chat-model', choices: [], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } },
    ], true));
    const events = await collect(provider(fetcher, { capabilities: { ...capabilities, streamUsage: true } }).streamChat(input));
    expect(events.filter(event => event.type === 'start')).toHaveLength(1);
    expect(events.filter(event => event.type === 'text_delta').map(event => event.text).join('')).toBe('你好🙂完成');
    expect(events.filter(event => event.type === 'reasoning_summary_delta')).toEqual([]);
    expect(events.filter(event => event.type === 'usage')).toEqual([{ type: 'usage', requestId: 'main-request', inputTokens: 12, outputTokens: 4 }]);
    expect(events.filter(event => event.type === 'finish')).toEqual([{ type: 'finish', requestId: 'main-request', reason: 'stop' }]);
    expect(events.every(event => event.requestId === 'main-request')).toBe(true);
    expect(requests[0].body?.stream_options).toEqual({ include_usage: true });
    expectSanitized(events);
  });

  it('does not invent usage when the endpoint supplies none', async () => {
    const { fetcher } = networkFixture();
    const events = await collect(provider(fetcher).streamChat(input));
    expect(events.filter(event => event.type === 'usage')).toEqual([]);
  });

  it.each(['length', 'content_filter'] as const)('preserves the documented %s finish reason', async reason => {
    const { fetcher } = networkFixture(() => sse([chunk({ content: 'partial' }), chunk({}, reason)]));
    const events = await collect(provider(fetcher).streamChat(input));
    expect(events.at(-1)).toEqual({ type: 'finish', requestId: 'main-request', reason });
  });

  it.each([
    ['tool call', { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'unsafe', arguments: 'raw-vendor-secret' } }] }, 'tool_calls'],
    ['legacy function call', { function_call: { name: 'unsafe', arguments: 'raw-vendor-secret' } }, 'function_call'],
    ['audio', { audio: { id: 'audio-1', data: 'raw-vendor-secret', transcript: 'hidden-thought', expires_at: 1 } }, 'stop'],
    ['unknown finish', {}, 'vendor_private_reason'],
  ])('refuses %s without exposing its payload or declaring success', async (_label, delta, finishReason) => {
    const { fetcher } = networkFixture(() => sse([chunk({ content: 'partial' }), chunk(delta, finishReason)]));
    const events = await collect(provider(fetcher).streamChat(input));
    expectError(events, 'unsupported');
    expect(events.filter(event => event.type === 'text_delta').map(event => event.text).join('')).toBe('partial');
    expectSanitized(events);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('OpenAI Compatible model discovery and explicit connection levels', () => {
  it('maps model ids to safe model DTOs with one GET to the confirmed endpoint', async () => {
    const { fetcher, requests } = networkFixture(() => Response.json({
      object: 'list', data: [
        { id: 'chat-a', object: 'model', created: 1, owned_by: 'fixture', name: 'raw-vendor-secret' },
        { id: 'chat-b', object: 'model', created: 1, owned_by: 'fixture' },
      ],
    }));
    expect(await provider(fetcher).listModels({ requestId: 'list-request' })).toEqual([
      { id: 'chat-a', name: 'chat-a' }, { id: 'chat-b', name: 'chat-b' },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: 'https://compatible.example/v1/models', method: 'GET', body: null, redirect: 'error' });
  });

  it('keeps manual model generation available when discovery is unsupported', async () => {
    const { fetcher, requests } = networkFixture();
    const adapter = provider(fetcher, { capabilities: { ...capabilities, listModels: false, authentication: 'unsupported' } });
    await expect(adapter.listModels({ requestId: 'list-request' })).rejects.toMatchObject({ code: 'unsupported' });
    expect(fetcher).not.toHaveBeenCalled();
    const events = await collect(adapter.streamChat(input));
    expect(events.at(-1)).toEqual({ type: 'finish', requestId: 'main-request', reason: 'stop' });
    expect(requests).toHaveLength(1);
    expect(requests[0].body?.model).toBe('manual-chat-model');
  });

  it.each([404, 405])('reports a missing list endpoint (%s) as unsupported without retry', async status => {
    const { fetcher } = networkFixture(() => Response.json({ error: { message: 'raw-vendor-secret' } }, { status }));
    let failure: unknown;
    try { await provider(fetcher).listModels({ requestId: 'list-request' }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ContractError);
    expect(failure).toMatchObject({ code: 'unsupported' });
    expectSanitized(failure);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('checks authentication with GET models and never escalates to generation', async () => {
    const { fetcher, requests } = networkFixture(() => Response.json({ object: 'list', data: [] }));
    expect(await provider(fetcher).testConnection({ requestId: 'auth-request', level: 'authentication' })).toEqual({
      requestId: 'auth-request', level: 'authentication', ok: true,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: 'https://compatible.example/v1/models', method: 'GET', body: null });
  });

  it('reports unsupported authentication without key access or network', async () => {
    const { fetcher } = networkFixture();
    const resolveKey = vi.fn(async () => fixtureKey);
    const result = await provider(fetcher, {
      resolveKey, capabilities: { ...capabilities, authentication: 'unsupported' },
    }).testConnection({ requestId: 'auth-request', level: 'authentication' });
    expect(result).toMatchObject({ requestId: 'auth-request', level: 'authentication', ok: false, error: { code: 'unsupported' } });
    expect(resolveKey).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['stop', 'length'])('uses only the explicitly selected model with an eight token generation probe (%s)', async reason => {
    const { fetcher, requests } = networkFixture(() => sse([chunk({ content: 'OK' }), chunk({}, reason)]));
    const result = await provider(fetcher).testConnection({ requestId: 'probe-request', level: 'generation', modelId: 'manual-probe-model' });
    expect(result).toEqual({ requestId: 'probe-request', level: 'generation', ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', body: { model: 'manual-probe-model', max_tokens: 8, stream: true } });
    expect(requests[0].url).toBe('https://compatible.example/v1/chat/completions');
  });

  it.each([
    ['empty success', [chunk({}, 'stop')]],
    ['filtered text', [chunk({ content: 'partial' }), chunk({}, 'content_filter')]],
  ])('does not report generation success for %s', async (_label, values) => {
    const { fetcher } = networkFixture(() => sse(values));
    const result = await provider(fetcher).testConnection({ requestId: 'probe-request', level: 'generation', modelId: 'manual-probe-model' });
    expect(result).toMatchObject({ requestId: 'probe-request', level: 'generation', ok: false });
    if (!result.ok) expect(apiErrorSchema.safeParse(result.error).success).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('OpenAI Compatible failures, cancellation and deadlines', () => {
  it.each([
    [401, 'authentication_failed', false], [403, 'forbidden', false],
    [429, 'rate_limited', true], [500, 'internal_error', false],
  ])('normalizes HTTP %s and never retries a possibly charged request', async (status, code, retryable) => {
    const { fetcher } = networkFixture(() => Response.json({ error: { message: 'raw-vendor-secret', api_key: fixtureKey, path: '/private/provider-key.txt' } }, { status }));
    const events = await collect(provider(fetcher).streamChat(input));
    expectError(events, code);
    expect(events.at(-1)).toMatchObject({ error: { retryable } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expectSanitized(events);
  });

  it('sanitizes thrown transport errors without retrying', async () => {
    const { fetcher } = networkFixture(() => { throw new Error(`raw-vendor-secret ${fixtureKey} /private/provider-key.txt`); });
    const events = await collect(provider(fetcher).streamChat(input));
    expectError(events, 'network_error');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expectSanitized(events);
  });

  it('reports malformed SSE after preserving the already emitted text', async () => {
    const { fetcher } = networkFixture(() => new Response(frame(chunk({ content: 'partial' })) + 'data: {malformed raw-vendor-secret}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }));
    const events = await collect(provider(fetcher).streamChat(input));
    expectError(events, 'invalid_response');
    expect(events.filter(event => event.type === 'text_delta').map(event => event.text).join('')).toBe('partial');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expectSanitized(events);
  });

  it('cancels before network when the caller is already aborted', async () => {
    const { fetcher } = networkFixture();
    const controller = new AbortController();
    controller.abort();
    const events = await collect(provider(fetcher).streamChat({ ...input, signal: controller.signal }));
    expectError(events, 'cancelled');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['caller', 'deadline'] as const)('preserves partial text and aborts the stalled stream on %s', async cause => {
    const controller = new AbortController();
    let networkSignal: AbortSignal | undefined;
    const { fetcher } = networkFixture(request => {
      networkSignal = request.signal;
      return new Response(new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode(frame(chunk({ content: 'partial' }))));
          request.signal.addEventListener('abort', () => stream.error(new DOMException('raw-vendor-secret', 'AbortError')), { once: true });
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    });
    const events: NormalizedChunk[] = [];
    for await (const event of provider(fetcher, { timeoutMs: cause === 'deadline' ? 20 : 1000 }).streamChat({ ...input, signal: controller.signal })) {
      events.push(event);
      if (cause === 'caller' && event.type === 'text_delta') controller.abort();
    }
    expectError(events, cause === 'caller' ? 'cancelled' : 'timeout');
    expect(events.filter(event => event.type === 'text_delta').map(event => event.text).join('')).toBe('partial');
    expect(networkSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expectSanitized(events);
  });
});
