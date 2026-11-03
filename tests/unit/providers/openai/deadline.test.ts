// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../../../../src/main/providers/openai/OpenAIProvider';
import { configuration, input, collect, sse, chunk } from './fixtures';

afterEach(() => vi.restoreAllMocks());

it('enforces the total deadline while ready SSE heartbeats yield no model data', async () => {
  let now = 0;
  let pulls = 0;
  let cancelled = false;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const heartbeat = new TextEncoder().encode(': heartbeat\n\n');
  const provider = new OpenAIProvider({
    configuration, confirmedBaseUrl: 'https://api.openai.com/v1',
    resolveKey: async () => 'fixture-deadline-key', timeoutMs: 100,
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        now += 10;
        if (++pulls === 100) controller.close();
        else controller.enqueue(heartbeat);
      },
      cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'text/event-stream' } }),
  });

  const events = await collect(provider.streamChat(input));

  expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'timeout' } });
  expect(events.filter(event => event.type === 'finish')).toEqual([]);
  expect(pulls).toBeLessThan(100);
  expect(cancelled).toBe(true);
});

describe('D135 a generation stream has its own total', () => {
  it('lets a slow stream run past the list timeout when a longer stream timeout is given', async () => {
    const provider = new OpenAIProvider({ configuration, confirmedBaseUrl: 'https://api.openai.com/v1', resolveKey: async () => 'owned-fake-key', timeoutMs: 5, streamTimeoutMs: 5000,
      fetch: async () => { await new Promise(resolve => setTimeout(resolve, 30)); return sse(chunk('好'), chunk(null, 'stop'), '[DONE]'); } });
    const events = await collect(provider.streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'finish', reason: 'stop' });
  });
  it('still stops at the stream timeout', async () => {
    const provider = new OpenAIProvider({ configuration, confirmedBaseUrl: 'https://api.openai.com/v1', resolveKey: async () => 'owned-fake-key', timeoutMs: 5000, streamTimeoutMs: 5,
      fetch: async (_url, init) => new Promise((_, reject) => { init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)); }) });
    expect((await collect(provider.streamChat(input))).at(-1)).toMatchObject({ type: 'error', error: { code: 'timeout' } });
  });
});
