// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { NetworkSettingsService } from '../../../src/main/settings/NetworkSettings';

const directories: string[] = []; const servers: Server[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
  await Promise.all(servers.splice(0).map(server => new Promise(done => { server.closeAllConnections(); server.close(done); })));
});
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'r16-network-')); directories.push(dir); return dir; };
const saved = { enabled: true, host: '127.0.0.1' as const, port: 7890, trustProxyDns: true };

it('D115 uses the saved loopback proxy from the next launch, and says a restart is needed until then', () => {
  const dir = directory();
  const first = new NetworkSettingsService(dir, {});
  expect(first.proxy).toBeUndefined();
  expect(first.getSettings()).toEqual({ saved: null, effective: { source: 'none', proxy: null }, restartRequired: false, savedInvalid: false });
  expect(first.saveSettings(saved)).toMatchObject({ saved, effective: { source: 'none' }, restartRequired: true });
  expect(statSync(join(dir, 'network-settings.json')).mode & 0o777).toBe(0o600);
  const next = new NetworkSettingsService(dir, {});
  expect(next.proxy).toEqual({ hostname: '127.0.0.1', port: 7890 });
  expect(next.getSettings()).toMatchObject({ effective: { source: 'settings', proxy: { host: '127.0.0.1', port: 7890 } }, restartRequired: false });
  expect(next.saveSettings({ ...saved, enabled: false })).toMatchObject({ restartRequired: true });
});

it('D115 lets the environment win, keeps its startup refusal, and ignores an unusable saved file', () => {
  const dir = directory();
  new NetworkSettingsService(dir, {}).saveSettings(saved);
  const env = { ROUNDTABLE_CONNECT_PROXY: 'http://[::1]:1080', ROUNDTABLE_TRUST_PROXY_DNS: '1' };
  const fromEnv = new NetworkSettingsService(dir, env);
  expect(fromEnv.proxy).toEqual({ hostname: '::1', port: 1080 });
  expect(fromEnv.getSettings()).toMatchObject({ effective: { source: 'environment', proxy: { host: '::1', port: 1080 } }, restartRequired: false });
  expect(() => new NetworkSettingsService(dir, { ROUNDTABLE_CONNECT_PROXY: 'http://127.0.0.1:7890' })).toThrow();
  // Set but disabled environment still means "the environment decides": the file is not used for this launch.
  writeFileSync(join(dir, 'network-settings.json'), '{"enabled":true,"host":"10.0.0.1","port":1,"trustProxyDns":true}');
  const invalid = new NetworkSettingsService(dir, {});
  expect(invalid.proxy).toBeUndefined();
  expect(invalid.getSettings()).toMatchObject({ saved: null, savedInvalid: true, effective: { source: 'none' } });
});

it.each([
  { ...saved, trustProxyDns: false }, { ...saved, host: 'localhost' }, { ...saved, port: 0 }, { ...saved, port: 65536 }, { ...saved, extra: 1 },
])('D115 refuses to save %j', input => {
  const dir = directory();
  expect(() => new NetworkSettingsService(dir, {}).saveSettings(input as never)).toThrowError(expect.objectContaining({ code: 'invalid_input' }));
  expect(() => readFileSync(join(dir, 'network-settings.json'))).toThrow();
});

it('D115 checks a proxy with one keyless CONNECT to the fixed DeepSeek host', async () => {
  const seen: Array<{ method?: string; url?: string; headers: Record<string, unknown> }> = [];
  const listen = (status: number) => new Promise<number>(done => {
    const server = createServer(); servers.push(server);
    server.on('connect', (request, socket) => { seen.push({ method: request.method, url: request.url, headers: request.headers }); socket.end(`HTTP/1.1 ${status} X\r\n\r\n`); });
    server.listen(0, '127.0.0.1', () => done((server.address() as { port: number }).port));
  });
  const service = new NetworkSettingsService(directory(), {});
  expect(await service.testProxy({ host: '127.0.0.1', port: await listen(200) })).toEqual({ ok: true, target: 'api.deepseek.com' });
  expect(await service.testProxy({ host: '127.0.0.1', port: await listen(403) })).toEqual({ ok: false, target: 'api.deepseek.com', failure: 'rejected' });
  const closed = await listen(200); await new Promise(done => { servers.pop()!.close(done); });
  expect(await service.testProxy({ host: '127.0.0.1', port: closed })).toEqual({ ok: false, target: 'api.deepseek.com', failure: 'refused' });
  expect(seen.map(item => [item.method, item.url])).toEqual([['CONNECT', 'api.deepseek.com:443'], ['CONNECT', 'api.deepseek.com:443']]);
  expect(seen.every(item => !('authorization' in item.headers) && !('proxy-authorization' in item.headers))).toBe(true);
  await expect(service.testProxy({ host: '10.0.0.1', port: 80 } as never)).rejects.toMatchObject({ code: 'invalid_input' });
});
