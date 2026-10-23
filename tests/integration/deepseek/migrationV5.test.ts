// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { migration2 } from '../../../src/main/database/migrations/v2';
import { migration3 } from '../../../src/main/database/migrations/v3';
import { migration4 } from '../../../src/main/database/migrations/v4';
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import { createVerifiedBackup } from '../../../src/main/database/backup/createVerifiedBackup';
import { prepareRestore } from '../../../src/main/database/recovery/prepareRestore';
import type { TrialRecord } from '../../../src/main/providers/controlledTrial/record';
const baseline = execFileSync('git', ['show', '135bf82c6462ade6dd5300717d6f0102ce4a660c:src/main/database/Database.ts'], { encoding: 'utf8' });
const migration1 = baseline.match(/const migrations = \[\s*`([\s\S]*?)`/)![1];
const row: TrialRecord = { id: 'unknown-first', requestId: 'request-first', providerId: 'provider', modelId: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', prompt: 'Reply OK.', keyRevision: 'key-revision', createdAt: '2026-10-18T12:23:24.647Z', priceReviewedAt: '2026-10-18T00:00:00.000Z', priceExpiresAt: '2026-10-19T00:00:00.000Z', inputMicroCnyPerToken: 2, outputMicroCnyPerToken: 8, priceEvidence: 'owned local fixture', estimatedInputTokens: 67, estimatedMicroCny: 1158, reservedMicroCny: 50000, maxOutputTokens: 128, state: 'unknown', outcome: 'error', actualInputTokens: null, actualOutputTokens: null, observedUsage: null, accountedMicroCny: null, text: 'partial preserved', errorCode: 'network_error' };
const approval = { trialId: row.id, requestId: row.requestId, providerId: row.providerId, keyRevision: row.keyRevision, evidence: 'dashboard_no_displayed_usage' as const, decision: 'release_reservation' as const, acknowledgedUncertainty: true as const };
function legacy() {
  const directory = mkdtempSync(join(tmpdir(), 'roundtable-v5-'));
  const path = join(directory, 'owned.db'); const raw = new Sqlite(path);
  [migration1, migration2, migration3, migration4].forEach((migration, i) => {
    raw.exec(migration);
    if (i === 0) raw.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(i + 1, row.createdAt);
  });
  raw.prepare('INSERT INTO controlled_trials(id,request_id,provider_id,state,data_json) VALUES(?,?,?,?,?)').run(row.id, row.requestId, row.providerId, row.state, JSON.stringify(row));
  expect(validateDatabase(raw).schemaVersion).toBe(4); raw.close();
  return { directory, path, dispose: () => rmSync(directory, { recursive: true, force: true }) };
}
it('upgrades intact v4 once, preserves unknown bytes and reserve, and registers a recoverable v4 backup', async () => {
  const f = legacy(); let db = new Database(f.path);
  try {
    await db.initialize(); await db.initialize();
    expect(db.listControlledTrials()).toEqual([row]); expect(db.hasUnresolvedControlledTrials()).toBe(true);
    let raw = new Sqlite(f.path, { readonly: true });
    expect(validateDatabase(raw).schemaVersion).toBe(8);
    expect(raw.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(raw.prepare('SELECT data_json FROM controlled_trials').pluck().get()).toBe(JSON.stringify(row));
    const backup = raw.prepare('SELECT id,version FROM schema_backups').get() as { id: number; version: number };
    expect(backup.version).toBe(4); raw.close();
    const restored = await db.prepareRegisteredRestore(backup.id); raw = new Sqlite(restored.path, { readonly: true });
    expect(validateDatabase(raw).schemaVersion).toBe(4); expect(raw.prepare('SELECT data_json FROM controlled_trials').pluck().get()).toBe(JSON.stringify(row)); raw.close();
    db.close(); db = new Database(f.path); await db.initialize();
    expect(db.listControlledTrialReconciliations()).toEqual([]); expect(db.hasUnresolvedControlledTrials()).toBe(true);
    raw = new Sqlite(f.path, { readonly: true }); expect(raw.prepare('SELECT COUNT(*) FROM schema_backups').pluck().get()).toBe(1); raw.close();
  } finally { db.close(); f.dispose(); }
});
it('rolls back failed v5 byte for byte and keeps original v4 unknown and all reserves', async () => {
  const f = legacy(); const raw = new Sqlite(f.path);
  raw.exec("CREATE TRIGGER fail_v5 BEFORE INSERT ON schema_migrations WHEN NEW.version=5 BEGIN SELECT RAISE(ABORT,'injected v5 failure'); END"); raw.close();
  const before = readFileSync(f.path); const db = new Database(f.path);
  try {
    await expect(db.initialize()).rejects.toThrow(/injected v5 failure/); db.close(); expect(readFileSync(f.path)).toEqual(before);
    const original = new Sqlite(f.path, { readonly: true });
    expect(validateDatabase(original).schemaVersion).toBe(4);
    expect(original.prepare('SELECT data_json FROM controlled_trials').pluck().get()).toBe(JSON.stringify(row)); original.close();
  } finally { db.close(); f.dispose(); }
});
it('retains audit and released marker across reopen, recovery, consistent backup and restore', async () => {
  const f = legacy(); let db = new Database(f.path);
  try {
    await db.initialize(); const audit = db.reconcileControlledTrial(approval); db.close(); db = new Database(f.path); await db.initialize(); db.recoverControlledTrials();
    expect(db.listControlledTrials()).toEqual([row]); expect(db.listControlledTrialReconciliations(row.id)).toEqual([audit]); expect(db.hasUnresolvedControlledTrials()).toBe(false);
    const raw = new Sqlite(f.path); const backups = join(f.directory, 'owned-backups'); mkdirSync(backups, { mode: 0o700 });
    const backup = await createVerifiedBackup(raw, backups); raw.close(); expect(backup.validation.schemaVersion).toBe(8);
    const restored = await prepareRestore(backup, backups); const candidate = new Database(restored.path);
    try { await candidate.initialize(); expect(candidate.listControlledTrials()).toEqual([row]); expect(candidate.listControlledTrialReconciliations()).toEqual([audit]); expect(candidate.hasUnresolvedControlledTrials()).toBe(false); } finally { candidate.close(); }
  } finally { db.close(); f.dispose(); }
});
it.each([
  ['release marker without audit', "UPDATE controlled_trials SET reservation_released=1"],
  ['missing audit table', 'DROP TABLE controlled_trial_reconciliations'],
  ['wrong active-reserve index', "DROP INDEX idx_controlled_trial_unresolved; CREATE UNIQUE INDEX idx_controlled_trial_unresolved ON controlled_trials((1)) WHERE state IN ('reserved','unknown')"],
])('refuses corrupted v5 evidence before modifying it: %s', async (_name, corrupt) => {
  const f = legacy(); let db = new Database(f.path);
  try {
    await db.initialize(); db.close(); const raw = new Sqlite(f.path); raw.exec(corrupt); raw.close(); const before = readFileSync(f.path);
    db = new Database(f.path); expect(() => db.initialize()).toThrow(); db.close(); expect(readFileSync(f.path)).toEqual(before);
  } finally { db.close(); f.dispose(); }
});
it('makes audit rows append-only and refuses corrupt reconciliation identities', async () => {
  const f = legacy(); const db = new Database(f.path);
  try {
    await db.initialize(); db.reconcileControlledTrial(approval); const raw = new Sqlite(f.path);
    expect(() => raw.exec('UPDATE controlled_trial_reconciliations SET reviewed_at=reviewed_at')).toThrow();
    expect(() => raw.exec('DELETE FROM controlled_trial_reconciliations')).toThrow(); raw.close();
  } finally { db.close(); f.dispose(); }
});

it('rolls back audit insertion if the release marker update fails', async () => {
  const f = legacy(); const db = new Database(f.path);
  try {
    await db.initialize(); const raw = new Sqlite(f.path);
    raw.exec("CREATE TRIGGER fail_release BEFORE UPDATE OF reservation_released ON controlled_trials BEGIN SELECT RAISE(ABORT,'injected release failure'); END");
    expect(() => db.reconcileControlledTrial(approval)).toThrow(/injected release failure/);
    expect(db.listControlledTrialReconciliations()).toEqual([]); expect(db.hasUnresolvedControlledTrials()).toBe(true);
    expect(db.listControlledTrials()).toEqual([row]); raw.close();
  } finally { db.close(); f.dispose(); }
});
