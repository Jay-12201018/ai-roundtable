// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { RunService } from '../../../src/main/services/RunService';
import type { NormalizedChunk, StreamChatInput } from '../../../src/main/providers/types';
import { publicError } from '../../../src/shared/schemas/error';

class FixtureProvider extends MockProvider {
  readonly inputs: StreamChatInput[] = [];
  constructor(private readonly stream: (input: StreamChatInput) => AsyncIterable<NormalizedChunk>) { super(); }
  override async *streamChat(input: StreamChatInput) { this.inputs.push(input); yield* this.stream(input); }
}

function fixture(provider: MockProvider = new MockProvider()) {
  const db = new Database(':memory:'); db.initialize();
  const service = new RunService(db, provider);
  const roomId = service.createDemoRoom('R04');
  return { db, service, roomId, start: (options = {}) => service.start({ roomId, task: 'frozen task', workflowSnapshot: {}, ...options }) };
}

afterEach(() => vi.useRealTimers());

describe('R04 authoritative scheduling', () => {
  it('completes a three-member step at maxTurns=1 without a second click', async () => {
    const f = fixture();
    try {
      const run = await f.start({ mode: 'step', maxTurns: 1 }); await f.service.waitForIdle(run.runId);
      expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'completed', execution: { nextTurnIndex: 1, currentTurnId: null, currentAgentId: null } });
      expect(f.db.listTurns(run.runId)).toHaveLength(1); expect(f.service.hasActiveRuns()).toBe(false);
    } finally { await f.service.shutdown(); f.db.close(); }
  });

  it('cycles frozen members until maxTurns rather than stopping at member count', async () => {
    const f = fixture();
    try {
      const run = await f.start({ maxTurns: 7 }); await f.service.waitForIdle(run.runId);
      expect(f.db.listMessages(f.roomId).map(m => m.senderName)).toEqual(['起草者', '审查者', '综合者', '起草者', '审查者', '综合者', '起草者']);
      expect(f.db.getRun(run.runId)?.nextTurnIndex).toBe(7);
    } finally { await f.service.shutdown(); f.db.close(); }
  });

  it('holds the global lock before the first committed notification can reenter start', async () => {
    const f = fixture(); const secondRoom = f.service.createDemoRoom('second');
    let nested: Promise<unknown> | undefined; let entered = false;
    const off = f.service.onEvent(event => {
      if (event.type === 'run_state_changed' && event.payload.status === 'running' && !entered) {
        entered = true;
        nested = f.service.start({ roomId: secondRoom, task: 'second', workflowSnapshot: {}, maxTurns: 1 });
        void nested.catch(() => {});
      }
    });
    try {
      const run = await f.start({ maxTurns: 1 });
      await expect(nested).rejects.toThrow(/active run/i); await f.service.waitForIdle(run.runId);
      expect(f.db.listMessages(secondRoom)).toEqual([]);
    } finally { off(); await f.service.shutdown(); f.db.close(); }
  });

  it('soft-pauses only after the active Turn and rejects duplicate Step scheduling', async () => {
    const f = fixture(); let paused = false;
    const off = f.service.onEvent(event => {
      if (event.type === 'text_delta' && !paused) { paused = true; f.service.pause(event.runId); f.service.pause(event.runId); }
    });
    try {
      const run = await f.start(); await f.service.waitForIdle(run.runId);
      expect(f.db.listTurns(run.runId)).toHaveLength(1); expect(f.db.listAttempts(run.runId)[0].status).toBe('completed');
      expect(f.service.getSnapshot(run.runId).status).toBe('paused');
      const first = f.service.step(run.runId);
      await expect(f.service.step(run.runId)).rejects.toThrow(); await first;
      expect(f.db.listTurns(run.runId)).toHaveLength(2); expect(f.service.hasActiveRuns()).toBe(true);
      await f.service.resumeRun(run.runId); expect(f.service.getSnapshot(run.runId).status).toBe('completed');
    } finally { off(); await f.service.shutdown(); f.db.close(); }
  });

  it('passes a token limit to Provider without counting deltas as tokens', async () => {
    const provider = new FixtureProvider(async function* ({ requestId }) {
      yield { type: 'start', requestId };
      for (const text of ['a', 'b', 'c', 'd', 'e']) yield { type: 'text_delta', requestId, text };
      yield { type: 'usage', requestId, inputTokens: 3, outputTokens: 1 };
      yield { type: 'finish', requestId, reason: 'stop' };
    });
    const f = fixture(provider);
    try {
      const run = await f.start({ maxTurns: 1, outputTokenLimit: 1 }); await f.service.waitForIdle(run.runId);
      expect(provider.inputs[0]).toMatchObject({ requestId: f.db.listAttempts(run.runId)[0].requestId, outputTokenLimit: 1 });
      expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'completed', messages: [{ content: 'abcde', status: 'completed' }] });
    } finally { await f.service.shutdown(); f.db.close(); }
  });

  it('resumes after a successful retry without treating the preserved failed Attempt as active', async () => {
    let calls = 0;
    const f = fixture(new FixtureProvider(async function* ({ requestId }) {
      yield { type: 'start', requestId }; yield { type: 'text_delta', requestId, text: 'text' };
      if (++calls === 1) throw new Error('fixture failure');
      yield { type: 'finish', requestId, reason: 'stop' };
    }));
    try {
      const run = await f.start({ mode: 'step' }); await f.service.waitForIdle(run.runId);
      await f.service.retryTurn(run.runId, f.db.listTurns(run.runId)[0].id);
      expect(f.service.getSnapshot(run.runId).status).toBe('paused');
      await f.service.resumeRun(run.runId);
      expect(f.service.getSnapshot(run.runId).status).toBe('completed');
      expect(f.db.listAttempts(run.runId).map(a => a.status).filter(s => s === 'failed')).toEqual(['failed']);
      expect(f.db.listTurns(run.runId)).toHaveLength(3);
    } finally { await f.service.shutdown(); f.db.close(); }
  });

  it('settles a Provider-initiated cancellation through cancelling and releases the lock', async () => {
    const f = fixture(new FixtureProvider(async function* ({ requestId }) {
      yield { type: 'error', requestId, error: publicError('cancelled') };
    }));
    try {
      const run = await f.start(); await f.service.waitForIdle(run.runId);
      expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'cancelled', attempts: [{ status: 'aborted' }] });
      expect(f.service.hasActiveRuns()).toBe(false);
    } finally { await f.service.shutdown(); f.db.close(); }
  });

  it('lets Stop win a soft Pause race without starting another Turn', async () => {
    const f = fixture(new MockProvider({ stallAfterDeltas: 1 })); let stop: Promise<void> | undefined;
    const off = f.service.onEvent(e => { if (e.type === 'text_delta') { f.service.pause(e.runId); stop = f.service.stop(e.runId); } });
    try {
      const run = await f.start(); await f.service.waitForIdle(run.runId); await stop;
      expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'cancelled', turns: [{ status: 'aborted' }] });
      expect(f.db.listTurns(run.runId)).toHaveLength(1); expect(f.service.hasActiveRuns()).toBe(false);
    } finally { off(); await f.service.shutdown(); f.db.close(); }
  });

  it('lets Stop win concurrent Resume without resurrecting a terminal Run', async () => {
    const f = fixture(new MockProvider({ stopAfterDeltas: 1 }));
    try {
      const run = await f.start({ mode: 'step' }); await f.service.waitForIdle(run.runId);
      const resume = f.service.resumeRun(run.runId); const stop = f.service.stop(run.runId); await Promise.all([resume, stop]);
      expect(f.service.getSnapshot(run.runId).status).toBe('cancelled');
      expect(f.db.listTurns(run.runId)).toHaveLength(2); expect(f.service.hasActiveRuns()).toBe(false);
      await expect(f.service.resumeRun(run.runId)).rejects.toMatchObject({ code: 'invalid_state' });
    } finally { await f.service.shutdown(); f.db.close(); }
  });

  it('preserves Provider finish=content_filter as incomplete evidence', async () => {
    const f = fixture(new FixtureProvider(async function* ({ requestId }) {
      yield { type: 'start', requestId }; yield { type: 'text_delta', requestId, text: 'partial' };
      yield { type: 'finish', requestId, reason: 'content_filter' };
    }));
    try {
      const run = await f.start({ maxTurns: 1 }); await f.service.waitForIdle(run.runId);
      expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'error', messages: [{ content: 'partial', status: 'failed' }], attempts: [{ status: 'failed' }] });
      expect(f.db.getRun(run.runId)?.lastError).toContain('content_filter');
    } finally { await f.service.shutdown(); f.db.close(); }
  });

  it('settles Provider finish=length as a completed, truncated reply and keeps scheduling (D102)', async () => {
    const f = fixture(new FixtureProvider(async function* ({ requestId }) {
      yield { type: 'start', requestId }; yield { type: 'text_delta', requestId, text: 'partial' };
      yield { type: 'finish', requestId, reason: 'length' };
    }));
    try {
      const run = await f.start({ maxTurns: 2 }); await f.service.waitForIdle(run.runId);
      const snapshot = f.service.getSnapshot(run.runId);
      expect(snapshot).toMatchObject({ status: 'completed', messages: [{ content: 'partial', status: 'completed' }, { content: 'partial', status: 'completed' }] });
      expect(snapshot.turns.map(turn => turn.status)).toEqual(['completed', 'completed']);
      expect(snapshot.attempts!.map(attempt => [attempt.status, attempt.finishReason])).toEqual([['completed', 'length'], ['completed', 'length']]);
      expect(f.db.getRun(run.runId)?.lastError).toBeNull();
    } finally { await f.service.shutdown(); f.db.close(); }
  });
});

describe('R04 cumulative deadline and Abort races', () => {
  it('does not call Provider if the committed turn_started notification exhausts the budget', async () => {
    let clock = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const provider = new FixtureProvider(async function* ({ requestId }) { yield { type: 'start', requestId }; });
    const f = fixture(provider);
    const off = f.service.onEvent(event => { if (event.type === 'turn_started') clock = 100; });
    try {
      const run = await f.start({ maxDurationMs: 100, maxTurns: 1 }); await f.service.waitForIdle(run.runId);
      expect(provider.inputs).toEqual([]);
      expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'error', attempts: [{ status: 'aborted' }] });
    } finally { now.mockRestore(); off(); await f.service.shutdown(); f.db.close(); }
  });

  it('enforces the deadline even when immediate chunks starve timer callbacks', async () => {
    let clock = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const f = fixture(new FixtureProvider(async function* ({ requestId }) {
      yield { type: 'start', requestId };
      for (const text of ['a', 'b', 'late']) { clock += 40; yield { type: 'text_delta', requestId, text }; }
      yield { type: 'finish', requestId, reason: 'stop' };
    }));
    try {
      const run = await f.start({ maxDurationMs: 100, maxTurns: 1 }); await f.service.waitForIdle(run.runId);
      expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'error', messages: [{ content: 'ab', status: 'aborted' }] });
      expect(f.db.getRun(run.runId)?.elapsedExecutionMs).toBe(120);
    } finally { now.mockRestore(); await f.service.shutdown(); f.db.close(); }
  });

  it('times out inside an unresponsive Turn and ignores late output', async () => {
    vi.useFakeTimers(); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const provider = new FixtureProvider(async function* ({ requestId }) {
      yield { type: 'start', requestId }; yield { type: 'text_delta', requestId, text: 'saved' };
      await gate; yield { type: 'text_delta', requestId, text: 'late' }; yield { type: 'finish', requestId, reason: 'stop' };
    });
    const f = fixture(provider);
    try {
      const run = await f.start({ maxDurationMs: 100 }); await vi.advanceTimersByTimeAsync(100);
      expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'error', messages: [{ content: 'saved', status: 'aborted' }], attempts: [{ status: 'aborted' }] });
      expect(provider.inputs[0].signal?.aborted).toBe(true); expect(f.service.hasActiveRuns()).toBe(false);
      expect(f.service.subscribe(run.runId, 0).events.find(e => e.type === 'turn_aborted')).toMatchObject({ payload: { error: { code: 'timeout' } } });
      const before = f.db.readRunSnapshot(run.runId); release(); await vi.advanceTimersByTimeAsync(0);
      expect(f.db.readRunSnapshot(run.runId)).toEqual(before);
    } finally { release(); await f.service.shutdown(); f.db.close(); }
  });

  it('counts execution across repeated resumes but excludes long paused intervals', async () => {
    vi.useFakeTimers(); let releases: Array<() => void> = [];
    const provider = new FixtureProvider(async function* ({ requestId }) {
      yield { type: 'start', requestId }; yield { type: 'text_delta', requestId, text: 'part' };
      await new Promise<void>(resolve => releases.push(resolve)); yield { type: 'finish', requestId, reason: 'stop' };
    });
    const f = fixture(provider);
    try {
      const run = await f.start({ mode: 'step', maxTurns: 4, maxDurationMs: 100 }); await vi.advanceTimersByTimeAsync(30);
      releases.shift()!(); await vi.advanceTimersByTimeAsync(0); await f.service.waitForIdle(run.runId);
      expect(f.db.getRun(run.runId)?.elapsedExecutionMs).toBe(30);
      await vi.advanceTimersByTimeAsync(5000); expect(f.db.getRun(run.runId)?.elapsedExecutionMs).toBe(30);
      const step = f.service.step(run.runId); await vi.advanceTimersByTimeAsync(30); releases.shift()!(); await step;
      expect(f.db.getRun(run.runId)?.elapsedExecutionMs).toBe(60);
      await vi.advanceTimersByTimeAsync(9000); const resumed = f.service.resumeRun(run.runId);
      await vi.advanceTimersByTimeAsync(40);
      expect(f.service.getSnapshot(run.runId).status).toBe('error'); expect(f.db.getRun(run.runId)?.elapsedExecutionMs).toBe(100);
      await resumed; expect(provider.inputs).toHaveLength(3);
    } finally { releases.forEach(resolve => resolve()); await f.service.shutdown(); f.db.close(); }
  });

  it('Stop settles even if Provider ignores Abort and its iterator return never resolves', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const provider = new FixtureProvider(async function* ({ requestId }) {
      yield { type: 'start', requestId }; yield { type: 'text_delta', requestId, text: 'saved' };
      await gate; yield { type: 'text_delta', requestId, text: 'late' };
    });
    const f = fixture(provider);
    let sawText!: () => void; const text = new Promise<void>(resolve => { sawText = resolve; });
    const off = f.service.onEvent(e => { if (e.type === 'text_delta') sawText(); });
    try {
      const run = await f.start(); await text;
      const stop = f.service.stop(run.runId); const again = f.service.stop(run.runId);
      void again.catch(() => {});
      const outcome = await Promise.race([stop.then(() => 'stopped'), new Promise<string>(resolve => setTimeout(() => resolve('hung'), 100))]);
      expect(outcome).toBe('stopped'); await again;
      expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'cancelled', messages: [{ content: 'saved', status: 'aborted' }] });
      const before = f.db.readRunSnapshot(run.runId); release(); await new Promise(resolve => setTimeout(resolve, 0));
      expect(f.db.readRunSnapshot(run.runId)).toEqual(before);
    } finally { off(); release(); await f.service.shutdown(); f.db.close(); }
  });
});
