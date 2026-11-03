import { z } from 'zod';
import { idSchema, sequenceSchema, timestampSchema } from './common';
import { errorCodeSchema } from './error';

const count = sequenceSchema;
const position = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

/**
 * R13B conversation summaries (D107). A summary is a visible, editable timeline message that stands in for public
 * messages 1..N in later requests, from when it is complete (D140). Originals are never changed or hidden.
 */
export const summaryPreviewInputSchema = z.object({
  runId: idSchema, agentId: idSchema.optional(), throughSlotId: idSchema.optional(), summaryId: idSchema.optional(),
}).strict();
export const summaryCandidateSchema = z.object({
  slotId: idSchema, number: position, speaker: z.string().min(1).max(200), excerpt: z.string().max(120),
}).strict();
export const summaryAgentOptionSchema = z.object({
  agentId: idSchema, name: z.string().min(1), providerId: idSchema.nullable(), modelId: idSchema.nullable(),
}).strict();
export const summaryUnavailableReasonValues = ['busy', 'too_few', 'context_exceeds', 'unsupported', 'covered'] as const;
export const summaryPreviewSchema = z.object({
  runId: idSchema,
  available: z.boolean(),
  reason: z.enum(summaryUnavailableReasonValues).optional(),
  /** Public messages in order; numbering is the one shown in the timeline and in the summary label. */
  candidates: z.array(summaryCandidateSchema).max(4096),
  throughSlotId: idSchema.optional(), firstNumber: position.optional(), lastNumber: position.optional(),
  agents: z.array(summaryAgentOptionSchema).max(64), agentId: idSchema.optional(),
  /** A confirmed earlier summary this one builds on; its covered originals are not resent. */
  basedOn: z.object({ summaryId: idSchema, lastNumber: position }).strict().optional(),
  inputTokens: count.optional(), inputBudgetTokens: count.optional(),
}).strict();
export const summaryGenerateInputSchema = z.object({
  runId: idSchema, clientRequestId: idSchema, agentId: idSchema, throughSlotId: idSchema,
  /** Regenerate an existing summary as a new version; its coverage cannot change. */
  summaryId: idSchema.optional(),
}).strict();
export const summaryConfirmInputSchema = z.object({ runId: idSchema, clientRequestId: idSchema, messageId: idSchema }).strict();
export const summaryCommandResultSchema = z.object({
  runId: idSchema, summaryId: idSchema, duplicate: z.boolean(), requestId: idSchema.optional(), messageId: idSchema.optional(),
}).strict();

export const summaryRequestStatusValues = ['generating', 'completed', 'failed', 'aborted', 'interrupted'] as const;
export const contextSummarySchema = z.object({
  summaryId: idSchema, slotId: idSchema, agentId: idSchema,
  coveredSlotIds: z.array(idSchema).min(1).max(4096), firstNumber: position, lastNumber: position,
  basedOnSummaryId: idSchema.optional(),
  requests: z.array(z.object({
    requestId: idSchema, messageId: idSchema, status: z.enum(summaryRequestStatusValues),
    finishReason: z.enum(['stop', 'length']).optional(), createdAt: timestampSchema,
    /** D125: why a failed or stopped request ended, as recorded with its summary_updated event. */
    errorCode: errorCodeSchema.optional(),
  }).strict()).min(1).max(256),
  confirmedMessageIds: z.array(idSchema).max(512),
  /** D140: versions the host stopped using; later requests go back to the originals. */
  revokedMessageIds: z.array(idSchema).max(512).optional(),
  /** D109: covered messages edited or regenerated after the effective version was written; they are sent themselves. */
  revisedSlotIds: z.array(idSchema).max(4096).optional(),
  createdAt: timestampSchema,
}).strict();
/** How full the next request's context is, so the host can decide when to summarize (never automatic). */
export const contextPressureSchema = z.object({
  agentId: idSchema, usedTokens: count, inputBudgetTokens: count,
  /** Public messages left out of the next request because they did not fit (the pre-R13B silent drop). */
  omittedMessages: count,
  /** Public messages replaced by the active confirmed summary. */
  summarizedMessages: count,
  level: z.enum(['ok', 'near', 'over']),
}).strict();

export type SummaryPreviewInput = z.infer<typeof summaryPreviewInputSchema>;
export type SummaryPreview = z.infer<typeof summaryPreviewSchema>;
export type SummaryGenerateInput = z.infer<typeof summaryGenerateInputSchema>;
export type SummaryConfirmInput = z.infer<typeof summaryConfirmInputSchema>;
export type SummaryCommandResult = z.infer<typeof summaryCommandResultSchema>;
export type ContextSummary = z.infer<typeof contextSummarySchema>;
export type ContextPressure = z.infer<typeof contextPressureSchema>;

/** The label the model sees above a confirmed summary; numbering matches the timeline (D107). */
export const summaryLabel = (firstNumber: number, lastNumber: number) =>
  `【讨论摘要 · 覆盖第 ${firstNumber}–${lastNumber} 条，由主持人确认】`;
