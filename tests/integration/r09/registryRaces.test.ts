// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, type KeyStorageBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { sseReply, testCatalog } from '../../fixtures/testCatalog';

const databases: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); databases.splice(0).forEach(database => database.close()); });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Registry race did not reach its controlled boundary')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}
async function fixture(options: { decrypt?: (call: number) => Promise<void>; prepareTransport?: (guard: () => void) => Promise<void> } = {}) {
  const database = new Database(':memory:'); database.initialize(); databases.push(database);
  database.createProvider({ id: 'p', name: 'Race fixture', kind: 'compatible', baseUrl: 'http://127.0.0.1:12345/v1', customModels: [{ id: 'manual-model', name: 'manual-model' }] });
  let decryptCalls = 0;
  const backend: KeyStorageBackend = {
    mode: 'secure', backend: 'r09-race-fixture-only', persistent: true,
    async encrypt(value) { return Buffer.from(value).toString('base64'); },
    async decrypt(value) { await options.decrypt?.(++decryptCalls); return Buffer.from(value, 'base64').toString(); },
  };
  const keys = new KeyService(database, backend);
  await keys.storeKey('p', 'r09-fake-original');
  const sent = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => sseReply());
  const registry = new ProviderRegistry(database, keys, {
    catalog: testCatalog,
    transportFactory: guard => async (url, init) => { await options.prepareTransport?.(guard); return sent(url, init); },
  });
  const change = (values: { enabled?: boolean; baseUrl?: string }) => {
    const { keyReference: _key, createdAt: _created, updatedAt: _updated, ...input } = database.getProviderConfiguration('p')!;
    database.updateProvider({ ...input, ...values });
  };
  return { database, keys, registry, sent, change };
}
const probe = (value: Awaited<ReturnType<typeof fixture>>, requestId: string) => value.registry.getAdapter('p', 'manual-model').testConnection({ requestId, level: 'generation', modelId: 'manual-model' });

it('has a positive control that really reads a fake Key and reaches the transport', async () => {
  const value = await fixture();
  expect(await probe(value, 'positive')).toMatchObject({ ok: true });
  expect(value.sent).toHaveBeenCalledTimes(1);
  expect(new Headers(value.sent.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer r09-fake-original');
});

it('rejects target/key replacement while current Key state is still pending, before sending to the old target', async () => {
  const value = await fixture(); const entered = deferred(); const release = deferred();
  const getState = value.keys.getProviderKeyState.bind(value.keys);
  vi.spyOn(value.keys, 'getProviderKeyState').mockImplementationOnce(async id => { entered.resolve(); await release.promise; return getState(id); });
  const pending = probe(value, 'late-state');
  try {
    await bounded(entered.promise);
    value.change({ baseUrl: 'http://127.0.0.1:23456/v2' });
    await value.keys.storeKey('p', 'r09-fake-replacement');
  } finally { release.resolve(); }
  const result = await bounded(pending);
  expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  expect(value.sent).not.toHaveBeenCalled();
});

it('rejects a Provider disabled during the actual second Key decryption, before SDK fetch', async () => {
  const entered = deferred(); const release = deferred();
  const value = await fixture({ decrypt: async call => { if (call === 2) { entered.resolve(); await release.promise; } } });
  const pending = probe(value, 'late-decrypt');
  try { await bounded(entered.promise); value.change({ enabled: false }); }
  finally { release.resolve(); }
  const result = await bounded(pending);
  expect(result).toMatchObject({ ok: false, error: { code: 'invalid_state' } });
  expect(value.sent).not.toHaveBeenCalled();
});

it.each(['target', 'key', 'disable'] as const)('rechecks %s revocation after controlled asynchronous transport preparation', async kind => {
  const entered = deferred(); const release = deferred();
  const value = await fixture({ prepareTransport: async guard => { entered.resolve(); await release.promise; guard(); } });
  const pending = probe(value, `late-transport-${kind}`);
  try {
    await bounded(entered.promise);
    if (kind === 'target') value.change({ baseUrl: 'http://127.0.0.1:23456/v2' });
    else if (kind === 'key') await value.keys.storeKey('p', 'r09-fake-replacement');
    else value.change({ enabled: false });
  } finally { release.resolve(); }
  const result = await bounded(pending);
  expect(result).toMatchObject({ ok: false, error: { code: kind === 'disable' ? 'invalid_state' : 'forbidden' } });
  expect(value.sent).not.toHaveBeenCalled();
});
