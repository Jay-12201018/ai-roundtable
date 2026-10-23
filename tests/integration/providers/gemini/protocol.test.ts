// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../../src/main/database/Database';
import { RunService } from '../../../../src/main/services/RunService';
import { GeminiProvider } from '../../../../src/main/providers/gemini/GeminiProvider';
import { runEventSchema } from '../../../../src/shared/schemas/run';

const configuration = {
  id: 'gemini-fixture', name: 'Gemini fixture', kind: 'gemini' as const, baseUrl: null,
  enabled: true, isDefault: false, defaultModelId: null, customModels: [], keyReference: null,
  createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
};
const options = { configuration, confirmedBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', resolveKey: async () => 'fixture-only' };
const candidate = (text: string, finishReason?: string) => ({ candidates: [{ index: 0,
  content: { role: 'model', parts: [{ text }] }, ...(finishReason ? { finishReason } : {}),
}] });
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const sse = (...values: unknown[]) => new Response(values.map(frame).join(''), { headers: { 'content-type': 'text/event-stream' } });

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('External network is forbidden in Gemini fixtures'); }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Gemini native fixtures consumed by the existing RunService protocol', () => {
  it('persists public parts and one final cumulative usage with the Main request identity', async () => {
    const database = new Database(':memory:'); database.initialize();
    const bodies: Record<string, unknown>[] = [];
    const targets: string[] = [];
    const provider = new GeminiProvider({ ...options, fetch: async (url, init) => {
      targets.push(String(url)); bodies.push(JSON.parse(init!.body as string));
      return sse({ responseId: 'provider-response-id', candidates: [{ index: 0, content: { role: 'model', parts: [
        { text: 'private thought fixture', thought: true }, { text: '你好' }, { text: '🙂' },
      ] } }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 1, thoughtsTokenCount: 1 } },
      { ...candidate(' done', 'STOP'), usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 2, thoughtsTokenCount: 3 } });
    } });
    // Demo's mock model is an explicitly injected native-HTTP fixture; production Provider gates remain intact.
    const service = new RunService(database, provider, run => [
      { role: 'system', content: 'trusted member prompt' }, { role: 'user', content: run.task! },
      { role: 'assistant', content: 'prior reply' }, { role: 'user', content: 'continue' },
    ]);
    try {
      const run = await service.start({ roomId: service.createDemoRoom('fixture'), task: 'public task', workflowSnapshot: {}, maxTurns: 1, outputTokenLimit: 25 });
      await service.waitForIdle(run.runId);
      const stored = database.readRunSnapshot(run.runId);
      expect(stored.run.status).toBe('completed');
      expect(stored.messages.map(message => [message.content, message.status])).toEqual([['你好🙂 done', 'completed']]);
      expect(stored.attempts).toHaveLength(1);
      expect(stored.attempts[0]).toMatchObject({ status: 'completed', providerRequestId: 'provider-response-id' });
      expect(targets).toEqual(['https://generativelanguage.googleapis.com/v1beta/models/mock:streamGenerateContent?alt=sse']);
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toMatchObject({ systemInstruction: { parts: [{ text: 'trusted member prompt' }] },
        contents: [{ role: 'user', parts: [{ text: 'public task' }] }, { role: 'model', parts: [{ text: 'prior reply' }] },
          { role: 'user', parts: [{ text: 'continue' }] }], generationConfig: { maxOutputTokens: 25, candidateCount: 1 } });
      const subscription = service.subscribe(run.runId, 0);
      expect(subscription.resyncRequired).toBe(false);
      expect(subscription.events).toHaveLength(database.listRunEvents(run.runId, 0).length);
      for (const event of subscription.events) expect(runEventSchema.safeParse(event).success).toBe(true);
      const usage = subscription.events.filter(event => event.type === 'usage_updated');
      expect(usage).toHaveLength(1);
      expect(usage[0]).toMatchObject({ requestId: stored.attempts[0].requestId, payload: { inputTokens: 11, outputTokens: 5 } });
      expect(subscription.events.find(event => event.type === 'text_delta')).toMatchObject({ requestId: stored.attempts[0].requestId });
      const evidence = JSON.stringify({ stored, events: subscription.events, bodies });
      expect(evidence).not.toContain('private thought fixture');
      expect(evidence).not.toContain('fixture-only');
      expect(subscription.events.some(event => event.type === 'reasoning_summary_delta')).toBe(false);
    } finally { await service.shutdown(); database.close(); }
  });

  it('keeps MAX_TOKENS as a completed, truncated reply and goes on to the next member (D102)', async () => {
    const database = new Database(':memory:'); database.initialize();
    const fetcher = vi.fn(async () => sse(candidate('retained partial'), candidate('', 'MAX_TOKENS')));
    const service = new RunService(database, new GeminiProvider({ ...options, fetch: fetcher }));
    try {
      const run = await service.start({ roomId: service.createDemoRoom('fixture'), task: 'task', workflowSnapshot: {}, maxTurns: 2, outputTokenLimit: 25 });
      await service.waitForIdle(run.runId);
      const stored = database.readRunSnapshot(run.runId);
      expect(stored.run.status).toBe('completed');
      expect(stored.messages.map(message => [message.content, message.status])).toEqual([['retained partial', 'completed'], ['retained partial', 'completed']]);
      expect(stored.attempts.map(attempt => [attempt.status, attempt.finishReason])).toEqual([['completed', 'length'], ['completed', 'length']]);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(database.listRunEvents(run.runId, 0).filter(event => event.type === 'turn_failed')).toHaveLength(0);
    } finally { await service.shutdown(); database.close(); }
  });

  it.each(['SAFETY'])('retains partial as failed evidence on %s without scheduling a retry', async finishReason => {
    const database = new Database(':memory:'); database.initialize();
    const fetcher = vi.fn(async () => sse(candidate('retained partial'), candidate('', finishReason)));
    const service = new RunService(database, new GeminiProvider({ ...options, fetch: fetcher }));
    try {
      const run = await service.start({ roomId: service.createDemoRoom('fixture'), task: 'task', workflowSnapshot: {}, maxTurns: 2, outputTokenLimit: 25 });
      await service.waitForIdle(run.runId);
      const stored = database.readRunSnapshot(run.runId);
      expect(stored.run.status).toBe('error');
      expect(stored.messages.map(message => [message.content, message.status])).toEqual([['retained partial', 'failed']]);
      expect(stored.turns[0].partialContent).toBe('retained partial');
      expect(stored.attempts).toHaveLength(1);
      expect(stored.attempts[0].status).toBe('failed');
      expect(fetcher).toHaveBeenCalledTimes(1);
      const events = database.listRunEvents(run.runId, 0);
      expect(events.filter(event => event.type === 'turn_completed')).toHaveLength(0);
      expect(events.filter(event => event.type === 'turn_failed')).toHaveLength(1);
    } finally { await service.shutdown(); database.close(); }
  });

  it('does not report a blocked empty prompt response as successful generation', async () => {
    const database = new Database(':memory:'); database.initialize();
    const fetcher = vi.fn(async () => sse({ candidates: [], promptFeedback: { blockReason: 'SAFETY' } }));
    const service = new RunService(database, new GeminiProvider({ ...options, fetch: fetcher }));
    try {
      const run = await service.start({ roomId: service.createDemoRoom('fixture'), task: 'task', workflowSnapshot: {}, maxTurns: 1, outputTokenLimit: 25 });
      await service.waitForIdle(run.runId);
      const stored = database.readRunSnapshot(run.runId);
      expect(stored.run.status).toBe('error');
      expect(stored.messages.map(message => [message.content, message.status])).toEqual([['', 'failed']]);
      expect(stored.attempts).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(database.listRunEvents(run.runId, 0).filter(event => event.type === 'turn_completed')).toHaveLength(0);
    } finally { await service.shutdown(); database.close(); }
  });

  it.each(['disconnect', 'timeout', 'stop'] as const)('retains persisted partial and one attempt on %s', async mode => {
    const database = new Database(':memory:'); database.initialize();
    let networkSignal: AbortSignal | null | undefined;
    let cancelled = false;
    const fetcher = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      networkSignal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode(frame(candidate('persisted partial'))));
        if (mode === 'disconnect') controller.close();
      }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    });
    const provider = new GeminiProvider({ ...options, fetch: fetcher, timeoutMs: mode === 'timeout' ? 50 : 1000 });
    const service = new RunService(database, provider);
    const dispose = service.onEvent(event => { if (mode === 'stop' && event.type === 'text_delta') void service.stop(event.runId); });
    try {
      const run = await service.start({ roomId: service.createDemoRoom('fixture'), task: 'task', workflowSnapshot: {}, maxTurns: 2, outputTokenLimit: 25 });
      await service.waitForIdle(run.runId);
      const stored = database.readRunSnapshot(run.runId);
      expect(stored.messages[0].content).toBe('persisted partial');
      expect(stored.turns[0].partialContent).toBe('persisted partial');
      expect(stored.messages[0].status).toBe(mode === 'disconnect' ? 'failed' : 'aborted');
      expect(stored.attempts).toHaveLength(1);
      expect(stored.attempts[0].status).toBe(mode === 'disconnect' ? 'failed' : 'aborted');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(networkSignal?.aborted).toBe(true);
      if (mode !== 'disconnect') expect(cancelled).toBe(true);
      expect(stored.run.status).toBe(mode === 'stop' ? 'cancelled' : 'error');
      const events = database.listRunEvents(run.runId, 0);
      expect(events.filter(event => event.type === 'turn_completed')).toHaveLength(0);
      const failure = events.find(event => event.type === (mode === 'disconnect' ? 'turn_failed' : 'turn_aborted'));
      expect(failure).toMatchObject({ payload: { error: { code: mode === 'disconnect' ? 'invalid_response' : mode === 'stop' ? 'cancelled' : 'timeout' } } });
    } finally { dispose(); await service.shutdown(); database.close(); }
  });
});
