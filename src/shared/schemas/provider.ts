import { z } from 'zod';
import { idSchema, modelIdSchema, sequenceSchema } from './common';
import { apiErrorSchema } from './error';

export const providerMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']), content: z.string(),
}).strict();
/**
 * D134: conservative defaults for a model with no limits of its own. No model name or vendor decides these. 128,000 is
 * the smallest context mainstream models share, and input is counted as an upper bound, so a request that passes fits
 * them; 8,192 is what older models still accept as an output limit. The host can change both per model.
 */
export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 128000;
export const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 8192;
export const MIN_MODEL_CONTEXT_WINDOW_TOKENS = 1024;
export const MAX_MODEL_LIMIT_TOKENS = 100_000_000;
const modelTokenLimit = z.number().int().positive().max(MAX_MODEL_LIMIT_TOKENS);
export const providerModelSchema = z.object({ id: idSchema, name: z.string().trim().min(1),
  /** D134: host-set limits; absent means the defaults above. */
  contextWindowTokens: modelTokenLimit.min(MIN_MODEL_CONTEXT_WINDOW_TOKENS).optional(), maxOutputTokens: modelTokenLimit.optional() }).strict();
/** D134: what a request for this model may use now. */
export function modelLimits(model?: { contextWindowTokens?: number; maxOutputTokens?: number }) {
  const contextWindowTokens = model?.contextWindowTokens ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
  return { contextWindowTokens, maxOutputTokens: Math.min(model?.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS, contextWindowTokens) };
}
export const connectionLevelSchema = z.enum(['configuration', 'generation']);
export const testConnectionInputSchema = z.object({
  requestId: idSchema, level: connectionLevelSchema, modelId: idSchema.optional(),
}).strict().refine((input) => input.level !== 'generation' || input.modelId !== undefined, 'Generation test requires a model');
export const connectionTestResultSchema = z.discriminatedUnion('ok', [
  z.object({ requestId: idSchema, level: connectionLevelSchema, ok: z.literal(true) }).strict(),
  z.object({ requestId: idSchema, level: connectionLevelSchema, ok: z.literal(false), error: apiErrorSchema }).strict(),
]);
export const streamChatInputSchema = z.object({
  requestId: idSchema, modelId: modelIdSchema, messages: z.array(providerMessageSchema),
  outputTokenLimit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  agentRole: z.string().optional(), turnIndex: sequenceSchema.optional(),
}).strict();
const identity = { requestId: idSchema };
export const normalizedChunkSchema = z.discriminatedUnion('type', [
  z.object({ ...identity, type: z.literal('start'), providerRequestId: idSchema.optional() }).strict(),
  z.object({ ...identity, type: z.literal('text_delta'), text: z.string() }).strict(),
  z.object({ ...identity, type: z.literal('reasoning_summary_delta'), text: z.string() }).strict(),
  // `cacheHitInputTokens` is the provider-reported part of inputTokens served from its context cache.
  z.object({ ...identity, type: z.literal('usage'), inputTokens: sequenceSchema, outputTokens: sequenceSchema, cacheHitInputTokens: sequenceSchema.optional() }).strict()
    .refine(chunk => chunk.cacheHitInputTokens === undefined || chunk.cacheHitInputTokens <= chunk.inputTokens, 'Cache hits cannot exceed input tokens'),
  z.object({ ...identity, type: z.literal('finish'), reason: z.enum(['stop', 'length', 'content_filter']) }).strict(),
  z.object({ ...identity, type: z.literal('error'), error: apiErrorSchema }).strict(),
]);
