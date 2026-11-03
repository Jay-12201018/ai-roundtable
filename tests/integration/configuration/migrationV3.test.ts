// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { migration2 } from '../../../src/main/database/migrations/v2';
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import { createVerifiedBackup } from '../../../src/main/database/backup/createVerifiedBackup';
import { prepareRestore } from '../../../src/main/database/recovery/prepareRestore';
const source = execFileSync('git', ['show', '135bf82c6462ade6dd5300717d6f0102ce4a660c:src/main/database/Database.ts'], { encoding: 'utf8' });
const v1 = source.match(/const migrations = \[\s*`([\s\S]*?)`/)![1];
function legacy(version: number) {
  const directory = mkdtempSync(join(tmpdir(), 'roundtable-v3-')); const path = join(directory, 'source.db'); const raw = new Sqlite(path);
  raw.exec(v1); const time = '2026-10-13T00:00:00.000Z';
  raw.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)'); raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(time);
  raw.prepare('INSERT INTO rooms VALUES(?,?,?,?,?)').run('r','Legacy','not the original task',time,time);
  raw.prepare('INSERT INTO agents(id,room_id,display_name,role_template_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('a','r','Original','draft',time,time);
  raw.prepare('INSERT INTO providers(id,name,type,api_key_reference,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('p','Existing','openai','key-ref',time,time);
  raw.prepare('INSERT INTO key_records VALUES(?,?,?,?,?,?)').run('key-ref','p','opaque-ciphertext','fixture',time,time);
  raw.prepare('INSERT INTO workflow_runs(id,room_id,status,workflow_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('run','r','paused','{}',time,time);
  raw.prepare('INSERT INTO messages(id,room_id,run_id,sender_type,sender_name,content,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('m','r','run','agent','Original','partial','streaming',time,time);
  if (version === 2) { raw.exec(migration2); raw.prepare('INSERT INTO schema_migrations VALUES(2,?)').run(time); }
  raw.close(); return { directory, path, dispose() { rmSync(directory, { recursive: true, force: true }); } };
}
describe('shared configuration migration 3', () => {
  it.each([1, 2])('upgrades v%i once, preserving original-version backup, partial output and unknown metadata', async version => {
    const f = legacy(version); const db = new Database(f.path); let raw: Sqlite.Database | undefined;
    try { await db.initialize(); await db.initialize(); raw = new Sqlite(f.path, { readonly: true });
      expect(raw.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all()).toEqual([1,2,3,4,5,6,7,8,9,10,11,12,13,14]);
      expect(db.getRun('run')).toMatchObject({ task: null, membersSnapshot: null, elapsedExecutionMs: null });
      expect(db.getMessage('m')?.content).toBe('partial'); expect(db.rawKeyRecord('key-ref')?.encryptedValue).toBe('opaque-ciphertext');
      expect(db.getProviderConfiguration('p')).toMatchObject({ id: 'p', keyReference: { id: 'key-ref' }, customModels: [], isDefault: false });
      const receipt = raw.prepare('SELECT id,version FROM schema_backups').get() as { id: number; version: number };
      expect(receipt.version).toBe(version); expect(raw.prepare('SELECT COUNT(*) FROM schema_backups').pluck().get()).toBe(1);
      const restored = await db.prepareRegisteredRestore(receipt.id); const candidate = new Sqlite(restored.path, { readonly: true });
      try { expect(validateDatabase(candidate).schemaVersion).toBe(version); expect(candidate.prepare('SELECT content FROM messages').pluck().get()).toBe('partial'); }
      finally { candidate.close(); }
    } finally { raw?.close(); db.close(); f.dispose(); }
  });
  it('rolls back actual v3 DDL failure, preserving original bytes and a recoverable v2 backup', async () => {
    const f = legacy(2); let raw = new Sqlite(f.path);
    raw.exec("CREATE TRIGGER fail_v3 BEFORE INSERT ON schema_migrations WHEN NEW.version=3 BEGIN SELECT RAISE(ABORT,'injected v3 failure'); END"); raw.close();
    const before = readFileSync(f.path); const db = new Database(f.path);
    try { await expect(db.initialize()).rejects.toThrow(/injected v3 failure/); db.close(); expect(readFileSync(f.path)).toEqual(before);
      raw = new Sqlite(f.path, { readonly: true }); expect(raw.prepare('SELECT version FROM schema_migrations').pluck().all()).toEqual([1,2]);
      expect(raw.prepare("SELECT name FROM pragma_table_info('providers') WHERE name='is_default'").all()).toEqual([]); raw.close();
      const backup = join(f.directory, 'backups', readdirSync(join(f.directory, 'backups')).find(name => name.endsWith('.sqlite3'))!);
      raw = new Sqlite(backup, { readonly: true }); expect(validateDatabase(raw).schemaVersion).toBe(2); expect(raw.prepare('SELECT content FROM messages').pluck().get()).toBe('partial');
    } finally { if (raw.open) raw.close(); db.close(); f.dispose(); }
  });
  it('rejects a claimed v3 ledger with missing columns before changing original bytes', () => {
    const f = legacy(2); const raw = new Sqlite(f.path); raw.prepare('INSERT INTO schema_migrations VALUES(3,?)').run('2026-10-16T00:00:00.000Z'); raw.close();
    const before = readFileSync(f.path); const db = new Database(f.path);
    try { expect(() => db.initialize()).toThrow(/incomplete/i); db.close(); expect(readFileSync(f.path)).toEqual(before); }
    finally { db.close(); f.dispose(); }
  });
  it('preserves the latest WAL text during upgrade with a busy reader', async () => {
    const f = legacy(2); const writer = new Sqlite(f.path, { timeout: 0 }); writer.pragma('journal_mode=WAL'); writer.pragma('wal_autocheckpoint=0');
    const reader = new Sqlite(f.path); reader.exec('BEGIN'); reader.prepare('SELECT content FROM messages').get(); writer.prepare('UPDATE messages SET content=?').run('latest WAL text');
    expect((writer.pragma('wal_checkpoint(TRUNCATE)') as Array<{busy:number}>)[0].busy).toBe(1); const db = new Database(f.path);
    try { await db.initialize(); expect(db.getMessage('m')?.content).toBe('latest WAL text'); const backup = new Sqlite(writer.prepare('SELECT path FROM schema_backups').pluck().get() as string, { readonly: true });
      try { expect(backup.prepare('SELECT content FROM messages').pluck().get()).toBe('latest WAL text'); } finally { backup.close(); }
    } finally { db.close(); reader.exec('ROLLBACK'); reader.close(); writer.close(); f.dispose(); }
  });
  it('restores a verified current backup including v3 archived identity and Provider configuration', async () => {
    const f = legacy(2); const db = new Database(f.path); let raw: Sqlite.Database | undefined;
    try { await db.initialize(); db.archiveAgent('a'); db.createProvider({ id: 'new', name: 'New', kind: 'mock', isDefault: true, defaultModelId: 'mock' }); raw = new Sqlite(f.path);
      const directory = join(f.directory, 'new-backups'); mkdirSync(directory, { mode: 0o700 }); const backup = await createVerifiedBackup(raw, directory); const restored = await prepareRestore(backup, directory);
      const candidate = new Sqlite(restored.path, { readonly: true }); try { expect(validateDatabase(candidate).schemaVersion).toBe(14); expect(candidate.prepare("SELECT archived_at FROM agents WHERE id='a'").pluck().get()).not.toBeNull(); expect(candidate.prepare("SELECT default_model_id FROM providers WHERE id='new'").pluck().get()).toBe('mock'); } finally { candidate.close(); }
    } finally { raw?.close(); db.close(); f.dispose(); }
  });
});

it('keeps legacy partial model selections visible and repairable without pretending they are new valid input', async () => {
  const f = legacy(2); const raw = new Sqlite(f.path); raw.prepare("UPDATE agents SET model_id='mock' WHERE id='a'").run(); raw.close();
  const db = new Database(f.path);
  try { await db.initialize(); expect(db.getAgentConfiguration('a')).toMatchObject({ providerId: null, modelId: 'mock' });
    db.archiveAgent('a'); expect(db.getAgentConfiguration('a')?.archivedAt).not.toBeNull();
    db.updateAgent({ id: 'a', roomId: 'r', displayName: 'Repaired', roleTemplateId: 'draft', providerId: 'p', modelId: 'manual-model' });
    expect(db.getAgentConfiguration('a')).toMatchObject({ providerId: 'p', modelId: 'manual-model' });
  } finally { db.close(); f.dispose(); }
});
