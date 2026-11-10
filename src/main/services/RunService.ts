import { createHash, randomUUID } from 'node:crypto';
import { setImmediate as drainReadyCallbacks } from 'node:timers/promises';
import type { RunEvent, RunSnapshot, RunSubscription, RunStatus, TurnStatus } from '../../shared/types/run';
import { assertRunCommand, canRetryTurn, transitionRun, transitionTurn } from '../orchestrator/stateMachine';
import type { StartRunInput } from '../../shared/contracts/run';
import type { InterruptedRunDecision } from '../../shared/types/run';
import { ContractError, toPublicError } from '../../shared/contracts/errors';
import { failedBeforeWriting, publicError, type ErrorCode } from '../../shared/schemas/error';
import { DEFAULT_OUTPUT_TOKEN_LIMIT, interruptedRunDecisionSchema, runEventSchema, runSnapshotSchema, runSubscriptionSchema, startRunInputSchema } from '../../shared/schemas/run';
import { compileWorkflow, nextWorkflowStep, readWorkflowSnapshot } from '../workflow';
import type { WorkflowConfig, WorkflowSnapshot, WorkflowStep } from '../workflow';
import { DEFAULT_RUN_DURATION_MS, workflowPreviewInputSchema } from '../../shared/schemas/workflow';
import { roomMessagesSchema } from '../../shared/schemas/app';
import { PROTOCOL_VERSION } from '../../shared/schemas/common';
import { normalizedChunkSchema, streamChatInputSchema } from '../../shared/schemas/provider';
import type { MemberSnapshot } from '../../shared/schemas/persistence';
import type { Database, RunEventRecord, RunRecord, TurnRecord, VersionInput } from '../database/Database';
import { affectedVersions, basisBefore, effectiveInstructions } from '../host/versions';
import type { HostCommandKind, HostState, MessageVersion } from '../../shared/schemas/host';
import type { ProviderRegistry } from '../providers/ProviderRegistry';
import type { ProviderAdapter, StreamChatInput } from '../providers/types';
import { summaryConfirmInputSchema, summaryGenerateInputSchema, summaryPreviewInputSchema, type ContextPressure, type ContextSummary,
  type SummaryCommandResult, type SummaryConfirmInput, type SummaryGenerateInput, type SummaryPreview, type SummaryPreviewInput } from '../../shared/schemas/summary';
import { activeSummary, buildSummaryMessages, publicSlots, revisedCoveredSlots, summaryBasis, summaryRange, type ActiveSummary, type PublicSlot } from '../context/summary';
import { measureContext, type ModelBudget } from '../context/wirePublicContext';
import { countModelTokens } from '../context/buildPublicContext';
import { mockModelBudget } from '../providers/mock/tokenBudget';
import { artifactGenerateInputSchema, artifactPreviewInputSchema, MAX_ARTIFACT_ISSUES, type ArtifactCommandResult, type ArtifactGenerateInput, type ArtifactKind,
  type ArtifactPreview, type ArtifactPreviewInput } from '../../shared/schemas/artifact';
import { parseArtifact } from '../../shared/schemas/artifactParse';
import { artifactOutputTokenLimit, buildArtifactRequest } from '../artifact/prompt';
import { continuationPreviewInputSchema, continueDiscussionInputSchema, type ContinuationPreview, type ContinuationPreviewInput,
  type ContinueDiscussionInput, type ContinueDiscussionResult, type RunContinuation } from '../../shared/schemas/continuation';
import { GROUP_CHAT_MAX_SCHEDULES, GROUP_CHAT_MAX_TURNS, GROUP_CHAT_SCHEDULE_MAX_TOKENS, GROUP_CHAT_SCHEDULE_TIMEOUT_MS, isGroupChatSnapshot, type GroupChatRoundState, type GroupChatState } from '../../shared/schemas/groupChat';
import { classifyHostMessage, firstBatch, isAcknowledgement, isContinueMessage, isGather, isStopMessage, memberHints, parseMentions, parseScheduleOutput, seedOf, skipsThinking, type PlannedSpeaker, type ScheduleOutput } from '../../shared/groupChat';
import { buildScheduleMessages, type ScheduleState } from '../groupChat/schedulePrompt';
import type { GroupChatRound, GroupChatSpeaker } from '../database/Database';
import type { GroupChatCue } from '../context/transcript';
import type { ImageAttachment } from '../../shared/schemas/attachment';

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
  // D149: a group-chat Run runs its own loop; `interrupt` says the current request was aborted by a new host message, not by a stop.
  groupChat?: boolean;
  interrupt?: boolean;
  turnFailed?: boolean;
};

export type RequestPreparation = {
  snapshot: ReturnType<Database['readRunSnapshot']>;
  current: { turnId: string; requestId: string; messageId: string; agentId: string; turnIndex: number };
  workflowStep?: WorkflowStep;
  repeat?: { messages: StreamChatInput['messages']; sourceRequestId: string; kind: 'retry' | 'continue' };
  /** R12: rebuild the existing Turn's input from current effective history before it and current host instructions. */
  regenerate?: { sourceMessageId: string };
  /** D153: this request is a group-chat reply. */
  groupChat?: GroupChatCue;
};
export type RunMessagesBuilder = (run: RunRecord, member: MemberSnapshot, turnIndex: number, preparation: RequestPreparation) => StreamChatInput['messages'];
type RepeatAttempt = { turn: TurnRecord; messages: StreamChatInput['messages']; modelId: string; sourceRequestId: string; kind: 'retry' | 'continue' }
  | { turn: TurnRecord; modelId: string; sourceRequestId: string; kind: 'regenerate'; sourceMessageId: string; actionId: string; job: boolean;
    /** D102: continue a reply cut off by the output limit; the new version starts with the old text. */
    extend?: { messages: StreamChatInput['messages']; prefix: string } };
type Snapshot = ReturnType<Database['readRunSnapshot']>;
const continuePrompt = 'Continue the previous response from where it stopped.';
const summarySenderName = '讨论摘要';
const hostSenderName = '主持人';
// A member whose role reads as a synthesizer writes summaries by default (same vocabulary as the built-in role guide).
const summarizerPattern = /综合|总结|汇总|整合|归纳|synth|summar|integrat/iu;
const imagesPlaceholder = (count: number) => count ? `[图片 ${count} 张]` : '';
const excerpt = (text: string) => { const flat = text.replace(/\s+/gu, ' ').trim(); return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat; };


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
/** A host-directed Turn: an @Override (D110) or one answer of a continuation (D111). Neither is a plan Turn. */
type Directed = { kind: 'override' | 'continuation'; actionId: string };
type Speaker = { member: MemberSnapshot | undefined; directed?: Directed };
/** D111: the latest continuation and the members still to answer it, in order. */
function openContinuation(continuations: Snapshot['continuations'], turns: readonly TurnRecord[]) {
  const latest = continuations.at(-1);
  if (!latest) return undefined;
  const answered = turns.filter(turn => turn.overrideActionId === latest.actionId).length;
  return { continuation: latest, remaining: latest.agentIds.slice(answered) };
}
/** Input bounds count UTF-8 bytes (byte-level BPE never makes more tokens); a message's label and notes stay under 64. */

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
    /** R13B: a member's context window and token counter, for summary requests and the context-pressure hint. */
    private readonly modelBudget: (member: MemberSnapshot) => ModelBudget | undefined = member => member.modelId === 'mock' ? mockModelBudget : undefined) {}
  private readonly pressureCache = new Map<string, { key: string; value?: ContextPressure }>();
  /** D150: how long a scheduling request may take before the rules take over. */
  scheduleTimeoutMs = GROUP_CHAT_SCHEDULE_TIMEOUT_MS;

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
    const taskAttachmentIds = this.database.assertAttachmentIds(input.attachmentIds);
    let workflow: WorkflowSnapshot | undefined;
    if (input.workflowConfig) {
      workflow = this.compileCurrentWorkflow(input.roomId, input.workflowConfig);
      const preview = input.workflowPreviewId ? this.workflowPreviews.get(input.workflowPreviewId) : undefined;
      if (!preview || JSON.stringify(preview) !== JSON.stringify(workflow)) throw new ContractError('invalid_state');
    } else if (input.workflowPreviewId || this.hasWorkflowPlan(input.workflowSnapshot ?? {})
      // D149: the marker is exactly this and nothing more; it brings no plan and no roster of its own.
      || isGroupChatSnapshot(input.workflowSnapshot) && Object.keys(input.workflowSnapshot!).sort().join() !== 'templateId,version') {
      // Caller-supplied frozen rosters/steps cannot bypass Main compilation or preview freshness.
      throw new ContractError('invalid_input');
    }
    const members = workflow?.members ?? this.database.listAgents(input.roomId, this.registry ? (providerId, modelId) => this.registry!.assertSelection(providerId, modelId) : undefined)
      .map(({ id, roomId: _roomId, ...member }) => ({ ...member, agentId: id, modelId: member.modelId ?? 'mock' }));
    if (!members.length) throw new ContractError('invalid_state');
    const runId = randomUUID();
    const groupChat = !workflow && isGroupChatSnapshot(input.workflowSnapshot);
    const context: RunContext = { runId, roomId: input.roomId, members, ...(groupChat ? { groupChat: true } : {}),
      mode: groupChat ? 'automatic' : input.mode ?? 'automatic', // With no stated limit every member speaks once: a fourth member must not be left out in silence.
      maxTurns: groupChat ? GROUP_CHAT_MAX_TURNS : Math.min(input.maxTurns ?? workflow?.config.limits.maxTurns ?? Math.max(3, members.length), workflow?.config.limits.maxTurns ?? Number.MAX_SAFE_INTEGER),
      maxDurationMs: Math.min(input.maxDurationMs ?? workflow?.config.limits.maxDurationMs ?? DEFAULT_RUN_DURATION_MS, workflow?.config.limits.maxDurationMs ?? Number.MAX_SAFE_INTEGER),
      outputTokenLimit: Math.min(input.outputTokenLimit ?? workflow?.config.limits.outputTokenLimit ?? DEFAULT_OUTPUT_TOKEN_LIMIT, workflow?.config.limits.outputTokenLimit ?? Number.MAX_SAFE_INTEGER),
      abortController: new AbortController(), stopRequested: false, timedOut: false, promise: Promise.resolve(), elapsedBefore: 0, executing: false };
    this.schedule(context, () => {
      this.database.insertRun({ id: runId, roomId: input.roomId, status: 'idle', workflowSnapshot: workflow ?? input.workflowSnapshot ?? {}, mode: context.mode, maxTurns: context.maxTurns, maxDurationMs: context.maxDurationMs, outputTokenLimit: context.outputTokenLimit,
        task: input.task, membersSnapshot: members, nextTurnIndex: 0, elapsedExecutionMs: 0 }, taskAttachmentIds);
      this.setRunState(runId, { status: 'running', startedAt: new Date().toISOString() }, { status: 'running' });
      if (groupChat) this.openRound(context, input.task, undefined, runId, taskAttachmentIds.length > 0);
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
      const lastFailure = turns.some(turn => turn.status === 'failed') ? this.database.latestTurnFailure(run.id) : undefined;
      const durationStop = this.durationStop(data);
      return runSnapshotSchema.parse({
        ...(lastFailure ? { lastFailure } : {}),
        ...(durationStop ? { durationStop } : {}),
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
        messages: messages.map((message) => ({ id: message.id, senderName: message.senderName, content: message.content, status: message.status ?? 'completed', ...(message.attachments ? { attachments: message.attachments } : {}) })),
        ...(data.taskAttachments ? { taskAttachments: data.taskAttachments } : {}),
        updatedAt: run.updatedAt,startedAt:run.startedAt??undefined,execution,
        attempts:attempts.map(({inputSnapshot,providerRequestId,...safe})=>safe),
        versions, host: this.hostView(data), usage: data.usage,
        ...(data.summaries.length ? { summaries: this.summaryView(data) } : {}),
        ...(data.artifactRequestIds.length ? { artifactRequestIds: data.artifactRequestIds } : {}),
        ...(data.continuations.length ? { continuations: data.continuations.map((item): RunContinuation => {
          const message = data.hostActions.find(action => action.id === item.actionId)?.resultMessageId;
          return { actionId: item.actionId, agentIds: item.agentIds, createdAt: item.createdAt, ...(message ? { messageId: message } : {}) };
        }) } : {}),
        ...this.pressureView(data),
        ...this.groupChatView(data),
      });
  }

  /** D149: where the current group-chat round stands, for the page to show. */
  private groupChatView(data: Snapshot): { groupChat?: GroupChatState } {
    if (!isGroupChatSnapshot(data.run.workflowSnapshot)) return {};
    const round = data.groupChatRound;
    return { groupChat: { scheduleRequestIds: data.scheduleRequests.map(request => request.requestId), ...(round ? { round: { roundId: round.id, classification: round.classification, state: round.state,
      turnsUsed: round.speakers.filter(speaker => speaker.state === 'started').length, scheduleCalls: round.scheduleCalls, scheduling: round.scheduling,
      spoke: [...new Set(round.speakers.filter(speaker => speaker.state === 'started').map(speaker => speaker.agentId))],
      readFailed: !round.scheduling && data.scheduleRequests.some(request => request.roundId === round.id) && !data.scheduleRequests.some(request => request.roundId === round.id && (request.status === 'completed' || request.status === 'aborted')),
      queue: round.speakers.filter(speaker => speaker.state === 'queued').map(({ agentId, intent, length, source }) => ({ agentId, intent, length, source })) } } : {}) } };
  }

  private versionView(data: Snapshot): MessageVersion[] {
    const affected = affectedVersions(data.messages, data.versions);
    return data.versions.map(version => {
      const message = data.messages.find(item => item.id === version.messageId)!;
      const attempt = data.attempts.find(item => item.messageId === version.messageId);
      const author = message.senderType === 'agent' ? 'agent' as const : message.senderType === 'system' ? 'summary' as const : 'host' as const;
      return { messageId: version.messageId, slotId: version.slotId, author,
        versionNumber: version.versionNumber, origin: version.origin, active: version.active, affectedBy: affected.get(version.messageId) ?? [],
        ...(version.turnId ? { turnId: version.turnId } : {}), ...(version.parentMessageId ? { parentMessageId: version.parentMessageId } : {}),
        ...(attempt ? { requestId: attempt.requestId } : {}), ...(version.actionId ? { actionId: version.actionId } : {}) };
    });
  }

  /** R13B: summaries with the numbers they cover, as the timeline shows them. */
  private summaryView(data: Snapshot): ContextSummary[] {
    const slots = publicSlots(data);
    return data.summaries.map(record => {
      const range = summaryRange(record, slots) ?? { firstNumber: 1, lastNumber: record.covered.length };
      const active = data.versions.find(version => version.slotId === record.id && version.active);
      const revised = active ? revisedCoveredSlots(data, record.covered, active.messageId).map(slot => slot.slotId) : [];
      return { summaryId: record.id, slotId: record.id, agentId: record.agentId, coveredSlotIds: record.covered, ...range,
        ...(revised.length ? { revisedSlotIds: revised } : {}),
        ...(record.basedOnSummaryId ? { basedOnSummaryId: record.basedOnSummaryId } : {}),
        requests: record.requests.map(request => ({ requestId: request.requestId, messageId: request.messageId, status: request.status,
          ...(request.finishReason ? { finishReason: request.finishReason } : {}), ...(request.errorCode ? { errorCode: request.errorCode } : {}), createdAt: request.createdAt })),
        confirmedMessageIds: record.confirmedMessageIds, ...(record.revokedMessageIds.length ? { revokedMessageIds: record.revokedMessageIds } : {}), createdAt: record.createdAt };
    });
  }

  /**
   * R13B: how full the next request would be, for the fullest member. Recomputed only when the effective history,
   * the confirmed summaries or the next position change, never per streamed token.
   */
  private pressureView(data: Snapshot): { contextPressure?: ContextPressure } {
    const { run } = data;
    const members = run.membersSnapshot;
    if (!members?.length || run.nextTurnIndex === null || run.task === null) return {};
    const key = JSON.stringify([data.versions.filter(version => version.active).map(version => version.messageId),
      data.messages.filter(message => message.status === 'completed').length, data.summaries.map(summary => summary.confirmedMessageIds),
      data.instructions.length, run.nextTurnIndex, run.outputTokenLimit]);
    const cached = this.pressureCache.get(run.id);
    if (cached?.key === key) return cached.value ? { contextPressure: cached.value } : {};
    let fullest: ContextPressure | undefined;
    const ratio = (pressure: ContextPressure) => pressure.level === 'over' ? Number.POSITIVE_INFINITY : pressure.usedTokens / Math.max(1, pressure.inputBudgetTokens);
    for (const member of members) {
      try {
        const pressure = measureContext(run, member, data, this.modelBudget(member));
        if (pressure && (!fullest || ratio(pressure) > ratio(fullest))) fullest = pressure;
      } catch { /* A member whose model cannot be measured now gives no hint. */ }
    }
    if (this.pressureCache.size > 64) this.pressureCache.delete(this.pressureCache.keys().next().value!);
    this.pressureCache.set(run.id, { key, value: fullest });
    return fullest ? { contextPressure: fullest } : {};
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
    // D110: only plan Turns count toward the turn limit; D111: a continued Run's duration counts from its continuation.
    const limitReason = completedTurns < plan.steps.length ? (elapsedMs >= this.durationLimit(data) ? 'max_duration'
      : planTurns.length >= Math.min(run.maxTurns, plan.config.limits.maxTurns) ? 'max_turns' : undefined) : undefined;
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
        this.closeOpenRound(runId, 'stopped');
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
    const run = this.requireRun(runId);
    if (this.durationStop({ run, continuations: this.database.listContinuations(runId) })) { await this.continueAfterLimit(run); return; }
    await this.resumePaused(runId, 'automatic');
  }

  /**
   * D146: a discussion stopped at its duration limit carries on where it was. Only the host's click gets here: what was
   * unfinished is asked again as a new Attempt beside the old one, or the next member speaks if a stop fell between turns.
   */
  private async continueAfterLimit(run: RunRecord): Promise<void> {
    const last = this.database.listTurns(run.id).at(-1);
    if (last && canRetryTurn(last.status as TurnStatus)) { await this.repeatAttempt(run.id, last.id); return; }
    const context = this.contexts.get(run.id) ?? this.contextFrom(run);
    if (context.executing) throw new ContractError('invalid_state');
    this.assertSettled(run.id);
    const renewed = this.renewDuration(run, context);
    this.schedule(context, () => this.setRunState(run.id, { status: 'running', finishedAt: null, lastError: null, ...renewed }, { status: 'running' }));
    await context.promise;
  }

  private async resumePaused(runId: string, mode: RunContext['mode']): Promise<void> {
    const run = this.requireRun(runId);
    assertRunCommand(mode === 'step' ? 'step' : 'resumeRun', run.status);
    this.workflowPlan(run);
    const context = this.contexts.get(runId) ?? this.contextFrom(run);
    if (context.executing) throw new ContractError('invalid_state');
    this.assertSettled(runId);
    const renewed = this.renewDuration(run, context);
    context.mode = mode;
    this.schedule(context, () => this.setRunState(runId, { status: 'running', mode, ...renewed }, { status: 'running' }));
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
    // D155: in a group chat a failed reply stays in its place while the others go on, so any of them can be asked again, once the chat is waiting.
    const groupChat = this.isGroupChat(run);
    if (!(groupChat && run.status === 'completed')) assertRunCommand(suffixOf === undefined ? 'retryTurn' : 'continueMessage', run.status);
    const turns = this.database.listTurns(runId);
    const turn = groupChat ? turns.find(item => item.id === turnId) : turns.at(-1);
    const requestId = this.database.getLatestAttemptRequestId(turnId);
    const attempt = requestId ? this.database.getAttempt(requestId) : undefined;
    if (!turn || turn.id !== turnId || !canRetryTurn(turn.status as TurnStatus) || !attempt
      || !canRetryTurn(attempt.status) || !attempt.inputSnapshot) throw new ContractError('invalid_state');
    const renewed = this.renewDuration(run, context);
    const messages = suffixOf === undefined ? attempt.inputSnapshot.messages : [
      ...attempt.inputSnapshot.messages,
      { role: 'assistant' as const, content: suffixOf },
      { role: 'user' as const, content: continuePrompt },
    ];
    this.schedule(context, () => this.setRunState(runId, { status: 'running', finishedAt: null, lastError: null, ...renewed }, { status: 'running' }),
      { turn, messages, modelId: attempt.inputSnapshot.modelId,sourceRequestId:attempt.requestId,kind:suffixOf===undefined?'retry':'continue' });
    await context.promise;
  }

  /** D111: who would answer a continuation of this finished discussion. Sends and records nothing. */
  previewContinuation(input: ContinuationPreviewInput): ContinuationPreview {
    const parsed = continuationPreviewInputSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input');
    const plan = this.planContinuation(this.requireRun(parsed.data.runId), parsed.data.agentId);
    return { runId: parsed.data.runId, available: plan.reason === undefined, ...(plan.reason ? { reason: plan.reason } : {}), agentIds: plan.agentIds };
  }

  /**
   * D111: continue a finished discussion (completed, or stopped with every Turn settled) in the
   * same Run. The host's words become a public interjection, recorded with its continuation and the Run's return to
   * running in one transaction; then the named member answers once, or every available member once in roster order.
   * Repeating a delivery returns the original
   * continuation. Does not wait.
   */
  continueDiscussion(input: ContinueDiscussionInput): ContinueDiscussionResult {
    const parsed = continueDiscussionInputSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input', parsed.error.issues[0]?.path[0] === 'content' ? 'content' : undefined);
    input = parsed.data;
    const run = this.requireRun(input.runId);
    const fingerprint = createHash('sha256').update(JSON.stringify(['continueDiscussion', input.runId, input.content, input.agentId ?? null, ...(input.attachmentIds?.length ? [input.attachmentIds] : [])])).digest('hex');
    const previous = this.database.findHostAction(run.id, input.clientRequestId);
    if (previous) {
      const continuation = this.database.listContinuations(run.id).find(item => item.actionId === previous.id);
      if (previous.fingerprint !== fingerprint || !continuation || !previous.resultMessageId) throw new ContractError('invalid_input', 'clientRequestId');
      return { runId: run.id, actionId: previous.id, messageId: previous.resultMessageId, agentIds: continuation.agentIds, duplicate: true };
    }
    const attachments = this.database.assertAttachmentIds(input.attachmentIds).map(id => this.database.getAttachment(id)!);
    const plan = this.planContinuation(run, input.agentId);
    if (plan.reason === 'unsupported') throw new ContractError('unsupported');
    if (plan.reason === 'context_exceeds') throw new ContractError('invalid_input', 'content');
    if (plan.reason) throw new ContractError('invalid_state');
    const context = this.contextFrom(run);
    const elapsedBaseMs = run.elapsedExecutionMs!;
    context.maxDurationMs = this.durationLimit({ run, continuations: [{ actionId: '', runId: run.id, agentIds: plan.agentIds, elapsedBaseMs, createdAt: '' }] });
    const actionId = randomUUID();
    const messageId = randomUUID();
    this.schedule(context, () => {
      // An Override left from before the stop is replaced by what the host asks for now.
      const pending = this.database.getPendingOverride(run.id);
      if (pending) this.database.settleHostAction(pending.id, 'superseded');
      this.database.insertMessage({ id: messageId, roomId: run.roomId, runId: run.id, senderType: 'user', senderName: hostSenderName, content: input.content, status: 'completed', ...(attachments.length ? { attachments } : {}) });
      this.database.insertHostAction({ id: actionId, runId: run.id, clientRequestId: input.clientRequestId, kind: 'interject', status: 'applied', fingerprint, resultMessageId: messageId });
      this.database.insertContinuation({ actionId, runId: run.id, agentIds: plan.agentIds, elapsedBaseMs });
      this.appendEvent(run.id, 'host_updated', { actionId, kind: 'interject' });
      this.setRunState(run.id, { status: 'running', finishedAt: null, lastError: null }, { status: 'running' });
    });
    return { runId: run.id, actionId, messageId, agentIds: plan.agentIds, duplicate: false };
  }

  /**
   * D111: a continuation's answering members. Only a completed or stopped Run with every Turn settled and nothing in
   * flight continues. Members are the frozen roster, limited to those still enabled.
   */
  private planContinuation(run: RunRecord, agentId: string | undefined) {
    type Plan = { agentIds: string[]; reason?: NonNullable<ContinuationPreview['reason']> };
    const roster = [...(run.membersSnapshot ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);
    if (agentId !== undefined && !roster.some(member => member.agentId === agentId)) throw new ContractError('not_found');
    const available = roster.filter(member => {
      const agent = this.database.getAgentConfiguration(member.agentId);
      return agent && agent.roomId === run.roomId && agent.enabled && agent.archivedAt === null;
    });
    const answering = agentId === undefined ? available : available.filter(member => member.agentId === agentId);
    const plan: Plan = { agentIds: answering.map(member => member.agentId).slice(0, 64) };
    if (run.task === null || !roster.length || run.nextTurnIndex === null || run.elapsedExecutionMs === null) return { ...plan, reason: 'unsupported' as const };
    // D149: a group chat goes on with `interject`; it has no continuations.
    if (isGroupChatSnapshot(run.workflowSnapshot)) return { ...plan, reason: 'unsupported' as const };
    const snapshot = this.database.readRunSnapshot(run.id);
    // Any stop with nothing left to retry can continue.
    if (!['completed', 'cancelled', 'error'].includes(run.status)) return { ...plan, reason: 'not_finished' as const };
    if (this.isExecuting(run.id) || this.contexts.get(run.id)?.job || snapshot.messages.some(message => message.status === 'streaming')
      || snapshot.turns.some(turn => !turnSettled(snapshot, turn))) return { ...plan, reason: 'busy' as const };
    if (!answering.length) return { ...plan, reason: 'member_unavailable' as const };
    // Each answer is checked as it would be sent now, so a member that cannot be reached or does not fit is said up front.
    for (const member of answering) {
      if (!member.providerId || !this.registry) continue;
      try {
        const current = { turnId: randomUUID(), requestId: randomUUID(), messageId: randomUUID(), agentId: member.agentId, turnIndex: run.nextTurnIndex };
        const messages = this.buildMessages(run, member, run.nextTurnIndex, { snapshot, current });
        this.registry.checkGeneration(member.providerId, streamChatInputSchema.parse({ requestId: current.requestId, modelId: member.modelId ?? 'mock',
          messages, outputTokenLimit: this.memberOutputLimit(this.contextFrom(run).outputTokenLimit, member), agentRole: member.roleTemplateId, turnIndex: run.nextTurnIndex }));
      } catch (error) {
        return { ...plan, reason: toPublicError(error).code === 'invalid_input' ? 'context_exceeds' as const : 'unsupported' as const };
      }
    }
    return plan;
  }

  /** D107: what a summary would cover and who would write it. Sends and records nothing. */
  previewSummary(input: SummaryPreviewInput): SummaryPreview {
    const parsed = summaryPreviewInputSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input');
    const plan = this.planSummary(parsed.data);
    const { snapshot, slots } = plan;
    const agents = (snapshot.run.membersSnapshot ?? []).map(member => ({ agentId: member.agentId, name: member.displayName, providerId: member.providerId, modelId: member.modelId }));
    return {
      runId: snapshot.run.id, available: plan.reason === undefined, ...(plan.reason ? { reason: plan.reason } : {}),
      candidates: slots.map(slot => ({ slotId: slot.slotId, number: slot.number,
        speaker: slot.author === 'host' ? '主持人' : snapshot.run.membersSnapshot?.find(member => member.agentId === slot.agentId)?.displayName ?? slot.message.senderName,
        excerpt: excerpt(slot.message.content) || imagesPlaceholder(slot.message.attachments?.length ?? 0) })),
      ...(plan.through ? { throughSlotId: plan.through.slotId, firstNumber: 1, lastNumber: plan.through.number } : {}),
      agents, ...(plan.member ? { agentId: plan.member.agentId } : {}),
      ...(plan.basedOn ? { basedOn: { summaryId: plan.basedOn.record.id, lastNumber: plan.basedOn.lastNumber } } : {}),
      ...(plan.inputTokens !== undefined ? { inputTokens: plan.inputTokens } : {}), ...(plan.inputBudgetTokens !== undefined ? { inputBudgetTokens: plan.inputBudgetTokens } : {}),
    };
  }

  /**
   * D107: generate a summary as an explicit request of one frozen member. A new summary becomes a timeline
   * slot; regenerating an existing one adds a version that becomes effective only when it completes. Does not wait.
   */
  generateSummary(input: SummaryGenerateInput): SummaryCommandResult {
    const parsed = summaryGenerateInputSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input');
    input = parsed.data;
    const run = this.requireRun(input.runId);
    const previous = this.database.findSummaryRequestByClient(run.id, input.clientRequestId);
    if (previous) {
      if (previous.agentId !== input.agentId || input.summaryId !== undefined && previous.summaryId !== input.summaryId) throw new ContractError('invalid_input', 'clientRequestId');
      return { runId: run.id, summaryId: previous.summaryId, requestId: previous.requestId, messageId: previous.messageId, duplicate: true };
    }
    const plan = this.planSummary(input);
    if (plan.reason === 'busy') throw new ContractError('invalid_state');
    if (plan.reason === 'unsupported') throw new ContractError('unsupported');
    if (plan.reason || !plan.member || !plan.through || !plan.messages) throw new ContractError('invalid_input', 'throughSlotId');
    if (plan.through.slotId !== input.throughSlotId) throw new ContractError('invalid_input', 'throughSlotId');
    const { member, through, existing, basedOn, slots, snapshot } = plan;
    const context = this.contexts.get(run.id) ?? this.contextFrom(run);
    if (context.executing) throw new ContractError('invalid_state');
    this.allowSideRequest(context);
    const requestId = randomUUID(); const messageId = randomUUID();
    const summaryId = existing?.id ?? messageId;
    const covered = slots.filter(slot => slot.number <= through.number).map(slot => slot.slotId);
    const record = { covered, ...(existing?.basedOnSummaryId ?? basedOn?.record.id ? { basedOnSummaryId: existing?.basedOnSummaryId ?? basedOn!.record.id } : {}) };
    const basis = summaryBasis(snapshot, record);
    const inputSnapshot = streamChatInputSchema.parse({ requestId, modelId: member.modelId ?? 'mock', messages: plan.messages, outputTokenLimit: this.memberOutputLimit(context.outputTokenLimit, member), agentRole: 'summary' });
    const tracked = this.tracksUsage(member);
    context.job = {};
    try {
      this.schedule(context, () => {
        if (tracked) this.registry!.checkGeneration(member.providerId!, inputSnapshot);
        const active = existing ? snapshot.versions.find(version => version.slotId === existing.id && version.active) : undefined;
        this.database.insertMessage({ id: messageId, roomId: run.roomId, runId: run.id, senderType: 'system', senderName: summarySenderName, content: '', status: 'streaming' },
          existing ? { slotId: existing.id, origin: 'regenerate', parentMessageId: active?.messageId, activate: false, basis } : { origin: 'original', basis });
        if (!existing) this.database.insertSummary({ id: summaryId, runId: run.id, clientRequestId: input.clientRequestId, agentId: member.agentId, covered, ...(record.basedOnSummaryId ? { basedOnSummaryId: record.basedOnSummaryId } : {}) });
        this.database.insertSummaryRequest({ requestId, summaryId, runId: run.id, messageId, clientRequestId: input.clientRequestId, agentId: member.agentId, inputSnapshot });
        if (tracked) this.database.openUsage({ requestId, runId: run.id, agentId: member.agentId, providerId: member.providerId!, modelId: inputSnapshot.modelId, kind: 'summary' });
        context.job = { requestId };
        this.appendEvent(run.id, 'summary_updated', { summaryId, messageId, status: 'generating' });
      }, undefined, async () => {
        try { await this.executeSummary(context, member, { requestId, messageId, summaryId, regenerate: existing !== undefined, input: inputSnapshot, tracked }); }
        catch { /* The failed or aborted summary version, its request and its usage are already persisted as evidence. */ }
        finally { this.endJob(context); }
      });
    } catch (error) { context.job = undefined; throw error; }
    return { runId: run.id, summaryId, requestId, messageId, duplicate: false };
  }

  /** D140: the host stops using the effective version of a summary; later requests go back to the originals. */
  revokeSummary(input: SummaryConfirmInput): SummaryCommandResult {
    return this.setSummaryUse(input, false);
  }

  /** D140: the host uses a summary version again. A version that was never used starts being used. */
  confirmSummary(input: SummaryConfirmInput): SummaryCommandResult {
    return this.setSummaryUse(input, true);
  }

  private setSummaryUse(input: SummaryConfirmInput, inUse: boolean): SummaryCommandResult {
    const parsed = summaryConfirmInputSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input');
    input = parsed.data;
    const run = this.requireRun(input.runId);
    const previous = this.database.findSummaryUseByClient(run.id, input.clientRequestId);
    if (previous) {
      if (previous.messageId !== input.messageId || previous.inUse !== inUse) throw new ContractError('invalid_input', 'clientRequestId');
      return { runId: run.id, summaryId: previous.summaryId, messageId: previous.messageId, duplicate: true };
    }
    return this.database.transaction(() => {
      const snapshot = this.database.readRunSnapshot(run.id);
      const version = snapshot.versions.find(item => item.messageId === input.messageId);
      const summary = snapshot.summaries.find(item => item.id === version?.slotId);
      const message = snapshot.messages.find(item => item.id === input.messageId);
      if (!version || !summary || !message) throw new ContractError('not_found');
      if (!version.active || message.status !== 'completed' || !message.content.trim()) throw new ContractError('invalid_state');
      if (inUse && version.origin !== 'edit') this.database.confirmSummaryVersion({ messageId: message.id, summaryId: summary.id, runId: run.id });
      this.database.setSummaryUse({ messageId: message.id, summaryId: summary.id, runId: run.id, clientRequestId: input.clientRequestId, inUse });
      this.appendEvent(run.id, 'summary_updated', { summaryId: summary.id, messageId: message.id, status: inUse ? 'confirmed' : 'revoked' });
      return { runId: run.id, summaryId: summary.id, messageId: message.id, duplicate: false };
    });
  }

  /**
   * The summary plan both the preview and the generation use: public messages 1..N (N defaults to all but the last
   * two), the confirmed summary it builds on, the writing member (a synthesizer by role, else the first member),
   * and the exact request.
   */
  private planSummary(input: { runId: string; agentId?: string; throughSlotId?: string; summaryId?: string }) {
    const run = this.requireRun(input.runId);
    const snapshot = this.database.readRunSnapshot(run.id);
    const slots = publicSlots(snapshot);
    const members = [...(run.membersSnapshot ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);
    const existing = input.summaryId === undefined ? undefined : snapshot.summaries.find(summary => summary.id === input.summaryId);
    if (input.summaryId !== undefined && !existing) throw new ContractError('not_found');
    type Plan = { snapshot: Snapshot; slots: PublicSlot[]; existing?: typeof existing; basedOn?: ActiveSummary; through?: PublicSlot; member?: MemberSnapshot;
      messages?: StreamChatInput['messages']; inputTokens?: number; inputBudgetTokens?: number;
      reason?: NonNullable<SummaryPreview['reason']> };
    const plan: Plan = { snapshot, slots, existing };
    if (run.task === null || !members.length) return { ...plan, reason: 'unsupported' as const };
    const basedOn = existing
      ? existing.basedOnSummaryId ? activeSummary({ ...snapshot, summaries: snapshot.summaries.filter(summary => summary.id === existing.basedOnSummaryId) }) : undefined
      : activeSummary(snapshot);
    if (basedOn) plan.basedOn = basedOn;
    const coveredBefore = basedOn?.lastNumber ?? 0;
    const lastCovered = existing ? Math.max(...existing.covered.map(slotId => slots.find(slot => slot.slotId === slotId)?.number ?? 0)) : undefined;
    // By default the latest two complete messages stay verbatim, so the next speaker still sees the live exchange.
    const complete = slots.filter(slot => slot.message.status === 'completed');
    const fallback = complete.length >= 4 ? complete[complete.length - 3] : complete.at(-1);
    const through = existing ? slots.find(slot => slot.number === lastCovered)
      : input.throughSlotId !== undefined ? slots.find(slot => slot.slotId === input.throughSlotId) : fallback;
    if (through) plan.through = through;
    plan.member = members.find(member => member.agentId === input.agentId)
      ?? (input.agentId === undefined ? members.find(member => summarizerPattern.test(`${member.roleTemplateId} ${member.displayName}`)) ?? members[0] : undefined);
    if (!plan.member) throw new ContractError('not_found');
    const busy = this.isExecuting(run.id) || !['paused', 'completed', 'error', 'cancelled', 'interrupted'].includes(run.status)
      || snapshot.messages.some(message => message.status === 'streaming');
    if (busy) return { ...plan, reason: 'busy' as const };
    if (!through || through.message.status !== 'completed') return { ...plan, reason: complete.length - coveredBefore < 2 ? 'too_few' as const : 'covered' as const };
    if (!existing && through.number <= coveredBefore) return { ...plan, reason: 'covered' as const };
    if (!existing && through.number - coveredBefore < 2) return { ...plan, reason: 'too_few' as const };
    const messages = buildSummaryMessages({ task: run.task, members, snapshot, slots, ...(basedOn ? { basedOn } : {}), firstNumber: 1, lastNumber: through.number });
    plan.messages = messages;
    const budget = this.modelBudget(plan.member);
    const outputTokenLimit = this.memberOutputLimit((this.contexts.get(run.id) ?? this.contextFrom(run)).outputTokenLimit, plan.member);
    const count = budget ? countModelTokens(messages, plan.member.modelId, budget.counter) : undefined;
    if (!budget || count === undefined) return { ...plan, reason: 'unsupported' as const };
    plan.inputTokens = count; plan.inputBudgetTokens = Math.max(0, budget.contextWindowTokens - outputTokenLimit);
    if (count > plan.inputBudgetTokens) return { ...plan, reason: 'context_exceeds' as const };
    if (!plan.member.providerId || !this.registry) return plan;
    try { this.registry.checkGeneration(plan.member.providerId, { requestId: randomUUID(), modelId: plan.member.modelId ?? 'mock', messages, outputTokenLimit, agentRole: 'summary' }); }
    catch { return { ...plan, reason: 'unsupported' as const }; }
    return plan;
  }

  /** D120: what an artifact would be based on and who would write it. Sends and records nothing. */
  previewArtifact(input: ArtifactPreviewInput): ArtifactPreview {
    const parsed = artifactPreviewInputSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input');
    const plan = this.planArtifact(parsed.data);
    const { snapshot } = plan;
    return {
      runId: snapshot.run.id, kind: parsed.data.kind, ...(plan.existing ? { artifactId: plan.existing.id } : {}),
      available: plan.reason === undefined, ...(plan.reason ? { reason: plan.reason } : {}),
      agents: (snapshot.run.membersSnapshot ?? []).map(member => ({ agentId: member.agentId, name: member.displayName, providerId: member.providerId, modelId: member.modelId })),
      ...(plan.member ? { agentId: plan.member.agentId } : {}),
      messageCount: plan.request?.numbers.length ?? 0, ...(plan.request ? { lastNumber: Math.max(...plan.request.numbers) } : {}),
      ...(plan.basedOn ? { summarizedThrough: plan.basedOn.lastNumber } : {}),
      outputTokenLimit: plan.outputTokenLimit,
      ...(plan.inputTokens !== undefined ? { inputTokens: plan.inputTokens } : {}), ...(plan.inputBudgetTokens !== undefined ? { inputBudgetTokens: plan.inputBudgetTokens } : {}),
    };
  }

  /**
   * D120: generate an artifact version as one explicit request of one frozen member. A failed or invalid result is
   * kept as it is and never retried automatically (the provider may have counted it); the host decides.
   */
  generateArtifact(input: ArtifactGenerateInput): ArtifactCommandResult {
    const parsed = artifactGenerateInputSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input');
    input = parsed.data;
    const run = this.requireRun(input.runId);
    const previous = this.database.findArtifactWrite(run.id, input.clientRequestId);
    if (previous) {
      const artifact = this.database.listArtifacts(run.id).find(item => item.versions.some(version => version.id === previous.id));
      const version = artifact?.versions.find(item => item.id === previous.id);
      if (previous.kind !== 'version' || !artifact || !version?.request || artifact.kind !== input.kind || version.agentId !== input.agentId
        || input.artifactId !== undefined && artifact.id !== input.artifactId) throw new ContractError('invalid_input', 'clientRequestId');
      return { runId: run.id, artifactId: artifact.id, versionId: version.id, requestId: version.request.requestId, duplicate: true };
    }
    const plan = this.planArtifact(input);
    if (plan.reason === 'busy') throw new ContractError('invalid_state');
    if (plan.reason === 'unsupported') throw new ContractError('unsupported');
    if (plan.reason === 'context_exceeds') throw new ContractError('invalid_input', 'runId');
    if (plan.reason || !plan.member || !plan.request) throw new ContractError('invalid_state');
    if (plan.member.agentId !== input.agentId) throw new ContractError('invalid_input', 'agentId');
    const { member, request, existing } = plan;
    const context = this.contexts.get(run.id) ?? this.contextFrom(run);
    if (context.executing) throw new ContractError('invalid_state');
    this.allowSideRequest(context);
    const requestId = randomUUID(); const versionId = randomUUID();
    const artifactId = existing?.id ?? randomUUID();
    const inputSnapshot = streamChatInputSchema.parse({ requestId, modelId: member.modelId ?? 'mock', messages: request.messages, outputTokenLimit: plan.outputTokenLimit,
      agentRole: `artifact:${input.kind}` });
    const tracked = this.tracksUsage(member);
    context.job = {};
    try {
      this.schedule(context, () => {
        if (tracked) this.registry!.checkGeneration(member.providerId!, inputSnapshot);
        if (!existing) this.database.insertArtifact({ id: artifactId, runId: run.id, roomId: run.roomId, kind: input.kind, clientRequestId: input.clientRequestId });
        this.database.insertArtifactVersion({ id: versionId, artifactId, runId: run.id, origin: existing ? 'regenerate' : 'generate',
          ...(existing ? { parentVersionId: existing.versions.at(-1)!.id } : {}), clientRequestId: input.clientRequestId, agentId: member.agentId, sources: request.basis });
        this.database.insertArtifactRequest({ requestId, versionId, runId: run.id, agentId: member.agentId, inputSnapshot });
        if (tracked) this.database.openUsage({ requestId, runId: run.id, agentId: member.agentId, providerId: member.providerId!, modelId: inputSnapshot.modelId, kind: 'artifact' });
        context.job = { requestId };
        this.appendEvent(run.id, 'artifact_updated', { artifactId, versionId, status: 'generating' });
      }, undefined, async () => {
        try { await this.executeArtifact(context, member, { requestId, versionId, artifactId, kind: input.kind, numbers: request.numbers, input: inputSnapshot, tracked }); }
        catch { /* The failed or stopped version keeps its partial output, its request and its usage as evidence. */ }
        finally { this.endJob(context); }
      });
    } catch (error) { context.job = undefined; throw error; }
    return { runId: run.id, artifactId, versionId, requestId, duplicate: false };
  }

  /** R14: a trusted artifact change (adopt, edit, export) and its run-level notification, in one transaction. */
  notifyArtifact(runId: string, payload: { artifactId: string; versionId: string; status: 'edited' | 'exported' }): void {
    this.appendAndNotify(runId, 'artifact_updated', payload);
  }

  /**
   * The plan both the artifact preview and the generation use: the whole public history (D121), the writing member
   * (a synthesizer by role, else the first member; for a regeneration the earlier writer) and the request.
   */
  private planArtifact(input: { runId: string; kind: ArtifactKind; agentId?: string; artifactId?: string }) {
    const run = this.requireRun(input.runId);
    const snapshot = this.database.readRunSnapshot(run.id);
    const members = [...(run.membersSnapshot ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);
    const existing = input.artifactId === undefined ? undefined : this.database.listArtifacts(run.id).find(item => item.id === input.artifactId);
    if (input.artifactId !== undefined && !existing) throw new ContractError('not_found');
    if (existing && existing.kind !== input.kind) throw new ContractError('invalid_input', 'kind');
    const context = this.contexts.get(run.id) ?? this.contextFrom(run);
    type Plan = { snapshot: Snapshot; existing?: typeof existing; basedOn?: ActiveSummary; member?: MemberSnapshot; outputTokenLimit: number;
      request?: NonNullable<ReturnType<typeof buildArtifactRequest>>; inputTokens?: number; inputBudgetTokens?: number;
      reason?: NonNullable<ArtifactPreview['reason']> };
    const plan: Plan = { snapshot, existing, outputTokenLimit: artifactOutputTokenLimit(input.kind, context.outputTokenLimit) };
    if (run.task === null || !members.length) return { ...plan, reason: 'unsupported' as const };
    const earlierWriter = existing ? [...existing.versions].reverse().find(version => version.agentId)?.agentId : undefined;
    plan.member = members.find(member => member.agentId === (input.agentId ?? earlierWriter))
      ?? (input.agentId === undefined ? members.find(member => summarizerPattern.test(`${member.roleTemplateId} ${member.displayName}`)) ?? members[0] : undefined);
    if (!plan.member) throw new ContractError('not_found');
    const outputTokenLimit = plan.outputTokenLimit = this.memberOutputLimit(plan.outputTokenLimit, plan.member);
    const busy = this.isExecuting(run.id) || !['paused', 'completed', 'error', 'cancelled', 'interrupted'].includes(run.status)
      || snapshot.messages.some(message => message.status === 'streaming');
    if (busy) return { ...plan, reason: 'busy' as const };
    const basedOn = activeSummary(snapshot);
    if (basedOn) plan.basedOn = basedOn;
    const slots = publicSlots(snapshot);
    if (!slots.some(slot => slot.author === 'agent' && slot.message.status === 'completed' && slot.message.content.trim())) return { ...plan, reason: 'too_few' as const };
    const request = buildArtifactRequest({ kind: input.kind, task: run.task, members, snapshot, slots, ...(basedOn ? { basedOn } : {}) });
    if (!request) return { ...plan, reason: 'too_few' as const };
    plan.request = request;
    const budget = this.modelBudget(plan.member);
    const count = budget ? countModelTokens(request.messages, plan.member.modelId, budget.counter) : undefined;
    if (!budget || count === undefined) return { ...plan, reason: 'unsupported' as const };
    plan.inputTokens = count; plan.inputBudgetTokens = Math.max(0, budget.contextWindowTokens - outputTokenLimit);
    if (count > plan.inputBudgetTokens) return { ...plan, reason: 'context_exceeds' as const };
    if (!plan.member.providerId || !this.registry) return plan;
    try { this.registry.checkGeneration(plan.member.providerId, { requestId: randomUUID(), modelId: plan.member.modelId ?? 'mock', messages: request.messages, outputTokenLimit, agentRole: `artifact:${input.kind}` }); }
    catch { return { ...plan, reason: 'unsupported' as const }; }
    return plan;
  }

  /**
   * Streams one artifact request into its version and validates the complete output once (D119). Output is persisted
   * on the first text, then every 2 KB or every second, so the reader shows progress and an interrupted request keeps
   * nearly all of what arrived without rewriting a long output on every fragment.
   */
  private async executeArtifact(context: RunContext, member: MemberSnapshot, request: { requestId: string; versionId: string; artifactId: string; kind: ArtifactKind;
    numbers: number[]; input: StreamChatInput; tracked: boolean }): Promise<void> {
    const { requestId, versionId, artifactId } = request;
    let persisted = 0; let persistedAt = 0;
    await this.streamSideRequest(context, member, request, {
      text: content => {
        if (persisted > 0 && content.length - persisted < 2048 && Date.now() - persistedAt < 1000) return;
        this.database.setArtifactOutput(versionId, content); persisted = content.length; persistedAt = Date.now();
      },
      completed: (content, reason) => {
        this.database.setArtifactOutput(versionId, content);
        this.database.finishArtifactRequest(requestId, 'completed', reason);
        const result = parseArtifact(request.kind, content, { sourceNumbers: request.numbers, allowNothing: true });
        if (result.ok) this.database.validateArtifactVersion(versionId, { contentJson: result.json });
        // D124: a stated "nothing of this kind" is a valid answer, kept apart from documents and from failures.
        else if (result.nothing !== undefined) this.database.validateArtifactVersion(versionId, { empty: result.nothing });
        else {
          // A cut-off output says so first: the fix is a larger limit or a shorter document, not a field.
          const cut = reason === 'length' ? [{ path: '', label: '整个 JSON', message: content.trim() ? `输出达到 ${request.input.outputTokenLimit} tokens 的上限被截断，内容不完整` : '这位成员的输出额度在思考阶段就用完了，没有写出内容。可以到“设置 › 模型服务”调高这个模型的最大输出，再重新生成' }] : [];
          this.database.validateArtifactVersion(versionId, { issues: [...cut, ...result.issues].slice(0, MAX_ARTIFACT_ISSUES) });
        }
        this.appendEvent(context.runId, 'artifact_updated', { artifactId, versionId, status: 'completed' });
      },
      ended: (content, aborted, errorCode) => {
        this.database.setArtifactOutput(versionId, content);
        this.database.finishArtifactRequest(requestId, aborted ? 'aborted' : 'failed', undefined, errorCode);
        this.appendEvent(context.runId, 'artifact_updated', { artifactId, versionId, status: aborted ? 'aborted' : 'failed' });
      },
    });
  }

  /** Streams one summary request into its own message and closes its usage from evidence, like a Turn request. */
  private async executeSummary(context: RunContext, member: MemberSnapshot,
    request: { requestId: string; messageId: string; summaryId: string; regenerate: boolean; input: StreamChatInput; tracked: boolean }): Promise<void> {
    const { requestId, messageId, summaryId } = request;
    await this.streamSideRequest(context, member, request, {
      text: (content, text) => {
        this.database.updateMessage(messageId, content, 'streaming');
        this.appendEvent(context.runId, 'summary_delta', { summaryId, messageId, text });
      },
      completed: (content, reason) => {
        this.database.updateMessage(messageId, content, 'completed');
        this.database.finishSummaryRequest(requestId, 'completed', reason);
        // A regenerated summary replaces the effective version only once it is complete. D140: it is used from now on.
        if (request.regenerate) this.database.activateVersion(messageId);
        if (content.trim()) this.database.confirmSummaryVersion({ messageId, summaryId, runId: context.runId });
        this.appendEvent(context.runId, 'summary_updated', { summaryId, messageId, status: 'completed' });
      },
      ended: (content, aborted, errorCode) => {
        this.database.updateMessage(messageId, content, aborted ? 'aborted' : 'failed');
        this.database.finishSummaryRequest(requestId, aborted ? 'aborted' : 'failed');
        // D125: migration 9 has no column for the reason, so the request's own event carries it.
        this.appendEvent(context.runId, 'summary_updated', { summaryId, messageId, status: aborted ? 'aborted' : 'failed', errorCode });
      },
    });
  }

  /**
   * One Turn-less request (a summary or an artifact): streams it, records text through `hooks`, and closes its usage
   * from evidence in the same transaction as the outcome. A failed or stopped request keeps its partial text.
   */
  private async streamSideRequest(context: RunContext, member: MemberSnapshot, request: { requestId: string; input: StreamChatInput; tracked: boolean },
    hooks: { text(content: string, delta: string): void; completed(content: string, reason: 'stop' | 'length'): void; ended(content: string, aborted: boolean, errorCode: ErrorCode): void }): Promise<void> {
    const { requestId, tracked } = request;
    const signal = context.abortController.signal;
    let content = '';
    let iterator: AsyncIterator<unknown> | undefined;
    let drained = false;
    let finishReason: 'stop' | 'length' | 'content_filter' | undefined;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let cacheHitInputTokens: number | undefined;
    let dispatched = false;
    const closeUsage = () => { if (tracked) this.closeRequestUsage(requestId, finishReason, usage, cacheHitInputTokens, dispatched); };
    try {
      if (this.deadlineReached(context) || signal.aborted) throw new ContractError(context.timedOut ? 'timeout' : 'cancelled');
      if (this.contexts.get(context.runId) !== context || context.job?.requestId !== requestId) throw new ContractError('invalid_state');
      const provider = member.providerId && this.registry ? this.registry.getAdapter(member.providerId, request.input.modelId, () => { dispatched = true; }) : this.provider;
      iterator = provider.streamChat({ ...request.input, signal })[Symbol.asyncIterator]();
      let started = false;
      await this.withAbort(context, async () => {
        while (true) {
          const next = await iterator!.next();
          this.deadlineReached(context);
          if (signal.aborted) throw new ContractError(context.timedOut ? 'timeout' : 'cancelled');
          if (next.done) { drained = true; break; }
          const parsed = normalizedChunkSchema.safeParse(next.value);
          if (!parsed.success || parsed.data.requestId !== requestId || finishReason) throw new ContractError('invalid_response');
          const chunk = parsed.data;
          if (chunk.type === 'error') throw new ContractError(chunk.error.code, undefined, chunk.error.upstream, chunk.error.phase);
          if (chunk.type === 'start') { if (started) throw new ContractError('invalid_response'); started = true; continue; }
          if (!started) throw new ContractError('invalid_response');
          if (chunk.type === 'finish') { finishReason = chunk.reason; continue; }
          if (chunk.type === 'text_delta') {
            content += chunk.text;
            this.database.transaction(() => {
              hooks.text(content, chunk.text);
              this.persistElapsed(context);
            });
          } else if (chunk.type === 'usage') {
            usage = { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens };
            cacheHitInputTokens = chunk.cacheHitInputTokens;
          }
        }
      });
      if (!finishReason || finishReason === 'content_filter') throw new ContractError('invalid_response');
      const completedReason = finishReason;
      this.database.transaction(() => {
        hooks.completed(content, completedReason);
        closeUsage();
        this.persistElapsed(context);
      });
    } catch (error) {
      const { code, phase } = toPublicError(error);
      // D155: it failed before anything was written, so it was never sent, whatever the app tried.
      if (failedBeforeWriting(phase)) dispatched = false;
      // A request's own timeout is a failure of that request; only the discussion's limit (timedOut) stops it from outside.
      const aborted = context.stopRequested || context.timedOut || code === 'cancelled';
      this.database.transaction(() => {
        // Only the public code is kept: never the response body, headers or anything that could hold a Key.
        hooks.ended(content, aborted, code);
        closeUsage();
        this.persistElapsed(context);
      });
      throw error;
    } finally {
      if (!drained && iterator?.return) void Promise.resolve().then(() => iterator!.return!()).catch(() => {});
    }
  }

  /** R12: validates a trusted host @Override target against the frozen roster, current config, limits and plan stage. */
  assertOverrideAllowed(runId: string, agentId: string): void {
    const run = this.requireRun(runId);
    if (!['running', 'pausing', 'paused', 'error', 'cancelled', 'interrupted'].includes(run.status)) throw new ContractError('invalid_state');
    // D149: in a group chat, naming someone is an @ in what the host says.
    if (isGroupChatSnapshot(run.workflowSnapshot)) throw new ContractError('invalid_state');
    if (!run.membersSnapshot?.some(member => member.agentId === agentId)) throw new ContractError('not_found');
    const agent = this.database.getAgentConfiguration(agentId);
    if (!agent || agent.roomId !== run.roomId || !agent.enabled || agent.archivedAt !== null) throw new ContractError('invalid_state');
    // D110: an Override is inserted outside the plan, so a Run whose plan Turns are used up can still take one.
    // D146: nor does a used-up duration refuse it: it waits for the host to continue, which renews the duration.
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
  regenerateMessage(runId: string, messageId: string, actionId: string, mode?: 'continue'): void {
    const run = this.requireRun(runId);
    const snapshot = this.database.readRunSnapshot(runId);
    const version = snapshot.versions.find(item => item.messageId === messageId);
    const turn = snapshot.turns.find(item => item.id === version?.turnId);
    const member = run.membersSnapshot?.find(item => item.agentId === turn?.agentId);
    if (!version || !turn || !member || snapshot.messages.some(message => message.status === 'streaming')) throw new ContractError('invalid_state');
    const context = this.contexts.get(runId) ?? this.contextFrom(run);
    if (context.executing) throw new ContractError('invalid_state');
    const latest = snapshot.attempts.filter(attempt => attempt.turnId === turn.id).at(-1);
    const base = { turn, modelId: member.modelId ?? 'mock', sourceRequestId: latest?.requestId ?? turn.requestId, kind: 'regenerate' as const, sourceMessageId: messageId, actionId };
    let extend: { messages: StreamChatInput['messages']; prefix: string } | undefined;
    if (mode === 'continue') {
      // Only the effective version of a reply that hit the output limit, from its own latest request, can be continued.
      const source = latest && this.database.getAttempt(latest.requestId);
      const message = snapshot.messages.find(item => item.id === messageId);
      if (!source || source.messageId !== messageId || source.status !== 'completed' || source.finishReason !== 'length' || !source.inputSnapshot
        || !version.active || !message || message.status !== 'completed') throw new ContractError('invalid_state');
      extend = { prefix: message.content, messages: [...source.inputSnapshot.messages, { role: 'assistant' as const, content: message.content }, { role: 'user' as const, content: continuePrompt }] };
    }
    if (!extend && turn.id === snapshot.turns.at(-1)!.id && canRetryTurn(turn.status as TurnStatus)) {
      assertRunCommand('retryTurn', run.status);
      if (!latest || !canRetryTurn(latest.status)) throw new ContractError('invalid_state');
      const renewed = this.renewDuration(run, context);
      this.schedule(context, () => this.setRunState(runId, { status: 'running', finishedAt: null, lastError: null, ...renewed }, { status: 'running' }), { ...base, job: false });
      return;
    }
    if (!turnSettled(snapshot, turn) || !['paused', 'completed', 'error', 'cancelled', 'interrupted'].includes(run.status)) throw new ContractError('invalid_state');
    this.allowSideRequest(context);
    context.job = {};
    const job = { ...base, job: true, ...(extend ? { extend } : {}) };
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

  private endJob(context: RunContext, actionId?: string): void {
    clearTimeout(context.deadline);
    const elapsed = this.elapsed(context);
    this.database.transaction(() => {
      this.database.updateRunProgress(context.runId, { elapsedExecutionMs: elapsed });
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
      if (actionId) this.appendEvent(context.runId, 'host_updated', { actionId, kind: 'regenerateMessage' });
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
      this.closeOpenRound(runId, 'stopped');
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
    const renewed = this.renewDuration(run, context);
    this.schedule(context, () => this.setRunState(runId, { status: 'running', finishedAt: null, lastError: null, ...renewed }, { status: 'running' }));
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
    return { runId: run.id, roomId: run.roomId, members: run.membersSnapshot, ...(isGroupChatSnapshot(run.workflowSnapshot) ? { groupChat: true } : {}),
      mode: run.mode, maxTurns: Math.min(run.maxTurns, plan?.config.limits.maxTurns ?? Number.MAX_SAFE_INTEGER),
      maxDurationMs: this.durationLimit({ run, continuations: this.database.listContinuations(run.id) }),
      outputTokenLimit: Math.min(run.outputTokenLimit, plan?.config.limits.outputTokenLimit ?? Number.MAX_SAFE_INTEGER),
      abortController: new AbortController(), stopRequested: false, timedOut: false, promise: Promise.resolve(), elapsedBefore: run.elapsedExecutionMs, executing: false };
  }

  /**
   * The duration limit; a continued Run (D111) gets its full allowance again from the moment it was continued. A Run
   * starts with `maxDurationMs` no higher than its plan's limit; only the host continuing past it (D146) raises it.
   */
  private durationLimit(data: Pick<Snapshot, 'run' | 'continuations'>): number {
    return Math.min(Number.MAX_SAFE_INTEGER, data.run.maxDurationMs + (data.continuations.at(-1)?.elapsedBaseMs ?? 0));
  }

  /** D146: stopped because the time ran out, whenever that was: older Runs read the same as new ones. */
  private durationStop(data: Pick<Snapshot, 'run' | 'continuations'>): { limitMs: number; nextAllowanceMs: number } | undefined {
    const { run } = data;
    if (run.status !== 'error' || run.elapsedExecutionMs === null || run.task === null) return undefined;
    const limitMs = this.durationLimit(data);
    return run.elapsedExecutionMs >= limitMs ? { limitMs, nextAllowanceMs: Math.max(DEFAULT_RUN_DURATION_MS, run.maxDurationMs) } : undefined;
  }

  /** D146: the host asked to go on past a used-up duration, so it gets a fresh allowance. Nothing else ever calls this. */
  private renewDuration(run: RunRecord, context: RunContext): { maxDurationMs?: number } {
    const continuations = this.database.listContinuations(run.id);
    const limit = this.durationLimit({ run, continuations });
    if (run.elapsedExecutionMs === null || run.elapsedExecutionMs < limit) return {};
    const maxDurationMs = run.elapsedExecutionMs + Math.max(DEFAULT_RUN_DURATION_MS, run.maxDurationMs) - (limit - run.maxDurationMs);
    context.maxDurationMs = this.durationLimit({ run: { ...run, maxDurationMs }, continuations });
    return { maxDurationMs };
  }

  /** D146: a summary or artifact of a stopped discussion is one request of its own; it is not cut off by the time the discussion used. */
  private allowSideRequest(context: RunContext): void {
    const elapsed = this.elapsed(context);
    if (elapsed >= context.maxDurationMs) context.maxDurationMs = elapsed + DEFAULT_RUN_DURATION_MS;
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

  private assertRequestEvidence(context: RunContext, snapshot: ReturnType<Database['readRunSnapshot']>, member: MemberSnapshot, turnIndex: number, repeat?: RepeatAttempt, directed?: Directed): WorkflowStep | undefined {
    if (repeat?.kind === 'regenerate' && repeat.job) return this.assertJobEvidence(context, snapshot, member, repeat);
    const { run, turns, attempts, messages } = snapshot;
    // D149: a reply the host interrupted stays as it is and the chat goes on past it; it only has to be over.
    const ended = (turn: TurnRecord) => context.groupChat ? turn.status !== 'running' : turnSettled(snapshot, turn);
    if (this.contexts.get(context.runId) !== context || !context.executing || !this.activeRooms.has(context.roomId)
      || run.id !== context.runId || run.roomId !== context.roomId || run.status !== 'running'
      || !sameMembers(run.membersSnapshot, context.members)
      || !run.membersSnapshot?.some(frozen => memberIdentity(frozen) === memberIdentity(member))) throw new ContractError('invalid_state');
    const plan = this.workflowPlan(run);
    const ordered = [...turns].sort((a, b) => a.turnIndex - b.turnIndex);
    const planTurns = planTurnsOf(ordered);
    if (run.nextTurnIndex !== ordered.length || plan && planTurns.some((turn, index) => turn.agentId !== plan.steps[index]?.agentId) || ordered.some((turn, index) => {
      const latest = attempts.filter(attempt => attempt.turnId === turn.id).at(-1);
      const target = repeat && index === (context.groupChat ? repeat.turn.turnIndex : ordered.length - 1);
      const message = target ? latest && messages.find(item => item.id === latest.messageId) : activeMessageOf(snapshot, turn.id);
      return turn.runId !== run.id || turn.turnIndex !== index
        || !latest || latest.runId !== run.id || !message || message.runId !== run.id || message.roomId !== run.roomId || message.turnId !== turn.id
        || (target ? latest.requestId !== repeat.sourceRequestId || turn.id !== repeat.turn.id
          || !canRetryTurn(turn.status as TurnStatus) || !canRetryTurn(latest.status) : !ended(turn));
    })) throw new ContractError('invalid_state');
    const stageStep = (step: WorkflowStep | undefined) => step ?? plan?.steps.at(-1);
    if (repeat) {
      if (!ordered.length || repeat.turn.turnIndex !== turnIndex || repeat.turn.agentId !== member.agentId
        || !context.groupChat && turnIndex !== ordered.length - 1 || repeat.modelId !== member.modelId) throw new ContractError('invalid_state');
      return this.stageOf(snapshot, plan, repeat.turn);
    }
    if (turnIndex !== run.nextTurnIndex) throw new ContractError('invalid_state');
    if (directed?.kind === 'continuation') {
      // D111: the next answer of the latest continuation; it is outside the plan and carries no stage requirement.
      const open = openContinuation(snapshot.continuations, ordered);
      if (open?.continuation.actionId !== directed.actionId || open.remaining[0] !== member.agentId) throw new ContractError('invalid_state');
      if (this.elapsed(context) >= context.maxDurationMs && this.deadlineReached(context)) throw new ContractError('timeout');
      return;
    }
    if (directed !== undefined) {
      // The pending Override is consumed in this transaction; its Turn takes no plan step and no plan turn (D110).
      const action = snapshot.hostActions.find(item => item.id === directed.actionId);
      if (!action || action.kind !== 'setOverride' || action.status !== 'pending' || action.agentId !== member.agentId) throw new ContractError('invalid_state');
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
    // The plan knows its own limit: what it is asked about is the time used within the allowance, however often that was renewed.
    const allowed = Math.min(plan.config.limits.maxDurationMs, run.maxDurationMs);
    const decision = nextWorkflowStep(plan, { ...run, nextTurnIndex: planTurns.length, elapsedExecutionMs: Math.max(0, elapsed - Math.max(0, context.maxDurationMs - allowed)) },
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
    return this.stageOf(snapshot, this.workflowPlan(run), turn);
  }

  /** The workflow stage an existing Turn belongs to; a continuation answer (D111) belongs to none. */
  private stageOf(snapshot: Snapshot, plan: WorkflowSnapshot | undefined, turn: TurnRecord): WorkflowStep | undefined {
    if (!plan || snapshot.continuations.some(item => item.actionId === turn.overrideActionId)) return;
    return plan.steps[planTurnsOf(snapshot.turns).filter(item => item.turnIndex < turn.turnIndex).length] ?? plan.steps.at(-1);
  }

  private assertSettled(runId: string): void {
    const snapshot = this.database.readRunSnapshot(runId);
    // D149: earlier replies of a group chat may have been interrupted; only the last one can still need retrying.
    if (isGroupChatSnapshot(snapshot.run.workflowSnapshot)) {
      const last = snapshot.turns.at(-1);
      if (last && !turnSettled(snapshot, last)) throw new ContractError('invalid_state');
      return;
    }
    if (snapshot.turns.some(turn => !turnSettled(snapshot, turn))) throw new ContractError('invalid_state');
  }

  private assertAvailable(context?: RunContext): void {
    if (this.shuttingDown) throw new ContractError('invalid_state');
    if (this.activeRooms.size && (!context || this.contexts.get(context.runId) !== context)) throw new Error('Another room already has an active run');
  }

  private schedule(context: RunContext, change: () => void, repeat?: RepeatAttempt, runner: () => Promise<void> = () => context.groupChat ? this.groupChatLoop(context, repeat) : this.runLoop(context, repeat)): void {
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
    context.interrupt = false;
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
        await this.executeTurn(context, member, turnIndex, repeat, next?.directed);
        repeat = undefined;
        if (context.stopRequested) { this.finishRun(context, 'cancelled'); return; }
        if (this.deadlineReached(context)) throw new ContractError('timeout');
        if (this.nextSpeaker(context, this.requireRun(context.runId)) === 'complete') { this.finishRun(context, 'completed'); return; }
        if (context.mode === 'step' || this.requireRun(context.runId).status === 'pausing') { this.finishRun(context, 'paused'); return; }
      }
    } catch (error) {
      const code = toPublicError(error).code;
      this.finishRun(context, context.stopRequested || code === 'cancelled' ? 'cancelled' : 'error',
        context.timedOut ? 'Maximum run duration reached' : undefined,
        context.failureReason ?? toPublicError(error).message);
    }
  }

  /**
   * The next speaker: a pending host Override first (D110: a Turn inserted outside the plan), then the open
   * continuation's next member (D111), then the frozen workflow step or round-robin position. maxTurns bounds plan
   * Turns only; every inserted Turn comes from one explicit host action. A continued Run never returns to its plan.
   */
  private nextSpeaker(context: RunContext, run: RunRecord): 'complete' | Speaker {
    const override = this.database.getPendingOverride(run.id);
    if (override) return { member: context.members.find(member => member.agentId === override.agentId), directed: { kind: 'override', actionId: override.id } };
    const turns = this.database.listTurns(run.id);
    const open = openContinuation(this.database.listContinuations(run.id), turns);
    if (open) {
      if (!open.remaining.length) return 'complete';
      return { member: context.members.find(member => member.agentId === open.remaining[0]), directed: { kind: 'continuation', actionId: open.continuation.actionId } };
    }
    const plan = this.workflowPlan(run);
    const planIndex = planTurnsOf(turns).length;
    if (planIndex >= context.maxTurns) return 'complete';
    if (plan && planIndex >= plan.steps.length) return 'complete';
    const agentId = plan?.steps[planIndex].agentId;
    return { member: plan ? context.members.find(member => member.agentId === agentId) : context.members[planIndex % context.members.length] };
  }

  /** D149: whether this Run is a group chat, where the host's messages go through `sendGroupChatMessage`. */
  isGroupChat(run: RunRecord): boolean {
    return isGroupChatSnapshot(run.workflowSnapshot);
  }

  /**
   * D149, D151: a host message in a group chat. It is recorded at once, whatever is going on. A reply being generated stops here, keeping its
   * words, and whoever was queued stands down; the chat is then decided again from this message. Nothing aborted is ever sent again.
   * `record` writes the host action in the same transaction.
   */
  sendGroupChatMessage<T>(runId: string, input: { content: string; attachments: readonly ImageAttachment[] }, record: (messageId: string) => T & { actionId: string }): T {
    const run = this.requireRun(runId);
    if (!this.isGroupChat(run) || run.task === null || !run.membersSnapshot?.length || run.nextTurnIndex === null || run.elapsedExecutionMs === null) throw new ContractError('unsupported');
    if (run.status === 'cancelling' || run.status === 'idle') throw new ContractError('invalid_state');
    const existing = this.contexts.get(runId);
    // A summary or a new version on its way finishes first; the box keeps what the host wrote.
    if (existing?.job) throw new ContractError('invalid_state');
    const context = existing ?? this.contextFrom(run);
    const messageId = randomUUID();
    // D154: nothing to answer, so nothing starts; with something in flight, the loop finds no open round and ends.
    const stopping = !input.attachments.length && isStopMessage(input.content);
    let result: (T & { actionId: string }) | undefined;
    const write = () => {
      this.database.insertMessage({ id: messageId, roomId: run.roomId, runId, senderType: 'user', senderName: hostSenderName, content: input.content, status: 'completed', ...(input.attachments.length ? { attachments: [...input.attachments] } : {}) });
      result = record(messageId);
      this.openRound(context, input.content, messageId, messageId, input.attachments.length > 0);
      this.appendEvent(runId, 'host_updated', { actionId: result.actionId, kind: 'interject' });
      if (stopping) return;
      // Each message gets the full allowance again, so a long chat is not cut off by what it has already used.
      context.maxDurationMs = this.elapsed(context) + DEFAULT_RUN_DURATION_MS;
      context.timedOut = false;
      this.database.updateRun(runId, { maxDurationMs: context.maxDurationMs });
    };
    if (context.executing) {
      this.database.transaction(write);
      context.interrupt = true;
      context.abortController.abort(new ContractError('cancelled'));
      return result!;
    }
    if (stopping) { this.database.transaction(write); return result!; }
    this.schedule(context, () => {
      write();
      this.setRunState(runId, { status: 'running', finishedAt: null, lastError: null }, { status: 'running' });
    });
    return result!;
  }

  /** Who can still speak: the frozen roster, without those since stopped or archived. */
  private chatRoster(context: RunContext): MemberSnapshot[] {
    return [...context.members].sort((a, b) => a.displayOrder - b.displayOrder).filter(member => {
      const agent = this.database.getAgentConfiguration(member.agentId);
      return agent && agent.roomId === context.roomId && agent.enabled && agent.archivedAt === null;
    });
  }

  /**
   * Opens the round for one host message. The latest message is what counts: an earlier round ends here, and whoever was queued in it stands
   * down. D154: a message telling everyone to stop leaves a round with nobody in it, closed at once, so the page can say so.
   */
  private openRound(context: RunContext, text: string, messageId: string | undefined, seed: string, hasImages: boolean): void {
    const stopping = !hasImages && isStopMessage(text);
    const previous = this.database.openGroupChatRound(context.runId);
    if (previous) { this.database.closeGroupChatRound(previous.id, stopping ? 'stopped' : 'superseded'); this.appendEvent(context.runId, 'group_chat_updated', { roundId: previous.id, state: stopping ? 'stopped' : 'superseded' }); }
    const roundId = randomUUID();
    const identity = { id: roundId, runId: context.runId, ...(messageId ? { messageId } : {}) };
    if (stopping) {
      this.database.insertGroupChatRound({ ...identity, classification: 'simple', scheduleMore: false, speakers: [] });
      this.closeRound(context.runId, roundId, 'stopped');
      return;
    }
    const roster = this.chatRoster(context);
    if (!roster.length) throw new ContractError('invalid_state');
    // D159: after a stop, "继续" means what was cut off: the same members, asked for the same thing, in the same order. Nothing is asked of a model.
    const interrupted = !hasImages && isContinueMessage(text) ? this.database.interruptedGroupChatRound(context.runId) : undefined;
    const resumed = interrupted?.speakers.filter(speaker => roster.some(member => member.agentId === speaker.agentId)) ?? [];
    if (interrupted && resumed.length) {
      this.database.insertGroupChatRound({ ...identity, classification: interrupted.classification, scheduleMore: false, speakers: resumed });
      this.appendEvent(context.runId, 'group_chat_updated', { roundId, state: 'open' });
      return;
    }
    // D165: the host only said yes. Whoever spoke last says a word back; nothing is read, and nothing more is arranged.
    if (!hasImages && isAcknowledgement(text)) {
      const last = this.database.lastGroupChatSpeaker(context.runId);
      const answering = roster.find(member => member.agentId === last) ?? roster[0]!;
      this.database.insertGroupChatRound({ ...identity, classification: 'simple', scheduleMore: false, speakers: [{ agentId: answering.agentId, intent: 'reply', length: 'short', source: 'rule' }] });
      this.appendEvent(context.runId, 'group_chat_updated', { roundId, state: 'open' });
      return;
    }
    const plan = classifyHostMessage(text, roster, seedOf(seed), hasImages);
    // D160: a call for everyone is answered at once. Anything else is read by the scheduling model first, where there is one to ask; the round
    // starts with nobody in it and `planNextBatch` fills it, from that reading or, without one, from these same rules.
    const read = !(plan.classification === 'gather' && isGather(text)) && this.scheduleTargets(context).length > 0;
    this.database.insertGroupChatRound({ ...identity, classification: plan.classification, scheduleMore: read || plan.classification === 'open', speakers: read ? [] : plan.speakers });
    this.appendEvent(context.runId, 'group_chat_updated', { roundId, state: 'open' });
  }

  private closeRound(runId: string, roundId: string, state: Exclude<GroupChatRoundState, 'open' | 'superseded'>): void {
    this.database.transaction(() => {
      this.database.closeGroupChatRound(roundId, state);
      this.appendEvent(runId, 'group_chat_updated', { roundId, state });
    });
  }
  private closeOpenRound(runId: string, state: Exclude<GroupChatRoundState, 'open' | 'superseded'>): void {
    const round = this.database.openGroupChatRound(runId);
    if (round) this.closeRound(runId, round.id, state);
  }

  /**
   * D149: a group chat speaks until the round has nothing left, then waits (`completed`) for the host. One at a time, as ever. A new host
   * message aborts what is in flight and this loop simply goes round again, from the new round.
   */
  private async groupChatLoop(context: RunContext, repeat?: RepeatAttempt): Promise<void> {
    while (true) {
      try {
        if (context.interrupt && !context.stopRequested) { context.interrupt = false; context.abortController = new AbortController(); }
        if (context.stopRequested) { this.finishRun(context, 'cancelled'); return; }
        if (this.deadlineReached(context)) throw new ContractError('timeout');
        const run = this.requireRun(context.runId);
        if (run.status === 'pausing') { this.finishRun(context, 'paused'); return; }
        if (repeat) {
          const again = repeat; repeat = undefined;
          const member = context.members.find(item => item.agentId === again.turn.agentId);
          if (!member) throw new ContractError('invalid_state');
          await this.executeTurn(context, member, again.turn.turnIndex, again);
        } else {
          const next = await this.nextChatSpeaker(context);
          if (next === 'again') continue;
          if (next === 'done') { this.finishRun(context, 'completed'); return; }
          await this.executeTurn(context, next.member, this.requireRun(context.runId).nextTurnIndex!, undefined, undefined, next.speaker);
        }
        if (context.mode === 'step' && !context.interrupt) { this.finishRun(context, 'paused'); return; }
      } catch (error) {
        // The host spoke: what was in flight is already recorded as stopped, and the new message decides what happens next.
        if (context.interrupt && !context.stopRequested && !context.timedOut) continue;
        // D155: that member's place shows the failure and a way to ask again; the rest of the queue goes on.
        if (context.turnFailed && !context.stopRequested && !context.timedOut) { context.turnFailed = false; context.failureReason = undefined; continue; }
        const code = toPublicError(error).code;
        this.finishRun(context, context.stopRequested || code === 'cancelled' ? 'cancelled' : 'error', context.timedOut ? 'Maximum run duration reached' : undefined, context.failureReason ?? toPublicError(error).message);
        return;
      }
    }
  }

  /** The next speaker of the open round, deciding the next batch if the queue is empty. */
  private async nextChatSpeaker(context: RunContext): Promise<'done' | 'again' | { member: MemberSnapshot; speaker: GroupChatSpeaker }> {
    const round = this.database.openGroupChatRound(context.runId);
    if (!round) return 'done';
    const used = round.speakers.filter(speaker => speaker.state === 'started').length;
    const next = round.speakers.find(speaker => speaker.state === 'queued');
    if (next) {
      if (used >= GROUP_CHAT_MAX_TURNS) { this.closeRound(context.runId, round.id, 'limit'); return 'done'; }
      const member = this.chatRoster(context).find(item => item.agentId === next.agentId);
      if (member) return { member, speaker: next };
      // Stopped or archived since the queue was made.
      this.database.dropGroupChatSpeaker(round.id, next.position);
      return 'again';
    }
    return this.planNextBatch(context, round, used);
  }

  /**
   * D150: the queue is empty. The rules' own batch needs nothing more, unless a member @-ed someone, which is only a reason to look again.
   * A message the rules could not read asks the model, if one can be asked; anything that goes wrong with that falls back to the rules without
   * a word to the host. D151: the limit holds whatever anyone wants.
   */
  private async planNextBatch(context: RunContext, round: GroupChatRound, used: number): Promise<'done' | 'again'> {
    const roster = this.chatRoster(context);
    const first = round.speakers.length === 0;
    const hinted = first ? [] : this.hintedMembers(context, round, roster);
    if (!first && !round.scheduleMore && !hinted.length) { this.closeRound(context.runId, round.id, 'done'); return 'done'; }
    if (used >= GROUP_CHAT_MAX_TURNS) { this.closeRound(context.runId, round.id, 'limit'); return 'done'; }
    // D162: a model that cannot be reached or refuses is not the end of it: the next one is asked at once, within the round's allowance.
    let answer: ScheduleOutput | undefined;
    for (const [index, target] of this.scheduleTargets(context).slice(0, Math.max(0, Math.min(2, GROUP_CHAT_MAX_SCHEDULES - round.scheduleCalls))).entries()) {
      void index;
      const asked = await this.askSchedule(context, round, target, roster, hinted, used);
      answer = asked.answer;
      if (!asked.failed || context.interrupt || context.stopRequested) break;
    }
    if (context.interrupt || context.stopRequested) return 'again';
    this.deadlineReached(context);
    if (context.timedOut) throw new ContractError('timeout');
    let chosen: PlannedSpeaker[]; let more = answer?.more ?? false;
    if (first) {
      // D160: the model's reading, inside what the program guarantees. Someone always answers the host: no reading, or an empty one, is the rules.
      const batch = firstBatch(this.roundText(context, round), roster, seedOf(round.id), this.roundHasImages(context, round), answer);
      // A reading of "carry on" after a stop is the same as the word itself (D159): whoever was cut off, in their order.
      const interrupted = answer?.relation === 'resume' ? this.database.interruptedGroupChatRound(context.runId, round.id)?.speakers.filter(speaker => roster.some(member => member.agentId === speaker.agentId)) : undefined;
      chosen = interrupted?.length ? interrupted.map(({ agentId, intent, length, source, assignment }) => ({ agentId, intent, length, source, ...(assignment ? { assignment } : {}) })) : batch.speakers;
      more = interrupted?.length ? false : batch.more;
    } else {
      chosen = answer ? answer.speakers.map(({ agentId, intent, length, brief }) => ({ agentId, intent, length, source: 'schedule' as const, ...(brief ? { assignment: brief } : {}) }))
        : hinted.filter(agentId => !round.speakers.some(speaker => speaker.agentId === agentId && speaker.state === 'started')).map((agentId): PlannedSpeaker => ({ agentId, intent: 'reply', length: 'short', source: 'hint' }));
    }
    const room = GROUP_CHAT_MAX_TURNS - used;
    if (!chosen.length) { this.closeRound(context.runId, round.id, 'done'); return 'done'; }
    this.database.transaction(() => {
      // More than fits means someone still wanted to speak, so the limit is what ended it, and the page says so.
      this.database.appendGroupChatSpeakers(round.id, chosen.slice(0, room), chosen.length > room || more);
      this.appendEvent(context.runId, 'group_chat_updated', { roundId: round.id, state: 'open' });
    });
    return 'again';
  }

  /** Who the replies of the latest batch named, unless they are still to speak after that reply. A suggestion only. */
  private hintedMembers(context: RunContext, round: GroupChatRound, roster: readonly MemberSnapshot[]): string[] {
    const snapshot = this.database.readRunSnapshot(context.runId);
    const batch = round.speakers.filter(speaker => speaker.position >= round.batchStart && speaker.turnId);
    return [...new Set(batch.flatMap(speaker => {
      const turn = snapshot.turns.find(item => item.id === speaker.turnId);
      const message = turn && turn.status === 'completed' ? activeMessageOf(snapshot, turn.id) : undefined;
      const named = message ? memberHints(message.content, roster.map(({ agentId, displayName }) => ({ agentId, displayName })), speaker.agentId) : [];
      return named.filter(agentId => !batch.some(later => later.agentId === agentId && later.position > speaker.position));
    }))];
  }

  /** D159: whether this speaker is picking up what a stop cut off, and if so whether they had started. Read from the rounds, so a repeat says the same. */
  private resumedSpeaker(context: RunContext, speaker: GroupChatSpeaker): 'cut_off' | 'not_started' | undefined {
    const round = this.database.latestGroupChatRound(context.runId);
    if (!round || round.id !== speaker.roundId || !(isContinueMessage(this.roundText(context, round)) || this.roundReading(context, round)?.relation === 'resume')) return undefined;
    const before = this.database.interruptedGroupChatRound(context.runId, round.id)?.speakers.find(item => item.agentId === speaker.agentId && item.intent === speaker.intent);
    return before ? before.cutOff ? 'cut_off' : 'not_started' : undefined;
  }

  /** D160: the scheduling model's reading of this round's host message, if it gave one. Read back from its recorded answer, so a repeat says the same. */
  private roundReading(context: RunContext, round: Pick<GroupChatRound, 'id'>): Pick<ScheduleOutput, 'relation' | 'topic'> | undefined {
    const text = this.database.firstScheduleOutput(round.id);
    return text ? parseScheduleOutput(text, context.members.map(({ agentId, displayName }) => ({ agentId, displayName }))) : undefined;
  }
  /** D165: whether this speaker is answering a host message that only said yes. Read from the round's message, so a repeat says the same. */
  private acknowledged(context: RunContext, speaker: GroupChatSpeaker): boolean {
    const round = this.database.latestGroupChatRound(context.runId);
    return !!round && round.id === speaker.roundId && speaker.source === 'rule' && !this.roundHasImages(context, round) && isAcknowledgement(this.roundText(context, round));
  }
  private firstRoundOf(context: RunContext, roundId: string): boolean {
    return this.database.firstGroupChatRoundId(context.runId) === roundId;
  }
  private roundHasImages(context: RunContext, round: GroupChatRound): boolean {
    const message = round.messageId ? this.database.getMessage(round.messageId) : undefined;
    return message ? (message.attachments?.length ?? 0) > 0 : (this.database.readRunSnapshot(context.runId).taskAttachments?.length ?? 0) > 0;
  }

  private roundText(context: RunContext, round: GroupChatRound): string {
    const message = round.messageId ? this.database.getMessage(round.messageId) : undefined;
    return message?.content ?? this.requireRun(context.runId).task ?? '';
  }

  /** D160: what the program already knows about this message, told to the scheduling model in the program's own words. */
  private scheduleState(context: RunContext, round: GroupChatRound, roster: readonly MemberSnapshot[]): ScheduleState {
    const plain = roster.map(({ agentId, displayName }) => ({ agentId, displayName }));
    const name = (agentId: string) => roster.find(member => member.agentId === agentId)?.displayName;
    const text = this.roundText(context, round);
    const plan = classifyHostMessage(text, plain, seedOf(round.id), this.roundHasImages(context, round));
    const mentioned = plan.classification === 'mention' ? plan.speakers.map(speaker => name(speaker.agentId)).filter((value): value is string => !!value) : [];
    const interrupted = (this.database.interruptedGroupChatRound(context.runId, round.id)?.speakers ?? []).flatMap(speaker => { const value = name(speaker.agentId); return value ? [{ name: value, cutOff: speaker.cutOff }] : []; });
    return { ...(mentioned.length ? { mentioned } : {}), ...(interrupted.length ? { interrupted } : {}) };
  }

  /**
   * D150: the demo never asks; neither does a room with nothing to ask with. Whose service it goes through only says where its usage belongs.
   * D162: in the registry's order, except that a model its service refused last time waits behind the others.
   */
  private scheduleTargets(context: RunContext): Array<{ providerId: string; modelId: string; agentId: string }> {
    if (!this.registry) return [];
    const real = context.members.filter(member => member.providerId && this.database.getProviderConfiguration(member.providerId)?.kind !== 'mock');
    if (!real.length) return [];
    const models = this.registry.scheduleCandidates(real).map(model => ({ ...model, agentId: (real.find(member => member.providerId === model.providerId) ?? real[0]!).agentId }));
    const refused = (model: { providerId: string; modelId: string }) => this.database.scheduleModelRefused(model.providerId, model.modelId);
    return [...models.filter(model => !refused(model)), ...models.filter(refused)];
  }

  /**
   * D150: one scheduling request. It has no Turn and no message; it has its own record and usage row. Its answer is only ever read by
   * `parseScheduleOutput`. Undefined means no usable answer: the caller falls back to the rules. Interrupted or stopped, it just ends.
   */
  private async askSchedule(context: RunContext, round: GroupChatRound, target: { providerId: string; modelId: string; agentId: string }, roster: readonly MemberSnapshot[], hinted: readonly string[], used: number): Promise<{ answer?: ScheduleOutput; failed: boolean }> {
    const snapshot = this.database.readRunSnapshot(context.runId);
    const active = new Set(snapshot.versions.filter(version => version.active).map(version => version.messageId));
    const lines = snapshot.messages.filter(message => active.has(message.id) && message.status === 'completed' && (message.senderType === 'user' || message.senderType === 'agent'))
      .map(message => ({ speaker: message.senderName, content: message.content, images: message.attachments?.length ?? 0 }));
    const requestId = randomUUID();
    const name = (agentId: string) => roster.find(member => member.agentId === agentId)?.displayName ?? '';
    const input: StreamChatInput = streamChatInputSchema.parse({ requestId, modelId: target.modelId, outputTokenLimit: GROUP_CHAT_SCHEDULE_MAX_TOKENS, agentRole: 'group-chat-schedule', fastReply: true,
      messages: buildScheduleMessages({ task: snapshot.run.task ?? '', taskImages: snapshot.taskAttachments?.length ?? 0, members: roster, lines, turnsUsed: used, hinted: hinted.map(name).filter(Boolean),
        // D160: only the first request of a round reads the host's message; later ones only decide who goes on.
        ...(round.speakers.length === 0 ? this.scheduleState(context, round, roster) : {}) }) });
    try { this.registry!.checkGeneration(target.providerId, input); } catch { return { failed: true }; }
    this.database.transaction(() => {
      this.database.insertScheduleRequest({ requestId, runId: context.runId, roundId: round.id, agentId: target.agentId, providerId: target.providerId, modelId: target.modelId, inputSnapshot: input });
      this.database.openUsage({ requestId, runId: context.runId, agentId: target.agentId, providerId: target.providerId, modelId: target.modelId, kind: 'schedule' });
      this.appendEvent(context.runId, 'group_chat_updated', { roundId: round.id, state: 'open' });
    });
    const controller = new AbortController();
    const parent = context.abortController.signal;
    const relay = () => controller.abort(new ContractError('cancelled'));
    parent.addEventListener('abort', relay, { once: true });
    if (parent.aborted) relay();
    const timer = setTimeout(() => controller.abort(new ContractError('timeout')), this.scheduleTimeoutMs);
    let text = ''; let iterator: AsyncIterator<unknown> | undefined; let drained = false;
    let finishReason: 'stop' | 'length' | 'content_filter' | undefined;
    let usage: { inputTokens: number; outputTokens: number } | undefined; let cacheHit: number | undefined; let dispatched = false;
    // D162: a request that failed keeps the code of its failure where its answer would be, so the next choice of model can tell a refusal from
    // a connection that dropped. Only a completed request's text is ever read as an answer.
    const close = (status: Parameters<Database['finishScheduleRequest']>[1], failure?: string) => this.database.transaction(() => {
      this.database.finishScheduleRequest(requestId, status, status === 'failed' && failure ? `[error:${failure}]` : text);
      this.closeRequestUsage(requestId, finishReason, usage, cacheHit, dispatched);
      this.appendEvent(context.runId, 'group_chat_updated', { roundId: round.id, state: 'open' });
    });
    try {
      const provider = this.registry!.getAdapter(target.providerId, target.modelId, () => { dispatched = true; });
      iterator = provider.streamChat({ ...input, signal: controller.signal })[Symbol.asyncIterator]();
      // A service that ignores the signal must not hold the chat up: the abort wins this race.
      const aborted = new Promise<never>((_, reject) => { controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }); if (controller.signal.aborted) reject(controller.signal.reason); });
      aborted.catch(() => {});
      let started = false;
      while (true) {
        const next = await Promise.race([iterator.next(), aborted]);
        if (next.done) { drained = true; break; }
        const parsed = normalizedChunkSchema.safeParse(next.value);
        if (!parsed.success || parsed.data.requestId !== requestId || finishReason) throw new ContractError('invalid_response');
        const chunk = parsed.data;
        if (chunk.type === 'error') throw new ContractError(chunk.error.code, undefined, chunk.error.upstream, chunk.error.phase);
        if (chunk.type === 'start') { started = true; continue; }
        if (!started) throw new ContractError('invalid_response');
        if (chunk.type === 'finish') finishReason = chunk.reason;
        else if (chunk.type === 'text_delta') text += chunk.text;
        else if (chunk.type === 'usage') { usage = { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens }; cacheHit = chunk.cacheHitInputTokens; }
      }
      if (!finishReason) throw new ContractError('invalid_response');
      const answer = parseScheduleOutput(text, roster.map(({ agentId, displayName }) => ({ agentId, displayName })));
      close(answer ? 'completed' : 'invalid');
      return { ...(answer ? { answer } : {}), failed: false };
    } catch (error) {
      const failure = toPublicError(error);
      if (failedBeforeWriting(failure.phase)) dispatched = false;
      close(parent.aborted ? 'aborted' : 'failed', [controller.signal.aborted && !parent.aborted ? 'timeout' : failure.code, failure.phase, failure.upstream?.status, failure.upstream?.code].filter(Boolean).join(':'));
      return { failed: !parent.aborted };
    } finally {
      clearTimeout(timer);
      parent.removeEventListener('abort', relay);
      if (!drained && iterator?.return) void Promise.resolve().then(() => iterator!.return!()).catch(() => {});
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

  private async executeTurn(context: RunContext, member: MemberSnapshot, turnIndex: number, repeat?: RepeatAttempt, directed?: Directed, speaker?: GroupChatSpeaker): Promise<void> {
    const turnId = repeat?.turn.id ?? randomUUID();
    const messageId = randomUUID();
    const requestId = randomUUID();
    const job = repeat?.kind === 'regenerate' && repeat.job;
    const extend = repeat?.kind === 'regenerate' ? repeat.extend : undefined;
    const tracked = this.tracksUsage(member);
    const input:StreamChatInput = this.database.transaction(() => {
      const snapshot=this.database.readRunSnapshot(context.runId);
      const workflowStep = this.assertRequestEvidence(context, snapshot, member, turnIndex, repeat, directed);
      // A repeat of a group-chat reply asks for what the first request asked for. A Turn from before this queue existed is a plain reply.
      const chat = context.groupChat ? speaker ?? (repeat ? this.database.groupChatSpeakerOfTurn(turnId) : undefined) : undefined;
      const resumed = chat ? this.resumedSpeaker(context, chat) : undefined;
      const reading = chat ? this.roundReading(context, { id: chat.roundId }) : undefined;
      const cue: GroupChatCue | undefined = context.groupChat ? { intent: chat?.intent ?? 'reply', length: chat?.length ?? 'medium', source: chat?.source ?? 'rule', ...(chat?.assignment ? { assignment: chat.assignment } : {}), ...(resumed ? { resumed } : {}), ...(chat && this.acknowledged(context, chat) ? { ack: true as const } : {}),
        // The first message of a chat relates to nothing: whatever the reading called it, nothing is said about what came before.
        ...(reading?.relation && reading.relation !== 'resume' && !resumed && !this.firstRoundOf(context, chat!.roundId) ? { relation: reading.relation } : {}), ...(reading?.topic ? { topic: reading.topic } : {}) } : undefined;
      const preparation:RequestPreparation={snapshot,workflowStep,...(cue?{groupChat:cue}:{}),current:{turnId,requestId,messageId,agentId:member.agentId,turnIndex},
        repeat:repeat && repeat.kind!=='regenerate'?{messages:repeat.messages,sourceRequestId:repeat.sourceRequestId,kind:repeat.kind}
          :extend?{messages:extend.messages,sourceRequestId:repeat!.sourceRequestId,kind:'continue'}:undefined,
        regenerate:repeat?.kind==='regenerate'&&!extend?{sourceMessageId:repeat.sourceMessageId}:undefined};
      // Retry/continue replay the frozen input, so they keep its basis; new and regenerated requests use current history.
      const source = repeat && repeat.kind !== 'regenerate' ? snapshot.versions.find(v => v.messageId === snapshot.attempts.find(a => a.requestId === repeat.sourceRequestId)?.messageId) : undefined;
      const continued = extend ? snapshot.versions.find(v => v.messageId === (repeat as Extract<RepeatAttempt, { kind: 'regenerate' }>).sourceMessageId) : undefined;
      const version: VersionInput = !repeat ? { origin: 'original', basis: basisBefore(snapshot.messages, snapshot.versions) }
        // A continuation extends the same reply, so it keeps that reply's basis.
        : extend ? { origin: 'continue', parentMessageId: repeat.kind === 'regenerate' ? repeat.sourceMessageId : undefined, actionId: repeat.kind === 'regenerate' ? repeat.actionId : undefined,
          activate: false, ...(continued?.basis ? { basis: continued.basis } : {}) }
        : repeat.kind === 'regenerate' ? { origin: 'regenerate', parentMessageId: repeat.sourceMessageId, actionId: repeat.actionId, activate: !job,
          basis: basisBefore(snapshot.messages, snapshot.versions, turnId) }
        : { origin: repeat.kind, ...(source ? { parentMessageId: source.messageId } : {}), ...(source?.basis ? { basis: source.basis } : {}) };
      const inputSnapshot=streamChatInputSchema.parse({ requestId, modelId: repeat?.modelId ?? member.modelId ?? 'mock',
        outputTokenLimit:this.memberOutputLimit(context.outputTokenLimit,member),agentRole:cue?`chat:${cue.length}:${cue.intent}`:member.roleTemplateId,turnIndex,
        // D152: only a short reply skips thinking; what the host asked to have delivered gets all of it.
        ...(cue&&skipsThinking(cue)?{fastReply:true as const}:{}),
        messages:this.buildMessages(snapshot.run,member,turnIndex,preparation) });
      if (tracked) this.registry!.checkGeneration(member.providerId!, inputSnapshot);
      if (this.deadlineReached(context)) throw new ContractError('timeout');
      if(context.abortController.signal.aborted)throw new ContractError('cancelled');
      if (job) context.job = { requestId };
      else if (repeat) this.database.updateTurn(turnId, { status: transitionTurn(repeat.turn.status as TurnStatus, 'running'), partialContent: '' });
      else this.database.insertTurn({ id: turnId, runId: context.runId, agentId: member.agentId, status: transitionTurn('pending', 'running'), requestId, turnIndex,
        ...(directed?.kind === 'override' ? { overrideActionId: directed.actionId } : directed ? { continuationId: directed.actionId } : {}) });
      if (speaker) this.database.startGroupChatSpeaker(speaker.roundId, speaker.position, turnId);
      this.database.insertMessage({ id: messageId, roomId: context.roomId, runId: context.runId, turnId, senderType: 'agent', senderName: member.displayName, content: extend?.prefix ?? '', status: 'streaming' }, version);
      const attemptIndex = snapshot.attempts.filter(a => a.turnId === turnId).length;
      this.database.createAttempt({ requestId, runId: context.runId, turnId, messageId, attemptIndex, status: 'pending', inputSnapshot });
      if (tracked) this.database.openUsage({ requestId, runId: context.runId, agentId: member.agentId, providerId: member.providerId!, modelId: inputSnapshot.modelId, kind: 'turn' });
      if (!job) this.database.updateRun(context.runId, { currentTurnId: turnId, currentAgentId: member.agentId });
      this.appendEvent(context.runId, 'turn_started', { turnId, messageId, agentId: member.agentId, requestId });
      return {...inputSnapshot,signal:context.abortController.signal};
    });
    const {signal}=input;
    let content = extend?.prefix ?? '';
    let iterator: AsyncIterator<unknown> | undefined;
    let drained = false;
    let finishReason: 'stop' | 'length' | 'content_filter' | undefined;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let dispatched = false;
    let cacheHitInputTokens: number | undefined;
    const closeUsage = () => { if (tracked) this.closeRequestUsage(requestId, finishReason, usage, cacheHitInputTokens, dispatched); };
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
          if (chunk.type === 'error') throw new ContractError(chunk.error.code, undefined, chunk.error.upstream, chunk.error.phase);
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
            cacheHitInputTokens = chunk.cacheHitInputTokens;
            this.appendAndNotify(context.runId, 'usage_updated', { turnId, inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens });
          }
        }
      });
      if (!finishReason) throw new ContractError('invalid_response');
      if (finishReason === 'content_filter') {
        // A filtered reply is not resumable text: it stays failed evidence and only an explicit user action may retry (D102).
        context.failureReason = `Provider finish: ${finishReason}`;
        throw new ContractError('invalid_response');
      }
      // D102: reaching the output limit is not a failure. The reply is complete-but-truncated and the Run goes on.
      const completedReason = finishReason;
      this.database.transaction(() => {
        this.database.updateMessage(messageId, content, 'completed');
        // A completed regeneration becomes its slot's effective version; the Turn's own state is unchanged.
        if (job) this.database.activateVersion(messageId);
        else this.database.updateTurn(turnId, { status: transitionTurn('running', 'completed'), partialContent: content });
        this.database.updateAttempt(requestId, { status: 'completed', finishReason: completedReason });
        closeUsage();
        this.persistElapsed(context);
        this.appendEvent(context.runId, 'turn_completed', { turnId, messageId });
      });
    } catch (error) {
      const { code, phase } = toPublicError(error);
      // D155: it failed before anything was written, so it was never sent, whatever the app tried.
      if (failedBeforeWriting(phase)) dispatched = false;
      // A request's own timeout is a failure of that request; only the discussion's limit (timedOut) stops it from outside.
      const aborted = context.stopRequested || context.timedOut || code === 'cancelled';
      // D155: in a group chat one member failing leaves the others free to speak.
      if (!aborted && context.groupChat) context.turnFailed = true;
      this.database.transaction(() => {
        this.database.updateMessage(messageId, content, aborted ? 'aborted' : 'failed');
        if (!job) this.database.updateTurn(turnId, { status: transitionTurn('running', aborted ? 'aborted' : 'failed'), partialContent: content });
        this.database.updateAttempt(requestId, { status: aborted ? 'aborted' : 'failed' });
        closeUsage();
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
          // Without terminal usage what the provider counted stays unknown, never zero.
          this.database.closeUsage(attempt.requestId, { state: 'unknown' });
          this.appendEvent(context.runId, aborted ? 'turn_aborted' : 'turn_failed', { turnId: turn.id, messageId: message.id,
            error: publicError(context.timedOut ? 'timeout' : aborted ? 'cancelled' : 'internal_error') });
        }
      }
      this.database.updateRunProgress(context.runId, { elapsedExecutionMs: elapsed });
      if (status === 'cancelled' && context.groupChat) this.closeOpenRound(context.runId, 'stopped');
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

  /** D134: the output limit of one member's requests: the Run's, never above what that member's model takes. */
  private memberOutputLimit(limit: number, member: MemberSnapshot): number {
    const budget = this.modelBudget(member);
    const modelMax = budget?.maxOutputTokens ?? limit;
    if (!budget || limit !== DEFAULT_OUTPUT_TOKEN_LIMIT || member.modelId === 'mock') return Math.min(limit, modelMax);
    // D135: a limit the host left at the default follows the model's setting, so raising it there works on the next retry.
    // At least half of the context stays for the discussion, whatever the setting says.
    return Math.min(modelMax, Math.max(limit, Math.floor(budget.contextWindowTokens / 2)));
  }

  /** The usage page counts what a service reported; a demo member's numbers are made up and stay out of it. */
  private tracksUsage(member: MemberSnapshot): boolean {
    return Boolean(member.providerId && this.registry) && this.database.getProviderConfiguration(member.providerId!)?.kind !== 'mock';
  }

  /** D133: a request's usage from evidence only: provider usage of a terminal stream, or proof it was never sent. */
  private closeRequestUsage(requestId: string, finishReason: string | undefined, usage: { inputTokens: number; outputTokens: number } | undefined, cacheHitTokens: number | undefined, dispatched: boolean): void {
    const tokens = usage ? { ...usage, ...(cacheHitTokens === undefined ? {} : { cacheHitTokens }) } : undefined;
    this.database.closeUsage(requestId, tokens && finishReason ? { state: 'reported', ...tokens }
      : dispatched ? { state: 'unknown', ...(tokens ? { observed: tokens } : {}) } : { state: 'not_sent' });
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
