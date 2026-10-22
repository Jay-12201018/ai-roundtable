// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';

const opened: Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

it('D097 reports Main\'s own session target confirmation, voided by a new Key or a changed target', async () => {
  const db = new Database(':memory:'); db.initialize(); opened.push(db);
  const keys = new KeyService(db, createMemoryKeyBackend());
  const registry = new ProviderRegistry(db, keys, { transportFactory: () => async () => { throw new Error('no network in this test'); } });
  const settings = new ProviderSettingsService(db, keys, registry);
  await settings.createProvider({ name: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash' });
  const providerId = db.listProviderSummaries()[0].id;
  await settings.setKey({ providerId, apiKey: 'owned-fake-key' });
  expect(await settings.getProviderKeyState({ providerId })).toMatchObject({ state: 'session', sessionTargetConfirmed: false });
  await settings.confirmTarget({ providerId, baseUrl: 'https://api.deepseek.com', confirmed: true });
  expect(await settings.getProviderKeyState({ providerId })).toMatchObject({ sessionTargetConfirmed: true });
  await settings.setKey({ providerId, apiKey: 'replacement-fake-key' });
  expect(await settings.getProviderKeyState({ providerId })).toMatchObject({ sessionTargetConfirmed: false });
  await settings.confirmTarget({ providerId, baseUrl: 'https://api.deepseek.com', confirmed: true });
  const current = db.getProviderConfiguration(providerId)!;
  await settings.updateProvider({ id: providerId, name: current.name, kind: current.kind, baseUrl: 'https://other.example/v1', enabled: true, isDefault: current.isDefault, defaultModelId: 'deepseek-flash', customModels: [] });
  expect(await settings.getProviderKeyState({ providerId })).toMatchObject({ sessionTargetConfirmed: false });
  // Without a runtime registry the field is simply absent, never a guess.
  expect(await new ProviderSettingsService(db, keys).getProviderKeyState({ providerId })).not.toHaveProperty('sessionTargetConfirmed');
});
