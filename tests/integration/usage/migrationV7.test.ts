// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { migration2 } from '../../../src/main/database/migrations/v2';
import { migration3 } from '../../../src/main/database/migrations/v3';
import { migration4 } from '../../../src/main/database/migrations/v4';
import { migration5 } from '../../../src/main/database/migrations/v5';
import { migration6 } from '../../../src/main/database/migrations/v6';
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';

const baseline = execFileSync('git', ['show', '135bf82c6462ade6dd5300717d6f0102ce4a660c:src/main/database/Database.ts'], { encoding: 'utf8' });
const migration1 = baseline.match(/const migrations = \[\s*`([\s\S]*?)`/)![1];
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const at = '2026-10-21T00:00:00.000Z';

function v6File() {
  const directory = mkdtempSync(join(tmpdir(), 'roundtable-v7-')); directories.push(directory);
  const path = join(directory, 'owned.db'); const raw = new Sqlite(path);
  [migration1, migration2, migration3, migration4, migration5, migration6].forEach((migration, i) => {
    raw.exec(migration);
    if (i === 0) raw.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(i + 1, at);
  });
  raw.prepare('INSERT INTO rooms(id,name,objective,created_at,updated_at) VALUES(?,?,?,?,?)').run('room', 'Legacy', '', at, at);
  raw.prepare("INSERT INTO workflow_runs(id,room_id,status,workflow_snapshot,created_at,updated_at) VALUES('legacy','room','completed','{}',?,?)").run(at, at);
  expect(validateDatabase(raw).schemaVersion).toBe(6); raw.close();
  return path;
}

it('upgrades v6 once with a verified v6 backup, giving every existing Run the ¥1 default and an empty ledger', async () => {
  const path = v6File();
  const db = new Database(path); await db.initialize(); await db.initialize();
  try {
    expect(db.getRunBudget('legacy')).toEqual({ currency: 'CNY', limitMicro: 1_000_000, settledMicro: 0, unknownMicro: 0, reservedMicro: 0, remainingMicro: 1_000_000, overrunMicro: 0 });
    expect(db.listCharges('legacy')).toEqual([]);
  } finally { db.close(); }
  const raw = new Sqlite(path, { readonly: true });
  try {
    expect(validateDatabase(raw).schemaVersion).toBe(8);
    expect(raw.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(raw.prepare('SELECT version FROM schema_backups').pluck().all()).toEqual([6]);
  } finally { raw.close(); }
});

it('rejects a v7 database whose ledger protection was removed or whose budget block was tampered with', async () => {
  const path = v6File();
  const db = new Database(path); await db.initialize(); db.close();
  for (const [sql, message] of [
    ['DROP TRIGGER run_budget_no_delete; DELETE FROM run_budgets', /Missing budget ledger protection/u],
    ["UPDATE run_budgets SET blocked_json='{\"reason\":\"other\"}'", /Invalid budget block/u],
  ] as const) {
    const copy = join(directories.at(-1)!, `copy-${Math.random()}.db`);
    const source = new Sqlite(path); await source.backup(copy); source.close();
    const raw = new Sqlite(copy);
    try { raw.exec(sql); expect(() => validateDatabase(raw)).toThrow(message); } finally { raw.close(); }
  }
});
