// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { OpenAICompatibleProvider } from '../../../../src/main/providers/openai-compatible/OpenAICompatibleProvider';
import type { NormalizedChunk, StreamChatInput } from '../../../../src/main/providers/types';
import type { ProviderConfiguration } from '../../../../src/shared/contracts/configuration';
import { normalizedChunkSchema } from '../../../../src/shared/schemas/provider';

const fixtureKey = 'fixture-loopback-only';
const path = '/v1/chat/completions';
const nativeFetch = globalThis.fetch;
const input: StreamChatInput = {
  requestId: 'main-loopback-request', modelId: 'fixture-model', outputTokenLimit: 17,
  messages: [{ role: 'system', content: '成员提示' }, { role: 'user', content: '公开任务' }],
};
type RequestRecord = { path: string; method: string; authorization: string | undefined; body: unknown };
type Fixture = { baseUrl: string; fetch: typeof fetch; requests: RequestRecord[] };

function frame(content: string | null, finish: string | null = null) {
  return `data: ${JSON.stringify({
    id: 'fixture-response', object: 'chat.completion.chunk', created: 1, model: 'fixture-model',
    choices: [{ index: 0, delta: { content }, finish_reason: finish }],
  })}\r\n\r\n`;
}

async function fixture(
  respond: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  run: (value: Fixture) => Promise<void>,
) {
  const requests: RequestRecord[] = [];
  const failures: unknown[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== path) {
        requests.push({ path: request.url ?? '', method: request.method ?? '', authorization: request.headers.authorization, body: null });
        throw new Error('Unexpected fixture HTTP endpoint');
      }
      const body: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 65536) throw new Error('Unexpected fixture request size');
        body.push(chunk);
      }
      requests.push({ path: request.url, method: request.method, authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(body).toString('utf8')) });
      await respond(request, response);
    })().catch(error => { failures.push(error); response.destroy(); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected an isolated loopback fixture port');
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const fetch: typeof globalThis.fetch = (resource, init) => {
    const request = new Request(resource, init);
    if (request.url !== `${baseUrl}/chat/completions` || request.method !== 'POST') {
      throw new Error('Network outside the exact loopback fixture endpoint is forbidden');
    }
    return nativeFetch(resource, init);
  };
  try {
    await run({ baseUrl, fetch, requests });
    expect(failures).toEqual([]);
  } finally {
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  }
}

function provider(value: Fixture) {
  const configuration: ProviderConfiguration = {
    id: 'loopback-instance', name: 'Isolated loopback fixture', kind: 'openai-compatible',
    baseUrl: value.baseUrl, enabled: true, isDefault: false, defaultModelId: null, customModels: [],
    keyReference: { id: 'fixture-reference' }, createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z',
  };
  return new OpenAICompatibleProvider({
    configuration, confirmedBaseUrl: value.baseUrl, resolveKey: async () => fixtureKey,
    timeoutMs: 2000, fetch: value.fetch,
    capabilities: { outputTokenParameter: 'max_tokens', streamUsage: false, listModels: false, authentication: 'unsupported' },
  });
}

async function collect(stream: AsyncIterable<NormalizedChunk>) {
  const events: NormalizedChunk[] = [];
  for await (const event of stream) {
    expect(normalizedChunkSchema.safeParse(event).success).toBe(true);
    events.push(event);
  }
  return events;
}

async function waitForClose(promise: Promise<void>) {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('SDK did not close the fixture transport after Stop')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}

describe('OpenAI Compatible actual Node SDK loopback HTTP', () => {
  it('streams fragmented UTF-8/DONE with the bounded request and fake authorization', async () => {
    await fixture(async (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const bytes = Buffer.from(frame('你好🙂') + frame('完成') + frame(null, 'stop') + 'data: [DONE]\r\n\r\n');
      for (let offset = 0; offset < bytes.length; offset += 3) {
        response.write(bytes.subarray(offset, offset + 3));
        await setImmediate();
      }
      response.end();
    }, async value => {
      const events = await collect(provider(value).streamChat(input));
      expect(events.filter(event => event.type === 'text_delta').map(event => event.text).join('')).toBe('你好🙂完成');
      expect(events.filter(event => event.type === 'start')).toHaveLength(1);
      expect(events.at(-1)).toEqual({ type: 'finish', requestId: input.requestId, reason: 'stop' });
      expect(events.every(event => event.requestId === input.requestId)).toBe(true);
      expect(events.filter(event => event.type === 'usage')).toEqual([]);
      expect(JSON.stringify(events)).not.toContain(fixtureKey);
      expect(value.requests).toEqual([{
        path, method: 'POST', authorization: `Bearer ${fixtureKey}`,
        body: { model: 'fixture-model', messages: input.messages, stream: true, max_tokens: 17 },
      }]);
    });
  });

  it('closes the real response and socket on Stop, retaining partial output without retry', async () => {
    let responseClosed!: () => void; let socketClosed!: () => void;
    const responseClose = new Promise<void>(resolve => { responseClosed = resolve; });
    const socketClose = new Promise<void>(resolve => { socketClosed = resolve; });
    await fixture((request, response) => {
      response.once('close', responseClosed);
      request.socket.once('close', socketClosed);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(frame('retained partial'));
    }, async value => {
      const controller = new AbortController();
      const events: NormalizedChunk[] = [];
      for await (const event of provider(value).streamChat({ ...input, signal: controller.signal })) {
        expect(normalizedChunkSchema.safeParse(event).success).toBe(true);
        events.push(event);
        if (event.type === 'text_delta') controller.abort();
      }
      await waitForClose(responseClose);
      await waitForClose(socketClose);
      expect(events.filter(event => event.type === 'text_delta').map(event => event.text).join('')).toBe('retained partial');
      expect(events.at(-1)).toMatchObject({ type: 'error', requestId: input.requestId, error: { code: 'cancelled' } });
      expect(events.filter(event => event.type === 'finish')).toEqual([]);
      expect(events.filter(event => event.type === 'error')).toHaveLength(1);
      expect(value.requests).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain(fixtureKey);
    });
  });

  it('rejects an actual redirect without contacting the unconfirmed loopback path', async () => {
    await fixture((_request, response) => {
      response.writeHead(307, { location: '/unconfirmed' });
      response.end('fixture-private-error');
    }, async value => {
      const events = await collect(provider(value).streamChat(input));
      expect(events).toEqual([{
        type: 'error', requestId: input.requestId,
        error: { code: 'network_error', message: 'Provider connection failed', retryable: true },
      }]);
      expect(value.requests.map(request => request.path)).toEqual([path]);
      expect(JSON.stringify(events)).not.toMatch(/unconfirmed|fixture-private-error|fixture-loopback-only/);
    });
  });
});
