// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import { KeyService, type KeyStorageBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';

// A persistent fixture backend: the Key survives a "restart" exactly as the system keychain would keep it.
const backend: KeyStorageBackend = { mode: 'secure', backend: 'fixture', persistent: true,
  async encrypt(value) { return Buffer.from(value).toString('base64'); }, async decrypt(value) { return Buffer.from(value, 'base64').toString(); } };
const directories: string[] = []; const open: Database[] = [];
afterEach(() => { for (const db of open.splice(0)) db.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function launch(path: string) {
  const db = new Database(path); db.initialize(); open.push(db);
  const keys = new KeyService(db, backend);
  const registry = new ProviderRegistry(db, keys, { transportFactory: () => async () => { throw new Error('no network in this test'); } });
  return { db, keys, registry, settings: new ProviderSettingsService(db, keys, registry) };
}
const close = (db: Database) => { db.close(); open.splice(open.indexOf(db), 1); };

it('D114 says, per model, the first reason Main would refuse a send now', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'r16-readiness-')); directories.push(dir);
  const app = launch(join(dir, 'db.sqlite'));
  const deepseek = await app.settings.createProvider({ name: 'DeepSeek', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }, { id: 'deepseek-v4-pro', name: 'DeepSeek Pro' }] });
  const kimi = await app.settings.createProvider({ name: 'Kimi', kind: 'compatible', baseUrl: 'https://api.moonshot.cn/v1', defaultModelId: 'kimi-k3.1-pro' });
  const mock = await app.settings.createProvider({ name: '演示', kind: 'mock', defaultModelId: 'mock' });
  const read = async (id: string) => (await app.settings.listModelReadiness()).find(row => row.providerId === id)!;
  expect(await read(deepseek.id)).toMatchObject({ keyState: 'missing', supported: true, baseUrl: 'https://api.deepseek.com', models: [
    { modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: false, blockedBy: 'key' },
    { modelId: 'deepseek-v4-pro', usable: false, blockedBy: 'key' }] });
  await app.settings.setKey({ providerId: deepseek.id, apiKey: 'owned-fake-key' });
  expect(await read(deepseek.id)).toMatchObject({ keyState: 'configured', baseUrl: 'https://api.deepseek.com', models: [{ usable: true, blockedBy: null }, { usable: true, blockedBy: null }] });
    await app.settings.setKey({ providerId: kimi.id, apiKey: 'owned-fake-key' });
  expect(await read(kimi.id)).toMatchObject({ baseUrl: 'https://api.moonshot.cn/v1', models: [{ modelId: 'kimi-k3.1-pro', usable: true, blockedBy: null }, { modelId: 'kimi-k3.1-pro-highspeed', usable: true }, { modelId: 'kimi-k3', usable: true }] });
  expect(await read(mock.id)).toMatchObject({ keyState: 'none', models: [{ modelId: 'mock', usable: true, blockedBy: null }] });
  await app.settings.updateProvider({ id: deepseek.id, name: 'DeepSeek', kind: 'compatible', baseUrl: 'https://api.deepseek.com', enabled: false, defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }, { id: 'deepseek-v4-pro', name: 'DeepSeek Pro' }] });
  expect((await read(deepseek.id)).models[0]).toMatchObject({ usable: false, blockedBy: 'disabled' });
  // Without a runtime registry, readiness is refused rather than guessed.
  await expect(new ProviderSettingsService(app.db, app.keys).listModelReadiness()).rejects.toMatchObject({ code: 'unsupported' });
});
