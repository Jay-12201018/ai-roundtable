// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry, type ApprovedModelPolicy } from '../../../src/main/providers/ProviderRegistry';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';

const databases: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); databases.splice(0).forEach(db => db.close()); });
const baseUrl = 'http://127.0.0.1:12345/v1';
const policy: ApprovedModelPolicy = {
  evidence: 'owned deterministic fixture only', outputTokenParameter: 'max_tokens', contextWindowTokens: 1000, maxOutputTokens: 32,
  counter: { modelId: 'fixture', method: 'fixture packet bytes', kind: 'exact', countMessages: messages => 8 + messages.reduce((n, m) => n + Buffer.byteLength(m.content), 0) },
  price: { inputUsdPerMillion: 0, outputUsdPerMillion: 0, maxRequestUsd: 0, evidence: 'owned fixture has no billable requests' },
};
function fixture(approved = true) {
  const db = new Database(':memory:'); db.initialize(); databases.push(db);
  db.createProvider({ id: 'p', name: 'Fixture', kind: 'openai-compatible', baseUrl });
  const keys = new KeyService(db, createMemoryKeyBackend());
  const requests: Request[] = [];
  const registry = new ProviderRegistry(db, keys, {
    capabilitiesResolver: () => ({ outputTokenParameter: 'max_tokens', streamUsage: false, listModels: true, authentication: 'models' }),
    policyResolver: (_configuration, modelId) => approved && modelId === 'fixture' ? policy : undefined,
    transportFactory: guard => async (resource, init) => {
      guard(); const request = new Request(resource, init); requests.push(request);
      if (request.method === 'GET') return Response.json({ data: [{ id: 'listed-model' }] });
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  return { db, keys, registry, requests, service: new ProviderSettingsService(db, keys, registry) };
}
const confirmation = { providerId: 'p', baseUrl, confirmed: true as const };

it('keeps configuration checking local and requires explicit Main approval for real discovery', async () => {
  const { service, keys, requests } = fixture();
  const resolve = vi.spyOn(keys, 'resolveKey');
  expect(await service.testConnection({ providerId: 'p', level: 'configuration' })).toMatchObject({ result: { ok: true } });
  expect(resolve).not.toHaveBeenCalled(); expect(requests).toEqual([]);
  await expect(service.listModels({ providerId: 'p' })).rejects.toMatchObject({ code: 'forbidden' });
  await keys.storeKey('p', 'fake-settings-key');
  expect(await service.confirmTarget(confirmation)).toEqual({ providerId: 'p' });
  expect(await service.listModels({ providerId: 'p' })).toEqual({ providerId: 'p', models: [{ id: 'listed-model', name: 'listed-model' }] });
  expect(await service.testConnection({ providerId: 'p', level: 'authentication' })).toMatchObject({ result: { ok: true, level: 'authentication' } });
  expect(requests.map(request => [request.method, request.url])).toEqual([['GET', `${baseUrl}/models`], ['GET', `${baseUrl}/models`]]);
});

it('requires generation authorization and applies the same reviewed policy to the fixed eight-token probe', async () => {
  const { service, keys, requests } = fixture();
  await keys.storeKey('p', 'fake-settings-key'); await service.confirmTarget(confirmation);
  expect(await service.testConnection({ providerId: 'p', level: 'generation', modelId: 'fixture' })).toMatchObject({ result: { ok: false, error: { code: 'forbidden' } } });
  expect(requests).toEqual([]);
  expect(await service.testConnection({ providerId: 'p', level: 'generation', modelId: 'fixture', allowGeneration: true })).toMatchObject({ result: { ok: true, level: 'generation' } });
  expect(requests).toHaveLength(1);
  expect(await requests[0].json()).toEqual({ model: 'fixture', messages: [{ role: 'user', content: 'Reply OK.' }], stream: true, max_tokens: 8 });
});

it('rejects unknown model policy before decrypting credentials or starting a generation request', async () => {
  const { service, keys, requests } = fixture(false);
  await keys.storeKey('p', 'fake-settings-key'); await service.confirmTarget(confirmation);
  const resolve = vi.spyOn(keys, 'resolveKey');
  expect(await service.testConnection({ providerId: 'p', level: 'generation', modelId: 'fixture', allowGeneration: true })).toMatchObject({ result: { ok: false, error: { code: 'unsupported' } } });
  expect(resolve).not.toHaveBeenCalled(); expect(requests).toEqual([]);
});

it('validates confirmation input and rejects unsupported runtime without inventing approval', async () => {
  const { db, keys, service, requests } = fixture();
  await expect(service.confirmTarget({ ...confirmation, confirmed: false } as never)).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(service.confirmTarget({ ...confirmation, baseUrl: 'http://127.0.0.1:9/v1' })).rejects.toMatchObject({ code: 'forbidden' });
  await expect(new ProviderSettingsService(db, keys).confirmTarget(confirmation)).rejects.toMatchObject({ code: 'unsupported' });
  expect(requests).toEqual([]);
});

it('invalidates session target approval after Key replacement and retains manually entered models', async () => {
  const { service, requests } = fixture();
  await service.setKey({ providerId: 'p', apiKey: 'fake-settings-first' }); await service.confirmTarget(confirmation);
  await service.setKey({ providerId: 'p', apiKey: 'fake-settings-second' });
  await expect(service.listModels({ providerId: 'p' })).rejects.toMatchObject({ code: 'forbidden' });
  expect(requests).toEqual([]);
  expect((await service.getProviderConfiguration({ id: 'p' })).customModels).toEqual([]);
});
