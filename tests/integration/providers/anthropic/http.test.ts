// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { AnthropicProvider, buildAnthropicMessages } from '../../../../src/main/providers/anthropic/AnthropicProvider';
import type { NormalizedChunk } from '../../../../src/main/providers/types';
import { configuration, input, fakeKey, success, start, blockStart, text, frame, collect } from '../../../unit/providers/anthropic/fixtures';

const nativeFetch = globalThis.fetch;
type Record = { path: string; key: string | undefined; version: string | undefined; body: unknown };
async function fixture(respond: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>, run: (provider: AnthropicProvider, requests: Record[]) => Promise<void>) {
  const requests: Record[] = []; const failures: unknown[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || req.url !== '/v1/messages') throw new Error('Unexpected local fixture request');
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 65536) throw new Error('Fixture request too large'); chunks.push(chunk); }
      requests.push({ path: req.url, key: req.headers['x-api-key'] as string | undefined, version: req.headers['anthropic-version'] as string | undefined, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      await respond(req, res);
    })().catch(error => { failures.push(error); res.destroy(); });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable');
  const local = `http://127.0.0.1:${address.port}/v1/messages`;
  const provider = new AnthropicProvider({ configuration, confirmedBaseUrl: 'https://api.anthropic.com', resolveKey: async () => fakeKey, timeoutMs: 2000,
    fetch: async (resource, init) => {
      if (String(resource) !== 'https://api.anthropic.com/v1/messages' || init?.method !== 'POST') throw new Error('External network forbidden');
      // Only this test transport rewrites the already checked SDK target to its own loopback server.
      return nativeFetch(local, init);
    } });
  try { await run(provider, requests); expect(failures).toEqual([]); }
  finally { const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); server.closeAllConnections(); await closed; }
}
async function closed(promise: Promise<void>) {
  let timer!: ReturnType<typeof setTimeout>;
  try { await Promise.race([promise, new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new Error('Fixture socket did not close')), 1000); })]); }
  finally { clearTimeout(timer); }
}

describe('Anthropic SDK actual loopback HTTP', () => {
  it('sends native headers/body and decodes fragmented Unicode and named events', async () => {
    await fixture(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'local-http-request' });
      const bytes = Buffer.from(success().map(e => frame(e, undefined, '\r\n')).join(''));
      for (let i = 0; i < bytes.length; i += 3) { res.write(bytes.subarray(i, i + 3)); await setImmediate(); }
      res.end();
    }, async (provider, requests) => {
      const chunks = await collect(provider.streamChat(input));
      expect(chunks).toEqual([{ type: 'start', requestId: input.requestId, providerRequestId: 'local-http-request' },
        { type: 'text_delta', requestId: input.requestId, text: '你好🙂' },
        { type: 'usage', requestId: input.requestId, inputTokens: 7, outputTokens: 3 }, { type: 'finish', requestId: input.requestId, reason: 'stop' }]);
      expect(requests).toEqual([{ path: '/v1/messages', key: fakeKey, version: '2023-06-01',
        body: { model: input.modelId, ...buildAnthropicMessages(input.messages), max_tokens: 23, stream: true } }]);
      expect(JSON.stringify(chunks)).not.toContain(fakeKey);
    });
  });

  it('closes the real response/socket on Stop with one request and retained partial', async () => {
    let responseClosed!: () => void; let socketClosed!: () => void;
    const responseClose = new Promise<void>(resolve => { responseClosed = resolve; });
    const socketClose = new Promise<void>(resolve => { socketClosed = resolve; });
    await fixture((req, res) => {
      res.once('close', responseClosed); req.socket.once('close', socketClosed);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write([start(), blockStart(), text('retained partial')].map(e => frame(e)).join(''));
    }, async (provider, requests) => {
      const controller = new AbortController(); const chunks: NormalizedChunk[] = [];
      for await (const chunk of provider.streamChat({ ...input, signal: controller.signal })) { chunks.push(chunk); if (chunk.type === 'text_delta') controller.abort(); }
      await closed(responseClose); await closed(socketClose);
      expect(chunks.filter(c => c.type === 'text_delta')).toEqual([{ type: 'text_delta', requestId: input.requestId, text: 'retained partial' }]);
      expect(chunks.at(-1)).toMatchObject({ type: 'error', error: { code: 'cancelled' } });
      expect(chunks.filter(c => c.type === 'finish')).toEqual([]); expect(requests).toHaveLength(1);
    });
  });

  it('refuses actual redirects without requesting the new path or exposing error bytes', async () => {
    await fixture((_req, res) => { res.writeHead(307, { location: '/unconfirmed' }); res.end('fixture-private-error'); }, async (provider, requests) => {
      const chunks = await collect(provider.streamChat(input));
      expect(chunks).toMatchObject([{ type: 'error', error: { code: 'network_error' } }]);
      expect(requests.map(r => r.path)).toEqual(['/v1/messages']);
      expect(JSON.stringify(chunks)).not.toMatch(/unconfirmed|fixture-private-error|fixture-anthropic-secret/);
    });
  });
});
