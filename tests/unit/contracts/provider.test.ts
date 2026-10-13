import { describe, expect, expectTypeOf, it } from 'vitest';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import type { ProviderAdapter, StreamChatInput } from '../../../src/shared/contracts/provider';
import type { ProviderAdapter as MainProviderAdapter } from '../../../src/main/providers/types';
import { connectionTestResultSchema, normalizedChunkSchema, streamChatInputSchema, testConnectionInputSchema } from '../../../src/shared/schemas/provider';
import { publicError } from '../../../src/shared/schemas/error';

describe('Provider contract Mock', () => {
  it('uses the Main request ID for every streamed chunk', async () => {
    const provider = new MockProvider();
    const input = { modelId: 'mock', requestId: 'request-1', agentRole: 'Drafter', turnIndex: 0, messages: [] };
    const events = [];
    for await (const event of provider.streamChat(input)) events.push(event);
    expect(events.length).toBeGreaterThan(2);
    for (const event of events) expect(event).toMatchObject({ requestId: 'request-1' });
  });
  it('lists deterministic models and tests each connection level without network', async () => {
    const provider = new MockProvider();
    expect(await provider.listModels({ requestId: 'list-1' })).toEqual([{ id: 'mock', name: 'Mock' }]);
    for (const level of ['configuration', 'authentication', 'generation'] as const) {
      expect(await provider.testConnection({ requestId: 'test-1', level, modelId: 'mock' })).toMatchObject({ level, ok: true });
    }
  });
  it.each(['openai', 'anthropic', 'gemini', 'openai-compatible'])('accepts a SDK-free %s fixture with all six event types', async (modelId) => {
    const fixture: ProviderAdapter = {
      async listModels() { return [{ id: modelId, name: modelId }]; },
      async testConnection(input) { return { requestId: input.requestId, level: input.level, ok: true }; },
      async *streamChat({ requestId }) {
        yield { type: 'start', requestId, providerRequestId: 'vendor-id' };
        yield { type: 'text_delta', requestId, text: 'text' };
        yield { type: 'reasoning_summary_delta', requestId, text: 'public summary' };
        yield { type: 'usage', requestId, inputTokens: 1, outputTokens: 2 };
        yield { type: 'finish', requestId, reason: 'stop' };
      },
    };
    expectTypeOf<ProviderAdapter>().toEqualTypeOf<MainProviderAdapter>();
    const input: StreamChatInput = { requestId: 'q', modelId, messages: [{ role: 'user', content: 'fixture' }], signal: new AbortController().signal, outputTokenLimit: 16 };
    const types: string[] = [];
    for await (const chunk of fixture.streamChat(input)) {
      expect(normalizedChunkSchema.safeParse(chunk).success).toBe(true);
      types.push(chunk.type);
    }
    expect(types).toEqual(['start', 'text_delta', 'reasoning_summary_delta', 'usage', 'finish']);
    expect(normalizedChunkSchema.safeParse({ type: 'error', requestId: 'q', error: publicError('rate_limited') }).success).toBe(true);
    expect(connectionTestResultSchema.safeParse(await fixture.testConnection({ requestId: 'q', level: 'configuration' })).success).toBe(true);
  });
  it.each([
    { type: 'usage', requestId: 'q', inputTokens: -1, outputTokens: 0 },
    { type: 'text_delta', requestId: ' ', text: 'a' },
    { type: 'finish', requestId: 'q', reason: 'unknown' },
    { type: 'error', requestId: 'q', error: { code: 'timeout', message: 'fixture-secret', retryable: true } },
    { type: 'start', requestId: 'q', sdkResponse: { key: 'fixture-secret' } },
  ])('rejects malformed Provider chunks %#', (chunk) => {
    expect(normalizedChunkSchema.safeParse(chunk).success).toBe(false);
  });
  it('rejects credential fields and generation tests without an explicit model', () => {
    expect(streamChatInputSchema.safeParse({ requestId: 'q', modelId: 'mock', messages: [], apiKey: 'fixture-secret' }).success).toBe(false);
    expect(testConnectionInputSchema.safeParse({ requestId: 'q', level: 'generation' }).success).toBe(false);
    expect(testConnectionInputSchema.safeParse({ requestId: 'q', level: 'models' }).success).toBe(false);
  });
  it('reports fixture output limits and abort failures without a completion event', async () => {
    const provider = new MockProvider();
    const chunks = [];
    for await (const chunk of provider.streamChat({ requestId: 'q', modelId: 'mock', messages: [], outputTokenLimit: 1 })) chunks.push(chunk);
    expect(chunks.filter((chunk) => chunk.type === 'text_delta')).toHaveLength(1);
    expect(chunks.at(-2)).toMatchObject({ type: 'usage', outputTokens: 1 });
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: 'length' });
    const controller = new AbortController(); controller.abort();
    await expect(provider.listModels({ requestId: 'q', signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(await provider.testConnection({ requestId: 'q', level: 'configuration', signal: controller.signal })).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    const cancelled = [];
    for await (const chunk of provider.streamChat({ requestId: 'q', modelId: 'mock', messages: [], signal: controller.signal })) cancelled.push(chunk);
    expect(cancelled.at(-1)).toMatchObject({ type: 'error', error: { code: 'cancelled' } });
    expect(cancelled.some((chunk) => chunk.type === 'finish')).toBe(false);
  });
});
