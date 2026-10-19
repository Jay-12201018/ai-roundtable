// @vitest-environment node
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect as netConnect, type Socket } from 'node:net';
import * as tls from 'node:tls';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createSafeFetch } from '../../../src/main/providers/network';
import { readLoopbackProxy } from '../../../src/main/providers/loopbackProxy';
import { TrialDiagnostics } from '../../../src/main/providers/diagnostics';
import { ContractError } from '../../../src/shared/contracts/errors';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { ControlledTrialService } from '../../../src/main/providers/controlledTrial/ControlledTrialService';

vi.mock('node:tls', async actual => { const real = await actual<typeof import('node:tls')>(); return { ...real, connect: vi.fn(real.connect) }; });
const target = 'https://api.deepseek.com/chat/completions';
const fakeKey = 'owned-connect-fixture-fake-key';
const root = mkdtempSync(join(tmpdir(), 'roundtable-connect-test-'));
let ca: Buffer, key: Buffer, cert: Buffer, mismatch: Buffer;
const cleanups: Array<() => Promise<void>> = [];
beforeAll(() => {
  const openssl = (args: string[]) => execFileSync('/usr/bin/openssl', args, { cwd: root, stdio: 'ignore', timeout: 10000 });
  writeFileSync(join(root, 'extensions'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:api.deepseek.com\n');
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Owned fixture CA', '-keyout', 'ca.key', '-out', 'ca.pem']);
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=api.deepseek.com', '-keyout', 'server.key', '-out', 'server.csr']);
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-set_serial', '1', '-days', '1', '-extfile', 'extensions', '-out', 'server.pem']);
  writeFileSync(join(root, 'extensions'), 'basicConstraints=CA:FALSE\nsubjectAltName=DNS:wrong.fixture.invalid\n');
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-set_serial', '2', '-days', '1', '-extfile', 'extensions', '-out', 'mismatch.pem']);
  ca = readFileSync(join(root, 'ca.pem')); key = readFileSync(join(root, 'server.key')); cert = readFileSync(join(root, 'server.pem')); mismatch = readFileSync(join(root, 'mismatch.pem'));
});
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function fixture(mode: 'ok' | 'wrong-host' | 'no-ca' | 'extra' | 'malformed' | 'oversized' | 'hang' | 'redirect' | 'break' | number = 'ok') {
  const sockets = new Set<Socket>(); const connectHeaders: object[] = []; const calls: Array<{ method?: string; path?: string; body: string; keyMatches: boolean; sni: string }> = [];
  const server = httpsServer({ key, cert: mode === 'wrong-host' ? mismatch : cert }, (req, res) => {
    const parts: Buffer[] = []; req.on('data', part => parts.push(part)); req.on('end', () => {
      calls.push({ method: req.method, path: req.url, body: Buffer.concat(parts).toString(), keyMatches: req.headers.authorization === `Bearer ${fakeKey}`, sni: (req.socket as tls.TLSSocket).servername || '' });
      if (mode === 'redirect') { res.writeHead(302, { location: 'https://other.example/secret' }); res.end(); }
      else if (mode === 'break') { res.writeHead(200); res.write('partial'); setImmediate(() => res.destroy()); }
      else res.end('OK');
    });
  });
  server.on('tlsClientError', () => {});
  const proxy = httpServer((_req, res) => { res.writeHead(500); res.end(); });
  for (const s of [server, proxy]) s.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  proxy.on('connect', (req, client, head) => {
    connectHeaders.push(req.headers);
    expect(req.url).toBe('api.deepseek.com:443'); expect(head.length).toBe(0);
    if (mode === 'hang') return;
    if (typeof mode === 'number') { client.end(`HTTP/1.1 ${mode} Fixture\r\nContent-Length: 0\r\n\r\n`); return; }
    if (mode === 'extra') { client.end('HTTP/1.1 200 Connection Established\r\n\r\nUNSOLICITED'); return; }
    if (mode === 'malformed') { client.end('NOT HTTP\r\n\r\n'); return; }
    if (mode === 'oversized') { client.end(`HTTP/1.1 200 Connection Established\r\nX-Fixture: ${'x'.repeat(9000)}\r\n\r\n`); return; }
    const outbound = netConnect({ host: '127.0.0.1', port: (server.address() as { port: number }).port });
    sockets.add(outbound); outbound.once('close', () => sockets.delete(outbound)); outbound.on('error', () => client.destroy()); client.on('error', () => outbound.destroy());
    outbound.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); client.pipe(outbound).pipe(client); });
    client.once('close', () => outbound.destroy()); outbound.once('close', () => client.destroy());
  });
  await Promise.all([server, proxy].map(s => new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve))));
  cleanups.push(async () => { for (const socket of sockets) socket.destroy(); await Promise.all([server, proxy].map(s => new Promise<void>(resolve => s.close(() => resolve())))); });
  const real = await vi.importActual<typeof import('node:tls')>('node:tls');
  // This test CA is injected only in this fixture, never into application configuration or system trust.
  vi.mocked(tls.connect).mockImplementation(((options: tls.ConnectionOptions) => real.connect({ ...options, ...(mode === 'no-ca' ? {} : { ca }) })) as typeof tls.connect);
  const proxyConfig = readLoopbackProxy({ ROUNDTABLE_CONNECT_PROXY: `http://127.0.0.1:${(proxy.address() as { port: number }).port}`, ROUNDTABLE_TRUST_PROXY_DNS: '1' })!;
  const resolver = vi.fn(async () => [{ address: '198.18.0.12', family: 4 }]);
  const diagnostic = new TrialDiagnostics(() => {});
  const send = (signal?: AbortSignal, guard?: () => void) => createSafeFetch(guard, resolver as never, diagnostic.observe, proxyConfig)(target, {
    method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${fakeKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 128, thinking: { type: 'disabled' } }), signal,
  });
  return { send, calls, connectHeaders, resolver, diagnostic, proxyConfig };
}

it('keeps direct Fake-IP rejection and creates no CONNECT or TLS attempt', async () => {
  const f = await fixture();
  await expect(createSafeFetch(undefined, f.resolver as never, f.diagnostic.observe)(target)).rejects.toThrow('Unsafe');
  expect(f.diagnostic.snapshot()).toMatchObject({ stage: 'dns', category: 'target_rejected', evidence: 'client_invoked' });
  expect(f.connectHeaders).toHaveLength(0); expect(tls.connect).not.toHaveBeenCalled();
});
it('uses domain CONNECT without local target DNS, authenticates TLS, and only then sends the request', async () => {
  const f = await fixture(); const res = await f.send(); expect(await res.text()).toBe('OK');
  expect(f.resolver).not.toHaveBeenCalled(); expect(f.connectHeaders).toHaveLength(1);
  expect(f.connectHeaders[0]).toEqual({ host: 'api.deepseek.com:443', connection: 'close' });
  expect(JSON.stringify(f.connectHeaders)).not.toContain(fakeKey);
  expect(f.calls).toEqual([{ method: 'POST', path: '/chat/completions', keyMatches: true, sni: 'api.deepseek.com', body: expect.stringContaining('"max_tokens":128') }]);
  expect(tls.connect).toHaveBeenCalledWith(expect.objectContaining({ servername: 'api.deepseek.com', rejectUnauthorized: true }));
  expect(f.diagnostic.snapshot()).toMatchObject({ evidence: 'http_response', httpStatus: 200 });
});
it.each(['wrong-host', 'no-ca'] as const)('rejects %s TLS before any API header or body', async mode => {
  const f = await fixture(mode); await expect(f.send()).rejects.toBeDefined();
  expect(f.calls).toHaveLength(0); expect(f.connectHeaders).toHaveLength(1); expect(f.resolver).not.toHaveBeenCalled();
  expect(f.diagnostic.snapshot()).toMatchObject({ stage: 'tls', category: 'tls_failed', evidence: 'client_invoked' });
  expect(JSON.stringify(f.diagnostic.snapshot())).not.toMatch(/owned-connect-fixture|stack|Authorization|CERT_/u);
});
it.each([302, 403, 407, 500, 'extra'] as const)('rejects proxy response %s without provider HTTP evidence or fallback', async mode => {
  const f = await fixture(mode); await expect(f.send()).rejects.toBeDefined();
  expect(f.diagnostic.snapshot()).toMatchObject({ stage: 'proxy', category: 'proxy_rejected', evidence: 'client_invoked' });
  expect(f.diagnostic.snapshot().httpStatus).toBeUndefined(); expect(f.calls).toHaveLength(0);
  expect(f.resolver).not.toHaveBeenCalled(); expect(tls.connect).not.toHaveBeenCalled(); expect(f.connectHeaders).toHaveLength(1);
});
it.each(['malformed', 'oversized'] as const)('rejects %s CONNECT headers without retaining their text', async mode => {
  const f = await fixture(mode); await expect(f.send()).rejects.toBeDefined();
  expect(f.diagnostic.snapshot()).toMatchObject({ stage: 'proxy', category: 'proxy_failed', evidence: 'client_invoked' });
  expect(f.diagnostic.snapshot().httpStatus).toBeUndefined(); expect(f.calls).toHaveLength(0); expect(f.resolver).not.toHaveBeenCalled();
});
it('aborts pending CONNECT without fallback or a second attempt', async () => {
  const f = await fixture('hang'); const abort = new AbortController();
  const pending = f.send(abort.signal); setTimeout(() => abort.abort(new ContractError('cancelled')), 30);
  await expect(pending).rejects.toBeDefined(); expect(f.calls).toHaveLength(0); expect(f.connectHeaders).toHaveLength(1); expect(f.resolver).not.toHaveBeenCalled();
  expect(f.diagnostic.snapshot()).toMatchObject({ stage: 'proxy', category: 'cancelled', evidence: 'client_invoked' });
});
it('distinguishes a CONNECT deadline from user cancellation without inventing an HTTP response', async () => {
  const f = await fixture('hang'); const abort = new AbortController();
  const pending = f.send(abort.signal); setTimeout(() => abort.abort(new ContractError('timeout')), 30);
  await expect(pending).rejects.toBeDefined();
  expect(f.diagnostic.snapshot()).toMatchObject({ stage: 'proxy', category: 'request_timeout', evidence: 'client_invoked' });
  expect(f.calls).toHaveLength(0); expect(f.connectHeaders).toHaveLength(1); expect(f.resolver).not.toHaveBeenCalled();
});
it('does not follow an origin redirect through the proxy', async () => {
  const f = await fixture('redirect'); const response = await f.send(); expect(response.status).toBe(302); await response.text();
  expect(f.calls).toHaveLength(1); expect(f.connectHeaders).toHaveLength(1); expect(f.resolver).not.toHaveBeenCalled();
  expect(f.diagnostic.snapshot()).toMatchObject({ evidence: 'http_response', httpStatus: 302 });
});
it('retains HTTP evidence when the tunneled response is interrupted', async () => {
  const f = await fixture('break'); const response = await f.send(); await expect(response.text()).rejects.toBeDefined();
  expect(f.diagnostic.snapshot()).toMatchObject({ stage: 'response', category: 'request_interrupted', evidence: 'http_response', httpStatus: 200 });
  expect(f.calls).toHaveLength(1);
});
it('rejects target revocation at CONNECT before TLS or any API bytes', async () => {
  const f = await fixture(); let count = 0;
  await expect(f.send(undefined, () => { if (++count >= 8) throw new ContractError('forbidden'); })).rejects.toBeDefined();
  expect(f.calls).toHaveLength(0); expect(f.resolver).not.toHaveBeenCalled();
});
it('persists proxy failure as unknown and retains the entire reservation across recovery', async () => {
  const f = await fixture(407); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-18T00:00:00Z'));
  const database = new Database(join(root, 'owned-proxy-reservation.db')); database.initialize();
  cleanups.push(async () => database.close());
  database.createProvider({ id: 'p', name: 'Owned proxy fixture', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', customModels: [{ id: 'deepseek-flash', name: 'Flash' }] });
  const keys = new KeyService(database, createMemoryKeyBackend()); await keys.storeKey('p', fakeKey);
  const registry = new ProviderRegistry(database, keys, { proxy: f.proxyConfig });
  registry.confirmTarget({ providerId: 'p', baseUrl: 'https://api.deepseek.com', confirmed: true });
  const service = new ControlledTrialService(database, registry, async () => true); cleanups.push(async () => service.shutdown());
  const row = await service.execute(service.prepare('p').id);
  expect(row).toMatchObject({ state: 'unknown', outcome: 'error', accountedMicroCny: null, reservedMicroCny: 50000,
    diagnostics: { stage: 'proxy', category: 'proxy_rejected', evidence: 'client_invoked' } });
  expect(row.diagnostics?.httpStatus).toBeUndefined(); expect(f.calls).toHaveLength(0); expect(f.connectHeaders).toHaveLength(1);
  database.recoverControlledTrials(); database.recoverControlledTrials();
  expect(database.listControlledTrials()).toEqual([row]); expect(() => service.prepare('p')).toThrow();
  expect(JSON.stringify(row)).not.toContain(fakeKey);
  const restored = new Database(join(root, 'owned-proxy-reservation.db')); restored.initialize();
  try { restored.recoverControlledTrials(); expect(restored.listControlledTrials()).toEqual([row]); } finally { restored.close(); }
});
it('rejects non-reviewed proxy origins before resolving any Key', async () => {
  const f = await fixture(); const database = new Database(':memory:'); database.initialize(); cleanups.push(async () => database.close());
  database.createProvider({ id: 'other', name: 'Other fixture', kind: 'openai-compatible', baseUrl: 'https://other.example', customModels: [] });
  const keys = new KeyService(database, createMemoryKeyBackend()); const read = vi.spyOn(keys, 'resolveKey');
  const registry = new ProviderRegistry(database, keys, { proxy: f.proxyConfig });
  registry.confirmTarget({ providerId: 'other', baseUrl: 'https://other.example', confirmed: true });
  expect(() => registry.getAdapter('other')).toThrow(); expect(read).not.toHaveBeenCalled(); expect(f.connectHeaders).toHaveLength(0);
});
