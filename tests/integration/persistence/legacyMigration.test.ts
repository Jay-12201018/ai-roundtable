// @vitest-environment node
import DatabaseDriver from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { createVerifiedBackup } from '../../../src/main/database/backup/createVerifiedBackup';
import { prepareRestore } from '../../../src/main/database/recovery/prepareRestore';

function baselineMigrationSql(): string {
  const source = execFileSync('git', ['show', '135bf82c6462ade6dd5300717d6f0102ce4a660c:src/main/database/Database.ts'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8',
  });
  const migration = source.match(/const migrations = \[\s*`([\s\S]*?)`\s*,?\s*\];/);
  if (!migration?.[1]) throw new Error('The original Database migration could not be extracted');
  return migration[1];
}

function seedLegacyDatabase(database: DatabaseDriver.Database): void {
  const timestamp = '2026-10-13T01:00:00.000Z';
  database.pragma('foreign_keys = ON');
  database.exec(baselineMigrationSql());
  database.transaction(() => {
    database.prepare('INSERT INTO rooms(id, name, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('legacy-room', 'Legacy discussion', 'Keep historical evidence', timestamp, timestamp);
    database.prepare('INSERT INTO agents(id, room_id, display_name, role_template_id, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('legacy-agent', 'legacy-room', 'Legacy author', 'author', 0, timestamp, timestamp);
    database.prepare('INSERT INTO workflow_runs(id, room_id, status, mode, workflow_snapshot, max_turns, max_duration_ms, output_token_limit, current_turn_id, current_agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('legacy-run', 'legacy-room', 'paused', 'step', JSON.stringify({ templateId: 'draft-review-finalize', members: [{ agentId: 'legacy-agent' }] }), 5, 45000, 96, 'legacy-turn', 'legacy-agent', timestamp, timestamp);
    database.prepare('INSERT INTO turns(id, run_id, agent_id, status, request_id, turn_index, partial_content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('legacy-turn', 'legacy-run', 'legacy-agent', 'running', 'legacy-request', 0, '旧的部分输出\nstill unfinished', timestamp, timestamp);
    database.prepare('INSERT INTO messages(id, room_id, run_id, turn_id, sender_type, sender_name, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('legacy-message', 'legacy-room', 'legacy-run', 'legacy-turn', 'agent', 'Legacy author', '旧的部分输出\nstill unfinished', 'streaming', timestamp, timestamp);
    database.prepare('INSERT INTO run_events(run_id, turn_id, sequence, type, payload_json, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run('legacy-run', 'legacy-turn', 1, 'text_delta', JSON.stringify({ text: '旧的部分输出\nstill unfinished' }), timestamp);
  })();
}

describe('Database legacy disk migration', () => {
  it.each(['missing', 'empty'] as const)('backs up and restores pre-migration evidence when the migration ledger is %s', async (ledger) => {
    const directory = mkdtempSync(join(tmpdir(), 'roundtable-legacy-backup-'));
    const filename = join(directory, 'legacy.db');
    let source: DatabaseDriver.Database | undefined;
    let candidate: DatabaseDriver.Database | undefined;
    const legacyPayload = JSON.stringify({ turnId: 'legacy-turn', messageId: 'legacy-message', senderName: 'Legacy author', text: '旧的部分输出\nstill unfinished' });

    try {
      source = new DatabaseDriver(filename);
      source.pragma('journal_mode = WAL');
      seedLegacyDatabase(source);
      source.prepare('UPDATE run_events SET turn_id = NULL, payload_json = ?').run(legacyPayload);
      if (ledger === 'empty') source.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');

      const backup = await createVerifiedBackup(source, directory);
      expect(backup.validation.schemaVersion).toBe(0);
      expect(backup.validation.counts).toEqual({ runs: 1, turns: 1, messages: 1, events: 1 });
      const restored = await prepareRestore(backup, directory);
      expect(restored.validation.schemaVersion).toBe(0);
      candidate = new DatabaseDriver(restored.path, { readonly: true, fileMustExist: true });

      for (const database of [source, candidate]) {
        expect(database.prepare('SELECT id, room_id, status, mode, workflow_snapshot, max_turns, max_duration_ms, output_token_limit, current_turn_id, current_agent_id FROM workflow_runs').get()).toEqual({
          id: 'legacy-run', room_id: 'legacy-room', status: 'paused', mode: 'step',
          workflow_snapshot: JSON.stringify({ templateId: 'draft-review-finalize', members: [{ agentId: 'legacy-agent' }] }),
          max_turns: 5, max_duration_ms: 45000, output_token_limit: 96, current_turn_id: 'legacy-turn', current_agent_id: 'legacy-agent',
        });
        expect(database.prepare('SELECT id, run_id, agent_id, status, request_id, turn_index, partial_content FROM turns').get()).toEqual({
          id: 'legacy-turn', run_id: 'legacy-run', agent_id: 'legacy-agent', status: 'running', request_id: 'legacy-request', turn_index: 0, partial_content: '旧的部分输出\nstill unfinished',
        });
        expect(database.prepare('SELECT id, room_id, run_id, turn_id, sender_type, sender_name, content, status FROM messages').get()).toEqual({
          id: 'legacy-message', room_id: 'legacy-room', run_id: 'legacy-run', turn_id: 'legacy-turn', sender_type: 'agent', sender_name: 'Legacy author', content: '旧的部分输出\nstill unfinished', status: 'streaming',
        });
        expect(database.prepare('SELECT run_id, turn_id, sequence, type, payload_json, timestamp FROM run_events').get()).toEqual({
          run_id: 'legacy-run', turn_id: null, sequence: 1, type: 'text_delta', payload_json: legacyPayload, timestamp: '2026-10-13T01:00:00.000Z',
        });
        expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()).toEqual(ledger === 'missing' ? undefined : { name: 'schema_migrations' });
        if (ledger === 'empty') expect(database.prepare('SELECT version, applied_at FROM schema_migrations').all()).toEqual([]);
      }
    } finally {
      candidate?.close();
      source?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('adopts the original schema without a migration ledger and keeps existing execution evidence', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'roundtable-legacy-migration-'));
    const filename = join(directory, 'legacy.db');
    let raw: DatabaseDriver.Database | undefined;
    let database: Database | undefined;

    try {
      raw = new DatabaseDriver(filename);
      seedLegacyDatabase(raw);
      expect(raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()).toBeUndefined();
      raw.close();
      raw = undefined;

      database = new Database(filename);
      await database.initialize();
      await database.initialize();
      expect(database.getRoom('legacy-room')).toEqual({ id: 'legacy-room', name: 'Legacy discussion', objective: 'Keep historical evidence' });
      expect(database.getRun('legacy-run')).toMatchObject({ id: 'legacy-run', roomId: 'legacy-room', status: 'paused', workflowSnapshot: { templateId: 'draft-review-finalize', members: [{ agentId: 'legacy-agent' }] } });
      expect(database.getTurn('legacy-turn')).toEqual({ id: 'legacy-turn', runId: 'legacy-run', agentId: 'legacy-agent', status: 'running', requestId: 'legacy-request', turnIndex: 0, partialContent: '旧的部分输出\nstill unfinished' });
      expect(database.getMessage('legacy-message')).toEqual({ id: 'legacy-message', roomId: 'legacy-room', runId: 'legacy-run', turnId: 'legacy-turn', senderType: 'agent', senderName: 'Legacy author', content: '旧的部分输出\nstill unfinished', status: 'streaming' });
      expect(database.listRunEvents('legacy-run', 0)).toEqual([{ runId: 'legacy-run', turnId: 'legacy-turn', sequence: 1, type: 'text_delta', payload: { text: '旧的部分输出\nstill unfinished' }, timestamp: '2026-10-13T01:00:00.000Z',protocolVersion:0,requestId:undefined }]);
      database.close();
      database = undefined;

      raw = new DatabaseDriver(filename, { readonly: true, fileMustExist: true });
      const appliedVersions = raw.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all();
      expect(appliedVersions).toEqual([{ version: 1, applied_at: expect.any(String) },{version:2,applied_at:expect.any(String)},{version:3,applied_at:expect.any(String)},{version:4,applied_at:expect.any(String)},{version:5,applied_at:expect.any(String)},{version:6,applied_at:expect.any(String)},{version:7,applied_at:expect.any(String)}]);
      expect(raw.prepare('SELECT mode, max_turns, max_duration_ms, output_token_limit, current_turn_id, current_agent_id FROM workflow_runs WHERE id = ?').get('legacy-run')).toEqual({ mode: 'step', max_turns: 5, max_duration_ms: 45000, output_token_limit: 96, current_turn_id: 'legacy-turn', current_agent_id: 'legacy-agent' });
      expect(raw.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(raw.pragma('foreign_key_check')).toEqual([]);
      raw.close();
      raw = undefined;

      database = new Database(filename);
      await database.initialize();
      expect(database.getTurn('legacy-turn')?.requestId).toBe('legacy-request');
      expect(database.getMessage('legacy-message')?.content).toBe('旧的部分输出\nstill unfinished');
      database.close();
      database = undefined;
      raw = new DatabaseDriver(filename, { readonly: true, fileMustExist: true });
      expect(raw.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all()).toEqual(appliedVersions);
    } finally {
      raw?.close();
      database?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects incomplete conflicting schemas before changing any data or creating a ledger', () => {
    const directory = mkdtempSync(join(tmpdir(), 'roundtable-migration-rollback-'));
    const filename = join(directory, 'conflict.db');
    let raw: DatabaseDriver.Database | undefined;
    let database: Database | undefined;

    try {
      raw = new DatabaseDriver(filename);
      const roomSql = baselineMigrationSql().match(/CREATE TABLE IF NOT EXISTS rooms \([\s\S]*?\);/)?.[0];
      if (!roomSql) throw new Error('The original rooms schema could not be extracted');
      raw.exec(roomSql);
      raw.exec('CREATE TABLE messages (id TEXT PRIMARY KEY, content TEXT NOT NULL);');
      raw.prepare('INSERT INTO rooms(id, name, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('old-room', 'Old room', 'Preserve me', '2026-10-13T01:00:00.000Z', '2026-10-13T01:00:00.000Z');
      raw.prepare('INSERT INTO messages(id, content) VALUES (?, ?)').run('old-message', 'Existing partial output');
      raw.close();
      raw = undefined;

      database = new Database(filename);
      try {
        expect(() => database!.initialize()).toThrow(/Recovery schema is incomplete/);
        expect(() => database!.getRoom('old-room')).toThrow('Database has not been initialized');
      } finally {
        database.close();
        database = undefined;
      }

      raw = new DatabaseDriver(filename, { readonly: true, fileMustExist: true });
      // Preflight now refuses this partial schema before creating any migration objects.
      expect(raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()).toEqual([{ name: 'messages' }, { name: 'rooms' }]);
      expect(raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").all()).toEqual([]);
      expect(raw.prepare("SELECT name FROM sqlite_schema WHERE name='schema_migrations'").all()).toEqual([]);
      expect(raw.prepare('SELECT id, name, objective, created_at, updated_at FROM rooms').all()).toEqual([{ id: 'old-room', name: 'Old room', objective: 'Preserve me', created_at: '2026-10-13T01:00:00.000Z', updated_at: '2026-10-13T01:00:00.000Z' }]);
      expect(raw.prepare('SELECT id, content FROM messages').all()).toEqual([{ id: 'old-message', content: 'Existing partial output' }]);
      expect(raw.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      raw?.close();
      database?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
