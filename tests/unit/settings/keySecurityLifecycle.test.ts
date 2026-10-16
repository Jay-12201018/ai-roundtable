// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, type KeyStorageBackend } from '../../../src/main/security/KeyService';

const secure: KeyStorageBackend = {
  mode: 'secure', backend: 'fixture', persistent: true,
  async encrypt(value) { return Buffer.from(value).toString('base64'); },
  async decrypt(value) { return Buffer.from(value, 'base64').toString(); },
};
const databases: Database[] = [];
afterEach(() => { databases.splice(0).forEach(database => database.close()); vi.restoreAllMocks(); });
function fixture() {
  const database = new Database(':memory:'); database.initialize(); databases.push(database);
  database.createProvider({ id: 'p', name: 'P', kind: 'openai', baseUrl: 'https://one.example/v1' });
  return database;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(release => { resolve = release; });
  return { promise, resolve };
}

describe('Key status consistency after asynchronous decryption', () => {
  it.each(['delete-key', 'change-target', 'recreate-provider'] as const)('returns missing after %s revokes the captured reference', async change => {
    const database = fixture(); const writer = new KeyService(database, secure);
    await writer.storeKey('p', 'fixture-secret');
    const decrypted = deferred<string>(); const started = deferred<void>();
    const reader = new KeyService(database, { ...secure, decrypt: async () => { started.resolve(); return decrypted.promise; } });
    const pending = reader.getProviderKeyState('p'); await started.promise;
    if (change === 'delete-key') await writer.deleteKey('p');
    if (change === 'change-target') database.updateProvider({ id: 'p', name: 'P', kind: 'openai', baseUrl: 'https://two.example/v1' });
    if (change === 'recreate-provider') {
      database.deleteProvider('p'); database.createProvider({ id: 'p', name: 'New P', kind: 'openai' });
    }
    decrypted.resolve('fixture-secret');
    expect(await pending).toMatchObject({ state: 'missing', keyReference: null });
  });

  it('rechecks a replacement reference instead of reporting the revoked reference as unavailable', async () => {
    const database = fixture(); const writer = new KeyService(database, secure);
    await writer.storeKey('p', 'fixture-old');
    const decrypted = deferred<string>(); const started = deferred<void>();
    const decrypt = vi.fn(secure.decrypt).mockImplementationOnce(async () => { started.resolve(); return decrypted.promise; });
    const reader = new KeyService(database, { ...secure, decrypt });
    const pending = reader.getProviderKeyState('p'); await started.promise;
    const reference = await writer.storeKey('p', 'fixture-new'); decrypted.resolve('fixture-old');
    expect(await pending).toMatchObject({ state: 'configured', keyReference: reference });
    expect(decrypt).toHaveBeenCalledTimes(2);
  });

  it('returns not_found if its Provider is deleted during decryption', async () => {
    const database = fixture(); const writer = new KeyService(database, secure);
    await writer.storeKey('p', 'fixture-secret');
    const decrypted = deferred<string>(); const started = deferred<void>();
    const reader = new KeyService(database, { ...secure, decrypt: async () => { started.resolve(); return decrypted.promise; } });
    const pending = reader.getProviderKeyState('p'); await started.promise;
    await writer.deleteProvider('p'); decrypted.resolve('fixture-secret');
    await expect(pending).rejects.toMatchObject({ code: 'not_found', message: 'Requested resource was not found' });
  });
});

describe('queued Key mutations stay bound to their original Provider target', () => {
  it.each(['change-target', 'recreate-provider'] as const)('rejects queued writes after %s even before their encryption starts', async change => {
    const database = fixture(); const encrypted = deferred<string>(); const started = deferred<void>();
    const encrypt = vi.fn(secure.encrypt).mockImplementationOnce(async () => { started.resolve(); return encrypted.promise; });
    const keys = new KeyService(database, { ...secure, encrypt });
    const first = keys.storeKey('p', 'fixture-first'); await started.promise;
    const second = keys.storeKey('p', 'fixture-second');
    if (change === 'change-target') database.updateProvider({ id: 'p', name: 'P', kind: 'openai', baseUrl: 'https://two.example/v1' });
    else { database.deleteProvider('p'); database.createProvider({ id: 'p', name: 'New P', kind: 'openai' }); }
    encrypted.resolve('cipher');
    await expect(first).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(second).rejects.toMatchObject({ code: 'invalid_state' });
    expect(encrypt).toHaveBeenCalledTimes(1);
    expect(await keys.getProviderKeyState('p')).toMatchObject({ state: 'missing', keyReference: null });
  });

  it('does not let a queued deletion delete a recreated Provider', async () => {
    const database = fixture(); const encrypted = deferred<string>(); const started = deferred<void>();
    const keys = new KeyService(database, { ...secure, encrypt: async () => { started.resolve(); return encrypted.promise; } });
    const first = keys.storeKey('p', 'fixture-first'); await started.promise;
    const deletion = keys.deleteProvider('p');
    database.deleteProvider('p'); database.createProvider({ id: 'p', name: 'New P', kind: 'openai' });
    encrypted.resolve('cipher');
    await expect(first).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(deletion).rejects.toMatchObject({ code: 'invalid_state' });
    expect(database.getProviderConfiguration('p')?.name).toBe('New P');
  });
});
