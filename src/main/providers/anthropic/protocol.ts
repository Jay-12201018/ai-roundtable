import { z } from 'zod';
import { ContractError } from '../../../shared/contracts/errors';
import { idSchema, sequenceSchema } from '../../../shared/schemas/common';
import type { ErrorCode } from '../../../shared/schemas/error';
import type { NormalizedChunk } from '../types';
import { readSse } from './sse';
import type { RequestScope } from './scope';

const counts = z.object({
  input_tokens: sequenceSchema.nullable().optional(), output_tokens: sequenceSchema.nullable().optional(),
  cache_creation_input_tokens: sequenceSchema.nullable().optional(), cache_read_input_tokens: sequenceSchema.nullable().optional(),
});
const envelope = z.object({ type: z.string().min(1) });
const startSchema = z.object({ message: z.object({
  id: idSchema, role: z.literal('assistant'), type: z.literal('message'),
  content: z.array(z.unknown()).length(0), stop_reason: z.null().optional(), usage: counts.optional(),
}) });
const blockSchema = z.object({ index: sequenceSchema, content_block: z.object({
  type: z.string(), text: z.string().optional(), thinking: z.string().optional(), signature: z.string().optional(), data: z.string().optional(),
}) });
const deltaSchema = z.object({ index: sequenceSchema, delta: z.object({
  type: z.string(), text: z.string().optional(), thinking: z.string().optional(), signature: z.string().optional(),
}) });
const messageDeltaSchema = z.object({ delta: z.object({ stop_reason: z.string().nullable().optional() }), usage: counts.optional() });
const reasons = { end_turn: 'stop', stop_sequence: 'stop', max_tokens: 'length', model_context_window_exceeded: 'length', refusal: 'content_filter' } as const;
const streamErrors: Record<string, ErrorCode> = {
  invalid_request_error: 'invalid_input', authentication_error: 'authentication_failed', permission_error: 'forbidden',
  not_found_error: 'not_found', rate_limit_error: 'rate_limited', overloaded_error: 'internal_error', api_error: 'internal_error',
};
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ContractError('invalid_response');
  return result.data;
}

export async function* normalizeStream(response: Response, requestId: string, scope: RequestScope): AsyncIterable<NormalizedChunk> {
  let started = false;
  let nextIndex = 0;
  let block: 'text' | 'thinking' | 'redacted_thinking' | undefined;
  let messageDelta = false;
  let finish: 'stop' | 'length' | 'content_filter' | undefined;
  let input: number | null | undefined;
  let created: number | null | undefined = 0;
  let cached: number | null | undefined = 0;
  let output: number | null | undefined;
  let finalOutput = false;
  for await (const frame of readSse(response, scope.signal, () => scope.check())) {
    scope.check();
    let value: unknown;
    try { value = JSON.parse(frame.data); } catch { throw new ContractError('invalid_response'); }
    const { type } = parse(envelope, value);
    if (frame.event !== type) throw new ContractError('invalid_response');
    if (type === 'ping') continue;
    if (type === 'error') {
      const error = parse(z.object({ error: z.object({ type: z.string() }) }), value);
      throw new ContractError(Object.hasOwn(streamErrors, error.error.type) ? streamErrors[error.error.type] : 'internal_error');
    }
    if (type === 'message_start') {
      if (started) throw new ContractError('invalid_response');
      const { message } = parse(startSchema, value);
      started = true;
      input = message.usage?.input_tokens;
      output = message.usage?.output_tokens;
      created = message.usage?.cache_creation_input_tokens === undefined ? 0 : message.usage.cache_creation_input_tokens;
      cached = message.usage?.cache_read_input_tokens === undefined ? 0 : message.usage.cache_read_input_tokens;
      const providerId = idSchema.safeParse(response.headers.get('request-id'));
      yield { type: 'start', requestId, ...(providerId.success ? { providerRequestId: providerId.data } : {}) };
    } else if (type === 'content_block_start') {
      if (!started || block !== undefined || messageDelta) throw new ContractError('invalid_response');
      const event = parse(blockSchema, value);
      if (event.index !== nextIndex) throw new ContractError('invalid_response');
      const kind = event.content_block.type;
      if (kind !== 'text' && kind !== 'thinking' && kind !== 'redacted_thinking') throw new ContractError('unsupported');
      block = kind;
      if (kind === 'text') {
        if (event.content_block.text === undefined) throw new ContractError('invalid_response');
        if (event.content_block.text) yield { type: 'text_delta', requestId, text: event.content_block.text };
      }
    } else if (type === 'content_block_delta') {
      if (!started || block === undefined || messageDelta) throw new ContractError('invalid_response');
      const event = parse(deltaSchema, value);
      if (event.index !== nextIndex) throw new ContractError('invalid_response');
      if (block === 'text' && event.delta.type === 'text_delta') {
        if (event.delta.text === undefined) throw new ContractError('invalid_response');
        if (event.delta.text) yield { type: 'text_delta', requestId, text: event.delta.text };
      } else if (block === 'thinking' && event.delta.type === 'thinking_delta') {
        if (event.delta.thinking === undefined) throw new ContractError('invalid_response');
      } else if (block === 'thinking' && event.delta.type === 'signature_delta') {
        if (event.delta.signature === undefined) throw new ContractError('invalid_response');
      } else throw new ContractError('unsupported');
      // No model policy attests that thinking is a public summary; never project it.
    } else if (type === 'content_block_stop') {
      const event = parse(z.object({ index: sequenceSchema }), value);
      if (!started || block === undefined || messageDelta || event.index !== nextIndex) throw new ContractError('invalid_response');
      block = undefined; nextIndex++;
    } else if (type === 'message_delta') {
      if (!started || block !== undefined || finish !== undefined) throw new ContractError('invalid_response');
      const event = parse(messageDeltaSchema, value);
      messageDelta = true;
      const usage = event.usage;
      input = cumulative(input, usage?.input_tokens);
      created = cumulative(created, usage?.cache_creation_input_tokens);
      cached = cumulative(cached, usage?.cache_read_input_tokens);
      output = cumulative(output, usage?.output_tokens);
      if (usage?.output_tokens != null) finalOutput = true;
      if (event.delta.stop_reason != null) {
        if (!Object.hasOwn(reasons, event.delta.stop_reason)) throw new ContractError('unsupported');
        finish = reasons[event.delta.stop_reason as keyof typeof reasons];
      }
    } else if (type === 'message_stop') {
      if (!started || block !== undefined || finish === undefined) throw new ContractError('invalid_response');
      if (input != null && created != null && cached != null && output != null && finalOutput) {
        const total = input + created + cached;
        if (!Number.isSafeInteger(total)) throw new ContractError('invalid_response');
        yield { type: 'usage', requestId, inputTokens: total, outputTokens: output };
      }
      scope.check();
      yield { type: 'finish', requestId, reason: finish }; return;
    }
    // Anthropic explicitly permits future event types. Known content still validates above.
  }
  throw new ContractError('invalid_response');
}

function cumulative(previous: number | null | undefined, next: number | null | undefined) {
  if (next == null) return previous;
  if (previous != null && next < previous) throw new ContractError('invalid_response');
  return next;
}
