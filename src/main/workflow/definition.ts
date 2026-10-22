import { workflowStageKindSchema, type WorkflowStageKind } from '../../shared/schemas/workflow';
export { workflowConfigSchema, workflowStepSchema, compiledWorkflowSnapshotSchema as workflowSnapshotSchema, workflowStageKindSchema } from '../../shared/schemas/workflow';
export type { WorkflowConfig, WorkflowStep, WorkflowSnapshot, WorkflowStageKind } from '../../shared/schemas/workflow';

// Built-in stage guidance (D095): each stage names the new contribution it owes, so short member prompts still work.
const instructions: Record<WorkflowStageKind, string> = {
  discussion: '本轮阶段：讨论。回应前序意见，补充新的信息、论点或方案，不重复他人已经说过的内容。',
  dialogue: '本轮阶段：对话。直接回应对方上一条发言中的具体观点，提出新的论据或问题，推进当前任务。',
  draft: '本轮阶段：起草。围绕当前任务写出完整初稿，写明方案、依据、关键假设和待解决的问题。',
  review: '本轮阶段：审查。逐条指出前序初稿中的具体问题（错误、遗漏、风险、证据不足），每条写明出处，并给出可直接执行的修改建议；不要重写或复述初稿。',
  revise: '本轮阶段：修订。依据初稿和审查意见给出修订稿，并逐条说明每条审查意见是否采纳及理由。',
  rereview: '本轮阶段：复审。对照修订稿逐条核对前序审查问题是否已解决，只指出仍存在或新出现的具体问题。',
  finalize: '本轮阶段：定稿。综合初稿、审查、修订和复审意见输出最终版本，并列出尚未解决的问题。',
  opening: '本轮阶段：立论。就当前任务陈述立场，给出依据、假设和可检验的论点。',
  rebuttal: '本轮阶段：交锋。针对对方的具体论点回应反对意见、核对证据，提出反例或修正，不重复己方已有论点。',
  closing: '本轮阶段：总结。总结本方论证和对方的有效意见，明确共识、分歧和仍需核实的问题。',
};
export function workflowStageInstruction(kind: WorkflowStageKind): string {
  return instructions[workflowStageKindSchema.parse(kind)];
}
