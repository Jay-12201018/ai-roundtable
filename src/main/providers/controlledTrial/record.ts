import { z } from 'zod';
import { idSchema, timestampSchema } from '../../../shared/schemas/common';
import { errorCodeSchema } from '../../../shared/schemas/error';
import { trialDiagnosticsSchema } from '../diagnostics';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const trialRecordSchema = z.object({
  id: idSchema, requestId: idSchema, providerId: idSchema,
  modelId: z.literal('deepseek-flash'), baseUrl: z.literal('https://api.deepseek.com'),
  prompt: z.literal('Reply OK.'), keyRevision: idSchema,
  createdAt: timestampSchema, priceReviewedAt: timestampSchema, priceExpiresAt: timestampSchema,
  inputMicroCnyPerToken: count, outputMicroCnyPerToken: count, priceEvidence: z.string().min(1),
  estimatedInputTokens: count, estimatedMicroCny: count, reservedMicroCny: z.literal(50000),
  maxOutputTokens: z.literal(128), state: z.enum(['reserved', 'unknown', 'settled']),
  outcome: z.enum(['running', 'completed', 'cancelled', 'error', 'interrupted']),
  actualInputTokens: count.nullable(), actualOutputTokens: count.nullable(),
  observedUsage: z.object({ inputTokens: count, outputTokens: count }).strict().nullable(),
  diagnostics: trialDiagnosticsSchema.optional(),
  accountedMicroCny: count.nullable(), text: z.string().max(16384), errorCode: errorCodeSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  const settled = value.state === 'settled';
  const actual = value.actualInputTokens !== null && value.actualOutputTokens !== null && value.accountedMicroCny !== null;
  if (settled !== actual || (!settled && [value.actualInputTokens, value.actualOutputTokens, value.accountedMicroCny].some(v => v !== null))) ctx.addIssue({ code: 'custom', message: 'Unknown charges cannot be recorded as zero' });
  if (settled && value.accountedMicroCny !== value.actualInputTokens! * value.inputMicroCnyPerToken + value.actualOutputTokens! * value.outputMicroCnyPerToken) ctx.addIssue({ code: 'custom', message: 'Usage accounting mismatch' });
  if (settled && (value.observedUsage?.inputTokens !== value.actualInputTokens || value.observedUsage?.outputTokens !== value.actualOutputTokens)) ctx.addIssue({ code: 'custom', message: 'Settled usage must retain provider evidence' });
  if (value.state === 'reserved' && value.outcome !== 'running') ctx.addIssue({ code: 'custom', message: 'Reservation must be running' });
});
export type TrialRecord = z.infer<typeof trialRecordSchema>;
