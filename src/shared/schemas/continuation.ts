import { z } from 'zod';
import { idSchema, sequenceSchema, timestampSchema } from './common';
import { hostMessageContentSchema } from './host';

const count = sequenceSchema;

/**
 * D111: continue a finished discussion in the same Run. The host's words join the public history as an
 * interjection; then the named member answers once, or, without a name, every member speaks once in roster order.
 * Main decides who answers and what it may cost; the Renderer only shows it.
 */
export const continueDiscussionInputSchema = z.object({
  runId: idSchema, clientRequestId: idSchema, content: hostMessageContentSchema, agentId: idSchema.optional(),
}).strict();
export const continueDiscussionResultSchema = z.object({
  runId: idSchema, actionId: idSchema, messageId: idSchema, agentIds: z.array(idSchema).min(1).max(64), duplicate: z.boolean(),
}).strict();

export const continuationPreviewInputSchema = z.object({
  runId: idSchema, agentId: idSchema.optional(),
  /** Counted into the estimate as the interjection every answering member will read; empty before the host types. */
  content: z.string().max(20000).optional(),
}).strict();
export const continuationUnavailableReasonValues = ['not_finished', 'busy', 'member_unavailable', 'context_exceeds', 'budget_insufficient', 'unsupported'] as const;
export const continuationPreviewSchema = z.object({
  runId: idSchema,
  available: z.boolean(),
  reason: z.enum(continuationUnavailableReasonValues).optional(),
  /** Who would answer, in order. */
  agentIds: z.array(idSchema).max(64),
  /**
   * Estimated reservations for the whole continuation: each request as it would be sent now, plus the interjection
   * and the answers before it written to the output limit. Each request is still reserved on its own when it is
   * sent. `firstMicro` (the first answer, a strict bound) must fit in what is left before anything starts.
   */
  cost: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('free') }).strict(),
    z.object({ kind: z.literal('priced'), maxMicro: count, firstMicro: count, remainingMicro: count }).strict(),
    z.object({ kind: z.literal('unavailable') }).strict(),
  ]),
}).strict();

/** A continuation as the snapshot shows it: the interjection's action and message, and who answers it. */
export const runContinuationSchema = z.object({
  actionId: idSchema, messageId: idSchema.optional(), agentIds: z.array(idSchema).min(1).max(64), createdAt: timestampSchema,
}).strict();

export type ContinueDiscussionInput = z.infer<typeof continueDiscussionInputSchema>;
export type ContinueDiscussionResult = z.infer<typeof continueDiscussionResultSchema>;
export type ContinuationPreviewInput = z.infer<typeof continuationPreviewInputSchema>;
export type ContinuationPreview = z.infer<typeof continuationPreviewSchema>;
export type RunContinuation = z.infer<typeof runContinuationSchema>;
