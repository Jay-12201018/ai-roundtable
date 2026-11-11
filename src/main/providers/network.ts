import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { DiagnosticEvent, DiagnosticObserver } from './diagnostics';
import { ContractError } from '../../shared/contracts/errors';
import { failedBeforeWriting, type NetworkPhase } from '../../shared/schemas/error';
import { catalogHosts, serviceCatalog } from '../../shared/serviceCatalog';

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

/** D138: 198.18.0.0/15 is not a real private network, and some network tools answer names from it. Only catalog names get here. */
const nameMappedAddress = (address: string) => isIP(address) === 4 && /^198\.1[89]\./u.test(address);

function loopback(address: string): boolean {
  return isIP(address) === 4 && address.startsWith('127.') || address === '::1';
}

/** D143: which hosts a request may go to. */
export type AllowedHosts = { has(host: string): boolean };
const productionHosts: AllowedHosts = catalogHosts(serviceCatalog);

/** Main-only transport: catalog hosts only, public DNS pinned, TLS verified, nothing followed. */
export function createSafeFetch(guard?: () => void, lookup: typeof dnsLookup = dnsLookup, observe?: DiagnosticObserver, hosts: AllowedHosts = productionHosts): typeof fetch {
  return async (input, init = {}) => {
    if (typeof input !== 'string' && !(input instanceof URL)) throw new TypeError('Unsupported request');
    const raw = String(input);
    if (/\s|\\|\p{Cc}/u.test(raw)) throw new TypeError('Invalid network target');
    const url = new URL(raw); const hostname = url.hostname.replace(/^\[|\]$/gu, '');
    if (url.username || url.password || url.hash || url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError('Invalid network target');
    // D143: exact match on the host and port, before anything is resolved or sent. A literal address is never in the catalog.
    if (!hosts.has(url.host)) { observe?.({ stage: 'dns', category: 'target_rejected' }); throw new ContractError('target_rejected'); }
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
    observe?.({ stage: 'network_client', evidence: 'client_invoked' });
    signal?.throwIfAborted();
    observe?.({ stage: 'dns' });
    signal?.throwIfAborted(); guard?.(); signal?.throwIfAborted();
    // Everything from here is one try at reaching the service; see the end of this function.
    const connect = async (): Promise<Response> => {
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
      markPhase(error, 'dns');
      throw error;
    } finally { signal?.removeEventListener('abort', stopDns); }
    signal?.throwIfAborted();
    if (addresses.length === 0 || addresses.some(value => value.family !== isIP(value.address) || !(local ? loopback(value.address) : !isIP(hostname) && (publicAddress(value.address) || nameMappedAddress(value.address))))) {
      observe?.({ stage: 'dns', category: 'target_rejected' }); throw new ContractError('target_rejected');
    }
    const selected = addresses[0];
    const pinned: LookupFunction = (_host, options, callback) => {
      if (options.all) callback(null, [selected]);
      else callback(null, selected.address, selected.family);
    };
    return await new Promise<Response>((resolve, reject) => {
      let request: ClientRequest | undefined; let response: IncomingMessage | undefined;
      let phase: 'tcp' | 'tls' | 'request' | 'response' = 'tcp';
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
      // D166: reaching the service has its own limit, apart from the request's. A handshake that hangs is given up on and tried again,
      // instead of holding the reply for as long as the connection stays half open.
      let connecting: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        const error = Object.assign(new Error('Connecting took too long'), { code: 'ETIMEDOUT' });
        request?.destroy(error); fail(error);
      }, NETWORK_CONNECT_TIMEOUT_MS);
      const connected = () => { clearTimeout(connecting); connecting = undefined; };
      const cleanup = () => { connected(); signal?.removeEventListener('abort', abort); };
      const fail = (error: Error) => { diagnose(error); markPhase(error, phase); cleanup(); reject(error); };
      const abort = () => {
        const error = abortReason();
        response?.destroy(error); request?.destroy(error); fail(error);
      };
      try {
        signal?.throwIfAborted(); guard?.();
        const send = local ? httpRequest : httpsRequest;
        observe?.({ stage: 'tcp' });
        signal?.throwIfAborted(); guard?.(); signal?.throwIfAborted();
        request = send(url, { method, headers: Object.fromEntries(headers), agent: false, lookup: pinned, family: selected.family,
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
          if (!local) socket.once('connect', () => { phase = 'tls'; observe?.({ stage: 'tls' }); });
          socket.once(local ? 'connect' : 'secureConnect', () => {
            connected();
            try {
              signal?.throwIfAborted(); guard?.();
              phase = 'request'; observe?.({ stage: 'request' });
              signal?.throwIfAborted(); guard?.(); signal?.throwIfAborted();
              request!.end(init.body as string | undefined);
            } catch (error) { diagnose(error); markPhase(error, phase); request?.destroy(); cleanup(); reject(error); }
          });
        });
      } catch (error) { diagnose(error); markPhase(error, phase); request?.destroy(); cleanup(); reject(error); }
    });
    };
    // D166: the retry policy of the SDKs this application is modelled on. A try that did not get an answer, or got one that says "not now"
    // (408, 409, 429, any 5xx), is made again: twice more at most, after a wait that doubles from half a second, shortened a little at
    // random so that many clients do not come back together, or after the wait the service itself asks for. A reply that has begun is
    // never asked for again: its words are on the page. Each new try is checked again first, and a stop ends it at once.
    for (let attempt = 0; ; attempt++) {
      let answer: Response;
      try { answer = await connect(); }
      catch (error) {
        if (attempt >= NETWORK_MAX_RETRIES || error instanceof ContractError || signal?.aborted || !beforeAnyAnswer(networkPhaseOf(error))) throw error;
        await pause(retryDelayMs(attempt), signal);
        signal?.throwIfAborted(); guard?.(); signal?.throwIfAborted();
        continue;
      }
      if (attempt >= NETWORK_MAX_RETRIES || signal?.aborted || !retryableStatus(answer.status)) return answer;
      const asked = retryAfterMs(answer.headers);
      await answer.body?.cancel().catch(() => {});
      await pause(asked ?? retryDelayMs(attempt), signal);
      signal?.throwIfAborted(); guard?.(); signal?.throwIfAborted();
    }
  };
}

/** D166: how many more times a request is tried, after the first. */
export const NETWORK_MAX_RETRIES = 2;
/** D166: how long one try may take to reach the service and finish the handshake. */
export const NETWORK_CONNECT_TIMEOUT_MS = 5_000;
const RETRY_FIRST_MS = 500;
const RETRY_LONGEST_MS = 8_000;
const RETRY_AFTER_LONGEST_MS = 60_000;
/** The wait before retry number `attempt + 1`: 0.5 s, 1 s, 2 s … up to 8 s, less up to a quarter at random. */
export const retryDelayMs = (attempt: number, random: () => number = Math.random) => Math.min(RETRY_FIRST_MS * 2 ** attempt, RETRY_LONGEST_MS) * (1 - random() * 0.25);
const retryableStatus = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;
/** What the service asked for in `retry-after`, in seconds or as a date, when it is a wait worth honouring: more than nothing, a minute at most. */
function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms > 0 && ms <= RETRY_AFTER_LONGEST_MS ? ms : undefined;
}
/** Nothing of the answer has arrived: the name did not resolve, the connection or the handshake failed, or the request went and no status came back. */
const beforeAnyAnswer = (phase: NetworkPhase | undefined) => failedBeforeWriting(phase) || phase === 'request';
const pause = (ms: number, signal: AbortSignal | null | undefined) => new Promise<void>(resolve => {
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms);
  signal?.addEventListener('abort', done, { once: true });
});
const failedPhases = new WeakMap<object, NetworkPhase>();
const markPhase = (error: unknown, phase: NetworkPhase) => { if (error !== null && typeof error === 'object') failedPhases.set(error, phase); };
/** D155: where this error from the transport happened. The word is all that leaves here. */
export const networkPhaseOf = (error: unknown): NetworkPhase | undefined => error !== null && typeof error === 'object' ? failedPhases.get(error) : undefined;

// Only native/controlled codes are inspected; exception text, causes and stacks never enter diagnostics.
function nativeCode(error: unknown): string {
  if (error instanceof ContractError) return error.code;
  const code = error !== null && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
  return typeof code === 'string' ? code : '';
}
const connectionCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'EADDRNOTAVAIL', 'EHOSTDOWN', 'ENETDOWN']);
const tlsCodes = new Set(['EPROTO', 'ERR_TLS_HANDSHAKE_TIMEOUT', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED', 'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE', 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION']);
