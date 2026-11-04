// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';

const databases: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); databases.splice(0).forEach(db => db.close()); });
const baseUrl = 'http://127.0.0.1:12345/v1';
function fixture(approved = true) {
  const db = new Database(':memory:'); db.initialize(); databases.push(db);
  db.createProvider({ id: 'p', name: 'Fixture', kind: 'compatible', baseUrl });
  const keys = new KeyService(db, createMemoryKeyBackend());
  const requests: Request[] = [];
  const registry = new ProviderRegistry(db, keys, {
    capabilitiesResolver: () => ({ streamUsage: false, listModels: true, authentication: 'models' }),
    
    transportFactory: guard => async (resource, init) => {
      guard(); const request = new Request(resource, init); requests.push(request);
      if (request.method === 'GET') return Response.json({ data: [{ id: 'listed-model' }] });
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  return { db, keys, registry, requests, service: new ProviderSettingsService(db, keys, registry) };
}

it('keeps configuration checking local and needs a Key for real discovery', async () => {
  const { service, keys, requests } = fixture();
  const resolve = vi.spyOn(keys, 'resolveKey');
  expect(await service.testConnection({ providerId: 'p', level: 'configuration' })).toMatchObject({ result: { ok: true } });
  expect(resolve).not.toHaveBeenCalled(); expect(requests).toEqual([]);
  await expect(service.listModels({ providerId: 'p' })).rejects.toMatchObject({ code: 'authentication_failed' });
  await keys.storeKey('p', 'fake-settings-key');
  expect(await service.listModels({ providerId: 'p' })).toEqual({ providerId: 'p', models: [{ id: 'listed-model', name: 'listed-model' }] });
  expect(await service.testConnection({ providerId: 'p', level: 'authentication' })).toMatchObject({ result: { ok: true, level: 'authentication' } });
  expect(requests.map(request => [request.method, request.url])).toEqual([['GET', `${baseUrl}/models`], ['GET', `${baseUrl}/models`]]);
});

it('requires generation authorization for the fixed eight-token probe', async () => {
  const { service, keys, requests } = fixture();
  await keys.storeKey('p', 'fake-settings-key');
  expect(await service.testConnection({ providerId: 'p', level: 'generation', modelId: 'fixture' })).toMatchObject({ result: { ok: false, error: { code: 'forbidden' } } });
  expect(requests).toEqual([]);
  expect(await service.testConnection({ providerId: 'p', level: 'generation', modelId: 'fixture', allowGeneration: true })).toMatchObject({ result: { ok: true, level: 'generation' } });
  expect(requests).toHaveLength(1);
  expect(await requests[0].json()).toEqual({ model: 'fixture', messages: [{ role: 'user', content: 'Reply OK.' }], stream: true, max_tokens: 8 });
});

it('D136: a replaced Key works at once, with nothing to approve, and manually entered models stay', async () => {
  const { service, requests } = fixture();
  await service.setKey({ providerId: 'p', apiKey: 'fake-settings-first' });
  await service.setKey({ providerId: 'p', apiKey: 'fake-settings-second' });
  expect(await service.listModels({ providerId: 'p' })).toMatchObject({ providerId: 'p' });
  expect(requests).toHaveLength(1);
  expect(new Headers(requests[0].headers).get('authorization')).toBe('Bearer fake-settings-second');
  expect((await service.getProviderConfiguration({ id: 'p' })).customModels).toEqual([]);
});
