// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../../../../src/main/providers/gemini/GeminiProvider';
import { createSafeFetch } from '../../../../src/main/providers/network';
import type { NormalizedChunk, StreamChatInput } from '../../../../src/main/providers/types';
import type { ProviderConfiguration } from '../../../../src/shared/contracts/configuration';
import { normalizedChunkSchema } from '../../../../src/shared/schemas/provider';

const officialBase = 'https://generativelanguage.googleapis.com/v1beta';
const path = '/v1beta/models/fixture-gemini:streamGenerateContent?alt=sse';
const fixtureKey = 'fixture-gemini-loopback-only';
const input: StreamChatInput = {
  requestId: 'main-gemini-http', modelId: 'fixture-gemini', outputTokenLimit: 17,
  messages: [{ role: 'system', content: '主持指令' }, { role: 'user', content: '公开任务' }],
};
type RequestRecord = { path: string; method: string; key: string | string[] | undefined; body: unknown };
type Fixture = { fetch: typeof fetch; requests: RequestRecord[] };
const forbiddenFetch = vi.fn(async () => { throw new Error('Public network is forbidden in Gemini HTTP fixtures'); });

beforeEach(() => { forbiddenFetch.mockClear(); vi.stubGlobal('fetch', forbiddenFetch); });
afterEach(() => { vi.unstubAllGlobals(); expect(forbiddenFetch).not.toHaveBeenCalled(); });

function frame(text?: string, finishReason?: string, usageMetadata?: Record<string, number>) {
  return `data: ${JSON.stringify({
    responseId: 'gemini-http-response',
    candidates: [{ index: 0, ...(text === undefined ? {} : { content: { role: 'model', parts: [{ text }] } }),
      ...(finishReason === undefined ? {} : { finishReason }) }],
    ...(usageMetadata === undefined ? {} : { usageMetadata }),
  })}\r\n\r\n`;
}

async function fixture(
  respond: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  run: (value: Fixture) => Promise<void>,
) {
  const requests: RequestRecord[] = []; const failures: unknown[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== path) throw new Error('Unexpected fixture endpoint');
      const body: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 65536) throw new Error('Unexpected fixture request size');
        body.push(chunk);
      }
      requests.push({ path: request.url, method: request.method, key: request.headers['x-goog-api-key'],
        body: JSON.parse(Buffer.concat(body).toString('utf8')) });
      await respond(request, response);
    })().catch(error => { failures.push(error); response.destroy(); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a temporary loopback port');
  const loopback = `http://127.0.0.1:${address.port}`;
  const transport = createSafeFetch();
  const fetch: typeof globalThis.fetch = (resource, init) => {
    if (String(resource) !== `https://generativelanguage.googleapis.com${path}`
      || init?.method !== 'POST' || init.redirect !== 'error') {
      throw new Error('Network outside the exact official fixture endpoint is forbidden');
    }
    return transport(`${loopback}${path}`, init);
  };
  try { await run({ fetch, requests }); expect(failures).toEqual([]); }
  finally {
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections(); await closed;
  }
}

function provider(value: Fixture) {
  const configuration: ProviderConfiguration = {
    id: 'gemini-loopback-instance', name: 'Gemini HTTP fixture', kind: 'gemini', baseUrl: null,
    enabled: true, isDefault: false, defaultModelId: null, customModels: [], keyReference: { id: 'fake-reference' },
    createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
  };
  return new GeminiProvider({ configuration, confirmedBaseUrl: officialBase,
    resolveKey: async () => fixtureKey, timeoutMs: 2000, fetch: value.fetch });
}

async function collect(stream: AsyncIterable<NormalizedChunk>) {
  const events: NormalizedChunk[] = [];
  for await (const event of stream) { expect(normalizedChunkSchema.safeParse(event).success).toBe(true); events.push(event); }
  return events;
}

async function waitForClose(promise: Promise<void>) {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Gemini Stop did not close the fixture transport')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}

describe('Gemini native REST with real Node HTTP and R09 safe transport', () => {
  it('streams fragmented UTF-8 and final usage with the bounded native request', async () => {
    await fixture(async (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const bytes = Buffer.from(frame('你好🙂') + frame('完成', 'STOP', {
        promptTokenCount: 11, candidatesTokenCount: 7, thoughtsTokenCount: 3, totalTokenCount: 21,
      }));
      for (let offset = 0; offset < bytes.length; offset += 3) {
        response.write(bytes.subarray(offset, offset + 3)); await setImmediate();
      }
      response.end();
    }, async value => {
      const events = await collect(provider(value).streamChat(input));
      expect(events.filter(event => event.type === 'text_delta').map(event => event.text).join('')).toBe('你好🙂完成');
      expect(events.filter(event => event.type === 'start')).toEqual([
        { type: 'start', requestId: input.requestId, providerRequestId: 'gemini-http-response' },
      ]);
      expect(events.filter(event => event.type === 'usage')).toEqual([
        { type: 'usage', requestId: input.requestId, inputTokens: 11, outputTokens: 10 },
      ]);
      expect(events.at(-1)).toEqual({ type: 'finish', requestId: input.requestId, reason: 'stop' });
      expect(events.every(event => event.requestId === input.requestId)).toBe(true);
      expect(JSON.stringify(events)).not.toContain(fixtureKey);
      expect(value.requests).toEqual([{
        path, method: 'POST', key: fixtureKey,
        body: { contents: [{ role: 'user', parts: [{ text: '公开任务' }] }],
          systemInstruction: { parts: [{ text: '主持指令' }] }, generationConfig: { candidateCount: 1, maxOutputTokens: 17 } },
      }]);
    });
  });

  it('closes the response and socket after Stop while retaining partial output without retry', async () => {
    let responseClosed!: () => void; let socketClosed!: () => void;
    const responseClose = new Promise<void>(resolve => { responseClosed = resolve; });
    const socketClose = new Promise<void>(resolve => { socketClosed = resolve; });
    await fixture((request, response) => {
      response.once('close', responseClosed); request.socket.once('close', socketClosed);
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write(frame('retained partial'));
    }, async value => {
      const controller = new AbortController(); const events: NormalizedChunk[] = [];
      for await (const event of provider(value).streamChat({ ...input, signal: controller.signal })) {
        expect(normalizedChunkSchema.safeParse(event).success).toBe(true); events.push(event);
        if (event.type === 'text_delta') controller.abort();
      }
      await waitForClose(responseClose); await waitForClose(socketClose);
      expect(events.filter(event => event.type === 'text_delta').map(event => event.text).join('')).toBe('retained partial');
      expect(events.at(-1)).toMatchObject({ type: 'error', requestId: input.requestId, error: { code: 'cancelled' } });
      expect(events.filter(event => event.type === 'finish')).toEqual([]);
      expect(events.filter(event => event.type === 'error')).toHaveLength(1);
      expect(value.requests).toHaveLength(1); expect(JSON.stringify(events)).not.toContain(fixtureKey);
    });
  });

  it('returns a redacted rate limit after one HTTP request despite Retry-After', async () => {
    await fixture((_request, response) => {
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0', 'x-private': fixtureKey });
      response.end(JSON.stringify({ error: { message: `${fixtureKey} private server diagnostic` } }));
    }, async value => {
      const events = await collect(provider(value).streamChat(input));
      expect(events).toEqual([{
        type: 'error', requestId: input.requestId,
        error: { code: 'rate_limited', message: 'Provider rate limit reached', retryable: true },
      }]);
      expect(value.requests).toHaveLength(1);
      expect(JSON.stringify(events)).not.toMatch(/fixture-gemini-loopback-only|private server diagnostic|x-private/);
    });
  });
});
