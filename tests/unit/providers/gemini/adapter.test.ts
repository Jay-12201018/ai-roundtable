// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../../../../src/main/providers/gemini/GeminiProvider';
import { normalizedChunkSchema, connectionTestResultSchema } from '../../../../src/shared/schemas/provider';
import { ContractError } from '../../../../src/shared/contracts/errors';
import { baseUrl, fakeKey, configuration, input, chunk, sse, collect } from './fixtures';

function setup(fetcher: typeof fetch, extra: Partial<ConstructorParameters<typeof GeminiProvider>[0]> = {}) {
  const resolveKey = vi.fn(async () => fakeKey);
  return { resolveKey, provider: new GeminiProvider({ configuration, confirmedBaseUrl: baseUrl, resolveKey, fetch: fetcher, ...extra }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('Gemini native text adapter', () => {
  it('maps system/roles/limits, fragmented Unicode and final cumulative usage through the shared protocol', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const { provider, resolveKey } = setup(async (url, init) => {
      requests.push({ url: String(url), init });
      return sse(chunk('你好👋'), { candidates: [{ index: 0, content: { role: 'model', parts: [
        { text: 'hidden', thought: true }, { text: '公开', thoughtSignature: 'private-signature' }, { text: '' }, { text: '摘要也不暴露', thought: true },
      ] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 2, thoughtsTokenCount: 4 } },
      { ...chunk(undefined, 'STOP'), usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, thoughtsTokenCount: 5, cachedContentTokenCount: 2, totalTokenCount: 20 } });
    });
    const events = await collect(provider.streamChat(input));
    expect(events).toEqual([
      { type: 'start', requestId: 'main-request' }, { type: 'text_delta', requestId: 'main-request', text: '你好👋' },
      { type: 'text_delta', requestId: 'main-request', text: '公开' },
      { type: 'usage', requestId: 'main-request', inputTokens: 12, outputTokens: 8 },
      { type: 'finish', requestId: 'main-request', reason: 'stop' },
    ]);
    events.forEach(e => expect(normalizedChunkSchema.safeParse(e).success).toBe(true));
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`${baseUrl}/models/manual-gemini:streamGenerateContent?alt=sse`);
    expect(requests[0].init?.redirect).toBe('error');
    const headers = new Headers(requests[0].init?.headers);
    expect(headers.get('x-goog-api-key')).toBe(fakeKey); expect(headers.has('authorization')).toBe(false);
    expect(JSON.parse(requests[0].init?.body as string)).toEqual({
      systemInstruction: { parts: [{ text: '主持指令' }, { text: '成员提示' }] },
      contents: [{ role: 'user', parts: [{ text: '任务' }] }, { role: 'model', parts: [{ text: '公开历史' }] }, { role: 'user', parts: [{ text: '继续' }] }],
      generationConfig: { candidateCount: 1, maxOutputTokens: 23 },
    });
    expect(resolveKey).toHaveBeenCalledWith('gemini-instance', { id: 'fixture-reference' });
    expect(JSON.stringify(events)).not.toMatch(/hidden|private-signature|摘要也不暴露|fixture-gemini-key/);
  });

  it.each([['MAX_TOKENS', 'length'], ['SAFETY', 'content_filter'], ['RECITATION', 'content_filter'],
    ['BLOCKLIST', 'content_filter'], ['PROHIBITED_CONTENT', 'content_filter'], ['SPII', 'content_filter']] as const)(
    'maps %s and keeps only the preceding partial on filtering', async (finish, reason) => {
      const { provider } = setup(async () => sse(chunk('partial'), chunk('filtered-frame', finish)));
      const events = await collect(provider.streamChat(input));
      expect(events.at(-1)).toEqual({ type: 'finish', requestId: input.requestId, reason });
      expect(events.filter(e => e.type === 'text_delta').map(e => e.text)).toEqual(reason === 'length' ? ['partial', 'filtered-frame'] : ['partial']);
      expect(events.some(e => e.type === 'usage')).toBe(false);
    });

  it('maps prompt blocking without candidates to a filtered terminal', async () => {
    const { provider } = setup(async () => sse({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }));
    expect((await collect(provider.streamChat(input))).at(-1)).toEqual({ type: 'finish', requestId: input.requestId, reason: 'content_filter' });
  });

  it.each([
    [], [chunk('partial')], [{ candidates: [] }], [chunk(undefined, 'STOP')], ['{bad'],
    [{ candidates: [{ index: 1, content: { parts: [{ text: 'wrong' }] }, finishReason: 'STOP' }] }],
    [{ candidates: [chunk('one').candidates[0], chunk('two').candidates[0]] }],
    [{ candidates: [{ content: { parts: [{ text: 7 }] }, finishReason: 'STOP' }] }],
    [chunk('partial'), chunk(undefined, 'STOP'), chunk('late')],
    [chunk('partial'), chunk(undefined, 'STOP'), '[DONE]'],
  ])('rejects malformed/empty/incomplete candidates without a false success (%j)', async (...frames) => {
    const { provider } = setup(async () => sse(...frames));
    const events = await collect(provider.streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_response' } });
    expect(events.some(e => e.type === 'finish')).toBe(false);
  });

  it.each(['OTHER', 'LANGUAGE', 'MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL', 'future-finish'])(
    'refuses unsupported finish %s', async finish => {
      const { provider } = setup(async () => sse(chunk('partial'), chunk(undefined, finish)));
      expect((await collect(provider.streamChat(input))).at(-1)).toMatchObject({ type: 'error', error: { code: 'unsupported' } });
    });
  it.each([{ functionCall: { name: 'tool' } }, { inlineData: { data: 'private' } }, { executableCode: { code: 'private' } }, {}])(
    'refuses unsupported or malformed parts (%j)', async part => {
      const { provider } = setup(async () => sse({ candidates: [{ content: { parts: [part] }, finishReason: 'STOP' }] }));
      const events = await collect(provider.streamChat(input));
      expect(events.at(-1)?.type).toBe('error'); expect(events.some(e => e.type === 'finish')).toBe(false);
      expect(JSON.stringify(events)).not.toContain('private');
    });

  it.each([
    { promptTokenCount: -1, candidatesTokenCount: 2 }, { promptTokenCount: 1.5, candidatesTokenCount: 2 },
    { promptTokenCount: 1, candidatesTokenCount: 2, thoughtsTokenCount: -1 },
    { promptTokenCount: 1, candidatesTokenCount: Number.MAX_SAFE_INTEGER, thoughtsTokenCount: 2 },
    { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 1 },
    { promptTokenCount: 3, candidatesTokenCount: 2, cachedContentTokenCount: 4 },
  ])('rejects invalid usage without invented counts (%j)', async usageMetadata => {
    const { provider } = setup(async () => sse({ ...chunk('answer', 'STOP'), usageMetadata }));
    const events = await collect(provider.streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_response' } });
    expect(events.some(e => e.type === 'usage' || e.type === 'finish')).toBe(false);
  });
  it('rejects decreasing cumulative usage', async () => {
    const { provider } = setup(async () => sse({ ...chunk('a'), usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } },
      { ...chunk('b', 'STOP'), usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } }));
    expect((await collect(provider.streamChat(input))).at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_response' } });
  });
  it('rejects partial usage fields that contradict previously observed lower bounds', async () => {
    const events = await collect(setup(async () => sse(
      { ...chunk('answer', 'STOP'), usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 2 } },
      { usageMetadata: { totalTokenCount: 3 } },
    )).provider.streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_response' } });
    expect(events.some(e => e.type === 'finish')).toBe(false);
  });
  it('never fills missing usage from totals or stale intermediate counts', async () => {
    const { provider } = setup(async () => sse({ ...chunk('a'), usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } },
      { ...chunk('b', 'STOP'), usageMetadata: { promptTokenCount: 3, totalTokenCount: 8 } }));
    expect((await collect(provider.streamChat(input))).filter(e => e.type === 'usage')).toEqual([]);
  });
  it.each([
    [ { ...chunk('a'), usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, thoughtsTokenCount: 4 } },
      { ...chunk('b', 'STOP'), usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3 } } ],
    [ { ...chunk('a'), usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } }, chunk('b', 'STOP') ],
  ])('does not report incomplete or intermediate-only counts as final usage (%j)', async (...frames) => {
    const events = await collect(setup(async () => sse(...frames)).provider.streamChat(input));
    expect(events.filter(e => e.type === 'usage')).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: 'finish', reason: 'stop' });
  });
  it.each([[401, 'authentication_failed'], [429, 'rate_limited'], [500, 'internal_error']] as const)(
    'maps native SSE error %s after partial without leaking its body or retrying', async (code, expected) => {
      const fetcher = vi.fn(async () => sse(chunk('partial'), { error: { code, message: fakeKey, status: 'UNTRUSTED' } }));
      const events = await collect(setup(fetcher).provider.streamChat(input));
      expect(events).toContainEqual({ type: 'text_delta', requestId: input.requestId, text: 'partial' });
      expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: expected } });
      expect(fetcher).toHaveBeenCalledTimes(1); expect(JSON.stringify(events)).not.toContain(fakeKey);
    });
  it('rejects an SSE error after an apparent STOP instead of publishing success', async () => {
    const events = await collect(setup(async () => sse(chunk('answer', 'STOP'), { error: { code: 429, message: fakeKey } })).provider.streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'rate_limited' } });
    expect(events.some(e => e.type === 'finish')).toBe(false);
  });
  it('does not count unsupported tool prompt tokens as ordinary text generation', async () => {
    const events = await collect(setup(async () => sse({ ...chunk('answer', 'STOP'),
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, toolUsePromptTokenCount: 4 } })).provider.streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'unsupported' } });
    expect(events.some(e => e.type === 'usage' || e.type === 'finish')).toBe(false);
  });

  it.each([[401, 'authentication_failed'], [403, 'forbidden'], [429, 'rate_limited'], [400, 'invalid_input'], [404, 'not_found'], [500, 'internal_error']] as const)(
    'sanitizes HTTP %s without retrying, buffering error bodies or logging', async (status, code) => {
      let reads = 0; let cancelled = false;
      const fetcher = vi.fn(async () => new Response(new ReadableStream({ pull() { reads++; }, cancel() { cancelled = true; } }, { highWaterMark: 0 }), { status }));
      const warn = vi.spyOn(console, 'warn'); const error = vi.spyOn(console, 'error');
      const events = await collect(setup(fetcher).provider.streamChat(input));
      expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ type: 'error', error: { code } });
      expect(fetcher).toHaveBeenCalledTimes(1); expect(reads).toBe(0); expect(cancelled).toBe(true);
      expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(JSON.stringify(events)).not.toContain(fakeKey);
    });

  it.each(['cancel', 'timeout'] as const)('interrupts stalled body on %s, retaining partial and closing transport', async kind => {
    const parent = new AbortController(); let cancelled = false; let signal: AbortSignal | null | undefined;
    const { provider } = setup(async (_url, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk('partial'))}\n\n`)); },
        cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    }, { timeoutMs: kind === 'timeout' ? 30 : 500 });
    const events = [];
    for await (const event of provider.streamChat({ ...input, signal: parent.signal })) {
      events.push(event); if (kind === 'cancel' && event.type === 'text_delta') parent.abort(new Error(fakeKey));
    }
    expect(events).toContainEqual({ type: 'text_delta', requestId: input.requestId, text: 'partial' });
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: kind === 'cancel' ? 'cancelled' : 'timeout' } });
    expect(signal?.aborted).toBe(true); expect(cancelled).toBe(true);
  });
  it('does not let a late credential revive an aborted request', async () => {
    const parent = new AbortController(); let release!: (key: string) => void;
    const fetcher = vi.fn<typeof fetch>(async () => sse(chunk('answer', 'STOP')));
    const { provider } = setup(fetcher, { resolveKey: () => new Promise(resolve => { release = resolve; queueMicrotask(() => parent.abort()); }) });
    const events = await collect(provider.streamChat({ ...input, signal: parent.signal }));
    release(fakeKey); await Promise.resolve();
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'cancelled' } }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('cancels late headers when a transport ignores the deadline', async () => {
    let release!: (response: Response) => void; let cancelled = false;
    const { provider } = setup(() => new Promise(resolve => { release = resolve; }), { timeoutMs: 20 });
    expect((await collect(provider.streamChat(input))).at(-1)).toMatchObject({ type: 'error', error: { code: 'timeout' } });
    release(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });
  it('retains partial text after a network disconnect without leaking exception details', async () => {
    let reads = 0;
    const { provider } = setup(async () => new Response(new ReadableStream({ pull(c) {
      if (reads++ === 0) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk('partial'))}\n\n`));
      else c.error(new Error(fakeKey));
    } }), { headers: { 'content-type': 'text/event-stream' } }));
    const events = await collect(provider.streamChat(input));
    expect(events).toContainEqual({ type: 'text_delta', requestId: input.requestId, text: 'partial' });
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'network_error' } }); expect(JSON.stringify(events)).not.toContain(fakeKey);
  });
  it('closes the body when the consumer stops reading', async () => {
    let cancelled = false; let signal: AbortSignal | null | undefined;
    const { provider } = setup(async (_url, init) => { signal = init?.signal; return new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk('partial'))}\n\n`));
    }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }); });
    for await (const event of provider.streamChat(input)) if (event.type === 'text_delta') break;
    expect(cancelled).toBe(true); expect(signal?.aborted).toBe(true);
  });

  it.each(['../secrets', 'models/a/b', 'a?key=bad', 'a%2fb', 'https://evil.test', 'a#fragment'])(
    'rejects model path injection %s before credential resolution', async modelId => {
      const fetcher = vi.fn(); const { provider, resolveKey } = setup(fetcher);
      expect((await collect(provider.streamChat({ ...input, modelId }))).at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_input' } });
      expect(resolveKey).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    });
  it.each([{ ...input, outputTokenLimit: undefined }, { ...input, messages: [] },
    { ...input, messages: [{ role: 'user', content: 'task' }, { role: 'system', content: 'late elevation' }] }])(
    'rejects missing limits/contents or misplaced system before Key access', async invalid => {
      const { provider, resolveKey } = setup(vi.fn());
      expect((await collect(provider.streamChat(invalid as typeof input))).at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_input' } });
      expect(resolveKey).not.toHaveBeenCalled();
    });
  it.each(['https://evil.test/v1beta', 'http://127.0.0.1/v1beta', `${baseUrl}?key=bad`])('rejects untrusted configured target %s', target => {
    expect(() => setup(vi.fn(), { configuration: { ...configuration, baseUrl: target }, confirmedBaseUrl: target })).toThrow(ContractError);
  });
  it('ignores environment Keys/Base URL/Vertex flags and accepts models/ custom IDs', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'environment-secret'); vi.stubEnv('GEMINI_API_KEY', 'other-secret');
    vi.stubEnv('GOOGLE_GENAI_USE_VERTEXAI', 'true'); vi.stubEnv('GOOGLE_GEMINI_BASE_URL', 'https://evil.test');
    const fetcher = vi.fn<typeof fetch>(async () => sse(chunk('answer', 'STOP')));
    expect((await collect(setup(fetcher).provider.streamChat({ ...input, modelId: 'models/custom-v2' }))).at(-1)?.type).toBe('finish');
    expect(String(fetcher.mock.calls[0][0])).toBe(`${baseUrl}/models/custom-v2:streamGenerateContent?alt=sse`);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('x-goog-api-key')).toBe(fakeKey);
  });
  it('rejects redirected responses without exposing the location', async () => {
    const events = await collect(setup(async () => new Response(null, { status: 302, headers: { location: `https://evil.test/${fakeKey}` } })).provider.streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_response' } }); expect(JSON.stringify(events)).not.toContain(fakeKey);
  });
});

describe('Gemini model discovery and connection levels', () => {
  it.each(['cancel', 'timeout'] as const)('releases a stalled model-list reader on %s', async mode => {
    const parent = new AbortController(); let cancelled = false; let signal: AbortSignal | null | undefined;
    const provider = setup(async (_url, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream({ start(c) {
        c.enqueue(new TextEncoder().encode('{"models":['));
        if (mode === 'cancel') queueMicrotask(() => parent.abort(new Error(fakeKey)));
      }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } });
    }, { timeoutMs: mode === 'timeout' ? 20 : 500 }).provider;
    await expect(provider.listModels({ requestId: 'list', signal: parent.signal })).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : 'timeout' });
    expect(cancelled).toBe(true); expect(signal?.aborted).toBe(true);
  });
  it('does not report a model-list error envelope as authenticated empty success', async () => {
    const provider = setup(async () => Response.json({ error: { code: 429, message: fakeKey } })).provider;
    await expect(provider.listModels({ requestId: 'list' })).rejects.toMatchObject({ code: 'rate_limited' });
    expect(await provider.testConnection({ requestId: 'auth', level: 'authentication' })).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
  });
  it('paginates bounded native models, filters non-text generation models and retains manual IDs independently', async () => {
    const urls: string[] = [];
    const { provider } = setup(async url => { urls.push(String(url)); return Response.json(urls.length === 1 ? {
      models: [{ name: 'models/gemini-a', displayName: 'Gemini A', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'page+/=',
    } : { models: [{ name: 'models/gemini-b', supportedGenerationMethods: ['generateContent'] }] }); });
    expect(await provider.listModels({ requestId: 'list' })).toEqual([{ id: 'gemini-a', name: 'Gemini A' }, { id: 'gemini-b', name: 'gemini-b' }]);
    expect(urls).toEqual([`${baseUrl}/models?pageSize=100`, `${baseUrl}/models?pageSize=100&pageToken=page%2B%2F%3D`]);
  });
  it.each([
    { models: [{ name: 'bad/id', supportedGenerationMethods: ['generateContent'] }] },
    { models: [{ name: 'models/a', supportedGenerationMethods: ['generateContent'] }, { name: 'models/a', supportedGenerationMethods: ['generateContent'] }] },
    { models: 'private' }, { models: [], nextPageToken: 'repeat' },
  ])('rejects malformed, duplicate or cyclic model lists (%j)', async body => {
    await expect(setup(async () => Response.json(body)).provider.listModels({ requestId: 'list' })).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('keeps configuration local, authentication on models, generation explicit and bounded', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes(':streamGenerateContent') ? sse(chunk('OK', 'STOP')) : Response.json({ models: [] }));
    const { provider, resolveKey } = setup(fetcher);
    expect(await provider.testConnection({ requestId: 'config', level: 'configuration' })).toEqual({ requestId: 'config', level: 'configuration', ok: true });
    expect(resolveKey).not.toHaveBeenCalled();
    expect(await provider.testConnection({ requestId: 'auth', level: 'authentication' })).toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const result = await provider.testConnection({ requestId: 'gen', level: 'generation', modelId: 'manual-gemini' });
    expect(connectionTestResultSchema.safeParse(result).success).toBe(true); expect(result.ok).toBe(true);
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({ contents: [{ role: 'user', parts: [{ text: 'Reply OK.' }] }], generationConfig: { candidateCount: 1, maxOutputTokens: 8 } });
  });
  it('does not report authentication or a filtered generation as successful', async () => {
    expect(await setup(async () => new Response(null, { status: 401 })).provider.testConnection({ requestId: 'auth', level: 'authentication' })).toMatchObject({ ok: false, error: { code: 'authentication_failed' } });
    expect(await setup(async () => sse({ promptFeedback: { blockReason: 'SAFETY' } })).provider.testConnection({ requestId: 'gen', level: 'generation', modelId: 'manual' })).toMatchObject({ ok: false });
  });
});
