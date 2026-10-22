import { randomUUID } from 'node:crypto';
import { setImmediate as drainReadyCallbacks } from 'node:timers/promises';
import type { RunEvent, RunSnapshot, RunSubscription, RunStatus, TurnStatus } from '../../shared/types/run';
import { assertRunCommand, canRetryTurn, transitionRun, transitionTurn } from '../orchestrator/stateMachine';
import type { StartRunInput } from '../../shared/contracts/run';
import type { InterruptedRunDecision } from '../../shared/types/run';
import { ContractError, toPublicError } from '../../shared/contracts/errors';
import { publicError } from '../../shared/schemas/error';
import { interruptedRunDecisionSchema, runEventSchema, runSnapshotSchema, runSubscriptionSchema, startRunInputSchema } from '../../shared/schemas/run';
import { compileWorkflow, nextWorkflowStep, readWorkflowSnapshot } from '../workflow';
import type { WorkflowConfig, WorkflowSnapshot, WorkflowStep } from '../workflow';
import { workflowPreviewInputSchema } from '../../shared/schemas/workflow';
import { roomMessagesSchema } from '../../shared/schemas/app';
import { PROTOCOL_VERSION } from '../../shared/schemas/common';
import { normalizedChunkSchema, streamChatInputSchema } from '../../shared/schemas/provider';
import type { MemberSnapshot } from '../../shared/schemas/persistence';
import type { Database, RunEventRecord, RunRecord, TurnRecord, VersionInput } from '../database/Database';
import { affectedVersions, basisBefore, effectiveInstructions } from '../host/versions';
import type { HostCommandKind, HostState, MessageVersion } from '../../shared/schemas/host';
import type { ProviderRegistry, RequestQuote } from '../providers/ProviderRegistry';
import { budgetBlockMessage, type BudgetBlock, type RequestCharge } from '../../shared/schemas/budget';
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
  // R12: a version regeneration runs outside the schedule and leaves the Run status unchanged.
  job?: { requestId?: string };
  // R13A: why the budget stopped scheduling; persisted with the Run's terminal state.
  budgetBlock?: BudgetBlock;
};

export type RequestPreparation = {
  snapshot: ReturnType<Database['readRunSnapshot']>;
  current: { turnId: string; requestId: string; messageId: string; agentId: string; turnIndex: number };
  workflowStep?: WorkflowStep;
  repeat?: { messages: StreamChatInput['messages']; sourceRequestId: string; kind: 'retry' | 'continue' };
  /** R12: rebuild the existing Turn's input from current effective history before it and current host instructions. */
  regenerate?: { sourceMessageId: string };
};
export type RunMessagesBuilder = (run: RunRecord, member: MemberSnapshot, turnIndex: number, preparation: RequestPreparation) => StreamChatInput['messages'];
type RepeatAttempt = { turn: TurnRecord; messages: StreamChatInput['messages']; modelId: string; sourceRequestId: string; kind: 'retry' | 'continue' }
  | { turn: TurnRecord; modelId: string; sourceRequestId: string; kind: 'regenerate'; sourceMessageId: string; actionId: string; job: boolean };
type Snapshot = ReturnType<Database['readRunSnapshot']>;
const continuePrompt = 'Continue the previous response from where it stopped.';


/** The message that currently represents a Turn: its slot's active version, else (legacy) its latest Attempt. */
export function activeMessageOf(snapshot: Pick<Snapshot, 'versions' | 'attempts' | 'messages'>, turnId: string) {
  const active = snapshot.versions.find(version => version.slotId === turnId && version.active);
  const id = active?.messageId ?? snapshot.attempts.filter(attempt => attempt.turnId === turnId).at(-1)?.messageId;
  return id === undefined ? undefined : snapshot.messages.find(message => message.id === id);
}
/** A Turn is settled when it completed and its effective version is complete (an edit, or a completed Attempt). */
export function turnSettled(snapshot: Snapshot, turn: TurnRecord): boolean {
  const message = activeMessageOf(snapshot, turn.id);
  if (turn.status !== 'completed' || !message || (message.status ?? 'completed') !== 'completed') return false;
  const attempt = snapshot.attempts.find(item => item.messageId === message.id);
  return attempt ? attempt.status === 'completed' : snapshot.versions.find(version => version.messageId === message.id)?.origin === 'edit';
}
const planTurnsOf = (turns: readonly TurnRecord[]) => [...turns].sort((a, b) => a.turnIndex - b.turnIndex).filter(turn => turn.overrideActionId === undefined);

// Compare persisted DTO identity by fields; JSON property insertion order is not identity.
const memberIdentity = (member: MemberSnapshot) => JSON.stringify([member.agentId, member.displayName, member.roleTemplateId,
  member.systemPrompt, member.providerId, member.modelId, member.displayOrder]);
const sameMembers = (left: readonly MemberSnapshot[] | null, right: readonly MemberSnapshot[]) =>
  left !== null && left.length === right.length && left.every((member, index) => memberIdentity(member) === memberIdentity(right[index]));

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
  private readonly workflowPreviews = new Map<string, WorkflowSnapshot>();

  constructor(private readonly database: Database, private readonly provider: ProviderAdapter,
    private readonly buildMessages: RunMessagesBuilder = (run,_member,_index,preparation) => preparation.repeat?.messages ?? [{ role: 'user', content: run.task! }],
    private readonly registry?: ProviderRegistry,
    private readonly assertGenerationAllowed: () => void = () => {}) {}

  createDemoRoom(objective: string): string {
    const roomId = randomUUID();
    this.database.transaction(() => {
      this.database.insertRoom({ id: roomId, name: 'Mock 圆桌', objective });
      roles.forEach((role, index) => this.database.insertAgent({ id: `${roomId}-${role.id}`, roomId, displayName: role.name, roleTemplateId: role.role, displayOrder: index }));
    });
    return roomId;
  }

  /** A bounded configuration preview; this neither acquires a Key nor authorizes generation. */
  previewWorkflow(input: { roomId: string; config: WorkflowConfig }): { previewId: string; snapshot: WorkflowSnapshot } {
    const parsed = workflowPreviewInputSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input');
    input = parsed.data;
    const snapshot = this.compileCurrentWorkflow(input.roomId, input.config);
    for (const [id, old] of this.workflowPreviews) if (old.roomId === input.roomId) this.workflowPreviews.delete(id);
    while (this.workflowPreviews.size >= 32) this.workflowPreviews.delete(this.workflowPreviews.keys().next().value!);
    const previewId = randomUUID();
    this.workflowPreviews.set(previewId, snapshot);
    return { previewId, snapshot };
  }

  private compileCurrentWorkflow(roomId: string, config: unknown): WorkflowSnapshot {
    if (!this.database.getRoom(roomId)) throw new ContractError('not_found');
    // listAgents enforces archived/configuration/provider rules, including the narrow legacy Demo exception.
    const executable = this.database.listAgents(roomId, this.registry ? (providerId, modelId) => this.registry!.assertSelection(providerId, modelId) : undefined);
    const current = this.database.listAgentConfigurations(roomId).map(member => {
      const verified = executable.find(agent => agent.id === member.id);
      return verified ? { ...member, modelId: verified.modelId ?? 'mock' } : member;
    });
    return compileWorkflow(config, roomId, current);
  }

  async start(input: StartRunInput): Promise<RunSnapshot> {
    const parsed = startRunInputSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input');
    input = parsed.data;
    this.assertAvailable();
    if (!this.database.getRoom(input.roomId)) throw new ContractError('not_found');
    let workflow: WorkflowSnapshot | undefined;
    if (input.workflowConfig) {
      workflow = this.compileCurrentWorkflow(input.roomId, input.workflowConfig);
      const preview = input.workflowPreviewId ? this.workflowPreviews.get(input.workflowPreviewId) : undefined;
      if (!preview || JSON.stringify(preview) !== JSON.stringify(workflow)) throw new ContractError('invalid_state');
    } else if (input.workflowPreviewId || this.hasWorkflowPlan(input.workflowSnapshot ?? {})) {
      // Caller-supplied frozen rosters/steps cannot bypass Main compilation or preview freshness.
      throw new ContractError('invalid_input');
    }
    const members = workflow?.members ?? this.database.listAgents(input.roomId, this.registry ? (providerId, modelId) => this.registry!.assertSelection(providerId, modelId) : undefined)
      .map(({ id, roomId: _roomId, ...member }) => ({ ...member, agentId: id, modelId: member.modelId ?? 'mock' }));
    if (!members.length) throw new ContractError('invalid_state');
    const runId = randomUUID();
    const context: RunContext = { runId, roomId: input.roomId, members,
      mode: input.mode ?? 'automatic', maxTurns: Math.min(input.maxTurns ?? workflow?.config.limits.maxTurns ?? 3, workflow?.config.limits.maxTurns ?? Number.MAX_SAFE_INTEGER),
      maxDurationMs: Math.min(input.maxDurationMs ?? workflow?.config.limits.maxDurationMs ?? 300000, workflow?.config.limits.maxDurationMs ?? Number.MAX_SAFE_INTEGER),
      outputTokenLimit: Math.min(input.outputTokenLimit ?? workflow?.config.limits.outputTokenLimit ?? 1024, workflow?.config.limits.outputTokenLimit ?? Number.MAX_SAFE_INTEGER),
      abortController: new AbortController(), stopRequested: false, timedOut: false, promise: Promise.resolve(), elapsedBefore: 0, executing: false };
    this.schedule(context, () => {
      this.database.insertRun({ id: runId, roomId: input.roomId, status: 'idle', workflowSnapshot: workflow ?? input.workflowSnapshot ?? {}, mode: context.mode, maxTurns: context.maxTurns, maxDurationMs: context.maxDurationMs, outputTokenLimit: context.outputTokenLimit,
        task: input.task, membersSnapshot: members, nextTurnIndex: 0, elapsedExecutionMs: 0, budgetMicroCny: input.budgetMicroCny });
      this.setRunState(runId, { status: 'running', startedAt: new Date().toISOString() }, { status: 'running' });
    });
    if (input.workflowPreviewId) this.workflowPreviews.delete(input.workflowPreviewId);
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
      const versions = this.versionView(data);
      return runSnapshotSchema.parse({
        runId: run.id,
        roomId: run.roomId,
        status: run.status,
        sequence,
        workflowSnapshot: run.workflowSnapshot,
        workflow: this.workflowProgress(data),
        currentTurnId: turns.find((turn) => turn.status === 'running')?.id,
        activeAgentId: turns.find((turn) => turn.status === 'running')?.agentId,
        turns: turns.map((turn) => {
          const latest = attempts.filter(a=>a.turnId===turn.id).at(-1);
          const legacyMessages = messages.filter(m=>m.turnId===turn.id);
          const message = activeMessageOf(data, turn.id) ?? (legacyMessages.length===1?legacyMessages[0]:undefined);
          const attempt = attempts.find(a=>a.messageId===message?.id) ?? latest;
          return {turnId:turn.id,runId:turn.runId,agentId:turn.agentId,turnIndex:turn.turnIndex,status:turn.status,requestId:attempt?.requestId??turn.requestId,messageId:message?.id,outputText:message?.content??turn.partialContent,
            ...(turn.overrideActionId?{overrideActionId:turn.overrideActionId}:{})};
        }),
        messages: messages.map((message) => ({ id: message.id, senderName: message.senderName, content: message.content, status: message.status ?? 'completed' })),
        updatedAt: run.updatedAt,startedAt:run.startedAt??undefined,execution,
        attempts:attempts.map(({inputSnapshot,providerRequestId,...safe})=>safe),
        versions, host: this.hostView(data), budget: data.budget, charges: data.charges,
      });
  }

  private versionView(data: Snapshot): MessageVersion[] {
    const affected = affectedVersions(data.messages, data.versions);
    return data.versions.map(version => {
      const message = data.messages.find(item => item.id === version.messageId)!;
      const attempt = data.attempts.find(item => item.messageId === version.messageId);
      return { messageId: version.messageId, slotId: version.slotId, author: message.senderType === 'agent' ? 'agent' as const : 'host' as const,
        versionNumber: version.versionNumber, origin: version.origin, active: version.active, affectedBy: affected.get(version.messageId) ?? [],
        ...(version.turnId ? { turnId: version.turnId } : {}), ...(version.parentMessageId ? { parentMessageId: version.parentMessageId } : {}),
        ...(attempt ? { requestId: attempt.requestId } : {}), ...(version.actionId ? { actionId: version.actionId } : {}) };
    });
  }

  private hostView(data: Snapshot): HostState {
    const pending = data.hostActions.find(action => action.kind === 'setOverride' && action.status === 'pending');
    const latest = new Map<string, Snapshot['instructions'][number]>();
    for (const revision of data.instructions) latest.set(revision.instructionId, revision);
    const job = this.contexts.get(data.run.id)?.job?.requestId;
    const generation = job ? data.attempts.find(attempt => attempt.requestId === job) : undefined;
    return {
      ...(pending ? { override: { actionId: pending.id, agentId: pending.agentId!, status: 'pending' as const, createdAt: pending.createdAt } } : {}),
      instructions: [...latest.values()].slice(-64).map(revision => ({ instructionId: revision.instructionId, revisionId: revision.id, revision: revision.revision,
        content: revision.content ?? '', status: revision.content === null ? 'cleared' as const : 'active' as const, updatedAt: revision.createdAt })),
      actions: data.hostActions.slice(-200).map(action => ({ actionId: action.id, kind: action.kind as HostCommandKind, status: action.status as HostState['actions'][number]['status'], createdAt: action.createdAt,
        ...(action.agentId ? { agentId: action.agentId } : {}), ...(action.messageId ? { messageId: action.messageId } : {}),
        ...(action.resultMessageId ? { resultMessageId: action.resultMessageId } : {}), ...(action.instructionId ? { instructionId: action.instructionId } : {}),
        ...(action.turnId ? { turnId: action.turnId } : {}) })),
      ...(generation ? { generation: { requestId: generation.requestId, messageId: generation.messageId, turnId: generation.turnId } } : {}),
    };
  }

  private workflowProgress(data: ReturnType<Database['readRunSnapshot']>): RunSnapshot['workflow'] {
    const { run, turns, attempts } = data;
    let plan: WorkflowSnapshot | undefined;
    try { plan = this.workflowPlan(run); } catch { return; }
    if (!plan) return;
    void attempts;
    const ordered = [...turns].sort((a, b) => a.turnIndex - b.turnIndex);
    const planTurns = planTurnsOf(ordered);
    if (run.nextTurnIndex !== ordered.length || ordered.some((turn, index) => turn.turnIndex !== index)
      || planTurns.some((turn, index) => turn.agentId !== plan!.steps[index]?.agentId)) return;
    // Host-directed Turns are inserted between steps: they never count as plan progress.
    let completedTurns = 0;
    let settled = true;
    for (const turn of ordered) {
      if (!turnSettled(data, turn)) { settled = false; break; }
      if (turn.overrideActionId === undefined) completedTurns++;
    }
    const context = this.contexts.get(run.id);
    const elapsedMs = context?.executing ? this.elapsed(context) : run.elapsedExecutionMs ?? 0;
    const limitReason = completedTurns < plan.steps.length ? (elapsedMs >= Math.min(run.maxDurationMs, plan.config.limits.maxDurationMs) ? 'max_duration'
      : (run.nextTurnIndex ?? 0) >= Math.min(run.maxTurns, plan.config.limits.maxTurns) ? 'max_turns' : undefined) : undefined;
    const nextStep = !limitReason && settled && completedTurns === planTurns.length ? plan.steps[completedTurns] : undefined;
    const currentStage = (planTurns.length > completedTurns ? plan.steps[planTurns.length - 1] : nextStep ?? plan.steps.at(-1))?.stageId;
    return { templateId: plan.config.templateId, completedTurns, totalTurns: plan.steps.length, elapsedMs, currentStage, nextStep, limitReason,
      stages: plan.config.stages.filter(stage => plan!.steps.some(step => step.stageId === stage.id)).map(stage => {
        const steps = plan!.steps.filter(step => step.stageId === stage.id);
        const completed = steps.filter(step => step.index < completedTurns).length;
        const started = steps.some(step => step.index < planTurns.length);
        const status = completed === steps.length ? 'completed' as const : started || stage.id === currentStage && (run.status === 'running' || run.status === 'pausing') ? 'running' as const : 'pending' as const;
        return { id: stage.id, kind: stage.kind, status, completedTurns: completed, totalTurns: steps.length };
      }),
    };
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
    this.shutdownPromise = drained.then(() => Promise.all([...this.contexts.values()].map(async context => {
      if (context.job) await this.abortJob(context);
      // A version job in a terminal Run leaves nothing to stop once aborted.
      if (this.contexts.has(context.runId)) await this.stop(context.runId);
    }))).then(() => {}).finally(() => {
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
    const jobContext = this.contexts.get(runId);
    if (jobContext?.job) {
      // Stop first ends an in-flight version regeneration, then the paused Run itself.
      await this.abortJob(jobContext);
      return this.stop(runId);
    }
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
    this.workflowPlan(run);
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
    const context = this.contexts.get(runId) ?? this.contextFrom(run);
    if (context.executing) throw new ContractError('invalid_state');
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
      { role: 'user' as const, content: continuePrompt },
    ];
    this.schedule(context, () => this.setRunState(runId, { status: 'running', finishedAt: null, lastError: null }, { status: 'running' }),
      { turn, messages, modelId: attempt.inputSnapshot.modelId,sourceRequestId:attempt.requestId,kind:suffixOf===undefined?'retry':'continue' });
    await context.promise;
  }

  /** R12: validates a trusted host @Override target against the frozen roster, current config, limits and plan stage. */
  assertOverrideAllowed(runId: string, agentId: string): void {
    const run = this.requireRun(runId);
    if (!['running', 'pausing', 'paused', 'error', 'cancelled', 'interrupted'].includes(run.status)) throw new ContractError('invalid_state');
    if (!run.membersSnapshot?.some(member => member.agentId === agentId)) throw new ContractError('not_found');
    const agent = this.database.getAgentConfiguration(agentId);
    if (!agent || agent.roomId !== run.roomId || !agent.enabled || agent.archivedAt !== null) throw new ContractError('invalid_state');
    const limits = this.contexts.get(runId) ?? this.contextFrom(run);
    if (run.nextTurnIndex! >= limits.maxTurns || run.elapsedExecutionMs! >= limits.maxDurationMs) throw new ContractError('invalid_state');
    const plan = this.workflowPlan(run);
    if (!plan) return;
    const stage = plan.steps[planTurnsOf(this.database.listTurns(runId)).length] ?? plan.steps.at(-1)!;
    if (!plan.config.stages.find(item => item.id === stage.stageId)?.memberIds.includes(agentId)) throw new ContractError('invalid_state');
  }

  /** R12: a trusted host change and its run-level notification commit atomically. */
  applyHostChange<T extends { actionId: string; kind: HostCommandKind }>(runId: string, work: () => T): T {
    this.requireRun(runId);
    return this.database.transaction(() => {
      const result = work();
      this.appendEvent(runId, 'host_updated', { actionId: result.actionId, kind: result.kind });
      return result;
    });
  }

  isRegenerating(runId: string): boolean {
    return this.contexts.get(runId)?.job !== undefined;
  }

  /** True while a request of this Run (a Turn or a version regeneration) is in flight. */
  isExecuting(runId: string): boolean {
    return this.contexts.get(runId)?.executing ?? false;
  }

  /**
   * R12: regenerate a message as a new version with a new requestId. A failed/aborted/interrupted last Turn
   * reopens like a retry but with a freshly built input; a settled earlier Turn runs a version job that
   * leaves the Run status unchanged and activates the new version only if it completes. Does not wait.
   */
  regenerateMessage(runId: string, messageId: string, actionId: string): void {
    const run = this.requireRun(runId);
    const snapshot = this.database.readRunSnapshot(runId);
    const version = snapshot.versions.find(item => item.messageId === messageId);
    const turn = snapshot.turns.find(item => item.id === version?.turnId);
    const member = run.membersSnapshot?.find(item => item.agentId === turn?.agentId);
    if (!version || !turn || !member || snapshot.messages.some(message => message.status === 'streaming')) throw new ContractError('invalid_state');
    const context = this.contexts.get(runId) ?? this.contextFrom(run);
    if (context.executing) throw new ContractError('invalid_state');
    this.assertBudget(run);
    const latest = snapshot.attempts.filter(attempt => attempt.turnId === turn.id).at(-1);
    const base = { turn, modelId: member.modelId ?? 'mock', sourceRequestId: latest?.requestId ?? turn.requestId, kind: 'regenerate' as const, sourceMessageId: messageId, actionId };
    if (turn.id === snapshot.turns.at(-1)!.id && canRetryTurn(turn.status as TurnStatus)) {
      assertRunCommand('retryTurn', run.status);
      if (!latest || !canRetryTurn(latest.status)) throw new ContractError('invalid_state');
      this.schedule(context, () => this.setRunState(runId, { status: 'running', finishedAt: null, lastError: null }, { status: 'running' }), { ...base, job: false });
      return;
    }
    if (!turnSettled(snapshot, turn) || !['paused', 'completed', 'error', 'cancelled', 'interrupted'].includes(run.status)) throw new ContractError('invalid_state');
    context.job = {};
    const job = { ...base, job: true };
    try {
      this.schedule(context, () => {}, job, async () => {
        try { await this.executeTurn(context, member, turn.turnIndex, job); }
        catch { /* The failed or aborted version and its Attempt are already persisted as evidence. */ }
        finally { this.endJob(context, actionId); }
      });
    } catch (error) { context.job = undefined; throw error; }
  }

  /** R12: abort an in-flight version regeneration; the Run status stays as it was. */
  async abortGeneration(runId: string): Promise<void> {
    const context = this.contexts.get(runId);
    if (!context?.job) throw new ContractError('invalid_state');
    await this.abortJob(context);
  }

  private async abortJob(context: RunContext): Promise<void> {
    context.stopRequested = true;
    context.abortController.abort(new ContractError('cancelled'));
    await context.promise.catch(() => {});
  }

  private endJob(context: RunContext, actionId: string): void {
    clearTimeout(context.deadline);
    const elapsed = this.elapsed(context);
    this.database.transaction(() => {
      this.database.updateRunProgress(context.runId, { elapsedExecutionMs: elapsed });
      this.persistBudgetBlock(context);
      const paused = this.requireRun(context.runId).status === 'paused';
      this.database.afterCommit(() => {
        context.elapsedBefore = elapsed;
        context.segmentStartedAt = undefined;
        context.executing = false;
        context.job = undefined;
        context.stopRequested = false;
        if (!paused) { this.contexts.delete(context.runId); this.activeRooms.delete(context.roomId); }
      });
      // Clearing the in-flight marker is itself a visible host-state change.
      this.appendEvent(context.runId, 'host_updated', { actionId, kind: 'regenerateMessage' });
    });
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
    const context = this.contexts.get(runId) ?? this.contextFrom(run);
    if (context.executing) throw new ContractError('invalid_state');
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
    const plan = this.workflowPlan(run);
    return { runId: run.id, roomId: run.roomId, members: run.membersSnapshot,
      mode: run.mode, maxTurns: Math.min(run.maxTurns, plan?.config.limits.maxTurns ?? Number.MAX_SAFE_INTEGER),
      maxDurationMs: Math.min(run.maxDurationMs, plan?.config.limits.maxDurationMs ?? Number.MAX_SAFE_INTEGER),
      outputTokenLimit: Math.min(run.outputTokenLimit, plan?.config.limits.outputTokenLimit ?? Number.MAX_SAFE_INTEGER),
      abortController: new AbortController(), stopRequested: false, timedOut: false, promise: Promise.resolve(), elapsedBefore: run.elapsedExecutionMs, executing: false };
  }

  private hasWorkflowPlan(value: RunRecord['workflowSnapshot']): boolean {
    return 'config' in value || 'steps' in value;
  }

  private workflowPlan(run: RunRecord): WorkflowSnapshot | undefined {
    if (!this.hasWorkflowPlan(run.workflowSnapshot)) return;
    let plan: WorkflowSnapshot;
    try { plan = readWorkflowSnapshot(run.workflowSnapshot); } catch { throw new ContractError('invalid_state'); }
    if (plan.roomId !== run.roomId || !sameMembers(run.membersSnapshot, plan.members)) throw new ContractError('invalid_state');
    return plan;
  }

  private assertRequestEvidence(context: RunContext, snapshot: ReturnType<Database['readRunSnapshot']>, member: MemberSnapshot, turnIndex: number, repeat?: RepeatAttempt, overrideId?: string): WorkflowStep | undefined {
    if (repeat?.kind === 'regenerate' && repeat.job) return this.assertJobEvidence(context, snapshot, member, repeat);
    const { run, turns, attempts, messages } = snapshot;
    if (this.contexts.get(context.runId) !== context || !context.executing || !this.activeRooms.has(context.roomId)
      || run.id !== context.runId || run.roomId !== context.roomId || run.status !== 'running'
      || !sameMembers(run.membersSnapshot, context.members)
      || !run.membersSnapshot?.some(frozen => memberIdentity(frozen) === memberIdentity(member))) throw new ContractError('invalid_state');
    const plan = this.workflowPlan(run);
    const ordered = [...turns].sort((a, b) => a.turnIndex - b.turnIndex);
    const planTurns = planTurnsOf(ordered);
    if (run.nextTurnIndex !== ordered.length || plan && planTurns.some((turn, index) => turn.agentId !== plan.steps[index]?.agentId) || ordered.some((turn, index) => {
      const latest = attempts.filter(attempt => attempt.turnId === turn.id).at(-1);
      const message = repeat && index === ordered.length - 1 ? latest && messages.find(item => item.id === latest.messageId) : activeMessageOf(snapshot, turn.id);
      return turn.runId !== run.id || turn.turnIndex !== index
        || !latest || latest.runId !== run.id || !message || message.runId !== run.id || message.roomId !== run.roomId || message.turnId !== turn.id
        || (repeat && index === ordered.length - 1 ? latest.requestId !== repeat.sourceRequestId || turn.id !== repeat.turn.id
          || !canRetryTurn(turn.status as TurnStatus) || !canRetryTurn(latest.status) : !turnSettled(snapshot, turn));
    })) throw new ContractError('invalid_state');
    const stageStep = (step: WorkflowStep | undefined) => step ?? plan?.steps.at(-1);
    if (repeat) {
      if (!ordered.length || repeat.turn.turnIndex !== turnIndex || repeat.turn.agentId !== member.agentId
        || turnIndex !== ordered.length - 1 || repeat.modelId !== member.modelId) throw new ContractError('invalid_state');
      return plan ? stageStep(plan.steps[planTurns.filter(turn => turn.turnIndex < turnIndex).length]) : undefined;
    }
    if (turnIndex !== run.nextTurnIndex) throw new ContractError('invalid_state');
    if (overrideId !== undefined) {
      // The pending Override is consumed in this transaction; its Turn takes no plan step.
      const action = snapshot.hostActions.find(item => item.id === overrideId);
      if (!action || action.kind !== 'setOverride' || action.status !== 'pending' || action.agentId !== member.agentId
        || turnIndex >= context.maxTurns) throw new ContractError('invalid_state');
      if (!plan) return;
      const stage = stageStep(plan.steps[planTurns.length]);
      if (!plan.config.stages.find(item => item.id === stage?.stageId)?.memberIds.includes(member.agentId)) throw new ContractError('invalid_state');
      if (this.elapsed(context) >= context.maxDurationMs && this.deadlineReached(context)) throw new ContractError('timeout');
      return stage;
    }
    if (!plan) return;
    // The loop checked the deadline before this transaction; if it expired since, end as a timeout
    // rather than letting the plan's own `limit` decision surface as invalid_state.
    const elapsed = this.elapsed(context);
    if (elapsed >= context.maxDurationMs && this.deadlineReached(context)) throw new ContractError('timeout');
    const decision = nextWorkflowStep(plan, { ...run, nextTurnIndex: planTurns.length, elapsedExecutionMs: elapsed },
      planTurns.map((turn, index) => ({ ...turn, turnIndex: index })));
    if (decision.kind !== 'next' || decision.step.index !== planTurns.length || decision.step.agentId !== member.agentId) throw new ContractError('invalid_state');
    return decision.step;
  }

  /** A version regeneration targets an earlier settled Turn while no Turn of the Run is in flight. */
  private assertJobEvidence(context: RunContext, snapshot: Snapshot, member: MemberSnapshot, job: Extract<RepeatAttempt, { kind: 'regenerate' }>): WorkflowStep | undefined {
    const { run, turns } = snapshot;
    if (this.contexts.get(context.runId) !== context || !context.executing || !context.job || !this.activeRooms.has(context.roomId)
      || run.id !== context.runId || !['paused', 'completed', 'error', 'cancelled', 'interrupted'].includes(run.status)
      || !sameMembers(run.membersSnapshot, context.members) || job.modelId !== member.modelId
      || turns.some(turn => turn.status === 'running') || snapshot.messages.some(message => message.status === 'streaming')) throw new ContractError('invalid_state');
    const turn = turns.find(item => item.id === job.turn.id);
    if (!turn || !turnSettled(snapshot, turn) || turn.agentId !== member.agentId || turn.turnIndex !== job.turn.turnIndex
      || snapshot.versions.find(version => version.messageId === job.sourceMessageId)?.slotId !== turn.id) throw new ContractError('invalid_state');
    const plan = this.workflowPlan(run);
    return plan ? plan.steps[planTurnsOf(turns).filter(item => item.turnIndex < turn.turnIndex).length] ?? plan.steps.at(-1) : undefined;
  }

  private assertSettled(runId: string): void {
    const snapshot = this.database.readRunSnapshot(runId);
    if (snapshot.turns.some(turn => !turnSettled(snapshot, turn))) throw new ContractError('invalid_state');
  }

  private assertBudget(run: RunRecord): void {
    if (run.elapsedExecutionMs !== null && run.elapsedExecutionMs >= run.maxDurationMs) throw new ContractError('timeout');
  }

  private assertAvailable(context?: RunContext): void {
    this.assertGenerationAllowed();
    if (this.shuttingDown) throw new ContractError('invalid_state');
    if (this.activeRooms.size && (!context || this.contexts.get(context.runId) !== context)) throw new Error('Another room already has an active run');
  }

  private schedule(context: RunContext, change: () => void, repeat?: RepeatAttempt, runner: () => Promise<void> = () => this.runLoop(context, repeat)): void {
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
    void runner().then(resolve, error => {
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
        const next = repeat ? undefined : this.nextSpeaker(context, run);
        if (next === 'complete') { this.finishRun(context, 'completed'); return; }
        if (run.status === 'pausing') { this.finishRun(context, 'paused'); return; }
        const turnIndex = repeat?.turn.turnIndex ?? run.nextTurnIndex!;
        const repeatedAgentId = repeat?.turn.agentId;
        const member = repeat ? context.members.find(a => a.agentId === repeatedAgentId) : next?.member;
        if (!member) throw new ContractError('invalid_state');
        await this.executeTurn(context, member, turnIndex, repeat, next?.overrideId);
        repeat = undefined;
        if (context.stopRequested) { this.finishRun(context, 'cancelled'); return; }
        if (context.budgetBlock) { this.finishRun(context, 'error', undefined, context.failureReason); return; }
        if (this.deadlineReached(context)) throw new ContractError('timeout');
        if (this.nextSpeaker(context, this.requireRun(context.runId)) === 'complete') { this.finishRun(context, 'completed'); return; }
        if (context.mode === 'step' || this.requireRun(context.runId).status === 'pausing') { this.finishRun(context, 'paused'); return; }
      }
    } catch (error) {
      const code = toPublicError(error).code;
      this.finishRun(context, context.stopRequested || code === 'cancelled' ? 'cancelled' : 'error',
        context.timedOut || code === 'timeout' ? 'Maximum run duration reached' : undefined,
        context.failureReason ?? toPublicError(error).message);
    }
  }

  /**
   * The next speaker: a pending host Override first (an inserted Turn that takes no plan step), then the
   * frozen workflow step or round-robin position counted over plan Turns only. maxTurns bounds all Turns.
   */
  private nextSpeaker(context: RunContext, run: RunRecord): 'complete' | { member: MemberSnapshot | undefined; overrideId?: string } {
    if (run.nextTurnIndex! >= context.maxTurns) return 'complete';
    const override = this.database.getPendingOverride(run.id);
    if (override) return { member: context.members.find(member => member.agentId === override.agentId), overrideId: override.id };
    const plan = this.workflowPlan(run);
    const planIndex = planTurnsOf(this.database.listTurns(run.id)).length;
    if (plan && planIndex >= plan.steps.length) return 'complete';
    const agentId = plan?.steps[planIndex].agentId;
    return { member: plan ? context.members.find(member => member.agentId === agentId) : context.members[planIndex % context.members.length] };
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

  private async executeTurn(context: RunContext, member: MemberSnapshot, turnIndex: number, repeat?: RepeatAttempt, overrideId?: string): Promise<void> {
    const turnId = repeat?.turn.id ?? randomUUID();
    const messageId = randomUUID();
    const requestId = randomUUID();
    const job = repeat?.kind === 'regenerate' && repeat.job;
    let quote: RequestQuote | undefined;
    const input:StreamChatInput = this.database.transaction(() => {
      const snapshot=this.database.readRunSnapshot(context.runId);
      const workflowStep = this.assertRequestEvidence(context, snapshot, member, turnIndex, repeat, overrideId);
      const preparation:RequestPreparation={snapshot,workflowStep,current:{turnId,requestId,messageId,agentId:member.agentId,turnIndex},
        repeat:repeat && repeat.kind!=='regenerate'?{messages:repeat.messages,sourceRequestId:repeat.sourceRequestId,kind:repeat.kind}:undefined,
        regenerate:repeat?.kind==='regenerate'?{sourceMessageId:repeat.sourceMessageId}:undefined};
      // Retry/continue replay the frozen input, so they keep its basis; new and regenerated requests use current history.
      const source = repeat && repeat.kind !== 'regenerate' ? snapshot.versions.find(v => v.messageId === snapshot.attempts.find(a => a.requestId === repeat.sourceRequestId)?.messageId) : undefined;
      const version: VersionInput = !repeat ? { origin: 'original', basis: basisBefore(snapshot.messages, snapshot.versions) }
        : repeat.kind === 'regenerate' ? { origin: 'regenerate', parentMessageId: repeat.sourceMessageId, actionId: repeat.actionId, activate: !job,
          basis: basisBefore(snapshot.messages, snapshot.versions, turnId) }
        : { origin: repeat.kind, ...(source ? { parentMessageId: source.messageId } : {}), ...(source?.basis ? { basis: source.basis } : {}) };
      const inputSnapshot=streamChatInputSchema.parse({ requestId, modelId: repeat?.modelId ?? member.modelId ?? 'mock',
        outputTokenLimit:context.outputTokenLimit,agentRole:member.roleTemplateId,turnIndex,
        messages:this.buildMessages(snapshot.run,member,turnIndex,preparation) });
      quote = member.providerId && this.registry ? this.registry.quoteRequest(member.providerId, inputSnapshot) : undefined;
      if (quote) this.assertBudgetFits(context, quote);
      if (this.deadlineReached(context)) throw new ContractError('timeout');
      if(context.abortController.signal.aborted)throw new ContractError('cancelled');
      if (job) context.job = { requestId };
      else if (repeat) this.database.updateTurn(turnId, { status: transitionTurn(repeat.turn.status as TurnStatus, 'running'), partialContent: '' });
      else this.database.insertTurn({ id: turnId, runId: context.runId, agentId: member.agentId, status: transitionTurn('pending', 'running'), requestId, turnIndex, ...(overrideId ? { overrideActionId: overrideId } : {}) });
      this.database.insertMessage({ id: messageId, roomId: context.roomId, runId: context.runId, turnId, senderType: 'agent', senderName: member.displayName, content: '', status: 'streaming' }, version);
      const attemptIndex = snapshot.attempts.filter(a => a.turnId === turnId).length;
      this.database.createAttempt({ requestId, runId: context.runId, turnId, messageId, attemptIndex, status: 'pending', inputSnapshot });
      if (quote) {
        // The maximum cost is held before any byte is sent and released only by evidence (D090).
        const { currency, inputTokenBound, outputTokenLimit, inputMicroPerToken, outputMicroPerToken, reservedMicro, priceEvidence, priceReviewedAt } = quote;
        this.database.reserveCharge({ requestId, runId: context.runId, providerId: member.providerId!, modelId: inputSnapshot.modelId, currency,
          inputTokenBound, outputTokenLimit, inputMicroPerToken, outputMicroPerToken, reservedMicro, priceEvidence, priceReviewedAt });
        if (snapshot.budget.blocked) this.database.setRunBudgetBlock(context.runId, null);
      }
      if (!job) this.database.updateRun(context.runId, { currentTurnId: turnId, currentAgentId: member.agentId });
      this.appendEvent(context.runId, 'turn_started', { turnId, messageId, agentId: member.agentId, requestId });
      return {...inputSnapshot,signal:context.abortController.signal};
    });
    const {signal}=input;
    let content = '';
    let iterator: AsyncIterator<unknown> | undefined;
    let drained = false;
    let finishReason: 'stop' | 'length' | 'content_filter' | undefined;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let dispatched = false;
    // Settles this request's reservation from evidence only: provider usage of a terminal stream, or proof it was never sent.
    const settle = () => {
      if (!quote) return;
      const charge = this.database.settleCharge(requestId, usage && finishReason ? { state: 'settled', ...usage }
        : dispatched ? { state: 'unknown', ...(usage ? { observed: usage } : {}) } : { state: 'not_sent' });
      if (charge) this.checkOverrun(context, charge);
    };
    try {
      let started = false;
      if (this.deadlineReached(context) || signal?.aborted) throw new ContractError(context.timedOut ? 'timeout' : 'cancelled');
      const dispatch = this.database.readRunSnapshot(context.runId);
      const attempt = dispatch.attempts.filter(value => value.turnId === turnId).at(-1);
      const turn = dispatch.turns.find(value => value.id === turnId);
      this.workflowPlan(dispatch.run);
      if (this.contexts.get(context.runId) !== context || !context.executing || !this.activeRooms.has(context.roomId)
        || dispatch.run.roomId !== context.roomId || !sameMembers(dispatch.run.membersSnapshot, context.members)
        || (job ? context.job?.requestId !== requestId || ['running', 'pausing', 'cancelling'].includes(dispatch.run.status) : !['running', 'pausing'].includes(dispatch.run.status))
        || !turn || turn.agentId !== member.agentId || turn.turnIndex !== turnIndex || turn.status !== (job ? 'completed' : 'running')
        || attempt?.requestId !== requestId || attempt.messageId !== messageId || !['pending', 'running'].includes(attempt.status)) throw new ContractError('invalid_state');
      const provider = member.providerId && this.registry ? this.registry.getAdapter(member.providerId, input.modelId, () => { dispatched = true; }) : this.provider;
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
              if (!job) this.database.updateTurn(turnId, { partialContent: content });
              this.persistElapsed(context);
              this.appendEvent(context.runId, 'text_delta', { turnId, messageId, senderName: member.displayName, text: chunk.text });
            });
          } else if (chunk.type === 'reasoning_summary_delta') {
            this.appendAndNotify(context.runId, 'reasoning_summary_delta', { turnId, messageId, senderName: member.displayName, text: chunk.text });
          } else if (chunk.type === 'usage') {
            usage = { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens };
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
        // A completed regeneration becomes its slot's effective version; the Turn's own state is unchanged.
        if (job) this.database.activateVersion(messageId);
        else this.database.updateTurn(turnId, { status: transitionTurn('running', 'completed'), partialContent: content });
        this.database.updateAttempt(requestId, { status: 'completed' });
        settle();
        this.persistElapsed(context);
        this.appendEvent(context.runId, 'turn_completed', { turnId, messageId });
      });
    } catch (error) {
      const code = toPublicError(error).code;
      const aborted = context.stopRequested || context.timedOut || code === 'cancelled' || code === 'timeout';
      this.database.transaction(() => {
        this.database.updateMessage(messageId, content, aborted ? 'aborted' : 'failed');
        if (!job) this.database.updateTurn(turnId, { status: transitionTurn('running', aborted ? 'aborted' : 'failed'), partialContent: content });
        this.database.updateAttempt(requestId, { status: aborted ? 'aborted' : 'failed' });
        settle();
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
          // Without terminal usage an open reservation stays charged in full.
          this.database.settleCharge(attempt.requestId, { state: 'unknown' });
          this.appendEvent(context.runId, aborted ? 'turn_aborted' : 'turn_failed', { turnId: turn.id, messageId: message.id,
            error: publicError(context.timedOut ? 'timeout' : aborted ? 'cancelled' : 'internal_error') });
        }
      }
      this.database.updateRunProgress(context.runId, { elapsedExecutionMs: elapsed });
      this.persistBudgetBlock(context);
      const pending = status === 'completed' ? this.database.getPendingOverride(context.runId) : undefined;
      if (pending) this.database.settleHostAction(pending.id, 'expired');
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

  /** The next request's maximum cost must fit in what the Run has left; equal is allowed. */
  private assertBudgetFits(context: RunContext, quote: RequestQuote): void {
    if (quote.currency !== 'CNY') return; // Only an exactly zero non-CNY price is ever quoted.
    const budget = this.database.getRunBudget(context.runId);
    if (quote.reservedMicro <= budget.remainingMicro) return;
    this.blockBudget(context, { reason: 'insufficient', requiredMicro: quote.reservedMicro, remainingMicro: budget.remainingMicro, at: new Date().toISOString() });
    throw new ContractError('budget_exceeded');
  }

  /** Provider usage above the reserved bound disproves the bound for this Run: stop scheduling and report it. */
  private checkOverrun(context: RunContext, charge: RequestCharge): void {
    if (charge.state !== 'settled' || (charge.inputTokens! <= charge.inputTokenBound && charge.outputTokens! <= charge.outputTokenLimit
      && charge.accountedMicro! <= charge.reservedMicro)) return;
    this.blockBudget(context, { reason: 'overrun', requestId: charge.requestId, reservedMicro: charge.reservedMicro, accountedMicro: charge.accountedMicro!, at: new Date().toISOString() });
  }

  private blockBudget(context: RunContext, block: BudgetBlock): void {
    context.budgetBlock = block;
    context.failureReason = budgetBlockMessage(block);
  }

  private persistBudgetBlock(context: RunContext): void {
    const block = context.budgetBlock;
    if (!block) return;
    this.database.setRunBudgetBlock(context.runId, block);
    this.database.afterCommit(() => { if (context.budgetBlock === block) context.budgetBlock = undefined; });
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
