// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { RunService } from '../../../src/main/services/RunService';
import type { RunEvent } from '../../../src/shared/types/run';
import type { StreamChatInput } from '../../../src/main/providers/types';

function fixture() {
  const db = new Database(':memory:'); db.initialize();
  const service = new RunService(db, new MockProvider({ stopAfterDeltas: 1 }));
  const roomId = service.createDemoRoom('events');
  return { db, service, roomId };
}

describe('R04 committed events and context injection', () => {
  it('notifies exact committed sequential events without reading the full event history', async () => {
    const f = fixture(); const events: RunEvent[] = [];
    const observations: boolean[] = [];
    const history = vi.spyOn(f.db, 'listRunEvents').mockImplementation(() => { throw new Error('push must not read history'); });
    const off = f.service.onEvent(event => {
      events.push(event);
      const snapshot = f.service.getSnapshot(event.runId);
      observations.push(!f.db['db'].inTransaction && snapshot.sequence === event.sequence);
      if (event.type === 'turn_started') observations.push(snapshot.attempts?.some(a => a.requestId === event.requestId && a.messageId === event.payload.messageId) === true);
      if (event.type === 'run_state_changed' && event.payload.status === 'completed') {
        observations.push(snapshot.execution?.currentTurnId === null && snapshot.execution.currentAgentId === null && !f.service.hasActiveRuns());
      }
    });
    try {
      const run = await f.service.start({ roomId: f.roomId, task: 'task', maxTurns: 1, workflowSnapshot: {} }); await f.service.waitForIdle(run.runId);
      expect(observations.length).toBeGreaterThan(0); expect(observations.every(Boolean)).toBe(true);
      expect(events.map(e => e.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(events.map(e => e.type)).toEqual(['run_state_changed', 'turn_started', 'text_delta', 'usage_updated', 'turn_completed', 'run_state_changed']);
      history.mockRestore(); expect(f.service.subscribe(run.runId, 0).events).toEqual(events);
    } finally { history.mockRestore(); off(); await f.service.shutdown(); f.db.close(); }
  });

  it('rolls back a failed Turn transaction with no ghost notification or Provider request', async () => {
    const f = fixture(); const events: RunEvent[] = [];
    const off = f.service.onEvent(e => events.push(e));
    const append = f.db.appendRunEvent.bind(f.db);
    const spy = vi.spyOn(f.db, 'appendRunEvent').mockImplementation(event => {
      if (event.type === 'turn_started') throw new Error('injected event failure');
      return append(event);
    });
    try {
      const run = await f.service.start({ roomId: f.roomId, task: 'task', workflowSnapshot: {} }); await f.service.waitForIdle(run.runId);
      expect(f.db.readRunSnapshot(run.runId)).toMatchObject({ run: { status: 'error', nextTurnIndex: 0 }, turns: [], messages: [], attempts: [] });
      expect(events.map(e => e.type)).toEqual(['run_state_changed', 'run_state_changed']);
      expect(events.map(e => e.sequence)).toEqual([1, 2]); expect(f.service.hasActiveRuns()).toBe(false);
    } finally { spy.mockRestore(); off(); await f.service.shutdown(); f.db.close(); }
  });

  it('releases the in-memory gate if initial state/event persistence rolls back', async () => {
    const f = fixture(); const seen: RunEvent[] = []; const off = f.service.onEvent(e => seen.push(e));
    const spy = vi.spyOn(f.db, 'appendRunEvent').mockImplementation(() => { throw new Error('injected start failure'); });
    try {
      await expect(f.service.start({ roomId: f.roomId, task: 'task', workflowSnapshot: {} })).rejects.toThrow('injected start failure');
      expect(f.db['db'].prepare('SELECT COUNT(*) FROM workflow_runs').pluck().get()).toBe(0);
      expect(seen).toEqual([]); expect(f.service.hasActiveRuns()).toBe(false);
      spy.mockRestore(); const run = await f.service.start({ roomId: f.roomId, task: 'task', maxTurns: 1, workflowSnapshot: {} });
      await f.service.waitForIdle(run.runId); expect(f.service.getSnapshot(run.runId).status).toBe('completed');
    } finally { spy.mockRestore(); off(); await f.service.shutdown(); f.db.close(); }
  });

  it('can explicitly Stop again after final cancellation persistence temporarily fails', async () => {
    const db = new Database(':memory:'); db.initialize();
    const service = new RunService(db, new MockProvider({ stallAfterDeltas: 1 }));
    let sawText!: () => void; const text = new Promise<void>(resolve => { sawText = resolve; });
    const off = service.onEvent(e => { if (e.type === 'text_delta') sawText(); });
    const append = db.appendRunEvent.bind(db);
    let fail = true;
    const spy = vi.spyOn(db, 'appendRunEvent').mockImplementation(event => {
      if (fail && event.type === 'run_state_changed' && (event.payload as { status: string }).status === 'cancelled') throw new Error('temporary final write failure');
      return append(event);
    });
    try {
      const run = await service.start({ roomId: service.createDemoRoom('write failure'), task: 'task', workflowSnapshot: {} }); await text;
      await expect(service.stop(run.runId)).rejects.toThrow('temporary final write failure');
      expect(service.hasActiveRuns()).toBe(true); expect(service.getSnapshot(run.runId).status).toBe('cancelling');
      fail = false; await service.stop(run.runId);
      expect(service.getSnapshot(run.runId)).toMatchObject({ status: 'cancelled', messages: [{ content: 'Mock', status: 'aborted' }] });
      expect(service.hasActiveRuns()).toBe(false);
    } finally { fail = false; spy.mockRestore(); off(); await service.shutdown(); db.close(); }
  });

  it('never commits a terminal parent with active child evidence after a failed Turn finalization', async () => {
    const db = new Database(':memory:'); db.initialize();
    const service = new RunService(db, new MockProvider({ errorAfterDeltas: 1 }));
    const append = db.appendRunEvent.bind(db); let injected = false;
    const spy = vi.spyOn(db, 'appendRunEvent').mockImplementation(event => {
      if (event.type === 'turn_failed' && !injected) { injected = true; throw new Error('temporary Turn write failure'); }
      return append(event);
    });
    try {
      const run = await service.start({ roomId: service.createDemoRoom('Turn rollback'), task: 'task', maxTurns: 1, workflowSnapshot: {} });
      await service.waitForIdle(run.runId);
      expect(db.readRunSnapshot(run.runId)).toMatchObject({ run: { status: 'error' }, turns: [{ status: 'failed' }],
        attempts: [{ status: 'failed' }], messages: [{ content: 'Mock', status: 'failed' }] });
      expect(service.subscribe(run.runId, 0).events.filter(e => e.type === 'turn_failed')).toHaveLength(1);
      expect(service.hasActiveRuns()).toBe(false);
    } finally { spy.mockRestore(); await service.shutdown(); db.close(); }
  });

  it('persists exactly the injected Provider messages and frozen member at each call', async () => {
    const db = new Database(':memory:'); db.initialize(); const inputs: StreamChatInput[] = [];
    class RecordingProvider extends MockProvider {
      override async *streamChat(input: StreamChatInput) { inputs.push(input); yield* super.streamChat(input); }
    }
    const service = new RunService(db, new RecordingProvider(), (run, member, turnIndex) => [
      { role: 'system', content: `trusted ${member.displayName}` },
      { role: 'user', content: `${run.task}:${turnIndex}` },
    ]);
    try {
      const run = await service.start({ roomId: service.createDemoRoom('different objective'), task: 'actual task', workflowSnapshot: {} }); await service.waitForIdle(run.runId);
      expect(inputs.map(i => i.messages)).toEqual([
        [{ role: 'system', content: 'trusted 起草者' }, { role: 'user', content: 'actual task:0' }],
        [{ role: 'system', content: 'trusted 审查者' }, { role: 'user', content: 'actual task:1' }],
        [{ role: 'system', content: 'trusted 综合者' }, { role: 'user', content: 'actual task:2' }],
      ]);
      for (const input of inputs) {
        const { signal, ...saved } = input;
        expect(db.getAttempt(input.requestId)?.inputSnapshot).toEqual(saved);
      }
      expect(JSON.stringify(service.getSnapshot(run.runId))).not.toContain('inputSnapshot');
    } finally { await service.shutdown(); db.close(); }
  });
});
