// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { NetworkSettingsService, parseProxyList } from '../../../src/main/settings/NetworkSettings';

const directories: string[] = []; const servers: Server[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
  await Promise.all(servers.splice(0).map(server => new Promise(done => { server.closeAllConnections(); server.close(done); })));
});
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'r16-network-')); directories.push(dir); return dir; };
const target = new URL('https://api.deepseek.com/chat/completions');
const service = (system = 'DIRECT', dir = directory()) => new NetworkSettingsService(dir, vi.fn(async () => system));

it.each([
  ['DIRECT', { state: 'direct' }], ['', { state: 'direct' }],
  ['PROXY 127.0.0.1:7890', { state: 'proxy', host: '127.0.0.1', port: 7890 }],
  ['PROXY 10.0.0.5:3128; DIRECT', { state: 'proxy', host: '10.0.0.5', port: 3128 }],
  ['DIRECT; PROXY 127.0.0.1:7890', { state: 'direct' }],
  ['PROXY [::1]:8080', { state: 'proxy', host: '::1', port: 8080 }],
  ['SOCKS5 127.0.0.1:1080; PROXY 127.0.0.1:7890', { state: 'proxy', host: '127.0.0.1', port: 7890 }],
  ['SOCKS5 127.0.0.1:1080', { state: 'unsupported', scheme: 'socks' }],
  ['SOCKS5 127.0.0.1:1080; DIRECT', { state: 'unsupported', scheme: 'socks' }],
  ['HTTPS proxy.example:443', { state: 'unsupported', scheme: 'https' }],
])('D137 reads the system answer %j', (list, parsed) => {
  expect(parseProxyList(list)).toEqual(parsed);
});

it('D137 is off by default and then connects directly, without even asking the system', async () => {
  const system = vi.fn(async () => 'PROXY 127.0.0.1:7890');
  const off = new NetworkSettingsService(directory(), system);
  expect(await off.getSettings()).toEqual({ saved: { enabled: false, manual: null }, status: { state: 'off' }, savedInvalid: false });
  expect(await off.route(target)).toEqual({ kind: 'direct' });
  expect(system).not.toHaveBeenCalled();
});

it('D137 follows the system setting for each target, at once and for the next launch', async () => {
  const dir = directory();
  const system = vi.fn(async (url: string) => url.includes('direct.example') ? 'DIRECT' : 'PROXY 127.0.0.1:7890');
  const settings = new NetworkSettingsService(dir, system);
  expect(await settings.saveSettings({ enabled: true, manual: null })).toMatchObject({ status: { state: 'proxy', source: 'system', host: '127.0.0.1', port: 7890 } });
  expect(statSync(join(dir, 'network-settings.json')).mode & 0o777).toBe(0o600);
  expect(await settings.route(target)).toEqual({ kind: 'http', hostname: '127.0.0.1', port: 7890 });
  expect(await settings.route(new URL('https://direct.example/v1/models'))).toEqual({ kind: 'direct' });
  expect(system).toHaveBeenCalledWith(target.href);
  expect(await new NetworkSettingsService(dir, system).route(target)).toEqual({ kind: 'http', hostname: '127.0.0.1', port: 7890 });
  await settings.saveSettings({ enabled: false, manual: null });
  expect(await settings.route(target)).toEqual({ kind: 'direct' });
});

it('D137 says when the system has no proxy, and connects directly', async () => {
  const settings = service('DIRECT');
  expect(await settings.saveSettings({ enabled: true, manual: null })).toMatchObject({ status: { state: 'direct' } });
  expect(await settings.route(target)).toEqual({ kind: 'direct' });
});

it('D137 reports a proxy type it cannot use and never connects directly instead', async () => {
  const settings = service('SOCKS5 127.0.0.1:1080; DIRECT');
  expect(await settings.saveSettings({ enabled: true, manual: null })).toMatchObject({ status: { state: 'unsupported', scheme: 'socks' } });
  expect(await settings.route(target)).toEqual({ kind: 'unsupported' });
  expect(await settings.testProxy({ enabled: true, manual: null })).toEqual({ ok: false, via: 'proxy', failure: 'unsupported' });
});

it('D137 prefers an address typed by hand over the system', async () => {
  const system = vi.fn(async () => 'SOCKS5 127.0.0.1:1080');
  const settings = new NetworkSettingsService(directory(), system);
  expect(await settings.saveSettings({ enabled: true, manual: { host: 'proxy.lan', port: 3128 } })).toMatchObject({ status: { state: 'proxy', source: 'manual', host: 'proxy.lan', port: 3128 } });
  expect(await settings.route(target)).toEqual({ kind: 'http', hostname: 'proxy.lan', port: 3128 });
  expect(system).not.toHaveBeenCalled();
});

it('D137 reads a file saved by an earlier version, and treats an unusable one as off', async () => {
  const dir = directory();
  writeFileSync(join(dir, 'network-settings.json'), '{"enabled":true,"host":"127.0.0.1","port":7890,"trustProxyDns":true}');
  expect(await new NetworkSettingsService(dir, async () => 'DIRECT').getSettings()).toMatchObject({ saved: { enabled: true, manual: { host: '127.0.0.1', port: 7890 } }, savedInvalid: false });
  writeFileSync(join(dir, 'network-settings.json'), '{"enabled":true,"manual":{"host":"has space","port":1}}');
  expect(await new NetworkSettingsService(dir, async () => 'DIRECT').getSettings()).toMatchObject({ saved: { enabled: false, manual: null }, savedInvalid: true });
  writeFileSync(join(dir, 'network-settings.json'), 'not json');
  expect(await new NetworkSettingsService(dir, async () => 'DIRECT').getSettings()).toMatchObject({ savedInvalid: true, status: { state: 'off' } });
});

it.each([
  { enabled: true, manual: { host: 'http://proxy', port: 1 } }, { enabled: true, manual: { host: 'a b', port: 1 } }, { enabled: true, manual: { host: 'proxy', port: 0 } },
  { enabled: true, manual: { host: 'proxy', port: 65536 } }, { enabled: true, manual: null, extra: 1 }, { enabled: 'yes', manual: null },
])('D137 refuses to save %j', async input => {
  const dir = directory();
  await expect(service('DIRECT', dir).saveSettings(input as never)).rejects.toMatchObject({ code: 'invalid_input' });
  expect(() => readFileSync(join(dir, 'network-settings.json'))).toThrow();
});

/** A local HTTP server answering CONNECT with the given status. */
async function connectServer(status: number) {
  const seen: string[] = [];
  const server = createServer((_req, res) => { res.writeHead(500); res.end(); });
  server.on('connect', (req, socket) => { seen.push(String(req.url)); socket.write(`HTTP/1.1 ${status} X\r\n\r\n`); socket.end(); });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as { port: number }).port, seen };
}

it('tests a typed proxy with one CONNECT and says what happened, without sending any Key or content', async () => {
  const ok = await connectServer(200);
  const settings = service();
  const manual = (port: number) => ({ enabled: true, manual: { host: '127.0.0.1', port } });
  expect(await settings.testProxy(manual(ok.port))).toEqual({ ok: true, via: 'proxy' });
  expect(ok.seen).toEqual(['api.deepseek.com:443']);
  const rejected = await connectServer(403);
  expect(await settings.testProxy(manual(rejected.port))).toEqual({ ok: false, via: 'proxy', failure: 'rejected' });
  const closed = await connectServer(200);
  await new Promise(done => { servers.pop()!.close(done); });
  expect(await settings.testProxy(manual(closed.port))).toEqual({ ok: false, via: 'proxy', failure: 'refused' });
  await expect(settings.testProxy({ enabled: true, manual: { host: '127.0.0.1', port: 0 } })).rejects.toMatchObject({ code: 'invalid_input' });
});
