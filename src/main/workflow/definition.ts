import { z } from 'zod';
import { idSchema, sequenceSchema } from '../../shared/schemas/common';
import { memberSnapshotSchema } from '../../shared/schemas/persistence';

// Main-only until the owner approves one Shared schema and its persistence semantics.
export const workflowStageKindSchema = z.enum([
  'discussion', 'dialogue', 'draft', 'review', 'revise', 'rereview', 'finalize', 'opening', 'rebuttal', 'closing',
]);
export const workflowConfigSchema = z.object({
  version: z.literal(1),
  templateId: z.enum(['free-chat', 'two-model-dialogue', 'review-revision', 'deep-debate']),
  stages: z.array(z.object({
    id: idSchema, kind: workflowStageKindSchema,
    memberIds: z.array(idSchema).min(1).max(32), rounds: z.number().int().min(1).max(32),
  }).strict()).min(1).max(16),
  limits: z.object({
    maxTurns: z.number().int().min(1).max(256),
    maxDurationMs: z.number().int().min(1).max(86400000),
    outputTokenLimit: z.number().int().min(1).max(65536),
  }).strict(),
  endCondition: z.discriminatedUnion('type', [
    z.object({ type: z.literal('plan_complete') }).strict(),
    z.object({ type: z.literal('after_stage'), stageId: idSchema }).strict(),
  ]),
}).strict();
export const workflowStepSchema = z.object({
  index: sequenceSchema, stageId: idSchema, kind: workflowStageKindSchema, agentId: idSchema,
  round: z.number().int().min(1).max(32),
}).strict();
export const workflowSnapshotSchema = z.object({
  version: z.literal(1), roomId: idSchema, config: workflowConfigSchema,
  members: z.array(memberSnapshotSchema).min(1).max(32),
  steps: z.array(workflowStepSchema).min(1).max(256),
}).strict();

export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowSnapshot = z.infer<typeof workflowSnapshotSchema>;
export type WorkflowStageKind = z.infer<typeof workflowStageKindSchema>;

const instructions: Record<WorkflowStageKind, string> = {
  discussion: '围绕当前任务讨论，结合公共历史补充信息、回应前序意见。',
  dialogue: '与另一位成员轮流对话，直接回应前序公共意见，推进当前任务。',
  draft: '围绕当前任务起草完整初稿，明确方案、依据与待解决问题。',
  review: '审查前序初稿，指出具体问题、缺失证据和可操作的修订建议。',
  revise: '依据公共历史中的初稿和审查意见进行修订，给出修订稿并说明处理情况。',
  rereview: '复审修订稿，核对前序审查问题是否解决，指出仍存在的具体问题。',
  finalize: '根据初稿、审查、修订和复审的公共意见定稿，明确尚未解决的问题。',
  opening: '就当前任务陈述立场，提供依据、假设和可检验的论点。',
  rebuttal: '针对前序公共论点交锋，回应反对意见，核对证据并提出反例或修正。',
  closing: '总结本方论证及对方有效意见，明确共识、分歧与仍需核实的问题。',
};
export function workflowStageInstruction(kind: WorkflowStageKind): string {
  return instructions[workflowStageKindSchema.parse(kind)];
}
