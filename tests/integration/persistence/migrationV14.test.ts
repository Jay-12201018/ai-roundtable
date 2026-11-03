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
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import { UsageService } from '../../../src/main/usage/UsageService';

const later = [migration2, migration3, migration4, migration5, migration6, migration7, migration8, migration9, migration10, migration11, migration12, migration13];
const v1 = readFileSync(resolve(__dirname, '../../../src/main/database/Database.ts'), 'utf8').match(/const migrations = \[\s*`([\s\S]*?)`/u)![1]!;
const costTables = ['controlled_trials', 'controlled_trial_reconciliations', 'run_budgets', 'run_budget_topups', 'request_charges', 'summary_charges', 'artifact_charges', 'charge_pricing', 'charge_writeoffs'];
const time = '2026-10-23T02:00:00.000Z';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

/** A database as version `version` left it: a discussion with messages, and the ledger rows that version could hold. */
function historical(version: number): string {
  const directory = mkdtempSync(join(tmpdir(), 'roundtable-v14-')); directories.push(directory);
  const path = join(directory, 'old.db');
  const db = new Sqlite(path);
  db.exec(v1);
  db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(time);
  db.prepare('INSERT INTO rooms VALUES(?,?,?,?,?)').run('room', '校园跑腿讨论', '', time, time);
  db.prepare('INSERT INTO agents(id,room_id,display_name,role_template_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('agent', 'room', '起草者', 'draft', time, time);
  db.prepare('INSERT INTO workflow_runs(id,room_id,status,workflow_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('run', 'room', 'error', '{}', time, time);
  for (const [turn, request, index] of [['t1', 'turn-settled', 0], ['t2', 'turn-unknown', 1], ['t3', 'turn-open', 2], ['t4', 'turn-unsent', 3]] as const) {
    db.prepare('INSERT INTO turns(id,run_id,agent_id,status,request_id,turn_index,partial_content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(turn, 'run', 'agent', 'completed', request, index, '', time, time);
    db.prepare('INSERT INTO messages(id,room_id,run_id,turn_id,sender_type,sender_name,content,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(`m-${turn}`, 'room', 'run', turn, 'agent', '起草者', `发言 ${turn}`, 'completed', time, time);
  }
  later.slice(0, version - 1).forEach((migration, index) => {
    db.exec(migration);
    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(index + 2, time);
  });
  if (version >= 7) {
    const charge = (table: string, request: string, state: 'settled' | 'unknown' | 'not_sent' | 'open', usage?: [number, number]) => {
      db.prepare(`INSERT INTO ${table}(request_id,run_id,provider_id,model_id,currency,state,input_token_bound,output_token_limit,input_micro_per_token,output_micro_per_token,reserved_micro,price_evidence,price_reviewed_at,created_at,updated_at)
        VALUES(?,'run','deepseek','deepseek-flash','CNY','reserved',1000,100,2,8,2800,'fixture',?,?,?)`).run(request, time, time, time);
      if (state === 'open') return;
      db.prepare(`UPDATE ${table} SET state=?,input_tokens=?,output_tokens=?,accounted_micro=?,updated_at=? WHERE request_id=?`)
        .run(state, usage?.[0] ?? null, usage?.[1] ?? null, state === 'settled' ? usage![0] * 2 + usage![1] * 8 : null, time, request);
    };
    charge('request_charges', 'turn-settled', 'settled', [300, 6]);
    charge('request_charges', 'turn-unknown', 'unknown', [50, 4]);
    charge('request_charges', 'turn-open', 'open');
    charge('request_charges', 'turn-unsent', 'not_sent');
    db.prepare("UPDATE run_budgets SET blocked_json=? WHERE run_id='run'").run(JSON.stringify({ reason: 'insufficient', requiredMicro: 5000, remainingMicro: 12, at: time }));
    db.prepare("UPDATE workflow_runs SET last_error='运行预算不足：下一次请求最高可能花费 ¥0.0050，剩余额度 ¥0.0000，已拒绝发送。' WHERE id='run'").run();
    if (version >= 9) {
      db.prepare(`INSERT INTO charge_pricing(request_id,run_id,period,started_at,finished_at,cache_hit_tokens,cache_hit_micro_per_million,cache_miss_micro_per_million,output_micro_per_million,amount_micro,evidence,created_at)
        VALUES('turn-settled','run','peak',?,?,40,40000,2000000,8000000,570,'fixture',?)`).run(time, time, time);
      db.prepare("INSERT INTO charge_writeoffs(id,request_id,run_id,client_request_id,amount_micro,basis,acknowledged_uncertainty,created_at) VALUES('w','turn-unknown','run','c',10,'控制台',1,?)").run(time);
      db.prepare("INSERT INTO run_budget_topups(id,run_id,client_request_id,amount_micro,created_at) VALUES('top','run','c',1000000,?)").run(time);
      db.prepare("INSERT INTO messages(id,room_id,run_id,sender_type,sender_name,content,status,created_at,updated_at,sort_key) VALUES('m-summary','room','run','system','讨论摘要','摘要正文','completed',?,?,99)").run(time, time);
      db.prepare("UPDATE persistence_counters SET value=99 WHERE name='message'").run();
      db.prepare("INSERT INTO message_versions(message_id,run_id,slot_id,version_number,origin) VALUES('m-summary','run','s1',1,'original')").run();
      db.prepare("INSERT INTO message_slots(slot_id,run_id,active_message_id,updated_at) VALUES('s1','run','m-summary',?)").run(time);
      db.prepare("INSERT INTO context_summaries(id,run_id,client_request_id,agent_id,covered_json,created_at) VALUES('s1','run','cs','agent','[\"t1\"]',?)").run(time);
      db.prepare(`INSERT INTO summary_requests(request_id,summary_id,run_id,message_id,client_request_id,agent_id,status,input_snapshot,created_at,updated_at)
        VALUES('summary-request','s1','run','m-summary','cs','agent','generating',?,?,?)`).run(JSON.stringify({ requestId: 'summary-request', modelId: 'deepseek-flash', messages: [] }), time, time);
      db.prepare("UPDATE summary_requests SET status='completed',finish_reason='stop' WHERE request_id='summary-request'").run();
      charge('summary_charges', 'summary-request', 'settled', [80, 20]);
    }
    if (version >= 12) {
      db.prepare("INSERT INTO artifacts(id,run_id,room_id,kind,client_request_id,created_at) VALUES('art','run','room','minutes','ca',?)").run(time);
      db.prepare(`INSERT INTO artifact_versions(id,artifact_id,run_id,version_number,origin,client_request_id,agent_id,validation,raw_output,created_at,updated_at)
        VALUES('v1','art','run',1,'generate','ca','agent','pending','',?,?)`).run(time, time);
      db.prepare(`INSERT INTO artifact_requests(request_id,version_id,run_id,agent_id,status,input_snapshot,created_at,updated_at)
        VALUES('artifact-request','v1','run','agent','generating',?,?,?)`).run(JSON.stringify({ requestId: 'artifact-request', modelId: 'deepseek-flash', messages: [] }), time, time);
      db.prepare("UPDATE artifact_requests SET status='completed',finish_reason='stop' WHERE request_id='artifact-request'").run();
      charge('artifact_charges', 'artifact-request', 'settled', [90, 30]);
    }
  }
  if (version >= 4) db.prepare("INSERT INTO controlled_trials(id,request_id,provider_id,state,data_json) VALUES('trial','trial-request','deepseek','settled',?)")
    .run(JSON.stringify({ id: 'trial', requestId: 'trial-request', providerId: 'deepseek', state: 'settled' }));
  expect(validateDatabase(db).schemaVersion).toBe(version);
  db.close();
  return path;
}

const rowCount = (raw: Sqlite.Database, table: string) => raw.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;

describe('migration 14 (D133)', () => {
  it.each([5, 9, 12, 13])('upgrades v%i with a verified backup, keeps the discussion and drops every cost table', async version => {
    const path = historical(version);
    const before = new Sqlite(path, { readonly: true });
    const messages = rowCount(before, 'messages'); const turns = rowCount(before, 'turns'); before.close();
    const db = new Database(path); await db.initialize(); db.close();
    const raw = new Sqlite(path, { readonly: true });
    try {
      expect(validateDatabase(raw).schemaVersion).toBe(14);
      expect(raw.prepare('SELECT version FROM schema_backups').pluck().all()).toEqual([version]);
      const tables = raw.prepare("SELECT name FROM sqlite_schema WHERE type='table'").pluck().all() as string[];
      expect(tables.filter(table => costTables.includes(table))).toEqual([]);
      expect(tables).toContain('request_usage');
      expect((raw.prepare("SELECT sql FROM sqlite_schema WHERE sql LIKE '%charge%' OR sql LIKE '%budget%'").pluck().all() as string[])).toEqual([]);
      expect(rowCount(raw, 'messages')).toBe(messages);
      expect(rowCount(raw, 'turns')).toBe(turns);
      expect(raw.prepare("SELECT content FROM messages WHERE id='m-t1'").pluck().get()).toBe('发言 t1');
    } finally { raw.close(); }
  });

  it.each([9, 12, 13])('moves token usage out of the ledger of v%i with its state, cache split and purpose', async version => {
    const path = historical(version);
    const db = new Database(path); await db.initialize();
    try {
      const rows = db.listRunUsage('run');
      const byId = Object.fromEntries(rows.map(row => [row.requestId, row]));
      expect(byId['turn-settled']).toMatchObject({ kind: 'turn', agentId: 'agent', providerId: 'deepseek', modelId: 'deepseek-flash', state: 'reported', inputTokens: 300, outputTokens: 6, cacheHitTokens: 40 });
      expect(byId['turn-unknown']).toMatchObject({ state: 'unknown', inputTokens: 50, outputTokens: 4, cacheHitTokens: null });
      expect(byId['turn-open']).toMatchObject({ state: 'in_flight', inputTokens: null });
      expect(byId['turn-unsent']).toMatchObject({ state: 'not_sent', inputTokens: null });
      expect(byId['summary-request']).toMatchObject({ kind: 'summary', state: 'reported', inputTokens: 80, outputTokens: 20 });
      if (version >= 12) expect(byId['artifact-request']).toMatchObject({ kind: 'artifact', state: 'reported', inputTokens: 90, outputTokens: 30 });
      else expect(byId['artifact-request']).toBeUndefined();
      // The report counts only what the provider reported.
      const report = new UsageService(db, 'UTC').getReport();
      expect(report.totals).toMatchObject({ reportedRequests: version >= 12 ? 3 : 2, unknownRequests: 1, inFlightRequests: 1, notSentRequests: 1,
        inputTokens: 380 + (version >= 12 ? 90 : 0), outputTokens: 26 + (version >= 12 ? 30 : 0), cacheHitTokens: 40 });
      // Startup recovery closes what was open as unknown, never as zero.
      db.markInFlightRunsInterrupted();
      expect(db.getUsage('turn-open')).toMatchObject({ state: 'unknown', inputTokens: null });
    } finally { db.close(); }
  });

  it('gives a Run the old budget stopped a stop reason with no amount, and lets it continue', async () => {
    const path = historical(13);
    const db = new Database(path); await db.initialize();
    try {
      const lastError = db.getRun('run')!.lastError!;
      expect(lastError).toContain('旧版本按预算限制停下');
      expect(lastError).not.toMatch(/¥|\d/u);
    } finally { db.close(); }
  });

  it('keeps usage append-only: a row opens in flight, closes once and cannot be deleted', async () => {
    const path = historical(13);
    const db = new Database(path); await db.initialize(); db.close();
    const raw = new Sqlite(path);
    try {
      expect(() => raw.exec("DELETE FROM request_usage WHERE request_id='turn-settled'")).toThrow(/append-only/u);
      expect(() => raw.exec("UPDATE request_usage SET input_tokens=1 WHERE request_id='turn-settled'")).toThrow(/immutable/u);
      expect(() => raw.exec("UPDATE request_usage SET state='unknown' WHERE request_id='turn-settled'")).toThrow(/transition/u);
      expect(() => raw.exec("UPDATE request_usage SET model_id='x' WHERE request_id='turn-open'")).toThrow(/immutable/u);
      expect(() => raw.exec(`INSERT INTO request_usage(request_id,run_id,agent_id,provider_id,model_id,kind,state,created_at,updated_at) VALUES('nobody','run','agent','p','m','turn','in_flight','${time}','${time}')`)).toThrow(/identity/u);
      expect(() => raw.exec(`INSERT INTO request_usage(request_id,run_id,agent_id,provider_id,model_id,kind,state,input_tokens,output_tokens,created_at,updated_at) VALUES('turn-settled2','run','agent','p','m','turn','reported',1,1,'${time}','${time}')`)).toThrow();
    } finally { raw.close(); }
  });

  it.each([
    ['DROP TRIGGER request_usage_no_delete', /Missing usage protection/u],
    ['CREATE TABLE run_budgets(run_id TEXT)', /still holds a cost table/u],
    ["DROP TRIGGER request_usage_insert; INSERT INTO request_usage(request_id,run_id,agent_id,provider_id,model_id,kind,state,created_at,updated_at) VALUES('ghost','run','agent','p','m','summary','in_flight','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')", /Missing usage protection|Invalid usage identity/u],
  ] as const)('recovery validation refuses %s', async (sql, message) => {
    const path = historical(13);
    const db = new Database(path); await db.initialize(); db.close();
    const raw = new Sqlite(path);
    try { raw.exec(sql); expect(() => validateDatabase(raw)).toThrow(message); } finally { raw.close(); }
  });

  it('refuses a damaged pre-14 database before upgrading it, at the SQL level', () => {
    const path = historical(13);
    const raw = new Sqlite(path);
    try {
      raw.exec('DROP TRIGGER run_budget_no_delete');
      expect(() => validateDatabase(raw)).toThrow(/Missing budget ledger protection/u);
    } finally { raw.close(); }
    const second = historical(13); const other = new Sqlite(second);
    try {
      other.exec("UPDATE controlled_trials SET data_json='{\"id\":\"someone-else\"}'");
      expect(() => validateDatabase(other)).toThrow(/Trial reservation identity mismatch/u);
    } finally { other.close(); }
  });
});
