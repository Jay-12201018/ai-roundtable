// @vitest-environment node
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import * as https from 'node:https';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { lookup as dnsLookup } from 'node:dns/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createSafeFetch as catalogFetch } from '../../../src/main/providers/network';
import { CompatibleProvider } from '../../../src/main/providers/compatible/CompatibleProvider';
import { ContractError } from '../../../src/shared/contracts/errors';
import { configuration, input, collect, sse, chunk } from './compatible/fixtures';
import type { DiagnosticEvent } from '../../../src/main/providers/diagnostics';

vi.mock('node:https', async original => ({ ...await original<typeof import('node:https')>(), request: vi.fn() }));
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const clean of cleanups.splice(0).reverse()) await clean(); vi.mocked(https.request).mockReset(); vi.restoreAllMocks(); });
const createSafeFetch = (guard?: () => void, resolver?: typeof dnsLookup, observer?: (event: DiagnosticEvent) => void) => catalogFetch(guard, resolver, observer, { has: () => true });
const lookup = (records: Array<{ address: string; family: number }>) => (async () => records) as unknown as typeof dnsLookup;
const publicLookup = lookup([{ address: '8.8.8.8', family: 4 }]);
const observe = () => { const events: DiagnosticEvent[] = []; return { events, observer: (event: DiagnosticEvent) => { events.push(event); } }; };
function fakeRequest(code: string, connected = false) {
  const socket = new EventEmitter();
  const request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  vi.mocked(https.request).mockImplementation((() => {
    queueMicrotask(() => { request.emit('socket', socket); if (connected) socket.emit('connect'); request.emit('error', Object.assign(new Error('unsafe fake-secret /private/key'), { code })); });
    return request;
  }) as unknown as typeof https.request);
  return request;
}
function provider(observer: (event: DiagnosticEvent) => void, options: Partial<ConstructorParameters<typeof CompatibleProvider>[0]> = {}) {
  return new CompatibleProvider({ configuration: { ...configuration, kind: 'compatible', baseUrl: 'https://fixture.example' },
    confirmedBaseUrl: 'https://fixture.example',
    resolveKey: async () => 'fake-secret', diagnostics: observer, fetch: async () => sse(chunk('OK'), chunk(null, 'stop'), '[DONE]'), ...options });
}

it('records DNS failure without claiming an HTTP peer received anything', async () => {
  const d = observe(); const resolver = vi.fn(async () => { throw Object.assign(new Error('fake-secret dns details'), { code: 'ENOTFOUND' }); }) as unknown as typeof dnsLookup;
  await expect(createSafeFetch(undefined, resolver, d.observer)('https://fixture.example/chat/completions')).rejects.toBeDefined();
  expect(d.events).toContainEqual({ stage: 'dns', category: 'dns_failed' });
  expect(d.events).not.toContainEqual(expect.objectContaining({ evidence: 'http_response' }));
  expect(https.request).not.toHaveBeenCalled(); expect(JSON.stringify(d.events)).not.toContain('fake-secret');
});
it('records rejected DNS targets without constructing a connection', async () => {
  const d = observe(); await expect(createSafeFetch(undefined, lookup([{ address: '127.0.0.1', family: 4 }]), d.observer)('https://fixture.example')).rejects.toBeDefined();
  expect(d.events).toContainEqual({ stage: 'dns', category: 'target_rejected' }); expect(https.request).not.toHaveBeenCalled();
});
it.each(['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'])('classifies %s at TCP without retaining errno, message or stack', async code => {
  const d = observe(); const request = fakeRequest(code);
  await expect(createSafeFetch(undefined, publicLookup, d.observer)('https://fixture.example')).rejects.toBeDefined();
  expect(d.events).toContainEqual({ stage: 'tcp', category: 'tcp_failed' }); expect(request.end).not.toHaveBeenCalled();
  expect(JSON.stringify(d.events)).not.toMatch(/fake-secret|private|stack|ECONN|ENET|EHOST/u);
});
it('classifies TCP timeout separately', async () => {
  const d = observe(); fakeRequest('ETIMEDOUT'); await expect(createSafeFetch(undefined, publicLookup, d.observer)('https://fixture.example')).rejects.toBeDefined();
  expect(d.events).toContainEqual({ stage: 'tcp', category: 'tcp_timeout' });
});
it.each(['ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'ECONNRESET', 'EPROTO', 'ERR_TLS_HANDSHAKE_TIMEOUT'])('classifies handshake/certificate failure %s after TCP connection', async code => {
  const d = observe(); fakeRequest(code, true); await expect(createSafeFetch(undefined, publicLookup, d.observer)('https://fixture.example')).rejects.toBeDefined();
  expect(d.events).toContainEqual({ stage: 'tls', category: 'tls_failed' });
});
it('rejects a real local self-signed TLS fixture with certificate verification enabled', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'roundtable-diag-tls-')); cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=fixture.example', '-keyout', join(folder, 'key.pem'), '-out', join(folder, 'cert.pem')], { stdio: 'ignore', timeout: 10000 });
  const realHttps = await vi.importActual<typeof import('node:https')>('node:https');
  let received = 0;
  const server = realHttps.createServer({ key: readFileSync(join(folder, 'key.pem')), cert: readFileSync(join(folder, 'cert.pem')) }, (_request, response) => { received++; response.end(); });
  server.on('tlsClientError', () => {});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  vi.mocked(https.request).mockImplementation(((url, options, callback) => {
    expect(options).toMatchObject({ rejectUnauthorized: true, servername: 'fixture.example' });
    return realHttps.request(new URL(`https://127.0.0.1:${(server.address() as { port: number }).port}`), { ...(options as https.RequestOptions), lookup: undefined, family: 4 }, callback as (response: import('node:http').IncomingMessage) => void);
  }) as typeof https.request);
  const d = observe(); await expect(createSafeFetch(undefined, publicLookup, d.observer)('https://fixture.example')).rejects.toBeDefined();
  expect(d.events).toContainEqual({ stage: 'tls', category: 'tls_failed' }); expect(received).toBe(0);
  expect(d.events.some(e => e.evidence === 'http_response')).toBe(false);
});
it('records actual local HTTP status and send phase, not provider billing or receipt claims', async () => {
  const server = createServer((_request, response) => { response.writeHead(401); response.end('untrusted fake-secret body'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const d = observe(); const response = await createSafeFetch(undefined, publicLookup, d.observer)(`http://127.0.0.1:${(server.address() as { port: number }).port}`, { method: 'POST', body: 'fixed' });
  await response.body?.cancel();
  expect(d.events).toContainEqual({ stage: 'request' });
  expect(d.events).toContainEqual({ stage: 'response', evidence: 'http_response', httpStatus: 401 });
  expect(JSON.stringify(d.events)).not.toContain('fake-secret');
});
it.each([401, 403, 429, 500])('retains numeric HTTP %s without body, headers or auto retry', async status => {
  const d = observe(); const fetcher = vi.fn(async () => new Response('unsafe fake-secret body', { status, headers: { 'unsafe-header': 'fake-secret' } }));
  const events = await collect(provider(d.observer, { fetch: fetcher }).streamChat(input));
  expect(d.events).toContainEqual({ stage: 'response', evidence: 'http_response', httpStatus: status });
  expect(d.events).toContainEqual({ stage: 'response', category: 'http_error' });
  expect(fetcher).toHaveBeenCalledTimes(1); expect(events.at(-1)?.type).toBe('error'); expect(JSON.stringify(d.events)).not.toContain('fake-secret');
});
it('distinguishes Keychain failure before any network client invocation', async () => {
  const d = observe(); const fetcher = vi.fn();
  await collect(provider(d.observer, { fetch: fetcher, resolveKey: async () => { throw new Error('unsafe fake-secret Keychain'); } }).streamChat(input));
  expect(d.events).toContainEqual({ stage: 'credential', category: 'credential_read_failed' }); expect(fetcher).not.toHaveBeenCalled();
  expect(d.events.some(e => e.evidence === 'client_invoked')).toBe(false); expect(JSON.stringify(d.events)).not.toContain('fake-secret');
});
it('distinguishes missing credential from a read failure', async () => {
  const d = observe(); const fetcher = vi.fn(); await collect(provider(d.observer, { fetch: fetcher, resolveKey: async () => undefined }).streamChat(input));
  expect(d.events).toContainEqual({ stage: 'credential', category: 'credential_unavailable' }); expect(fetcher).not.toHaveBeenCalled();
});
it('retains client invocation as uncertain when a wrapped transport throws without a response', async () => {
  const d = observe(); const events = await collect(provider(d.observer, { fetch: async () => { throw new Error('unsafe fake-secret'); } }).streamChat(input));
  expect(d.events).toContainEqual({ stage: 'network_client', evidence: 'client_invoked' });
  expect(d.events.some(e => e.evidence === 'http_response')).toBe(false); expect(events.at(-1)?.type).toBe('error');
  expect(d.events).toContainEqual({ category: 'network_unknown' }); expect(JSON.stringify(d.events)).not.toContain('fake-secret');
});
it('distinguishes malformed SSE from credential and connection failures', async () => {
  const d = observe(); const events = await collect(provider(d.observer, { fetch: async () => new Response('data: bad fake-secret\n\n', { headers: { 'content-type': 'text/event-stream' } }) }).streamChat(input));
  expect(d.events).toContainEqual({ stage: 'stream', category: 'response_invalid' }); expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_response' } });
  expect(JSON.stringify(d.events)).not.toContain('fake-secret');
});
it.each(['cancelled', 'timeout'] as const)('classifies %s after response without retry or raw error', async reason => {
  const d = observe(); const controller = new AbortController();
  const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } }));
  const events = [];
  for await (const event of provider(d.observer, { fetch: fetcher }).streamChat({ ...input, signal: controller.signal })) { events.push(event); if (event.type === 'text_delta') controller.abort(new ContractError(reason)); }
  expect(d.events).toContainEqual({ category: reason === 'timeout' ? 'request_timeout' : 'cancelled' }); expect(fetcher).toHaveBeenCalledTimes(1); expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: reason } });
});
it('marks actual response-body disconnection without confusing it with SSE parsing', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write('partial');
    setTimeout(() => response.destroy(), 20);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const d = observe(); const response = await createSafeFetch(undefined, publicLookup, d.observer)(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  await expect(response.text()).rejects.toBeDefined();
  expect(d.events).toContainEqual({ stage: 'response', category: 'request_interrupted' });
  expect(d.events).toContainEqual({ stage: 'response', evidence: 'http_response', httpStatus: 200 });
});
it('records timeout after request dispatch with receipt still unknown', async () => {
  let requestReceived!: () => void; const received = new Promise<void>(resolve => { requestReceived = resolve; });
  const server = createServer((_request, _response) => { requestReceived(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const d = observe(); const controller = new AbortController();
  const result = createSafeFetch(undefined, publicLookup, d.observer)(`http://127.0.0.1:${(server.address() as { port: number }).port}`, { signal: controller.signal });
  const rejected = expect(result).rejects.toMatchObject({ code: 'timeout' });
  await received; controller.abort(new ContractError('timeout')); await rejected;
  expect(d.events).toContainEqual({ stage: 'request', category: 'request_timeout' });
  expect(d.events.some(e => e.evidence === 'http_response')).toBe(false);
});
it('does not turn an arbitrary wrapper exception into a proven TCP failure', async () => {
  const d = observe(); vi.mocked(https.request).mockImplementation(() => { throw new Error('unsafe fake-secret wrapper'); });
  await expect(createSafeFetch(undefined, publicLookup, d.observer)('https://fixture.example')).rejects.toBeDefined();
  expect(d.events).toContainEqual({ stage: 'tcp', category: 'network_unknown' });
  expect(d.events.some(e => e.category === 'tcp_failed')).toBe(false); expect(JSON.stringify(d.events)).not.toContain('fake-secret');
});
it('does not report a false interruption when a successful stream closes its scope', async () => {
  const d = observe(); const events = await collect(provider(d.observer).streamChat(input));
  expect(events.at(-1)).toMatchObject({ type: 'finish' }); expect(d.events.filter(e => e.category)).toEqual([]);
});
it.each([
  { delta: {}, finish_reason: 'tool_calls' },
  { delta: { tool_calls: [{ type: 'function' }] }, finish_reason: null },
  { delta: { function_call: { name: 'fixture-only' } }, finish_reason: null },
  { delta: { audio: { data: 'fixture-only' } }, finish_reason: null },
])('diagnoses unsupported SSE content as response parsing, preserving public unsupported (%j)', async choice => {
  const d = observe(); const fetcher = vi.fn(async () => sse({ choices: [{ index: 0, ...choice }] }, '[DONE]'));
  const events = await collect(provider(d.observer, { fetch: fetcher }).streamChat(input));
  expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'unsupported' } });
  expect(d.events).toContainEqual({ stage: 'stream', category: 'response_invalid' });
  expect(d.events.some(e => e.category === 'policy_rejected')).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('keeps timeout during pending DNS in the DNS phase', async () => {
  const d = observe(); const controller = new AbortController();
  const resolver = (() => new Promise(() => {})) as typeof dnsLookup;
  const request = createSafeFetch(undefined, resolver, d.observer)('https://fixture.example', { signal: controller.signal });
  const rejected = expect(request).rejects.toMatchObject({ code: 'timeout' }); controller.abort(new ContractError('timeout')); await rejected;
  expect(d.events).toContainEqual({ stage: 'dns', category: 'dns_failed' }); expect(https.request).not.toHaveBeenCalled();
});
it.each([false, true])('keeps timeout in the TCP/TLS phase (TCP connected=%s)', async connected => {
  const d = observe(); const controller = new AbortController(); const socket = new EventEmitter();
  const request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  vi.mocked(https.request).mockImplementation((() => {
    queueMicrotask(() => { request.emit('socket', socket); if (connected) socket.emit('connect'); }); return request;
  }) as unknown as typeof https.request);
  const pending = createSafeFetch(undefined, publicLookup, d.observer)('https://fixture.example', { signal: controller.signal });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout' });
  await vi.waitFor(() => expect(https.request).toHaveBeenCalledTimes(1));
  controller.abort(new ContractError('timeout')); await rejected;
  expect(d.events).toContainEqual({ stage: connected ? 'tls' : 'tcp', category: connected ? 'tls_failed' : 'tcp_timeout' }); expect(request.end).not.toHaveBeenCalled();
});
it.each(['network_client', 'dns', 'tcp'] as const)('stops promptly if diagnostic persistence aborts synchronously at %s', async stage => {
  const controller = new AbortController(); let releaseDns!: () => void;
  const resolver = vi.fn(() => new Promise<Array<{ address: string; family: number }>>(resolve => { releaseDns = () => resolve([{ address: '8.8.8.8', family: 4 }]); })) as unknown as typeof dnsLookup;
  const request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  vi.mocked(https.request).mockReturnValue(request as unknown as ReturnType<typeof https.request>);
  const pending = createSafeFetch(undefined, stage === 'tcp' ? publicLookup : resolver, event => {
    if (event.stage === stage) controller.abort(new ContractError('cancelled'));
  })('https://fixture.example', { signal: controller.signal }).then(() => 'unexpected-response', error => error);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([pending, new Promise<string>(resolve => { timer = setTimeout(() => resolve('stalled'), 150); })]);
    expect(result).toMatchObject({ code: 'cancelled' });
    expect(https.request).not.toHaveBeenCalled(); expect(resolver).not.toHaveBeenCalled();
  } finally { clearTimeout(timer); releaseDns?.(); if (request.listenerCount('error')) request.emit('error', new ContractError('cancelled')); }
});
it('does not write a request after diagnostic persistence synchronously aborts at request phase', async () => {
  const controller = new AbortController(); const socket = new EventEmitter();
  const request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  vi.mocked(https.request).mockImplementation((() => { queueMicrotask(() => { request.emit('socket', socket); socket.emit('secureConnect'); }); return request; }) as unknown as typeof https.request);
  await expect(createSafeFetch(undefined, publicLookup, event => { if (event.stage === 'request') controller.abort(new ContractError('cancelled')); })('https://fixture.example', { method: 'POST', body: 'fixed', signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  expect(request.destroy).toHaveBeenCalled(); expect(request.end).not.toHaveBeenCalled();
});
it('destroys a request when synchronous construction aborts before listener registration', async () => {
  const controller = new AbortController(); const request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  vi.mocked(https.request).mockImplementation((() => { controller.abort(new ContractError('cancelled')); return request; }) as unknown as typeof https.request);
  const pending = createSafeFetch(undefined, publicLookup)('https://fixture.example', { signal: controller.signal }).then(() => 'unexpected-response', error => error);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([pending, new Promise<string>(resolve => { timer = setTimeout(() => resolve('stalled'), 150); })]);
    expect(result).toMatchObject({ code: 'cancelled' }); expect(request.destroy).toHaveBeenCalled(); expect(request.end).not.toHaveBeenCalled();
  } finally { clearTimeout(timer); request.emit('error', new ContractError('cancelled')); }
});
it('retains observed HTTP 101 evidence while rejecting and closing an upgrade', async () => {
  const d = observe(); const connected = new EventEmitter(); const upgraded = { destroy: vi.fn() };
  const response = Object.assign(new PassThrough(), { statusCode: 101 });
  const request = Object.assign(new EventEmitter(), { end: vi.fn(() => queueMicrotask(() => request.emit('upgrade', response, upgraded))), destroy: vi.fn() });
  vi.mocked(https.request).mockImplementation((() => { queueMicrotask(() => { request.emit('socket', connected); connected.emit('secureConnect'); }); return request; }) as unknown as typeof https.request);
  await expect(createSafeFetch(undefined, publicLookup, d.observer)('https://fixture.example')).rejects.toThrow('Unsupported network response');
  expect(d.events).toContainEqual({ stage: 'response', evidence: 'http_response', httpStatus: 101 });
  expect(d.events).toContainEqual({ stage: 'response', category: 'response_invalid' }); expect(upgraded.destroy).toHaveBeenCalledOnce(); expect(https.request).toHaveBeenCalledOnce();
});
