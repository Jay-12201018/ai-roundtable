import { vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { RunService } from '../../../src/main/services/RunService';
import { HostService } from '../../../src/main/host/HostService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import type { HostCommand } from '../../../src/shared/schemas/host';

export type Mode = 'ok' | 'no-usage' | 'hang' | 'network';
const cleanup: Array<() => unknown> = [];
export async function closeR13bFixtures() { vi.restoreAllMocks(); for (const f of cleanup.splice(0).reverse()) await f(); }

function sse(events: unknown[], done = true) {
  return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : ''), { headers: { 'content-type': 'text/event-stream' } });
}

/**
 * A DeepSeek Run against an owned fetch: the real registry, usage records and context builder and scripted usage (300 prompt tokens, 6 completion tokens, optionally with a cache split).
 */
export async function deepSeekFixture(options: { modes?: Mode[]; cacheHit?: number; filename?: string; members?: Array<{ name: string; role: string }>;
  /** R14: the reply text for a request, instead of the default scripted text. */ reply?: (body: Record<string, unknown>) => string | undefined } = {}) {
  const db = new Database(options.filename ?? ':memory:');
  await db.initialize();
  db.createRoom({ id: 'room', name: '用量房间' });
  db.createProvider({ id: 'deepseek', name: 'DeepSeek 直连', kind: 'compatible', baseUrl: 'https://api.deepseek.com', customModels: [{ id: 'deepseek-flash', name: 'deepseek-flash' }] });
  const keys = new KeyService(db, createMemoryKeyBackend());
  await keys.storeKey('deepseek', 'owned-fake-deepseek-key');
  const modes = [...(options.modes ?? [])];
  const bodies: Array<Record<string, unknown>> = [];
  let release!: () => void; const hanging = new Promise<void>(resolve => { release = resolve; });
  const transport = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
    bodies.push(body);
    const mode = modes.shift() ?? 'ok';
    const summary = (body.messages as Array<{ content: string }>).some(message => message.content.includes('【请写摘要】'));
    const text = { choices: [{ index: 0, delta: { content: options.reply?.(body) ?? (summary ? `摘要正文-${bodies.length}` : `公开回复-${bodies.length}`) }, finish_reason: null }] };
    const stop = { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
    const split = options.cacheHit === undefined ? {} : { prompt_cache_hit_tokens: options.cacheHit, prompt_cache_miss_tokens: 300 - options.cacheHit };
    if (mode === 'hang') {
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(text)}\n\n`)); void hanging; } }), { headers: { 'content-type': 'text/event-stream' } });
    }
    if (mode === 'no-usage') return sse([text, stop]);
    // R14 (D125): the connection drops after the request left; the body never arrives.
    if (mode === 'network') throw new TypeError('fetch failed');
    return sse([text, stop, { choices: [], usage: { prompt_tokens: 300, completion_tokens: 6, ...split } }]);
  });
  const registry = new ProviderRegistry(db, keys, { transportFactory: guard => async (url, init) => { guard(); return transport(url, init); } });
  const people = options.members ?? [{ name: '起草者', role: '起草' }, { name: '审查者', role: '审查' }, { name: '综合者', role: '综合' }];
  people.forEach((member, index) => db.createAgent({ id: `a${index}`, roomId: 'room', displayName: member.name, roleTemplateId: member.role, systemPrompt: '', providerId: 'deepseek', modelId: 'deepseek-flash', displayOrder: index }));
  const budgetOf = (member: { providerId: string | null; modelId: string | null }) => member.providerId ? registry.budget(member.providerId, member.modelId!) : undefined;
  const run = new RunService(db, new MockProvider(), createPublicMessagesBuilder((_model, member) => budgetOf(member)), registry, member => budgetOf(member));
  const host = new HostService(db, run);
  // Reversed on cleanup: stop the Run service first, then close its database.
  cleanup.push(() => db.close(), () => { release(); return run.shutdown(); });
  let counter = 0;
  const command = (input: Record<string, unknown>) => host.command({ clientRequestId: `client-${++counter}`, ...input } as HostCommand);
  const start = (extra: Record<string, unknown> = {}) => run.start({ roomId: 'room', task: '设计一个校园跑腿平台', workflowSnapshot: {}, maxTurns: 2, outputTokenLimit: 256, ...extra });
  return { db, keys, registry, run, host, command, start, transport, bodies, release };
}
export type R13bFixture = Awaited<ReturnType<typeof deepSeekFixture>>;

/** Waits until a summary request of the Run has left `generating`. */
export async function summaryDone(f: R13bFixture, runId: string) {
  await vi.waitFor(() => {
    const requests = f.run.getSnapshot(runId).summaries?.flatMap(summary => summary.requests) ?? [];
    if (!requests.length || requests.some(request => request.status === 'generating')) throw new Error('summary still generating');
  });
  await f.run.waitForIdle(runId);
}
