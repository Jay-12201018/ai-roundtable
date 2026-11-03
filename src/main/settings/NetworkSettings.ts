import { lookup } from 'node:dns/promises';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { join } from 'node:path';
import { ContractError } from '../../shared/contracts/errors';
import { networkSettingsSchema, proxySettingsSchema, type NetworkSettings, type ProxySettings, type ProxyStatus, type ProxyTestResult } from '../../shared/schemas/network';
import type { ProxyRoute } from '../providers/proxyTunnel';

const FILE = 'network-settings.json';
/** Only used to read the setting and test a connection: a host every first-time user is likely to reach. No Key or content is sent. */
const TEST_HOST = 'api.deepseek.com';
const off: ProxySettings = { enabled: false, manual: null };

export type ParsedProxy = { state: 'direct' } | { state: 'proxy'; host: string; port: number } | { state: 'unsupported'; scheme: 'socks' | 'https' | 'other' };
/**
 * D137: what Chromium's proxy resolution (`session.resolveProxy`) answers, in PAC form: "PROXY a:1; SOCKS5 b:2; DIRECT".
 * It is tried in order. Leading DIRECT means no proxy for this target. Otherwise the first HTTP proxy is used, since this
 * transport speaks HTTP CONNECT; a list with no HTTP proxy is reported, and never quietly becomes a direct connection.
 */
export function parseProxyList(list: string): ParsedProxy {
  const entries = list.split(';').map(entry => entry.trim()).filter(Boolean).map(entry => {
    const [scheme = '', address = ''] = entry.split(/\s+/u);
    return { scheme: scheme.toUpperCase(), address };
  });
  if (!entries.length || entries[0]!.scheme === 'DIRECT') return { state: 'direct' };
  for (const { scheme, address } of entries) {
    if (scheme !== 'PROXY' && scheme !== 'HTTP') continue;
    const match = /^(.+):(\d{1,5})$/u.exec(address);
    if (match && Number(match[2]) >= 1 && Number(match[2]) <= 65535) return { state: 'proxy', host: match[1]!.replace(/^\[|\]$/gu, ''), port: Number(match[2]) };
  }
  const first = entries[0]!.scheme;
  return { state: 'unsupported', scheme: first.startsWith('SOCKS') ? 'socks' : first === 'HTTPS' || first === 'QUIC' ? 'https' : 'other' };
}

/**
 * D137: one switch. Off connects directly; on follows the operating system's proxy setting, read for each request's
 * target, or the address typed by hand when there is one. Takes effect on the next request; nothing scans this computer.
 */
export class NetworkSettingsService {
  private saved: ProxySettings;
  private readonly savedInvalid: boolean;

  constructor(private readonly directory: string, private readonly resolveSystemProxy: (url: string) => Promise<string>) {
    const { value, invalid } = this.read();
    this.saved = value; this.savedInvalid = invalid;
  }

  private read(): { value: ProxySettings; invalid: boolean } {
    let text: string;
    try { text = readFileSync(join(this.directory, FILE), 'utf8'); } catch { return { value: off, invalid: false }; }
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      // The earlier format: a switch, a host and a port, when a proxy was always typed by hand.
      if ('host' in data && 'port' in data) return { value: data.enabled === true ? { enabled: true, manual: { host: String(data.host), port: Number(data.port) } } : off, invalid: false };
      const parsed = proxySettingsSchema.safeParse(data);
      return parsed.success ? { value: parsed.data, invalid: false } : { value: off, invalid: true };
    } catch { return { value: off, invalid: true }; }
  }

  private async statusOf(settings: ProxySettings, url: string): Promise<ProxyStatus> {
    if (!settings.enabled) return { state: 'off' };
    if (settings.manual) return { state: 'proxy', source: 'manual', ...settings.manual };
    const parsed = parseProxyList(await this.resolveSystemProxy(url));
    return parsed.state === 'proxy' ? { ...parsed, source: 'system' } : parsed;
  }

  /** The route of one request, read now, so a change in the settings or the system applies at once. */
  readonly route = async (url: URL): Promise<ProxyRoute> => {
    const status = await this.statusOf(this.saved, url.href);
    return status.state === 'proxy' ? { kind: 'http', hostname: status.host, port: status.port } : status.state === 'unsupported' ? { kind: 'unsupported' } : { kind: 'direct' };
  };

  async getSettings(): Promise<NetworkSettings> {
    return networkSettingsSchema.parse({ saved: this.saved, status: await this.statusOf(this.saved, `https://${TEST_HOST}/`), savedInvalid: this.savedInvalid });
  }

  async saveSettings(input: ProxySettings): Promise<NetworkSettings> {
    const parsed = proxySettingsSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input');
    const path = join(this.directory, FILE); const temporary = `${path}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(parsed.data) + '\n', { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, path);
    } catch { throw new ContractError('internal_error'); }
    this.saved = parsed.data;
    return this.getSettings();
  }

  /** One connection the way these settings would connect, closed before TLS: no Key or content is sent. */
  async testProxy(input: ProxySettings, timeoutMs = 8000): Promise<ProxyTestResult> {
    const parsed = proxySettingsSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input');
    const status = await this.statusOf(parsed.data, `https://${TEST_HOST}/`);
    if (status.state === 'unsupported') return { ok: false, via: 'proxy', failure: 'unsupported' };
    if (status.state !== 'proxy') return this.testDirect(timeoutMs);
    return new Promise(resolve => {
      let done = false;
      const finish = (result: ProxyTestResult) => { if (done) return; done = true; clearTimeout(timer); request.destroy(); resolve(result); };
      const request = httpRequest({ hostname: status.host, port: status.port, method: 'CONNECT', path: `${TEST_HOST}:443`, headers: { Host: `${TEST_HOST}:443` }, agent: false, maxHeaderSize: 8192 });
      const timer = setTimeout(() => finish({ ok: false, via: 'proxy', failure: 'timeout' }), timeoutMs);
      request.once('connect', (response, socket) => { socket.destroy(); finish(response.statusCode === 200 ? { ok: true, via: 'proxy' } : { ok: false, via: 'proxy', failure: 'rejected' }); });
      request.once('response', response => { response.destroy(); finish({ ok: false, via: 'proxy', failure: 'rejected' }); });
      request.once('error', () => finish({ ok: false, via: 'proxy', failure: 'refused' }));
      request.end();
    });
  }

  private async testDirect(timeoutMs: number): Promise<ProxyTestResult> {
    try {
      const { address } = await lookup(TEST_HOST);
      return await new Promise(resolve => {
        const socket = netConnect({ host: address, port: 443 });
        const finish = (result: ProxyTestResult) => { clearTimeout(timer); socket.destroy(); resolve(result); };
        const timer = setTimeout(() => finish({ ok: false, via: 'direct', failure: 'timeout' }), timeoutMs);
        socket.once('connect', () => finish({ ok: true, via: 'direct' }));
        socket.once('error', () => finish({ ok: false, via: 'direct', failure: 'refused' }));
      });
    } catch { return { ok: false, via: 'direct', failure: 'refused' }; }
  }
}
