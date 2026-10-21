import { z } from 'zod';
import { messageStatusValues, runStatusValues, turnStatusValues } from '../types/run';
import { idSchema, PROTOCOL_VERSION, sequenceSchema, timestampSchema, workflowSnapshotSchema } from './common';
import { apiErrorSchema } from './error';
import { executionMetadataSchema, attemptSnapshotSchema } from './persistence';

import { workflowConfigSchema, workflowProgressSchema } from './workflow';

export const startRunInputSchema = z.object({
  roomId: idSchema, task: z.string().trim().min(1), workflowSnapshot: workflowSnapshotSchema.optional(), workflowConfig: workflowConfigSchema.optional(), workflowPreviewId: idSchema.optional(),
  mode: z.enum(['automatic', 'step']).optional(),
  maxTurns: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  maxDurationMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  outputTokenLimit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();
export const interruptedRunDecisionSchema = z.enum(['inspect', 'resume', 'retry', 'discard']);
export const runCursorSchema = z.object({ runId: idSchema, cursor: sequenceSchema }).strict();
export const retryTurnInputSchema = z.object({ runId: idSchema, turnId: idSchema }).strict();
export const continueMessageInputSchema = z.object({ runId: idSchema, messageId: idSchema }).strict();
export const recoveryInputSchema = z.object({ runId: idSchema, decision: interruptedRunDecisionSchema }).strict();

export const turnSnapshotSchema = z.object({
  turnId: idSchema, runId: idSchema, agentId: idSchema, turnIndex: sequenceSchema.optional(), status: z.enum(turnStatusValues),
  requestId: idSchema.optional(), messageId: idSchema.optional(), outputText: z.string().optional(),
  startedAt: timestampSchema.optional(), completedAt: timestampSchema.optional(),
}).strict();
export const messageSnapshotSchema = z.object({
  id: idSchema, senderName: z.string().trim().min(1), content: z.string(), status: z.enum(messageStatusValues),
}).strict();
export const runSnapshotSchema = z.object({
  runId: idSchema, roomId: idSchema, status: z.enum(runStatusValues), sequence: sequenceSchema,
  workflowSnapshot: workflowSnapshotSchema, currentTurnId: idSchema.optional(), activeAgentId: idSchema.optional(),
  turns: z.array(turnSnapshotSchema), messages: z.array(messageSnapshotSchema),
  startedAt: timestampSchema.optional(), updatedAt: timestampSchema,
  workflow: workflowProgressSchema.optional(), execution: executionMetadataSchema.optional(), attempts: z.array(attemptSnapshotSchema).optional(),
}).strict().superRefine((snapshot, ctx) => {
  const current = snapshot.turns.find((turn) => turn.turnId === snapshot.currentTurnId);
  if (snapshot.turns.some((turn) => turn.runId !== snapshot.runId)
    || new Set(snapshot.turns.map((turn) => turn.turnId)).size !== snapshot.turns.length
    || new Set(snapshot.messages.map((message) => message.id)).size !== snapshot.messages.length
    || (snapshot.currentTurnId !== undefined && (!current || current.status !== 'running'))
    || (snapshot.activeAgentId !== undefined && snapshot.activeAgentId !== current?.agentId)
    || snapshot.turns.some((turn) => turn.messageId !== undefined && !snapshot.messages.some((message) => message.id === turn.messageId))
    || new Set(snapshot.attempts?.map(a=>a.requestId)).size !== (snapshot.attempts?.length ?? 0)
    || snapshot.attempts?.some(a=>a.runId!==snapshot.runId || !snapshot.turns.some(t=>t.turnId===a.turnId) || !snapshot.messages.some(m=>m.id===a.messageId))) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent snapshot identities' });
  }
});

const base = { version: z.literal(PROTOCOL_VERSION), runId: idSchema, sequence: sequenceSchema.refine((value) => value > 0), timestamp: timestampSchema };
const runIdentity = { turnId: z.never().optional(), requestId: z.never().optional() };
const turnIdentity = { turnId: idSchema, requestId: idSchema };
const messagePayload = { turnId: idSchema, messageId: idSchema };
const deltaPayload = z.object({ ...messagePayload, senderName: z.string().trim().min(1), text: z.string() }).strict();
const turnEndedPayload = z.object(messagePayload).strict();
const turnErrorPayload = turnEndedPayload.extend({ error: apiErrorSchema }).strict();
export const runEventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, ...runIdentity, type: z.literal('run_state_changed'), payload: z.object({ status: z.enum(runStatusValues), reason: z.enum(['Maximum run duration reached', 'discarded after interruption']).optional() }).strict() }).strict(),
  z.object({ ...base, ...turnIdentity, type: z.literal('turn_started'), payload: z.object({ ...messagePayload, agentId: idSchema, requestId: idSchema }).strict() }).strict(),
  z.object({ ...base, ...turnIdentity, type: z.literal('text_delta'), payload: deltaPayload }).strict(),
  z.object({ ...base, ...turnIdentity, type: z.literal('reasoning_summary_delta'), payload: deltaPayload }).strict(),
  z.object({ ...base, ...turnIdentity, type: z.literal('usage_updated'), payload: z.object({ turnId: idSchema, inputTokens: sequenceSchema, outputTokens: sequenceSchema }).strict() }).strict(),
  z.object({ ...base, ...turnIdentity, type: z.literal('turn_completed'), payload: turnEndedPayload }).strict(),
  z.object({ ...base, ...turnIdentity, type: z.literal('turn_aborted'), payload: turnErrorPayload }).strict(),
  z.object({ ...base, ...turnIdentity, type: z.literal('turn_failed'), payload: turnErrorPayload }).strict(),
  z.object({ ...base, ...runIdentity, type: z.literal('snapshot_required'), payload: z.object({ reason: z.enum(['invalid_event', 'incompatible_version', 'sequence_gap']) }).strict() }).strict(),
]).superRefine((event, ctx) => {
  if ('turnId' in event.payload && event.payload.turnId !== event.turnId
    || 'requestId' in event.payload && event.payload.requestId !== event.requestId) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent event identities' });
  }
});

export const runSubscriptionSchema = z.object({
  snapshot: runSnapshotSchema, events: z.array(runEventSchema), nextCursor: sequenceSchema, resyncRequired: z.boolean(),
}).strict().superRefine((subscription, ctx) => {
  if (subscription.nextCursor !== subscription.snapshot.sequence
    || subscription.resyncRequired && subscription.events.length > 0
    || subscription.events.some((event, index, events) => event.runId !== subscription.snapshot.runId
      || event.sequence > subscription.snapshot.sequence
      || index > 0 && event.sequence !== events[index - 1].sequence + 1)
    || subscription.events.some((event) => {
      if (event.type === 'run_state_changed' || event.type === 'snapshot_required') return false;
      const turn = subscription.snapshot.turns.find((turn) => turn.turnId === event.turnId);
      const attempt = subscription.snapshot.attempts?.find(a=>a.requestId===event.requestId);
      return !turn || (attempt ? attempt.turnId!==turn.turnId || attempt.runId!==event.runId : turn.requestId!==event.requestId)
        || 'messageId' in event.payload && (attempt ? attempt.messageId : turn.messageId) !== event.payload.messageId
        || 'agentId' in event.payload && turn.agentId !== event.payload.agentId;
    })) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent subscription cursor' });
  }
});

export const runCommandSchema = z.discriminatedUnion('command', [
  startRunInputSchema.extend({ command: z.literal('start') }).strict(),
  z.object({ command: z.literal('pause'), runId: idSchema }).strict(),
  z.object({ command: z.literal('stop'), runId: idSchema }).strict(),
  z.object({ command: z.literal('step'), runId: idSchema }).strict(),
  z.object({ command: z.literal('resumeRun'), runId: idSchema }).strict(),
  retryTurnInputSchema.extend({ command: z.literal('retryTurn') }).strict(),
  continueMessageInputSchema.extend({ command: z.literal('continueMessage') }).strict(),
  recoveryInputSchema.extend({ command: z.literal('recoverInterruptedRun') }).strict(),
]);
export type RunSnapshotInput = z.input<typeof runSnapshotSchema>;
export type RunEventInput = z.input<typeof runEventSchema>;
