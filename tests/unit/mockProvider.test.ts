import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockProvider } from '../../src/main/providers/mock/MockProvider';
import type { NormalizedChunk, StreamChatInput } from '../../src/main/providers/types';

const input: StreamChatInput = {
  requestId: 'main-request', modelId: 'mock', agentRole: 'Drafter', turnIndex: 0,
  messages: [{ role: 'user', content: 'task' }, { role: 'assistant', content: 'proof' }],
};

async function collect(provider: MockProvider, parameters: StreamChatInput = input): Promise<NormalizedChunk[]> {
  const chunks: NormalizedChunk[] = [];
  for await (const chunk of provider.streamChat(parameters)) chunks.push(chunk);
  return chunks;
}

describe('MockProvider', () => {
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('streams deterministic draft, review, and final responses', async () => {
    const provider = new MockProvider({ tokenDelayMs: 0 });
    const chunks = [] as string[];

    for await (const chunk of provider.streamChat({
      requestId: 'fixture-request', modelId: 'mock', agentRole: 'Drafter',
      turnIndex: 0,
      messages: [],
    })) {
      if (chunk.type === 'text_delta') chunks.push(chunk.text);
    }

    expect(chunks.join('')).toContain('Mock 起草');
  });

  it('honors cancellation without emitting a finish chunk', async () => {
    const provider = new MockProvider({ tokenDelayMs: 1 });
    const controller = new AbortController();
    const types: string[] = [];

    for await (const chunk of provider.streamChat({ requestId: 'fixture-request', modelId: 'mock', agentRole: 'Drafter', turnIndex: 0, messages: [], signal: controller.signal })) {
      types.push(chunk.type);
      if (chunk.type === 'error') expect(chunk.error.code).toBe('cancelled');
      controller.abort();
    }
    expect(types).toContain('error');

    expect(types).toContain('start');
    expect(types).not.toContain('finish');
  });

  it.each([0, 2])('can finish normally after %i deltas', async (stopAfterDeltas) => {
    const chunks = await collect(new MockProvider({ stopAfterDeltas }));
    expect(chunks.filter((chunk) => chunk.type === 'text_delta')).toHaveLength(stopAfterDeltas);
    expect(chunks.at(-2)).toEqual({ type: 'usage', requestId: 'main-request', inputTokens: 9, outputTokens: stopAfterDeltas });
    expect(chunks.at(-1)).toEqual({ type: 'finish', requestId: 'main-request', reason: 'stop' });
    expect(chunks.every((chunk) => chunk.requestId === 'main-request')).toBe(true);
  });

  it.each([0, 2])('fails deterministically after %i deltas without completing', async (errorAfterDeltas) => {
    const chunks = await collect(new MockProvider({ errorAfterDeltas }));
    expect(chunks.filter((chunk) => chunk.type === 'text_delta')).toHaveLength(errorAfterDeltas);
    expect(chunks.at(-1)).toMatchObject({ type: 'error', requestId: 'main-request', error: { code: 'internal_error' } });
    expect(chunks.some((chunk) => chunk.type === 'usage' || chunk.type === 'finish')).toBe(false);
    expect(chunks.every((chunk) => chunk.requestId === 'main-request')).toBe(true);
  });

  it.each([0, 2])('stalls after %i deltas until cancellation', async (stallAfterDeltas) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const iterator = new MockProvider({ stallAfterDeltas }).streamChat({ ...input, signal: controller.signal })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: 'start' });
    for (let index = 0; index < stallAfterDeltas; index += 1) expect((await iterator.next()).value).toMatchObject({ type: 'text_delta' });
    let settled = false;
    const pending = iterator.next().then((result) => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect((await pending).value).toMatchObject({ type: 'error', requestId: 'main-request', error: { code: 'cancelled' } });
    expect(await iterator.next()).toMatchObject({ done: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a long token delay immediately and clears its timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const iterator = new MockProvider({ tokenDelayMs: 60_000 }).streamChat({ ...input, signal: controller.signal })[Symbol.asyncIterator]();
    await iterator.next();
    let settled = false;
    const pending = iterator.next().then((result) => { settled = true; return result; });
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect((await pending).value).toMatchObject({ type: 'error', error: { code: 'cancelled' } });
    expect(await iterator.next()).toMatchObject({ done: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets cancellation win after the delay timer fires before its continuation resumes', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const iterator = new MockProvider({ tokenDelayMs: 10 }).streamChat({ ...input, signal: controller.signal })[Symbol.asyncIterator]();
    await iterator.next();
    const pending = iterator.next();
    vi.advanceTimersByTime(10);
    controller.abort();
    expect((await pending).value).toMatchObject({ type: 'error', error: { code: 'cancelled' } });
    expect(await iterator.next()).toMatchObject({ done: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the emitted partial output when cancelled before the next delta', async () => {
    const controller = new AbortController();
    const chunks: NormalizedChunk[] = [];
    for await (const chunk of new MockProvider().streamChat({ ...input, signal: controller.signal })) {
      chunks.push(chunk);
      if (chunk.type === 'text_delta') controller.abort();
    }
    expect(chunks.map((chunk) => chunk.type)).toEqual(['start', 'text_delta', 'error']);
    expect(chunks.at(-1)).toMatchObject({ error: { code: 'cancelled' } });
  });

  it('lets cancellation win between usage and finish', async () => {
    const controller = new AbortController();
    const chunks: NormalizedChunk[] = [];
    for await (const chunk of new MockProvider().streamChat({ ...input, signal: controller.signal })) {
      chunks.push(chunk);
      if (chunk.type === 'usage') controller.abort();
    }
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: { code: 'cancelled' } });
    expect(chunks.some((chunk) => chunk.type === 'finish')).toBe(false);
  });

  it('applies the output limit in mock estimate units and preserves the actual input', async () => {
    const parameters: StreamChatInput = { ...input, outputTokenLimit: 1 };
    const before = structuredClone(parameters);
    const chunks = await collect(new MockProvider(), parameters);
    expect(chunks.filter((chunk) => chunk.type === 'text_delta')).toHaveLength(1);
    expect(chunks.at(-2)).toEqual({ type: 'usage', requestId: 'main-request', inputTokens: 9, outputTokens: 1 });
    expect(chunks.at(-1)).toEqual({ type: 'finish', requestId: 'main-request', reason: 'length' });
    expect(chunks.every((chunk) => chunk.requestId === parameters.requestId)).toBe(true);
    expect(parameters).toEqual(before);
  });
});
