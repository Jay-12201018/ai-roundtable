import { randomUUID } from 'node:crypto';
import { setImmediate as drainReadyCallbacks } from 'node:timers/promises';
import type { RunEvent, RunSnapshot, RunSubscription, RunStatus, TurnStatus } from '../../shared/types/run';
import { assertRunCommand, canRetryTurn, transitionRun, transitionTurn } from '../orchestrator/stateMachine';
import type { StartRunInput } from '../../shared/contracts/run';
import type { InterruptedRunDecision } from '../../shared/types/run';
import { ContractError, toPublicError } from '../../shared/contracts/errors';
import { publicError } from '../../shared/schemas/error';
import { interruptedRunDecisionSchema, runEventSchema, runSnapshotSchema, runSubscriptionSchema, startRunInputSchema } from '../../shared/schemas/run';
import { roomMessagesSchema } from '../../shared/schemas/app';
import { PROTOCOL_VERSION } from '../../shared/schemas/common';
import { normalizedChunkSchema, streamChatInputSchema } from '../../shared/schemas/provider';
import type { MemberSnapshot } from '../../shared/schemas/persistence';
import type { Database, RunEventRecord, RunRecord, TurnRecord } from '../database/Database';
import type { ProviderRegistry } from '../providers/ProviderRegistry';
import type { ProviderAdapter, StreamChatInput } from '../providers/types';

type RunContext = {
  runId: string;
  roomId: string;
  mode: 'automatic' | 'step';
  maxTurns: number;
  maxDurationMs: number;
  outputTokenLimit: number;
  abortController: AbortController;
  stopRequested: boolean;
  timedOut: boolean;
  promise: Promise<void>;
  members: MemberSnapshot[];
  elapsedBefore: number;
  segmentStartedAt?: number;
  deadline?: ReturnType<typeof setTimeout>;
  executing: boolean;
  failureReason?: string;
};

export type RequestPreparation = {
  snapshot: ReturnType<Database['readRunSnapshot']>;
  current: { turnId: string; requestId: string; messageId: string; agentId: string; turnIndex: number };
  repeat?: { messages: StreamChatInput['messages']; sourceRequestId: string; kind: 'retry' | 'continue' };
};
export type RunMessagesBuilder = (run: RunRecord, member: MemberSnapshot, turnIndex: number, preparation: RequestPreparation) => StreamChatInput['messages'];
type RepeatAttempt = { turn: TurnRecord; messages: StreamChatInput['messages']; modelId: string; sourceRequestId: string; kind: 'retry' | 'continue' };

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
  private shutdownPromise?: Promise<void>;
  private shuttingDown = false;

  constructor(private readonly database: Database, private readonly provider: ProviderAdapter,
    private readonly buildMessages: RunMessagesBuilder = (run,_member,_index,preparation) => preparation.repeat?.messages ?? [{ role: 'user', content: run.task! }],
    private readonly registry?: ProviderRegistry) {}

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
    this.assertAvailable();
    if (!this.database.getRoom(input.roomId)) throw new ContractError('not_found');
    const members = this.database.listAgents(input.roomId, this.registry ? (providerId, modelId) => this.registry!.assertSelection(providerId, modelId) : undefined).map(({ id, roomId: _roomId, ...member }) => ({ ...member, agentId: id, modelId: member.modelId ?? 'mock' }));
    if (!members.length) throw new ContractError('invalid_state');
    const runId = randomUUID();
    const context: RunContext = { runId, roomId: input.roomId, members,
      mode: input.mode ?? 'automatic', maxTurns: input.maxTurns ?? 3, maxDurationMs: input.maxDurationMs ?? 300000,
      outputTokenLimit: input.outputTokenLimit ?? 1024, abortController: new AbortController(),
      stopRequested: false, timedOut: false, promise: Promise.resolve(), elapsedBefore: 0, executing: false };
    this.schedule(context, () => {
      this.database.insertRun({ id: runId, roomId: input.roomId, status: 'idle', workflowSnapshot: input.workflowSnapshot, mode: context.mode, maxTurns: context.maxTurns, maxDurationMs: context.maxDurationMs, outputTokenLimit: context.outputTokenLimit,
        task: input.task, membersSnapshot: members, nextTurnIndex: 0, elapsedExecutionMs: 0 });
      this.setRunState(runId, { status: 'running', startedAt: new Date().toISOString() }, { status: 'running' });
    });
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

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    // Drain already queued output once; never wait for a Provider's pending I/O.
    const drained = [...this.contexts.values()].some(context => context.executing) ? drainReadyCallbacks() : Promise.resolve();
    this.shutdownPromise = drained.then(() => Promise.all([...this.contexts.keys()].map(id => this.stop(id)))).then(() => {}).finally(() => {
      this.shuttingDown = false;
      this.shutdownPromise = undefined;
    });
    return this.shutdownPromise;
  }

  pause(runId: string): void {
    const run = this.requireRun(runId);
    assertRunCommand('pause', run.status);
    this.requireContext(runId);
    if (run.status === 'pausing') return;
    this.setRunState(runId, { status: 'pausing' }, { status: 'pausing' });
  }

  async stop(runId: string): Promise<void> {
    const run = this.requireRun(runId);
    assertRunCommand('stop', run.status);
    if (run.status === 'cancelled') return;
    const context = this.contexts.get(runId);
    if (run.status === 'cancelling' && context?.executing) { await context.promise; return; }
    if (!context) {
      if (run.status !== 'paused') throw new ContractError('invalid_state');
      this.database.transaction(() => {
        this.setRunState(runId, { status: 'cancelling' }, { status: 'cancelling' });
        this.setRunState(runId, { status: 'cancelled', finishedAt: new Date().toISOString(), currentTurnId: null, currentAgentId: null }, { status: 'cancelled' });
      });
      return;
    }
    if (run.status !== 'cancelling') this.setRunState(runId, { status: 'cancelling' }, { status: 'cancelling' });
    context.stopRequested = true;
    context.abortController.abort(new ContractError('cancelled'));
    if (!context.executing) this.finishRun(context, 'cancelled');
    else await context.promise;
  }

  async step(runId: string): Promise<void> {
    await this.resumePaused(runId, 'step');
  }

  async resumeRun(runId: string): Promise<void> {
    await this.resumePaused(runId, 'automatic');
  }

  private async resumePaused(runId: string, mode: RunContext['mode']): Promise<void> {
    const run = this.requireRun(runId);
    assertRunCommand(mode === 'step' ? 'step' : 'resumeRun', run.status);
    const context = this.contexts.get(runId) ?? this.contextFrom(run);
    if (context.executing) throw new ContractError('invalid_state');
    this.assertSettled(runId);
    this.assertBudget(run);
    context.mode = mode;
    this.schedule(context, () => this.setRunState(runId, { status: 'running', mode }, { status: 'running' }));
    await context.promise;
  }

  async retryTurn(runId: string, turnId: string): Promise<void> {
    await this.repeatAttempt(runId, turnId);
  }

  async continueMessage(runId: string, messageId: string): Promise<void> {
    const run = this.requireRun(runId);
    this.contextFrom(run); // Legacy inputs are unknown, never reconstructed from room text.
    const message = this.database.getMessage(messageId);
    if (!message || message.runId !== runId || !message.turnId || !message.content) throw new ContractError('invalid_state');
    const latest = this.database.getLatestAttemptRequestId(message.turnId);
    if (!latest || this.database.getAttempt(latest)?.messageId !== messageId) throw new ContractError('invalid_state');
    await this.repeatAttempt(runId, message.turnId, message.content);
  }

  private async repeatAttempt(runId: string, turnId: string, suffixOf?: string): Promise<void> {
    const run = this.requireRun(runId);
    const context = this.contextFrom(run);
    assertRunCommand(suffixOf === undefined ? 'retryTurn' : 'continueMessage', run.status);
    const turn = this.database.listTurns(runId).at(-1);
    const requestId = this.database.getLatestAttemptRequestId(turnId);
    const attempt = requestId ? this.database.getAttempt(requestId) : undefined;
    if (!turn || turn.id !== turnId || !canRetryTurn(turn.status as TurnStatus) || !attempt
      || !canRetryTurn(attempt.status) || !attempt.inputSnapshot) throw new ContractError('invalid_state');
    this.assertBudget(run);
    const messages = suffixOf === undefined ? attempt.inputSnapshot.messages : [
      ...attempt.inputSnapshot.messages,
      { role: 'assistant' as const, content: suffixOf },
      { role: 'user' as const, content: 'Continue the previous response from where it stopped.' },
    ];
    this.schedule(context, () => this.setRunState(runId, { status: 'running', finishedAt: null, lastError: null }, { status: 'running' }),
      { turn, messages, modelId: attempt.inputSnapshot.modelId,sourceRequestId:attempt.requestId,kind:suffixOf===undefined?'retry':'continue' });
    await context.promise;
  }

  async recoverInterruptedRun(runId: string, decision: InterruptedRunDecision): Promise<void> {
    const parsed = interruptedRunDecisionSchema.safeParse(decision);
    if (!parsed.success) throw new ContractError('invalid_input');
    const run = this.requireRun(runId);
    assertRunCommand('recoverInterruptedRun', run.status);
    if (decision === 'inspect') return;
    if (decision === 'discard') {
      this.setRunState(runId, { status: 'cancelled', finishedAt: new Date().toISOString(), currentTurnId: null, currentAgentId: null }, { status: 'cancelled', reason: 'discarded after interruption' });
      return;
    }
    const context = this.contextFrom(run);
    if (decision === 'retry') {
      const turn = this.database.listTurns(runId).at(-1);
      if (!turn) throw new ContractError('invalid_state');
      await this.repeatAttempt(runId, turn.id);
      return;
    }
    this.assertSettled(runId);
    this.assertBudget(run);
    this.schedule(context, () => this.setRunState(runId, { status: 'running', finishedAt: null, lastError: null }, { status: 'running' }));
    await context.promise;
  }

  private requireRun(runId: string): RunRecord {
    const run = this.database.getRun(runId);
    if (!run) throw new ContractError('not_found');
    return run;
  }

  private contextFrom(run: RunRecord): RunContext {
    if (run.task === null || run.membersSnapshot === null || !run.membersSnapshot.length || run.nextTurnIndex === null || run.elapsedExecutionMs === null) throw new ContractError('unsupported');
    return { runId: run.id, roomId: run.roomId, members: run.membersSnapshot,
      mode: run.mode, maxTurns: run.maxTurns, maxDurationMs: run.maxDurationMs, outputTokenLimit: run.outputTokenLimit,
      abortController: new AbortController(), stopRequested: false, timedOut: false, promise: Promise.resolve(), elapsedBefore: run.elapsedExecutionMs, executing: false };
  }

  private assertSettled(runId: string): void {
    if (this.database.listTurns(runId).some(turn => {
      const requestId = this.database.getLatestAttemptRequestId(turn.id);
      return turn.status !== 'completed' || !requestId || this.database.getAttempt(requestId)?.status !== 'completed';
    })) throw new ContractError('invalid_state');
  }

  private assertBudget(run: RunRecord): void {
    if (run.elapsedExecutionMs !== null && run.elapsedExecutionMs >= run.maxDurationMs) throw new ContractError('timeout');
  }

  private assertAvailable(context?: RunContext): void {
    if (this.shuttingDown) throw new ContractError('invalid_state');
    if (this.activeRooms.size && (!context || this.contexts.get(context.runId) !== context)) throw new Error('Another room already has an active run');
  }

  private schedule(context: RunContext, change: () => void, repeat?: RepeatAttempt): void {
    this.assertAvailable(context);
    // Revalidate frozen references before retries/recovery, without replacing historical members.
    for (const member of context.members) {
      if (member.providerId === null && member.modelId === 'mock') continue;
      if (member.providerId === null || member.modelId === null) throw new ContractError('invalid_state');
      if (this.registry) this.registry.assertSelection(member.providerId, member.modelId);
      else if (this.database.validateModelSelection(member.providerId, member.modelId).kind !== 'mock') throw new ContractError('unsupported');
    }
    const previous = this.contexts.get(context.runId);
    const oldPromise = context.promise;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    context.promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void context.promise.catch(() => {});
    context.abortController = new AbortController();
    context.stopRequested = false;
    context.timedOut = false;
    context.failureReason = undefined;
    context.segmentStartedAt = performance.now();
    context.executing = true;
    this.contexts.set(context.runId, context);
    this.activeRooms.add(context.roomId);
    try { this.database.transaction(change); }
    catch (error) {
      context.executing = false;
      context.segmentStartedAt = undefined;
      context.promise = oldPromise;
      if (!previous) { this.contexts.delete(context.runId); this.activeRooms.delete(context.roomId); }
      resolve();
      throw error;
    }
    this.armDeadline(context);
    void this.runLoop(context, repeat).then(resolve, error => {
      clearTimeout(context.deadline);
      context.elapsedBefore = this.elapsed(context);
      context.segmentStartedAt = undefined;
      context.executing = false;
      context.abortController.abort();
      reject(error);
    });
  }

  private armDeadline(context: RunContext): void {
    if (this.deadlineReached(context)) return;
    const remaining = context.maxDurationMs - this.elapsed(context);
    context.deadline = setTimeout(() => this.armDeadline(context), Math.min(remaining, 2147483647));
  }

  private deadlineReached(context: RunContext): boolean {
    if (context.timedOut || this.elapsed(context) >= context.maxDurationMs) {
      context.timedOut = true;
      context.abortController.abort(new ContractError('timeout'));
      return true;
    }
    return false;
  }

  private async runLoop(context: RunContext, repeat?: RepeatAttempt): Promise<void> {
    try {
      while (true) {
        if (context.stopRequested) { this.finishRun(context, 'cancelled'); return; }
        if (this.deadlineReached(context)) throw new ContractError('timeout');
        const run = this.requireRun(context.runId);
        if (!repeat && run.nextTurnIndex! >= context.maxTurns) { this.finishRun(context, 'completed'); return; }
        if (run.status === 'pausing') { this.finishRun(context, 'paused'); return; }
        const turnIndex = repeat?.turn.turnIndex ?? run.nextTurnIndex!;
        const repeatedAgentId = repeat?.turn.agentId;
        const member = repeat ? context.members.find(a => a.agentId === repeatedAgentId) : context.members[turnIndex % context.members.length];
        if (!member) throw new ContractError('invalid_state');
        await this.executeTurn(context, member, turnIndex, repeat);
        repeat = undefined;
        if (context.stopRequested) { this.finishRun(context, 'cancelled'); return; }
        if (this.deadlineReached(context)) throw new ContractError('timeout');
        if (this.requireRun(context.runId).nextTurnIndex! >= context.maxTurns) { this.finishRun(context, 'completed'); return; }
        if (context.mode === 'step' || this.requireRun(context.runId).status === 'pausing') { this.finishRun(context, 'paused'); return; }
      }
    } catch (error) {
      const code = toPublicError(error).code;
      this.finishRun(context, context.stopRequested || code === 'cancelled' ? 'cancelled' : 'error',
        context.timedOut || code === 'timeout' ? 'Maximum run duration reached' : undefined,
        context.failureReason ?? toPublicError(error).message);
    }
  }

  private elapsed(context: RunContext): number {
    return context.elapsedBefore + (context.segmentStartedAt === undefined ? 0 : Math.max(0, Math.floor(performance.now() - context.segmentStartedAt)));
  }

  private persistElapsed(context: RunContext): void {
    this.database.updateRunProgress(context.runId, { elapsedExecutionMs: this.elapsed(context) });
  }

  private withAbort<T>(context: RunContext, work: () => Promise<T>): Promise<T> {
    const signal = context.abortController.signal;
    if (signal.aborted) return Promise.reject(new ContractError(context.timedOut ? 'timeout' : 'cancelled'));
    return new Promise<T>((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(new ContractError(context.timedOut ? 'timeout' : 'cancelled')); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        work().then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
      } catch (error) { signal.removeEventListener('abort', abort); reject(error); }
    });
  }

  private async executeTurn(context: RunContext, member: MemberSnapshot, turnIndex: number, repeat?: RepeatAttempt): Promise<void> {
    const turnId = repeat?.turn.id ?? randomUUID();
    const messageId = randomUUID();
    const requestId = randomUUID();
    const input:StreamChatInput = this.database.transaction(() => {
      const snapshot=this.database.readRunSnapshot(context.runId);
      const preparation:RequestPreparation={snapshot,current:{turnId,requestId,messageId,agentId:member.agentId,turnIndex},
        repeat:repeat?{messages:repeat.messages,sourceRequestId:repeat.sourceRequestId,kind:repeat.kind}:undefined};
      const inputSnapshot=streamChatInputSchema.parse({ requestId, modelId: repeat?.modelId ?? member.modelId ?? 'mock',
        outputTokenLimit:context.outputTokenLimit,agentRole:member.roleTemplateId,turnIndex,
        messages:this.buildMessages(snapshot.run,member,turnIndex,preparation) });
      if (member.providerId && this.registry) this.registry.checkGeneration(member.providerId, inputSnapshot);
      if (this.deadlineReached(context)) throw new ContractError('timeout');
      if(context.abortController.signal.aborted)throw new ContractError('cancelled');
      if (repeat) this.database.updateTurn(turnId, { status: transitionTurn(repeat.turn.status as TurnStatus, 'running'), partialContent: '' });
      else this.database.insertTurn({ id: turnId, runId: context.runId, agentId: member.agentId, status: transitionTurn('pending', 'running'), requestId, turnIndex });
      this.database.insertMessage({ id: messageId, roomId: context.roomId, runId: context.runId, turnId, senderType: 'agent', senderName: member.displayName, content: '', status: 'streaming' });
      const attemptIndex = snapshot.attempts.filter(a => a.turnId === turnId).length;
      this.database.createAttempt({ requestId, runId: context.runId, turnId, messageId, attemptIndex, status: 'pending', inputSnapshot });
      this.database.updateRun(context.runId, { currentTurnId: turnId, currentAgentId: member.agentId });
      this.appendEvent(context.runId, 'turn_started', { turnId, messageId, agentId: member.agentId, requestId });
      return {...inputSnapshot,signal:context.abortController.signal};
    });
    const {signal}=input;
    let content = '';
    let iterator: AsyncIterator<unknown> | undefined;
    let drained = false;
    try {
      let started = false;
      let finishReason: 'stop' | 'length' | 'content_filter' | undefined;
      if (this.deadlineReached(context) || signal?.aborted) throw new ContractError(context.timedOut ? 'timeout' : 'cancelled');
      const provider = member.providerId && this.registry ? this.registry.getAdapter(member.providerId, input.modelId) : this.provider;
      iterator = provider.streamChat(input)[Symbol.asyncIterator]();
      await this.withAbort(context, async () => {
        while (true) {
          const next = await iterator!.next();
          this.deadlineReached(context);
          if (signal?.aborted) throw new ContractError(context.timedOut ? 'timeout' : 'cancelled');
          if (next.done) { drained = true; break; }
          const parsed = normalizedChunkSchema.safeParse(next.value);
          if (!parsed.success || parsed.data.requestId !== requestId || finishReason) throw new ContractError('invalid_response');
          const chunk = parsed.data;
          if (chunk.type === 'error') throw new ContractError(chunk.error.code);
          if (chunk.type === 'start') {
            if (started) throw new ContractError('invalid_response');
            started = true;
            this.database.updateAttempt(requestId, { status: 'running', providerRequestId: chunk.providerRequestId });
            continue;
          }
          if (!started) throw new ContractError('invalid_response');
          if (chunk.type === 'finish') { finishReason = chunk.reason; continue; }
          if (chunk.type === 'text_delta') {
            content += chunk.text;
            this.database.transaction(() => {
              this.database.updateMessage(messageId, content, 'streaming');
              this.database.updateTurn(turnId, { partialContent: content });
              this.persistElapsed(context);
              this.appendEvent(context.runId, 'text_delta', { turnId, messageId, senderName: member.displayName, text: chunk.text });
            });
          } else if (chunk.type === 'reasoning_summary_delta') {
            this.appendAndNotify(context.runId, 'reasoning_summary_delta', { turnId, messageId, senderName: member.displayName, text: chunk.text });
          } else if (chunk.type === 'usage') {
            this.appendAndNotify(context.runId, 'usage_updated', { turnId, inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens });
          }
        }
      });
      if (!finishReason) throw new ContractError('invalid_response');
      if (finishReason !== 'stop') {
        // Incomplete output is retained as failed evidence; only an explicit user action may retry.
        context.failureReason = `Provider finish: ${finishReason}`;
        throw new ContractError('invalid_response');
      }
      this.database.transaction(() => {
        this.database.updateMessage(messageId, content, 'completed');
        this.database.updateTurn(turnId, { status: transitionTurn('running', 'completed'), partialContent: content });
        this.database.updateAttempt(requestId, { status: 'completed' });
        this.persistElapsed(context);
        this.appendEvent(context.runId, 'turn_completed', { turnId, messageId });
      });
    } catch (error) {
      const code = toPublicError(error).code;
      const aborted = context.stopRequested || context.timedOut || code === 'cancelled' || code === 'timeout';
      this.database.transaction(() => {
        this.database.updateMessage(messageId, content, aborted ? 'aborted' : 'failed');
        this.database.updateTurn(turnId, { status: transitionTurn('running', aborted ? 'aborted' : 'failed'), partialContent: content });
        this.database.updateAttempt(requestId, { status: aborted ? 'aborted' : 'failed' });
        this.persistElapsed(context);
        this.appendEvent(context.runId, aborted ? 'turn_aborted' : 'turn_failed', { turnId, messageId, error: toPublicError(error, aborted ? 'cancelled' : 'internal_error') });
      });
      throw error;
    } finally {
      // A non-cooperating Provider must not block Stop/shutdown or write late chunks.
      if (!drained && iterator?.return) void Promise.resolve().then(() => iterator!.return!()).catch(() => {});
    }
  }

  private finishRun(context: RunContext, status: 'completed' | 'paused' | 'cancelled' | 'error', reason?: 'Maximum run duration reached', lastError?: string): void {
    if (status === 'cancelled' && this.requireRun(context.runId).status !== 'cancelling') {
      this.setRunState(context.runId, { status: 'cancelling' }, { status: 'cancelling' });
    }
    clearTimeout(context.deadline);
    const elapsed = this.elapsed(context);
    this.database.transaction(() => {
      if (status === 'error' || status === 'cancelled') {
        const aborted = status === 'cancelled' || context.timedOut;
        for (const turn of this.database.listTurns(context.runId).filter(t => t.status === 'running')) {
          const requestId = this.database.getLatestAttemptRequestId(turn.id);
          const attempt = requestId ? this.database.getAttempt(requestId) : undefined;
          if (!attempt || !['pending', 'running'].includes(attempt.status)) throw new ContractError('invalid_state');
          const message = this.database.getMessage(attempt.messageId)!;
          this.database.updateMessage(message.id, message.content, aborted ? 'aborted' : 'failed');
          this.database.updateTurn(turn.id, { status: transitionTurn('running', aborted ? 'aborted' : 'failed') });
          this.database.updateAttempt(attempt.requestId, { status: aborted ? 'aborted' : 'failed' });
          this.appendEvent(context.runId, aborted ? 'turn_aborted' : 'turn_failed', { turnId: turn.id, messageId: message.id,
            error: publicError(context.timedOut ? 'timeout' : aborted ? 'cancelled' : 'internal_error') });
        }
      }
      this.database.updateRunProgress(context.runId, { elapsedExecutionMs: elapsed });
      this.database.afterCommit(() => {
        context.elapsedBefore = elapsed;
        context.segmentStartedAt = undefined;
        context.executing = false;
        if (status !== 'paused') { this.contexts.delete(context.runId); this.activeRooms.delete(context.roomId); }
      });
      this.setRunState(context.runId, { status, finishedAt: status === 'paused' ? null : new Date().toISOString(),
        currentTurnId: null, currentAgentId: null, lastError: lastError ?? reason ?? null }, { status, reason });
    });
  }

  private setRunState(runId: string, patch: Parameters<Database['updateRun']>[1], payload: unknown): void {
    this.database.transaction(() => {
      if (patch.status) transitionRun(this.requireRun(runId).status, patch.status as RunStatus);
      this.database.updateRun(runId, patch);
      this.appendEvent(runId, 'run_state_changed', payload);
    });
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
    if (!context) throw new ContractError('invalid_state');
    return context;
  }
}
