import type { ProviderConfiguration } from '../../../../src/shared/contracts/configuration';
import type { NormalizedChunk, StreamChatInput } from '../../../../src/main/providers/types';
import { normalizedChunkSchema } from '../../../../src/shared/schemas/provider';

export const fakeKey = 'fixture-anthropic-secret';
export const configuration: ProviderConfiguration = {
  id: 'anthropic-instance', name: 'Anthropic fixture', kind: 'anthropic', baseUrl: null,
  enabled: true, isDefault: false, defaultModelId: null, customModels: [], keyReference: { id: 'fixture-reference' },
  createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
};
export const input: StreamChatInput = {
  requestId: 'main-request', modelId: 'claude-fixture', outputTokenLimit: 23,
  messages: [{ role: 'system', content: '可信指令' }, { role: 'system', content: '第二条指令' },
    { role: 'user', content: '公开任务' }, { role: 'assistant', content: 'Agent A: 草稿' }, { role: 'user', content: '主持人补充' }],
};
export const start = (usage: Record<string, unknown> = { input_tokens: 7, output_tokens: 0 }) => ({
  type: 'message_start', message: { id: 'vendor-message-id', type: 'message', role: 'assistant', model: 'claude-fixture', content: [], stop_reason: null, stop_sequence: null, usage },
});
export const blockStart = (index = 0, block: Record<string, unknown> = { type: 'text', text: '' }) => ({ type: 'content_block_start', index, content_block: block });
export const text = (value: string, index = 0) => ({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: value } });
export const blockStop = (index = 0) => ({ type: 'content_block_stop', index });
export const delta = (reason = 'end_turn', usage: Record<string, unknown> = { output_tokens: 3 }) => ({ type: 'message_delta', delta: { stop_reason: reason, stop_sequence: null }, usage });
export const stop = () => ({ type: 'message_stop' });
export const success = (value = '你好🙂') => [start(), blockStart(), text(value), blockStop(), delta(), stop()];
export function frame(value: unknown, name?: string, newline = '\n') {
  return `event: ${name ?? (value as {type: string}).type}${newline}data: ${JSON.stringify(value)}${newline}${newline}`;
}
export function response(events: unknown[], options: { newline?: string; fragmentBytes?: number; headers?: HeadersInit } = {}) {
  return rawResponse(events.map(value => frame(value, undefined, options.newline)).join(''), options.fragmentBytes, options.headers);
}
export function rawResponse(value: string | Uint8Array, fragmentBytes = Number.MAX_SAFE_INTEGER, headers?: HeadersInit) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += fragmentBytes) controller.enqueue(bytes.subarray(offset, offset + fragmentBytes));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream', ...Object.fromEntries(new Headers(headers)) } });
}
export async function collect(stream: AsyncIterable<NormalizedChunk>) {
  const events: NormalizedChunk[] = [];
  for await (const event of stream) {
    if (!normalizedChunkSchema.safeParse(event).success) throw new Error('Adapter returned a non-contract event');
    events.push(event);
  }
  return events;
}
export const models = (data: Array<{id: string; display_name?: string}> = [{ id: 'claude-fixture', display_name: 'Fixture Claude' }], extra: Record<string, unknown> = {}) => Response.json({ data: data.map(model => ({ display_name: model.id, ...model })), has_more: false, ...extra });
