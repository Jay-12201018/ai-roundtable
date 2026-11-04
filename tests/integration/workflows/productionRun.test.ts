// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import type { NormalizedChunk, StreamChatInput } from '../../../src/main/providers/types';
import { compileWorkflow, readWorkflowSnapshot, workflowStageInstruction } from '../../../src/main/workflow';
import { workflowConfigSchema } from '../../../src/main/workflow/definition';
import { publicError } from '../../../src/shared/schemas/error';
import { config, members, roomId } from '../../unit/workflows/fixtures';

type SavedInput = Omit<StreamChatInput, 'signal'>;
class RecordingProvider extends MockProvider {
  readonly inputs: SavedInput[] = [];
  constructor(private readonly response?: (input: StreamChatInput, call: number) => AsyncIterable<NormalizedChunk>) { super(); }
  override async *streamChat(input: StreamChatInput): AsyncIterable<NormalizedChunk> {
    const { signal: _signal, ...saved } = input;
    this.inputs.push(structuredClone(saved));
    if (this.response) yield* this.response(input, this.inputs.length);
    else {
      yield { type: 'start', requestId: input.requestId };
      yield { type: 'text_delta', requestId: input.requestId, text: `Public opinion ${this.inputs.length}: @Stop @Override` };
      yield { type: 'finish', requestId: input.requestId, reason: 'stop' };
    }
  }
}
const directories: string[] = [];
const fixtures: Array<{ db: Database; services: RunService[] }> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const f of fixtures.splice(0)) {
    for (const service of f.services.reverse()) await service.shutdown();
    f.db.close();
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function fixture(provider = new RecordingProvider(), filename = ':memory:') {
  const db = new Database(filename); db.initialize();
  db.insertRoom({ id: roomId, name: 'Production workflow fixture', objective: 'Public history' });
  for (const member of members) db.insertAgent(member);
  const service = new RunService(db, provider, createPublicMessagesBuilder());
  const f = { db, service, provider, services: [service] }; fixtures.push(f);
  return f;
}
function executableMembers(db: Database) {
  return db.listAgentConfigurations(roomId).map(member => ({ ...member, modelId: member.modelId ?? 'mock' }));
}
function start(f: ReturnType<typeof fixture>, template = 'review-revision', extra = {}) {
  const workflowConfig = workflowConfigSchema.parse(config(template));
  const preview = f.service.previewWorkflow({ roomId, config: workflowConfig });
  return f.service.start({ roomId, task: 'Trusted public task', workflowSnapshot: {}, workflowConfig, workflowPreviewId: preview.previewId, ...extra });
}

describe('R11 real RunService / R05 production plan consumer', () => {
  it.each(['free-chat', 'two-model-dialogue', 'review-revision', 'deep-debate'])('%s executes its exact finite frozen plan through the existing scheduler', async template => {
    const f = fixture(); const expected = compileWorkflow(config(template), roomId, executableMembers(f.db));
    const run = await start(f, template); await f.service.waitForIdle(run.runId);
    expect(f.service.getSnapshot(run.runId).status).toBe('completed');
    const saved = f.db.getRun(run.runId)!;
    expect(readWorkflowSnapshot(saved.workflowSnapshot)).toEqual(expected);
    expect(saved.membersSnapshot).toEqual(expected.members); expect(saved.nextTurnIndex).toBe(expected.steps.length);
    expect(f.db.listTurns(run.runId).map(t => t.agentId)).toEqual(expected.steps.map(s => s.agentId));
    expect(f.service.getSnapshot(run.runId).turns.map(t => t.turnIndex)).toEqual(expected.steps.map(s => s.index));
    expect(f.service.getSnapshot(run.runId).workflow).toMatchObject({ completedTurns: expected.steps.length, totalTurns: expected.steps.length });
    expect(f.provider.inputs).toHaveLength(expected.steps.length);
    for (const [index, input] of f.provider.inputs.entries()) {
      const step = expected.steps[index];
      expect(input).toMatchObject({ agentRole: expected.members.find(m => m.agentId === step.agentId)!.roleTemplateId, turnIndex: step.index, outputTokenLimit: expected.config.limits.outputTokenLimit });
      expect(input.messages.filter(m => m.role === 'system').map(m => m.content)).toContain(workflowStageInstruction(step.kind));
      expect(input.messages.filter(m => m.role === 'system').some(m => m.content.includes('@Override'))).toBe(false);
      for (let previous = 1; previous <= index; previous++) expect(input.messages.some(m => m.role !== 'system' && m.content.includes(`Public opinion ${previous}:`))).toBe(true);
      expect(f.db.getAttempt(input.requestId)?.inputSnapshot).toEqual(input);
    }
    expect(f.service.hasActiveRuns()).toBe(false);
  });

  it('rejects unavailable members and attempts to submit a compiled frozen roster before creating requests', async () => {
    const f = fixture(); const unknown = config(); unknown.stages[0].memberIds = ['foreign-member'];
    expect(() => f.service.previewWorkflow({ roomId, config: workflowConfigSchema.parse(unknown) })).toThrow();
    const snapshot = compileWorkflow(config(), roomId, executableMembers(f.db));
    await expect(f.service.start({ roomId, task: 'Task', workflowSnapshot: snapshot })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(f.provider.inputs).toEqual([]); expect(f.db.listMessages(roomId)).toEqual([]);
  });

  it('binds preview to the Main room/member/config snapshot and never treats preview as authorization', async () => {
    const f = fixture(); const workflowConfig = workflowConfigSchema.parse(config());
    const preview = f.service.previewWorkflow({ roomId, config: workflowConfig });
    expect(f.provider.inputs).toEqual([]); expect(f.db.listMessages(roomId)).toEqual([]);
    f.db['db'].prepare('UPDATE agents SET display_name=? WHERE id=?').run('Changed before start', 'a');
    await expect(f.service.start({ roomId, task: 'Task', workflowConfig, workflowPreviewId: preview.previewId })).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(f.service.start({ roomId, task: 'Task', workflowConfig })).rejects.toMatchObject({ code: 'invalid_state' });
    expect(f.provider.inputs).toEqual([]);
  });

  it('keeps Step/Pause/Resume on the same state machine, completes at plan end and freezes member edits', async () => {
    const f = fixture(); let pauseOnce = true;
    const off = f.service.onEvent(event => { if (event.type === 'text_delta' && pauseOnce) { pauseOnce = false; f.service.pause(event.runId); } });
    try {
      const run = await start(f); await f.service.waitForIdle(run.runId);
      expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'paused', workflow: { completedTurns: 1, nextStep: { kind: 'review', agentId: 'b' } } });
      expect(f.provider.inputs).toHaveLength(1); const frozen = f.db.getRun(run.runId)!.workflowSnapshot;
      f.db['db'].prepare('UPDATE agents SET display_name=?,role_template_id=?,system_prompt=? WHERE id=?').run('Changed live member', 'Changed', 'Changed prompt', 'b');
      const step = f.service.step(run.runId);
      await expect(f.service.step(run.runId)).rejects.toMatchObject({ code: 'invalid_state' }); await step;
      expect(f.service.getSnapshot(run.runId).status).toBe('paused'); expect(f.provider.inputs).toHaveLength(2);
      expect(f.provider.inputs[1].messages.some(m => m.role === 'system' && m.content.includes('Changed'))).toBe(false);
      expect(f.db.listMessages(roomId)[1].senderName).toBe('成员 b');
      await f.service.resumeRun(run.runId);
      expect(f.service.getSnapshot(run.runId).status).toBe('completed'); expect(f.provider.inputs).toHaveLength(5);
      expect(f.db.getRun(run.runId)!.workflowSnapshot).toEqual(frozen);
    } finally { off(); }
  });

  it('keeps the failed logical step and its old evidence on explicit retry', async () => {
    const provider = new RecordingProvider(async function* ({ requestId }, call) {
      yield { type: 'start', requestId }; yield { type: 'text_delta', requestId, text: `Opinion ${call}` };
      if (call === 1) throw new Error('fixture network interruption');
      yield { type: 'finish', requestId, reason: 'stop' };
    });
    const f = fixture(provider); const run = await start(f, 'review-revision', { mode: 'step' }); await f.service.waitForIdle(run.runId);
    const failed = f.db.listAttempts(run.runId)[0]; const old = structuredClone(failed);
    expect(f.service.getSnapshot(run.runId).status).toBe('error');
    await f.service.retryTurn(run.runId, failed.turnId);
    expect(f.db.listTurns(run.runId)).toHaveLength(1); expect(f.db.getRun(run.runId)!.nextTurnIndex).toBe(1);
    expect(provider.inputs[1]).toEqual({ ...provider.inputs[0], requestId: provider.inputs[1].requestId });
    expect(f.db.getAttempt(failed.requestId)).toEqual(old);
    await f.service.resumeRun(run.runId);
    expect(provider.inputs).toHaveLength(6); expect(f.db.listTurns(run.runId).map(t => t.agentId)).toEqual(['a', 'b', 'a', 'b', 'c']);
    expect(f.service.getSnapshot(run.runId).status).toBe('completed');
  });

  it('does not infer authorization from next-step or restart and requires explicit recovery', async () => {
    const f = fixture(); const run = await start(f, 'review-revision', { mode: 'step' }); await f.service.waitForIdle(run.runId);
    f.db.markInFlightRunsInterrupted();
    const fresh = new RunService(f.db, f.provider, createPublicMessagesBuilder()); f.services.push(fresh);
    expect(fresh.getSnapshot(run.runId).status).toBe('interrupted'); expect(f.provider.inputs).toHaveLength(1);
    await fresh.recoverInterruptedRun(run.runId, 'inspect'); expect(f.provider.inputs).toHaveLength(1);
    await expect(fresh.step(run.runId)).rejects.toMatchObject({ code: 'invalid_state' });
    await fresh.recoverInterruptedRun(run.runId, 'resume');
    expect(fresh.getSnapshot(run.runId).status).toBe('paused'); expect(f.provider.inputs).toHaveLength(2);
    expect(f.db.listTurns(run.runId).map(t => t.agentId)).toEqual(['a', 'b']);
    const latest = f.db.listAttempts(run.runId).at(-1)!;
    f.db['db'].prepare('UPDATE request_attempts SET status=? WHERE request_id=?').run('interrupted', latest.requestId);
    await expect(fresh.resumeRun(run.runId)).rejects.toMatchObject({ code: 'invalid_state' }); expect(f.provider.inputs).toHaveLength(2);
  });

  it('aborts the current step on Stop, retains partial output and never starts the next stage', async () => {
    const f = fixture(new RecordingProvider(async function* ({ requestId, signal }) {
      yield { type: 'start', requestId }; yield { type: 'text_delta', requestId, text: 'retained partial' };
      if (!signal?.aborted) await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), { once: true }));
      yield { type: 'finish', requestId, reason: 'stop' };
    }));
    let stop: Promise<void> | undefined;
    const off = f.service.onEvent(event => { if (event.type === 'text_delta') stop = f.service.stop(event.runId); });
    try {
      const run = await start(f); await f.service.waitForIdle(run.runId); await stop;
      expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'cancelled', messages: [{ content: 'retained partial', status: 'aborted' }], attempts: [{ status: 'aborted' }] });
      expect(f.provider.inputs).toHaveLength(1); expect(f.db.getRun(run.runId)!.nextTurnIndex).toBe(1);
    } finally { off(); }
  });

  it('honors stricter execution output/turn limits without allocating another request', async () => {
    const f = fixture(); const run = await start(f, 'review-revision', { maxTurns: 2, outputTokenLimit: 32 }); await f.service.waitForIdle(run.runId);
    expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'completed', workflow: { completedTurns: 2, totalTurns: 5, limitReason: 'max_turns' } });
    expect(f.provider.inputs).toHaveLength(2); expect(f.provider.inputs.every(input => input.outputTokenLimit === 32)).toBe(true);
  });

  it('reopens its private SQLite with the frozen plan and never silently reinterprets a legacy or unknown workflow', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'r11-production-reopen-')); directories.push(directory);
    const filename = join(directory, 'test.sqlite'); const f = fixture(new RecordingProvider(), filename);
    const run = await start(f, 'review-revision', { mode: 'step' }); await f.service.waitForIdle(run.runId);
    const frozen = structuredClone(f.db.getRun(run.runId)!.workflowSnapshot);
    // The old process is gone: retain no old service reference in the simulated new process.
    f.services.splice(0); f.db.close(); f.db = new Database(filename); await f.db.initialize(); f.db.markInFlightRunsInterrupted();
    f.service = new RunService(f.db, f.provider, createPublicMessagesBuilder()); f.services.push(f.service);
    f.db['db'].prepare('UPDATE agents SET display_name=?,role_template_id=?').run('Current changed member', 'Changed');
    expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'interrupted', workflow: { completedTurns: 1, nextStep: { index: 1, kind: 'review' } } });
    expect(f.provider.inputs).toHaveLength(1);
    await f.service.recoverInterruptedRun(run.runId, 'resume');
    expect(f.provider.inputs).toHaveLength(2); expect(f.db.listMessages(roomId)[1].senderName).toBe('成员 b');
    expect(f.db.getRun(run.runId)!.workflowSnapshot).toEqual(frozen);
    f.db['db'].prepare('UPDATE workflow_runs SET workflow_snapshot=? WHERE id=?').run(JSON.stringify({ ...frozen, version: 2 }), run.runId);
    expect(f.service.getSnapshot(run.runId).workflow).toBeUndefined();
    await expect(f.service.resumeRun(run.runId)).rejects.toMatchObject({ code: 'invalid_state' }); expect(f.provider.inputs).toHaveLength(2);
  });

  it('retains the plan and partial request when its cumulative time expires inside a stage', async () => {
    vi.useFakeTimers();
    const f = fixture(new RecordingProvider(async function* ({ requestId }) {
      yield { type: 'start', requestId }; yield { type: 'text_delta', requestId, text: 'partial before timeout' };
      await new Promise<void>(() => {});
    }));
    const run = await start(f, 'review-revision', { maxDurationMs: 50 });
    await vi.advanceTimersByTimeAsync(50); await f.service.waitForIdle(run.runId);
    expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'error', workflow: { completedTurns: 0, limitReason: 'max_duration' },
      messages: [{ status: 'aborted', content: 'partial before timeout' }], attempts: [{ status: 'aborted' }] });
    expect(f.provider.inputs).toHaveLength(1); expect(readWorkflowSnapshot(f.db.getRun(run.runId)!.workflowSnapshot).steps).toHaveLength(5);
  });

  describe('D146 the duration limit', () => {
    const hangingFirst = () => new RecordingProvider(async function* ({ requestId }, call) {
      yield { type: 'start', requestId };
      if (call === 1) { yield { type: 'text_delta', requestId, text: 'partial before the limit' }; await new Promise<void>(() => {}); }
      yield { type: 'text_delta', requestId, text: `opinion ${call}` }; yield { type: 'finish', requestId, reason: 'stop' };
    });
    const reasons = (f: ReturnType<typeof fixture>, runId: string) => f.db.listRunEvents(runId, 0).filter(event => event.type === 'run_state_changed').map(event => (event.payload as { reason?: string }).reason).filter(Boolean);
    // As after a restart: the old service holds nothing of the Run any more.
    const another = async (f: ReturnType<typeof fixture>) => {
      await f.service.shutdown(); f.services.length = 0;
      const service = new RunService(f.db, f.provider, createPublicMessagesBuilder()); f.services.push(service); return service;
    };

    it('allows two hours unless told otherwise; a plan\'s own lower limit still holds', async () => {
      const f = fixture();
      const free = await f.service.start({ roomId, task: 'Task', workflowSnapshot: {}, maxTurns: 1 });
      expect(f.db.getRun(free.runId)!.maxDurationMs).toBe(7_200_000);
      await f.service.waitForIdle(free.runId);
      const planned = await start(f, 'free-chat');
      expect(f.db.getRun(planned.runId)!.maxDurationMs).toBe(300000);
      await f.service.waitForIdle(planned.runId);
    });

    it('stops, sends nothing more on its own, and carries on from the unfinished turn when the host asks, with time to finish', async () => {
      const f = fixture(hangingFirst());
      const run = await start(f, 'review-revision', { maxDurationMs: 50 });
      await f.service.waitForIdle(run.runId);
      const stopped = f.service.getSnapshot(run.runId);
      expect(stopped).toMatchObject({ status: 'error', durationStop: { limitMs: 50, nextAllowanceMs: 7_200_000 }, messages: [{ status: 'aborted', content: 'partial before the limit' }] });
      expect(reasons(f, run.runId)).toEqual(['Maximum run duration reached']);
      expect(f.provider.inputs).toHaveLength(1);
      const usedUp = stopped.execution!.elapsedExecutionMs!;
      await f.service.resumeRun(run.runId);
      const finished = f.service.getSnapshot(run.runId);
      expect(finished.status).toBe('completed');
      expect(finished.durationStop).toBeUndefined();
      expect(f.provider.inputs).toHaveLength(6);
      expect(finished.workflow).toMatchObject({ completedTurns: 5, totalTurns: 5 });
      expect(finished.attempts!.filter(attempt => attempt.status === 'aborted')).toHaveLength(1);
      expect(finished.messages.some(message => message.content === 'partial before the limit')).toBe(true);
      expect(f.db.getRun(run.runId)!.maxDurationMs).toBe(usedUp + 7_200_000);
      expect(finished.execution!.elapsedExecutionMs!).toBeLessThan(f.db.getRun(run.runId)!.maxDurationMs);
    });

    it('the retry button works the same', async () => {
      const f = fixture(hangingFirst());
      const run = await start(f, 'free-chat', { maxDurationMs: 50 });
      await f.service.waitForIdle(run.runId);
      await f.service.retryTurn(run.runId, f.db.listTurns(run.runId)[0].id);
      expect(f.service.getSnapshot(run.runId).status).toBe('completed');
    });

    it('a Run left stopped by an older version reads the same and is untouched until the host continues; the next member speaks if no turn was cut', async () => {
      const f = fixture();
      const run = await start(f, 'review-revision', { mode: 'step' });
      await f.service.waitForIdle(run.runId);
      expect(f.service.getSnapshot(run.runId).status).toBe('paused');
      const later = await another(f);
      f.db.updateRunProgress(run.runId, { elapsedExecutionMs: 300000 });
      f.db.updateRun(run.runId, { status: 'error', finishedAt: new Date().toISOString() });
      expect(later.getSnapshot(run.runId).durationStop).toEqual({ limitMs: 300000, nextAllowanceMs: 7_200_000 });
      expect(f.db.getRun(run.runId)!.maxDurationMs).toBe(300000);
      expect(f.provider.inputs).toHaveLength(1);
      await later.resumeRun(run.runId);
      expect(later.getSnapshot(run.runId).status).toBe('paused');
      expect(f.provider.inputs).toHaveLength(2);
      expect(f.db.getRun(run.runId)!.maxDurationMs).toBe(7_500_000);
    });

    it('a paused discussion out of time resumes too', async () => {
      const f = fixture();
      const run = await start(f, 'free-chat', { mode: 'step' });
      await f.service.waitForIdle(run.runId);
      const later = await another(f);
      f.db.updateRunProgress(run.runId, { elapsedExecutionMs: 300000 });
      f.db.updateRun(run.runId, { status: 'paused', finishedAt: null });
      expect(later.getSnapshot(run.runId).durationStop).toBeUndefined();
      await later.resumeRun(run.runId);
      expect(later.getSnapshot(run.runId).status).toBe('completed');
    });

    it('a request that times out by itself is that request\'s failure, not the limit', async () => {
      const f = fixture(new RecordingProvider(async function* ({ requestId }, call) {
        yield { type: 'start', requestId };
        if (call === 1) { yield { type: 'error', requestId, error: publicError('timeout') }; return; }
        yield { type: 'text_delta', requestId, text: 'answer' }; yield { type: 'finish', requestId, reason: 'stop' };
      }));
      const run = await start(f, 'free-chat');
      await f.service.waitForIdle(run.runId);
      const stopped = f.service.getSnapshot(run.runId);
      expect(stopped.status).toBe('error');
      expect(stopped.durationStop).toBeUndefined();
      expect(stopped.lastFailure).toMatchObject({ code: 'timeout' });
      expect(reasons(f, run.runId)).toEqual([]);
      expect(f.db.listRunEvents(run.runId, 0).map(event => event.type)).toContain('turn_failed');
      await f.service.retryTurn(run.runId, f.db.listTurns(run.runId)[0].id);
      expect(f.service.getSnapshot(run.runId).status).toBe('completed');
      expect(f.db.getRun(run.runId)!.maxDurationMs).toBe(300000);
    });
  });

  it('ends exactly after the configured stage and does not mark omitted later stages as executed', async () => {
    const f = fixture(); const workflowConfig = workflowConfigSchema.parse({ ...config(), endCondition: { type: 'after_stage', stageId: 'review' } });
    const preview = f.service.previewWorkflow({ roomId, config: workflowConfig });
    const run = await f.service.start({ roomId, task: 'Task', workflowConfig, workflowPreviewId: preview.previewId }); await f.service.waitForIdle(run.runId);
    expect(f.provider.inputs).toHaveLength(2);
    expect(f.service.getSnapshot(run.runId)).toMatchObject({ status: 'completed', workflow: { completedTurns: 2, totalTurns: 2,
      stages: [{ id: 'draft', status: 'completed', totalTurns: 1 }, { id: 'review', status: 'completed', totalTurns: 1 }] } });
  });

  it.each(['room', 'members', 'latest-attempt'])('rejects mutated %s identity evidence before another Provider call', async mutation => {
    const f = fixture(); const run = await start(f, 'review-revision', { mode: 'step' }); await f.service.waitForIdle(run.runId);
    const saved = f.db.getRun(run.runId)!;
    if (mutation === 'latest-attempt') f.db['db'].prepare('UPDATE request_attempts SET status=? WHERE request_id=?').run('interrupted', f.db.listAttempts(run.runId)[0].requestId);
    else {
      const changed = structuredClone(saved.workflowSnapshot);
      if (mutation === 'room') changed.roomId = 'foreign-room';
      else (changed.members as Array<{ displayName: string }>)[0].displayName = 'Altered frozen member';
      f.db['db'].prepare('UPDATE workflow_runs SET workflow_snapshot=? WHERE id=?').run(JSON.stringify(changed), run.runId);
    }
    await expect(f.service.resumeRun(run.runId)).rejects.toMatchObject({ code: 'invalid_state' }); expect(f.provider.inputs).toHaveLength(1);
  });
});
