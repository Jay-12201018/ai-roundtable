// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { buildPublicContext } from '../../../src/main/context/buildPublicContext';
import type { ContextInput, ModelTokenCounter } from '../../../src/main/context/types';
import type { ConnectionTestResult, ListModelsInput, NormalizedChunk, ProviderAdapter, StreamChatInput, TestConnectionInput } from '../../../src/main/providers/types';
import { providerMessageSchema, streamChatInputSchema } from '../../../src/shared/schemas/provider';
import { contextInput, fixtureCounter } from '../../unit/context/fixtures';

class CapturingProvider implements ProviderAdapter {
  readonly inputs: Array<Omit<StreamChatInput, 'signal'>> = [];

  constructor(private readonly outputs = ['alpha', 'beta', 'gamma']) {}

  async listModels(_input: ListModelsInput) { return [{ id: 'fixture', name: 'Fixture' }]; }
  async testConnection(input: TestConnectionInput): Promise<ConnectionTestResult> {
    return { requestId: input.requestId, level: input.level, ok: true };
  }
  async *streamChat(input: StreamChatInput): AsyncIterable<NormalizedChunk> {
    const { signal: _signal, ...parameters } = input;
    this.inputs.push(structuredClone(streamChatInputSchema.parse(parameters)));
    const text = this.outputs[this.inputs.length - 1];
    if (text === undefined) throw new Error('Unexpected fixture request');
    yield { type: 'start', requestId: input.requestId };
    yield { type: 'text_delta', requestId: input.requestId, text };
    yield { type: 'finish', requestId: input.requestId, reason: 'stop' };
  }
}

function createRun(db: Database, runId = 'run', roomId = 'room') {
  const draft = contextInput();
  const membersSnapshot = draft.run.membersSnapshot!.map(member => ({ ...member, agentId: `${runId}-${member.agentId}` }));
  if (!db.getRoom(roomId)) db.insertRoom({ id: roomId, name: roomId, objective: 'Room objective is not the persisted task' });
  for (const member of membersSnapshot) db.insertAgent({
    id: member.agentId, roomId, displayName: member.displayName,
    roleTemplateId: member.roleTemplateId, displayOrder: member.displayOrder,
  });
  draft.run = { ...draft.run, id: runId, roomId, task: `Persisted task for ${runId}`, membersSnapshot, nextTurnIndex: 0, elapsedExecutionMs: 0 };
  db.insertRun({ ...draft.run, status: 'running', workflowSnapshot: {} });
  return draft;
}

function snapshotInput(db: Database, runId: string): ContextInput {
  const { run, turns, messages, attempts } = db.readRunSnapshot(runId);
  if (run.nextTurnIndex === null || run.membersSnapshot === null) throw new Error('Fixture has unknown metadata');
  const turnIndex = run.nextTurnIndex;
  const member = run.membersSnapshot[turnIndex];
  if (!member) throw new Error('Fixture has no current member');
  return {
    run: {
      id: run.id, roomId: run.roomId, task: run.task, membersSnapshot: run.membersSnapshot,
      nextTurnIndex: run.nextTurnIndex, elapsedExecutionMs: run.elapsedExecutionMs,
      maxTurns: run.maxTurns, maxDurationMs: run.maxDurationMs, outputTokenLimit: run.outputTokenLimit,
    },
    current: { agentId: member.agentId, turnId: `${runId}-turn-${turnIndex}`, requestId: `${runId}-request-${turnIndex}`, turnIndex },
    snapshot: {
      messages,
      turns: turns.map(({ partialContent: _partialContent, ...turn }) => turn),
      attempts: attempts.map(({ requestId, runId, turnId, messageId, status, attemptIndex }) => ({ requestId, runId, turnId, messageId, status, attemptIndex })),
    },
    visibleMessageIds: messages.map(message => message.id),
    applicationInstructions: [{ id: 'application', content: 'Respect application policy' }],
    hostInstructions: [{ id: 'host', roomId: run.roomId, runId, content: 'Compare the public proposals' }],
    contextWindowTokens: 10000,
  };
}

// This harness exercises R05 + R03 + the Adapter boundary; it is not RunService/R04 wiring.
async function execute(db: Database, input: ContextInput, provider: CapturingProvider, counter?: ModelTokenCounter) {
  const result = buildPublicContext(input, counter);
  if (!result.ok) return result;
  const member = input.run.membersSnapshot!.find(member => member.agentId === input.current.agentId)!;
  const { turnId, requestId, turnIndex } = input.current;
  const messageId = `${input.run.id}-message-${turnIndex}`;
  const request: StreamChatInput = {
    requestId, modelId: member.modelId!, messages: result.messages, outputTokenLimit: result.outputTokenLimit,
    agentRole: member.roleTemplateId, turnIndex, signal: new AbortController().signal,
  };
  const { signal: _signal, ...inputSnapshot } = request;
  db.transaction(() => {
    db.insertTurn({ id: turnId, runId: input.run.id, agentId: member.agentId, status: 'running', requestId, turnIndex });
    db.insertMessage({ id: messageId, roomId: input.run.roomId, runId: input.run.id, turnId, senderType: 'agent', senderName: member.displayName, content: '', status: 'streaming' });
    db.createAttempt({ requestId, runId: input.run.id, turnId, messageId, attemptIndex: 0, status: 'pending', inputSnapshot });
  });
  let content = '';
  let finished = false;
  for await (const chunk of provider.streamChat(request)) {
    if (chunk.type === 'start') db.updateAttempt(requestId, { status: 'running' });
    if (chunk.type === 'text_delta') {
      content += chunk.text;
      db.transaction(() => {
        db.updateMessage(messageId, content, 'streaming');
        db.updateTurn(turnId, { partialContent: content });
      });
    }
    if (chunk.type === 'finish') finished = true;
  }
  if (!finished) throw new Error('Fixture did not finish');
  db.transaction(() => {
    db.updateMessage(messageId, content, 'completed');
    db.updateTurn(turnId, { status: 'completed', partialContent: content });
    db.updateAttempt(requestId, { status: 'completed' });
  });
  return result;
}

describe('R05 context with R03 persisted snapshots and captured Adapter input', () => {
  it('passes completed public replies in persistence order and saves the exact request for each Attempt', async () => {
    const db = new Database(':memory:');
    await db.initialize();
    try {
      const draft = createRun(db);
      draft.run.task = 'Unpersisted renderer draft task';
      draft.run.membersSnapshot![0].systemPrompt = 'Unpersisted draft role';
      const provider = new CapturingProvider();
      const results = [];
      for (let index = 0; index < 3; index++) {
        const result = await execute(db, snapshotInput(db, 'run'), provider, fixtureCounter);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.reason);
        results.push(result);
      }
      expect(provider.inputs).toHaveLength(3);
      const texts = provider.inputs.map(input => input.messages.map(message => message.content).join('\n'));
      expect(texts[0]).not.toMatch(/alpha|beta|gamma/);
      expect(texts[1]).toContain('alpha');
      expect(texts[1]).not.toMatch(/beta|gamma/);
      expect(texts[2]).toContain('alpha');
      expect(texts[2]).toContain('beta');
      expect(texts[2]).not.toContain('gamma');
      expect(texts[2].indexOf('alpha')).toBeLessThan(texts[2].indexOf('beta'));
      for (const [index, request] of provider.inputs.entries()) {
        expect(request.messages.every(message => providerMessageSchema.safeParse(message).success)).toBe(true);
        expect(request.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'user', content: expect.stringContaining('Persisted task for run') })]));
        expect(texts[index]).toContain(`Prompt for ${['a', 'b', 'c'][index]}`);
        expect(texts[index]).not.toMatch(/Unpersisted|Room objective/);
        expect(db.getAttempt(request.requestId)?.inputSnapshot).toEqual(request);
        expect(db.getAttempt(request.requestId)?.status).toBe('completed');
      }
      expect(results[0].selectedHistory).toEqual([]);
      expect(results[1].selectedHistory).toEqual([expect.objectContaining({ messageId: 'run-message-0', turnId: 'run-turn-0', requestId: 'run-request-0', agentId: 'run-a', snapshotIndex: 0 })]);
      expect(results[2].selectedHistory).toEqual([
        expect.objectContaining({ messageId: 'run-message-0', turnId: 'run-turn-0', requestId: 'run-request-0', agentId: 'run-a', snapshotIndex: 0 }),
        expect.objectContaining({ messageId: 'run-message-1', turnId: 'run-turn-1', requestId: 'run-request-1', agentId: 'run-b', snapshotIndex: 1 }),
      ]);
      for (const source of results[2].selectedHistory) {
        expect(source).toMatchObject({ kind: 'history', runId: 'run', roomId: 'room' });
        expect(provider.inputs[2].messages[source.providerMessageIndex!].content).toContain(source.messageId === 'run-message-0' ? 'alpha' : 'beta');
      }
      expect(db.readRunSnapshot('run').messages.map(message => message.content)).toEqual(['alpha', 'beta', 'gamma']);
    } finally { db.close(); }
  });

  it('excludes persisted messages from another Run or room even when explicitly offered to the builder', async () => {
    const db = new Database(':memory:');
    await db.initialize();
    try {
      createRun(db);
      createRun(db, 'previous-run');
      createRun(db, 'foreign-run', 'foreign-room');
      expect((await execute(db, snapshotInput(db, 'previous-run'), new CapturingProvider(['old-run-private']), fixtureCounter)).ok).toBe(true);
      expect((await execute(db, snapshotInput(db, 'foreign-run'), new CapturingProvider(['foreign-room-private']), fixtureCounter)).ok).toBe(true);
      const input = snapshotInput(db, 'run');
      for (const runId of ['previous-run', 'foreign-run']) {
        const foreign = snapshotInput(db, runId);
        input.snapshot.messages.push(...foreign.snapshot.messages);
        input.snapshot.turns.push(...foreign.snapshot.turns);
        input.snapshot.attempts.push(...foreign.snapshot.attempts);
        input.visibleMessageIds.push(...foreign.visibleMessageIds);
      }
      const provider = new CapturingProvider(['own-room-output']);
      const refused = await execute(db, input, provider, fixtureCounter);
      expect(refused).toMatchObject({ ok: false, reason: 'invalid_identity' });
      expect(provider.inputs).toEqual([]);
      expect(db.listAttempts('run')).toEqual([]);
      // Only current-Run control metadata is a valid snapshot; foreign message rows can be reported individually.
      input.snapshot.turns = [];
      input.snapshot.attempts = [];
      const result = await execute(db, input, provider, fixtureCounter);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.reason);
      expect(result.selectedHistory).toEqual([]);
      expect(result.report.history).toEqual(expect.arrayContaining([
        expect.objectContaining({ messageId: 'previous-run-message-0', reason: 'other_run' }),
        expect.objectContaining({ messageId: 'foreign-run-message-0', reason: 'other_room' }),
      ]));
      expect(JSON.stringify(provider.inputs[0])).not.toMatch(/old-run-private|foreign-room-private/);
      expect(db.getAttempt('run-request-0')?.inputSnapshot).toEqual(provider.inputs[0]);
    } finally { db.close(); }
  });

  it('lets the test harness reject an unknown tokenizer before a Provider call or new Attempt', async () => {
    const db = new Database(':memory:');
    await db.initialize();
    try {
      createRun(db);
      const provider = new CapturingProvider();
      const before = db.readRunSnapshot('run');
      const result = await execute(db, snapshotInput(db, 'run'), provider);
      expect(result).toMatchObject({ ok: false, reason: 'token_count_unavailable' });
      expect(provider.inputs).toEqual([]);
      expect(db.listAttempts('run')).toEqual([]);
      expect(db.readRunSnapshot('run')).toEqual(before);
    } finally { db.close(); }
  });
});
