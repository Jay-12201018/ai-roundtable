import { z } from 'zod';
import { idSchema, modelIdSchema, sequenceSchema } from './common';
import { apiErrorSchema } from './error';

export const providerMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']), content: z.string(),
}).strict();
export const providerModelSchema = z.object({ id: idSchema, name: z.string().trim().min(1) }).strict();
export const listModelsInputSchema = z.object({ requestId: idSchema }).strict();
export const connectionLevelSchema = z.enum(['configuration', 'authentication', 'generation']);
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
  z.object({ ...identity, type: z.literal('usage'), inputTokens: sequenceSchema, outputTokens: sequenceSchema }).strict(),
  z.object({ ...identity, type: z.literal('finish'), reason: z.enum(['stop', 'length', 'content_filter']) }).strict(),
  z.object({ ...identity, type: z.literal('error'), error: apiErrorSchema }).strict(),
]);
