import { workflowConfigSchema, type WorkflowConfig, type WorkflowSnapshot } from '../../../shared/schemas/workflow';
import type { RunSnapshot } from '../../../shared/types/run';
import type { WorkflowDraft, WorkflowPreview, WorkflowProgress, WorkflowTemplate } from './WorkflowFeature';
import { statusLabels } from '../../locales/zhCN';

export const workflowTemplateLabels: Record<WorkflowTemplate, string> = {
  'free-chat': '自由群聊', 'two-model-dialogue': '双模型对话', 'review-revision': '审查修订链', 'deep-debate': '深度辩论',
};
const stageLabels: Record<WorkflowConfig['stages'][number]['kind'], string> = {
  discussion: '讨论', dialogue: '对话', draft: '起草', review: '审查', revise: '修订', rereview: '复审', finalize: '定稿',
  opening: '立论', rebuttal: '交锋', closing: '总结',
};
export function workflowConfigFromDraft(draft: WorkflowDraft): WorkflowConfig {
  return workflowConfigSchema.parse({
    version: 1, templateId: draft.template,
    stages: draft.phases.map(phase => ({ id: phase.key,
      kind: draft.template === 'free-chat' ? 'discussion' : draft.template === 'two-model-dialogue' ? 'dialogue' : phase.key,
      memberIds: phase.participants, rounds: Number(phase.repeat) })),
    limits: { maxTurns: Number(draft.turnLimit), maxDurationMs: Number(draft.durationMs), outputTokenLimit: Number(draft.outputTokens) },
    endCondition: draft.finishAt ? { type: 'after_stage', stageId: draft.finishAt } : { type: 'plan_complete' },
  });
}
export function workflowPreviewForFeature(previewId: string, snapshot: WorkflowSnapshot): WorkflowPreview {
  const label = (id: string) => stageLabels[snapshot.config.stages.find(stage => stage.id === id)!.kind];
  return {
    id: previewId, totalTurns: snapshot.steps.length,
    stages: snapshot.config.stages.map(stage => ({ id: stage.id, label: stageLabels[stage.kind],
      turns: snapshot.steps.filter(step => step.stageId === stage.id).length,
      memberNames: stage.memberIds.map(id => snapshot.members.find(member => member.agentId === id)!.displayName) })),
    nextStep: label(snapshot.steps[0].stageId),
    ending: snapshot.config.endCondition.type === 'after_stage' ? `${label(snapshot.config.endCondition.stageId)}完成后结束` : '完成计划后结束',
    limits: `最多 ${snapshot.config.limits.maxTurns} 回合 · 累计 ${snapshot.config.limits.maxDurationMs} 毫秒 · 单次输出 ${snapshot.config.limits.outputTokenLimit} Token`,
  };
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
    nextStep: progress.nextStep ? `${stageLabels[progress.nextStep.kind]} · ${member?.displayName ?? '成员身份未记录'}` : '没有待执行步骤',
    limitReason: progress.limitReason === 'max_duration' ? '累计时长到限' : progress.limitReason === 'max_turns' ? '回合数到限' : undefined,
    stages: progress.stages.map(value => ({ ...value, label: stageLabels[value.kind], status: { pending: '待执行', running: '执行中', completed: '已完成' }[value.status] })),
  };
}
