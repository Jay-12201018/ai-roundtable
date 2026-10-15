// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import type { NormalizedChunk, StreamChatInput } from '../../../src/shared/contracts/provider';
import type { RunStatus, TurnStatus } from '../../../src/shared/types/run';
import { publicError } from '../../../src/shared/schemas/error';

type SavedInput = Omit<StreamChatInput, 'signal'>;

class RecordingProvider extends MockProvider {
  readonly inputs: SavedInput[] = [];

  constructor(private readonly failFirst = false) { super(); }

  override async *streamChat(input: StreamChatInput): AsyncIterable<NormalizedChunk> {
    const { signal, ...saved } = input;
    this.inputs.push(structuredClone(saved));
    if (this.failFirst && this.inputs.length === 1) {
      yield { type: 'start', requestId: input.requestId, providerRequestId: 'private-provider-id' };
      yield { type: 'text_delta', requestId: input.requestId, text: 'retained partial' };
      yield { type: 'error', requestId: input.requestId, error: publicError('network_error') };
      return;
    }
    yield* super.streamChat(input);
  }
}

const databases: Database[] = [];
const services: RunService[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) await service.shutdown();
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function openDatabase(filename = ':memory:') {
  const database = new Database(filename);
  databases.push(database);
  await database.initialize();
  return database;
}

function serviceFor(database: Database, provider = new RecordingProvider()) {
  const service = new RunService(database, provider);
  services.push(service);
  return { service, provider };
}

async function fixture(options: {
  filename?: string;
  runStatus?: RunStatus;
  attemptStatus?: TurnStatus;
  content?: string;
  maxTurns?: number;
} = {}) {
  const database = await openDatabase(options.filename);
  const runStatus = options.runStatus ?? 'error';
  const attemptStatus = options.attemptStatus ?? 'failed';
  const content = options.content ?? 'retained partial';
  database.insertRoom({ id: 'room', name: 'Recovery fixture', objective: 'different live objective' });
  const members = [
    { agentId: 'agent-0', displayName: 'Frozen drafter', roleTemplateId: 'Drafter', displayOrder: 0 },
    { agentId: 'agent-1', displayName: 'Frozen reviewer', roleTemplateId: 'Critic', displayOrder: 1 },
    { agentId: 'agent-2', displayName: 'Frozen finalizer', roleTemplateId: 'Synthesizer', displayOrder: 2 },
  ];
  for (const member of members) database.insertAgent({
    id: member.agentId, roomId: 'room', displayName: `Changed ${member.displayName}`,
    roleTemplateId: 'Changed role', displayOrder: 2 - member.displayOrder,
  });
  database.insertRun({
    id: 'run', roomId: 'room', status: runStatus, workflowSnapshot: { templateId: 'fixture' },
    task: 'frozen private task',
    membersSnapshot: members.map(member => ({ ...member, systemPrompt: '', providerId: null, modelId: 'mock' })),
    nextTurnIndex: 0, elapsedExecutionMs: 17, mode: 'step',
    maxTurns: options.maxTurns ?? 1, maxDurationMs: 300000, outputTokenLimit: 1024,
  });
  database.insertTurn({ id: 'turn-0', runId: 'run', agentId: 'agent-0', status: attemptStatus, requestId: 'request-0', turnIndex: 0 });
  database.updateTurn('turn-0', { partialContent: content });
  database.insertMessage({
    id: 'message-0', roomId: 'room', runId: 'run', turnId: 'turn-0', senderType: 'agent',
    senderName: 'Frozen drafter', content,
    status: attemptStatus === 'completed' ? 'completed' : attemptStatus === 'running' ? 'streaming' : attemptStatus === 'failed' ? 'failed' : 'aborted',
  });
  const inputSnapshot: SavedInput = {
    requestId: 'request-0', modelId: 'mock', agentRole: 'Drafter', turnIndex: 0, outputTokenLimit: 1024,
    messages: [{ role: 'system', content: 'frozen system instruction' }, { role: 'user', content: 'frozen private task' }],
  };
  database.createAttempt({ requestId: 'request-0', runId: 'run', turnId: 'turn-0', messageId: 'message-0', attemptIndex: 0, status: 'running', inputSnapshot });
  database.updateAttempt('request-0', { status: attemptStatus, providerRequestId: 'private-provider-id' });
  database.appendRunEvent({ runId: 'run', turnId: 'turn-0', requestId: 'request-0', protocolVersion: 1, type: 'turn_started', payload: { turnId: 'turn-0', messageId: 'message-0', agentId: 'agent-0', requestId: 'request-0' } });
  database.appendRunEvent({ runId: 'run', turnId: 'turn-0', requestId: 'request-0', protocolVersion: 1, type: 'text_delta', payload: { turnId: 'turn-0', messageId: 'message-0', senderName: 'Frozen drafter', text: content } });
  return { database, inputSnapshot };
}

function evidence(database: Database, requestId = 'request-0', messageId = 'message-0') {
  return JSON.stringify({
    attempt: database['db'].prepare('SELECT * FROM request_attempts WHERE request_id=?').get(requestId),
    message: database['db'].prepare('SELECT * FROM messages WHERE id=?').get(messageId),
    events: database['db'].prepare('SELECT * FROM run_events WHERE request_id=? ORDER BY sequence').all(requestId),
  });
}

describe('explicit Run recovery and new request attempts', () => {
  it('retries a failed latest Turn in a fresh service while keeping its original request and evidence', async () => {
    const database = await openDatabase();
    const first = serviceFor(database, new RecordingProvider(true));
    const started = await first.service.start({ roomId: first.service.createDemoRoom('retry'), task: 'private retry task', workflowSnapshot: {}, maxTurns: 1 });
    await first.service.waitForIdle(started.runId);
    const turn = database.listTurns(started.runId)[0];
    const original = database.listAttempts(started.runId)[0];
    expect(original.status).toBe('failed');
    expect(database.getMessage(original.messageId)?.content).toBe('retained partial');
    const before = evidence(database, original.requestId, original.messageId);
    const { service, provider } = serviceFor(database);

    await service.retryTurn(started.runId, turn.id);
    await service.waitForIdle(started.runId);

    const attempts = database.listAttempts(started.runId);
    expect(provider.inputs).toHaveLength(1);
    expect(database.listTurns(started.runId)).toHaveLength(1);
    expect(database.getTurn(turn.id)?.requestId).toBe(original.requestId);
    expect(attempts.map(attempt => attempt.attemptIndex)).toEqual([0, 1]);
    expect(attempts[1]).toMatchObject({ turnId: turn.id, status: 'completed' });
    expect(attempts[1].requestId).not.toBe(original.requestId);
    expect(attempts[1].messageId).not.toBe(original.messageId);
    expect(provider.inputs[0]).toEqual({ ...original.inputSnapshot, requestId: attempts[1].requestId });
    expect(evidence(database, original.requestId, original.messageId)).toBe(before);
    expect(database.getRun(started.runId)).toMatchObject({ status: 'completed', nextTurnIndex: 1 });
    const snapshot = service.getSnapshot(started.runId);
    expect(snapshot.turns[0].requestId).toBe(attempts[1].requestId);
    expect(snapshot.messages).toHaveLength(2);
    expect(JSON.stringify(snapshot)).not.toMatch(/inputSnapshot|providerRequestId|private-provider-id/);
  });

  it('continues a partial latest message with the original input and saves only the new suffix separately', async () => {
    const { database, inputSnapshot } = await fixture({ runStatus: 'cancelled', attemptStatus: 'aborted' });
    const before = evidence(database);
    const { service, provider } = serviceFor(database);

    await service.continueMessage('run', 'message-0');
    await service.waitForIdle('run');

    const attempts = database.listAttempts('run');
    expect(provider.inputs).toHaveLength(1);
    expect(provider.inputs[0].messages.slice(0, -2)).toEqual(inputSnapshot.messages);
    expect(provider.inputs[0].messages.at(-2)).toEqual({ role: 'assistant', content: 'retained partial' });
    expect(provider.inputs[0].messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringMatching(/\S/) });
    expect(attempts.map(attempt => attempt.attemptIndex)).toEqual([0, 1]);
    expect(attempts[1].requestId).not.toBe('request-0');
    expect(attempts[1].messageId).not.toBe('message-0');
    expect(database.getMessage(attempts[1].messageId)).toMatchObject({ status: 'completed', content: expect.stringContaining('Mock 起草') });
    expect(database.getMessage(attempts[1].messageId)?.content).not.toContain('retained partial');
    expect(database.getTurn('turn-0')?.requestId).toBe('request-0');
    expect(database.listTurns('run')).toHaveLength(1);
    expect(evidence(database)).toBe(before);
  });

  it('rejects continuation without partial content before creating a new request', async () => {
    const { database } = await fixture({ runStatus: 'cancelled', attemptStatus: 'aborted', content: '' });
    const before = evidence(database);
    const { service, provider } = serviceFor(database);

    await expect(service.continueMessage('run', 'message-0')).rejects.toMatchObject({ code: 'invalid_state' });

    expect(provider.inputs).toEqual([]);
    expect(database.listAttempts('run')).toHaveLength(1);
    expect(evidence(database)).toBe(before);
  });

  it('rejects retry of an earlier logical Turn', async () => {
    const { database } = await fixture({ maxTurns: 2 });
    database.insertTurn({ id: 'turn-1', runId: 'run', agentId: 'agent-1', status: 'failed', requestId: 'request-1', turnIndex: 1 });
    database.insertMessage({ id: 'message-1', runId: 'run', roomId: 'room', turnId: 'turn-1', senderType: 'agent', senderName: 'Frozen reviewer', content: 'later partial', status: 'failed' });
    database.createAttempt({ requestId: 'request-1', runId: 'run', turnId: 'turn-1', messageId: 'message-1', attemptIndex: 0, status: 'running', inputSnapshot: { requestId: 'request-1', modelId: 'mock', messages: [] } });
    database.updateAttempt('request-1', { status: 'failed' });
    const before = database.readRunSnapshot('run');
    const { service, provider } = serviceFor(database);

    await expect(service.retryTurn('run', 'turn-0')).rejects.toMatchObject({ code: 'invalid_state' });

    expect(provider.inputs).toEqual([]);
    expect(database.readRunSnapshot('run')).toEqual(before);
  });

  it('rejects continuation of an older Attempt of the latest Turn', async () => {
    const { database } = await fixture();
    database.insertMessage({ id: 'message-1', runId: 'run', roomId: 'room', turnId: 'turn-0', senderType: 'agent', senderName: 'Frozen drafter', content: 'latest partial', status: 'failed' });
    database.createAttempt({ requestId: 'request-1', runId: 'run', turnId: 'turn-0', messageId: 'message-1', attemptIndex: 1, status: 'running', inputSnapshot: { requestId: 'request-1', modelId: 'mock', messages: [] } });
    database.updateAttempt('request-1', { status: 'failed' });
    const before = database.readRunSnapshot('run');
    const { service, provider } = serviceFor(database);

    await expect(service.continueMessage('run', 'message-0')).rejects.toMatchObject({ code: 'invalid_state' });

    expect(provider.inputs).toEqual([]);
    expect(database.readRunSnapshot('run')).toEqual(before);
  });

  it('inspects and discards interruption without issuing a Provider request or changing old evidence', async () => {
    const { database } = await fixture({ runStatus: 'running', attemptStatus: 'running' });
    expect(database.markInFlightRunsInterrupted()).toBe(1);
    const before = evidence(database);
    const initial = database.readRunSnapshot('run');
    const { service, provider } = serviceFor(database);

    await service.recoverInterruptedRun('run', 'inspect');
    expect(database.readRunSnapshot('run')).toEqual(initial);
    await service.recoverInterruptedRun('run', 'discard');

    expect(database.getRun('run')?.status).toBe('cancelled');
    expect(provider.inputs).toEqual([]);
    expect(evidence(database)).toBe(before);
    expect(database.listAttempts('run')).toHaveLength(1);
  });

  it('reopens a private disk database and requires explicit retry before replacing an interrupted request', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'roundtable-r04-recovery-'));
    directories.push(directory);
    const filename = join(directory, 'run.sqlite3');
    const { database: original } = await fixture({ filename, runStatus: 'running', attemptStatus: 'running' });
    original.markInFlightRunsInterrupted();
    const before = evidence(original);
    original.close();
    const database = await openDatabase(filename);
    const { service, provider } = serviceFor(database);

    await service.recoverInterruptedRun('run', 'inspect');
    const inspected = service.subscribe('run', 0);
    expect(inspected.snapshot.status).toBe('interrupted');
    expect(inspected.resyncRequired).toBe(false);
    expect(provider.inputs).toEqual([]);
    expect(JSON.stringify(inspected)).not.toMatch(/inputSnapshot|providerRequestId|private-provider-id|frozen system instruction/);
    await service.recoverInterruptedRun('run', 'retry');
    await service.waitForIdle('run');

    const attempts = database.listAttempts('run');
    expect(provider.inputs).toHaveLength(1);
    expect(attempts.map(attempt => attempt.status)).toEqual(['interrupted', 'completed']);
    expect(attempts.map(attempt => attempt.attemptIndex)).toEqual([0, 1]);
    expect(attempts[1].requestId).not.toBe('request-0');
    expect(attempts[1].messageId).not.toBe('message-0');
    expect(database.getRun('run')).toMatchObject({ status: 'completed', nextTurnIndex: 1 });
    expect(database.getTurn('turn-0')?.requestId).toBe('request-0');
    expect(evidence(database)).toBe(before);
    const completed = service.subscribe('run', 0);
    expect(completed.resyncRequired).toBe(false);
    expect(completed.snapshot.messages).toHaveLength(2);
    expect(completed.snapshot.attempts).toHaveLength(2);
    expect(JSON.stringify(completed)).not.toMatch(/inputSnapshot|providerRequestId|private-provider-id|frozen system instruction/);
  });

  it('resumes persisted scheduling from frozen members, next Turn index and cumulative elapsed', async () => {
    const { database } = await fixture({ runStatus: 'paused', attemptStatus: 'completed', maxTurns: 2 });
    database.markInFlightRunsInterrupted();
    const before = evidence(database);
    const { service, provider } = serviceFor(database);

    await service.recoverInterruptedRun('run', 'resume');
    await service.waitForIdle('run');

    expect(provider.inputs).toHaveLength(1);
    expect(provider.inputs[0]).toMatchObject({ turnIndex: 1, agentRole: 'Critic', modelId: 'mock', outputTokenLimit: 1024 });
    expect(provider.inputs[0].messages).toContainEqual({ role: 'user', content: 'frozen private task' });
    expect(provider.inputs[0].requestId).not.toBe('request-0');
    expect(database.listTurns('run').map(turn => turn.agentId)).toEqual(['agent-0', 'agent-1']);
    expect(database.listRunMessages('run', { limit: 10 }).messages.map(message => message.senderName)).toEqual(['Frozen drafter', 'Frozen reviewer']);
    expect(database.getRun('run')).toMatchObject({ status: 'completed', nextTurnIndex: 2 });
    expect(database.getRun('run')!.elapsedExecutionMs).toBeGreaterThanOrEqual(17);
    expect(evidence(database)).toBe(before);
  });

  it('refuses resume while an old interrupted Attempt still requires an explicit retry decision', async () => {
    const { database } = await fixture({ runStatus: 'running', attemptStatus: 'running' });
    database.markInFlightRunsInterrupted();
    const before = database.readRunSnapshot('run');
    const { service, provider } = serviceFor(database);

    await expect(service.recoverInterruptedRun('run', 'resume')).rejects.toMatchObject({ code: 'invalid_state' });

    expect(provider.inputs).toEqual([]);
    expect(database.readRunSnapshot('run')).toEqual(before);
  });

  it.each(['resume', 'retry'] as const)('keeps legacy unknown execution metadata unsupported for %s', async decision => {
    const database = await openDatabase();
    database.insertRoom({ id: 'room', name: 'Legacy', objective: 'must not become the task' });
    database.insertRun({ id: 'run', roomId: 'room', status: 'interrupted', workflowSnapshot: {} });
    const { service, provider } = serviceFor(database);

    await expect(service.recoverInterruptedRun('run', decision)).rejects.toMatchObject({ code: 'unsupported' });

    expect(provider.inputs).toEqual([]);
    expect(database.getRun('run')).toMatchObject({ status: 'interrupted', task: null, membersSnapshot: null, nextTurnIndex: null, elapsedExecutionMs: null });
  });

  it('rejects generation and recovery commands on a completed Run', async () => {
    const { database } = await fixture({ runStatus: 'completed', attemptStatus: 'completed' });
    const before = database.readRunSnapshot('run');
    const { service, provider } = serviceFor(database);

    await expect(service.retryTurn('run', 'turn-0')).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(service.continueMessage('run', 'message-0')).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(service.recoverInterruptedRun('run', 'retry')).rejects.toMatchObject({ code: 'invalid_state' });

    expect(provider.inputs).toEqual([]);
    expect(database.readRunSnapshot('run')).toEqual(before);
  });

  it('rejects an unknown recovery decision before any state or request changes', async () => {
    const { database } = await fixture({ runStatus: 'interrupted', attemptStatus: 'interrupted' });
    const before = database.readRunSnapshot('run');
    const { service, provider } = serviceFor(database);

    await expect(service.recoverInterruptedRun('run', 'restart' as never)).rejects.toMatchObject({ code: 'invalid_input' });

    expect(provider.inputs).toEqual([]);
    expect(database.readRunSnapshot('run')).toEqual(before);
  });
});
