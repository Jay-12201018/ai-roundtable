// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import { diskFixture } from './fixtures';

describe('recovery database validation', () => {
  it('checks complete evidence without changing partial output or request identity', () => {
    const f = diskFixture();
    try {
      const report = validateDatabase(f.db);
      expect(report.schemaVersion).toBe(2);
      expect(report.counts).toEqual({ runs: 1, turns: 1, messages: 1, events: 1 });
      expect(report.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
      f.db.prepare('UPDATE turns SET request_id = ?').run('other-request');
      expect(() => validateDatabase(f.db)).toThrow(/identity/i);
      expect(f.db.prepare('SELECT partial_content FROM turns').pluck().get()).toBe('已生成的部分文本');
    } finally { f.dispose(); }
  });

  it.each([
    ["DELETE FROM rooms", /foreign key/i],
    ["UPDATE messages SET run_id = NULL", /identity/i],
    ["UPDATE run_events SET turn_id = 'missing'", /identity/i],
    ["UPDATE run_events SET sequence = 2", /sequence/i],
    ["UPDATE run_events SET payload_json = '{broken'", /JSON/i],
    ["UPDATE workflow_runs SET workflow_snapshot = '[]'", /JSON/i],
    ["UPDATE workflow_runs SET status = 'unknown'", /status/i],
    ["UPDATE turns SET status = 'unknown'", /status/i],
    ["UPDATE messages SET status = 'unknown'", /status/i],
    ["UPDATE schema_migrations SET version = 3 WHERE version = 2", /migration/i],
  ])('rejects damaged evidence: %s', (sql, error) => {
    const f = diskFixture();
    try {
      f.db.pragma('foreign_keys = OFF');
      f.db.exec(sql);
      expect(() => validateDatabase(f.db)).toThrow(error);
      // Failed validation preserves the damaged record for diagnosis.
      if (sql.includes('{broken')) expect(f.db.prepare('SELECT payload_json FROM run_events').pluck().get()).toBe('{broken');
    } finally { f.dispose(); }
  });

  it('detects cross-run message links despite valid SQLite foreign keys', () => {
    const f = diskFixture();
    try {
      f.db.exec("INSERT INTO workflow_runs(id,room_id,status,mode,workflow_snapshot,current_turn_id,current_agent_id,max_turns,max_duration_ms,output_token_limit,started_at,finished_at,last_error,created_at,updated_at) SELECT 'other-run', room_id, status, mode, workflow_snapshot, current_turn_id, current_agent_id, max_turns, max_duration_ms, output_token_limit, started_at, finished_at, last_error, created_at, updated_at FROM workflow_runs");
      f.db.exec("UPDATE messages SET run_id = 'other-run'");
      expect(f.db.pragma('foreign_key_check')).toEqual([]);
      expect(() => validateDatabase(f.db)).toThrow(/identity/i);
    } finally { f.dispose(); }
  });

  it('preserves legacy error payloads and unknown events without inventing protocol fields', () => {
    const f = diskFixture();
    try {
      f.db.exec(`UPDATE run_events SET type = 'legacy_future_event', payload_json = '{"error":"legacy error evidence"}'`);
      expect(validateDatabase(f.db).counts.events).toBe(1);
      expect(f.db.prepare('SELECT payload_json FROM run_events').pluck().get()).toBe('{"error":"legacy error evidence"}');
    } finally { f.dispose(); }
  });

  it.each([
    ['turn_started', { turnId: 'turn', messageId: 'message', agentId: 'agent', requestId: 'request' }],
    ['text_delta', { turnId: 'turn', messageId: 'message', senderName: 'A', text: '部分文本' }],
    ['usage_updated', { turnId: 'turn', inputTokens: 2, outputTokens: 3 }],
    ['turn_completed', { turnId: 'turn', messageId: 'message' }],
  ])('accepts unchanged v0 %s with identity only in payload', (type, payload) => {
    const f = diskFixture();
    try {
      const json = JSON.stringify(payload);
      f.db.prepare('UPDATE run_events SET turn_id = NULL, type = ?, payload_json = ?').run(type, json);
      expect(validateDatabase(f.db).counts.events).toBe(1);
      expect(f.db.prepare('SELECT turn_id, payload_json FROM run_events').get()).toEqual({ turn_id: null, payload_json: json });
    } finally { f.dispose(); }
  });

  it.each([
    { turnId: 'missing', messageId: 'message' },
    { turnId: 'turn', messageId: 'missing' },
    { turnId: 'turn', requestId: 'other-request' },
  ])('rejects broken payload-only legacy identity: %j', (payload) => {
    const f = diskFixture();
    try {
      f.db.prepare('UPDATE run_events SET turn_id = NULL, payload_json = ?').run(JSON.stringify(payload));
      expect(() => validateDatabase(f.db)).toThrow(/identity/i);
    } finally { f.dispose(); }
  });

  it('changes the evidence digest when a task configuration changes', () => {
    const f = diskFixture();
    try {
      const before = validateDatabase(f.db);
      f.db.exec(`UPDATE workflow_runs SET workflow_snapshot = '{"templateId":"review"}'`);
      expect(validateDatabase(f.db).evidenceSha256).not.toBe(before.evidenceSha256);
    } finally { f.dispose(); }
  });
});
