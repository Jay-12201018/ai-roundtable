import { compiledWorkflowSnapshotSchema } from '../../../shared/schemas/workflow';
import type { MessageVersion, MessageVersionOrigin } from '../../../shared/schemas/host';
import type { MessageSnapshot, RunSnapshot } from '../../../shared/types/run';

export const originLabels: Record<MessageVersionOrigin, string> = {
  original: '原始', retry: '重试', continue: '续写', regenerate: '重新生成', edit: '主持人修改',
};

export type TimelineSlot = {
  slotId: string;
  turnId?: string;
  author: 'agent' | 'host' | 'summary';
  /** R13B: the public message number shown in the timeline and in summary labels; summaries have none. */
  number?: number;
  /** Versions in creation order; exactly one is active. */
  versions: Array<MessageVersion & { message: MessageSnapshot }>;
  active: MessageVersion & { message: MessageSnapshot };
};

/** Groups the public timeline by slot in original position; null when Main sent no version data (legacy builds). */
export function timelineSlots(snapshot: RunSnapshot | undefined): TimelineSlot[] | null {
  if (!snapshot?.versions) return null;
  const messages = new Map(snapshot.messages.map(message => [message.id, message]));
  const slots = new Map<string, TimelineSlot['versions']>();
  for (const message of snapshot.messages) {
    const version = snapshot.versions.find(item => item.messageId === message.id);
    if (!version) continue;
    const group = slots.get(version.slotId) ?? [];
    group.push({ ...version, message: messages.get(version.messageId)! });
    slots.set(version.slotId, group);
  }
  let number = 0;
  return [...slots.entries()].map(([slotId, versions]) => {
    versions.sort((a, b) => a.versionNumber - b.versionNumber);
    const active = versions.find(version => version.active) ?? versions.at(-1)!;
    return { slotId, turnId: active.turnId, author: active.author, versions, active, ...(active.author === 'summary' ? {} : { number: ++number }) };
  });
}

/**
 * R13B (D107): the summary later requests use — the latest one whose effective version is complete and confirmed
 * (a host edit confirms itself). Display only; Main makes the same choice when it builds a request.
 */
export function usedSummary(snapshot: RunSnapshot | undefined) {
  const slots = timelineSlots(snapshot) ?? [];
  for (const slot of [...slots].reverse()) {
    if (slot.author !== 'summary') continue;
    const summary = snapshot?.summaries?.find(item => item.slotId === slot.slotId);
    const { active } = slot;
    if (summary && active.message.status === 'completed' && active.message.content.trim()
      && (active.origin === 'edit' || summary.confirmedMessageIds.includes(active.messageId))) return summary;
  }
  return undefined;
}
/** Run statuses in which Main accepts a summary request (nothing else in flight). */
export const summaryWritable = (snapshot: RunSnapshot | undefined) => !!snapshot && runIdle(snapshot)
  && ['paused', 'completed', 'error', 'cancelled', 'interrupted'].includes(snapshot.status)
  && !snapshot.summaries?.some(summary => summary.requests.some(request => request.status === 'generating'));

const frozenPlan = (snapshot: RunSnapshot) => {
  const parsed = compiledWorkflowSnapshotSchema.safeParse(snapshot.workflowSnapshot);
  return parsed.success ? parsed.data : undefined;
};

export type SpeakerProjection = { agentId: string; name: string; source: 'override' | 'continuation' | 'plan' };
/** Turns that are not inserted by the host: an @Override (D110) or a continuation answer (D111) is not a plan Turn. */
export const planTurnCount = (snapshot: RunSnapshot) => snapshot.turns.filter(turn => !turn.overrideActionId).length;
/** D111: the latest continuation, if this discussion was continued, and who still has to answer it. */
export function openContinuation(snapshot: RunSnapshot | undefined) {
  const latest = snapshot?.continuations?.at(-1);
  if (!snapshot || !latest) return undefined;
  const answered = snapshot.turns.filter(turn => turn.overrideActionId === latest.actionId).length;
  return { continuation: latest, remaining: latest.agentIds.slice(answered) };
}
/** Whether a Turn was inserted by a continuation of the discussion rather than by an @Override. */
export const isContinuationTurn = (snapshot: RunSnapshot | undefined, overrideActionId: string | undefined) =>
  !!overrideActionId && !!snapshot?.continuations?.some(item => item.actionId === overrideActionId);

/** Who the schedule names after the current Turn when nobody is named by the host; 'end' when the discussion ends. */
function scheduled(snapshot: RunSnapshot, name: (agentId: string) => string): SpeakerProjection | 'end' {
  const open = openContinuation(snapshot);
  // A continued discussion answers the continuation and then ends; it never goes back to the original plan.
  if (open) return open.remaining.length ? { agentId: open.remaining[0], name: name(open.remaining[0]), source: 'continuation' } : 'end';
  const members = snapshot.execution!.membersSnapshot ?? [];
  const position = planTurnCount(snapshot);
  if (position >= snapshot.execution!.maxTurns || !members.length) return 'end';
  const plan = frozenPlan(snapshot);
  if (plan) {
    const step = plan.steps[position];
    return step ? { agentId: step.agentId, name: name(step.agentId), source: 'plan' } : 'end';
  }
  if (snapshot.workflow) return 'end';
  const member = members[position % members.length];
  return { agentId: member.agentId, name: member.displayName, source: 'plan' };
}

/**
 * A display-only projection of who speaks next and, when the host named someone, who follows once that inserted
 * Turn is done (D110: the plan continues where it was). Main decides and the snapshot confirms.
 */
export function nextSpeaker(snapshot: RunSnapshot | undefined): (SpeakerProjection & { then?: SpeakerProjection | 'end' }) | undefined {
  if (!snapshot?.execution || ['completed', 'cancelling'].includes(snapshot.status)) return;
  const members = snapshot.execution.membersSnapshot ?? [];
  const name = (agentId: string) => members.find(member => member.agentId === agentId)?.displayName ?? agentId;
  const after = scheduled(snapshot, name);
  const override = snapshot.host?.override;
  if (override) return { agentId: override.agentId, name: name(override.agentId), source: 'override', then: after };
  return after === 'end' ? undefined : after;
}

/**
 * D110: the member the schedule already has next (by plan, or answering a continuation) while nobody is named.
 * Naming that member would only make them speak twice, so the box sends just the words and the panel offers no 点名.
 * A projection: if Main has meanwhile started that member's Turn, the words reach the members after it instead.
 */
export function scheduledNext(snapshot: RunSnapshot | undefined): string | undefined {
  if (!snapshot || snapshot.host?.override || !['running', 'pausing', 'paused'].includes(snapshot.status)) return;
  const next = nextSpeaker(snapshot);
  return next && next.source !== 'override' ? next.agentId : undefined;
}

/** Plain words for where a speaker comes from, as the composer strip and the members tab say it. */
export const speakerSourceText: Record<SpeakerProjection['source'], string> = {
  override: '主持人点名，插入一轮，不打断正在进行的发言',
  continuation: '继续讨论，回应你的话',
  plan: '按计划',
};
/** "下一位：B（…）· 之后：C（按计划）" — the inserted Turn does not replace who the plan had next (D110). */
export function nextSpeakerText(next: NonNullable<ReturnType<typeof nextSpeaker>>): { name: string; source: string; then?: string } {
  const then = next.then === undefined ? undefined : next.then === 'end' ? '之后讨论结束'
    : next.then.source === 'plan' ? `之后回到原计划：${next.then.name}` : `之后：${next.then.name}（继续讨论）`;
  return { name: next.name, source: speakerSourceText[next.source], ...(then ? { then } : {}) };
}

/** Members that Main would accept for @Override: the frozen roster, limited to the current stage in a workflow. */
export function overrideCandidates(snapshot: RunSnapshot | undefined): Array<{ agentId: string; name: string }> {
  const members = snapshot?.execution?.membersSnapshot ?? [];
  const plan = snapshot ? frozenPlan(snapshot) : undefined;
  if (!plan) return members.map(member => ({ agentId: member.agentId, name: member.displayName }));
  const planTurns = planTurnCount(snapshot!);
  const stageId = (plan.steps[planTurns] ?? plan.steps.at(-1))?.stageId;
  const allowed = plan.config.stages.find(stage => stage.id === stageId)?.memberIds ?? [];
  return members.filter(member => allowed.includes(member.agentId)).map(member => ({ agentId: member.agentId, name: member.displayName }));
}

export const canDirectRun = (snapshot: RunSnapshot | undefined) => !!snapshot && ['running', 'pausing', 'paused', 'error', 'cancelled', 'interrupted'].includes(snapshot.status);
/**
 * The same rule as Main's `turnSettled`: the Turn completed, and its effective version is a completed message whose
 * own request completed, or a host edit. A failed Turn stays unsettled even after the host edits it (it is retried).
 */
export function turnSettled(snapshot: RunSnapshot, turn: RunSnapshot['turns'][number]): boolean {
  if (turn.status !== 'completed') return false;
  const active = snapshot.versions?.find(version => version.turnId === turn.turnId && version.active);
  const messageId = active?.messageId ?? snapshot.attempts?.filter(attempt => attempt.turnId === turn.turnId).at(-1)?.messageId ?? turn.messageId;
  const message = snapshot.messages.find(item => item.id === messageId);
  if (!message || message.status !== 'completed') return false;
  const attempt = snapshot.attempts?.find(item => item.messageId === message.id);
  // A legacy snapshot without attempts or versions has nothing more to check than the Turn and its message.
  return attempt ? attempt.status === 'completed' : !snapshot.attempts || active?.origin === 'edit';
}
/**
 * D111: a finished discussion continues in place — completed, or stopped with every Turn settled (a stopped Turn is
 * retried or continued instead; a budget stop is topped up and resumed). Display only; Main rechecks every condition.
 */
export const canContinueRun = (snapshot: RunSnapshot | undefined) => !!snapshot?.execution && runIdle(snapshot)
  && ['completed', 'cancelled', 'error'].includes(snapshot.status) && !(snapshot.status === 'error' && snapshot.budget?.blocked)
  && snapshot.turns.every(turn => turnSettled(snapshot, turn));
/** Version edits/regenerations wait for the in-flight request; Main rechecks every condition. */
export const runIdle = (snapshot: RunSnapshot | undefined) => !!snapshot && !snapshot.currentTurnId && !snapshot.host?.generation
  && !snapshot.messages.some(message => message.status === 'streaming');

const errorMessages: Record<string, string> = {
  invalid_state: '当前状态不允许此操作：请等当前回合或重新生成结束，或检查目标是否已完成。',
  not_found: '目标不存在或不属于当前运行。',
  invalid_input: '输入无效，请检查内容后重试。',
  transport_error: '与主进程的连接失败，请重试。',
};
export function hostErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  return errorMessages[code] ?? '主持人操作失败，请刷新运行状态后重试。';
}
