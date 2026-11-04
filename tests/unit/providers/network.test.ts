// @vitest-environment node
import { EventEmitter } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import * as https from 'node:https';
import { PassThrough } from 'node:stream';
import type { lookup as dnsLookup } from 'node:dns/promises';
import type { RequestOptions } from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSafeFetch } from '../../../src/main/providers/network';

vi.mock('node:https', async importOriginal => ({ ...await importOriginal<typeof import('node:https')>(), request: vi.fn() }));

const fixtureKey = 'fixture-network-key';
const lookup = (records: Array<{ address: string; family: number }>) =>
  vi.fn(async () => records) as unknown as typeof dnsLookup;

afterEach(() => { vi.mocked(https.request).mockReset(); vi.restoreAllMocks(); });

function httpsFixture(status = 200, headers: Record<string, string> = {}, body = 'fixture response', connected = true) {
  const socket = new EventEmitter();
  const response = Object.assign(new PassThrough(), { statusCode: status, statusMessage: 'Fixture', headers, rawHeaders: Object.entries(headers).flat() });
  const request = Object.assign(new EventEmitter(), {
    end: vi.fn(() => queueMicrotask(() => { respond(response); response.end(body); })),
    destroy: vi.fn(() => { response.destroy(); return request; }),
  });
  let respond: (value: typeof response) => void;
  const outbound = vi.mocked(https.request).mockImplementation(((...args: unknown[]) => {
    respond = args[2] as typeof respond;
    queueMicrotask(() => { request.emit('socket', socket); if (connected) queueMicrotask(() => socket.emit('secureConnect')); });
    return request;
  }) as unknown as typeof https.request);
  return { outbound, request, response, socket };
}

async function localFixture(respond: (response: ServerResponse) => void, run: (url: string, closed: Promise<void>, requests: string[]) => Promise<void>) {
  const requests: string[] = [];
  let close!: () => void; let closeSocket!: () => void;
  const closed = Promise.all([
    new Promise<void>(resolve => { close = resolve; }),
    new Promise<void>(resolve => { closeSocket = resolve; }),
  ]).then(() => {});
  const server = createServer((request, response) => {
    void (async () => {
      const body: Buffer[] = [];
      for await (const chunk of request) body.push(chunk);
      requests.push(`${request.method} ${request.url} ${request.headers.authorization ?? ''} ${Buffer.concat(body).toString('utf8')}`);
      response.once('close', close);
      request.socket.once('close', closeSocket);
      respond(response);
    })().catch(error => response.destroy(error));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
    await run(`http://127.0.0.1:${address.port}`, closed, requests);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe('Main safe Provider transport', () => {
  it.each([
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.0.0.1', '192.0.2.1', '192.88.99.1', '192.168.0.1',
    '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', '64:ff9b::a00:1',
    '100::1', '2001::1', '2001:db8::1', '2002:7f00:1::1', '3fff::1', 'fc00::1', 'fe80::1', 'ff02::1',
  ])('rejects non-public HTTPS DNS target %s before transmitting credentials', async address => {
    const fixture = httpsFixture();
    const resolver = lookup([{ address, family: address.includes(':') ? 6 : 4 }]);
    await expect(createSafeFetch(undefined, resolver)('https://provider.example/v1/models', {
      headers: { authorization: `Bearer ${fixtureKey}` },
    })).rejects.toThrow();
    expect(fixture.outbound).not.toHaveBeenCalled();
  });

  it.each([
    'http://provider.example/v1/models', 'http://127.0.0.2/v1/models',
    'http://2130706433/v1/models', 'http://0x7f000001/v1/models', 'http://127.1/v1/models',
    'http://localhost./v1/models', 'http://localhost.example/v1/models',
    'https://127.0.0.1/v1/models', 'https://2130706433/v1/models',
    'https://[::ffff:127.0.0.1]/v1/models', 'https://[::ffff:808:808]/v1/models',
    'https://user:password@provider.example/v1/models', 'file:///tmp/fixture',
  ])('rejects unconfirmed or ambiguous network target %s', async target => {
    const fixture = httpsFixture();
    await expect(createSafeFetch(undefined, lookup([{ address: '8.8.8.8', family: 4 }]))(target)).rejects.toThrow();
    expect(fixture.outbound).not.toHaveBeenCalled();
  });

  describe('D138: 198.18.0.0/15', () => {
    it.each(['198.18.0.1', '198.19.255.254'])('connects when a name resolves to %s', async address => {
      const fixture = httpsFixture();
      await expect(createSafeFetch(undefined, lookup([{ address, family: 4 }]))('https://provider.example/v1/models')).resolves.toMatchObject({ status: 200 });
      expect(fixture.outbound).toHaveBeenCalledTimes(1);
    });
    it.each(['198.18.0.1', '198.19.255.254'])('refuses the literal address %s', async address => {
      const fixture = httpsFixture();
      await expect(createSafeFetch(undefined, lookup([]))(`https://${address}/v1/models`)).rejects.toMatchObject({ code: 'target_rejected' });
      expect(fixture.outbound).not.toHaveBeenCalled();
    });
    it.each(['10.0.0.1', '127.0.0.1', '169.254.169.254', '192.168.1.2', '198.51.100.1', 'fc00::1'])('refuses a name that also resolves to %s', async other => {
      const fixture = httpsFixture();
      await expect(createSafeFetch(undefined, lookup([{ address: '198.18.0.1', family: 4 }, { address: other, family: other.includes(':') ? 6 : 4 }]))('https://provider.example/v1/models'))
        .rejects.toMatchObject({ code: 'target_rejected' });
      expect(fixture.outbound).not.toHaveBeenCalled();
    });
  });

  it('rejects all DNS answers when one answer is private', async () => {
    const fixture = httpsFixture();
    await expect(createSafeFetch(undefined, lookup([
      { address: '8.8.8.8', family: 4 }, { address: '192.168.1.2', family: 4 },
    ]))('https://provider.example/v1/models')).rejects.toThrow();
    expect(fixture.outbound).not.toHaveBeenCalled();
  });

  it.each([{ records: [] }, { records: [{ address: '8.8.8.8', family: 6 }] }])('rejects empty or mismatched DNS records %#', async ({ records }) => {
    const fixture = httpsFixture();
    await expect(createSafeFetch(undefined, lookup(records))('https://provider.example/models')).rejects.toThrow();
    expect(fixture.outbound).not.toHaveBeenCalled();
  });

  it('requires every localhost answer to be loopback', async () => {
    await expect(createSafeFetch(undefined, lookup([
      { address: '127.0.0.1', family: 4 }, { address: '8.8.8.8', family: 4 },
    ]))('http://localhost:45678/models')).rejects.toThrow();
  });

  it('checks current authorization before DNS', async () => {
    const resolver = lookup([{ address: '8.8.8.8', family: 4 }]);
    await expect(createSafeFetch(() => { throw new Error('revoked'); }, resolver)('https://provider.example/models')).rejects.toThrow('revoked');
    expect(resolver).not.toHaveBeenCalled();
  });

  it('rechecks authorization after pending DNS and sends no stale credentials', async () => {
    const fixture = httpsFixture();
    let release!: (records: Array<{ address: string; family: number }>) => void;
    const resolver = (() => new Promise(resolve => { release = resolve; })) as typeof dnsLookup;
    let revoked = false;
    const pending = createSafeFetch(() => { if (revoked) throw new Error('revoked'); }, resolver)('https://provider.example/models', {
      headers: { authorization: `Bearer ${fixtureKey}` },
    });
    revoked = true;
    release([{ address: '8.8.8.8', family: 4 }]);
    await expect(pending).rejects.toThrow('revoked');
    expect(fixture.outbound).not.toHaveBeenCalled();
  });

  it.each(['8.8.8.8', '2606:4700:4700::1111'])('pins a public DNS answer %s while retaining the TLS hostname', async address => {
    const fixture = httpsFixture();
    const resolver = lookup([{ address, family: address.includes(':') ? 6 : 4 }]);
    const response = await createSafeFetch(undefined, resolver)('https://provider.example:443/v1/models', {
      headers: { authorization: `Bearer ${fixtureKey}` },
    });
    expect(await response.text()).toBe('fixture response');
    expect(resolver).toHaveBeenCalledExactlyOnceWith('provider.example', { all: true, verbatim: true });
    const options = fixture.outbound.mock.calls[0][1] as RequestOptions;
    expect(options).toMatchObject({ agent: false, servername: 'provider.example', rejectUnauthorized: true });
    const resolvePinned = options.lookup!;
    const callback = vi.fn();
    resolvePinned('provider.example', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address, family: address.includes(':') ? 6 : 4 }]);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('rechecks authorization after TLS connection before sending credentials', async () => {
    const fixture = httpsFixture(200, {}, '', false);
    let revoked = false;
    const pending = createSafeFetch(() => { if (revoked) throw new Error('revoked'); }, lookup([{ address: '8.8.8.8', family: 4 }]))('https://provider.example/models', {
      headers: { authorization: `Bearer ${fixtureKey}` },
    });
    await vi.waitFor(() => expect(fixture.outbound).toHaveBeenCalledTimes(1));
    revoked = true;
    fixture.socket.emit('secureConnect');
    await expect(pending).rejects.toThrow('revoked');
    expect(fixture.request.end).not.toHaveBeenCalled();
    expect(fixture.request.destroy).toHaveBeenCalled();
  });

  it('aborts while waiting for TLS without sending credentials', async () => {
    const fixture = httpsFixture(200, {}, '', false);
    const controller = new AbortController();
    const pending = createSafeFetch(undefined, lookup([{ address: '8.8.8.8', family: 4 }]))('https://provider.example/models', { signal: controller.signal });
    await vi.waitFor(() => expect(fixture.outbound).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    fixture.socket.emit('secureConnect');
    expect(fixture.request.end).not.toHaveBeenCalled();
  });

  it('does not emit a body or an unhandled error when an empty response is aborted', async () => {
    const fixture = httpsFixture(204, {}, '');
    const controller = new AbortController();
    const response = await createSafeFetch(undefined, lookup([{ address: '8.8.8.8', family: 4 }]))('https://provider.example/models', { signal: controller.signal });
    expect(response.body).toBeNull();
    controller.abort();
    expect(fixture.response.destroyed).toBe(true);
  });

  it('requests identity encoding and rejects compressed responses', async () => {
    const fixture = httpsFixture(200, { 'content-encoding': 'gzip' });
    await expect(createSafeFetch(undefined, lookup([{ address: '8.8.8.8', family: 4 }]))('https://provider.example/models')).rejects.toThrow('Unsupported response encoding');
    expect((fixture.outbound.mock.calls[0][1] as RequestOptions).headers).toMatchObject({ 'accept-encoding': 'identity' });
    expect(fixture.response.destroyed).toBe(true);
  });

  it('ignores ambient proxy and global-agent configuration', async () => {
    const fixture = httpsFixture();
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:1');
    try {
      const response = await createSafeFetch(undefined, lookup([{ address: '8.8.8.8', family: 4 }]))('https://provider.example/models');
      await response.body?.cancel();
      expect(fixture.outbound.mock.calls[0][1]).toMatchObject({ agent: false });
    } finally { vi.unstubAllEnvs(); }
  });

  it('returns a redirect without a second request or origin change', async () => {
    const fixture = httpsFixture(307, { location: 'https://other.example/credential-target' });
    const response = await createSafeFetch(undefined, lookup([{ address: '8.8.8.8', family: 4 }]))('https://provider.example/models', {
      redirect: 'follow', headers: { authorization: `Bearer ${fixtureKey}` },
    });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://other.example/credential-target');
    await response.body?.cancel();
    expect(fixture.outbound).toHaveBeenCalledTimes(1);
  });

  it.each([
    { method: 'PUT', body: 'fixture' }, { method: 'POST', body: new Uint8Array([1]) },
    { method: 'POST', body: new URLSearchParams({ fixture: 'value' }) }, { method: 'GET', body: 'fixture' },
  ])('rejects unsupported request shape %# without DNS', async init => {
    const resolver = lookup([{ address: '8.8.8.8', family: 4 }]);
    await expect(createSafeFetch(undefined, resolver)('https://provider.example/models', init)).rejects.toThrow();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('aborts during pending DNS without starting a request', async () => {
    const fixture = httpsFixture();
    const controller = new AbortController();
    let release!: (records: Array<{ address: string; family: number }>) => void;
    const resolver = (() => new Promise(resolve => { release = resolve; })) as typeof dnsLookup;
    const pending = createSafeFetch(undefined, resolver)('https://provider.example/models', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    release([{ address: '8.8.8.8', family: 4 }]);
    await Promise.resolve();
    expect(fixture.outbound).not.toHaveBeenCalled();
  });

  it('sends a string POST body and exposes standard Response headers and body', async () => {
    await localFixture(response => { response.writeHead(201, { 'content-type': 'text/plain', 'x-fixture': 'yes' }); response.end('已完成'); }, async (url, _closed, requests) => {
      const response = await createSafeFetch()(`${url}/v1/chat/completions`, {
        method: 'POST', headers: { authorization: `Bearer ${fixtureKey}` }, body: '{"fixture":true}',
      });
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(201);
      expect(response.headers.get('x-fixture')).toBe('yes');
      expect(await response.text()).toBe('已完成');
      expect(requests).toEqual([`POST /v1/chat/completions Bearer ${fixtureKey} {"fixture":true}`]);
    });
  });

  it('uses only a validated loopback DNS answer for localhost', async () => {
    await localFixture(response => response.end('local'), async url => {
      const resolver = lookup([{ address: '127.0.0.1', family: 4 }]);
      const response = await createSafeFetch(undefined, resolver)(url.replace('127.0.0.1', 'localhost'));
      expect(await response.text()).toBe('local');
      expect(resolver).toHaveBeenCalledTimes(1);
    });
  });

  it.each(['cancel', 'abort'] as const)('closes the real streaming socket on %s', async action => {
    await localFixture(response => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write('partial'); }, async (url, closed, requests) => {
      const controller = new AbortController();
      const response = await createSafeFetch()(`${url}/models`, { signal: controller.signal });
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('partial');
      if (action === 'cancel') await reader.cancel();
      else {
        controller.abort();
        await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
      }
      await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('Socket was not closed')), 1500))]);
      expect(requests).toHaveLength(1);
    });
  });
});
