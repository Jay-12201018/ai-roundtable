import { compiledWorkflowSnapshotSchema, workflowConfigSchema, type WorkflowConfig, type WorkflowSnapshot } from '../../../shared/schemas/workflow';
import type { RunSnapshot } from '../../../shared/types/run';
import { templateLabel, type WorkflowDraft, type WorkflowProgress, type WorkflowTemplate } from './model';
import { statusLabels } from '../../locales/zhCN';

export const workflowTemplateLabels: Record<WorkflowTemplate, string> = {
  'free-chat': templateLabel('free-chat'), 'two-model-dialogue': templateLabel('two-model-dialogue'),
  'review-revision': templateLabel('review-revision'), 'deep-debate': templateLabel('deep-debate'),
};
export const stageLabels: Record<WorkflowConfig['stages'][number]['kind'], string> = {
  discussion: '讨论', dialogue: '对话', draft: '起草', review: '审查', revise: '修订', rereview: '复审', finalize: '定稿',
  opening: '立论', rebuttal: '交锋', closing: '总结',
};
export function workflowConfigFromDraft(draft: WorkflowDraft): WorkflowConfig {
  return workflowConfigSchema.parse({
    version: 1, templateId: draft.template,
    stages: draft.phases.map(phase => ({ id: phase.key,
      kind: draft.template === 'free-chat' ? 'discussion' : draft.template === 'two-model-dialogue' ? 'dialogue' : phase.key,
      memberIds: phase.participants, rounds: Number(phase.repeat) })),
    limits: { maxTurns: Number(draft.turnLimit), maxDurationMs: Number(draft.durationMinutes) * 60000, outputTokenLimit: Number(draft.outputTokens) },
    endCondition: draft.finishAt ? { type: 'after_stage', stageId: draft.finishAt } : { type: 'plan_complete' },
  });
}
/** Main's compiled plan in one sentence: how many turns, where it ends, who speaks in which order. */
export function workflowPlanSummary(snapshot: WorkflowSnapshot): string {
  const names = snapshot.steps.map(step => snapshot.members.find(member => member.agentId === step.agentId)?.displayName ?? '成员');
  const order = names.length > 8 ? `${names.slice(0, 8).join(' → ')} → …` : names.join(' → ');
  const end = snapshot.config.endCondition;
  const ending = end.type === 'after_stage' ? `（${stageLabels[snapshot.config.stages.find(stage => stage.id === end.stageId)!.kind]}后结束）` : '';
  return `预计 ${snapshot.steps.length} 回合${ending}，${order}。成员严格依次发言，不会同时生成。`;
}
export function workflowProgressForFeature(snapshot?: RunSnapshot): WorkflowProgress | null {
  const progress = snapshot?.workflow;
  if (!snapshot || !progress) return null;
  const stage = progress.stages.find(value => value.id === progress.currentStage);
  const member = snapshot.execution?.membersSnapshot?.find(value => value.agentId === progress.nextStep?.agentId);
  return {
    runLabel: snapshot.execution?.task ?? '历史任务（目标未记录）', status: statusLabels[snapshot.status],
    completedTurns: progress.completedTurns, totalTurns: progress.totalTurns, elapsedMs: progress.elapsedMs,
    currentStage: stage ? `当前阶段：${stageLabels[stage.kind]}` : '当前阶段未记录',
    // Main names the next step only between Turns; while one is being generated the rest of the plan is still ahead.
    nextStep: progress.nextStep ? `${stageLabels[progress.nextStep.kind]} · ${member?.displayName ?? '成员身份未记录'}`
      : !progress.limitReason && progress.completedTurns < progress.totalTurns && ['running', 'pausing'].includes(snapshot.status) ? '当前发言结束后按计划继续' : '没有待执行步骤',
    limitReason: progress.limitReason === 'max_duration' ? '累计时长到限' : progress.limitReason === 'max_turns' ? '回合数到限' : undefined,
    stages: progress.stages.map(value => ({ ...value, label: stageLabels[value.kind], status: { pending: '待执行', running: '执行中', completed: '已完成' }[value.status] })),
  };
}

const stageCache = new WeakMap<RunSnapshot, Map<string, string>>();
/**
 * The workflow stage a plan Turn belongs to, from Main's frozen plan: plan Turns (not host-directed ones) take the
 * plan's steps in order. Undefined for host-directed Turns and Runs without a workflow.
 */
export function stageOfTurn(snapshot: RunSnapshot, turnId: string | undefined): string | undefined {
  if (!turnId) return undefined;
  let map = stageCache.get(snapshot);
  if (!map) {
    map = new Map();
    const plan = compiledWorkflowSnapshotSchema.safeParse(snapshot.workflowSnapshot);
    if (plan.success) [...snapshot.turns].filter(turn => !turn.overrideActionId).sort((a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0))
      .forEach((turn, index) => { const step = plan.data.steps[index]; if (step) map!.set(turn.turnId, stageLabels[step.kind]); });
    stageCache.set(snapshot, map);
  }
  return map.get(turnId);
}
