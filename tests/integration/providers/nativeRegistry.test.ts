// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry, type ApprovedModelPolicy } from '../../../src/main/providers/ProviderRegistry';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';
import { collect, response, success } from '../../unit/providers/anthropic/fixtures';
import { sse, chunk } from '../../unit/providers/gemini/fixtures';

const databases: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of databases.splice(0)) db.close(); });
const definitions = [
  { kind: 'anthropic', baseUrl: 'https://api.anthropic.com', modelId: 'claude-fixture', outputTokenParameter: 'max_tokens' },
  { kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', modelId: 'gemini-fixture', outputTokenParameter: 'maxOutputTokens' },
] as const;
type Definition = typeof definitions[number];
async function fixture(d: Definition, options: { approved?: boolean; proxy?: boolean } = {}) {
  const db = new Database(':memory:'); db.initialize(); databases.push(db);
  db.createProvider({ id: 'native', name: 'Owned native fixture', kind: d.kind, baseUrl: null });
  const keys = new KeyService(db, createMemoryKeyBackend()); await keys.storeKey('native', 'owned-fake-native-secret');
  const requests: Request[] = [];
  const proxyKinds: Array<string | undefined> = [];
  const count = vi.fn<(_wire: unknown) => number | undefined>(() => 10);
  const policy = {
    evidence: 'Owned fixture deterministic policy; never a real model approval', outputTokenParameter: d.outputTokenParameter,
    contextWindowTokens: 1000, maxOutputTokens: 32,
    counter: { modelId: d.modelId, method: 'Owned fixture native wire count', kind: 'exact', countMessages: count },
    nativeInputCounter: { protocol: d.kind === 'anthropic' ? 'anthropic-messages-v1' : 'gemini-generate-content-v1',
      evidence: 'Owned fixture counts the native wire shape; not a public tokenizer', countNativeWire: count },
    price: { currency: 'CNY', inputMicroCnyPerToken: 1, outputMicroCnyPerToken: 1, maxRequestMicroCny: 100,
      reviewedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), evidence: 'Owned nonbillable fixture price only' },
  } as ApprovedModelPolicy;
  const transport = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(url, init); requests.push(request);
    if (request.method === 'GET') return d.kind === 'anthropic'
      ? Response.json({ data: [{ id: d.modelId, display_name: 'Fixture Claude' }], has_more: false })
      : Response.json({ models: [{ name: `models/${d.modelId}`, supportedGenerationMethods: ['generateContent'] }] });
    return d.kind === 'anthropic' ? response(success('OK')) : sse({ ...chunk('OK', 'STOP'), usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 3, totalTokenCount: 9 } });
  });
  const registry = new ProviderRegistry(db, keys, { policyResolver: () => options.approved ? policy : undefined,
    transportFactory: (guard, _diagnostics, proxyKind) => { proxyKinds.push(proxyKind); return async (url, init) => { guard(); return transport(url, init); }; },
    ...(options.proxy ? { proxy: { hostname: '127.0.0.1', port: 7890 } as const } : {}),
  });
  const confirm = () => registry.confirmTarget({ providerId: 'native', baseUrl: d.baseUrl, confirmed: true });
  return { db, keys, registry, confirm, requests, proxyKinds, policy, count, transport, settings: new ProviderSettingsService(db, keys, registry) };
}

describe.each(definitions)('$kind production Registry wiring', d => {
  it('requires explicit target confirmation and returns models through the native factory', async () => {
    const f = await fixture(d);
    expect(() => f.registry.getAdapter('native')).toThrow(); f.confirm();
    expect(await f.settings.listModels({ providerId: 'native' })).toMatchObject({ providerId: 'native', models: [{ id: d.modelId }] });
    expect(f.requests).toHaveLength(1);
    const request = f.requests[0];
    expect(new URL(request.url).origin).toBe(new URL(d.baseUrl).origin);
    expect(request.headers.get(d.kind === 'anthropic' ? 'x-api-key' : 'x-goog-api-key')).toBe('owned-fake-native-secret');
    expect(request.headers.get('authorization')).toBeNull();
    expect(request.redirect).toBe('error');
  });
  it('checks configuration locally without reading credentials or claiming authentication', async () => {
    const f = await fixture(d); const resolve = vi.spyOn(f.keys, 'resolveKey');
    expect(await f.settings.testConnection({ providerId: 'native', level: 'configuration' })).toMatchObject({ result: { ok: true, level: 'configuration' } });
    expect(resolve).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(0);
  });
  it('rejects generation with unknown model evidence before Key state or transport', async () => {
    const f = await fixture(d); f.confirm(); const read = vi.spyOn(f.keys, 'getProviderKeyState');
    expect(await collect(f.registry.getAdapter('native').streamChat({ requestId: 'unknown', modelId: d.modelId, messages: [{ role: 'user', content: 'Reply OK.' }], outputTokenLimit: 8 })))
      .toEqual([expect.objectContaining({ type: 'error', error: expect.objectContaining({ code: 'unsupported' }) })]);
    expect(read).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(0);
  });
  it('invalidates an already obtained adapter after Key replacement', async () => {
    const f = await fixture(d); f.confirm(); const adapter = f.registry.getAdapter('native');
    await f.keys.storeKey('native', 'replacement-fake-secret');
    await expect(adapter.listModels({ requestId: 'revoked' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(f.requests).toHaveLength(0);
  });
  it('rejects a changed native origin without reading Key', async () => {
    const f = await fixture(d); const read = vi.spyOn(f.keys, 'getProviderKeyState');
    const { keyReference: _key, createdAt: _created, updatedAt: _updated, ...input } = f.db.getProviderConfiguration('native')!;
    f.db.updateProvider({ ...input, baseUrl: 'https://unreviewed.invalid' });
    expect(() => f.registry.confirmTarget({ providerId: 'native', baseUrl: 'https://unreviewed.invalid', confirmed: true })).toThrow();
    expect(read).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(0);
  });
  it('routes a native origin through the CONNECT proxy with its own fixed target, not the DeepSeek path', async () => {
    const f = await fixture(d, { proxy: true, approved: true }); f.confirm();
    const result = await collect(f.registry.getAdapter('native', d.modelId).streamChat({ requestId: 'proxied', modelId: d.modelId,
      messages: [{ role: 'user', content: 'Reply OK.' }], outputTokenLimit: 8 }));
    expect(result.at(-1)).toEqual({ type: 'finish', requestId: 'proxied', reason: 'stop' });
    expect(f.proxyKinds).toEqual([d.kind]);
    expect(new URL(f.requests[0].url).origin).toBe(new URL(d.baseUrl).origin);
  });
  it('still refuses a non-reviewed compatible origin while a proxy is configured', async () => {
    const f = await fixture(d, { proxy: true });
    f.db.createProvider({ id: 'other', name: 'Other compatible', kind: 'openai-compatible', baseUrl: 'https://other.example/v1' });
    f.registry.confirmTarget({ providerId: 'other', baseUrl: 'https://other.example/v1', confirmed: true });
    const read = vi.spyOn(f.keys, 'getProviderKeyState');
    expect(() => f.registry.getAdapter('other')).toThrowError(expect.objectContaining({ code: 'forbidden' }));
    expect(read).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(0);
  });
  it('passes a reviewed fixture through the real native factory with the native output field and usage semantics', async () => {
    const f = await fixture(d, { approved: true }); f.confirm();
    const result = await collect(f.registry.getAdapter('native', d.modelId).streamChat({ requestId: 'approved', modelId: d.modelId,
      messages: [{ role: 'system', content: 'trusted' }, { role: 'user', content: 'Reply OK.' }, { role: 'assistant', content: 'Prior public answer' }], outputTokenLimit: 8 }));
    expect(result).toContainEqual({ type: 'text_delta', requestId: 'approved', text: 'OK' });
    expect(result.at(-1)).toEqual({ type: 'finish', requestId: 'approved', reason: 'stop' });
    expect(f.requests).toHaveLength(1);
    const body = await f.requests[0].json();
    if (d.kind === 'anthropic') {
      expect(body.max_tokens).toBe(8); expect(body).not.toHaveProperty('maxOutputTokens');
      expect(f.count).toHaveBeenCalledWith({ system: [{ type: 'text', text: 'trusted' }], messages: [
        { role: 'user', content: 'Reply OK.' }, { role: 'assistant', content: 'Prior public answer' },
        { role: 'user', content: 'Respond to the public discussion above as the current agent.' },
      ] });
      expect(result).toContainEqual({ type: 'usage', requestId: 'approved', inputTokens: 7, outputTokens: 3 });
    } else {
      expect(body.generationConfig).toEqual({ candidateCount: 1, maxOutputTokens: 8 }); expect(body).not.toHaveProperty('max_tokens');
      expect(f.count).toHaveBeenCalledWith({ contents: [{ role: 'user', parts: [{ text: 'Reply OK.' }] }, { role: 'model', parts: [{ text: 'Prior public answer' }] }],
        systemInstruction: { parts: [{ text: 'trusted' }] } });
      expect(result).toContainEqual({ type: 'usage', requestId: 'approved', inputTokens: 4, outputTokens: 5 });
    }
  });
  it('uses that same native wire counter for R05 context and final preflight', async () => {
    const f = await fixture(d, { approved: true }); f.confirm(); const budget = f.registry.budget('native', d.modelId)!;
    expect(budget.counter.countMessages([{ role: 'user', content: 'Reply OK.' }])).toBe(10);
    expect(f.count.mock.calls[0][0]).toHaveProperty(d.kind === 'anthropic' ? 'messages' : 'contents');
  });
  it.each(['wire-counter', 'counter-unknown', 'expired-price', 'cost-limit'])('rejects %s before reading a Key', async failure => {
    const f = await fixture(d, { approved: true }); f.confirm(); const read = vi.spyOn(f.keys, 'getProviderKeyState');
    if (failure === 'wire-counter') delete f.policy.nativeInputCounter;
    if (failure === 'counter-unknown') f.count.mockReturnValue(undefined);
    if (failure === 'expired-price' && 'currency' in f.policy.price) f.policy.price.expiresAt = new Date(Date.now() - 1).toISOString();
    if (failure === 'cost-limit' && 'currency' in f.policy.price) f.policy.price.maxRequestMicroCny = 1;
    const events = await collect(f.registry.getAdapter('native').streamChat({ requestId: 'rejected', modelId: d.modelId,
      messages: [{ role: 'user', content: 'Reply OK.' }], outputTokenLimit: 8 }));
    expect(events).toEqual([expect.objectContaining({ type: 'error' })]); expect(read).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(0);
  });
  it('checks the fixed generation test budget inside Registry before Key or network', async () => {
    const f = await fixture(d, { approved: true }); f.confirm();
    if ('currency' in f.policy.price) f.policy.price.maxRequestMicroCny = 1;
    const read = vi.spyOn(f.keys, 'getProviderKeyState');
    expect(await f.registry.getAdapter('native').testConnection({ requestId: 'not-a-budget-bypass', level: 'generation', modelId: d.modelId }))
      .toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(read).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(0);
  });
  it('keeps Settings authentication distinct from an explicitly authorized generation test', async () => {
    const f = await fixture(d, { approved: true }); f.confirm();
    expect(await f.settings.testConnection({ providerId: 'native', level: 'authentication' })).toMatchObject({ result: { ok: true, level: 'authentication' } });
    expect(f.requests.map(request => request.method)).toEqual(['GET']);
    expect(await f.settings.testConnection({ providerId: 'native', level: 'generation', modelId: d.modelId })).toMatchObject({ result: { ok: false, error: { code: 'forbidden' } } });
    expect(f.requests).toHaveLength(1);
    expect(await f.settings.testConnection({ providerId: 'native', level: 'generation', modelId: d.modelId, allowGeneration: true })).toMatchObject({ result: { ok: true, level: 'generation' } });
    expect(f.requests.map(request => request.method)).toEqual(['GET', 'POST']);
  });
  it('rejects native configuration errors as local errors without Key reads', async () => {
    const f = await fixture(d); const read = vi.spyOn(f.keys, 'getProviderKeyState');
    const { keyReference: _key, createdAt: _created, updatedAt: _updated, ...input } = f.db.getProviderConfiguration('native')!;
    f.db.updateProvider({ ...input, baseUrl: 'https://unreviewed.invalid' });
    expect(await f.settings.testConnection({ providerId: 'native', level: 'configuration' })).toMatchObject({ result: { ok: false, error: { code: 'invalid_input' } } });
    expect(read).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(0);
  });
  it('rejects Key revocation that occurs while Key state is being resolved', async () => {
    const f = await fixture(d); f.confirm(); const read = f.keys.getProviderKeyState.bind(f.keys);
    vi.spyOn(f.keys, 'getProviderKeyState').mockImplementationOnce(async id => { const state = await read(id); await f.keys.deleteKey(id); return state; });
    await expect(f.registry.getAdapter('native').listModels({ requestId: 'late-key-state' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(f.requests).toHaveLength(0);
  });
  it('drops a response returned after its Provider Key has been revoked', async () => {
    const f = await fixture(d); f.confirm();
    f.transport.mockImplementationOnce(async () => { await f.keys.deleteKey('native'); return Response.json({ data: [], has_more: false, models: [] }); });
    await expect(f.registry.getAdapter('native').listModels({ requestId: 'late-response' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it.each([401, 429, 307])('does not retry or reveal body/credential details on HTTP %s', async status => {
    const f = await fixture(d, { approved: true }); f.confirm();
    f.transport.mockImplementationOnce(async () => new Response('untrusted-secret-response', { status, headers: { location: 'https://unreviewed.invalid' } }));
    const events = await collect(f.registry.getAdapter('native', d.modelId).streamChat({ requestId: 'http-failure', modelId: d.modelId,
      messages: [{ role: 'user', content: 'Reply OK.' }], outputTokenLimit: 8 }));
    expect(events).toMatchObject([{ type: 'error' }]); expect(f.transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(events)).not.toMatch(/owned-fake|untrusted-secret|unreviewed|x-api-key|x-goog-api-key|authorization/iu);
  });
});
