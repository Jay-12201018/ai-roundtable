// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { KeyService, type KeyStorageBackend } from '../../../src/main/security/KeyService';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';
import { catalogServiceAt, serviceCatalog } from '../../../src/shared/serviceCatalog';
import { sseReply } from '../../fixtures/testCatalog';

const backend: KeyStorageBackend = { mode: 'secure', backend: 'fixture', persistent: true,
  async encrypt(value) { return Buffer.from(value).toString('base64'); }, async decrypt(value) { return Buffer.from(value, 'base64').toString(); } };
const open: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); open.splice(0).forEach(db => db.close()); });
/** The production catalog: nothing is injected here. */
function fixture() {
  const db = new Database(':memory:'); db.initialize(); open.push(db);
  const keys = new KeyService(db, backend);
  const sent = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => sseReply());
  const registry = new ProviderRegistry(db, keys, { transportFactory: guard => async (url, init) => { guard(); return sent(url, init); } });
  return { db, keys, sent, registry, settings: new ProviderSettingsService(db, keys, registry), resolve: vi.spyOn(keys, 'resolveKey') };
}
const request = { requestId: 'request', modelId: 'old-model', outputTokenLimit: 8, messages: [{ role: 'user' as const, content: 'hello' }] };
const collect = async (stream: AsyncIterable<{ type: string }>) => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; };

describe('D143 a service is saved only as the catalog has it', () => {
  it.each([
    'https://other.example/v1', 'https://api.deepseek.com.example.com', 'https://evil-api.deepseek.com', 'https://sub.api.deepseek.com', 'https://api.deepseek.com/v1',
    'https://api.deepseek.com.', 'https://api.deepseek.com:8443', 'http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'https://1.2.3.4/v1', 'https://16909060/v1', 'https://[2606:4700:4700::1111]/v1',
  ])('refuses %s', async baseUrl => {
    const { db, settings } = fixture();
    await expect(settings.createProvider({ name: 'Outside', kind: 'compatible', baseUrl })).rejects.toMatchObject({ code: expect.stringMatching(/^(service_unsupported|invalid_input)$/u) });
    expect(db.listProviderSummaries()).toEqual([]);
  });
  it('refuses an address with an account in it', async () => {
    await expect(fixture().settings.createProvider({ name: 'Outside', kind: 'compatible', baseUrl: 'https://user:pass@api.deepseek.com' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
  it('refuses a model the service does not have, as the default or in the list', async () => {
    const { db, settings } = fixture();
    await expect(settings.createProvider({ name: 'D', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'old-model' })).rejects.toMatchObject({ code: 'model_unsupported' });
    await expect(settings.createProvider({ name: 'D', kind: 'compatible', baseUrl: 'https://api.deepseek.com', customModels: [{ id: 'old-model', name: 'x' }] })).rejects.toMatchObject({ code: 'model_unsupported' });
    await expect(settings.createProvider({ name: 'D', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'kimi-k3' })).rejects.toMatchObject({ code: 'model_unsupported' });
    expect(db.listProviderSummaries()).toEqual([]);
  });
  it.each(serviceCatalog.map(service => [service.id, service] as const))('%s: every model can be saved and sends its own ID to the catalog address', async (_id, service) => {
    const { settings, sent } = fixture();
    for (const model of service.models) {
      const saved = await settings.createProvider({ name: service.name, kind: 'compatible', baseUrl: service.baseUrl, defaultModelId: model.id });
      const shown = await settings.getProviderConfiguration({ id: saved.id });
      expect(shown.defaultModelId).toBe(model.id);
      expect(catalogServiceAt(serviceCatalog, shown.baseUrl)).toBe(service);
      await settings.setKey({ providerId: saved.id, apiKey: 'owned-fake-key' });
      sent.mockClear();
      expect(await settings.testConnection({ providerId: saved.id, level: 'generation', modelId: model.id, allowGeneration: true })).toMatchObject({ result: { ok: true } });
      const [url, init] = sent.mock.calls[0]!;
      expect(String(url)).toBe(`${service.baseUrl}/chat/completions`);
      expect(JSON.parse(String(init!.body))).toMatchObject({ model: model.id });
    }
  });
  it('lists models once each, with a short note that says nothing about price', () => {
    for (const service of serviceCatalog) {
      expect(new Set(service.models.map(model => model.id)).size).toBe(service.models.length);
      for (const model of service.models) {
        expect(model.note, model.id).toBeTruthy();
        expect(model.note).not.toMatch(/价格|便宜|免费|成本|元|¥/u);
      }
    }
  });
  it('a model the catalog knows is short keeps that limit, unless the host sets another', async () => {
    const { settings, registry } = fixture();
    const saved = await settings.createProvider({ name: '通义千问', kind: 'compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModelId: 'qwen-max' });
    expect(registry.budget(saved.id, 'qwen-max').contextWindowTokens).toBe(32000);
    expect(registry.budget(saved.id, 'qwen3.7-plus').contextWindowTokens).toBe(128000);
    const { keyReference: _key, createdAt: _created, updatedAt: _updated, ...input } = await settings.getProviderConfiguration({ id: saved.id });
    await settings.updateProvider({ ...input, customModels: input.customModels.map(model => model.id === 'qwen-max' ? { ...model, contextWindowTokens: 16000, maxOutputTokens: 4000 } : model) });
    expect(registry.budget(saved.id, 'qwen-max').contextWindowTokens).toBe(16000);
  });
  it('keeps a saved service from moving outside the catalog, and its Key where it was', async () => {
    const { settings, keys } = fixture();
    const provider = await settings.createProvider({ name: 'D', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash' });
    const key = await settings.setKey({ providerId: provider.id, apiKey: 'owned-fake-key' });
    const { keyReference: _key, createdAt: _created, updatedAt: _updated, ...input } = await settings.getProviderConfiguration({ id: provider.id });
    await expect(settings.updateProvider({ ...input, baseUrl: 'https://other.example/v1', customModels: [], defaultModelId: null })).rejects.toMatchObject({ code: 'service_unsupported' });
    await expect(settings.updateProvider({ ...input, defaultModelId: 'old-model' })).rejects.toMatchObject({ code: 'model_unsupported' });
    expect(await keys.resolveKey(provider.id, key.keyReference!)).toBe('owned-fake-key');
  });
  it('shows the catalog models, not what was stored, and keeps the limits the host set', async () => {
    const { db, settings } = fixture();
    db.createProvider({ id: 'p', name: 'D', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'old-model', customModels: [{ id: 'old-model', name: 'old' }, { id: 'deepseek-flash', name: 'mine', maxOutputTokens: 100, contextWindowTokens: 2000 }] });
    const shown = await settings.getProviderConfiguration({ id: 'p' });
    expect(shown.defaultModelId).toBeNull();
    expect(shown.customModels.map(model => model.id)).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
    expect(shown.customModels[0]).toMatchObject({ name: 'DeepSeek Flash', maxOutputTokens: 100, contextWindowTokens: 2000 });
  });
});

describe('D143 a row an older version left behind sends nothing', () => {
  async function leftover(enabled = false) {
    const value = fixture();
    value.db.createProvider({ id: 'old', name: '旧服务', kind: 'compatible', baseUrl: 'https://other.example/v1', enabled, defaultModelId: 'old-model', customModels: [{ id: 'old-model', name: 'old' }] });
    const reference = await value.keys.storeKey('old', 'owned-old-key');
    value.resolve.mockClear();
    return { ...value, reference };
  }
  it.each([false, true])('refuses before reading the Key or sending (enabled: %s)', async enabled => {
    const { registry, settings, sent, resolve } = await leftover(enabled);
    expect(() => registry.assertSelection('old', 'old-model')).toThrowError(expect.objectContaining({ code: 'service_unsupported' }));
    expect(() => registry.checkGeneration('old', request)).toThrowError(expect.objectContaining({ code: 'service_unsupported' }));
    expect(() => registry.getAdapter('old', 'old-model')).toThrowError(expect.objectContaining({ code: enabled ? 'service_unsupported' : 'invalid_state' }));
    await expect(settings.setKey({ providerId: 'old', apiKey: 'owned-new-key' })).rejects.toMatchObject({ code: 'service_unsupported' });
    if (enabled) expect(await settings.testConnection({ providerId: 'old', level: 'generation', modelId: 'old-model', allowGeneration: true })).toMatchObject({ result: { ok: false, error: { code: 'service_unsupported' } } });
    expect(resolve).not.toHaveBeenCalled(); expect(sent).not.toHaveBeenCalled();
  });
  it('stays visible as unsupported, may keep its name, and goes no further', async () => {
    const { settings, db } = await leftover();
    const [row] = await settings.listModelReadiness();
    expect(row).toMatchObject({ providerId: 'old', supported: false, models: [{ modelId: 'old-model', usable: false, blockedBy: 'disabled' }] });
    const { keyReference: _key, createdAt: _created, updatedAt: _updated, ...input } = await settings.getProviderConfiguration({ id: 'old' });
    await expect(settings.updateProvider({ ...input, name: '改名' })).resolves.toMatchObject({ name: '改名', enabled: false });
    await expect(settings.updateProvider({ ...input, enabled: true })).rejects.toMatchObject({ code: 'service_unsupported' });
    await expect(settings.updateProvider({ ...input, baseUrl: 'https://another.example/v1' })).rejects.toMatchObject({ code: 'service_unsupported' });
    await expect(settings.updateProvider({ ...input, defaultModelId: null })).rejects.toMatchObject({ code: 'service_unsupported' });
    expect(db.getProviderConfiguration('old')).toMatchObject({ enabled: false, baseUrl: 'https://other.example/v1', defaultModelId: 'old-model' });
  });
  it('can be removed with its Key; one with history keeps its name and loses only the Key', async () => {
    const { settings, db, keys, reference } = await leftover();
    db.createRoom({ id: 'r', name: 'R' });
    db.insertRun({ id: 'history', roomId: 'r', status: 'completed', workflowSnapshot: {}, membersSnapshot: [{ agentId: 'a', displayName: 'A', roleTemplateId: 'draft', systemPrompt: '', providerId: 'old', modelId: 'old-model', displayOrder: 0 }] });
    await expect(settings.deleteProvider({ id: 'old' })).rejects.toMatchObject({ code: 'invalid_state' });
    await settings.deleteKey({ providerId: 'old' });
    expect(await keys.resolveKey('old', reference)).toBeUndefined();
    expect(db.listProviderSummaries()[0]).toMatchObject({ name: '旧服务' });
    const free = await leftover();
    await free.settings.deleteProvider({ id: 'old' });
    expect(free.db.listProviderSummaries()).toEqual([]);
    expect(free.db.rawKeyRecord(free.reference.id)).toBeUndefined();
  });
});

describe('D143 a member outside the catalog is told to change model when a discussion starts', () => {
  async function room(providerId: string, modelId: string) {
    const value = fixture();
    value.db.createProvider({ id: 'ds', name: 'DeepSeek', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash' });
    value.db.createProvider({ id: 'old', name: '旧服务', kind: 'compatible', baseUrl: 'https://other.example/v1', enabled: false, customModels: [{ id: 'old-model', name: 'old' }] });
    await value.keys.storeKey('ds', 'owned-fake-key');
    value.resolve.mockClear();
    value.db.createRoom({ id: 'r', name: 'R' });
    value.db.createAgent({ id: 'a', roomId: 'r', displayName: 'A', roleTemplateId: 'draft', providerId, modelId });
    const run = new RunService(value.db, new MockProvider(), () => [{ role: 'user', content: 'x' }], value.registry);
    return { ...value, run };
  }
  it.each([['ds', 'old-model', 'model_unsupported'], ['old', 'old-model', 'service_unsupported']])('%s / %s: %s', async (providerId, modelId, code) => {
    const { run, sent, resolve } = await room(providerId, modelId);
    try {
      await expect(run.start({ roomId: 'r', task: 't', workflowSnapshot: {}, maxTurns: 1, outputTokenLimit: 8 })).rejects.toMatchObject({ code });
      expect(resolve).not.toHaveBeenCalled(); expect(sent).not.toHaveBeenCalled();
    } finally { await run.shutdown(); }
  });
});

describe('D143 nothing changes a model behind the host', () => {
  it('changing the default leaves existing members alone, and only a new choice uses it', async () => {
    const { db, settings } = fixture();
    const provider = await settings.createProvider({ name: 'Kimi', kind: 'compatible', baseUrl: 'https://api.moonshot.cn/v1', defaultModelId: 'kimi-k3.1-pro' });
    db.createRoom({ id: 'r', name: 'R' });
    db.createAgent({ id: 'a', roomId: 'r', displayName: 'A', roleTemplateId: 'draft', providerId: provider.id, modelId: 'kimi-k3.1-pro' });
    const { keyReference: _key, createdAt: _created, updatedAt: _updated, ...input } = await settings.getProviderConfiguration({ id: provider.id });
    await settings.updateProvider({ ...input, defaultModelId: 'kimi-k3' });
    expect((await settings.getProviderConfiguration({ id: provider.id })).defaultModelId).toBe('kimi-k3');
    expect(db.getAgentConfiguration('a')?.modelId).toBe('kimi-k3.1-pro');
  });
  it('a retired model stays on the member, and neither saving nor starting replaces it', async () => {
    const { db, settings, keys, registry, sent } = fixture();
    db.createProvider({ id: 'ds', name: 'DeepSeek', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'gone-model', customModels: [{ id: 'gone-model', name: 'gone' }] });
    await keys.storeKey('ds', 'owned-fake-key');
    db.createRoom({ id: 'r', name: 'R' });
    db.createAgent({ id: 'a', roomId: 'r', displayName: 'A', roleTemplateId: 'draft', providerId: 'ds', modelId: 'gone-model' });
    const run = new RunService(db, new MockProvider(), () => [{ role: 'user', content: 'x' }], registry);
    try {
      await expect(run.start({ roomId: 'r', task: 't', workflowSnapshot: {}, maxTurns: 1, outputTokenLimit: 8 })).rejects.toMatchObject({ code: 'model_unsupported' });
      const { keyReference: _key, createdAt: _created, updatedAt: _updated, ...input } = await settings.getProviderConfiguration({ id: 'ds' });
      // The page shows no default rather than picking one.
      expect(input.defaultModelId).toBeNull();
      await settings.updateProvider({ ...input, name: '改名' });
      expect(db.getAgentConfiguration('a')?.modelId).toBe('gone-model');
      await expect(run.start({ roomId: 'r', task: 't', workflowSnapshot: {}, maxTurns: 1, outputTokenLimit: 8 })).rejects.toMatchObject({ code: 'model_unsupported' });
      expect(sent).not.toHaveBeenCalled();
    } finally { await run.shutdown(); }
  });
});

describe('D143 the production entry takes no other catalog', () => {
  it('uses the built-in catalog when none is passed', () => {
    const { db, keys } = fixture();
    const registry = new ProviderRegistry(db, keys);
    expect(registry.catalog()).toBe(serviceCatalog);
    expect([...serviceCatalog.map(service => new URL(service.baseUrl).host)].every(host => registry.transportHosts().has(host))).toBe(true);
    expect(registry.transportHosts().has('127.0.0.1:1234')).toBe(false);
  });
  it('has no setting or variable that opens it', () => {
    for (const file of ['src/main/providers/ProviderRegistry.ts', 'src/main/providers/network.ts', 'src/shared/serviceCatalog.ts', 'src/main/settings/ProviderSettingsService.ts'])
      expect(readFileSync(file, 'utf8')).not.toMatch(/process\.env|import\.meta\.env|\bargv\b/u);
    const main = readFileSync('src/main/index.ts', 'utf8');
    expect(main).toMatch(/new ProviderRegistry\([^)]*\)/u);
    expect(main).not.toMatch(/catalog\s*:/u);
  });
  it('lists eight services, each with https, its own host and at least one model', () => {
    expect(serviceCatalog.map(service => service.id)).toEqual(['deepseek', 'doubao', 'qwen', 'kimi', 'glm', 'ernie', 'hunyuan', 'minimax']);
        for (const service of serviceCatalog) {
      expect(service.baseUrl.startsWith('https://')).toBe(true);
      expect(service.baseUrl.endsWith('/')).toBe(false);
      expect(service.models.length).toBeGreaterThan(0);
    }
  });
});
