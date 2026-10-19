// Test-only local CONNECT/TLS integration. No desktop profile, real Keychain, public DNS or API.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http = require('node:http'), https = require('node:https'), net = require('node:net'), tls = require('node:tls');
const dns = require('node:dns'), dnsPromises = require('node:dns/promises');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');
const { createRequire, syncBuiltinESMExports, Module } = require('node:module');
const { installControlledNetwork } = require('../../scripts/controlled-desktop/controlled-network.cjs');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'roundtable-controlled-proxy-'));
fs.chmodSync(folder, 0o700);
const target = 'https://api.deepseek.com/chat/completions';
const fake = 'owned-fake-connect-key';
const input = { requestId: 'owned-connect-request', modelId: 'deepseek-flash', messages: [{ role: 'user', content: 'Reply OK.' }], outputTokenLimit: 128 };
const expectedBody = { model: 'deepseek-flash', messages: input.messages, stream: true, max_tokens: 128, stream_options: { include_usage: true }, thinking: { type: 'disabled' } };
const config = { id: 'owned-connect-provider', name: 'Local CONNECT fixture', kind: 'openai-compatible', enabled: true, baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [], isDefault: false, keyReference: { id: 'owned-connect-reference' }, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' };
const original = { socketConnect: net.Socket.prototype.connect, tlsConnect: tls.connect, dnsLookup: dns.lookup, promiseLookup: dnsPromises.lookup };
let origin, proxy, gate, originPort, proxyPort, mode = 'success';
let assertions = 0, cases = 0, blockedNetwork = 0, dnsCalls = 0, keyReads = 0;
let connects = [], requests = [], sockets = new Set();
const check = (condition, name) => { assert.ok(condition, name); assertions++; };
const equal = (actual, expected, name) => { assert.deepEqual(actual, expected, name); assertions++; };
const write = (name, text) => fs.writeFileSync(path.join(folder, name), text, { mode: 0o600 });
const openssl = args => execFileSync('/usr/bin/openssl', args, { cwd: folder, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
const globalTimer = setTimeout(() => { console.error('CONTROLLED_PROXY_TIMEOUT'); process.exit(124); }, 120000);
function track(socket) { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); return socket; }
async function closeSockets() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => setTimeout(resolve, 10)); }
async function collect(registry, diagnostics) {
  const events = []; let thrown = false;
  try { for await (const event of registry.streamControlledTrial(config.id, input, () => {}, diagnostics.observe)) events.push(event); }
  catch { thrown = true; }
  return { events, thrown, diagnostics: diagnostics.snapshot() };
}
async function main() {
  write('ca.cnf', '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=Roundtable CONNECT Fixture CA\n[v3]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '1', '-config', 'ca.cnf']);
  for (const [name, hostname, serial] of [['origin', 'api.deepseek.com', '1'], ['mismatch', 'wrong.fixture.invalid', '2']]) {
    write(name + '.cnf', '[req]\nprompt=no\ndistinguished_name=dn\nreq_extensions=v3\n[dn]\nCN=' + hostname + '\n[v3]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:' + hostname + '\n');
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', name + '.key', '-out', name + '.csr', '-config', name + '.cnf']);
    openssl(['x509', '-req', '-in', name + '.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-set_serial', serial, '-out', name + '.pem', '-days', '1', '-extfile', name + '.cnf', '-extensions', 'v3']);
  }
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'foreign.key', '-out', 'foreign.pem', '-days', '1', '-subj', '/CN=Unrelated CONNECT Fixture CA']);
  const ca = fs.readFileSync(path.join(folder, 'ca.pem')), foreignCa = fs.readFileSync(path.join(folder, 'foreign.pem'));
  const context = name => ({ key: fs.readFileSync(path.join(folder, name + '.key')), cert: fs.readFileSync(path.join(folder, name + '.pem')) });
  origin = https.createServer(context('origin'), async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      requests.push({ method: req.method, path: req.url, host: req.headers.host, fakeKeyMatches: req.headers.authorization === 'Bearer ' + fake, sni: req.socket.servername, body: JSON.parse(Buffer.concat(chunks).toString()) });
      if (mode === 'redirect') { res.writeHead(302, { location: 'https://untrusted.fixture.invalid/', 'content-type': 'text/plain' }); res.end(fake); return; }
      if (mode === 'http-429') { res.writeHead(429, { 'content-type': 'text/plain' }); res.end(fake); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 71, completion_tokens: 8 } }) + '\n\ndata: [DONE]\n\n');
    } catch { res.destroy(); }
  });
  origin.on('connection', track); origin.on('tlsClientError', () => {});
  origin.listen(0, '127.0.0.1'); await once(origin, 'listening'); originPort = origin.address().port;
  proxy = http.createServer((_req, res) => { res.writeHead(405); res.end(); });
  proxy.on('connection', track);
  proxy.on('connect', (req, client, head) => {
    connects.push({ target: req.url, host: req.headers.host, headerNames: Object.keys(req.headers), headBytes: head.length });
    if (mode === 'proxy-407' || mode === 'proxy-502') { client.end('HTTP/1.1 ' + (mode === 'proxy-407' ? '407 Proxy Authentication Required' : '502 Bad Gateway') + '\r\nContent-Length: 0\r\n\r\n'); return; }
    if (req.url !== 'api.deepseek.com:443' || req.headers.host !== 'api.deepseek.com:443' || head.length) { client.destroy(); return; }
    const upstream = track(new net.Socket());
    upstream.once('error', () => client.destroy()); client.once('error', () => upstream.destroy());
    // Captured outer circuit-breaker bypasses only the client's inner policy for this fixture server.
    guardedConnect.call(upstream, { host: '127.0.0.1', port: originPort });
    upstream.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); upstream.pipe(client); client.pipe(upstream); });
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening'); proxyPort = proxy.address().port;
  function guardedConnect(...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (!first || typeof first !== 'object' || first.path || first.host !== '127.0.0.1' || ![originPort, proxyPort].includes(Number(first.port))) { blockedNetwork++; throw new Error('Local fixture blocks every other socket'); }
    return original.socketConnect.apply(this, args);
  }
  net.Socket.prototype.connect = guardedConnect;
  tls.connect = function (options, ...args) { return original.tlsConnect.call(this, { ...options, ca: mode === 'bad-certificate' ? foreignCa : ca }, ...args); };
  const denyDns = () => { dnsCalls++; throw new Error('Local fixture forbids DNS'); };
  dns.lookup = denyDns; dnsPromises.lookup = denyDns; syncBuiltinESMExports();
  const esbuild = createRequire(require.resolve('vite'))('esbuild');
  const file = path.join(folder, 'registry.cjs');
  esbuild.buildSync({ stdin: { contents: "export { ProviderRegistry } from './src/main/providers/ProviderRegistry'; export { TrialDiagnostics } from './src/main/providers/diagnostics'; export { createSafeFetch } from './src/main/providers/network';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: file });
  const bundle = new Module(file); bundle.paths = createRequire(path.join(process.cwd(), 'package.json')).resolve.paths('zod');
  bundle._compile(fs.readFileSync(file, 'utf8'), file);
  const { ProviderRegistry, TrialDiagnostics, createSafeFetch } = bundle.exports;
  const db = { getProviderConfiguration: () => config, validateModelSelection: () => config, getProviderKeyRevision: () => 'owned-connect-revision' };
  const keys = { getProviderKeyState: async () => ({ keyReference: config.keyReference }), resolveKey: async () => { keyReads++; return fake; } };
  const policy = { hostname: '127.0.0.1', port: proxyPort };
  const diagnostic = () => new TrialDiagnostics(() => {});
  const directDiagnostic = diagnostic();
  await assert.rejects(createSafeFetch(undefined, async () => [{ address: '198.18.0.12', family: 4 }], directDiagnostic.observe)(target, { method: 'POST', body: '{}' })); assertions++;
  equal(directDiagnostic.snapshot().category, 'target_rejected', 'Direct Fake-IP is still rejected');
  equal(connects.length, 0, 'Direct rejection opens no CONNECT'); cases++; console.log('PASS ' + cases + ' direct Fake-IP rejected');
  for (mode of ['success', 'unarmed', 'no-lease', 'bad-certificate', 'wrong-hostname', 'proxy-407', 'proxy-502', 'redirect', 'http-429']) {
    connects = []; requests = []; keyReads = 0;
    origin.setSecureContext(context(mode === 'wrong-hostname' ? 'mismatch' : 'origin'));
    const registry = new ProviderRegistry(db, keys, { proxy: policy });
    registry.confirmTarget({ providerId: config.id, baseUrl: config.baseUrl, confirmed: true });
    const diagnosticStages = [];
    const d = new TrialDiagnostics(value => diagnosticStages.push(value.stage));
    gate = installControlledNetwork({ sendAuthorized: mode !== 'unarmed', proxyUrl: 'http://127.0.0.1:' + proxyPort, trustProxyDns: true, priceExpiresAt: new Date(Date.now() + 60000).toISOString() });
    try {
      gate.attachRegistry(ProviderRegistry.prototype);
      if (mode === 'unarmed') check(!gate.approve(config.id), 'Unarmed launch cannot issue a lease');
      else if (mode !== 'no-lease') check(gate.approve(config.id), 'Explicit local fixture permit granted');
      const result = await collect(registry, d);
      const errors = result.events.filter(event => event.type === 'error');
      check(!JSON.stringify({ events: result.events, diagnostics: result.diagnostics }).includes(fake), 'No fake credential in events or persisted safe diagnostics');
      if (mode === 'unarmed' || mode === 'no-lease') {
        check(result.thrown, 'No lease rejects before real Registry invocation');
        equal(keyReads, 0, 'No credential read without authorization'); equal(connects.length, 0, 'No socket without authorization'); equal(requests.length, 0, 'No origin HTTP without authorization');
      } else {
        equal(connects.length, 1, 'Exactly one CONNECT, no retry');
        equal(connects[0].target, 'api.deepseek.com:443', 'CONNECT target is exact reviewed authority');
        check(!connects[0].headerNames.includes('authorization') && !connects[0].headerNames.includes('proxy-authorization'), 'CONNECT carries no origin/proxy credentials');
        equal(connects[0].headBytes, 0, 'CONNECT has no prefetched application bytes');
        equal(keyReads, 1, 'Only one fake credential read');
        if (mode === 'success') {
          check(!result.thrown && !errors.length, 'Real Registry/Adapter/transport/gate succeeds');
          for (const stage of ['tcp', 'proxy', 'tls', 'request', 'response']) check(diagnosticStages.includes(stage), 'Real diagnostic stage observed: ' + stage);
          equal(result.events.filter(event => event.type === 'text_delta').map(event => event.text).join(''), 'OK', 'TLS SSE crosses real production parser');
          equal(result.events.find(event => event.type === 'usage'), { type: 'usage', requestId: input.requestId, inputTokens: 71, outputTokens: 8 }, 'Actual fixture usage is normalized');
          equal(result.events.at(-1), { type: 'finish', requestId: input.requestId, reason: 'stop' }, 'Terminal finish preserved');
          equal(requests.length, 1, 'Exactly one origin request');
          equal(requests[0], { method: 'POST', path: '/chat/completions', host: 'api.deepseek.com', fakeKeyMatches: true, sni: 'api.deepseek.com', body: expectedBody }, 'Exact body/128/thinking/fakeKey/host/SNI');
          equal(result.diagnostics.evidence, 'http_response', 'Origin HTTP observed'); equal(result.diagnostics.httpStatus, 200, 'Origin status only');
          check(!gate.approve(config.id), 'One shot cannot be granted twice');
          const again = await collect(registry, diagnostic()); check(again.thrown, 'Second request denied'); equal(connects.length, 1, 'Second request creates no second CONNECT');
        } else {
          check(result.thrown || errors.length === 1, 'Failure remains explicit');
          if (mode === 'bad-certificate' || mode === 'wrong-hostname') {
            equal(requests.length, 0, 'Invalid TLS sends no origin HTTP or credential');
            equal(result.diagnostics.category, 'tls_failed', 'TLS failures diagnosed at TLS stage');
            equal(result.diagnostics.evidence, 'client_invoked', 'No service delivery claim from CONNECT/TLS');
          } else if (mode.startsWith('proxy-')) {
            equal(requests.length, 0, 'Proxy rejection never reaches origin HTTP');
            equal(result.diagnostics.category, 'proxy_rejected', 'Proxy error has fixed safe category');
            equal(result.diagnostics.evidence, 'client_invoked', 'Proxy response is not origin response evidence');
            check(result.diagnostics.httpStatus === undefined, 'Proxy status cannot become DeepSeek status');
          } else {
            equal(requests.length, 1, 'HTTP error does not retry'); equal(result.diagnostics.category, 'http_error', 'Origin HTTP failure diagnosed'); equal(result.diagnostics.httpStatus, mode === 'redirect' ? 302 : 429, 'Only observed origin HTTP status retained');
          }
          check(!gate.approve(config.id), 'Failed one-shot cannot be reissued');
        }
      }
      equal(dnsCalls, 0, 'Proxy route never depends on local Fake-IP DNS');
      cases++; console.log('PASS ' + cases + ' ' + mode);
    } finally { gate.restore(); gate = undefined; await closeSockets(); }
  }
  equal(blockedNetwork, 0, 'No attempted non-fixture socket');
  console.log('CONTROLLED_PROXY_TLS_PASS ' + JSON.stringify({ cases, assertions, publicRequests: 0, publicDns: dnsCalls, realKeyReads: 0, desktopProfileAccess: false, systemTrustChanged: false, electron: process.versions.electron ?? null, abi: process.versions.modules, artifacts: folder }));
}
main().catch(error => { console.error('CONTROLLED_PROXY_TLS_FAIL ' + (error?.code === 'ERR_ASSERTION' ? error.message : error?.code ?? 'unclassified fixture failure')); process.exitCode = 1; }).finally(async () => {
  clearTimeout(globalTimer); gate?.restore();
  net.Socket.prototype.connect = original.socketConnect; tls.connect = original.tlsConnect; dns.lookup = original.dnsLookup; dnsPromises.lookup = original.promiseLookup; syncBuiltinESMExports();
  await closeSockets();
  if (proxy?.listening) await new Promise(resolve => proxy.close(resolve));
  if (origin?.listening) await new Promise(resolve => origin.close(resolve));
});
