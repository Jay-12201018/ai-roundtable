// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { migration2 } from '../../../src/main/database/migrations/v2';
import { migration3 } from '../../../src/main/database/migrations/v3';
import { createVerifiedBackup } from '../../../src/main/database/backup/createVerifiedBackup';
import { prepareRestore } from '../../../src/main/database/recovery/prepareRestore';
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import type { TrialRecord } from '../../../src/main/providers/controlledTrial/record';

const baseline = execFileSync('git', ['show', '135bf82c6462ade6dd5300717d6f0102ce4a660c:src/main/database/Database.ts'], { encoding: 'utf8' });
const migration1 = baseline.match(/const migrations = \[\s*`([\s\S]*?)`/)![1];
const timestamp = '2026-10-18T00:00:00.000Z';

function legacyV3() {
  const directory = mkdtempSync(join(tmpdir(), 'roundtable-trial-migration-v4-'));
  const path = join(directory, 'owned.db');
  const raw = new Sqlite(path);
  raw.exec(migration1);
  raw.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)');
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(timestamp);
  raw.prepare('INSERT INTO rooms VALUES(?,?,?,?,?)').run('room', 'Preserved room', 'not the original Run task', timestamp, timestamp);
  raw.prepare('INSERT INTO agents(id,room_id,display_name,role_template_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('agent', 'room', 'Historical author', 'draft', timestamp, timestamp);
  raw.prepare('INSERT INTO workflow_runs(id,room_id,status,workflow_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('run', 'room', 'paused', '{}', timestamp, timestamp);
  raw.prepare('INSERT INTO turns(id,run_id,agent_id,status,request_id,turn_index,partial_content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('turn', 'run', 'agent', 'running', 'historical-request', 0, 'historical partial', timestamp, timestamp);
  raw.prepare('INSERT INTO messages(id,room_id,run_id,turn_id,sender_type,sender_name,content,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('message', 'room', 'run', 'turn', 'agent', 'Historical author', 'historical partial', 'streaming', timestamp, timestamp);
  raw.exec(migration2); raw.prepare('INSERT INTO schema_migrations VALUES(2,?)').run(timestamp);
  raw.exec(migration3); raw.prepare('INSERT INTO schema_migrations VALUES(3,?)').run(timestamp);
  expect(validateDatabase(raw).schemaVersion).toBe(3);
  raw.close();
  return { directory, path, dispose: () => rmSync(directory, { recursive: true, force: true }) };
}

function reservation(suffix = 'one'): TrialRecord {
  return {
    id: 'trial-' + suffix, requestId: 'request-' + suffix, providerId: 'provider',
    modelId: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', prompt: 'Reply OK.', keyRevision: 'revision',
    createdAt: timestamp, priceReviewedAt: timestamp, priceExpiresAt: '2026-10-19T00:00:00.000Z',
    inputMicroCnyPerToken: 2, outputMicroCnyPerToken: 8, priceEvidence: 'owned local migration fixture; not a live price approval',
    estimatedInputTokens: 40, estimatedMicroCny: 1104, reservedMicroCny: 50000, maxOutputTokens: 128,
    state: 'reserved', outcome: 'running', actualInputTokens: null, actualOutputTokens: null, observedUsage: null,
    accountedMicroCny: null, text: '', errorCode: null,
  };
}

describe('controlled trial migration 4 and durable unknown charges', () => {
  it('upgrades a genuine v3 file once, cataloging a v3 backup and preserving unknown historical metadata', async () => {
    const f = legacyV3(); let database = new Database(f.path); let raw: Sqlite.Database | undefined;
    try {
      await database.initialize(); await database.initialize();
      expect(database.getRun('run')).toMatchObject({ task: null, membersSnapshot: null, elapsedExecutionMs: null });
      expect(database.getAttempt('historical-request')).toMatchObject({ inputSnapshot: null, createdAt: null });
      expect(database.getMessage('message')?.content).toBe('historical partial');
      expect(database.listControlledTrials()).toEqual([]);
      raw = new Sqlite(f.path, { readonly: true });
      const versions = raw.prepare('SELECT version,applied_at FROM schema_migrations ORDER BY version').all();
      expect(versions).toEqual([1, 2, 3, 4, 5, 6].map(version => ({ version, applied_at: expect.any(String) })));
      const receipt = raw.prepare('SELECT id,version FROM schema_backups').get() as { id: number; version: number };
      expect(receipt.version).toBe(3);
      const restored = await database.prepareRegisteredRestore(receipt.id);
      const candidate = new Sqlite(restored.path, { readonly: true });
      try {
        expect(validateDatabase(candidate).schemaVersion).toBe(3);
        expect(candidate.prepare("SELECT name FROM sqlite_schema WHERE name='controlled_trials'").all()).toEqual([]);
        expect(candidate.prepare('SELECT content FROM messages').pluck().get()).toBe('historical partial');
      } finally { candidate.close(); }
      raw.close(); raw = undefined; database.close(); database = new Database(f.path);
      await database.initialize(); await database.initialize();
      raw = new Sqlite(f.path, { readonly: true });
      expect(raw.prepare('SELECT version,applied_at FROM schema_migrations ORDER BY version').all()).toEqual(versions);
      expect(raw.prepare('SELECT COUNT(*) FROM schema_backups').pluck().get()).toBe(1);
      expect(validateDatabase(raw).schemaVersion).toBe(6);
    } finally { raw?.close(); database.close(); f.dispose(); }
  });

  it('rolls back a failed v4 migration byte for byte and preserves both the original and a preexisting verified backup', async () => {
    const f = legacyV3(); let raw = new Sqlite(f.path); const backups = join(f.directory, 'backups');
    mkdirSync(backups, { mode: 0o700 });
    const previousBackup = await createVerifiedBackup(raw, backups);
    const previousBytes = readFileSync(previousBackup.path);
    raw.exec("CREATE TRIGGER fail_v4 BEFORE INSERT ON schema_migrations WHEN NEW.version=4 BEGIN SELECT RAISE(ABORT,'injected v4 failure'); END");
    raw.close(); const originalBytes = readFileSync(f.path); const database = new Database(f.path);
    try {
      await expect(database.initialize()).rejects.toThrow(/injected v4 failure/);
      database.close();
      expect(readFileSync(f.path)).toEqual(originalBytes);
      expect(readFileSync(previousBackup.path)).toEqual(previousBytes);
      raw = new Sqlite(f.path, { readonly: true });
      expect(raw.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all()).toEqual([1, 2, 3]);
      expect(raw.prepare("SELECT name FROM sqlite_schema WHERE name='controlled_trials'").all()).toEqual([]);
      expect(raw.prepare('SELECT content FROM messages').pluck().get()).toBe('historical partial');
      raw.close();
      const files = readdirSync(backups).filter(name => name.endsWith('.sqlite3'));
      expect(files).toHaveLength(2);
      for (const file of files) {
        const candidate = new Sqlite(join(backups, file), { readonly: true });
        try {
          expect(validateDatabase(candidate).schemaVersion).toBe(3);
          expect(candidate.prepare('SELECT content FROM messages').pluck().get()).toBe('historical partial');
        } finally { candidate.close(); }
      }
    } finally { if (raw.open) raw.close(); database.close(); f.dispose(); }
  });

  it('keeps an unresolved reservation, partial output and its full nonzero reserve across repeated recovery and disk reopen', async () => {
    const f = legacyV3(); let database = new Database(f.path);
    try {
      await database.initialize(); database.reserveControlledTrial(reservation());
      database.updateControlledTrialProgress('trial-one', { text: 'paid request may have produced this partial', observedUsage: { inputTokens: 40, outputTokens: 3 } });
      database.close(); database = new Database(f.path); await database.initialize();
      expect(database.listControlledTrials()[0]).toMatchObject({ state: 'reserved', outcome: 'running', accountedMicroCny: null, reservedMicroCny: 50000 });
      database.recoverControlledTrials(); const recovered = database.listControlledTrials();
      expect(recovered).toEqual([{ ...reservation(), state: 'unknown', outcome: 'interrupted', text: 'paid request may have produced this partial', observedUsage: { inputTokens: 40, outputTokens: 3 } }]);
      database.recoverControlledTrials(); expect(database.listControlledTrials()).toEqual(recovered);
      expect(() => database.reserveControlledTrial(reservation('two'))).toThrow();
      database.close(); database = new Database(f.path); await database.initialize(); database.recoverControlledTrials();
      expect(database.listControlledTrials()).toEqual(recovered);
      expect(() => database.reserveControlledTrial(reservation('three'))).toThrow();
    } finally { database.close(); f.dispose(); }
  });

  it('backs up and restores latest-schema unknown charges without releasing their reservation or altering historical messages', async () => {
    const f = legacyV3(); const database = new Database(f.path); let raw: Sqlite.Database | undefined;
    try {
      await database.initialize(); database.reserveControlledTrial(reservation()); database.updateControlledTrialProgress('trial-one', { text: 'partial' }); database.recoverControlledTrials();
      const expected = database.listControlledTrials(); raw = new Sqlite(f.path);
      const backups = join(f.directory, 'v4-backups'); mkdirSync(backups, { mode: 0o700 });
      const backup = await createVerifiedBackup(raw, backups); expect(backup.validation.schemaVersion).toBe(6);
      const restored = await prepareRestore(backup, backups); expect(statSync(restored.path).mode & 0o777).toBe(0o600);
      const candidate = new Database(restored.path);
      try {
        await candidate.initialize(); candidate.recoverControlledTrials();
        expect(candidate.listControlledTrials()).toEqual(expected);
        expect(candidate.getMessage('message')?.content).toBe('historical partial');
        expect(() => candidate.reserveControlledTrial(reservation('after-restore'))).toThrow();
      } finally { candidate.close(); }
    } finally { raw?.close(); database.close(); f.dispose(); }
  });

  it.each([
    ['missing table', 'DROP TABLE controlled_trials'],
    ['missing unresolved uniqueness', 'DROP INDEX idx_controlled_trial_unresolved'],
    ['a nonunique replacement index', "DROP INDEX idx_controlled_trial_unresolved; CREATE INDEX idx_controlled_trial_unresolved ON controlled_trials((1)) WHERE state IN ('reserved','unknown')"],
    ['an index that omits unknown reservations', "DROP INDEX idx_controlled_trial_unresolved; CREATE UNIQUE INDEX idx_controlled_trial_unresolved ON controlled_trials((1)) WHERE state='reserved'"],
    ['missing request uniqueness', `DROP INDEX idx_controlled_trial_unresolved;
      ALTER TABLE controlled_trials RENAME TO discarded_trials;
      CREATE TABLE controlled_trials(id TEXT PRIMARY KEY,request_id TEXT NOT NULL,provider_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('reserved','unknown','settled')),data_json TEXT NOT NULL CHECK(json_valid(data_json)));
      CREATE UNIQUE INDEX idx_controlled_trial_unresolved ON controlled_trials((1)) WHERE state IN ('reserved','unknown');
      DROP TABLE discarded_trials;`],
  ])('rejects a claimed current schema with %s before altering bytes', async (_name, corruption) => {
    const f = legacyV3(); let database = new Database(f.path);
    try {
      await database.initialize(); database.close();
      const raw = new Sqlite(f.path); raw.exec(corruption); raw.close(); const original = readFileSync(f.path);
      database = new Database(f.path);
      expect(() => database.initialize()).toThrow(/schema|index|constraint|unique/i);
      database.close(); expect(readFileSync(f.path)).toEqual(original);
    } finally { database.close(); f.dispose(); }
  });

  it.each([
    ['identity mismatch', "UPDATE controlled_trials SET provider_id='another-provider'"],
    ['unknown charges recorded as zero', "UPDATE controlled_trials SET state='unknown',data_json=json_set(data_json,'$.state','unknown','$.outcome','interrupted','$.accountedMicroCny',0)"],
  ])('refuses v4 persisted evidence with %s without overwriting it', async (_name, corruption) => {
    const f = legacyV3(); let database = new Database(f.path);
    try {
      await database.initialize(); database.reserveControlledTrial(reservation()); database.close();
      const raw = new Sqlite(f.path); raw.exec(corruption); raw.close(); const original = readFileSync(f.path);
      database = new Database(f.path); expect(() => database.initialize()).toThrow();
      database.close(); expect(readFileSync(f.path)).toEqual(original);
    } finally { database.close(); f.dispose(); }
  });
});
