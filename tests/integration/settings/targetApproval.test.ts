// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import { KeyService, type KeyStorageBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry, type ApprovedModelPolicy } from '../../../src/main/providers/ProviderRegistry';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';

// A persistent fixture backend: the Key survives a "restart" exactly as the system keychain would keep it.
const backend: KeyStorageBackend = { mode: 'secure', backend: 'fixture', persistent: true,
  async encrypt(value) { return Buffer.from(value).toString('base64'); }, async decrypt(value) { return Buffer.from(value, 'base64').toString(); } };
const policy: ApprovedModelPolicy = {
  evidence: 'owned fixture', outputTokenParameter: 'max_tokens', contextWindowTokens: 100000, maxOutputTokens: 4096,
  counter: { modelId: 'deepseek-flash', method: 'fixture bytes; upper bound', kind: 'upper_bound', countMessages: ms => 32 + ms.reduce((n, m) => n + 16 + Buffer.byteLength(m.content), 0) },
  price: { currency: 'CNY', inputMicroCnyPerToken: 2, outputMicroCnyPerToken: 8, maxRequestMicroCny: 50000, reviewedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2999-01-01T00:00:00.000Z', evidence: 'owned fixture price' },
};
const directories: string[] = []; const open: Database[] = [];
afterEach(() => { for (const db of open.splice(0)) db.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function launch(path: string) {
  const db = new Database(path); db.initialize(); open.push(db);
  const keys = new KeyService(db, backend);
  const registry = new ProviderRegistry(db, keys, { transportFactory: () => async () => { throw new Error('no network in this test'); },
    policyResolver: (configuration, modelId) => configuration.kind === 'openai-compatible' && modelId === 'deepseek-flash' ? policy : undefined,
    capabilitiesResolver: () => ({ outputTokenParameter: 'max_tokens', streamUsage: true, listModels: false, authentication: 'unsupported' }) });
  return { db, keys, registry, settings: new ProviderSettingsService(db, keys, registry) };
}
const close = (db: Database) => { db.close(); open.splice(open.indexOf(db), 1); };

it('D113 remembers a confirmed target across a restart and voids it on a new Key, target or kind', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'r16-approval-')); directories.push(dir); const path = join(dir, 'db.sqlite');
  let app = launch(path);
  const provider = await app.settings.createProvider({ name: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] });
  await app.settings.setKey({ providerId: provider.id, apiKey: 'owned-fake-key' });
  expect(app.registry.isTargetConfirmed(provider.id)).toBe(false);
  await app.settings.confirmTarget({ providerId: provider.id, baseUrl: 'https://api.deepseek.com', confirmed: true });
  expect(() => app.registry.assertSelection(provider.id, 'deepseek-flash')).not.toThrow();
  close(app.db);

  // Restart: no confirmation needed.
  app = launch(path);
  expect(app.registry.isTargetConfirmed(provider.id)).toBe(true);
  expect(await app.settings.getProviderKeyState({ providerId: provider.id })).toMatchObject({ state: 'configured', sessionTargetConfirmed: true });
  expect(() => app.registry.assertSelection(provider.id, 'deepseek-flash')).not.toThrow();

  // A new Key voids it at once, and so does deleting the Key.
  await app.settings.setKey({ providerId: provider.id, apiKey: 'owned-replacement-key' });
  expect(app.registry.isTargetConfirmed(provider.id)).toBe(false);
  expect(() => app.registry.assertSelection(provider.id, 'deepseek-flash')).toThrowError(expect.objectContaining({ code: 'forbidden' }));
  await app.settings.confirmTarget({ providerId: provider.id, baseUrl: 'https://api.deepseek.com', confirmed: true });
  await app.settings.deleteKey({ providerId: provider.id });
  expect(app.registry.isTargetConfirmed(provider.id)).toBe(false);

  // A changed target (which also revokes the Key) voids it.
  await app.settings.setKey({ providerId: provider.id, apiKey: 'owned-fake-key' });
  await app.settings.confirmTarget({ providerId: provider.id, baseUrl: 'https://api.deepseek.com', confirmed: true });
  await app.settings.updateProvider({ id: provider.id, name: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://other.example/v1', defaultModelId: 'deepseek-flash', customModels: [] });
  expect(app.registry.isTargetConfirmed(provider.id)).toBe(false);
  expect(app.db.getTargetApproval(provider.id)).toBeUndefined();
  close(app.db);

  // A remembered row for a stale Key revision authorizes nothing, even when written straight into the database.
  const raw = new Sqlite(path);
  raw.prepare("INSERT INTO provider_target_approvals(provider_id,kind,base_url,key_revision,confirmed_at) VALUES(?,?,?,?,?)").run(provider.id, 'openai-compatible', 'https://other.example/v1', 'stale-revision', new Date().toISOString());
  raw.close();
  app = launch(path);
  expect(app.registry.isTargetConfirmed(provider.id)).toBe(false);
  await app.settings.deleteProvider({ id: provider.id });
  expect(app.db.getTargetApproval(provider.id)).toBeUndefined();
});

it('D113 refuses an approval for Mock or for another kind, and recovery validation rejects a mismatched row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'r16-approval-')); directories.push(dir); const path = join(dir, 'db.sqlite');
  const app = launch(path);
  const mock = await app.settings.createProvider({ name: 'Mock', kind: 'mock', defaultModelId: 'mock' });
  expect(() => app.db.saveTargetApproval(mock.id, { kind: 'mock', baseUrl: 'x', revision: app.db.getProviderKeyRevision(mock.id) })).toThrowError(expect.objectContaining({ code: 'invalid_state' }));
  const real = await app.settings.createProvider({ name: 'OpenAI', kind: 'openai' });
  expect(() => app.db.saveTargetApproval(real.id, { kind: 'gemini', baseUrl: 'https://api.openai.com/v1', revision: app.db.getProviderKeyRevision(real.id) })).toThrowError(expect.objectContaining({ code: 'invalid_state' }));
  close(app.db);
  const raw = new Sqlite(path);
  raw.prepare("INSERT INTO provider_target_approvals(provider_id,kind,base_url,key_revision,confirmed_at) VALUES(?,?,?,?,?)").run(real.id, 'gemini', 'https://x.example', 'r', new Date().toISOString());
  expect(() => validateDatabase(raw)).toThrow(/target approval/u);
  raw.close();
});

it('D114 says, per model, the first reason Main would refuse a send now', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'r16-readiness-')); directories.push(dir);
  const app = launch(join(dir, 'db.sqlite'));
  const deepseek = await app.settings.createProvider({ name: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }, { id: 'deepseek-pro', name: 'DeepSeek Pro' }] });
  const openai = await app.settings.createProvider({ name: 'OpenAI', kind: 'openai', defaultModelId: 'gpt-4o-mini' });
  const mock = await app.settings.createProvider({ name: '演示', kind: 'mock', defaultModelId: 'mock' });
  const read = async (id: string) => (await app.settings.listModelReadiness()).find(row => row.providerId === id)!;
  expect(await read(deepseek.id)).toMatchObject({ keyState: 'missing', targetConfirmed: false, models: [
    { modelId: 'deepseek-flash', price: 'reviewed', priceReviewedAt: '2026-01-01T00:00:00.000Z', usable: false, blockedBy: 'key' },
    { modelId: 'deepseek-pro', price: 'unreviewed', usable: false, blockedBy: 'price' }] });
  await app.settings.setKey({ providerId: deepseek.id, apiKey: 'owned-fake-key' });
  expect((await read(deepseek.id)).models[0]).toMatchObject({ blockedBy: 'target' });
  await app.settings.confirmTarget({ providerId: deepseek.id, baseUrl: 'https://api.deepseek.com', confirmed: true });
  expect(await read(deepseek.id)).toMatchObject({ keyState: 'configured', targetConfirmed: true, confirmedBaseUrl: 'https://api.deepseek.com', models: [{ usable: true, blockedBy: null }, { blockedBy: 'price' }] });
  // An official target whose price nobody reviewed stays unusable even with a Key and a confirmation.
  await app.settings.setKey({ providerId: openai.id, apiKey: 'owned-fake-key' });
  await app.settings.confirmTarget({ providerId: openai.id, baseUrl: 'https://api.openai.com/v1', confirmed: true });
  expect(await read(openai.id)).toMatchObject({ targetConfirmed: true, models: [{ modelId: 'gpt-4o-mini', price: 'unreviewed', usable: false, blockedBy: 'price' }] });
  expect(await read(mock.id)).toMatchObject({ keyState: 'none', models: [{ modelId: 'mock', price: 'free', usable: true, blockedBy: null }] });
  await app.settings.updateProvider({ id: deepseek.id, name: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', enabled: false, defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }, { id: 'deepseek-pro', name: 'DeepSeek Pro' }] });
  expect((await read(deepseek.id)).models[0]).toMatchObject({ usable: false, blockedBy: 'disabled' });
  // Without a runtime registry, readiness is refused rather than guessed.
  await expect(new ProviderSettingsService(app.db, app.keys).listModelReadiness()).rejects.toMatchObject({ code: 'unsupported' });
});
