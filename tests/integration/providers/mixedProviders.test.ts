// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { UsageService } from '../../../src/main/usage/UsageService';
import type { ModelTokenCounter } from '../../../src/main/context/types';

type Seen = { url: string; body: Record<string, any>; headers: Headers };
const cleanup: Array<() => unknown> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });

const stream = (text: string, usage: Record<string, unknown>) => new Response([
  { choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage },
].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

const services = [
  { id: 'ds', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', name: 'DeepSeek', reply: 'DeepSeek 的审计意见', usage: { prompt_tokens: 30, completion_tokens: 3, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 20 } },
  { id: 'qw', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.7-plus', name: '通义千问', reply: '通义千问的审计意见', usage: { prompt_tokens: 20, completion_tokens: 2 } },
  { id: 'gl', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3', name: '智谱 GLM', reply: '智谱的审计意见', usage: { prompt_tokens: 40, completion_tokens: 12 } },
  { id: 'cu', baseUrl: 'https://models.example/v1', model: 'company-model', name: '公司模型', reply: '公司模型的审计意见', usage: { prompt_tokens: 50, completion_tokens: 5 } },
] as const;

/** Real registry, adapters, RunService, context builder and usage records; only the wire is an owned fixture. */
async function fixture(members: ReadonlyArray<typeof services[number]['id']>) {
  const db = new Database(':memory:'); await db.initialize();
  db.createRoom({ id: 'room', name: '交叉审计' });
  const keys = new KeyService(db, createMemoryKeyBackend());
  const seen: Seen[] = [];
  const send = async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(url, init); const body = await request.clone().json() as Record<string, any>;
    seen.push({ url: request.url, body, headers: request.headers });
    const service = services.find(item => request.url.startsWith(item.baseUrl))!;
    return stream(service.reply, service.usage);
  };
  for (const service of services) {
    db.createProvider({ id: service.id, name: service.name, kind: 'compatible', baseUrl: service.baseUrl, customModels: [{ id: service.model, name: service.model }] });
    await keys.storeKey(service.id, `owned-fake-${service.id}-key`);
  }
  const registry = new ProviderRegistry(db, keys, { transportFactory: guard => async (url, init) => { guard(); return send(url, init); } });
  members.forEach((id, index) => db.createAgent({ id: `a-${id}`, roomId: 'room', displayName: `成员${index + 1}`, roleTemplateId: ['起草', '审查', '综合'][index] ?? '审查', systemPrompt: '',
    providerId: id, modelId: services.find(service => service.id === id)!.model, displayOrder: index }));
  const budgetOf = (member: { providerId: string | null; modelId: string | null }) => member.providerId ? registry.budget(member.providerId, member.modelId!) : undefined;
  const run = new RunService(db, new MockProvider(), createPublicMessagesBuilder((_model, member) => budgetOf(member)), registry, member => budgetOf(member));
  cleanup.push(() => db.close(), () => run.shutdown());
  return { db, keys, registry, run, seen };
}

const textOf = (seen: Seen) => JSON.stringify(seen.body.messages);

describe('one discussion across several services through the one adapter (D134, D143)', () => {
  it('a limit left at the default follows the model setting; one the host set stays the lower of the two', async () => {
    const f = await fixture(['cu']);
    const update = (model: Record<string, unknown>) => f.db.updateProvider({ id: 'cu', name: '公司模型', kind: 'compatible', baseUrl: 'https://models.example/v1', customModels: [{ id: 'company-model', name: 'company-model', ...model }] });
    update({ maxOutputTokens: 16000 });
    for (const outputTokenLimit of [undefined, 2000]) {
      const started = await f.run.start({ roomId: 'room', task: '看上限', workflowSnapshot: {}, maxTurns: 1, ...(outputTokenLimit ? { outputTokenLimit } : {}) });
      await f.run.waitForIdle(started.runId);
    }
    expect(f.seen.map(seen => seen.body.max_tokens)).toEqual([16000, 2000]);
    // A maximum as large as the whole context still leaves half of it for the discussion.
    update({ contextWindowTokens: 100000, maxOutputTokens: 100000 });
    const started = await f.run.start({ roomId: 'room', task: '看上限', workflowSnapshot: {}, maxTurns: 1 });
    await f.run.waitForIdle(started.runId);
    expect(f.run.getSnapshot(started.runId).status).toBe('completed');
    expect(f.seen.at(-1)!.body.max_tokens).toBe(50000);
  });

  it('each member reaches its own service with its own Key and model, in the same request shape, and reads the others as public text', async () => {
    const f = await fixture(['ds', 'qw', 'gl', 'cu']);
    const started = await f.run.start({ roomId: 'room', task: '交叉审计这份方案', workflowSnapshot: {}, maxTurns: 4 });
    await f.run.waitForIdle(started.runId);
    const snapshot = f.run.getSnapshot(started.runId);
    expect(snapshot.status).toBe('completed');
    expect(snapshot.messages.map(message => message.content)).toEqual(services.map(service => service.reply));
    for (const [index, service] of services.entries()) {
      const request = f.seen[index];
      expect(request.url).toBe(`${service.baseUrl}/chat/completions`);
      expect(Object.keys(request.body).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream', 'stream_options']);
      expect(request.body).toMatchObject({ model: service.model, stream: true, max_tokens: 8192, stream_options: { include_usage: true } });
      expect(request.headers.get('authorization')).toBe(`Bearer owned-fake-${service.id}-key`);
    }
    // D095: the other members' words are quoted public text on the user side, whatever service said them.
    const last = f.seen.at(-1)!;
    for (const service of services.slice(0, 3)) expect(textOf(last)).toContain(service.reply);
    expect(textOf(last)).toContain('【成员「成员1」');
    // Nobody's Key travels with anyone else's request.
    for (const request of f.seen) for (const service of services) expect(JSON.stringify(request.body)).not.toContain(`owned-fake-${service.id}-key`);
  });

  it('records each member\'s tokens under its own service and model, with no amount anywhere', async () => {
    const f = await fixture(['ds', 'qw', 'gl', 'cu']);
    const started = await f.run.start({ roomId: 'room', task: '交叉审计', workflowSnapshot: {}, maxTurns: 4 });
    await f.run.waitForIdle(started.runId);
    const report = new UsageService(f.db, 'UTC').getReport();
    const row = (model: string) => report.byModel.find(item => item.modelId === model)!;
    expect(row('deepseek-v4-pro')).toMatchObject({ providerName: 'DeepSeek', inputTokens: 30, outputTokens: 3, cacheHitTokens: 10, reportedRequests: 1 });
    expect(row('qwen3.7-plus')).toMatchObject({ providerName: '通义千问', inputTokens: 20, outputTokens: 2 });
    expect(row('glm-5.3')).toMatchObject({ providerName: '智谱 GLM', inputTokens: 40, outputTokens: 12 });
    expect(row('company-model')).toMatchObject({ providerName: '公司模型', reportedRequests: 1 });
    expect(report.totals.requests).toBe(4);
    const csv = new UsageService(f.db, 'UTC').csv().text;
    expect(csv).not.toMatch(/金额|单价|¥|元/u);
    expect(JSON.stringify(report)).not.toMatch(/Micro|cost|price/iu);
    expect(f.run.getSnapshot(started.runId).usage).toHaveLength(4);
  });

  it('a member whose model takes less output is clamped, without stopping the others (D134)', async () => {
    const f = await fixture(['ds', 'cu']);
    f.db.updateProvider({ id: 'cu', name: '公司模型', kind: 'compatible', baseUrl: 'https://models.example/v1', customModels: [{ id: 'company-model', name: 'company-model', maxOutputTokens: 2000 }] });
    await f.keys.storeKey('cu', 'owned-fake-cu-key');
    const started = await f.run.start({ roomId: 'room', task: '夹紧', workflowSnapshot: {}, maxTurns: 2, outputTokenLimit: 16000 });
    await f.run.waitForIdle(started.runId);
    expect(f.run.getSnapshot(started.runId).status).toBe('completed');
    expect(f.seen[0].body.max_tokens).toBe(8192);
    expect(f.seen[1].body.max_tokens).toBe(2000);
  });

  it('shows what a service says about an over-long request honestly and does not resend it', async () => {
    const f = await fixture(['ds']);
    const db = f.db; const keys = f.keys;
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'secret-body-text context_length_exceeded', code: 'context_length_exceeded' } }), { status: 400 }));
    const registry = new ProviderRegistry(db, keys, { transportFactory: guard => async () => { guard(); return bad(); } });
    const budgetOf = (member: { providerId: string | null; modelId: string | null }) => member.providerId ? registry.budget(member.providerId, member.modelId!) : undefined;
    const run = new RunService(db, new MockProvider(), createPublicMessagesBuilder((_model, member) => budgetOf(member)), registry, member => budgetOf(member));
    cleanup.push(() => run.shutdown());
    const started = await run.start({ roomId: 'room', task: '太长', workflowSnapshot: {}, maxTurns: 1 });
    await run.waitForIdle(started.runId);
    const snapshot = run.getSnapshot(started.runId);
    expect(snapshot.status).toBe('error');
    expect(bad).toHaveBeenCalledTimes(1);
    expect(snapshot.usage).toEqual([expect.objectContaining({ state: 'unknown', inputTokens: null })]);
    const failed = db.listRunEvents(started.runId, 0).find(event => event.type === 'turn_failed');
    expect(failed?.payload).toMatchObject({ error: { code: 'invalid_input' } });
    expect(JSON.stringify(snapshot)).not.toContain('secret-body-text');
  });
});

describe('the input bound and counters do not depend on any name (D134)', () => {
  it('counts the same request the same for every service', async () => {
    const f = await fixture(['ds']);
    const message = [{ role: 'user' as const, content: '你好 world' }];
    const counts = services.map(service => (f.registry.budget(service.id, service.model).counter as ModelTokenCounter).countMessages(message));
    expect(new Set(counts)).toEqual(new Set([512 + 32 + Buffer.byteLength('你好 world')]));
    for (const service of services) expect(f.registry.budget(service.id, service.model)).toMatchObject({ contextWindowTokens: 128000, maxOutputTokens: 8192 });
  });
});
