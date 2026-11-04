import { z } from 'zod';

/** D146: rounds already bound how long a discussion is, and one request stops at 600 seconds; this is only a backstop. */
export const DEFAULT_RUN_DURATION_MINUTES = 120;
export const DEFAULT_RUN_DURATION_MS = DEFAULT_RUN_DURATION_MINUTES * 60_000;
import { idSchema, sequenceSchema } from './common';
import { memberSnapshotSchema } from './persistence';

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
export const compiledWorkflowSnapshotSchema = z.object({
  version: z.literal(1), roomId: idSchema, config: workflowConfigSchema,
  members: z.array(memberSnapshotSchema).min(1).max(32),
  steps: z.array(workflowStepSchema).min(1).max(256),
}).strict();

export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowSnapshot = z.infer<typeof compiledWorkflowSnapshotSchema>;
export type WorkflowStageKind = z.infer<typeof workflowStageKindSchema>;

export const workflowPreviewInputSchema = z.object({ roomId: idSchema, config: workflowConfigSchema }).strict();
export const workflowPreviewSchema = z.object({ previewId: idSchema, snapshot: compiledWorkflowSnapshotSchema }).strict();
export const workflowProgressSchema = z.object({
  templateId: workflowConfigSchema.shape.templateId,
  completedTurns: sequenceSchema, totalTurns: sequenceSchema, elapsedMs: sequenceSchema,
  currentStage: idSchema.optional(), nextStep: workflowStepSchema.optional(),
  limitReason: z.enum(['max_turns', 'max_duration']).optional(),
  stages: z.array(z.object({ id: idSchema, kind: workflowStageKindSchema,
    status: z.enum(['pending', 'running', 'completed']), completedTurns: sequenceSchema, totalTurns: sequenceSchema,
  }).strict()).max(16),
}).strict().superRefine((value, ctx) => {
  if (value.completedTurns > value.totalTurns || value.stages.some(stage => stage.completedTurns > stage.totalTurns)
    || new Set(value.stages.map(stage => stage.id)).size !== value.stages.length
    || value.stages.reduce((total, stage) => total + stage.totalTurns, 0) !== value.totalTurns
    || value.stages.reduce((total, stage) => total + stage.completedTurns, 0) !== value.completedTurns
    || value.currentStage !== undefined && !value.stages.some(stage => stage.id === value.currentStage)
    || value.nextStep !== undefined && (!value.stages.some(stage => stage.id === value.nextStep!.stageId) || value.nextStep.index >= value.totalTurns)) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent workflow progress' });
  }
});
export type WorkflowPreviewInput = z.infer<typeof workflowPreviewInputSchema>;
export type WorkflowPreview = z.infer<typeof workflowPreviewSchema>;
export type WorkflowProgress = z.infer<typeof workflowProgressSchema>;
