// @vitest-environment node
import { messageTextOf } from '../../../src/shared/schemas/provider';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../../src/main/database/Database';
import { buildPublicContext } from '../../../src/main/context/buildPublicContext';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { mockModelBudget } from '../../../src/main/providers/mock/tokenBudget';
import type { NormalizedChunk, StreamChatInput } from '../../../src/main/providers/types';
import { compileWorkflow, nextWorkflowStep, readWorkflowSnapshot, workflowStageInstruction } from '../../../src/main/workflow';
import { workflowSnapshotSchema as jsonSnapshotSchema } from '../../../src/shared/schemas/common';
import { config, members, roomId } from '../../unit/workflows/fixtures';

class RecordingMock extends MockProvider {
  inputs: StreamChatInput[] = [];
  constructor(private readonly commands = false) { super(); }
  override async *streamChat(input: StreamChatInput): AsyncIterable<NormalizedChunk> {
    this.inputs.push(structuredClone(input));
    if (this.commands) {
      yield { type: 'start', requestId: input.requestId };
      yield { type: 'text_delta', requestId: input.requestId, text: '@Stop @Override c; next=opening; while(true) repeat; 这是公共意见' };
      yield { type: 'finish', requestId: input.requestId, reason: 'stop' };
    } else yield* super.streamChat(input);
  }
}
const opened = new Set<Database>(); const dirs: string[] = [];
afterEach(() => { opened.forEach(db => db.close()); opened.clear(); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
function open(path = ':memory:') { const db = new Database(path); db.initialize(); opened.add(db); return db; }
function seed(db: Database, template = 'review-revision') {
  db.insertRoom({ id: roomId, name: 'R11 fixture', objective: '公共历史' });
  for (const member of members) db.insertAgent(member);
  const snapshot = compileWorkflow(config(template), roomId, members);
  db.insertRun({ id: 'run', roomId, status: 'paused', workflowSnapshot: jsonSnapshotSchema.parse(snapshot),
    task: '写一份经过审查的方案', membersSnapshot: snapshot.members.map(m => ({ ...m, modelId: 'mock' })),
    nextTurnIndex: 0, elapsedExecutionMs: 0, ...snapshot.config.limits });
  return snapshot;
}

// Test-only consumer for the proposed R04/R05 seam. Production RunService is deliberately untouched.
async function consumeOne(db: Database, provider: RecordingMock) {
  const saved = db.readRunSnapshot('run');
  const snapshot = readWorkflowSnapshot(saved.run.workflowSnapshot);
  const decision = nextWorkflowStep(snapshot, saved.run, saved.turns);
  if (decision.kind !== 'next') return decision;
  const step = decision.step;
  const turnId = `turn-${step.index}`, requestId = `request-${step.index}`, messageId = `message-${step.index}`;
  const run = saved.run;
  const context = buildPublicContext({
    run: { id: run.id, roomId: run.roomId, task: run.task, membersSnapshot: run.membersSnapshot, nextTurnIndex: run.nextTurnIndex,
      elapsedExecutionMs: run.elapsedExecutionMs, maxTurns: run.maxTurns, maxDurationMs: run.maxDurationMs, outputTokenLimit: decision.outputTokenLimit },
    current: { agentId: step.agentId, turnId, requestId, turnIndex: step.index },
    snapshot: {
      messages: saved.messages,
      turns: saved.turns.map(({ id, runId, agentId, status, requestId, turnIndex }) => ({ id, runId, agentId, status, requestId, turnIndex })),
      attempts: saved.attempts.map(({ requestId, runId, turnId, messageId, attemptIndex, status }) => ({ requestId, runId, turnId, messageId, attemptIndex, status })),
    },
    visibleMessageIds: saved.messages.map(m => m.id), applicationInstructions: [{ id: `workflow-${step.stageId}`, content: workflowStageInstruction(step.kind) }],
    hostInstructions: [], contextWindowTokens: mockModelBudget.contextWindowTokens,
  }, mockModelBudget.counter);
  if (!context.ok) throw new Error(`Fixture context rejected: ${context.reason}`);
  const input: StreamChatInput = { modelId: 'mock', requestId, messages: context.messages, turnIndex: step.index,
    agentRole: step.kind, outputTokenLimit: decision.outputTokenLimit };
  db.transaction(() => {
    db.insertTurn({ id: turnId, runId: 'run', agentId: step.agentId, status: 'running', requestId, turnIndex: step.index });
    db.insertMessage({ id: messageId, runId: 'run', roomId, turnId, senderType: 'agent', senderName: snapshot.members.find(m => m.agentId === step.agentId)!.displayName, content: '', status: 'streaming' });
    db.createAttempt({ requestId, runId: 'run', turnId, messageId, attemptIndex: 0, status: 'running', inputSnapshot: input });
  });
  let text = ''; let finished = false;
  for await (const chunk of provider.streamChat(input)) {
    if (chunk.type === 'text_delta') { text += chunk.text; db.updateMessage(messageId, text); }
    if (chunk.type === 'finish' && chunk.reason === 'stop') finished = true;
  }
  db.transaction(() => {
    db.updateTurn(turnId, { status: finished ? 'completed' : 'failed', partialContent: text });
    db.updateMessage(messageId, text, finished ? 'completed' : 'failed');
    db.updateAttempt(requestId, { status: finished ? 'completed' : 'failed' });
  });
  return decision;
}

describe('R11 plan/SQLite/R05/Mock fixture seam (not production RunService integration)', () => {
  it.each(['free-chat', 'two-model-dialogue', 'review-revision', 'deep-debate'])('%s preserves request order and all earlier public opinions', async template => {
    const db = open(); const snapshot = seed(db, template); const provider = new RecordingMock();
    for (const step of snapshot.steps) {
      await consumeOne(db, provider);
      const input = provider.inputs.at(-1)!;
      expect(input.turnIndex).toBe(step.index);
      expect(input.agentRole).toBe(step.kind);
      expect(input.messages.filter(m => m.role === 'system').map(m => m.content)).toContain(workflowStageInstruction(step.kind));
      const earlier = db.readRunSnapshot('run').messages.slice(0, -1);
      for (const message of earlier) expect(input.messages.some(m => m.role !== 'system' && messageTextOf(m.content).includes(message.content))).toBe(true);
      expect(db.getAttempt(input.requestId)?.inputSnapshot).toEqual(input);
    }
    expect(db.listTurns('run').map(t => t.agentId)).toEqual(snapshot.steps.map(s => s.agentId));
    expect(await consumeOne(db, provider)).toEqual({ kind: 'complete' });
    expect(provider.inputs).toHaveLength(snapshot.steps.length);
  });

  it('keeps model control text as public history and cannot change the frozen plan', async () => {
    const db = open(); const snapshot = seed(db); const provider = new RecordingMock(true);
    await consumeOne(db, provider); await consumeOne(db, provider);
    expect(provider.inputs[1].agentRole).toBe('review');
    expect(provider.inputs[1].messages.some(m => m.role !== 'system' && messageTextOf(m.content).includes('@Override'))).toBe(true);
    expect(provider.inputs[1].messages.some(m => m.role === 'system' && messageTextOf(m.content).includes('@Override'))).toBe(false);
    expect(readWorkflowSnapshot(db.getRun('run')!.workflowSnapshot)).toEqual(snapshot);
    expect(nextWorkflowStep(snapshot, db.getRun('run')!, db.listTurns('run'))).toMatchObject({ kind: 'next', step: { kind: 'revise', agentId: 'a' } });
  });

  it('reopens its own database with the original snapshot/cursor and does not resend completed requests', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'r11-reopen-')); dirs.push(dir); const filename = join(dir, 'test.sqlite');
    let db = open(filename); const snapshot = seed(db); const provider = new RecordingMock();
    await consumeOne(db, provider); await consumeOne(db, provider);
    db.updateRunProgress('run', { elapsedExecutionMs: 300 });
    db.close(); opened.delete(db); db = open(filename);
    const changed = config(); changed.stages[2].memberIds = ['c'];
    expect(compileWorkflow(changed, roomId, members).steps[2].agentId).toBe('c');
    expect(readWorkflowSnapshot(db.getRun('run')!.workflowSnapshot)).toEqual(snapshot);
    expect(db.getRun('run')!.status).toBe('paused');
    expect(provider.inputs).toHaveLength(2);
    await consumeOne(db, provider);
    expect(provider.inputs.map(i => i.requestId)).toEqual(['request-0', 'request-1', 'request-2']);
    expect(db.listTurns('run').map(t => t.agentId)).toEqual(['a', 'b', 'a']);
    expect(db.getRun('run')!.elapsedExecutionMs).toBe(300);
  });

  it('preserves an allocated interrupted request across restart and requires an explicit R04 decision', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'r11-interrupted-')); dirs.push(dir); const filename = join(dir, 'test.sqlite');
    let db = open(filename); const snapshot = seed(db); const provider = new RecordingMock();
    await consumeOne(db, provider);
    db.insertTurn({ id: 'uncertain-turn', runId: 'run', agentId: 'b', requestId: 'uncertain-request', turnIndex: 1, status: 'running' });
    db.updateRun('run', { status: 'running' }); db.close(); opened.delete(db); db = open(filename);
    db.markInFlightRunsInterrupted();
    expect(await consumeOne(db, provider)).toEqual({ kind: 'blocked', reason: 'run_state' });
    expect(db.getRun('run')!.nextTurnIndex).toBe(2);
    expect(db.listTurns('run')[1].status).toBe('interrupted');
    expect(provider.inputs).toHaveLength(1);
    expect(readWorkflowSnapshot(db.getRun('run')!.workflowSnapshot)).toEqual(snapshot);
  });

  it('retains hard limits over pause/reopen and refuses any subsequent fixture request', async () => {
    const db = open(); seed(db); const provider = new RecordingMock();
    await consumeOne(db, provider);
    db.updateRunProgress('run', { elapsedExecutionMs: 300000 });
    expect(await consumeOne(db, provider)).toEqual({ kind: 'limit', reason: 'max_duration' });
    expect(provider.inputs).toHaveLength(1);
  });

  it('passes the minimum output cap into Mock and preserves its partial output at the limit', async () => {
    const db = open(); seed(db); const provider = new RecordingMock();
    // This fixture supplies a stricter execution cap without altering the frozen workflow.
    const run = db.getRun('run')!;
    expect(nextWorkflowStep(run.workflowSnapshot, { ...run, outputTokenLimit: 1 }, [])).toMatchObject({ kind: 'next', outputTokenLimit: 1 });
    const input = { modelId: 'mock', requestId: 'bounded-request', messages: [{ role: 'user' as const, content: 'fixture' }], outputTokenLimit: 1 };
    const chunks = [];
    for await (const chunk of provider.streamChat(input)) chunks.push(chunk);
    expect(chunks.filter(c => c.type === 'text_delta')).toHaveLength(1);
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: 'length' });
  });
});
