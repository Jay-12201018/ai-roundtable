import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { ContractError } from '../../shared/contracts/errors';
import { networkSettingsSchema, proxyEndpointSchema, proxySettingsSchema, type NetworkSettings, type ProxyEndpoint, type ProxySettings, type ProxyTestResult } from '../../shared/schemas/network';
import { proxyTargetHost, readLoopbackProxy, type LoopbackProxy } from '../providers/loopbackProxy';

const FILE = 'network-settings.json';
type Effective = NetworkSettings['effective'];

/**
 * D115 (R16 D3-B): the proxy saved on the settings page. It feeds the same launch-time choice as
 * ROUNDTABLE_CONNECT_PROXY + ROUNDTABLE_TRUST_PROXY_DNS=1: loopback HTTP only, remote name resolution explicitly
 * trusted, fixed official targets (D093). The environment, when set, wins and the saved file is not read for it.
 */
export class NetworkSettingsService {
  private readonly effective: Effective;
  readonly proxy: LoopbackProxy | undefined;

  constructor(private readonly directory: string, env: NodeJS.ProcessEnv) {
    // An invalid environment stays a startup failure, as before; only the saved file falls back to a direct connection.
    const fromEnvironment = readLoopbackProxy(env);
    const environmentSet = env.ROUNDTABLE_CONNECT_PROXY !== undefined || env.ROUNDTABLE_TRUST_PROXY_DNS !== undefined;
    const saved = this.read();
    const fromSettings = !environmentSet && saved.value?.enabled ? Object.freeze({ hostname: saved.value.host, port: saved.value.port }) : undefined;
    this.proxy = fromEnvironment ?? fromSettings;
    this.effective = { source: fromEnvironment ? 'environment' : fromSettings ? 'settings' : 'none',
      proxy: this.proxy ? { host: this.proxy.hostname, port: this.proxy.port } : null };
  }

  private read(): { value: ProxySettings | null; invalid: boolean } {
    let text: string;
    try { text = readFileSync(join(this.directory, FILE), 'utf8'); } catch { return { value: null, invalid: false }; }
    try {
      const parsed = proxySettingsSchema.safeParse(JSON.parse(text));
      return parsed.success ? { value: parsed.data, invalid: false } : { value: null, invalid: true };
    } catch { return { value: null, invalid: true }; }
  }

  private describe(): NetworkSettings {
    const { value, invalid } = this.read();
    const wanted = value?.enabled ? { host: value.host, port: value.port } : null;
    const restartRequired = this.effective.source !== 'environment' && JSON.stringify(wanted) !== JSON.stringify(this.effective.proxy);
    return networkSettingsSchema.parse({ saved: value, effective: this.effective, restartRequired, savedInvalid: invalid });
  }

  getSettings(): NetworkSettings { return this.describe(); }

  saveSettings(input: ProxySettings): NetworkSettings {
    const parsed = proxySettingsSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input');
    const path = join(this.directory, FILE); const temporary = `${path}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(parsed.data) + '\n', { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, path);
    } catch { throw new ContractError('internal_error'); }
    return this.describe();
  }

  /** One CONNECT to the fixed DeepSeek host through the loopback proxy; the tunnel is closed before TLS, so no Key or content is sent. */
  testProxy(input: ProxyEndpoint, timeoutMs = 8000): Promise<ProxyTestResult> {
    const parsed = proxyEndpointSchema.safeParse(input);
    if (!parsed.success) return Promise.reject(new ContractError('invalid_input'));
    const host = proxyTargetHost('deepseek') as 'api.deepseek.com';
    return new Promise(resolve => {
      let done = false;
      const finish = (result: ProxyTestResult) => { if (done) return; done = true; clearTimeout(timer); request.destroy(); resolve(result); };
      const request = httpRequest({ hostname: parsed.data.host, port: parsed.data.port, method: 'CONNECT', path: `${host}:443`, headers: { Host: `${host}:443` }, agent: false, maxHeaderSize: 8192 });
      const timer = setTimeout(() => finish({ ok: false, target: host, failure: 'timeout' }), timeoutMs);
      request.once('connect', (response, socket) => { socket.destroy(); finish(response.statusCode === 200 ? { ok: true, target: host } : { ok: false, target: host, failure: 'rejected' }); });
      request.once('response', response => { response.destroy(); finish({ ok: false, target: host, failure: 'rejected' }); });
      request.once('error', () => finish({ ok: false, target: host, failure: 'refused' }));
      request.end();
    });
  }
}
