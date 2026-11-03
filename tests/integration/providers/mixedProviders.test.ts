// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { UsageService } from '../../../src/main/usage/UsageService';
import { response as anthropicResponse, success } from '../../unit/providers/anthropic/fixtures';
import { sse as geminiSse, chunk as geminiChunk } from '../../unit/providers/gemini/fixtures';
import type { ModelTokenCounter } from '../../../src/main/context/types';

type Seen = { url: string; body: Record<string, any>; headers: Headers };
const cleanup: Array<() => unknown> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });

const openAiStream = (text: string, usage: Record<string, unknown>) => new Response([
  { choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage },
].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

const services = [
  { id: 'ds', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', name: 'DeepSeek' },
  { id: 'oa', kind: 'openai', baseUrl: null, target: 'https://api.openai.com/v1', model: 'gpt-6-astra', name: 'OpenAI' },
  { id: 'an', kind: 'anthropic', baseUrl: null, target: 'https://api.anthropic.com', model: 'claude-opus-5-5', name: 'Anthropic' },
  { id: 'ge', kind: 'gemini', baseUrl: null, target: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.8-flash', name: 'Gemini' },
  { id: 'km', kind: 'openai-compatible', baseUrl: 'https://kimi.example/v1', model: 'kimi-k2', name: 'Kimi' },
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
    if (request.url.includes('api.anthropic.com')) return anthropicResponse(success('Claude 的审计意见'));
    if (request.url.includes('generativelanguage')) return geminiSse({ ...geminiChunk('Gemini 的审计意见', 'STOP'), usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 5, thoughtsTokenCount: 7, totalTokenCount: 52 } });
    if (request.url.includes('deepseek')) return openAiStream('DeepSeek 的审计意见', { prompt_tokens: 30, completion_tokens: 3, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 20 });
    return openAiStream('OpenAI 的审计意见', { prompt_tokens: 20, completion_tokens: 2 });
  };
  for (const service of services) {
    db.createProvider({ id: service.id, name: service.name, kind: service.kind, baseUrl: service.baseUrl, customModels: [{ id: service.model, name: service.model }] });
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

const textOf = (seen: Seen) => JSON.stringify(seen.body.messages ?? seen.body.contents);

describe('one discussion across DeepSeek, OpenAI, Anthropic and Gemini (D134, D135)', () => {
  it('each member reaches its own service with that service\'s Key, parameter and format, and reads the others as public text', async () => {
    const f = await fixture(['ds', 'oa', 'an', 'ge']);
    const started = await f.run.start({ roomId: 'room', task: '交叉审计这份方案', workflowSnapshot: {}, maxTurns: 4 });
    await f.run.waitForIdle(started.runId);
    const snapshot = f.run.getSnapshot(started.runId);
    expect(snapshot.status).toBe('completed');
    expect(snapshot.messages.map(message => message.content)).toEqual(['DeepSeek 的审计意见', 'OpenAI 的审计意见', 'Claude 的审计意见', 'Gemini 的审计意见']);

    const [deepseek, openai, anthropic, gemini] = f.seen;
    expect(deepseek.url).toBe('https://api.deepseek.com/chat/completions');
    expect(deepseek.body).toMatchObject({ model: 'deepseek-v4-pro', stream: true, max_tokens: 8192, stream_options: { include_usage: true } });
    expect(deepseek.body).not.toHaveProperty('max_completion_tokens');
    expect(deepseek.headers.get('authorization')).toBe('Bearer owned-fake-ds-key');

    expect(openai.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(openai.body).toMatchObject({ model: 'gpt-6-astra', stream: true, max_completion_tokens: 8192 });
    expect(openai.body).not.toHaveProperty('max_tokens'); expect(openai.body).not.toHaveProperty('thinking');
    expect(openai.headers.get('authorization')).toBe('Bearer owned-fake-oa-key');

    expect(anthropic.url).toBe('https://api.anthropic.com/v1/messages');
    expect(anthropic.body).toMatchObject({ model: 'claude-opus-5-5', stream: true, max_tokens: 8192 });
    expect(anthropic.body).not.toHaveProperty('thinking');
    expect(anthropic.body.messages.at(-1).role).toBe('user');
    expect(anthropic.headers.get('x-api-key')).toBe('owned-fake-an-key');
    expect(anthropic.headers.get('authorization')).toBeNull();

    expect(gemini.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
    expect(gemini.body.generationConfig).toEqual({ candidateCount: 1, maxOutputTokens: 8192 });
    expect(gemini.body).not.toHaveProperty('max_tokens');
    expect(gemini.headers.get('x-goog-api-key')).toBe('owned-fake-ge-key');

    // D095: the other members' words are quoted public text on the user side, whatever service said them.
    expect(textOf(gemini)).toContain('DeepSeek 的审计意见'); expect(textOf(gemini)).toContain('OpenAI 的审计意见'); expect(textOf(gemini)).toContain('Claude 的审计意见');
    expect(textOf(gemini)).toContain('【成员「成员1」');
    expect(gemini.body.contents.every((content: { role: string }) => content.role === 'user' || content.role === 'model')).toBe(true);
    // Nobody's Key travels with anyone else's request.
    for (const request of f.seen) for (const service of services) if (!request.headers.get('authorization')?.includes(service.id) && request.headers.get('x-api-key') !== `owned-fake-${service.id}-key`
      && request.headers.get('x-goog-api-key') !== `owned-fake-${service.id}-key`) expect(JSON.stringify(request.body)).not.toContain(`owned-fake-${service.id}-key`);
  });

  it('records each member\'s tokens under its own service and model, with no amount anywhere', async () => {
    const f = await fixture(['ds', 'oa', 'an', 'ge']);
    const started = await f.run.start({ roomId: 'room', task: '交叉审计', workflowSnapshot: {}, maxTurns: 4 });
    await f.run.waitForIdle(started.runId);
    const report = new UsageService(f.db, 'UTC').getReport();
    const row = (model: string) => report.byModel.find(item => item.modelId === model)!;
    expect(row('deepseek-v4-pro')).toMatchObject({ providerName: 'DeepSeek', inputTokens: 30, outputTokens: 3, cacheHitTokens: 10, reportedRequests: 1 });
    expect(row('gpt-6-astra')).toMatchObject({ providerName: 'OpenAI', inputTokens: 20, outputTokens: 2 });
    expect(row('claude-opus-5-5')).toMatchObject({ providerName: 'Anthropic', reportedRequests: 1 });
    expect(row('gemini-3.8-flash')).toMatchObject({ providerName: 'Gemini', inputTokens: 40, outputTokens: 12 });
    expect(report.totals.requests).toBe(4);
    const csv = new UsageService(f.db, 'UTC').csv().text;
    expect(csv).not.toMatch(/金额|单价|¥|元/u);
    expect(JSON.stringify(report)).not.toMatch(/Micro|cost|price/iu);
    expect(f.run.getSnapshot(started.runId).usage).toHaveLength(4);
  });

  it('a member whose model takes less output is clamped, without stopping the others (D134)', async () => {
    const f = await fixture(['oa', 'an']);
    f.db.updateProvider({ id: 'an', name: 'Anthropic', kind: 'anthropic', baseUrl: null, customModels: [{ id: 'claude-opus-5-5', name: 'Opus', maxOutputTokens: 2000 }] });
    await f.keys.storeKey('an', 'owned-fake-an-key');
    const started = await f.run.start({ roomId: 'room', task: '夹紧', workflowSnapshot: {}, maxTurns: 2, outputTokenLimit: 16000 });
    await f.run.waitForIdle(started.runId);
    expect(f.run.getSnapshot(started.runId).status).toBe('completed');
    expect(f.seen[0].body.max_completion_tokens).toBe(8192);
    expect(f.seen[1].body.max_tokens).toBe(2000);
  });

  it('a compatible service at a typed address uses max_tokens, no thinking parameter, and its own model', async () => {
    const f = await fixture(['km']);
    const started = await f.run.start({ roomId: 'room', task: '兼容服务', workflowSnapshot: {}, maxTurns: 1 });
    await f.run.waitForIdle(started.runId);
    expect(f.seen[0].url).toBe('https://kimi.example/v1/chat/completions');
    expect(f.seen[0].body).toMatchObject({ model: 'kimi-k2', max_tokens: 8192 });
    expect(f.seen[0].body).not.toHaveProperty('thinking'); expect(f.seen[0].body).not.toHaveProperty('max_completion_tokens');
  });

  it('shows what a service says about an over-long request honestly and does not resend it', async () => {
    const f = await fixture(['oa']);
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
