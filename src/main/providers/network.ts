import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { z } from 'zod';
import type { DiagnosticEvent, DiagnosticObserver } from './diagnostics';
import { ContractError } from '../../shared/contracts/errors';
import { assertProxyTarget, LoopbackProxyAgent, proxyTargetHost, type LoopbackProxy, type ProxyTargetKind } from './loopbackProxy';

const nativeText = z.object({ text: z.string() }).strict();
const positiveTokens = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const anthropicBody = z.object({
  model: z.string().trim().min(1), stream: z.literal(true), max_tokens: positiveTokens,
  system: z.array(z.object({ type: z.literal('text'), text: z.string() }).strict()).optional(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1) }).strict()).min(1),
}).strict();
const geminiBody = z.object({
  contents: z.array(z.object({ role: z.enum(['user', 'model']), parts: z.array(nativeText).min(1) }).strict()).min(1),
  systemInstruction: z.object({ parts: z.array(nativeText).min(1) }).strict().optional(),
  generationConfig: z.object({ candidateCount: z.literal(1), maxOutputTokens: positiveTokens }).strict(),
}).strict();

/** Native protocols add an exact credential boundary on top of DNS-pinned/TLS transport. */
export function createNativeSafeFetch(kind: 'anthropic' | 'gemini', transport: typeof fetch, guard?: () => void): typeof fetch {
  return async (input, init = {}) => {
    guard?.();
    try {
      if (typeof input !== 'string' && !(input instanceof URL) || /\s|\\|\p{Cc}/u.test(String(input))) throw new Error();
      const url = new URL(String(input)); const method = init.method ?? 'GET';
      const headers = new Headers(init.headers);
      if (url.username || url.password || url.hash || init.redirect !== 'error' || headers.has('authorization')
        || headers.has('proxy-authorization') || headers.has('cookie')) throw new Error();
      const keyHeader = kind === 'anthropic' ? 'x-api-key' : 'x-goog-api-key';
      const otherKey = kind === 'anthropic' ? 'x-goog-api-key' : 'x-api-key';
      const key = headers.get(keyHeader);
      if (!key || /\s|\p{Cc}/u.test(key) || headers.has(otherKey)) throw new Error();
      const entries = [...url.searchParams];
      if (new Set(entries.map(([name]) => name)).size !== entries.length) throw new Error();
      let listing = false; let generation = false;
      if (kind === 'anthropic') {
        if (url.origin !== 'https://api.anthropic.com' || headers.get('anthropic-version') !== '2023-06-01') throw new Error();
        listing = method === 'GET' && url.pathname === '/v1/models' && url.searchParams.get('limit') === '1000'
          && entries.every(([name, value]) => name === 'limit' || name === 'after_id' && value.length > 0 && value.length <= 4096);
        generation = method === 'POST' && url.pathname === '/v1/messages' && !url.search;
      } else {
        if (url.origin !== 'https://generativelanguage.googleapis.com') throw new Error();
        listing = method === 'GET' && url.pathname === '/v1beta/models' && url.searchParams.get('pageSize') === '100'
          && entries.every(([name, value]) => name === 'pageSize' || name === 'pageToken' && value.length > 0 && value.length <= 4096);
        generation = method === 'POST' && /^\/v1beta\/models\/[a-zA-Z0-9][a-zA-Z0-9._-]*:streamGenerateContent$/u.test(url.pathname)
          && entries.length === 1 && url.searchParams.get('alt') === 'sse';
      }
      if (listing ? init.body !== undefined && init.body !== null : !generation) throw new Error();
      if (generation && (typeof init.body !== 'string' || !(kind === 'anthropic' ? anthropicBody : geminiBody).safeParse(JSON.parse(init.body)).success)) throw new Error();
    } catch { throw new ContractError('forbidden'); }
    guard?.();
    const response = await transport(input, init);
    try { guard?.(); }
    catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
    return response;
  };
}

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return a > 0 && a < 224 && a !== 10 && a !== 127
      && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254)
      && !(a === 172 && b >= 16 && b <= 31)
      && !(a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99))
      && !(a === 198 && (b === 18 || b === 19 || b === 51 && c === 100))
      && !(a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) !== 6 || address.includes('%') || address.includes('.')) return false;
  const [first = '', second = ''] = address.toLowerCase().split(':');
  const prefix = Number.parseInt(first, 16); const next = Number.parseInt(second || '0', 16);
  return prefix >= 0x2000 && prefix <= 0x3fff && prefix !== 0x2002
    && !(prefix === 0x2001 && (next <= 0x1ff || next === 0xdb8))
    && !(prefix === 0x3fff && next <= 0xfff);
}

function loopback(address: string): boolean {
  return isIP(address) === 4 && address.startsWith('127.') || address === '::1';
}

/** Main-only transport: pin public DNS directly, or use the explicitly trusted, narrowly scoped proxy. */
export function createSafeFetch(guard?: () => void, lookup: typeof dnsLookup = dnsLookup, observe?: DiagnosticObserver, proxy?: LoopbackProxy, proxyKind: ProxyTargetKind = 'deepseek'): typeof fetch {
  return async (input, init = {}) => {
    if (typeof input !== 'string' && !(input instanceof URL)) throw new TypeError('Unsupported request');
    const raw = String(input);
    if (/\s|\\|\p{Cc}/u.test(raw)) throw new TypeError('Invalid network target');
    const url = new URL(raw); const hostname = url.hostname.replace(/^\[|\]$/gu, '');
    if (url.username || url.password || url.hash || url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError('Invalid network target');
    const local = url.protocol === 'http:';
    if (local && !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|\?|$)/iu.test(raw)) throw new TypeError('Invalid network target');
    const method = init.method ?? 'GET';
    if (method !== 'GET' && method !== 'POST' || init.body != null && (typeof init.body !== 'string' || method !== 'POST')) throw new TypeError('Unsupported request');
    const headers = new Headers(init.headers);
    if (headers.has('host') && headers.get('host') !== url.host) throw new TypeError('Invalid request host');
    headers.set('accept-encoding', 'identity');
    const signal = init.signal;
    const abortReason = () => signal?.reason instanceof Error ? signal.reason : new DOMException('Request aborted', 'AbortError');
    signal?.throwIfAborted(); guard?.();
    if (proxy) assertProxyTarget(url, method, proxyKind);
    observe?.({ stage: 'network_client', evidence: 'client_invoked' });
    signal?.throwIfAborted();
    let selected: { address: string; family: number } | undefined;
    if (!proxy) {
    observe?.({ stage: 'dns' });
    signal?.throwIfAborted(); guard?.(); signal?.throwIfAborted();
    let stopDns!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      stopDns = () => reject(abortReason());
      signal?.addEventListener('abort', stopDns, { once: true });
      if (signal?.aborted) stopDns();
    });
    let addresses: Array<{ address: string; family: number }>;
    try {
      const family = isIP(hostname);
      addresses = await Promise.race([family ? Promise.resolve([{ address: hostname, family }]) : lookup(hostname, { all: true, verbatim: true }), aborted]);
    } catch (error) {
      observe?.({ stage: 'dns', category: signal?.aborted && nativeCode(signal.reason) !== 'timeout' ? 'cancelled' : 'dns_failed' });
      throw error;
    } finally { signal?.removeEventListener('abort', stopDns); }
    signal?.throwIfAborted();
    if (addresses.length === 0 || addresses.some(value => value.family !== isIP(value.address) || !(local ? loopback(value.address) : publicAddress(value.address)))) {
      observe?.({ stage: 'dns', category: 'target_rejected' }); throw new TypeError('Unsafe network target');
    }
    selected = addresses[0];
    }
    const pinned: LookupFunction = (_host, options, callback) => {
      if (options.all) callback(null, [selected!]);
      else callback(null, selected!.address, selected!.family);
    };
    return await new Promise<Response>((resolve, reject) => {
      let request: ClientRequest | undefined; let response: IncomingMessage | undefined;
      let phase: 'tcp' | 'proxy' | 'tls' | 'request' | 'response' = 'tcp';
      const agent = proxy ? new LoopbackProxyAgent(proxy, guard, signal, event => {
        if (event.stage === 'tcp' || event.stage === 'proxy' || event.stage === 'tls') phase = event.stage;
        observe?.(event);
      }, proxyTargetHost(proxyKind)) : undefined;
      const diagnose = (error: unknown) => {
        const code = nativeCode(error);
        let category: DiagnosticEvent['category'];
        if (signal?.aborted) category = nativeCode(signal.reason) === 'timeout' ? phase === 'tcp' ? 'tcp_timeout' : phase === 'tls' ? 'tls_failed' : 'request_timeout' : 'cancelled';
        else if (!local && tlsCodes.has(code)) { phase = 'tls'; category = 'tls_failed'; }
        else if (code === 'ETIMEDOUT') category = phase === 'tcp' ? 'tcp_timeout' : phase === 'tls' ? 'tls_failed' : 'request_timeout';
        else if (connectionCodes.has(code)) category = phase === 'tcp' ? 'tcp_failed' : phase === 'tls' ? 'tls_failed' : 'request_interrupted';
        else category = 'network_unknown';
        observe?.({ stage: phase, category });
      };
      const cleanup = () => { signal?.removeEventListener('abort', abort); agent?.destroy(); };
      const fail = (error: Error) => { diagnose(error); cleanup(); reject(error); };
      const abort = () => {
        const error = abortReason();
        response?.destroy(error); request?.destroy(error); fail(error);
      };
      try {
        signal?.throwIfAborted(); guard?.();
        const send = local ? httpRequest : httpsRequest;
        observe?.({ stage: 'tcp' });
        signal?.throwIfAborted(); guard?.(); signal?.throwIfAborted();
        request = send(url, { method, headers: Object.fromEntries(headers), agent: agent ?? false,
          ...(proxy ? {} : { lookup: pinned, family: selected!.family }),
          ...(local ? {} : { rejectUnauthorized: true, servername: isIP(hostname) ? '' : hostname }),
        }, incoming => {
          response = incoming; phase = 'response';
          const status = incoming.statusCode ?? 0;
          incoming.once('close', cleanup);
          incoming.once('error', fail);
          if (status >= 100 && status <= 599) observe?.({ stage: 'response', evidence: 'http_response', httpStatus: status });
          if (signal?.aborted) { abort(); return; }
          const encoding = incoming.headers['content-encoding'];
          if (encoding !== undefined && (typeof encoding !== 'string' || encoding.trim().toLowerCase() !== 'identity')) {
            observe?.({ stage: 'response', category: 'response_invalid' });
            incoming.destroy(); fail(new TypeError('Unsupported response encoding')); return;
          }
          const responseHeaders = new Headers();
          for (let i = 0; i < incoming.rawHeaders.length; i += 2) responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
          try {
            const noBody = status === 204 || status === 205 || status === 304;
            let done = false;
            const body = noBody ? null : new ReadableStream<Uint8Array>({
              start(controller) {
                incoming.pause();
                incoming.on('data', (chunk: Buffer) => {
                  if (done) return;
                  controller.enqueue(chunk);
                  if ((controller.desiredSize ?? 0) <= 0) incoming.pause();
                });
                incoming.once('end', () => { if (!done) { done = true; controller.close(); } });
                incoming.once('error', error => { if (!done) { done = true; controller.error(error); } });
                incoming.once('aborted', () => { if (!done) { done = true;
                  observe?.({ stage: 'response', category: signal?.aborted ? nativeCode(signal.reason) === 'timeout' ? 'request_timeout' : 'cancelled' : 'request_interrupted' });
                  controller.error(signal?.aborted ? abortReason() : new TypeError('Response interrupted')); } });
              },
              pull() { if (!done) incoming.resume(); },
              cancel() { done = true; cleanup(); incoming.destroy(); request?.destroy(); },
            });
            if (noBody) incoming.resume();
            resolve(new Response(body, { status, headers: responseHeaders }));
          } catch { observe?.({ stage: 'response', category: 'response_invalid' }); incoming.destroy(); fail(new TypeError('Invalid network response')); }
        });
        request.once('error', fail);
        request.once('upgrade', (incoming, socket) => {
          phase = 'response';
          const status = incoming.statusCode ?? 0;
          if (status >= 100 && status <= 599) observe?.({ stage: 'response', evidence: 'http_response', httpStatus: status });
          observe?.({ stage: 'response', category: 'response_invalid' });
          socket.destroy(); fail(new TypeError('Unsupported network response'));
        });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        request.once('socket', socket => {
          if (!local && !proxy) socket.once('connect', () => { phase = 'tls'; observe?.({ stage: 'tls' }); });
          socket.once(local ? 'connect' : 'secureConnect', () => {
            try {
              signal?.throwIfAborted(); guard?.();
              phase = 'request'; observe?.({ stage: 'request' });
              signal?.throwIfAborted(); guard?.(); signal?.throwIfAborted();
              request!.end(init.body as string | undefined);
            } catch (error) { diagnose(error); request?.destroy(); cleanup(); reject(error); }
          });
        });
      } catch (error) { diagnose(error); request?.destroy(); cleanup(); reject(error); }
    });
  };
}

// Only native/controlled codes are inspected; exception text, causes and stacks never enter diagnostics.
function nativeCode(error: unknown): string {
  if (error instanceof ContractError) return error.code;
  const code = error !== null && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
  return typeof code === 'string' ? code : '';
}
const connectionCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'EADDRNOTAVAIL', 'EHOSTDOWN', 'ENETDOWN']);
const tlsCodes = new Set(['EPROTO', 'ERR_TLS_HANDSHAKE_TIMEOUT', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED', 'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE', 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION']);
