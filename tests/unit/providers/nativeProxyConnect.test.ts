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

// R13A: the CONNECT proxy used to be hard-wired to api.deepseek.com; native origins tunnel to their own fixed host.
vi.mock('node:tls', async actual => { const real = await actual<typeof import('node:tls')>(); return { ...real, connect: vi.fn(real.connect) }; });
const root = mkdtempSync(join(tmpdir(), 'roundtable-native-connect-test-'));
let ca: Buffer, key: Buffer, cert: Buffer;
const cleanups: Array<() => Promise<void>> = [];
beforeAll(() => {
  const openssl = (args: string[]) => execFileSync('/usr/bin/openssl', args, { cwd: root, stdio: 'ignore', timeout: 10000 });
  writeFileSync(join(root, 'extensions'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:api.anthropic.com,DNS:generativelanguage.googleapis.com\n');
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Owned fixture CA', '-keyout', 'ca.key', '-out', 'ca.pem']);
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=api.anthropic.com', '-keyout', 'server.key', '-out', 'server.csr']);
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-set_serial', '1', '-days', '1', '-extfile', 'extensions', '-out', 'server.pem']);
  ca = readFileSync(join(root, 'ca.pem')); key = readFileSync(join(root, 'server.key')); cert = readFileSync(join(root, 'server.pem'));
});
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function fixture() {
  const sockets = new Set<Socket>(); const connects: string[] = []; const calls: Array<{ method?: string; path?: string; sni: string }> = [];
  const server = httpsServer({ key, cert }, (req, res) => {
    req.resume(); req.on('end', () => { calls.push({ method: req.method, path: req.url, sni: (req.socket as tls.TLSSocket).servername || '' }); res.end('OK'); });
  });
  const proxy = httpServer((_req, res) => { res.writeHead(500); res.end(); });
  for (const s of [server, proxy]) s.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  proxy.on('connect', (req, client) => {
    connects.push(req.url ?? '');
    const outbound = netConnect({ host: '127.0.0.1', port: (server.address() as { port: number }).port });
    sockets.add(outbound); outbound.on('error', () => client.destroy()); client.on('error', () => outbound.destroy());
    outbound.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); client.pipe(outbound).pipe(client); });
  });
  await Promise.all([server, proxy].map(s => new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve))));
  cleanups.push(async () => { for (const socket of sockets) socket.destroy(); await Promise.all([server, proxy].map(s => new Promise<void>(resolve => s.close(() => resolve())))); });
  const real = await vi.importActual<typeof import('node:tls')>('node:tls');
  // The owned CA is injected only into this fixture's TLS connections.
  vi.mocked(tls.connect).mockImplementation(((options: tls.ConnectionOptions) => real.connect({ ...options, ca })) as typeof tls.connect);
  const proxyConfig = async () => ({ kind: 'http' as const, hostname: '127.0.0.1', port: (proxy.address() as { port: number }).port });
  const resolver = vi.fn(async () => [{ address: '10.0.0.12', family: 4 }]);
  return { connects, calls, resolver, proxyConfig };
}

it.each([
  ['anthropic', 'https://api.anthropic.com/v1/messages', 'api.anthropic.com'],
  ['gemini', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse', 'generativelanguage.googleapis.com'],
] as const)('tunnels %s to its own host with authenticated TLS', async (kind, url, host) => {
  const f = await fixture();
  const response = await createSafeFetch(undefined, f.resolver as never, undefined, f.proxyConfig)(url, { method: 'POST', redirect: 'error', body: '{}' });
  expect(await response.text()).toBe('OK');
  expect(f.connects).toEqual([`${host}:443`]); expect(f.resolver).not.toHaveBeenCalled();
  expect(f.calls).toEqual([{ method: 'POST', path: new URL(url).pathname + new URL(url).search, sni: host }]);
  expect(tls.connect).toHaveBeenCalledWith(expect.objectContaining({ servername: host, rejectUnauthorized: true }));
});
it('D137 tunnels any https target and its port, and still verifies TLS', async () => {
  const f = await fixture();
  const response = await createSafeFetch(undefined, f.resolver as never, undefined, f.proxyConfig)('https://api.anthropic.com/v1/messages', { method: 'POST', redirect: 'error', body: '{}' });
  await response.text();
  expect(f.connects).toEqual(['api.anthropic.com:443']);
  expect(tls.connect).toHaveBeenCalledWith(expect.objectContaining({ rejectUnauthorized: true }));
});
it('D137 refuses a literal private address through a proxy too, and a proxy type it cannot use, before any CONNECT', async () => {
  const f = await fixture();
  await expect(createSafeFetch(undefined, f.resolver as never, undefined, f.proxyConfig)('https://192.168.1.2/v1/chat/completions', { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'target_rejected' });
  await expect(createSafeFetch(undefined, f.resolver as never, undefined, async () => ({ kind: 'unsupported' }))('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'proxy_unsupported' });
  expect(f.connects).toEqual([]); expect(f.calls).toEqual([]); expect(f.resolver).not.toHaveBeenCalled();
});
it('D137 reaches this computer directly whatever the proxy says', async () => {
  const f = await fixture();
  const resolve = vi.fn(async () => ({ kind: 'unsupported' as const }));
  await expect(createSafeFetch(undefined, f.resolver as never, undefined, resolve)('http://127.0.0.1:1/v1/models')).rejects.toBeDefined();
  expect(resolve).not.toHaveBeenCalled();
});
