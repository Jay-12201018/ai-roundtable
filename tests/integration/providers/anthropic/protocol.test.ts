// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../../src/main/database/Database';
import { RunService } from '../../../../src/main/services/RunService';
import { AnthropicProvider, buildAnthropicMessages } from '../../../../src/main/providers/anthropic/AnthropicProvider';
import { runEventSchema } from '../../../../src/shared/schemas/run';
import { configuration, fakeKey, response, success, start, blockStart, text, frame } from '../../../unit/providers/anthropic/fixtures';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Anthropic consumes the existing Main protocol with isolated fixtures', () => {
  it('persists normalized text, cumulative usage and vendor request header under the Main request id', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('No external network allowed'); });
    const database = new Database(':memory:'); database.initialize();
    const bodies: unknown[] = [];
    const provider = new AnthropicProvider({ configuration, confirmedBaseUrl: 'https://api.anthropic.com', resolveKey: async () => fakeKey,
      fetch: async (_url, init) => { bodies.push(JSON.parse(init!.body as string)); return response(success('fixture你好'), { headers: { 'request-id': 'vendor-request' } }); } });
    // Demo's mock ID is only an injected fixture model; this does not alter production Registry gates.
    const service = new RunService(database, provider, run => [{ role: 'system', content: 'trusted instructions' }, { role: 'user', content: run.task! }]);
    try {
      const run = await service.start({ roomId: service.createDemoRoom('fixture'), task: 'public task', workflowSnapshot: {}, maxTurns: 1, outputTokenLimit: 25 });
      await service.waitForIdle(run.runId);
      const stored = database.readRunSnapshot(run.runId);
      expect(stored.run.status).toBe('completed');
      expect(stored.messages.map(m => [m.content, m.status])).toEqual([['fixture你好', 'completed']]);
      expect(stored.attempts).toHaveLength(1);
      expect(stored.attempts[0]).toMatchObject({ status: 'completed', providerRequestId: 'vendor-request' });
      expect(stored.attempts[0].inputSnapshot).not.toBeNull();
      expect(bodies).toEqual([{ model: 'mock', ...buildAnthropicMessages(stored.attempts[0].inputSnapshot!.messages), stream: true, max_tokens: 25 }]);
      const events = service.subscribe(run.runId, 0).events;
      for (const event of events) expect(runEventSchema.safeParse(event).success).toBe(true);
      expect(events.find(e => e.type === 'text_delta')).toMatchObject({ requestId: stored.attempts[0].requestId });
      expect(events.find(e => e.type === 'usage_updated')).toMatchObject({ payload: { inputTokens: 7, outputTokens: 3 } });
      expect(JSON.stringify(events)).not.toContain(fakeKey);
    } finally { await service.shutdown(); database.close(); }
  });

  it.each(['disconnect', 'timeout', 'stop'] as const)('retains partial text and one attempt on %s', async mode => {
    vi.stubGlobal('fetch', () => { throw new Error('No external network allowed'); });
    const database = new Database(':memory:'); database.initialize();
    let calls = 0; let signal: AbortSignal | null | undefined;
    const provider = new AnthropicProvider({ configuration, confirmedBaseUrl: 'https://api.anthropic.com', resolveKey: async () => fakeKey,
      timeoutMs: mode === 'timeout' ? 40 : 1000, fetch: async (_url, init) => {
        calls++; signal = init?.signal;
        return new Response(new ReadableStream<Uint8Array>({ start(c) {
          c.enqueue(new TextEncoder().encode([start(), blockStart(), text('retained partial')].map(e => frame(e)).join('')));
          if (mode === 'disconnect') c.close();
        } }), { headers: { 'content-type': 'text/event-stream' } });
      } });
    const service = new RunService(database, provider);
    const dispose = service.onEvent(event => { if (mode === 'stop' && event.type === 'text_delta') void service.stop(event.runId); });
    try {
      const run = await service.start({ roomId: service.createDemoRoom('fixture'), task: 'task', workflowSnapshot: {}, maxTurns: 1 });
      await service.waitForIdle(run.runId);
      const stored = database.readRunSnapshot(run.runId);
      expect(stored.messages[0].content).toBe('retained partial');
      expect(stored.turns[0].partialContent).toBe('retained partial');
      expect(stored.messages[0].status).toBe(mode === 'disconnect' ? 'failed' : 'aborted');
      expect(stored.attempts).toHaveLength(1); expect(calls).toBe(1); expect(signal?.aborted).toBe(true);
      expect(stored.run.status).toBe(mode === 'stop' ? 'cancelled' : 'error');
      expect(database.listRunEvents(run.runId, 0).filter(e => e.type === 'turn_completed')).toEqual([]);
    } finally { dispose(); await service.shutdown(); database.close(); }
  });
});
