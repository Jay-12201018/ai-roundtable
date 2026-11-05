import { z } from 'zod';
import { idSchema, sequenceSchema, timestampSchema } from './common';

const count = sequenceSchema;

/** What a request was for: a discussion turn, a summary, an artifact, or deciding who speaks next in a group chat (D150). */
export const usageKindValues = ['turn', 'summary', 'artifact', 'schedule'] as const;
export const usageKindSchema = z.enum(usageKindValues);
/**
 * D133: one real request's token usage. `in_flight` is open; `reported` holds the provider's own usage from a terminal
 * stream; `unknown` means the request was sent but no complete usage came back (interrupted, stopped, or the service
 * sends none), and is never recorded as zero; `not_sent` means it provably never reached the network.
 */
export const usageStateValues = ['in_flight', 'reported', 'unknown', 'not_sent'] as const;
export const requestUsageSchema = z.object({
  requestId: idSchema, agentId: idSchema, providerId: idSchema, modelId: idSchema, kind: usageKindSchema, state: z.enum(usageStateValues),
  /** On an `unknown` row these are what was observed before the stream ended, kept as evidence and not totalled. */
  inputTokens: count.nullable(), outputTokens: count.nullable(), cacheHitTokens: count.nullable(),
  createdAt: timestampSchema, updatedAt: timestampSchema,
}).strict().superRefine((usage, ctx) => {
  if (usage.state === 'reported' && (usage.inputTokens === null || usage.outputTokens === null)
    || usage.state === 'not_sent' && (usage.inputTokens !== null || usage.outputTokens !== null)
    || usage.cacheHitTokens !== null && (usage.inputTokens === null || usage.cacheHitTokens > usage.inputTokens)) {
    ctx.addIssue({ code: 'custom', message: 'Usage does not match its state' });
  }
});

/** One group of requests. Only `reported` requests add tokens; the others are counted, never estimated. */
export const usageBucketSchema = z.object({
  requests: count, reportedRequests: count, inputTokens: count, cacheHitTokens: count, outputTokens: count,
  unknownRequests: count, inFlightRequests: count, notSentRequests: count,
}).strict();
export const usageRunRowSchema = usageBucketSchema.extend({
  runId: idSchema, roomId: idSchema, roomName: z.string(), task: z.string(), createdAt: timestampSchema,
}).strict();
export const usageModelRowSchema = usageBucketSchema.extend({
  providerId: idSchema, providerName: z.string(), modelId: idSchema,
}).strict();
export const usageKindRowSchema = usageBucketSchema.extend({ kind: usageKindSchema }).strict();
export const usageDateRowSchema = usageBucketSchema.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u) }).strict();
/** A request that was sent without complete usage coming back: the provider's console is the only record of it. */
export const usageUnknownRowSchema = z.object({
  requestId: idSchema, runId: idSchema, roomName: z.string(), task: z.string(), kind: usageKindSchema,
  speaker: z.string(), providerName: z.string(), modelId: idSchema, createdAt: timestampSchema,
  observedInputTokens: count.nullable(), observedOutputTokens: count.nullable(),
}).strict();
/**
 * D117: an optional time range [since, until) over when each request was sent. Absent bounds mean “all”; a Run that spans
 * the boundary contributes only the requests sent inside the range.
 */
export const usageReportInputSchema = z.object({ since: timestampSchema.optional(), until: timestampSchema.optional() }).strict()
  .refine(range => range.since === undefined || range.until === undefined || Date.parse(range.since) < Date.parse(range.until), 'An empty range');
export const usageReportSchema = z.object({
  generatedAt: timestampSchema,
  /** Dates group requests by when they were sent, in this computer's time zone. */
  timeZone: z.string().min(1).max(100),
  totals: usageBucketSchema,
  byRun: z.array(usageRunRowSchema).max(100000),
  byModel: z.array(usageModelRowSchema).max(10000),
  byDate: z.array(usageDateRowSchema).max(100000),
  byKind: z.array(usageKindRowSchema).max(4),
  unknownRequests: z.array(usageUnknownRowSchema).max(100000),
}).strict();
export const usageExportResultSchema = z.object({ saved: z.boolean(), fileName: z.string().max(512).optional(), rows: count }).strict();

export type RequestUsage = z.infer<typeof requestUsageSchema>;
export type UsageKind = z.infer<typeof usageKindSchema>;
export type UsageBucket = z.infer<typeof usageBucketSchema>;
export type UsageReport = z.infer<typeof usageReportSchema>;
export type UsageUnknownRow = z.infer<typeof usageUnknownRowSchema>;
export type UsageExportResult = z.infer<typeof usageExportResultSchema>;
export type UsageRange = z.infer<typeof usageReportInputSchema>;
