// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';

const databases: Database[] = [];
afterEach(() => databases.splice(0).forEach(database => database.close()));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Authentication response did not reach its controlled boundary')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}
async function fixture(delayed = false) {
  const database = new Database(':memory:'); database.initialize(); databases.push(database);
  const baseUrl = 'http://127.0.0.1:12345/v1';
  database.createProvider({ id: 'p', name: 'Authentication race fixture', kind: 'openai-compatible', baseUrl });
  const keys = new KeyService(database, createMemoryKeyBackend());
  await keys.storeKey('p', 'r09-fake-authentication-key');
  const entered = deferred(); const release = deferred();
  const requests: Request[] = [];
  const registry = new ProviderRegistry(database, keys, {
    capabilitiesResolver: () => ({ outputTokenParameter: null, streamUsage: false, listModels: true, authentication: 'models' }),
    transportFactory: guard => async (url, init) => {
      guard(); requests.push(new Request(url, init)); entered.resolve();
      if (delayed) await release.promise;
      return Response.json({ data: [{ id: 'fixture' }] });
    },
  });
  registry.confirmTarget({ providerId: 'p', baseUrl, confirmed: true });
  const change = (values: { enabled?: boolean; baseUrl?: string }) => {
    const { keyReference: _key, createdAt: _created, updatedAt: _updated, ...input } = database.getProviderConfiguration('p')!;
    database.updateProvider({ ...input, ...values });
  };
  return { keys, entered, release, requests, change, service: new ProviderSettingsService(database, keys, registry) };
}

it('authenticates through the real settings, Registry and adapter with a fake Key before any revocation', async () => {
  const value = await fixture();
  expect(await value.service.testConnection({ providerId: 'p', level: 'authentication' })).toMatchObject({ result: { ok: true, level: 'authentication' } });
  expect(value.requests).toHaveLength(1);
  expect(value.requests[0].url).toBe('http://127.0.0.1:12345/v1/models');
  expect(value.requests[0].method).toBe('GET');
  expect(value.requests[0].headers.get('authorization')).toBe('Bearer r09-fake-authentication-key');
});

it.each(['key', 'target', 'disabled'] as const)('rejects a late authentication success after %s revocation', async kind => {
  const value = await fixture(true);
  const pending = value.service.testConnection({ providerId: 'p', level: 'authentication' });
  try {
    await bounded(value.entered.promise);
    if (kind === 'key') await value.keys.storeKey('p', 'r09-fake-replacement-key');
    else if (kind === 'target') value.change({ baseUrl: 'http://127.0.0.1:23456/v2' });
    else value.change({ enabled: false });
  } finally { value.release.resolve(); }
  expect(await bounded(pending)).toMatchObject({ providerId: 'p', result: { ok: false, error: { code: kind === 'disabled' ? 'invalid_state' : 'forbidden' } } });
  expect(value.requests).toHaveLength(1);
});
