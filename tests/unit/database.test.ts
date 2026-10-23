import DatabaseDriver from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Database } from '../../src/main/database/Database';

describe('Database', () => {
  it('runs migrations and persists a room, run, message, and event atomically', () => {
    const database = new Database(':memory:');

    database.initialize();
    database.transaction(() => {
      database.insertRoom({ id: 'room-1', name: 'Demo', objective: 'Draft a plan' });
      database.insertRun({ id: 'run-1', roomId: 'room-1', status: 'running', workflowSnapshot: { templateId: 'draft-review-finalize' } });
      database.insertMessage({ id: 'message-1', roomId: 'room-1', runId: 'run-1', senderType: 'agent', senderName: 'A', content: 'Draft' });
      database.appendRunEvent({ runId: 'run-1', type: 'run_state_changed', payload: { status: 'running' } });
    });

    expect(database.getRoom('room-1')?.name).toBe('Demo');
    expect(database.getRun('run-1')?.workflowSnapshot).toEqual({ templateId: 'draft-review-finalize' });
    expect(database.listMessages('room-1')).toHaveLength(1);
    expect(database.listRunEvents('run-1', 0)[0]?.sequence).toBe(1);
    database.close();
  });

  it('rolls back all writes when a transaction fails', () => {
    const database = new Database(':memory:');
    database.initialize();

    expect(() => database.transaction(() => {
      database.insertRoom({ id: 'room-1', name: 'Demo', objective: 'Draft a plan' });
      throw new Error('abort');
    })).toThrow('abort');

    expect(database.getRoom('room-1')).toBeUndefined();
    database.close();
  });

  it('preserves run configuration, request identity, and partial output after reopening a disk database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'roundtable-database-reopen-'));
    const filename = join(directory, 'roundtable.db');
    let database: Database | undefined;
    let reader: DatabaseDriver.Database | undefined;

    try {
      database = new Database(filename);
      database.initialize();
      database.transaction(() => {
        database!.insertRoom({ id: 'room-disk', name: 'Disk discussion', objective: 'Keep the draft' });
        database!.insertAgent({ id: 'agent-disk', roomId: 'room-disk', displayName: 'Draft author', roleTemplateId: 'author', displayOrder: 0 });
        database!.insertRun({
          id: 'run-disk', roomId: 'room-disk', status: 'paused',
          workflowSnapshot: { templateId: 'draft-review-finalize', rounds: 2, members: [{ agentId: 'agent-disk', modelId: 'mock' }] },
          mode: 'step', maxTurns: 7, maxDurationMs: 90210, outputTokenLimit: 128,
        });
        database!.insertTurn({ id: 'turn-disk', runId: 'run-disk', agentId: 'agent-disk', status: 'running', requestId: 'request-disk', turnIndex: 0 });
        database!.updateTurn('turn-disk', { partialContent: '部分草稿\nnot finished' });
        database!.insertMessage({ id: 'message-disk', roomId: 'room-disk', runId: 'run-disk', turnId: 'turn-disk', senderType: 'agent', senderName: 'Draft author', content: '部分草稿\nnot finished', status: 'streaming' });
        database!.updateRun('run-disk', { currentTurnId: 'turn-disk', currentAgentId: 'agent-disk', startedAt: '2026-10-14T01:00:00.000Z' });
      });
      database.close();
      database = undefined;

      database = new Database(filename);
      database.initialize();
      expect(database.getRoom('room-disk')).toEqual({ id: 'room-disk', name: 'Disk discussion', objective: 'Keep the draft' });
      expect(database.listAgents('room-disk')).toEqual([{ id: 'agent-disk', roomId: 'room-disk', displayName: 'Draft author', roleTemplateId: 'author', displayOrder: 0,systemPrompt:'',providerId:null,modelId:null }]);
      expect(database.getRun('run-disk')).toMatchObject({
        id: 'run-disk', roomId: 'room-disk', status: 'paused',
        workflowSnapshot: { templateId: 'draft-review-finalize', rounds: 2, members: [{ agentId: 'agent-disk', modelId: 'mock' }] },
      });
      expect(database.getTurn('turn-disk')).toEqual({ id: 'turn-disk', runId: 'run-disk', agentId: 'agent-disk', status: 'running', requestId: 'request-disk', turnIndex: 0, partialContent: '部分草稿\nnot finished' });
      expect(database.listTurns('run-disk')).toEqual([{ id: 'turn-disk', runId: 'run-disk', agentId: 'agent-disk', status: 'running', requestId: 'request-disk', turnIndex: 0, partialContent: '部分草稿\nnot finished' }]);
      expect(database.getMessage('message-disk')).toEqual({ id: 'message-disk', roomId: 'room-disk', runId: 'run-disk', turnId: 'turn-disk', senderType: 'agent', senderName: 'Draft author', content: '部分草稿\nnot finished', status: 'streaming' });
      expect(database.listMessages('room-disk')).toEqual([{ id: 'message-disk', roomId: 'room-disk', runId: 'run-disk', turnId: 'turn-disk', senderType: 'agent', senderName: 'Draft author', content: '部分草稿\nnot finished', status: 'streaming' }]);
      database.close();
      database = undefined;

      // getRun does not expose these existing SQL columns yet.
      reader = new DatabaseDriver(filename, { readonly: true, fileMustExist: true });
      expect(reader.prepare('SELECT mode, max_turns, max_duration_ms, output_token_limit, current_turn_id, current_agent_id, started_at FROM workflow_runs WHERE id = ?').get('run-disk')).toEqual({
        mode: 'step', max_turns: 7, max_duration_ms: 90210, output_token_limit: 128,
        current_turn_id: 'turn-disk', current_agent_id: 'agent-disk', started_at: '2026-10-14T01:00:00.000Z',
      });
    } finally {
      reader?.close();
      database?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps event cursors exclusive and isolated by run after reopening a disk database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'roundtable-database-events-'));
    const filename = join(directory, 'roundtable.db');
    let database: Database | undefined;
    const timestamp = '2026-10-14T01:00:00.000Z';

    try {
      database = new Database(filename);
      database.initialize();
      database.insertRoom({ id: 'room-events', name: 'Events', objective: '' });
      database.insertRun({ id: 'run-a', roomId: 'room-events', status: 'running', workflowSnapshot: {} });
      database.insertRun({ id: 'run-b', roomId: 'room-events', status: 'running', workflowSnapshot: {} });
      expect(database.appendRunEvent({ runId: 'run-a', type: 'run_state_changed', payload: { status: 'running' }, timestamp }).sequence).toBe(1);
      expect(database.appendRunEvent({ runId: 'run-b', type: 'run_state_changed', payload: { status: 'running' }, timestamp }).sequence).toBe(1);
      expect(database.appendRunEvent({ runId: 'run-a', type: 'text_delta', payload: { text: 'A first' }, timestamp,protocolVersion:0,requestId:undefined }).sequence).toBe(2);
      expect(database.appendRunEvent({ runId: 'run-b', type: 'text_delta', payload: { text: 'B only' }, timestamp,protocolVersion:0,requestId:undefined }).sequence).toBe(2);
      expect(database.appendRunEvent({ runId: 'run-a', type: 'text_delta', payload: { text: 'A second' }, timestamp,protocolVersion:0,requestId:undefined }).sequence).toBe(3);
      database.close();
      database = undefined;

      database = new Database(filename);
      database.initialize();
      expect(database.listRunEvents('run-a', 1)).toEqual([
        { runId: 'run-a', turnId: undefined, sequence: 2, type: 'text_delta', payload: { text: 'A first' }, timestamp,protocolVersion:0,requestId:undefined },
        { runId: 'run-a', turnId: undefined, sequence: 3, type: 'text_delta', payload: { text: 'A second' }, timestamp,protocolVersion:0,requestId:undefined },
      ]);
      expect(database.listRunEvents('run-a', 2)).toEqual([{ runId: 'run-a', turnId: undefined, sequence: 3, type: 'text_delta', payload: { text: 'A second' }, timestamp,protocolVersion:0,requestId:undefined }]);
      expect(database.listRunEvents('run-a', 3)).toEqual([]);
      expect(database.listRunEvents('run-a', 4)).toEqual([]);
      expect(database.listRunEvents('run-b', 1)).toEqual([{ runId: 'run-b', turnId: undefined, sequence: 2, type: 'text_delta', payload: { text: 'B only' }, timestamp,protocolVersion:0,requestId:undefined }]);
      expect(database.listRunEvents('run-b', 2)).toEqual([]);
    } finally {
      database?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('records a migration version only once across repeated initialization and disk reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'roundtable-database-version-'));
    const filename = join(directory, 'roundtable.db');
    let database: Database | undefined;
    let reader: DatabaseDriver.Database | undefined;

    try {
      database = new Database(filename);
      database.initialize();
      database.initialize();
      database.close();
      database = undefined;
      reader = new DatabaseDriver(filename, { readonly: true, fileMustExist: true });
      const firstVersions = reader.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all();
      expect(firstVersions).toEqual([{ version: 1, applied_at: expect.any(String) },{version:2,applied_at:expect.any(String)},{version:3,applied_at:expect.any(String)},{version:4,applied_at:expect.any(String)},{version:5,applied_at:expect.any(String)},{version:6,applied_at:expect.any(String)},{version:7,applied_at:expect.any(String)},{version:8,applied_at:expect.any(String)},{version:9,applied_at:expect.any(String)}]);
      reader.close();
      reader = undefined;

      database = new Database(filename);
      database.initialize();
      database.initialize();
      database.close();
      database = undefined;
      reader = new DatabaseDriver(filename, { readonly: true, fileMustExist: true });
      expect(reader.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all()).toEqual(firstVersions);
    } finally {
      reader?.close();
      database?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
