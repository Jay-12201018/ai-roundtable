import { request as httpRequest } from 'node:http';
import { Agent, type RequestOptions } from 'node:https';
import { connect as tlsConnect } from 'node:tls';
import type { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import { ContractError } from '../../shared/contracts/errors';
import type { DiagnosticObserver } from './diagnostics';

export type LoopbackProxy = Readonly<{ hostname: '127.0.0.1' | '::1'; port: number }>;

// Explicit Main launch configuration only; never adopt ambient HTTP_PROXY or system settings.
export function readLoopbackProxy(env: NodeJS.ProcessEnv): LoopbackProxy | undefined {
  const raw = env.ROUNDTABLE_CONNECT_PROXY;
  if (raw === undefined && env.ROUNDTABLE_TRUST_PROXY_DNS === undefined) return undefined;
  const match = /^http:\/\/(127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})\/?$/u.exec(raw ?? '');
  if (!match || Number(match[2]) > 65535 || env.ROUNDTABLE_TRUST_PROXY_DNS !== '1') throw new ContractError('invalid_input');
  return Object.freeze({ hostname: match[1] === '[::1]' ? '::1' : '127.0.0.1', port: Number(match[2]) });
}

export function assertProxyTarget(url: URL, method: string): void {
  // Remote DNS is delegated to the explicitly trusted local proxy, not proven public by this client.
  // A fixed reviewed origin plus authenticated TLS prevents arbitrary compatible-origin SSRF.
  if (url.href !== 'https://api.deepseek.com/chat/completions' || method !== 'POST') throw new ContractError('forbidden');
}

/** One CONNECT + one TLS socket, no pooling, proxy authentication, redirect, retry or direct fallback. */
export class LoopbackProxyAgent extends Agent {
  constructor(private readonly proxy: LoopbackProxy, private readonly guard: (() => void) | undefined,
    private readonly signal: AbortSignal | null | undefined, private readonly observe?: DiagnosticObserver) {
    super({ keepAlive: false, maxSockets: 1 });
    if (!['127.0.0.1', '::1'].includes(proxy.hostname) || !Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) throw new ContractError('invalid_input');
  }

  override createConnection(options: RequestOptions, callback: (error: Error | null, stream: Duplex) => void): undefined {
    const { proxy, signal, observe, guard } = this;
    if (options.host !== 'api.deepseek.com' || Number(options.port) !== 443 || options.servername !== 'api.deepseek.com'
      || options.rejectUnauthorized !== true) throw new ContractError('forbidden');
    let tunnel: Socket | undefined; let secure: ReturnType<typeof tlsConnect> | undefined;
    let request: ReturnType<typeof httpRequest> | undefined;
    let finished = false; let connected = false;
    const check = () => { signal?.throwIfAborted(); guard?.(); signal?.throwIfAborted(); };
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const fail = (category: 'tcp_failed' | 'tcp_timeout' | 'proxy_failed' | 'proxy_rejected' | 'request_timeout' | 'cancelled', stage: 'tcp' | 'proxy' = connected ? 'proxy' : 'tcp') => {
      if (finished) return;
      finished = true;
      try { observe?.({ stage, category }); } finally {
        clean(); request?.destroy(); tunnel?.destroy(); secure?.destroy();
        // Do not propagate proxy response text, errno, addresses or credentials.
        callback(new ContractError(category === 'cancelled' ? 'cancelled' : 'network_error'), undefined as never);
      }
    };
    const abort = () => fail(signal?.reason instanceof ContractError && signal.reason.code === 'timeout' ? connected ? 'request_timeout' : 'tcp_timeout' : 'cancelled');
    const timer = setTimeout(() => fail(connected ? 'proxy_failed' : 'tcp_timeout'), 10000);
    try {
      check(); observe?.({ stage: 'tcp' }); check();
      request = httpRequest({ hostname: proxy.hostname, port: proxy.port, method: 'CONNECT', path: 'api.deepseek.com:443',
        headers: { Host: 'api.deepseek.com:443' }, agent: false, maxHeaderSize: 8192 });
      request.once('error', () => fail(connected ? 'proxy_failed' : 'tcp_failed'));
      request.once('response', response => { response.destroy(); fail('proxy_rejected', 'proxy'); });
      request.once('connect', (response, socket, head) => {
        tunnel = socket;
        if (finished) { socket.destroy(); return; }
        if (response.statusCode !== 200 || head.length !== 0) { fail('proxy_rejected', 'proxy'); return; }
        try {
          check(); observe?.({ stage: 'tls' }); check();
          secure = tlsConnect({ socket, servername: 'api.deepseek.com', rejectUnauthorized: true });
          finished = true; clean();
          // ClientRequest gets the socket before secureConnect, and sends nothing until it succeeds.
          callback(null, secure);
        } catch { fail('proxy_failed', 'proxy'); }
      });
      request.once('socket', socket => socket.once('connect', () => {
        connected = true;
        try { check(); observe?.({ stage: 'proxy' }); check(); request!.end(); }
        catch { fail(signal?.aborted ? 'cancelled' : 'proxy_rejected', 'proxy'); }
      }));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    } catch { fail(signal?.aborted ? 'cancelled' : 'proxy_rejected'); }
    return undefined;
  }
}
