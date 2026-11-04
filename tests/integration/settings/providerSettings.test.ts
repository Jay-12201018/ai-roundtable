// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend, type KeyStorageBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';
import { testCatalog } from '../../fixtures/testCatalog';
import { providerSettingsContracts } from '../../../src/shared/contracts/configuration';
import type { ProviderConfiguration, ProviderInput } from '../../../src/shared/contracts/configuration';

const databases: Database[] = [];
const directories: string[] = [];
const secure: KeyStorageBackend = { mode: 'secure', backend: 'fixture', persistent: true,
  async encrypt(value) { return Buffer.from(value).toString('base64'); },
  async decrypt(value) { return Buffer.from(value, 'base64').toString(); } };
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  databases.splice(0).forEach(db => db.close());
  directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
});
function fixture(path = ':memory:', backend = secure) {
  const db = new Database(path); db.initialize(); databases.push(db);
  const keys = new KeyService(db, backend);
  const registry = new ProviderRegistry(db, keys, { catalog: testCatalog, transportFactory: () => async () => { throw new Error('no network in this test'); } });
  return { db, keys, service: new ProviderSettingsService(db, keys, registry) };
}
function editable(provider: ProviderConfiguration, patch: Partial<ProviderInput> = {}): ProviderInput {
  const { keyReference: _key, createdAt: _created, updatedAt: _updated, ...input } = provider;
  return { ...input, ...patch };
}

describe('R08 Provider settings service', () => {
  it('implements the shared API with stable generated instance IDs and one enabled default', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T00:00:00.000Z'));
    const { service } = fixture();
    const first = await service.createProvider({ name: 'Office', kind: 'compatible', baseUrl: 'https://service.example/v1', isDefault: true });
    const second = await service.createProvider({ name: 'Personal', kind: 'compatible', baseUrl: 'https://service.example/v1', isDefault: true });
    expect(first.id).not.toBe(second.id); expect(first.id).not.toBe('compatible');
    const expected = [{ id: first.id, isDefault: false }, { id: second.id, isDefault: true }].sort((a, b) => a.id < b.id ? -1 : 1);
    expect(await service.listProviderSummaries()).toMatchObject(expected);
    await service.updateProvider(editable(second, { name: 'Renamed', enabled: false, isDefault: false }));
    expect(await service.getProviderConfiguration({ id: second.id })).toMatchObject({ name: 'Renamed', enabled: false });
    await expect(service.updateProvider(editable(first, { enabled: false, isDefault: true }))).rejects.toMatchObject({ code: 'invalid_input' });
    await service.deleteProvider({ id: second.id });
    await expect(service.getProviderConfiguration({ id: second.id })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('roundtrips Providers, the default model and its limits across database reopening', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'roundtable-r08-settings-')); directories.push(dir);
    const path = join(dir, 'settings.sqlite'); const original = fixture(path);
    const created = await original.service.createProvider({ name: 'Custom', kind: 'compatible', baseUrl: 'https://example.test/v1',
      customModels: [{ id: 'model-a', name: 'A' }], defaultModelId: 'model-a' });
    await original.service.updateProvider(editable(created, { defaultModelId: 'model-b', customModels: [{ id: 'model-b', name: 'B', contextWindowTokens: 2000, maxOutputTokens: 1000 }] }));
    original.db.close(); databases.splice(databases.indexOf(original.db), 1);
    const reopened = await fixture(path).service.getProviderConfiguration({ id: created.id });
    expect(reopened).toMatchObject({ baseUrl: 'https://example.test/v1', defaultModelId: 'model-b' });
    expect(reopened.customModels.find(model => model.id === 'model-b')).toMatchObject({ contextWindowTokens: 2000, maxOutputTokens: 1000 });
  });

  it('does not rewrite existing Agent or frozen Run model references on default changes', async () => {
    const { db, service } = fixture();
    const provider = await service.createProvider({ name: 'Models', kind: 'compatible', baseUrl: 'https://service.example/v1', defaultModelId: 'old-model' });
    db.createRoom({ id: 'r', name: 'Room' });
    db.createAgent({ id: 'a', roomId: 'r', displayName: 'A', roleTemplateId: 'draft', providerId: provider.id, modelId: 'old-model' });
    db.insertRun({ id: 'history', roomId: 'r', status: 'completed', workflowSnapshot: {}, membersSnapshot: [{ agentId: 'a', displayName: 'A', roleTemplateId: 'draft', systemPrompt: '', providerId: provider.id, modelId: 'old-model', displayOrder: 0 }] });
    await service.updateProvider(editable(provider, { defaultModelId: 'new-model' }));
    expect(db.getAgentConfiguration('a')?.modelId).toBe('old-model');
    expect(db.getRun('history')?.membersSnapshot?.[0].modelId).toBe('old-model');
    await expect(service.deleteProvider({ id: provider.id })).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('protects referenced Providers and retains their session Key after rejected deletion', async () => {
    const { db, service, keys } = fixture(':memory:', createMemoryKeyBackend());
    const p = await service.createProvider({ name: 'Referenced', kind: 'compatible', baseUrl: 'https://service.example/v1' });
    const state = await service.setKey({ providerId: p.id, apiKey: 'fixture-r08-session' });
    db.createRoom({ id: 'r', name: 'R' });
    db.createAgent({ id: 'a', roomId: 'r', displayName: 'A', roleTemplateId: 'draft', providerId: p.id, modelId: 'custom' });
    await expect(service.deleteProvider({ id: p.id })).rejects.toMatchObject({ code: 'invalid_state' });
    expect(await keys.resolveKey(p.id, state.keyReference!)).toBe('fixture-r08-session');
    db.deleteAgent('a'); await service.deleteProvider({ id: p.id });
    expect(db.listProviderSummaries()).toEqual([]);
  });

  it('blocks settings and Key mutations while an active Run holds a frozen reference', async () => {
    const { db, service } = fixture(); const p = await service.createProvider({ name: 'Active', kind: 'compatible', baseUrl: 'https://service.example/v1' });
    db.createRoom({ id: 'r', name: 'R' });
    db.insertRun({ id: 'run', roomId: 'r', status: 'paused', workflowSnapshot: {}, membersSnapshot: [{ agentId: 'a', displayName: 'A', roleTemplateId: 'draft', systemPrompt: '', providerId: p.id, modelId: 'custom', displayOrder: 0 }] });
    await expect(service.updateProvider(editable(p, { name: 'Changed' }))).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(service.setKey({ providerId: p.id, apiKey: 'fixture-r08-active' })).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(service.deleteKey({ providerId: p.id })).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('replaces and deletes secure Keys without exposing plaintext through any ordinary DTO', async () => {
    const { db, service, keys } = fixture();
    const p = await service.createProvider({ name: 'Key owner', kind: 'compatible', baseUrl: 'https://service.example/v1' });
    const q = await service.createProvider({ name: 'Other instance', kind: 'compatible', baseUrl: 'https://service.example/v1' });
    const first = await service.setKey({ providerId: p.id, apiKey: 'fixture-r08-first-secret' });
    const second = await service.setKey({ providerId: p.id, apiKey: 'fixture-r08-second-secret' });
    expect(first.state).toBe('configured'); expect(second.state).toBe('configured');
    expect(await keys.resolveKey(p.id, first.keyReference!)).toBeUndefined();
    expect(await keys.resolveKey(q.id, second.keyReference!)).toBeUndefined();
    expect(db.rawKeyRecord(first.keyReference!.id)).toBeUndefined();
    const ordinary = [first, second, await service.getProviderConfiguration({ id: p.id }), await service.listProviderSummaries(), await service.getKeyStorageStatus()];
    expect(JSON.stringify(ordinary)).not.toContain('fixture-r08-');
    for (const [method, output] of [['getProviderKeyState', second], ['getProviderConfiguration', ordinary[2]], ['listProviderSummaries', ordinary[3]]] as const) {
      expect(providerSettingsContracts[method].output.safeParse(output).success).toBe(true);
    }
    await service.deleteKey({ providerId: p.id });
    expect(await service.getProviderKeyState({ providerId: p.id })).toMatchObject({ state: 'missing', keyReference: null });
    expect(await keys.resolveKey(p.id, second.keyReference!)).toBeUndefined();
  });

  it('keeps memory-only Keys out of persisted Provider and key_records', async () => {
    const { db, service } = fixture(':memory:', createMemoryKeyBackend());
    const p = await service.createProvider({ name: 'Session', kind: 'compatible', baseUrl: 'https://service.example/v1' });
    const state = await service.setKey({ providerId: p.id, apiKey: 'fixture-r08-memory' });
    expect(state).toMatchObject({ state: 'session', storage: { persistent: false, mode: 'memory' } });
    expect(db.getProviderConfiguration(p.id)?.keyReference).toBeNull();
    expect(db.rawKeyRecord(state.keyReference!.id)).toBeUndefined();
    const restarted = new ProviderSettingsService(db, new KeyService(db, createMemoryKeyBackend()));
    expect(await restarted.getProviderKeyState({ providerId: p.id })).toMatchObject({ state: 'missing' });
  });

  it('revokes Keys when the endpoint changes, but preserves them on rename', async () => {
    const { service, keys } = fixture();
    const p = await service.createProvider({ name: 'Endpoint', kind: 'compatible', baseUrl: 'https://example.test/v1' });
    const state = await service.setKey({ providerId: p.id, apiKey: 'fixture-r08-target' });
    const renamed = await service.updateProvider(editable(p, { name: 'Renamed' }));
    expect(await keys.resolveKey(p.id, state.keyReference!)).toBe('fixture-r08-target');
    const changed = await service.updateProvider(editable(renamed, { baseUrl: 'https://service.example/v1' }));
    expect(changed.keyReference).toBeNull(); expect(await keys.resolveKey(p.id, state.keyReference!)).toBeUndefined();
    await service.setKey({ providerId: p.id, apiKey: 'fixture-r08-next' });
    expect(await service.getProviderKeyState({ providerId: p.id })).toMatchObject({ state: 'configured' });
  });
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'http://localhost.evil.test/v1', 'http://127.1/v1', 'http://2130706433/v1', 'http://0x7f000001/v1', 'http://[0:0:0:0:0:0:0:1]/v1', 'https://user:pass@example.test', 'https://example.test?key=secret', 'https://example.test/#secret', 'https://example.test\\@localhost/v1', 'https://example.test/\npath'])('rejects unsafe endpoint without echoing it: %s', async baseUrl => {
    await expect(fixture().service.createProvider({ name: 'Unsafe', kind: 'compatible', baseUrl })).rejects.toMatchObject({ code: 'invalid_input', message: 'Invalid request parameters' });
  });

  it('rejects identity injection, duplicate models and invalid explicit Mock/model combinations', async () => {
    const { service } = fixture();
    await expect(service.createProvider({ id: 'chosen', name: 'Invalid', kind: 'compatible', baseUrl: 'https://service.example/v1' } as never)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(service.createProvider({ name: 'Mock', kind: 'mock', defaultModelId: 'real-model' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(service.createProvider({ name: 'Mock', kind: 'mock', customModels: [{ id: 'x', name: 'X' }] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(service.createProvider({ name: 'Dups', kind: 'compatible', baseUrl: 'https://service.example/v1', customModels: [{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }] })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('never echoes secrets in parsing, database or Key backend errors or logs', async () => {
    const { service, db } = fixture(); const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = await service.createProvider({ name: 'P', kind: 'compatible', baseUrl: 'https://service.example/v1' });
    await expect(service.updateProvider({ ...editable(p), apiKey: 'fixture-r08-leak' } as never)).rejects.toMatchObject({ code: 'invalid_input' });
    vi.spyOn(db, 'listProviderSummaries').mockImplementation(() => { throw new Error('fixture-r08-leak'); });
    try { await service.listProviderSummaries(); expect.fail('must fail'); } catch (error) {
      expect(error).toMatchObject({ code: 'internal_error' }); expect(String(error)).not.toContain('fixture-r08-leak');
    }
    expect(logs).not.toHaveBeenCalled();
  });
});

describe('honest test levels', () => {
  it('checks configuration locally without reading a Key; a generation test has to be asked for', async () => {
    const { service, keys } = fixture(); const resolve = vi.spyOn(keys, 'resolveKey');
    const p = await service.createProvider({ name: 'Real', kind: 'compatible', baseUrl: 'https://example.test/v1' });
    expect(await service.testConnection({ providerId: p.id, level: 'configuration' })).toMatchObject({ providerId: p.id, result: { ok: true, level: 'configuration' } });
    expect(await service.testConnection({ providerId: p.id, level: 'generation', modelId: 'custom' })).toMatchObject({ result: { ok: false, level: 'generation', error: { code: 'forbidden' } } });
    expect(resolve).not.toHaveBeenCalled();
  });
  it('returns explicit local Mock results for both levels and rejects invalid model selection', async () => {
    const { service } = fixture(); const p = await service.createProvider({ name: 'Mock', kind: 'mock' });
    for (const level of ['configuration', 'generation'] as const) {
      expect(await service.testConnection({ providerId: p.id, level, modelId: 'mock' })).toMatchObject({ result: { ok: true, level } });
    }
    expect(await service.testConnection({ providerId: p.id, level: 'generation', modelId: 'other' })).toMatchObject({ result: { ok: false, error: { code: 'invalid_input' } } });
    await expect(service.testConnection({ providerId: p.id, level: 'generation' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
  it('exposes unconfigured endpoint, disabled and missing Providers accurately', async () => {
    const { service, db } = fixture();
    await expect(service.createProvider({ name: 'Incomplete', kind: 'compatible' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(service.createProvider({ name: 'Stopped', kind: 'compatible', enabled: false })).rejects.toMatchObject({ code: 'service_unsupported' });
    db.createProvider({ id: 'stopped', name: 'Stopped', kind: 'compatible', enabled: false });
    expect(await service.testConnection({ providerId: 'stopped', level: 'configuration' })).toMatchObject({ result: { ok: false, error: { code: 'invalid_state' } } });
    const disabled = await service.createProvider({ name: 'Disabled', kind: 'mock', enabled: false });
    expect(await service.testConnection({ providerId: disabled.id, level: 'configuration' })).toMatchObject({ result: { ok: false, error: { code: 'invalid_state' } } });
    expect(await service.testConnection({ providerId: 'missing', level: 'configuration' })).toMatchObject({ result: { ok: false, error: { code: 'not_found' } } });
  });
});
