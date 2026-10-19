import type { ProviderConfiguration } from '../../../../src/shared/contracts/configuration';
import type { NormalizedChunk, StreamChatInput } from '../../../../src/main/providers/types';

export const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
export const fakeKey = 'fixture-gemini-key-only';
export const configuration: ProviderConfiguration = {
  id: 'gemini-instance', name: 'Fixture', kind: 'gemini', baseUrl: null, enabled: true, isDefault: false,
  defaultModelId: null, customModels: [], keyReference: { id: 'fixture-reference' },
  createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
};
export const input: StreamChatInput = {
  requestId: 'main-request', modelId: 'manual-gemini', outputTokenLimit: 23,
  messages: [{ role: 'system', content: '主持指令' }, { role: 'system', content: '成员提示' },
    { role: 'user', content: '任务' }, { role: 'assistant', content: '公开历史' }, { role: 'user', content: '继续' }],
};
export function chunk(text?: string, finishReason?: string) {
  return { candidates: [{ index: 0, ...(text === undefined ? {} : { content: { role: 'model', parts: [{ text }] } }),
    ...(finishReason === undefined ? {} : { finishReason }) }] };
}
export function sse(...events: unknown[]): Response {
  const bytes = new TextEncoder().encode(events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\r\n\r\n`).join(''));
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(c) {
    if (offset >= bytes.length) { c.close(); return; }
    c.enqueue(bytes.slice(offset, ++offset));
  } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}
export async function collect(stream: AsyncIterable<NormalizedChunk>) {
  const events: NormalizedChunk[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
