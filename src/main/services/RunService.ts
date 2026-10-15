import { randomUUID } from 'node:crypto';
import type { RunEvent, RunSnapshot, RunSubscription, RunStatus } from '../../shared/types/run';
import { assertRunCommand } from '../orchestrator/stateMachine';
import type { StartRunInput } from '../../shared/contracts/run';
import type { InterruptedRunDecision } from '../../shared/types/run';
import { ContractError, toPublicError } from '../../shared/contracts/errors';
import { publicError } from '../../shared/schemas/error';
import { runEventSchema, runSnapshotSchema, runSubscriptionSchema, startRunInputSchema } from '../../shared/schemas/run';
import { roomMessagesSchema } from '../../shared/schemas/app';
import { PROTOCOL_VERSION } from '../../shared/schemas/common';
import { normalizedChunkSchema } from '../../shared/schemas/provider';
import type { Database, RunEventRecord } from '../database/Database';
import type { ProviderAdapter, StreamChatInput } from '../providers/types';

type RunContext = {
  runId: string;
  roomId: string;
  task: string;
  mode: 'automatic' | 'step';
  maxTurns: number;
  maxDurationMs: number;
  outputTokenLimit: number;
  abortController: AbortController;
  pauseRequested: boolean;
  stopRequested: boolean;
  nextAgentIndex: number;
  promise: Promise<void>;
  members: ReturnType<Database['listAgents']>;
  elapsedBefore: number;
  segmentStartedAt: number;
};

type EventListener = (event: RunEvent) => void;

const roles = [
  { id: 'agent-drafter', name: '起草者', role: 'Drafter' },
  { id: 'agent-critic', name: '审查者', role: 'Critic' },
  { id: 'agent-synthesizer', name: '综合者', role: 'Synthesizer' },
];

export class RunService {
  private readonly contexts = new Map<string, RunContext>();
  private readonly listeners = new Set<EventListener>();
  private readonly activeRooms = new Set<string>();

  constructor(private readonly database: Database, private readonly provider: ProviderAdapter) {}

  createDemoRoom(objective: string): string {
    const roomId = randomUUID();
    this.database.transaction(() => {
      this.database.insertRoom({ id: roomId, name: 'Mock 圆桌', objective });
      roles.forEach((role, index) => this.database.insertAgent({ id: `${roomId}-${role.id}`, roomId, displayName: role.name, roleTemplateId: role.role, displayOrder: index }));
    });
    return roomId;
  }

  async start(input: StartRunInput): Promise<RunSnapshot> {
    const parsed = startRunInputSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input');
    input = parsed.data;
    if (this.activeRooms.has(input.roomId)) throw new Error('Room already has an active run');
    if (this.activeRooms.size > 0) throw new Error('Another room already has an active run');
    if (!this.database.getRoom(input.roomId)) throw new Error('Room not found');
    const runId = randomUUID();
    const context: RunContext = {
      runId,
      roomId: input.roomId,
      task: input.task,
      mode: input.mode ?? 'automatic',
      maxTurns: input.maxTurns ?? 3,
      maxDurationMs: input.maxDurationMs ?? 300000,
      outputTokenLimit: input.outputTokenLimit ?? 1024,
      abortController: new AbortController(),
      pauseRequested: false,
      stopRequested: false,
      nextAgentIndex: 0,
      promise: Promise.resolve(),
      members: this.database.listAgents(input.roomId), elapsedBefore: 0, segmentStartedAt: 0,
    };
    this.database.transaction(() => {
      this.database.insertRun({ id: runId, roomId: input.roomId, status: 'idle', workflowSnapshot: input.workflowSnapshot, mode: context.mode, maxTurns: context.maxTurns, maxDurationMs: context.maxDurationMs, outputTokenLimit: context.outputTokenLimit,
        task: input.task, membersSnapshot:context.members.map(a=>({agentId:a.id,displayName:a.displayName,roleTemplateId:a.roleTemplateId,displayOrder:a.displayOrder,systemPrompt:'',providerId:null,modelId:'mock'})),nextTurnIndex:0,elapsedExecutionMs:0 });
      this.database.updateRun(runId, { status: 'running', startedAt: new Date().toISOString() });
      this.appendEvent(runId, 'run_state_changed', { status: 'running' });
    });
    this.contexts.set(runId, context);
    this.activeRooms.add(input.roomId);
    context.promise = this.runLoop(context);
    return this.getSnapshot(runId);
  }

  async waitForIdle(runId: string): Promise<void> {
    const context = this.contexts.get(runId);
    if (context) await context.promise;
  }

  getSnapshot(runId: string): RunSnapshot {
    return this.snapshotFrom(this.database.readRunSnapshot(runId));
  }

  private snapshotFrom(data: ReturnType<Database['readRunSnapshot']>): RunSnapshot {
      const {run,turns,messages,attempts,sequence} = data;
      const {id,roomId,status,workflowSnapshot,lastError,...execution} = run;
      return runSnapshotSchema.parse({
        runId: run.id,
        roomId: run.roomId,
        status: run.status,
        sequence,
        workflowSnapshot: run.workflowSnapshot,
        currentTurnId: turns.find((turn) => turn.status === 'running')?.id,
        activeAgentId: turns.find((turn) => turn.status === 'running')?.agentId,
        turns: turns.map((turn) => {
          const attempt = attempts.filter(a=>a.turnId===turn.id).at(-1);
          const legacyMessages = messages.filter(m=>m.turnId===turn.id);
          const message = attempt ? messages.find(m=>m.id===attempt.messageId) : legacyMessages.length===1?legacyMessages[0]:undefined;
          return {turnId:turn.id,runId:turn.runId,agentId:turn.agentId,status:turn.status,requestId:attempt?.requestId??turn.requestId,messageId:message?.id,outputText:message?.content??turn.partialContent};
        }),
        messages: messages.map((message) => ({ id: message.id, senderName: message.senderName, content: message.content, status: message.status ?? 'completed' })),
        updatedAt: run.updatedAt,startedAt:run.startedAt??undefined,execution,
        attempts:attempts.map(({inputSnapshot,providerRequestId,...safe})=>safe),
      });
  }

  getMessages(roomId: string) {
    return roomMessagesSchema.parse(this.database.listMessages(roomId).map((message) => ({ ...message, status: message.status ?? 'completed' })));
  }

  subscribe(runId: string, cursor: number): RunSubscription {
    return this.database.transaction(() => {
    const data = this.database.readRunSubscription(runId,cursor);
    const snapshot = this.snapshotFrom(data);
    const records = data.events;
    const events = records.map((record) => this.toRunEvent(record));
    const resyncRequired = data.resyncRequired || cursor > snapshot.sequence || events.some((event, index) => !event || event.sequence !== cursor + index + 1)
      || (cursor < snapshot.sequence && records.at(-1)?.sequence !== snapshot.sequence);
    return runSubscriptionSchema.parse({ snapshot, events: resyncRequired ? [] : events, nextCursor: snapshot.sequence, resyncRequired });
    });
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  hasActiveRuns(): boolean {
    return this.activeRooms.size > 0;
  }

  async shutdown(): Promise<void> {
    const contexts = [...this.contexts.values()];
    for (const context of contexts) {
      context.stopRequested = true;
      context.abortController.abort();
    }
    await Promise.all(contexts.map((context) => context.promise));
    for (const context of contexts) {
      if (this.database.getRun(context.runId)?.status === 'paused') this.finishRun(context, 'cancelled');
    }
    this.contexts.clear();
    this.activeRooms.clear();
  }

  pause(runId: string): void {
    const context = this.requireContext(runId);
    const status = this.database.getRun(runId)?.status;
    if (!status) throw new Error('Run not found');
    assertRunCommand('pause', status as RunStatus);
    context.pauseRequested = true;
    this.setRunState(runId, { status: 'pausing' }, { status: 'pausing' });
  }

  async stop(runId: string): Promise<void> {
    const context = this.requireContext(runId);
    const status = this.database.getRun(runId)?.status;
    if (!status) throw new Error('Run not found');
    assertRunCommand('stop', status as RunStatus);
    context.stopRequested = true;
    context.abortController.abort();
    if (status === 'paused') {
      this.finishRun(context, 'cancelled');
      return;
    }
    this.setRunState(runId, { status: 'cancelling' }, { status: 'cancelling' });
    await context.promise;
  }

  async step(runId: string): Promise<void> {
    const context = this.requireContext(runId);
    const status = this.database.getRun(runId)?.status;
    if (status !== 'paused') throw new Error('Step requires a paused run');
    context.mode = 'step';
    context.pauseRequested = false;
    this.setRunState(runId, { status: 'running',mode:'step' }, { status: 'running' });
    context.promise = this.runLoop(context);
    await context.promise;
  }

  async resumeRun(runId: string): Promise<void> {
    const context = this.requireContext(runId);
    const status = this.database.getRun(runId)?.status;
    if (status !== 'paused') throw new Error('resumeRun requires a paused run');
    context.mode = 'automatic';
    context.pauseRequested = false;
    this.setRunState(runId, { status: 'running',mode:'automatic' }, { status: 'running' });
    context.promise = this.runLoop(context);
    await context.promise;
  }

  async retryTurn(_runId: string, _turnId: string): Promise<void> {
    throw new ContractError('unsupported');
  }

  async continueMessage(_runId: string, _messageId: string): Promise<void> {
    throw new ContractError('unsupported');
  }

  async recoverInterruptedRun(runId: string, decision: InterruptedRunDecision): Promise<void> {
    const run = this.database.getRun(runId);
    if (!run) throw new ContractError('not_found');
    if (run.status !== 'interrupted') throw new ContractError('invalid_state');
    if (decision === 'inspect') return;
    if (decision === 'discard') {
      this.setRunState(runId, { status: 'cancelled', finishedAt: new Date().toISOString() }, { status: 'cancelled', reason: 'discarded after interruption' });
      return;
    }
    throw new ContractError('unsupported');
  }

  private async runLoop(context: RunContext): Promise<void> {
    const startedAt = Date.now();
    context.elapsedBefore = this.database.getRun(context.runId)?.elapsedExecutionMs??0;
    context.segmentStartedAt = performance.now();
    try {
      const agents = context.members;
      while (context.nextAgentIndex < agents.length && context.nextAgentIndex < context.maxTurns) {
        if (Date.now() - startedAt > context.maxDurationMs) {
          this.finishRun(context, 'paused', 'Maximum run duration reached');
          return;
        }
        if (context.stopRequested) {
          this.finishRun(context, 'cancelled');
          return;
        }
        if (context.pauseRequested) {
          this.finishRun(context, 'paused');
          return;
        }
        await this.executeTurn(context, agents[context.nextAgentIndex], context.nextAgentIndex);
        context.nextAgentIndex += 1;
        if (context.mode === 'step') {
          this.finishRun(context, context.nextAgentIndex >= agents.length ? 'completed' : 'paused');
          return;
        }
      }
      this.finishRun(context, 'completed');
    } catch (error) {
      if (context.stopRequested || /cancel/i.test(String(error))) {
        this.finishRun(context, 'cancelled');
      } else {
        this.setRunState(context.runId, { status: 'error', lastError: toPublicError(error).message, finishedAt: new Date().toISOString() }, { status: 'error' });
      }
      this.activeRooms.delete(context.roomId);
    } finally {
      this.persistElapsed(context);
    }
  }

  private persistElapsed(context: RunContext): void {
    this.database.updateRunProgress(context.runId,{elapsedExecutionMs:context.elapsedBefore+Math.max(0,Math.floor(performance.now()-context.segmentStartedAt))});
  }

  private async executeTurn(context: RunContext, agent: { id: string; displayName: string; roleTemplateId: string }, turnIndex: number): Promise<void> {
    const turnId = randomUUID();
    const messageId = randomUUID();
    const requestId = randomUUID();
    const input: StreamChatInput = { requestId, modelId: 'mock', outputTokenLimit: context.outputTokenLimit, agentRole: agent.roleTemplateId, turnIndex, messages: [{ role: 'user', content: context.task }], signal: context.abortController.signal };
    const {signal,...inputSnapshot} = input;
    this.database.transaction(() => {
      this.database.insertTurn({ id: turnId, runId: context.runId, agentId: agent.id, status: 'running', requestId, turnIndex });
      this.database.insertMessage({ id: messageId, roomId: context.roomId, runId: context.runId, turnId, senderType: 'agent', senderName: agent.displayName, content: '', status: 'streaming' });
      this.database.createAttempt({requestId,runId:context.runId,turnId,messageId,attemptIndex:0,status:'pending',inputSnapshot});
      this.database.updateRun(context.runId, { currentTurnId: turnId, currentAgentId: agent.id });
      this.appendEvent(context.runId, 'turn_started', { turnId, messageId, agentId: agent.id, requestId });
    });
    let content = '';
    try {
      let outputTokens = 0;
      let started = false;
      let finished = false;
      let locallyLimited = false;
      for await (const value of this.provider.streamChat(input)) {
        const parsed = normalizedChunkSchema.safeParse(value);
        if (!parsed.success || parsed.data.requestId !== requestId || finished) throw new ContractError('invalid_response');
        const chunk = parsed.data;
        if (chunk.type === 'error') throw new ContractError(chunk.error.code);
        if (chunk.type === 'start') {
          if (started) throw new ContractError('invalid_response');
          started = true;
          this.database.updateAttempt(requestId,{status:'running',providerRequestId:chunk.providerRequestId});
          continue;
        }
        if (!started) throw new ContractError('invalid_response');
        if (chunk.type === 'finish') { finished = true; continue; }
        if (chunk.type === 'text_delta') {
          if (outputTokens >= context.outputTokenLimit) { locallyLimited = true; break; }
          outputTokens += 1;
          content += chunk.text;
          this.database.transaction(() => {
            this.database.updateMessage(messageId, content, 'streaming');
            this.database.updateTurn(turnId, { partialContent: content });
            this.persistElapsed(context);
            this.appendEvent(context.runId, 'text_delta', { turnId, messageId, senderName: agent.displayName, text: chunk.text });
          });
        } else if (chunk.type === 'reasoning_summary_delta') {
          this.appendAndNotify(context.runId, 'reasoning_summary_delta', { turnId, messageId, senderName: agent.displayName, text: chunk.text });
        } else if (chunk.type === 'usage') {
          this.appendAndNotify(context.runId, 'usage_updated', { turnId, inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens });
        }
      }
      if (!finished && !locallyLimited) throw new ContractError('invalid_response');
      this.database.transaction(() => {
        this.database.updateMessage(messageId, content, 'completed');
        this.database.updateTurn(turnId, { status: 'completed', partialContent: content });
        this.database.updateAttempt(requestId,{status:'completed'});
        this.appendEvent(context.runId, 'turn_completed', { turnId, messageId });
      });
    } catch (error) {
      const cancelled = context.stopRequested || /cancel/i.test(String(error));
      this.database.transaction(() => {
        this.database.updateMessage(messageId, content, cancelled ? 'aborted' : 'failed');
        this.database.updateTurn(turnId, { status: cancelled ? 'aborted' : 'failed', partialContent: content });
        this.database.updateAttempt(requestId,{status:cancelled?'aborted':'failed'});
        this.appendEvent(context.runId, cancelled ? 'turn_aborted' : 'turn_failed', { turnId, messageId, error: toPublicError(error, cancelled ? 'cancelled' : 'internal_error') });
      });
      throw error;
    }
  }

  private finishRun(context: RunContext, status: 'completed' | 'paused' | 'cancelled', reason?: string): void {
    this.setRunState(context.runId, { status, finishedAt: status === 'completed' || status === 'cancelled' ? new Date().toISOString() : null, lastError: reason ?? null }, { status, reason });
    if (status !== 'paused') this.activeRooms.delete(context.roomId);
  }

  private setRunState(runId: string,patch: Parameters<Database['updateRun']>[1],payload: unknown): void {
    this.database.transaction(()=>{this.database.updateRun(runId,patch);this.appendEvent(runId,'run_state_changed',payload);});
  }

  private appendAndNotify(runId: string, type: RunEvent['type'], payload: unknown): void {
    this.database.transaction(() => this.appendEvent(runId, type, payload));
  }

  private appendEvent(runId: string, type: RunEvent['type'], payload: unknown): void {
    const turnId = payload && typeof payload==='object' && 'turnId' in payload && typeof payload.turnId==='string'?payload.turnId:undefined;
    const requestId = turnId?this.database.getLatestAttemptRequestId(turnId):undefined;
    const event = this.toRunEvent({ runId, type, payload,turnId,requestId,protocolVersion:1, sequence: 1, timestamp: new Date().toISOString() });
    if (!event) throw new ContractError('invalid_response');
    const saved = this.database.appendRunEvent({ runId, type, turnId: event.turnId,requestId:event.requestId,protocolVersion:1, payload: event.payload, timestamp: event.timestamp });
    this.database.afterCommit(()=>{
      const notification = this.toRunEvent(saved);
      if (notification) for (const listener of this.listeners) {
        try { listener(notification); } catch { console.error('AI Roundtable event delivery failed'); }
      }
    });
  }

  private toRunEvent(record: RunEventRecord & { sequence: number }): RunEvent | undefined {
    if (record.protocolVersion!==undefined && record.protocolVersion!==0 && record.protocolVersion!==1) return;
    const payload = record.payload;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
    let requestId: string | undefined;
    let turnId = record.turnId;
    let safePayload = payload;
    if ('turnId' in payload) {
      if (typeof payload.turnId !== 'string') return undefined;
      turnId ??= payload.turnId;
      const turn = this.database.getTurn(turnId);
      if (!turn || turn.runId !== record.runId || turn.id !== payload.turnId) return undefined;
      requestId = record.requestId ?? ('requestId' in payload && typeof payload.requestId==='string'?payload.requestId:turn.requestId);
      const attempt = this.database.getAttempt(requestId);
      if (record.protocolVersion===1 && (!record.requestId || !attempt)) return;
      if (attempt ? attempt.runId!==record.runId || attempt.turnId!==turnId : requestId!==turn.requestId) return;
      if ('requestId' in payload && payload.requestId !== requestId || 'agentId' in payload && payload.agentId !== turn.agentId) return undefined;
      if ('messageId' in payload) {
        if (typeof payload.messageId !== 'string') return undefined;
        const message = this.database.getMessage(payload.messageId);
        if (!message || message.runId !== record.runId || message.turnId !== turnId
          || attempt && message.id!==attempt.messageId
          || 'senderName' in payload && payload.senderName !== message.senderName) return undefined;
      }
      // v0 stored raw failure strings; replace only at the output boundary, preserving history.
      if (record.protocolVersion!==1 && (record.type === 'turn_failed' || record.type === 'turn_aborted') && 'error' in payload && typeof payload.error === 'string') {
        safePayload = { ...payload, error: publicError(record.type === 'turn_aborted' ? 'cancelled' : 'internal_error') };
      }
    }
    const parsed = runEventSchema.safeParse({runId:record.runId,type:record.type,sequence:record.sequence,timestamp:record.timestamp, version: PROTOCOL_VERSION, turnId, requestId, payload: safePayload });
    return parsed.success ? parsed.data : undefined;
  }

  private requireContext(runId: string): RunContext {
    const context = this.contexts.get(runId);
    if (!context) throw new Error('Run is not active in this process');
    return context;
  }
}
