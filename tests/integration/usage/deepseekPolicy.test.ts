// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { countDeepSeekInputUpperBound, deepSeekModelPolicy, deepSeekModelReview } from '../../../src/main/providers/modelPolicies/deepseek';
import { collect } from '../../unit/providers/openai/fixtures';

const baseUrl = 'https://api.deepseek.com';
const databases: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of databases.splice(0)) db.close(); });

function fixture(options: { baseUrl?: string; models?: string[] } = {}) {
  const db = new Database(':memory:'); db.initialize(); databases.push(db);
  db.createProvider({ id: 'deepseek', name: 'DeepSeek direct', kind: 'openai-compatible', baseUrl: options.baseUrl ?? baseUrl,
    customModels: (options.models ?? ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash']).map(id => ({ id, name: id })) });
  const keys = new KeyService(db, createMemoryKeyBackend());
  const transport = vi.fn<typeof fetch>();
  const registry = new ProviderRegistry(db, keys, { policyResolver: deepSeekModelPolicy, transportFactory: guard => async (url, init) => { guard(); return transport(url, init); } });
  registry.confirmTarget({ providerId: 'deepseek', baseUrl: options.baseUrl ?? baseUrl, confirmed: true });
  return { db, keys, registry, transport, configuration: db.getProviderConfiguration('deepseek')! };
}
const request = (modelId = 'deepseek-flash', content = 'Reply OK.', outputTokenLimit = 128) =>
  ({ requestId: 'request', modelId, outputTokenLimit, messages: [{ role: 'system' as const, content: '你是起草者' }, { role: 'user' as const, content }] });

it('records the reviewed official evidence with a 30-day window and no invented numbers', () => {
  expect(deepSeekModelReview.sources[0]).toBe('https://api-docs.deepseek.com/zh-cn/quick_start/pricing/');
  expect(Date.parse(deepSeekModelReview.expiresAt) - Date.parse(deepSeekModelReview.reviewedAt)).toBe(30 * 24 * 3600 * 1000);
  expect(deepSeekModelReview.models['deepseek-flash']).toMatchObject({ modelVersion: 'DeepSeek-V4.1-Flash-1017', inputMicroCnyPerToken: 2, outputMicroCnyPerToken: 8 });
  expect(Object.keys(deepSeekModelReview.models)).toEqual(['deepseek-flash']);
});

it('bounds input tokens by UTF-8 bytes plus explicit framing, counting multibyte text by bytes', () => {
  const { perRequestTokens, perMessageTokens } = deepSeekModelReview.framing;
  expect(countDeepSeekInputUpperBound([{ role: 'user', content: 'abc' }])).toBe(perRequestTokens + perMessageTokens + 3);
  // Each CJK character is three UTF-8 bytes; the official ratio (≈0.6 tokens/char) is far below this bound.
  expect(countDeepSeekInputUpperBound([{ role: 'system', content: '中文' }, { role: 'user', content: '' }])).toBe(perRequestTokens + 2 * perMessageTokens + 6);
  expect(countDeepSeekInputUpperBound([{ role: 'user', content: '😀' }])).toBe(perRequestTokens + perMessageTokens + 4);
});

it('approves only deepseek-flash on the exact compatible DeepSeek origin', () => {
  const f = fixture();
  expect(deepSeekModelPolicy(f.configuration, 'deepseek-flash')).toMatchObject({ outputTokenParameter: 'max_tokens', counter: { kind: 'upper_bound', modelId: 'deepseek-flash' },
    price: { currency: 'CNY', inputMicroCnyPerToken: 2, outputMicroCnyPerToken: 8, reviewedAt: deepSeekModelReview.reviewedAt, expiresAt: deepSeekModelReview.expiresAt } });
  for (const modelId of ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'DeepSeek-Flash']) expect(deepSeekModelPolicy(f.configuration, modelId)).toBeUndefined();
  for (const changed of [{ baseUrl: `${baseUrl}/v1` }, { baseUrl: `${baseUrl}/anthropic` }, { baseUrl: 'https://api.deepseek.com.evil.test' }, { kind: 'openai' as const }, { kind: 'mock' as const }]) {
    expect(deepSeekModelPolicy({ ...f.configuration, ...changed }, 'deepseek-flash')).toBeUndefined();
  }
  expect(() => f.registry.assertSelection('deepseek', 'deepseek-flash')).not.toThrow();
  for (const modelId of ['deepseek-v4-pro', 'deepseek-v4-flash']) expect(() => f.registry.assertSelection('deepseek', modelId)).toThrowError(expect.objectContaining({ code: 'unsupported' }));
});

it('quotes the maximum cost from the byte bound and the requested output limit', () => {
  const f = fixture();
  const input = request('deepseek-flash', '设计一个校园跑腿平台', 1024);
  const bound = countDeepSeekInputUpperBound(input.messages)!;
  expect(f.registry.quoteRequest('deepseek', input)).toEqual({ currency: 'CNY', inputTokenBound: bound, outputTokenLimit: 1024,
    inputMicroPerToken: 2, outputMicroPerToken: 8, reservedMicro: bound * 2 + 1024 * 8,
    priceEvidence: expect.stringContaining('DeepSeek-V4.1-Flash-1017'), priceReviewedAt: deepSeekModelReview.reviewedAt,
    // D106: settlement rates travel with the quote; reservation above stays at the peak cache-miss price.
    periodPricing: { utcOffsetMinutes: 480, peakWeekdays: [1, 2, 3, 4, 5], peakWindows: [{ startMinute: 540, endMinute: 720 }, { startMinute: 840, endMinute: 1080 }],
      peak: { cacheHitMicroPerMillion: 40_000, cacheMissMicroPerMillion: 2_000_000, outputMicroPerMillion: 8_000_000 },
      offPeak: { cacheHitMicroPerMillion: 20_000, cacheMissMicroPerMillion: 1_000_000, outputMicroPerMillion: 4_000_000 },
      evidence: expect.stringContaining('holidays treated as working days') } });
});

it('rejects requests beyond the app caps before any Key read or network call', async () => {
  const f = fixture(); const read = vi.spyOn(f.keys, 'getProviderKeyState');
  expect(() => f.registry.checkGeneration('deepseek', request('deepseek-flash', 'x', deepSeekModelReview.maxOutputTokens + 1))).toThrowError(expect.objectContaining({ code: 'invalid_input' }));
  const huge = 'a'.repeat(deepSeekModelReview.contextWindowTokens);
  expect(() => f.registry.checkGeneration('deepseek', request('deepseek-flash', huge, 128))).toThrowError(expect.objectContaining({ code: 'invalid_input' }));
  expect(read).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
});

it('stops approving once the 30-day review expires, before Key reads', async () => {
  const f = fixture(); const adapter = f.registry.getAdapter('deepseek', 'deepseek-flash'); const read = vi.spyOn(f.keys, 'getProviderKeyState');
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(deepSeekModelReview.expiresAt));
  expect((await collect(adapter.streamChat(request()))).at(-1)).toMatchObject({ type: 'error', error: { code: 'unsupported' } });
  expect(read).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
});

it('sends max_tokens with thinking disabled to the official chat endpoint', async () => {
  const f = fixture(); await f.keys.storeKey('deepseek', 'owned-fake-deepseek-key');
  // A new Key revision voids the earlier target confirmation.
  f.registry.confirmTarget({ providerId: 'deepseek', baseUrl, confirmed: true });
  f.transport.mockImplementation(async () => new Response([
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 1 } })}\n\n`, 'data: [DONE]\n\n'].join(''),
  { headers: { 'content-type': 'text/event-stream' } }));
  const chunks = await collect(f.registry.getAdapter('deepseek', 'deepseek-flash').streamChat(request()));
  expect(chunks).toContainEqual({ type: 'usage', requestId: 'request', inputTokens: 12, outputTokens: 1 });
  const [url, init] = f.transport.mock.calls[0];
  expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
  expect(JSON.parse(String(init!.body))).toMatchObject({ model: 'deepseek-flash', max_tokens: 128, stream: true, thinking: { type: 'disabled' }, stream_options: { include_usage: true } });
});
