// @vitest-environment node
import Sqlite from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { migration2 } from '../../../src/main/database/migrations/v2';
import { migration3 } from '../../../src/main/database/migrations/v3';
import { migration4 } from '../../../src/main/database/migrations/v4';
import { migration5 } from '../../../src/main/database/migrations/v5';
import { migration6 } from '../../../src/main/database/migrations/v6';
import { migration7 } from '../../../src/main/database/migrations/v7';
import { migration8 } from '../../../src/main/database/migrations/v8';
import { migration9 } from '../../../src/main/database/migrations/v9';
import { migration10 } from '../../../src/main/database/migrations/v10';
import { migration11 } from '../../../src/main/database/migrations/v11';
import { migration12 } from '../../../src/main/database/migrations/v12';
import { migration13 } from '../../../src/main/database/migrations/v13';
import { migration14 } from '../../../src/main/database/migrations/v14';
import { migration15 } from '../../../src/main/database/migrations/v15';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const script = join(root, 'scripts/rehearse-upgrade.cjs');
// The original schema is the first entry of the migration list; published migrations are never edited.
const v1 = readFileSync(join(root, 'src/main/database/Database.ts'), 'utf8').match(/const migrations = \[\s*`([\s\S]*?)`/u)![1]!;
const later = [migration2, migration3, migration4, migration5, migration6, migration7, migration8, migration9, migration10, migration11, migration12, migration13, migration14, migration15];

const directories: string[] = [];
const temp = () => { const directory = realpathSync(mkdtempSync(join(tmpdir(), 'roundtable-rehearse-test-'))); directories.push(directory); return directory; };
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

/** A database as version `version` of the app would have left it: real data entered at v1, migrated step by step, one run still in flight. */
function historical(path: string, version: number) {
  const db = new Sqlite(path);
  db.exec(v1);
  const time = '2026-10-13T00:00:00.000Z';
  db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(time);
  db.prepare('INSERT INTO rooms VALUES(?,?,?,?,?)').run('room', '校园跑腿讨论', '', time, time);
  db.prepare('INSERT INTO agents(id,room_id,display_name,role_template_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('agent', 'room', '起草者', 'draft', time, time);
  db.prepare('INSERT INTO workflow_runs(id,room_id,status,workflow_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('done', 'room', 'completed', '{}', time, time);
  db.prepare('INSERT INTO workflow_runs(id,room_id,status,workflow_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('flying', 'room', 'running', '{}', time, time);
  for (const [run, status] of [['done', 'completed'], ['flying', 'running']] as const) {
    db.prepare('INSERT INTO turns(id,run_id,agent_id,status,request_id,turn_index,partial_content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(`turn-${run}`, run, 'agent', status, `request-${run}`, 0, '', time, time);
    db.prepare('INSERT INTO messages(id,room_id,run_id,turn_id,sender_type,sender_name,content,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(`message-${run}`, 'room', run, `turn-${run}`, 'agent', '起草者', `${run} 的发言`, status === 'running' ? 'streaming' : 'completed', time, time);
  }
  db.prepare('INSERT INTO key_records(id,provider_id,encrypted_value,backend,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('key', 'provider', 'b3BhcXVl', 'safeStorage', time, time);
  later.slice(0, version - 1).forEach((migration, index) => {
    db.exec(migration);
    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(index + 2, time);
  });
  db.close();
}

const run = (input: string, extra: string[] = [], env: NodeJS.ProcessEnv = {}) => {
  const result = spawnSync(process.execPath, [script, input, '--json', ...extra], { cwd: root, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env }, timeout: 60_000 });
  return { status: result.status, stderr: result.stderr, report: result.status === 2 ? undefined : JSON.parse(result.stdout) };
};
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('rehearse-upgrade', () => {
  it.each([5, 9, 12, 13, 14])('upgrades a v%i copy to the current version, recovers it, and leaves the input alone', version => {
    const folder = temp();
    const input = join(folder, 'copy.db');
    historical(input, version);
    const hash = sha(input), mtime = statSync(input).mtimeMs;
    const { status, report } = run(input);
    expect(report.problems).toEqual([]);
    expect(status).toBe(0);
    expect(report).toMatchObject({ status: 'PASS', from: version, to: later.length + 1, inputUnchanged: true, interruptedRuns: 1, backupRestoreChecked: true, runStatusAfter: { completed: 1, interrupted: 1 } });
    const counts = Object.fromEntries(report.rows.map((row: { table: string; before: number | null; after: number }) => [row.table, row]));
    expect(counts.messages).toEqual({ table: 'messages', before: 2, after: 2 });
    expect(counts.workflow_runs).toEqual({ table: 'workflow_runs', before: 2, after: 2 });
    expect(counts.key_records).toEqual({ table: 'key_records', before: 1, after: 1 });
    expect(counts.code_exports.after).toBe(0);
    expect(sha(input)).toBe(hash);
    expect(statSync(input).mtimeMs).toBe(mtime);
    expect(readdirSync(folder), 'Nothing appears beside the input').toEqual(['copy.db']);
    // The in-flight run was changed only in the copy.
    const db = new Sqlite(input, { readonly: true });
    expect(db.prepare("SELECT status FROM workflow_runs WHERE id='flying'").pluck().get()).toBe('running');
    db.close();
  });

  it('has nothing to do for a current database and says so, still running recovery', () => {
    const input = join(temp(), 'copy.db');
    historical(input, later.length + 1);
    const { status, report } = run(input);
    expect(status).toBe(0);
    expect(report).toMatchObject({ from: 15, to: 15, interruptedRuns: 1, backupRestoreChecked: false });
  });

  it('prints no row contents', () => {
    const input = join(temp(), 'copy.db');
    historical(input, 9);
    const { report } = run(input);
    const text = JSON.stringify(report);
    for (const secret of ['校园跑腿讨论', '的发言', 'b3BhcXVl']) expect(text).not.toContain(secret);
  });

  it('removes its temporary folder unless asked to keep it', () => {
    const input = join(temp(), 'copy.db');
    historical(input, 9);
    const scratch = temp();
    expect(run(input, [], { TMPDIR: scratch }).status).toBe(0);
    expect(readdirSync(scratch)).toEqual([]);
    const kept = run(input, ['--keep'], { TMPDIR: scratch }).report.kept;
    expect(readdirSync(kept)).toContain('rehearsal.db');
  });

  describe('refuses without copying anything', () => {
    const profile = (home: string, name: string) => { const folder = join(home, 'Library/Application Support', name); mkdirSync(folder, { recursive: true }); return folder; };
    // A fake home, so the real data folders are never involved even in the refusal.
    it.each(['ai-roundtable', 'ai-roundtable-trial'])('a file in the %s data folder', name => {
      const home = temp();
      const input = join(profile(home, name), 'ai-roundtable.db');
      historical(input, 9);
      const hash = sha(input);
      const { status, stderr } = run(input, [], { HOME: home });
      expect(status).toBe(2);
      expect(stderr).toContain('应用的数据目录');
      expect(sha(input)).toBe(hash);
    });
    it('a link pointing into the data folder', () => {
      const home = temp();
      const target = join(profile(home, 'ai-roundtable'), 'ai-roundtable.db');
      historical(target, 9);
      const link = join(temp(), 'copy.db');
      symlinkSync(target, link);
      const { status, stderr } = run(link, [], { HOME: home });
      expect(status).toBe(2);
      expect(stderr).toContain('链接');
    });
    it('a second hard link', () => {
      const folder = temp();
      historical(join(folder, 'original.db'), 9);
      linkSync(join(folder, 'original.db'), join(folder, 'copy.db'));
      const { status, stderr } = run(join(folder, 'copy.db'));
      expect(status).toBe(2);
      expect(stderr).toContain('硬链接');
    });
    it.each(['-wal', '-journal'])('a copy with an unmerged %s file', suffix => {
      const input = join(temp(), 'copy.db');
      historical(input, 9);
      writeFileSync(input + suffix, 'unmerged');
      const { status, stderr } = run(input);
      expect(status).toBe(2);
      expect(stderr).toContain('.backup');
    });
    it('a missing file or wrong usage', () => {
      expect(run(join(temp(), 'missing.db')).status).toBe(2);
      expect(spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).status).toBe(2);
    });
  });

  describe('fails, leaving the input alone', () => {
    it('a file that is not a database', () => {
      const input = join(temp(), 'copy.db');
      writeFileSync(input, 'not a database at all');
      const { status, report } = run(input);
      expect(status).toBe(1);
      expect(report.status).toBe('FAIL');
      expect(report.error).toBeTruthy();
      expect(readFileSync(input, 'utf8')).toBe('not a database at all');
    });
    it('a database from a newer app version', () => {
      const input = join(temp(), 'copy.db');
      historical(input, later.length + 1);
      const db = new Sqlite(input);
      db.prepare("INSERT INTO schema_migrations VALUES(?, '2026-11-03T00:00:00.000Z')").run(later.length + 2);
      db.close();
      const hash = sha(input);
      const { status, report } = run(input);
      expect(status).toBe(1);
      expect(report.error).toContain('unsupported migration ledger');
      expect(sha(input)).toBe(hash);
    });
  });
});
