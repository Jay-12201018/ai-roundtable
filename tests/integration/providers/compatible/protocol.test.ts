// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../../src/main/database/Database';
import { RunService } from '../../../../src/main/services/RunService';
import { CompatibleProvider } from '../../../../src/main/providers/compatible/CompatibleProvider';
import { runEventSchema } from '../../../../src/shared/schemas/run';
import { configuration, input, chunk, sse, collect } from '../../../unit/providers/compatible/fixtures';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('R02 protocol consumption with isolated HTTP fixtures', () => {
  it('persists normalized text/usage under the Main request id', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('No external network allowed'); });
    const database = new Database(':memory:'); database.initialize();
    const bodies: Array<Record<string, unknown>> = [];
    const options = { configuration: { ...configuration, baseUrl: 'http://127.0.0.1:1234/v1' },
      confirmedBaseUrl: 'http://127.0.0.1:1234/v1',
      resolveKey: async () => 'fixture-only', fetch: (async (_url, init) => {
        bodies.push(JSON.parse(init!.body as string));
        return sse(chunk('fixture你好'), chunk(null, 'stop'), { choices: [], usage: { prompt_tokens: 8, completion_tokens: 2 } }, '[DONE]');
      }) as typeof fetch };
    const provider = new CompatibleProvider({ ...options,
      capabilities: { streamUsage: false, listModels: false, authentication: 'unsupported' } });
    // Demo's model=mock is a declared HTTP fixture model; production real-provider gates stay enabled.
    const service = new RunService(database, provider, run => [{ role: 'system', content: 'trusted member prompt' }, { role: 'user', content: run.task! }]);
    try {
      const run = await service.start({ roomId: service.createDemoRoom('fixture'), task: 'public task', workflowSnapshot: {}, maxTurns: 1, outputTokenLimit: 25 });
      await service.waitForIdle(run.runId);
      const stored = database.readRunSnapshot(run.runId);
      expect(stored.run.status).toBe('completed');
      expect(stored.messages.map(m => [m.content, m.status])).toEqual([['fixture你好', 'completed']]);
      expect(stored.attempts).toHaveLength(1); expect(stored.attempts[0].status).toBe('completed');
      expect(bodies).toEqual([{ model: 'mock', stream: true, messages: [{ role: 'system', content: 'trusted member prompt' }, { role: 'user', content: 'public task' }],
        max_tokens: 25 }]);
      const subscription = service.subscribe(run.runId, 0);
      expect(subscription.resyncRequired).toBe(false);
      const events = subscription.events;
      expect(events).toHaveLength(database.listRunEvents(run.runId, 0).length);
      for (const event of events) expect(runEventSchema.safeParse(event).success).toBe(true);
      expect(events.find(e => e.type === 'text_delta')).toMatchObject({ requestId: stored.attempts[0].requestId });
      expect(events.find(e => e.type === 'usage_updated')).toMatchObject({ payload: { inputTokens: 8, outputTokens: 2 } });
      expect(JSON.stringify(events)).not.toContain('fixture-only');
    } finally { await service.shutdown(); database.close(); }
  });

  it.each(['disconnect', 'timeout', 'stop'] as const)('retains persisted partial and one attempt on %s', async mode => {
    const database = new Database(':memory:'); database.initialize();
    let networkSignal: AbortSignal | null | undefined; let calls = 0;
    const provider = new CompatibleProvider({ configuration, confirmedBaseUrl: 'https://service.example/v1', resolveKey: async () => 'fixture-only', timeoutMs: mode === 'timeout' ? 30 : 1000,
      fetch: async (_url, init) => {
        calls++; networkSignal = init?.signal;
        return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk('persisted partial'))}\n\n`));
          if (mode === 'disconnect') controller.close();
        } }), { headers: { 'content-type': 'text/event-stream' } });
      } });
    const service = new RunService(database, provider);
    const dispose = service.onEvent(event => { if (mode === 'stop' && event.type === 'text_delta') void service.stop(event.runId); });
    try {
      const run = await service.start({ roomId: service.createDemoRoom('fixture'), task: 'task', workflowSnapshot: {}, maxTurns: 1 });
      await service.waitForIdle(run.runId);
      const stored = database.readRunSnapshot(run.runId);
      expect(stored.messages[0].content).toBe('persisted partial');
      expect(stored.turns[0].partialContent).toBe('persisted partial');
      expect(stored.messages[0].status).toBe(mode === 'disconnect' ? 'failed' : 'aborted');
      expect(stored.attempts).toHaveLength(1); expect(calls).toBe(1); expect(networkSignal?.aborted).toBe(true);
      expect(stored.run.status).toBe(mode === 'stop' ? 'cancelled' : 'error');
      expect(database.listRunEvents(run.runId, 0).filter(e => e.type === 'turn_completed')).toHaveLength(0);
    } finally { dispose(); await service.shutdown(); database.close(); }
  });

  it('closes the body when a consumer ends iteration early', async () => {
    let cancelled = false;
    const provider = new CompatibleProvider({ configuration, confirmedBaseUrl: 'https://service.example/v1', resolveKey: async () => 'fixture-only',
      fetch: async () => new Response(new ReadableStream({ start(c) {
        c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk('partial'))}\n\n`));
      }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }) });
    for await (const event of provider.streamChat(input)) if (event.type === 'text_delta') break;
    expect(cancelled).toBe(true);
  });

  it('rejects a redirect without contacting another endpoint or leaking error bytes', async () => {
    let cancelled = false;
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 307,
      headers: { location: 'https://unconfirmed.invalid/fixture-secret' } }));
    const provider = new CompatibleProvider({ configuration, confirmedBaseUrl: 'https://service.example/v1', resolveKey: async () => 'fixture-only', fetch: fetcher });
    const events = await collect(provider.streamChat(input));
    expect(events).toEqual([{ type: 'error', requestId: input.requestId, error: { code: 'invalid_response', message: 'Invalid response; refresh the run snapshot', retryable: false } }]);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(cancelled).toBe(true);
    expect(JSON.stringify(events)).not.toContain('unconfirmed');
  });
});
