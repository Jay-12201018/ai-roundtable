import { z } from 'zod';
import { idSchema, sequenceSchema, timestampSchema } from './common';
import { chargeWriteOffSchema } from './budget';

const count = sequenceSchema;

/**
 * R13B usage report (D108): every ledger entry once, split into settled (actual price), unknown (counted at the
 * reservation cap), written off (the host's console amount) and in-flight reservations. All amounts are micro-CNY.
 */
export const usageBucketSchema = z.object({
  requests: count,
  settled: z.object({ count, inputTokens: count, cacheHitTokens: count, outputTokens: count, amountMicro: count,
    /** What the same usage costs at the peak cache-miss price, the R13A conservative basis. */
    peakMicro: count, offPeakCount: count }).strict(),
  unknown: z.object({ count, amountMicro: count }).strict(),
  writtenOff: z.object({ count, amountMicro: count, capMicro: count }).strict(),
  reserved: z.object({ count, amountMicro: count }).strict(),
  notSent: count,
  /** settled + unknown + written off; in-flight reservations are listed separately. */
  totalMicro: count,
}).strict();
export const usageRunRowSchema = usageBucketSchema.extend({
  runId: idSchema, roomId: idSchema, roomName: z.string(), task: z.string(), createdAt: timestampSchema,
}).strict();
export const usageModelRowSchema = usageBucketSchema.extend({
  providerId: idSchema, providerName: z.string(), modelId: idSchema,
}).strict();
/** D120: what the requests were for — discussion turns, summaries or artifacts. */
export const usageKindRowSchema = usageBucketSchema.extend({ kind: z.enum(['turn', 'summary', 'artifact']) }).strict();
export const usageDateRowSchema = usageBucketSchema.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u) }).strict();
export const usageUnknownRowSchema = z.object({
  requestId: idSchema, runId: idSchema, roomName: z.string(), task: z.string(), kind: z.enum(['turn', 'summary', 'artifact']),
  speaker: z.string(), providerName: z.string(), modelId: idSchema, createdAt: timestampSchema, reservedMicro: count,
  observedInputTokens: count.nullable(), observedOutputTokens: count.nullable(),
  writeOffs: z.array(chargeWriteOffSchema).max(64),
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
  unknownCharges: z.array(usageUnknownRowSchema).max(100000),
  /** Optional for compatibility with R13B readers; Main always sends it. */
  byKind: z.array(usageKindRowSchema).max(3).optional(),
}).strict();
export const usageExportResultSchema = z.object({ saved: z.boolean(), fileName: z.string().max(512).optional(), rows: count }).strict();

export type UsageBucket = z.infer<typeof usageBucketSchema>;
export type UsageReport = z.infer<typeof usageReportSchema>;
export type UsageUnknownRow = z.infer<typeof usageUnknownRowSchema>;
export type UsageExportResult = z.infer<typeof usageExportResultSchema>;
export type UsageRange = z.infer<typeof usageReportInputSchema>;
