import { describe, expect, it } from 'vitest';
import { MockProvider } from '../../src/main/providers/mock/MockProvider';

describe('MockProvider', () => {
  it('streams deterministic draft, review, and final responses', async () => {
    const provider = new MockProvider({ tokenDelayMs: 0 });
    const chunks = [] as string[];

    for await (const chunk of provider.streamChat({
      agentRole: 'Drafter',
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

    await expect((async () => {
      for await (const chunk of provider.streamChat({ agentRole: 'Drafter', turnIndex: 0, messages: [], signal: controller.signal })) {
        types.push(chunk.type);
        controller.abort();
      }
    })()).rejects.toThrow(/cancel/i);

    expect(types).toContain('start');
    expect(types).not.toContain('finish');
  });
});
