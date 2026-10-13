import { describe, expect, it } from 'vitest';
import { Database } from '../../src/main/database/Database';
import { KeyService, type KeyStorageBackend } from '../../src/main/security/KeyService';

const secureBackend: KeyStorageBackend = {
  mode: 'secure',
  backend: 'test-keychain',
  persistent: true,
  async encrypt(value) { return `cipher:${Buffer.from(value, 'utf8').toString('base64')}`; },
  async decrypt(value) { return Buffer.from(value.replace('cipher:', ''), 'base64').toString('utf8'); },
};

describe('KeyService', () => {
  it('stores only encrypted data and resolves the key inside the main process', async () => {
    const database = new Database(':memory:');
    database.initialize();
    const service = new KeyService(database, secureBackend);

    const reference = await service.storeKey('provider-1', 'sk-secret');

    expect(reference.id).toBeTruthy();
    expect(database.rawKeyRecord(reference.id)?.encryptedValue).not.toContain('sk-secret');
    expect(await service.resolveKey(reference)).toBe('sk-secret');
    database.close();
  });

  it('uses session memory when the backend is not persistent', async () => {
    const database = new Database(':memory:');
    database.initialize();
    const memoryBackend: KeyStorageBackend = {
      mode: 'memory',
      backend: 'basic_text',
      persistent: false,
      async encrypt(value) { return value; },
      async decrypt(value) { return value; },
    };
    const service = new KeyService(database, memoryBackend);
    const reference = await service.storeKey('provider-1', 'sk-session');

    expect(database.rawKeyRecord(reference.id)).toBeUndefined();
    expect(await service.resolveKey(reference)).toBe('sk-session');
    database.close();
  });
});
