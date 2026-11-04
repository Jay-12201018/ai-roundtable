import type { ProviderConfiguration } from '../../../../src/shared/contracts/configuration';
import type { NormalizedChunk, StreamChatInput } from '../../../../src/main/providers/types';

export const configuration: ProviderConfiguration = {
  id: 'service-instance', name: 'Fixture', kind: 'compatible', baseUrl: 'https://service.example/v1',
  enabled: true, isDefault: false, defaultModelId: null, customModels: [],
  keyReference: { id: 'fixture-reference' }, createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z',
};
export const input: StreamChatInput = {
  requestId: 'main-request', modelId: 'manual-model', outputTokenLimit: 23,
  agentRole: 'critic', turnIndex: 2,
  messages: [{ role: 'system', content: '成员提示' }, { role: 'user', content: '任务' }, { role: 'assistant', content: '公共历史' }],
};
export function chunk(content: string | null = null, finish: string | null = null) {
  return { id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: 'manual-model',
    choices: [{ index: 0, delta: { content }, finish_reason: finish }] };
}
export function sse(...events: unknown[]): Response {
  const bytes = new TextEncoder().encode(events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\r\n\r\n`).join(''));
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, offset += 1));
  } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}
export const collect = async (stream: AsyncIterable<NormalizedChunk>) => {
  const events: NormalizedChunk[] = [];
  for await (const event of stream) events.push(event);
  return events;
};
