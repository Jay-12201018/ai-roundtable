// @vitest-environment node
import { describe, expect, it,vi } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';

function fixture(status = 'running') {
  const db = new Database(':memory:'); db.initialize();
  db.insertRoom({ id: 'room', name: 'R03', objective: 'different from task' });
  db.insertAgent({ id: 'agent', roomId: 'room', displayName: 'A', roleTemplateId: 'draft', displayOrder: 0 });
  db.insertRun({ id: 'run', roomId: 'room', status, workflowSnapshot: {} });
  return db;
}

describe('R03 integrated persistence', () => {
  it('rolls back a state change if its corresponding event cannot be persisted',async()=>{
    const db=fixture('interrupted');const service=new RunService(db,new MockProvider());
    const spy=vi.spyOn(db,'appendRunEvent').mockImplementation(()=>{throw new Error('injected event failure');});
    try {
      await expect(service.recoverInterruptedRun('run','discard')).rejects.toThrow('injected event failure');
      expect(db.getRun('run')?.status).toBe('interrupted');expect(db.getRunEventSequence('run')).toBe(0);
    } finally {spy.mockRestore();db.close();}
  });
  it('rejects invalid execution metadata without leaving a partial Run',()=>{
    const db=fixture();
    try {
      expect(()=>db.insertRun({id:'bad',roomId:'room',status:'idle',workflowSnapshot:{},membersSnapshot:[{agentId:'agent',displayName:'A',roleTemplateId:'draft',systemPrompt:'',providerId:null,modelId:'mock',displayOrder:-1}]})).toThrow();
      expect(db.getRun('bad')).toBeUndefined();
    } finally {db.close();}
  });
  it('saves the actual task, ordered members, attempts and progress without exposing request inputs', async () => {
    const directory=mkdtempSync(join(tmpdir(),'roundtable-r03-reopen-'));
    const path=join(directory,'source.db');const db = new Database(path); db.initialize();
    const service = new RunService(db, new MockProvider({ tokenDelayMs: 0 }));
    try {
      const roomId = service.createDemoRoom('room objective');
      const started = await service.start({ roomId, task: 'actual frozen task', workflowSnapshot: {}, mode: 'step' });
      await service.waitForIdle(started.runId);
      const run = db.getRun(started.runId)!;
      expect(run.task).toBe('actual frozen task');
      expect(run.membersSnapshot?.map(member => member.displayName)).toEqual(['起草者', '审查者', '综合者']);
      expect(run.nextTurnIndex).toBe(1);
      expect(run.elapsedExecutionMs).toBeGreaterThanOrEqual(0);
      const attempts = db.listAttempts(started.runId);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].inputSnapshot?.messages).toEqual([{ role: 'user', content: 'actual frozen task' }]);
      expect(attempts[0].status).toBe('completed');
      expect(service.getSnapshot(started.runId).attempts?.[0].requestId).toBe(attempts[0].requestId);
      expect(JSON.stringify(service.getSnapshot(started.runId))).not.toContain('inputSnapshot');
      const elapsed=run.elapsedExecutionMs!;
      await service.resumeRun(started.runId);
      expect(db.getRun(started.runId)?.mode).toBe('automatic');
      expect(db.getRun(started.runId)?.elapsedExecutionMs).toBeGreaterThanOrEqual(elapsed);
      await service.shutdown();
      const persisted=db.readRunSnapshot(started.runId);db.close();
      const reopened=new Database(path);
      try {await reopened.initialize();expect(reopened.readRunSnapshot(started.runId)).toEqual(persisted);}
      finally {reopened.close();}
    } finally { try {await service.shutdown();} finally {db.close();rmSync(directory,{recursive:true,force:true});} }
  });

  it('keeps missing historical execution data explicitly unknown', () => {
    const db = fixture();
    try {
      expect(db.getRun('run')).toMatchObject({ task: null, membersSnapshot: null, nextTurnIndex: null, elapsedExecutionMs: null });
    } finally { db.close(); }
  });

  it('interrupts paused parents only, preserves partial output and is idempotent', () => {
    const db = fixture('paused');
    try {
      db.insertTurn({ id: 'turn', runId: 'run', agentId: 'agent', status: 'running', requestId: 'request', turnIndex: 0 });
      db.insertMessage({ id: 'message', roomId: 'room', runId: 'run', turnId: 'turn', senderType: 'agent', senderName: 'A', content: 'partial', status: 'streaming' });
      db.insertRun({ id: 'done', roomId: 'room', status: 'completed', workflowSnapshot: {} });
      db.insertTurn({ id: 'other', runId: 'done', agentId: 'agent', status: 'running', requestId: 'other-request', turnIndex: 0 });
      expect(db.markInFlightRunsInterrupted()).toBe(1);
      expect(db.getRun('run')?.status).toBe('interrupted');
      expect(db.getTurn('turn')?.status).toBe('interrupted');
      expect(db.getMessage('message')).toMatchObject({ content: 'partial', status: 'aborted' });
      expect(db.getTurn('other')?.status).toBe('running');
      expect(db.markInFlightRunsInterrupted()).toBe(0);
      expect(db.listRunEvents('run', 0)).toHaveLength(1);
    } finally { db.close(); }
  });

  it('returns exact appended events and rolls back sequence allocation', () => {
    const db = fixture();
    try {
      const event = db.appendRunEvent({ runId: 'run', type: 'run_state_changed', payload: { status: 'running' } });
      expect(event).toMatchObject({ runId: 'run', sequence: 1, payload: { status: 'running' } });
      expect(() => db.transaction(() => { db.appendRunEvent({ runId: 'run', type: 'run_state_changed', payload: { status: 'paused' } }); throw new Error('rollback'); })).toThrow('rollback');
      expect(db.getRunEventSequence('run')).toBe(1);
      expect(db.appendRunEvent({ runId: 'run', type: 'run_state_changed', payload: { status: 'paused' } }).sequence).toBe(2);
    } finally { db.close(); }
  });

  it('binds message cursors to one run and paginates without missing or repeating rows', () => {
    const db = fixture();
    try {
      db.insertRun({ id: 'other', roomId: 'room', status: 'completed', workflowSnapshot: {} });
      for (const [id, runId] of [['a', 'run'], ['other-message', 'other'], ['b', 'run'], ['c', 'run']]) {
        db.insertMessage({ id, roomId: 'room', runId, senderType: 'agent', senderName: 'A', content: id });
      }
      const first = db.listRunMessages('run', { limit: 2 });
      expect(first.messages.map(message => message.id)).toEqual(['a', 'b']);
      expect(first.hasMore).toBe(true);
      const last = db.listRunMessages('run', { after: first.nextCursor, limit: 2 });
      expect(last.messages.map(message => message.id)).toEqual(['c']);
      expect(last.hasMore).toBe(false);
      expect(() => db.listRunMessages('other', { after: first.nextCursor, limit: 2 })).toThrow();
      expect(() => db.listRunMessages('run', { limit: 501 })).toThrow();
    } finally { db.close(); }
  });
});
