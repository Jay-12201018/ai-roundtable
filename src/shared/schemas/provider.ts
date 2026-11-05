import { z } from 'zod';
import { idSchema, modelIdSchema, sequenceSchema } from './common';
import { apiErrorSchema } from './error';
import { attachmentIdSchema, imageMediaTypeSchema } from './attachment';

/**
 * D147: a message is plain text, or text and images in order. What is stored and compared is a reference to the image;
 * its bytes are read only when the request is written to the network. Only the `user` side carries images.
 */
export const providerTextPartSchema = z.object({ type: z.literal('text'), text: z.string() }).strict();
export const providerImagePartSchema = z.object({ type: z.literal('image'), attachmentId: attachmentIdSchema, mediaType: imageMediaTypeSchema }).strict();
export const providerContentPartSchema = z.discriminatedUnion('type', [providerTextPartSchema, providerImagePartSchema]);
export type ProviderContentPart = z.infer<typeof providerContentPartSchema>;
export type ProviderImagePart = z.infer<typeof providerImagePartSchema>;
export const providerMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']), content: z.union([z.string(), z.array(providerContentPartSchema).min(1)]),
}).strict().refine(message => typeof message.content === 'string' || message.role === 'user', 'Only the user side carries images');
/** The words of a message, whichever form it has. */
export const messageTextOf = (content: string | readonly ProviderContentPart[]) => typeof content === 'string' ? content
  : content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n\n');
export const messageImagesOf = (content: string | readonly ProviderContentPart[]) => typeof content === 'string' ? []
  : content.filter((part): part is ProviderImagePart => part.type === 'image');
/**
 * D147: what one image counts for in the input bound, whatever its size: no vendor's formula is guessed. A count this
 * size holds for the sizes these services read images at, and text is already overstated 1.5–4 times next to it.
 */
export const IMAGE_INPUT_TOKENS = 4096;
/**
 * D147: the most image bytes one request may carry, about 27 MB once in base64. Each one is sent in full on every request that
 * includes it, so a long discussion has to leave the oldest out: a body a service refuses whole would stop every turn after it.
 */
export const MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024;
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
  /** D152: a short group-chat reply or a scheduling request: the service's documented way to skip thinking applies, if the catalog has one. */
  fastReply: z.literal(true).optional(),
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
