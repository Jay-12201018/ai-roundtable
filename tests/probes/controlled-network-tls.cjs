// Test-only TLS plumbing. No desktop profile, database, Keychain, public DNS or API access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { syncBuiltinESMExports } = require('node:module');
const { installControlledNetwork } = require('../../scripts/controlled-desktop/controlled-network.cjs');
const target = 'https://api.deepseek.com/chat/completions';
const fake = 'fake-local-tls-fixture-only';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roundtable-network-tls-'));
fs.chmodSync(dir, 0o700);
const write = (name, text) => fs.writeFileSync(path.join(dir, name), text, { mode: 0o600 });
const openssl = args => execFileSync('/usr/bin/openssl', args, { cwd: dir, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
let server, originalRequest, publicAttempts = 0, assertions = 0, cases = 0;
let requests = [], clientErrors = 0, secureConnects = 0;
const check = (condition, name) => { assert.ok(condition, name); assertions++; };
const input = () => ({ requestId: 'tls-fixture-only', modelId: 'deepseek-flash',
  messages: [{ role: 'user', content: 'Reply OK.' }], outputTokenLimit: 128 });
const body = () => ({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'Reply OK.' }],
  stream: true, max_tokens: 128, stream_options: { include_usage: true }, thinking: { type: 'disabled' } });
const timer = setTimeout(() => { console.error('LOCAL_TLS_FIXTURE_TIMEOUT'); process.exit(124); }, 90000);
async function main() {
  write('ca.cnf', '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=Roundtable Local TLS Fixture CA\n[v3]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  write('server.cnf', '[req]\nprompt=no\ndistinguished_name=dn\nreq_extensions=v3\n[dn]\nCN=localhost\n[v3]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n');
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '1', '-config', 'ca.cnf']);
  openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-config', 'server.cnf']);
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-set_serial', '1', '-out', 'server.pem', '-days', '1', '-extfile', 'server.cnf', '-extensions', 'v3']);
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'foreign-ca.key', '-out', 'foreign-ca.pem', '-days', '1', '-subj', '/CN=Unrelated Local Fixture CA']);
  const ca = fs.readFileSync(path.join(dir, 'ca.pem'));
  const foreignCa = fs.readFileSync(path.join(dir, 'foreign-ca.pem'));
  server = https.createServer({ key: fs.readFileSync(path.join(dir, 'server.key')), cert: fs.readFileSync(path.join(dir, 'server.pem')) }, async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      requests.push({ method: req.method, url: req.url, fakeKeyMatches: req.headers.authorization === 'Bearer ' + fake,
        body: JSON.parse(Buffer.concat(chunks).toString()), sni: req.socket.servername });
      res.writeHead(200, { 'content-type': 'text/plain' }); res.end('local TLS fixture OK');
    } catch { res.destroy(); }
  });
  server.on('tlsClientError', () => { clientErrors++; });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const fixtureOrigin = 'https://localhost:' + server.address().port;
  originalRequest = https.request;
  // Independent outer circuit breaker. No policy defect can turn this test into a public request.
  https.request = function (url, ...args) {
    if (!(typeof url === 'string' || url instanceof URL) || new URL(url).origin !== fixtureOrigin) {
      publicAttempts++; throw new Error('TLS fixture forbids public network');
    }
    return originalRequest.call(this, url, ...args);
  };
  syncBuiltinESMExports();
  for (const mode of ['trusted-ca', 'missing-ca', 'foreign-ca', 'reject-false', 'wrong-sni']) {
    requests = []; secureConnects = 0;
    const gate = installControlledNetwork({ sendAuthorized: true, fixtureOnly: true, fixtureOrigin, target,
      priceExpiresAt: new Date(Date.now() + 60000).toISOString() });
    const pinned = (_hostname, options, callback) => options.all
      ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4);
    class FakeRegistry {
      createTransport(guard) {
        return (url, init) => new Promise((resolve, reject) => {
          guard();
          const request = https.request(url, { method: init.method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + fake },
            agent: false, lookup: pinned, family: 4, servername: mode === 'wrong-sni' ? 'wrong.fixture.invalid' : 'localhost',
            rejectUnauthorized: mode !== 'reject-false',
            ...(mode === 'missing-ca' ? {} : { ca: mode === 'foreign-ca' ? foreignCa : ca }),
          }, response => {
            const chunks = []; response.on('data', chunk => chunks.push(chunk));
            response.once('error', reject);
            response.once('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode })));
          });
          request.once('error', reject);
          request.once('socket', socket => socket.once('secureConnect', () => {
            try { check(socket.authorized, 'TLS must be authorized before body'); secureConnects++; guard(); request.end(init.body); }
            catch (error) { request.destroy(); reject(error); }
          }));
        });
      }
      async *streamControlledTrial(_providerId, _input, guard) {
        const response = await this.createTransport(guard)(target, { method: 'POST', redirect: 'error', body: JSON.stringify(body()) });
        yield { type: 'text_delta', text: await response.text() }; yield { type: 'finish' };
      }
    }
    try {
      gate.attachRegistry(FakeRegistry.prototype); check(gate.approve('tls-fixture-provider'), 'Own request permit must be granted');
      const events = []; let failure;
      try { for await (const event of new FakeRegistry().streamControlledTrial('tls-fixture-provider', input(), () => {})) events.push(event); }
      catch (error) { failure = error; }
      if (mode === 'trusted-ca') {
        if (failure) throw failure;
        check(secureConnects === 1, 'Real TLS handshake completed exactly once');
        check(events[0]?.text === 'local TLS fixture OK' && events.at(-1)?.type === 'finish', 'Response crossed actual TLS socket');
        check(requests.length === 1, 'Exactly one local HTTPS request');
        check(requests[0].method === 'POST' && requests[0].url === '/chat/completions', 'Exact HTTP method/path');
        check(requests[0].fakeKeyMatches && requests[0].sni === 'localhost', 'Fake credential and local SNI');
        assert.deepEqual(requests[0].body, body()); assertions++;
        check(!gate.approve('tls-fixture-provider'), 'Launch permit cannot be reissued');
      } else {
        check(!!failure, mode + ' must reject');
        check(requests.length === 0, mode + ' sends no HTTP body');
        check(secureConnects === 0, mode + ' has no accepted TLS connection');
        if (mode === 'missing-ca' || mode === 'foreign-ca') check([
          'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT',
        ].includes(failure.code), mode + ' rejected specifically by certificate verification');
        if (mode === 'reject-false' || mode === 'wrong-sni') check(gate.status().denied > 0, mode + ' rejected by launch gate');
      }
      cases++; console.log('PASS ' + cases + ' ' + mode);
    } finally { gate.restore(); server.closeAllConnections(); }
  }
  check(publicAttempts === 0, 'No public endpoint reached');
  console.log('LOCAL_TLS_FIXTURE_PASS ' + JSON.stringify({ cases, assertions, publicNetworkAttempts: publicAttempts,
    localTlsClientErrors: clientErrors, systemTrustChanged: false, desktopProfileAccess: false,
    electron: process.versions.electron ?? null, abi: process.versions.modules, artifacts: dir }));
}
main().catch(error => { console.error('LOCAL_TLS_FIXTURE_FAIL ' + String(error)); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timer);
  if (originalRequest) { https.request = originalRequest; syncBuiltinESMExports(); }
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
