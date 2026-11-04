// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { RunService } from '../../../src/main/services/RunService';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';
import { apiErrorSchema, upstreamText } from '../../../src/shared/schemas/error';

const FAKE_KEY = 'owned-fake-upstream-key';
const SECRET_WORDS = 'the-service-said-something-private';
const open: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); open.splice(0).forEach(db => db.close()); });
async function fixture(answer: () => Response) {
  const db = new Database(':memory:'); db.initialize(); open.push(db);
  const keys = new KeyService(db, createMemoryKeyBackend());
  const registry = new ProviderRegistry(db, keys, { transportFactory: guard => async () => { guard(); return answer(); } });
  const settings = new ProviderSettingsService(db, keys, registry);
  const provider = await settings.createProvider({ name: 'DeepSeek', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash' });
  await settings.setKey({ providerId: provider.id, apiKey: FAKE_KEY });
  return { db, registry, settings, id: provider.id };
}
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const probe = (settings: ProviderSettingsService, id: string) => settings.testConnection({ providerId: id, level: 'generation', modelId: 'deepseek-flash', allowGeneration: true });

describe('what a service says went wrong', () => {
  it.each([
    ['error.code', { error: { code: 'InvalidEndpointOrModel.NotFound', message: SECRET_WORDS } }, 'InvalidEndpointOrModel.NotFound'],
    ['error.type', { error: { type: 'invalid_request_error', message: SECRET_WORDS } }, 'invalid_request_error'],
    ['the top level', { code: 'model_not_found', message: SECRET_WORDS }, 'model_not_found'],
    ['a number', { error: { code: 1211, message: SECRET_WORDS } }, '1211'],
    ['error.code before error.type', { error: { code: 'first', type: 'second' }, code: 'third' }, 'first'],
    ['the next place when the first is no code', { error: { code: 'has spaces and words', type: 'usable_type' } }, 'usable_type'],
  ])('reads it from %s, and keeps none of the words', async (_where, body, code) => {
    const { settings, id } = await fixture(json(404, body));
    const { result } = await probe(settings, id);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found', upstream: { status: 404, code } } });
    expect(JSON.stringify(result)).not.toContain(SECRET_WORDS);
  });
  it.each([
    ['too long', { error: { code: 'x'.repeat(65) } }], ['words', { error: { code: '找不到模型' } }], ['spaces', { error: { code: 'not found' } }], ['markup', { code: '<b>x</b>' }],
    ['an object', { error: { code: { nested: 'x' } } }], ['no code', { message: SECRET_WORDS }], ['the Key echoed', { error: { code: FAKE_KEY } }], ['something like a Key', { code: 'sk-0123456789abcdef0123456789abcdef' }],
  ])('keeps only the status when the code is %s', async (_name, body) => {
    const { settings, id } = await fixture(json(400, body));
    const { result } = await probe(settings, id);
    expect(result).toMatchObject({ ok: false, error: { upstream: { status: 400 } } });
    expect(result.ok === false && result.error.upstream).not.toHaveProperty('code');
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(result)).not.toContain(SECRET_WORDS);
    expect(JSON.stringify(result)).not.toContain('sk-0123');
  });
  it.each([
    ['text', () => new Response(`upstream said ${SECRET_WORDS}`, { status: 500 })], ['no body', () => new Response(null, { status: 500 })],
    ['a very long body', () => new Response(JSON.stringify({ code: 'late', padding: 'x'.repeat(70 * 1024) }), { status: 500 })], ['JSON that is not an object', () => new Response('null', { status: 500 })],
  ])('copes with %s as the body', async (_name, answer) => {
    const { settings, id } = await fixture(answer);
    const { result } = await probe(settings, id);
    expect(result).toMatchObject({ ok: false, error: { code: 'internal_error', upstream: { status: 500 } } });
    expect(result.ok === false && result.error.upstream).not.toHaveProperty('code');
    expect(JSON.stringify(result)).not.toContain(SECRET_WORDS);
  });
  it('goes on the turn_failed event and the snapshot, without the words or the Key, and logs nothing', async () => {
    const log = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'info').mockImplementation(() => {})];
    const { db, registry, id } = await fixture(json(404, { error: { code: 'InvalidEndpointOrModel.NotFound', message: `${SECRET_WORDS} ${FAKE_KEY}` } }));
    db.createRoom({ id: 'r', name: 'R' });
    db.createAgent({ id: 'a', roomId: 'r', displayName: 'A', roleTemplateId: 'draft', providerId: id, modelId: 'deepseek-flash' });
    const run = new RunService(db, new MockProvider(), createPublicMessagesBuilder((model, member) => member.providerId ? registry.budget(member.providerId, model!) : undefined), registry);
    try {
      const started = await run.start({ roomId: 'r', task: '目标', workflowSnapshot: {}, maxTurns: 1, outputTokenLimit: 8 });
      await run.waitForIdle(started.runId);
      const events = db.listRunEvents(started.runId, 0);
      const failed = events.find(event => event.type === 'turn_failed') as unknown as { payload: { error: unknown } };
      expect(failed.payload.error).toMatchObject({ code: 'not_found', upstream: { status: 404, code: 'InvalidEndpointOrModel.NotFound' } });
      expect(run.getSnapshot(started.runId).lastFailure).toMatchObject({ upstream: { status: 404, code: 'InvalidEndpointOrModel.NotFound' } });
      const everything = JSON.stringify([events, run.getSnapshot(started.runId)]);
      expect(everything).not.toContain(SECRET_WORDS);
      expect(everything).not.toContain(FAKE_KEY);
      for (const spy of log) expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET_WORDS);
    } finally { await run.shutdown(); }
  });
  it('the schema refuses anything but a code and a status', () => {
    const base = { code: 'not_found', message: 'Requested resource was not found', retryable: false };
    expect(apiErrorSchema.safeParse({ ...base, upstream: { status: 404, code: 'ok_code-1.2' } }).success).toBe(true);
    expect(apiErrorSchema.safeParse({ ...base }).success).toBe(true);
    expect(apiErrorSchema.safeParse({ ...base, upstream: { status: 404, code: 'has space' } }).success).toBe(false);
    expect(apiErrorSchema.safeParse({ ...base, upstream: { status: 404, message: SECRET_WORDS } }).success).toBe(false);
    expect(apiErrorSchema.safeParse({ ...base, upstream: { status: 99 } }).success).toBe(false);
    expect(upstreamText({ status: 404, code: 'x' })).toBe('服务商返回：x（HTTP 404）');
    expect(upstreamText({ status: 500 })).toBe('服务商返回：HTTP 500，没有错误码');
    expect(upstreamText(undefined)).toBe('');
  });
});
