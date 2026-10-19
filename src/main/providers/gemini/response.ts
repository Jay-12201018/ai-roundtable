import { z } from 'zod';
import { ContractError } from '../../../shared/contracts/errors';
import { idSchema } from '../../../shared/schemas/common';

const tokens = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const usageSchema = z.object({
  promptTokenCount: tokens.optional(), candidatesTokenCount: tokens.optional(), thoughtsTokenCount: tokens.optional(),
  totalTokenCount: tokens.optional(), cachedContentTokenCount: tokens.optional(), toolUsePromptTokenCount: tokens.optional(),
});
export type Usage = z.infer<typeof usageSchema>;
const safety = z.array(z.object({ blocked: z.boolean().optional() }));
const part = z.object({ text: z.string().optional(), thought: z.boolean().optional(), thoughtSignature: z.string().optional() }).catchall(z.unknown());
export const responseSchema = z.object({
  error: z.object({ code: z.number().int().min(400).max(599) }).optional(),
  responseId: idSchema.optional(),
  candidates: z.array(z.object({
    index: z.literal(0).optional(), content: z.object({ role: z.literal('model').optional(), parts: z.array(part).optional() }).optional(),
    finishReason: z.string().optional(), safetyRatings: safety.optional(),
  })).max(1).optional(),
  promptFeedback: z.object({ blockReason: z.string().optional(), safetyRatings: safety.optional() }).optional(),
  usageMetadata: usageSchema.optional(),
});
type ResponseData = z.infer<typeof responseSchema>;
export function httpFailure(status: number): ContractError {
  return new ContractError(status === 401 ? 'authentication_failed' : status === 403 ? 'forbidden'
    : status === 429 ? 'rate_limited' : status === 404 ? 'not_found'
    : status >= 500 ? 'internal_error' : status >= 400 ? 'invalid_input' : 'invalid_response');
}
const filtered = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION', 'MODEL_ARMOR']);
const promptBlocks = new Set(['SAFETY', 'OTHER', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'IMAGE_SAFETY', 'MODEL_ARMOR']);

export function finishReason(value: ResponseData): 'stop' | 'length' | 'content_filter' | undefined {
  const block = value.promptFeedback?.blockReason;
  if (block && block !== 'BLOCK_REASON_UNSPECIFIED') {
    if (!promptBlocks.has(block)) throw new ContractError('unsupported');
    return 'content_filter';
  }
  const candidate = value.candidates?.[0];
  if (value.promptFeedback?.safetyRatings?.some(r => r.blocked) || candidate?.safetyRatings?.some(r => r.blocked)) return 'content_filter';
  const reason = candidate?.finishReason;
  if (reason === undefined) return;
  if (reason === 'STOP') return 'stop';
  if (reason === 'MAX_TOKENS') return 'length';
  if (filtered.has(reason)) return 'content_filter';
  throw new ContractError('unsupported');
}

export function publicParts(value: ResponseData): string[] {
  return (value.candidates?.[0]?.content?.parts ?? []).flatMap(p => {
    // Gemini thought parts/signatures are never treated as a public reasoning summary.
    if (p.thought === true) return [];
    if (Object.keys(p).some(key => !['text', 'thought', 'thoughtSignature'].includes(key))) throw new ContractError('unsupported');
    if (p.text === undefined && p.thoughtSignature === undefined) throw new ContractError('invalid_response');
    return p.text ? [p.text] : [];
  });
}

export function validateUsage(current: Usage, previous: Usage): void {
  for (const key of Object.keys(current) as Array<keyof Usage>) {
    if (previous[key] !== undefined && current[key] !== undefined && current[key]! < previous[key]!) throw new ContractError('invalid_response');
  }
  if (current.toolUsePromptTokenCount) throw new ContractError('unsupported');
  const known = { ...previous, ...current };
  const sum = (known.promptTokenCount ?? 0) + (known.candidatesTokenCount ?? 0)
    + (known.thoughtsTokenCount ?? 0);
  if (!Number.isSafeInteger(sum) || current.totalTokenCount !== undefined && current.totalTokenCount < sum
    || known.cachedContentTokenCount !== undefined && known.promptTokenCount !== undefined && known.cachedContentTokenCount > known.promptTokenCount) {
    throw new ContractError('invalid_response');
  }
}
