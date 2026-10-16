import { randomUUID } from 'node:crypto';
import type { Database } from '../database/Database';
import { ContractError } from '../../shared/contracts/errors';
import { keyReferenceSchema, keyStorageStatusSchema, providerKeyStateSchema } from '../../shared/schemas/configuration';
import type { KeyReference, KeyStorageStatus, ProviderKeyState } from '../../shared/contracts/configuration';
export type { KeyReference, KeyStorageStatus } from '../../shared/contracts/configuration';

export type KeyStorageBackend = {
  mode: 'secure' | 'memory'; backend: string; persistent: boolean;
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
};

export class KeyService {
  private readonly memory = new Map<string, { providerId: string; plaintext: string; revision: string }>();
  private readonly sessionReferences = new Map<string, KeyReference>();
  private readonly pending = new Map<string, { tail: Promise<void>; revisions: Set<{ value: string }> }>();

  constructor(private readonly database: Database, private readonly backend: KeyStorageBackend) {}

  private async serialize<T>(providerId: string, work: (revision: string) => Promise<T>): Promise<T> {
    try {
      const revision = { value: this.database.getProviderKeyRevision(providerId) };
      const previous = this.pending.get(providerId);
      const revisions = previous?.revisions ?? new Set<{ value: string }>();
      revisions.add(revision);
      const result = (previous?.tail ?? Promise.resolve()).then(() => {
        if (this.database.getProviderKeyRevision(providerId) !== revision.value) throw new ContractError('invalid_state');
        return work(revision.value);
      });
      const tail = result.then(() => {}, () => {});
      this.pending.set(providerId, { tail, revisions });
      void tail.then(() => {
        if (this.pending.get(providerId)?.tail === tail) this.pending.delete(providerId);
        revisions.delete(revision);
      });
      return await result;
    } catch (error) { throw error instanceof ContractError ? error : new ContractError('internal_error'); }
  }

  private advanceQueuedRevision(providerId: string, previous: string): void {
    const next = this.database.getProviderKeyRevision(providerId);
    // Only our committed Key mutation may advance requests queued for the same target.
    for (const revision of this.pending.get(providerId)?.revisions ?? []) if (revision.value === previous) revision.value = next;
  }

  private clearSession(providerId: string): void {
    for (const [id, value] of this.memory) if (value.providerId === providerId) this.memory.delete(id);
    this.sessionReferences.delete(providerId);
  }

  private provider(providerId: string) {
    const provider = this.database.getProviderConfiguration(providerId);
    if (!provider) throw new ContractError('not_found');
    return provider;
  }

  async storeKey(providerId: string, plaintext: string): Promise<KeyReference> {
    if (typeof plaintext !== 'string' || !plaintext.trim() || plaintext.length > 16384) throw new ContractError('invalid_input');
    return this.serialize(providerId, async revision => {
      try {
        if (this.provider(providerId).kind === 'mock') throw new ContractError('invalid_input');
        this.database.assertProviderMutable(providerId);
        const reference = { id: randomUUID() };
        const encryptedValue = this.backend.persistent ? await this.backend.encrypt(plaintext) : undefined;
        if (encryptedValue !== undefined && !encryptedValue) throw new ContractError('internal_error');
        // Recheck activity after encryption; cipher, current reference and revocation commit together.
        this.database.replaceProviderKey(providerId, encryptedValue === undefined ? null : { id: reference.id, providerId, encryptedValue, backend: this.backend.backend }, revision);
        this.advanceQueuedRevision(providerId, revision);
        this.clearSession(providerId);
        if (!this.backend.persistent) {
          this.memory.set(reference.id, { providerId, plaintext, revision: this.database.getProviderKeyRevision(providerId) });
          this.sessionReferences.set(providerId, reference);
        }
        return reference;
      } catch (error) {
        throw error instanceof ContractError ? error : new ContractError('internal_error');
      }
    });
  }

  async resolveKey(providerId: string, reference: KeyReference): Promise<string | undefined> {
    if (!keyReferenceSchema.safeParse(reference).success) throw new ContractError('invalid_input');
    const provider = this.provider(providerId);
    const session = this.sessionReferences.get(providerId);
    if (provider.keyReference === null && session?.id === reference.id) {
      const stored = this.memory.get(reference.id);
      return stored?.providerId === providerId && stored.revision === this.database.getProviderKeyRevision(providerId) ? stored.plaintext : undefined;
    }
    if (!this.backend.persistent || provider.keyReference?.id !== reference.id) return;
    const record = this.database.rawKeyRecord(reference.id);
    if (!record || record.providerId !== providerId || record.backend !== this.backend.backend) return;
    const revision = this.database.getProviderKeyRevision(providerId);
    try {
      const plaintext = await this.backend.decrypt(record.encryptedValue);
      const current = this.database.getProviderConfiguration(providerId);
      return current?.keyReference?.id === reference.id && revision === this.database.getProviderKeyRevision(providerId) ? plaintext : undefined;
    }
    catch { throw new ContractError('internal_error'); }
  }

  async deleteKey(providerId: string): Promise<void> {
    return this.serialize(providerId, async revision => {
      try { this.database.replaceProviderKey(providerId, null, revision); this.advanceQueuedRevision(providerId, revision); this.clearSession(providerId); }
      catch (error) { throw error instanceof ContractError ? error : new ContractError('internal_error'); }
    });
  }

  async deleteProvider(providerId: string): Promise<void> {
    return this.serialize(providerId, async () => {
      try { this.database.deleteProvider(providerId); this.clearSession(providerId); }
      catch (error) { throw error instanceof ContractError ? error : new ContractError('internal_error'); }
    });
  }

  async getProviderKeyState(providerId: string): Promise<ProviderKeyState> {
    const storage = await this.getStatus();
    for (;;) {
      const provider = this.provider(providerId);
      const revision = this.database.getProviderKeyRevision(providerId);
      const session = this.sessionReferences.get(providerId);
      if (session && this.memory.get(session.id)?.revision !== revision) this.clearSession(providerId);
      const keyReference = provider.keyReference ?? this.sessionReferences.get(providerId) ?? null;
      let state: ProviderKeyState['state'] = 'missing';
      if (keyReference) {
        state = 'unavailable';
        try { if (await this.resolveKey(providerId, keyReference)) state = this.backend.persistent ? 'configured' : 'session'; }
        catch { /* A failed backend is public unavailability, never a backend error or secret. */ }
      }
      if (this.database.getProviderKeyRevision(providerId) !== revision) continue;
      return providerKeyStateSchema.parse({ providerId, keyReference, state, storage });
    }
  }

  async getStatus(): Promise<KeyStorageStatus> {
    return keyStorageStatusSchema.parse({ mode: this.backend.mode, backend: this.backend.backend, persistent: this.backend.persistent,
      message: this.backend.persistent ? '密钥将使用系统安全存储持久化。' : '当前系统没有可靠的安全存储，密钥仅在本次会话有效。' });
  }
}

export function createMemoryKeyBackend(): KeyStorageBackend {
  return { mode: 'memory', backend: 'memory', persistent: false, async encrypt(value) { return value; }, async decrypt(value) { return value; } };
}
