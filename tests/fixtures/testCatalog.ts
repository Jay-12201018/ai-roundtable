import type { CatalogService } from '../../src/shared/serviceCatalog';

const models = ['fixture', 'custom', 'manual-model', 'model-a', 'model-b', 'old-model', 'new-model'].map(id => ({ id, name: id }));

/** A catalog at the given addresses, for tests only (D143): the registry takes it through its constructor; production never passes one. */
export const catalogAt = (...baseUrls: string[]): CatalogService[] => baseUrls.map((baseUrl, index) => ({ id: `fixture-${index}`, name: `Fixture ${index}`, baseUrl, modelPattern: /./u, models }));

export const testCatalog = catalogAt('https://service.example/v1', 'https://example.test/v1', 'http://127.0.0.1:12345/v1', 'http://127.0.0.1:23456/v2', 'http://127.0.0.1:9/v1');

/** One complete streamed reply, as a compatible service sends it. */
export const sseReply = (text = 'OK') => new Response(
  `data: {"choices":[{"index":0,"delta":{"content":${JSON.stringify(text)}},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`,
  { headers: { 'content-type': 'text/event-stream' } });
