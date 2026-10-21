import { compiledWorkflowSnapshotSchema } from '../../../shared/schemas/workflow';
import type { MessageVersion, MessageVersionOrigin } from '../../../shared/schemas/host';
import type { MessageSnapshot, RunSnapshot } from '../../../shared/types/run';

export const originLabels: Record<MessageVersionOrigin, string> = {
  original: '原始', retry: '重试', continue: '续写', regenerate: '重新生成', edit: '主持人修改',
};

export type TimelineSlot = {
  slotId: string;
  turnId?: string;
  author: 'agent' | 'host';
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
  return [...slots.entries()].map(([slotId, versions]) => {
    versions.sort((a, b) => a.versionNumber - b.versionNumber);
    const active = versions.find(version => version.active) ?? versions.at(-1)!;
    return { slotId, turnId: active.turnId, author: active.author, versions, active };
  });
}

const frozenPlan = (snapshot: RunSnapshot) => {
  const parsed = compiledWorkflowSnapshotSchema.safeParse(snapshot.workflowSnapshot);
  return parsed.success ? parsed.data : undefined;
};

/** A display-only projection of who speaks next; Main decides and the snapshot confirms. */
export function nextSpeaker(snapshot: RunSnapshot | undefined): { agentId: string; name: string; source: 'override' | 'plan' } | undefined {
  if (!snapshot?.execution || ['completed', 'cancelling'].includes(snapshot.status)) return;
  const members = snapshot.execution.membersSnapshot ?? [];
  const name = (agentId: string) => members.find(member => member.agentId === agentId)?.displayName ?? agentId;
  const override = snapshot.host?.override;
  if (override) return { agentId: override.agentId, name: name(override.agentId), source: 'override' };
  const turns = snapshot.turns.length;
  if (turns >= snapshot.execution.maxTurns) return;
  if (snapshot.workflow) return snapshot.workflow.nextStep ? { agentId: snapshot.workflow.nextStep.agentId, name: name(snapshot.workflow.nextStep.agentId), source: 'plan' } : undefined;
  if (frozenPlan(snapshot) || !members.length) return;
  const position = snapshot.turns.filter(turn => !turn.overrideActionId).length;
  const member = members[position % members.length];
  return { agentId: member.agentId, name: member.displayName, source: 'plan' };
}

/** Members that Main would accept for @Override: the frozen roster, limited to the current stage in a workflow. */
export function overrideCandidates(snapshot: RunSnapshot | undefined): Array<{ agentId: string; name: string }> {
  const members = snapshot?.execution?.membersSnapshot ?? [];
  const plan = snapshot ? frozenPlan(snapshot) : undefined;
  if (!plan) return members.map(member => ({ agentId: member.agentId, name: member.displayName }));
  const planTurns = snapshot!.turns.filter(turn => !turn.overrideActionId).length;
  const stageId = (plan.steps[planTurns] ?? plan.steps.at(-1))?.stageId;
  const allowed = plan.config.stages.find(stage => stage.id === stageId)?.memberIds ?? [];
  return members.filter(member => allowed.includes(member.agentId)).map(member => ({ agentId: member.agentId, name: member.displayName }));
}

export const canDirectRun = (snapshot: RunSnapshot | undefined) => !!snapshot && ['running', 'pausing', 'paused', 'error', 'cancelled', 'interrupted'].includes(snapshot.status);
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
