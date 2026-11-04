// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';
import { discoverable, serviceCatalog } from '../../../src/shared/serviceCatalog';

const open: Database[] = [];
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); open.splice(0).forEach(db => db.close()); });
const service = (id: string) => serviceCatalog.find(item => item.id === id)!;
const FAKE_KEY = 'owned-fake-discovery-key';

/** The production catalog; the answer to `GET /models` is the test's. */
async function fixture(answer: () => Response | Promise<Response> = () => Response.json({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] })) {
  const db = new Database(':memory:'); db.initialize(); open.push(db);
  const keys = new KeyService(db, createMemoryKeyBackend());
  const sent = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => answer());
  const registry = new ProviderRegistry(db, keys, { transportFactory: guard => async (url, init) => { guard(); return sent(url, init); } });
  const settings = new ProviderSettingsService(db, keys, registry);
  const provider = await settings.createProvider({ name: 'DeepSeek', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash' });
  await settings.setKey({ providerId: provider.id, apiKey: FAKE_KEY });
  return { db, keys, sent, registry, settings, id: provider.id };
}
const list = (...ids: string[]) => () => Response.json({ object: 'list', data: ids.map(id => ({ id, object: 'model' })) });
const editable = async (settings: ProviderSettingsService, id: string) => {
  const { keyReference: _key, createdAt: _created, updatedAt: _updated, ...input } = await settings.getProviderConfiguration({ id });
  return input;
};

describe('D143 which models a list may add', () => {
  it.each([
    ['deepseek', 'deepseek-v9'], ['deepseek', 'DeepSeek-V9'], ['doubao', 'doubao-seed-3-0-pro-270101'], ['qwen', 'qwen4-plus'], ['kimi', 'kimi-k4'], ['glm', 'glm-6'], ['glm', 'GLM-6-Flash'],
    ['ernie', 'ernie-6.0'], ['hunyuan', 'hy5'], ['hunyuan', 'hunyuan-next'], ['minimax', 'MiniMax-M4'], ['minimax', 'minimax-m4-flash'],
  ])('%s keeps its own %s', (id, model) => expect(discoverable(service(id), model)).toBe(true));
  it.each([
    ['qwen', 'kimi-k3'], ['qwen', 'glm-5.3'], ['qwen', 'deepseek-v4.1-flash'], ['doubao', 'deepseek-v4-pro-ga-260813'], ['doubao', 'glm-5-2-260617'], ['doubao', 'doubao-seedream-5-0-260128'], ['doubao', 'doubao-seedance-2-5-260628'],
    ['deepseek', 'vendor-x1'], ['hunyuan', 'hydra-1'], ['minimax', 'MiniMax-H3'],
  ])('%s leaves out what is not its own: %s', (id, model) => expect(discoverable(service(id), model)).toBe(false));
  it.each([
    ['doubao', 'doubao-seed-translation-250915'], ['doubao', 'doubao-seed-character-260628'], ['doubao', 'doubao-seed-embedding-1'], ['qwen', 'qwen-mt-plus'], ['qwen', 'qwen-audio-3.1-tts-plus'], ['qwen', 'qwen-image-3.0-pro'], ['qwen', 'qwen3.7-text-embedding'],
    ['qwen', 'qwen3.7-text-rerank'], ['qwen', 'qwen3-vl-embedding'], ['qwen', 'qwen-vl-ocr'], ['qwen', 'qwen3.8-omni-flash-realtime'], ['qwen', 'qwen-long'], ['qwen', 'QWEN-OCR'], ['glm', 'glm-image'], ['glm', 'glm-ocr'], ['glm', 'glm-5.3-flashx-legal'], ['glm', 'glm-4-voice'], ['glm', 'glm-tts'], ['glm', 'glm-asr-2512'],
    ['hunyuan', 'hy-mt2-pro'], ['hunyuan', 'hunyuan-role-latest'], ['hunyuan', 'hunyuan-turbos-vision-video-20250728'],
  ])('%s leaves out the special-purpose %s', (id, model) => expect(discoverable(service(id), model)).toBe(false));
  it.each([
    ['qwen', 'qwen3-vl-plus'], ['qwen', 'qwen3.8-omni-flash'], ['qwen', 'qwen3.5-omni-plus'], ['qwen', 'qwen-vl-max'], ['glm', 'glm-5v-turbo'], ['glm', 'glm-4.6v'], ['glm', 'glm-4.6v-flash'], ['glm', 'glm-4v-flash'], ['glm', 'glm-4.1v-thinking-flash'],
    ['hunyuan', 'hunyuan-t1-vision-20250916'], ['hunyuan', 'hy-vision-2.0-instruct'],
  ])('%s keeps the multimodal %s', (id, model) => expect(discoverable(service(id), model)).toBe(true));
  it('matches whole words, so a word inside another does not count', () => {
    expect(discoverable(service('kimi'), 'kimi-smart')).toBe(true);
    expect(discoverable(service('qwen'), 'qwen-prole')).toBe(true);
  });
  it('leaves out dated copies of a model, but not IDs that carry a date as their version', () => {
    expect(discoverable(service('qwen'), 'qwen-plus-2026-01-25')).toBe(false);
    expect(discoverable(service('doubao'), 'doubao-seed-3-0-pro-270101')).toBe(true);
  });
  it('every built-in model fits its own rule, so a list never disowns one', () => {
    for (const item of serviceCatalog) for (const model of item.models) expect(discoverable(item, model.id), model.id).toBe(true);
  });
});

describe('D143 asking a service for its models', () => {
  it('sends one GET to the fixed address with the saved Key, and keeps only what the rule allows', async () => {
    const { settings, sent, id } = await fixture(list('deepseek-flash', 'deepseek-v9', 'vendor-x1', 'deepseek-translation-1'));
    expect(await settings.refreshModels({ providerId: id, force: true })).toEqual({ providerId: id, outcome: 'listed' });
    expect(sent).toHaveBeenCalledTimes(1);
    const [url, init] = sent.mock.calls[0]!;
    expect(String(url)).toBe('https://api.deepseek.com/models');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(new Headers(init!.headers).get('authorization')).toBe(`Bearer ${FAKE_KEY}`);
    expect(init).not.toHaveProperty('body');
    expect((await settings.getProviderConfiguration({ id })).customModels.map(model => model.id)).toEqual(['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v9']);
    const [row] = await settings.listModelReadiness();
    expect(row.models.find(model => model.modelId === 'deepseek-v9')).toMatchObject({ usable: true, contextWindowTokens: 128000, maxOutputTokens: 8192 });
    expect(row.discovery).toMatchObject({ outcome: 'listed' });
  });
  it('asks at most once a day unless the host asks, and never without a Key or for a stopped service', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T00:00:00.000Z'));
    const { settings, sent, keys, id } = await fixture();
    expect(await settings.refreshModels({ providerId: id })).toMatchObject({ outcome: 'listed' });
    vi.setSystemTime(new Date('2026-11-04T23:59:00.000Z'));
    expect(await settings.refreshModels({ providerId: id })).toMatchObject({ outcome: 'skipped' });
    expect(sent).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-11-05T00:01:00.000Z'));
    expect(await settings.refreshModels({ providerId: id })).toMatchObject({ outcome: 'listed' });
    expect(sent).toHaveBeenCalledTimes(2);
    expect(await settings.refreshModels({ providerId: id, force: true })).toMatchObject({ outcome: 'listed' });
    expect(sent).toHaveBeenCalledTimes(3);
    await keys.deleteKey(id);
    expect(await settings.refreshModels({ providerId: id, force: true })).toMatchObject({ outcome: 'skipped' });
    await settings.updateProvider({ ...await editable(settings, id), enabled: false, isDefault: false });
    expect(await settings.refreshModels({ providerId: id, force: true })).toMatchObject({ outcome: 'skipped' });
    expect(sent).toHaveBeenCalledTimes(3);
  });
  it('a failed look counts as a look, so it is not repeated all day', async () => {
    const { settings, sent, id } = await fixture(() => new Response('', { status: 500 }));
    expect(await settings.refreshModels({ providerId: id })).toMatchObject({ outcome: 'failed' });
    expect(await settings.refreshModels({ providerId: id })).toMatchObject({ outcome: 'skipped' });
    expect(sent).toHaveBeenCalledTimes(1);
  });
  it.each([
    [() => new Response('', { status: 404 }), 'unsupported'], [() => new Response('', { status: 405 }), 'failed'], [() => new Response('', { status: 401 }), 'authentication_failed'], [() => new Response('', { status: 403 }), 'authentication_failed'],
    [() => new Response('', { status: 503 }), 'failed'], [() => { throw new TypeError('fixture network failure'); }, 'failed'], [() => new Response(`{"echo":"${FAKE_KEY}"}`, { headers: { 'content-type': 'text/plain' } }), 'failed'],
    [() => Response.json({ nothing: true }), 'failed'], [list('vendor-x1'), 'unsupported'], [list(), 'unsupported'],
  ] as Array<[() => Response, string]>)('falls back to the built-in list and keeps no secret: answer %#', async (answer, outcome) => {
    const { settings, id } = await fixture(answer);
    const result = await settings.refreshModels({ providerId: id, force: true });
    expect(result).toEqual({ providerId: id, outcome });
    expect((await settings.getProviderConfiguration({ id })).customModels.map(model => model.id)).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
    const rows = await settings.listModelReadiness();
    expect(rows[0].discovery).toMatchObject({ outcome });
    expect(rows[0].models.every(model => model.usable && !model.delisted)).toBe(true);
    expect(JSON.stringify([result, rows])).not.toContain(FAKE_KEY);
  });
  it('a failure leaves the list it had', async () => {
    let answer: () => Response = list('deepseek-flash', 'deepseek-v9');
    const { settings, id } = await fixture(() => answer());
    await settings.refreshModels({ providerId: id, force: true });
    answer = () => new Response('', { status: 500 });
    await settings.refreshModels({ providerId: id, force: true });
    expect((await settings.getProviderConfiguration({ id })).customModels.map(model => model.id)).toContain('deepseek-v9');
  });
  it('two looks at once are one request', async () => {
    const { settings, sent, id } = await fixture();
    await Promise.all([settings.refreshModels({ providerId: id, force: true }), settings.refreshModels({ providerId: id, force: true })]);
    expect(sent).toHaveBeenCalledTimes(1);
  });
  it('a service outside the catalog is never asked', async () => {
    const { db, settings, sent, keys } = await fixture();
    db.createProvider({ id: 'old', name: '旧', kind: 'compatible', baseUrl: 'https://other.example/v1' });
    await keys.storeKey('old', FAKE_KEY);
    expect(await settings.refreshModels({ providerId: 'old', force: true })).toMatchObject({ outcome: 'skipped' });
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('D143 what may be used', () => {
  it('a listed model can be saved and used; one outside the list is refused without reading the Key', async () => {
    const { settings, registry, keys, sent, id } = await fixture(list('deepseek-v9'));
    const resolve = vi.spyOn(keys, 'resolveKey');
    const request = { requestId: 'request', modelId: 'deepseek-v8', outputTokenLimit: 8, messages: [{ role: 'user' as const, content: 'hi' }] };
    await settings.refreshModels({ providerId: id, force: true });
    resolve.mockClear(); sent.mockClear();
    expect(() => registry.assertSelection(id, 'deepseek-v9')).not.toThrow();
    await expect(settings.updateProvider({ ...await editable(settings, id), defaultModelId: 'deepseek-v9' })).resolves.toMatchObject({ defaultModelId: 'deepseek-v9' });
    expect(() => registry.checkGeneration(id, request)).toThrowError(expect.objectContaining({ code: 'model_unsupported' }));
    await expect(settings.updateProvider({ ...await editable(settings, id), defaultModelId: 'deepseek-v8' })).rejects.toMatchObject({ code: 'model_unsupported' });
    await expect(settings.updateProvider({ ...await editable(settings, id), customModels: [{ id: 'deepseek-v8', name: 'x' }] })).rejects.toMatchObject({ code: 'model_unsupported' });
    expect(resolve).not.toHaveBeenCalled(); expect(sent).not.toHaveBeenCalled();
  });
  it('what was stored by hand still has to fit the naming rule', async () => {
    const { db, settings, registry, id } = await fixture();
    db.saveModelDiscovery(id, 'listed', ['vendor-x1', 'deepseek-translation-1', 'deepseek-v9']);
    expect(() => registry.assertSelection(id, 'vendor-x1')).toThrowError(expect.objectContaining({ code: 'model_unsupported' }));
    expect(() => registry.assertSelection(id, 'deepseek-translation-1')).toThrowError(expect.objectContaining({ code: 'model_unsupported' }));
    expect(() => registry.assertSelection(id, 'deepseek-v9')).not.toThrow();
    const ids = (await settings.getProviderConfiguration({ id })).customModels.map(model => model.id);
    expect(ids).toContain('deepseek-v9');
    expect(ids).not.toContain('vendor-x1');
    await expect(settings.updateProvider({ ...await editable(settings, id), defaultModelId: 'vendor-x1' })).rejects.toMatchObject({ code: 'model_unsupported' });
  });
  it('a broken stored list counts as no list', async () => {
    const { db, registry, id } = await fixture();
    (db as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): void } } }).db.prepare("INSERT INTO provider_model_discovery(provider_id,model_ids_json,outcome,checked_at) VALUES(?,'[1,{\"id\":\"x\"}]','listed','2026-11-04T00:00:00.000Z')").run(id);
    expect(db.getModelDiscovery(id)?.modelIds).toEqual([]);
    expect(() => registry.assertSelection(id, 'deepseek-flash')).not.toThrow();
  });
  it('the renderer has no way to write the list: the input takes nothing but a provider and force', async () => {
    const { settings, id } = await fixture();
    await expect(settings.refreshModels({ providerId: id, models: ['deepseek-v9'] } as never)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(() => JSON.stringify(settings)).not.toThrow();
  });
  it('a new address starts with no list; deleting a service takes its list with it', async () => {
    const { db, settings, id } = await fixture(list('deepseek-v9'));
    await settings.refreshModels({ providerId: id, force: true });
    await settings.updateProvider({ ...await editable(settings, id), baseUrl: 'https://api.moonshot.cn/v1', customModels: [], defaultModelId: null });
    expect(db.getModelDiscovery(id)).toBeUndefined();
    db.saveModelDiscovery(id, 'listed', ['kimi-k4']);
    await settings.deleteProvider({ id });
    expect(db.getModelDiscovery(id)).toBeUndefined();
  });
});

describe('D143 a model the list no longer has', () => {
  it('a built-in model stays usable and listed, and only says so', async () => {
    const { settings, id } = await fixture(list('deepseek-flash'));
    await settings.refreshModels({ providerId: id, force: true });
    const [row] = await settings.listModelReadiness();
    expect(row.models.find(model => model.modelId === 'deepseek-v4-pro')).toMatchObject({ usable: true, delisted: true });
    expect(row.models.find(model => model.modelId === 'deepseek-flash')).not.toHaveProperty('delisted');
    expect((await settings.getProviderConfiguration({ id })).customModels.map(model => model.id)).toContain('deepseek-v4-pro');
  });
  it('a member on a model that left the list keeps it: nothing is replaced', async () => {
    let answer: () => Response = list('deepseek-flash', 'deepseek-v9');
    const { db, settings, registry, id } = await fixture(() => answer());
    await settings.refreshModels({ providerId: id, force: true });
    db.createRoom({ id: 'r', name: 'R' });
    db.createAgent({ id: 'a', roomId: 'r', displayName: 'A', roleTemplateId: 'draft', providerId: id, modelId: 'deepseek-v9' });
    await settings.updateProvider({ ...await editable(settings, id), defaultModelId: 'deepseek-v9' });
    answer = list('deepseek-flash');
    await settings.refreshModels({ providerId: id, force: true });
    expect(db.getAgentConfiguration('a')?.modelId).toBe('deepseek-v9');
    expect(() => registry.assertSelection(id, 'deepseek-v9')).toThrowError(expect.objectContaining({ code: 'model_unsupported' }));
    expect((await settings.getProviderConfiguration({ id })).defaultModelId).toBeNull();
    expect((await settings.listModelReadiness())[0].discovery).toMatchObject({ outcome: 'listed' });
  });
});
