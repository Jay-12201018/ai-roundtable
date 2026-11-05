// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Sqlite from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
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
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { UsageService } from '../../../src/main/usage/UsageService';

const later = [migration2, migration3, migration4, migration5, migration6, migration7, migration8, migration9, migration10, migration11, migration12, migration13, migration14, migration15];
const v1 = readFileSync(resolve(__dirname, '../../../src/main/database/Database.ts'), 'utf8').match(/const migrations = \[\s*`([\s\S]*?)`/u)![1]!;
const time = '2026-11-01T02:00:00.000Z';
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

/** A database as version `version` left it: a finished discussion, and at v14 and later the usage of its requests. */
function historical(version: number): string {
  const directory = mkdtempSync(join(tmpdir(), 'roundtable-v16-')); directories.push(directory);
  const path = join(directory, 'old.db');
  const db = new Sqlite(path);
  db.exec(v1);
  db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(time);
  db.prepare('INSERT INTO rooms VALUES(?,?,?,?,?)').run('room', '旧房间', '', time, time);
  db.prepare('INSERT INTO agents(id,room_id,display_name,role_template_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('agent', 'room', '起草者', '起草', time, time);
  db.prepare('INSERT INTO workflow_runs(id,room_id,status,workflow_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('run', 'room', 'completed', '{"templateId":"draft-review-finalize","version":1}', time, time);
  for (const [turn, request, index] of [['t1', 'r1', 0], ['t2', 'r2', 1], ['t3', 'r3', 2]] as const) {
    db.prepare('INSERT INTO turns(id,run_id,agent_id,status,request_id,turn_index,partial_content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(turn, 'run', 'agent', 'completed', request, index, '', time, time);
    db.prepare('INSERT INTO messages(id,room_id,run_id,turn_id,sender_type,sender_name,content,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(`m-${turn}`, 'room', 'run', turn, 'agent', '起草者', `发言 ${turn}`, 'completed', time, time);
  }
  later.slice(0, version - 1).forEach((migration, index) => { db.exec(migration); db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(index + 2, time); });
  if (version >= 14) {
    const usage = db.prepare("INSERT INTO request_usage(request_id,run_id,agent_id,provider_id,model_id,kind,state,created_at,updated_at) VALUES(?, 'run','agent','p','deepseek-flash','turn','in_flight',?,?)");
    const close = db.prepare('UPDATE request_usage SET state=?,input_tokens=?,output_tokens=?,cache_hit_tokens=? WHERE request_id=?');
    for (const request of ['r1', 'r2', 'r3']) usage.run(request, time, time);
    close.run('reported', 300, 6, 100, 'r1'); close.run('unknown', null, null, null, 'r2');
  }
  expect(validateDatabase(db).schemaVersion).toBe(version);
  db.close();
  return path;
}

describe('migration 16 (D149)', () => {
  it.each([13, 14, 15])('upgrades v%i with a verified backup; what was there reads as it did', async version => {
    const path = historical(version);
    const before = new Sqlite(path, { readonly: true });
    const rows = (raw: Sqlite.Database, table: string) => JSON.stringify(raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const kept = version >= 14 ? rows(before, 'request_usage') : undefined;
    const messages = rows(before, 'messages'); const turns = rows(before, 'turns'); before.close();
    const db = new Database(path); await db.initialize();
    const service = new RunService(db, new MockProvider());
    const old = db.getRun('run')!;
    expect(old.workflowSnapshot).toEqual({ templateId: 'draft-review-finalize', version: 1 });
    expect(db.latestGroupChatRound('run')).toBeUndefined();
    expect(service.isGroupChat(old)).toBe(false);
    if (version >= 14) {
      expect(service.getSnapshot('run').groupChat).toBeUndefined();
      const report = new UsageService(db).getReport();
      expect(report.byKind).toEqual([expect.objectContaining({ kind: 'turn', requests: 3, inputTokens: 300, outputTokens: 6, cacheHitTokens: 100, unknownRequests: 1, inFlightRequests: 1 })]);
    }
    db.close();
    const raw = new Sqlite(path);
    try {
      expect(validateDatabase(raw).schemaVersion).toBe(16);
      expect(raw.prepare('SELECT version FROM schema_backups').pluck().all()).toEqual([version]);
      expect(rows(raw, 'messages')).toBe(messages); expect(rows(raw, 'turns')).toBe(turns);
      if (kept) expect(rows(raw, 'request_usage')).toBe(kept);
      // The rebuilt table keeps every rule it had.
      if (version >= 14) {
        expect(() => raw.prepare("DELETE FROM request_usage WHERE request_id='r1'").run()).toThrow(/append-only/u);
        expect(() => raw.prepare("UPDATE request_usage SET input_tokens=1 WHERE request_id='r1'").run()).toThrow(/immutable/u);
        expect(() => raw.prepare("UPDATE request_usage SET state='reported',input_tokens=1,output_tokens=1 WHERE request_id='r2'").run()).toThrow(/transition|immutable/u);
        expect(() => raw.prepare("UPDATE request_usage SET kind='summary' WHERE request_id='r3'").run()).toThrow(/immutable/u);
      }
      expect(raw.prepare("SELECT name FROM sqlite_schema WHERE name='request_usage_before_v16'").get()).toBeUndefined();
      // A scheduling row needs its request; a kind nobody knows is refused.
      expect(() => raw.prepare("INSERT INTO request_usage(request_id,run_id,agent_id,provider_id,model_id,kind,state,created_at,updated_at) VALUES('s','run','agent','p','m','schedule','in_flight','t','t')").run()).toThrow(/usage identity/u);
      expect(() => raw.prepare("INSERT INTO request_usage(request_id,run_id,agent_id,provider_id,model_id,kind,state,created_at,updated_at) VALUES('s','run','agent','p','m','other','in_flight','t','t')").run()).toThrow();
    } finally { raw.close(); }
  });

  it('protects what a group chat records', () => {
    const db = new Database(':memory:'); db.initialize();
    db.insertRoom({ id: 'room', name: 'r', objective: '' });
    db.insertRun({ id: 'run', roomId: 'room', status: 'idle', workflowSnapshot: { templateId: 'group-chat', version: 1 } });
    db.insertGroupChatRound({ id: 'a', runId: 'run', classification: 'gather', scheduleMore: false, speakers: [{ agentId: 'x', intent: 'reply', length: 'short', source: 'gather' }] });
    expect(() => db.insertGroupChatRound({ id: 'b', runId: 'run', classification: 'gather', scheduleMore: false, speakers: [] })).toThrow();
    db.closeGroupChatRound('a', 'superseded');
    expect(db.latestGroupChatRound('run')).toMatchObject({ state: 'superseded', speakers: [{ state: 'dropped' }] });
    db.insertGroupChatRound({ id: 'b', runId: 'run', classification: 'gather', scheduleMore: false, speakers: [] });
    expect(db.latestGroupChatRound('run')?.id).toBe('b');
    expect(db.openGroupChatRound('run')?.id).toBe('b');
    db.close();
    const raw = (() => { const directory = mkdtempSync(join(tmpdir(), 'roundtable-v16-')); directories.push(directory); return join(directory, 'db'); })();
    const onDisk = new Database(raw); onDisk.initialize();
    onDisk.close();
  });

  it.each([
    ['DROP TRIGGER group_chat_round_no_delete', /group chat protection/u],
    ['DROP TRIGGER group_chat_speaker_state', /group chat protection/u],
    ['DROP INDEX idx_group_chat_open_round', /group chat protection/u],
    ['DROP TABLE group_chat_speakers', /v16 schema/u],
  ])('validation refuses a database with %s', async (sql, message) => {
    const path = historical(15);
    const db = new Database(path); await db.initialize(); db.close();
    const raw = new Sqlite(path);
    try {
      raw.exec(sql);
      expect(() => validateDatabase(raw)).toThrow(message);
    } finally { raw.close(); }
  });
});
