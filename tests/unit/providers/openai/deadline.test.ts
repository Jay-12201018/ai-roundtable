// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../../../../src/main/providers/openai/OpenAIProvider';
import { configuration, input, collect } from './fixtures';

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
