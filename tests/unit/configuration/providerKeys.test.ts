// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend, type KeyStorageBackend } from '../../../src/main/security/KeyService';
const secure: KeyStorageBackend = { mode: 'secure', backend: 'fixture', persistent: true,
  async encrypt(value) { return Buffer.from(value).toString('base64'); },
  async decrypt(value) { return Buffer.from(value, 'base64').toString(); } };
const databases: Database[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
function fixture() {
  const db = new Database(':memory:'); db.initialize(); databases.push(db);
  for (const id of ['p', 'q']) db.createProvider({ id, name: id, kind: 'compatible', baseUrl: 'https://service.example/v1' });
  return db;
}
describe('provider-owned Key lifecycle', () => {
  it('binds references to the owning Provider and revokes the prior reference on replacement/deletion', async () => {
    const db = fixture(); const keys = new KeyService(db, secure);
    const first = await keys.storeKey('p', 'fixture-key-one'); const other = await keys.storeKey('q', 'fixture-key-other');
    expect(await keys.resolveKey('p', other)).toBeUndefined();
    const next = await keys.storeKey('p', 'fixture-key-two');
    expect(await keys.resolveKey('p', first)).toBeUndefined(); expect(db.rawKeyRecord(first.id)).toBeUndefined();
    expect(await keys.resolveKey('p', next)).toBe('fixture-key-two');
    const state = await keys.getProviderKeyState('p');
    expect(state).toMatchObject({ providerId: 'p', state: 'configured', keyReference: next });
    expect(JSON.stringify([state, db.getProviderConfiguration('p'), db.listProviderSummaries()])).not.toContain('fixture-key');
    await keys.deleteKey('p'); expect(await keys.resolveKey('p', next)).toBeUndefined();
    expect(await keys.resolveKey('q', other)).toBe('fixture-key-other'); expect(db.getProviderConfiguration('p')?.keyReference).toBeNull();
  });
  it('keeps session references in memory only, clears old ciphertext, and reports missing after recreation', async () => {
    const db = fixture(); const persistent = new KeyService(db, secure); const old = await persistent.storeKey('p', 'old-secret');
    const keys = new KeyService(db, createMemoryKeyBackend()); const ref = await keys.storeKey('p', 'session-secret');
    expect(db.rawKeyRecord(ref.id)).toBeUndefined(); expect(db.rawKeyRecord(old.id)).toBeUndefined();
    expect(db.getProviderConfiguration('p')?.keyReference).toBeNull();
    expect(await keys.getProviderKeyState('p')).toMatchObject({ state: 'session', keyReference: ref });
    expect(await keys.resolveKey('q', ref)).toBeUndefined();
    expect(await new KeyService(db, createMemoryKeyBackend()).getProviderKeyState('p')).toMatchObject({ state: 'missing', keyReference: null });
    await keys.deleteKey('p'); expect(await keys.resolveKey('p', ref)).toBeUndefined();
  });
  it('preserves the old Key on encryption or database failure and redacts backend errors', async () => {
    const db = fixture(); const keys = new KeyService(db, secure); const old = await keys.storeKey('p', 'old-secret');
    const failing = new KeyService(db, { ...secure, async encrypt() { throw new Error('backend leaked fixture-new-secret'); } });
    await expect(failing.storeKey('p', 'fixture-new-secret')).rejects.toMatchObject({ code: 'internal_error', message: 'Operation failed' });
    expect(await keys.resolveKey('p', old)).toBe('old-secret');
    const mutation = vi.spyOn(db, 'replaceProviderKey').mockImplementation(() => { throw new Error('write failed'); });
    await expect(keys.storeKey('p', 'replacement')).rejects.toMatchObject({ code: 'internal_error' }); mutation.mockRestore();
    expect(await keys.resolveKey('p', old)).toBe('old-secret');
  });
  it('serializes concurrent changes without orphaning intermediate ciphertext', async () => {
    const db = fixture(); const keys = new KeyService(db, secure);
    const [first, second] = await Promise.all([keys.storeKey('p', 'one'), keys.storeKey('p', 'two')]);
    expect(db.rawKeyRecord(first.id)).toBeUndefined(); expect(await keys.resolveKey('p', first)).toBeUndefined();
    expect(await keys.resolveKey('p', second)).toBe('two');
    await keys.deleteKey('p'); expect(db.rawKeyRecord(second.id)).toBeUndefined();
  });
  it('rechecks frozen active Run references after asynchronous encryption', async () => {
    const db = fixture(); db.insertRoom({ id: 'r', name: 'R', objective: 'X' });
    db.insertAgent({ id: 'a', roomId: 'r', displayName: 'A', roleTemplateId: 'draft', displayOrder: 0 });
    let release!: (value: string) => void;
    const keys = new KeyService(db, { ...secure, encrypt: () => new Promise<string>(resolve => { release = resolve; }) });
    const pending = keys.storeKey('p', 'must-not-save'); await Promise.resolve();
    db.insertRun({ id: 'run', roomId: 'r', status: 'paused', workflowSnapshot: {}, task: 'Frozen', membersSnapshot: [{ agentId: 'a', displayName: 'A', roleTemplateId: 'draft', systemPrompt: '', providerId: 'p', modelId: 'model', displayOrder: 0 }] });
    release('cipher'); await expect(pending).rejects.toMatchObject({ code: 'invalid_state' });
    expect(db.getProviderConfiguration('p')?.keyReference).toBeNull();
  });
  it('reports unavailable without leaking decryption errors or attempting a request', async () => {
    const db = fixture(); const keys = new KeyService(db, secure); const ref = await keys.storeKey('p', 'secret');
    const bad = new KeyService(db, { ...secure, async decrypt() { throw new Error('private backend details'); } });
    expect(await bad.getProviderKeyState('p')).toMatchObject({ state: 'unavailable', keyReference: ref });
    await expect(bad.resolveKey('p', ref)).rejects.toMatchObject({ code: 'internal_error', message: 'Operation failed' });
  });
});

it('does not resurrect a session Key when a deleted Provider ID is reused', async () => {
  const db = fixture(); const keys = new KeyService(db, createMemoryKeyBackend()); const reference = await keys.storeKey('p', 'old-session');
  db.deleteProvider('p'); db.createProvider({ id: 'p', name: 'Different instance', kind: 'compatible', baseUrl: 'https://service.example/v1' });
  expect(await keys.resolveKey('p', reference)).toBeUndefined();
  expect(await keys.getProviderKeyState('p')).toMatchObject({ state: 'missing', keyReference: null });
});

it('does not return a revoked Key after a delayed decrypt completes', async () => {
  const db = fixture(); const keys = new KeyService(db, secure); const reference = await keys.storeKey('p', 'secret');
  let release!: (value: string) => void;
  const delayed = new KeyService(db, { ...secure, decrypt: () => new Promise<string>(resolve => { release = resolve; }) });
  const pending = delayed.resolveKey('p', reference); await Promise.resolve(); await keys.deleteKey('p'); release('secret');
  expect(await pending).toBeUndefined();
});

it('rejects a delayed Key write when its Provider target changes and revokes the former target Key', async () => {
  const db = fixture(); const keys = new KeyService(db, secure); const old = await keys.storeKey('p', 'old-key');
  let release!: (value: string) => void;
  const delayed = new KeyService(db, { ...secure, encrypt: () => new Promise<string>(resolve => { release = resolve; }) });
  const pending = delayed.storeKey('p', 'new-key'); await Promise.resolve();
  db.updateProvider({ id: 'p', name: 'New target', kind: 'mock' }); release('cipher');
  await expect(pending).rejects.toMatchObject({ code: 'invalid_state' });
  expect(db.rawKeyRecord(old.id)).toBeUndefined(); expect(db.getProviderConfiguration('p')?.keyReference).toBeNull();
});

it('coordinates Provider deletion without revoking its Key when reference checks reject deletion', async () => {
  const db = fixture(); const keys = new KeyService(db, createMemoryKeyBackend()); const reference = await keys.storeKey('p', 'keep-on-failure');
  db.createRoom({ id: 'r', name: 'R' }); db.createAgent({ id: 'a', roomId: 'r', displayName: 'A', roleTemplateId: 'draft', providerId: 'p', modelId: 'manual' });
  await expect(keys.deleteProvider('p')).rejects.toMatchObject({ code: 'invalid_state' });
  expect(await keys.resolveKey('p', reference)).toBe('keep-on-failure');
  db.deleteAgent('a'); await keys.deleteProvider('p'); expect(db.getProviderConfiguration('p')).toBeUndefined();
});
