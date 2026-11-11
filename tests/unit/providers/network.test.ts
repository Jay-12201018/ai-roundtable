// @vitest-environment node
import { EventEmitter } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as https from 'node:https';
import { PassThrough } from 'node:stream';
import type { lookup as dnsLookup } from 'node:dns/promises';
import type { RequestOptions } from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NETWORK_CONNECT_TIMEOUT_MS, NETWORK_MAX_RETRIES, createSafeFetch as catalogFetch, networkPhaseOf, retryDelayMs } from '../../../src/main/providers/network';
import { ContractError } from '../../../src/shared/contracts/errors';
import { catalogServiceAt, serviceCatalog } from '../../../src/shared/serviceCatalog';

vi.mock('node:https', async importOriginal => ({ ...await importOriginal<typeof import('node:https')>(), request: vi.fn() }));

const fixtureKey = 'fixture-network-key';
// These cases are about what happens after the host check; the catalog has its own block below.
const createSafeFetch = (guard?: () => void, resolver?: typeof dnsLookup) => catalogFetch(guard, resolver, undefined, { has: () => true });
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

  describe('D143: only catalog hosts', () => {
    const answer = lookup([{ address: '8.8.8.8', family: 4 }]);
    it.each([
      'https://provider.example/v1/chat/completions', 'https://api.deepseek.com.example.com/chat/completions', 'https://evil-api.deepseek.com/chat/completions',
      'https://sub.api.deepseek.com/chat/completions', 'https://api.deepseek.com./chat/completions', 'https://api.deepseek.com:8443/chat/completions',
      'https://user:password@api.deepseek.com/chat/completions', 'https://api.deepseek.com@provider.example/chat/completions', 'http://api.deepseek.com/chat/completions',
      'https://1.2.3.4/chat/completions', 'https://16909060/chat/completions', 'https://0x1020304/chat/completions', 'https://1.2.3/chat/completions', 'https://[2606:4700:4700::1111]/chat/completions',
      'http://127.0.0.1:1234/chat/completions', 'http://localhost:1234/chat/completions', 'http://[::1]:1234/chat/completions',
    ])('refuses %s before resolving it', async target => {
      const fixture = httpsFixture(); const resolver = vi.fn(answer) as unknown as typeof dnsLookup;
      await expect(catalogFetch(undefined, resolver)(target, { headers: { authorization: `Bearer ${fixtureKey}` } })).rejects.toBeDefined();
      expect(resolver).not.toHaveBeenCalled();
      expect(fixture.outbound).not.toHaveBeenCalled();
    });
    it.each(serviceCatalog.map(service => service.baseUrl))('connects to %s', async baseUrl => {
      const fixture = httpsFixture();
      await expect(catalogFetch(undefined, answer)(`${baseUrl}/chat/completions`, { method: 'POST', body: '{}' })).resolves.toMatchObject({ status: 200 });
      expect(fixture.outbound).toHaveBeenCalledTimes(1);
    });
    it('compares addresses exactly when a saved service is matched to the catalog', () => {
      expect(catalogServiceAt(serviceCatalog, 'https://api.deepseek.com')?.id).toBe('deepseek');
      expect(catalogServiceAt(serviceCatalog, 'https://api.deepseek.com/')?.id).toBe('deepseek');
      for (const address of ['https://API.deepseek.com', 'https://api.deepseek.com.', 'https://api.deepseek.com/v1', 'http://api.deepseek.com', 'https://user@api.deepseek.com', ' https://api.deepseek.com', null, undefined, ''])
        expect(catalogServiceAt(serviceCatalog, address)).toBeUndefined();
    });
  });

  describe('D138: 198.18.0.0/15', () => {
    const catalogTarget = 'https://api.deepseek.com/chat/completions';
    it.each(['198.18.0.1', '198.19.255.254'])('connects when a catalog name resolves to %s', async address => {
      const fixture = httpsFixture();
      await expect(catalogFetch(undefined, lookup([{ address, family: 4 }]))(catalogTarget)).resolves.toMatchObject({ status: 200 });
      expect(fixture.outbound).toHaveBeenCalledTimes(1);
    });
    it.each(['198.18.0.1', '198.19.255.254'])('refuses a name outside the catalog that resolves to %s', async address => {
      const fixture = httpsFixture();
      await expect(catalogFetch(undefined, lookup([{ address, family: 4 }]))('https://provider.example/v1/chat/completions')).rejects.toMatchObject({ code: 'target_rejected' });
      expect(fixture.outbound).not.toHaveBeenCalled();
    });
    it.each(['198.18.0.1', '198.19.255.254'])('refuses the literal address %s', async address => {
      const fixture = httpsFixture();
      await expect(createSafeFetch(undefined, lookup([]))(`https://${address}/v1/models`)).rejects.toMatchObject({ code: 'target_rejected' });
      expect(fixture.outbound).not.toHaveBeenCalled();
    });
    it.each(['10.0.0.1', '127.0.0.1', '169.254.169.254', '192.168.1.2', '198.51.100.1', 'fc00::1'])('refuses a catalog name that also resolves to %s', async other => {
      const fixture = httpsFixture();
      await expect(catalogFetch(undefined, lookup([{ address: '198.18.0.1', family: 4 }, { address: other, family: other.includes(':') ? 6 : 4 }]))(catalogTarget))
        .rejects.toMatchObject({ code: 'target_rejected' });
      expect(fixture.outbound).not.toHaveBeenCalled();
    });
    it.each(['10.0.0.1', '127.0.0.1', '169.254.169.254', '192.168.1.2'])('refuses a catalog name that resolves to %s', async address => {
      const fixture = httpsFixture();
      await expect(catalogFetch(undefined, lookup([{ address, family: 4 }]))(catalogTarget)).rejects.toMatchObject({ code: 'target_rejected' });
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

  it('never goes through a shared connection agent', async () => {
    const fixture = httpsFixture();
    const response = await createSafeFetch(undefined, lookup([{ address: '8.8.8.8', family: 4 }]))('https://provider.example/models');
    await response.body?.cancel();
    expect(fixture.outbound.mock.calls[0][1]).toMatchObject({ agent: false });
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

describe('D166 a try that got no answer is made again, twice at most; a reply that has begun never is', () => {
  const local = (lookupFn: typeof dnsLookup, guard?: () => void) => catalogFetch(guard, lookupFn, undefined, { has: () => true });
  const closedPort = async () => { const server = createServer(); await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const { port } = server.address() as AddressInfo; await new Promise(done => server.close(done)); return port; };
  const dnsFailure = () => Object.assign(new TypeError('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
  const here = [{ address: '127.0.0.1', family: 4 }];
  it('a name that does not resolve is tried once more, and the second try can succeed', async () => {
    const server = createServer((_req, res) => res.end('ok'));
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    let tries = 0;
    const resolver = (async () => { tries++; if (tries === 1) throw dnsFailure(); return here; }) as unknown as typeof dnsLookup;
    try {
      const answer = await local(resolver)(`http://localhost:${port}/v1/x`);
      expect(await answer.text()).toBe('ok');
      expect(tries).toBe(2);
    } finally { server.close(); }
  });
  it('the policy: two more tries, half a second then one, less up to a quarter at random, eight seconds at most; five seconds to connect', () => {
    expect(NETWORK_MAX_RETRIES).toBe(2);
    expect(NETWORK_CONNECT_TIMEOUT_MS).toBe(5000);
    expect([0, 1, 2, 5, 9].map(attempt => retryDelayMs(attempt, () => 0))).toEqual([500, 1000, 2000, 8000, 8000]);
    expect(retryDelayMs(1, () => 1)).toBe(750);
  });
  it('a refused connection is tried three times in all, and no more; the failure says where', async () => {
    const port = await closedPort(); let tries = 0;
    const resolver = (async () => { tries++; return here; }) as unknown as typeof dnsLookup;
    const failure = await local(resolver)(`http://localhost:${port}/v1/x`, { method: 'POST', body: '{}' }).catch(error => error);
    expect(tries).toBe(3);
    expect(networkPhaseOf(failure)).toBe('tcp');
  }, 15000);
  it('two failures are ridden out, and the third try goes through', async () => {
    const server = createServer((_req, res) => res.end('third'));
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo; let tries = 0;
    const resolver = (async () => { tries++; if (tries <= 2) throw dnsFailure(); return here; }) as unknown as typeof dnsLookup;
    try { expect(await (await local(resolver)(`http://localhost:${port}/`)).text()).toBe('third'); expect(tries).toBe(3); } finally { server.close(); }
  }, 15000);
  it('a connection refused and then accepted goes through', async () => {
    const port = await closedPort(); let tries = 0; const server = createServer((_req, res) => res.end('second'));
    const resolver = (async () => { tries++; if (tries === 2) await new Promise<void>(done => server.listen(port, '127.0.0.1', done)); return here; }) as unknown as typeof dnsLookup;
    try { expect(await (await local(resolver)(`http://localhost:${port}/`)).text()).toBe('second'); expect(tries).toBe(2); } finally { server.close(); }
  });
  it('a request that went and got no answer at all is made again, and the answer to the second counts', async () => {
    let received = 0;
    const server = createServer((req, res) => { req.resume(); received++; if (received === 1) res.socket?.destroy(); else res.end('second'); });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    try {
      const answer = await local((async () => here) as unknown as typeof dnsLookup)(`http://localhost:${port}/`, { method: 'POST', body: '{"n":1}' });
      expect(await answer.text()).toBe('second');
      expect(received).toBe(2);
    } finally { server.close(); }
  }, 15000);
  it('and when no try gets an answer, the failure says the request had gone', async () => {
    let received = 0;
    const server = createServer((req, res) => { req.resume(); received++; res.socket?.destroy(); });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    try {
      const failure = await local((async () => here) as unknown as typeof dnsLookup)(`http://localhost:${port}/`, { method: 'POST', body: '{"n":1}' }).catch(error => error);
      expect(networkPhaseOf(failure)).toBe('request');
      expect(received).toBe(3);
    } finally { server.close(); }
  }, 15000);
  it.each([429, 500, 503, 408, 409])('an answer of %i means not now: it is asked again, and the next answer is the one returned', async status => {
    let received = 0;
    const server = createServer((req, res) => { req.resume(); received++; if (received === 1) { res.writeHead(status); res.end('busy'); } else res.end('fine'); });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    try {
      const answer = await local((async () => here) as unknown as typeof dnsLookup)(`http://localhost:${port}/`, { method: 'POST', body: '{}' });
      expect(answer.status).toBe(200); expect(await answer.text()).toBe('fine'); expect(received).toBe(2);
    } finally { server.close(); }
  }, 15000);
  it('the service\'s own retry-after is the wait, when it asks for one', async () => {
    let received = 0; const times: number[] = [];
    const server = createServer((req, res) => { req.resume(); received++; times.push(Date.now()); if (received === 1) { res.writeHead(429, { 'retry-after': '0.05' }); res.end(); } else res.end('fine'); });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    try {
      expect(await (await local((async () => here) as unknown as typeof dnsLookup)(`http://localhost:${port}/`)).text()).toBe('fine');
      expect(times[1]! - times[0]!).toBeLessThan(350);
    } finally { server.close(); }
  });
  it('an answer that says no for good (400, 401, 404) is returned as it is, at once; a still-busy service is returned after the last try', async () => {
    for (const status of [400, 401, 404]) {
      let received = 0;
      const server = createServer((req, res) => { req.resume(); received++; res.writeHead(status); res.end('no'); });
      await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
      const { port } = server.address() as AddressInfo;
      try { expect((await local((async () => here) as unknown as typeof dnsLookup)(`http://localhost:${port}/`)).status).toBe(status); expect(received).toBe(1); } finally { server.close(); }
    }
    let busy = 0;
    const server = createServer((req, res) => { req.resume(); busy++; res.writeHead(503); res.end('busy'); });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    try { expect((await local((async () => here) as unknown as typeof dnsLookup)(`http://localhost:${port}/`)).status).toBe(503); expect(busy).toBe(3); } finally { server.close(); }
  }, 15000);
  it('a reply cut off after it started is never tried again', async () => {
    let received = 0;
    const server = createServer((req, res) => { req.resume(); received++; res.writeHead(200); res.write('part'); setTimeout(() => res.socket?.destroy(), 10); });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    try {
      const answer = await local((async () => here) as unknown as typeof dnsLookup)(`http://localhost:${port}/`);
      await expect(answer.text()).rejects.toThrow();
      expect(received).toBe(1);
    } finally { server.close(); }
  });
  it('an abort ends it, before the second try and during the pause', async () => {
    const before = new AbortController(); let tries = 0;
    const resolver = (async () => { tries++; before.abort(); throw dnsFailure(); }) as unknown as typeof dnsLookup;
    await expect(local(resolver)('http://localhost:1/', { signal: before.signal })).rejects.toThrow();
    expect(tries).toBe(1);
    const during = new AbortController(); let again = 0;
    const slow = (async () => { again++; setTimeout(() => during.abort(), 20); throw dnsFailure(); }) as unknown as typeof dnsLookup;
    await expect(local(slow)('http://localhost:1/', { signal: during.signal })).rejects.toThrow();
    expect(again).toBe(1);
  });
  it('the guard is asked again first, and what it refuses is not tried', async () => {
    let tries = 0; let checks = 0; let refuse = false;
    const resolver = (async () => { tries++; refuse = true; throw dnsFailure(); }) as unknown as typeof dnsLookup;
    const guard = () => { checks++; if (refuse) throw new ContractError('forbidden'); };
    await expect(local(resolver, guard)('http://localhost:1/')).rejects.toMatchObject({ code: 'forbidden' });
    expect(tries).toBe(1); expect(checks).toBeGreaterThan(1);
  });
  it('a target the app refuses is not tried again', async () => {
    let tries = 0;
    const resolver = (async () => { tries++; return [{ address: '10.0.0.1', family: 4 }]; }) as unknown as typeof dnsLookup;
    await expect(catalogFetch(undefined, resolver, undefined, { has: () => true })('https://provider.example/')).rejects.toMatchObject({ code: 'target_rejected' });
    expect(tries).toBe(1);
  });
});

