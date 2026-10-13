import { randomUUID } from 'node:crypto';
import type { Database } from '../database/Database';

export type KeyReference = { id: string };

export type KeyStorageStatus = {
  mode: 'secure' | 'memory';
  backend: string;
  persistent: boolean;
  message: string;
};

export type KeyStorageBackend = {
  mode: 'secure' | 'memory';
  backend: string;
  persistent: boolean;
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
};

export class KeyService {
  private readonly memory = new Map<string, string>();

  constructor(private readonly database: Database, private readonly backend: KeyStorageBackend) {}

  async storeKey(providerId: string, plaintext: string): Promise<KeyReference> {
    if (!plaintext) throw new Error('API Key must not be empty');
    const reference = { id: randomUUID() };
    if (this.backend.persistent) {
      const encryptedValue = await this.backend.encrypt(plaintext);
      this.database.storeKeyRecord({ id: reference.id, providerId, encryptedValue, backend: this.backend.backend });
    } else {
      this.memory.set(reference.id, plaintext);
    }
    return reference;
  }

  async resolveKey(reference: KeyReference): Promise<string | undefined> {
    if (!this.backend.persistent) return this.memory.get(reference.id);
    const record = this.database.rawKeyRecord(reference.id);
    return record ? this.backend.decrypt(record.encryptedValue) : undefined;
  }

  async deleteKey(reference: KeyReference): Promise<void> {
    this.memory.delete(reference.id);
    if (this.backend.persistent) this.database.deleteKeyRecord(reference.id);
  }

  async getStatus(): Promise<KeyStorageStatus> {
    return {
      mode: this.backend.mode,
      backend: this.backend.backend,
      persistent: this.backend.persistent,
      message: this.backend.persistent ? '密钥将使用系统安全存储持久化。' : '当前系统没有可靠的安全存储，密钥仅在本次会话有效。',
    };
  }
}

export function createMemoryKeyBackend(): KeyStorageBackend {
  return {
    mode: 'memory',
    backend: 'memory',
    persistent: false,
    async encrypt(value) { return value; },
    async decrypt(value) { return value; },
  };
}
