// Native calls are simulated. This probe never opens a socket, profile, DB or Keychain.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http'), https = require('node:https'), net = require('node:net'), tls = require('node:tls');
const { installControlledNetwork } = require('../../scripts/controlled-desktop/controlled-network.cjs');
const target = 'https://api.deepseek.com/chat/completions';
const input = { requestId: 'fake-proxy-gate', modelId: 'deepseek-flash', messages: [{ role: 'user', content: 'Reply OK.' }], outputTokenLimit: 128 };
const body = JSON.stringify({ model: 'deepseek-flash', messages: input.messages, stream: true, max_tokens: 128,
  stream_options: { include_usage: true }, thinking: { type: 'disabled' } });
const originals = { httpRequest: http.request, httpsRequest: https.request, tlsConnect: tls.connect, socketConnect: net.Socket.prototype.connect };
let assertions = 0, cases = 0;
const check = (condition, name) => { assert.ok(condition, name); assertions++; };

async function run(mode) {
  const observed = { connect: 0, tls: 0, posts: 0, raw: 0 };
  net.Socket.prototype.connect = function () { observed.raw++; return this; };
  http.request = function (options) {
    observed.connect++;
    const req = new EventEmitter(), raw = new EventEmitter();
    raw.destroy = () => {};
    net.Socket.prototype.connect.call(raw, { host: options.hostname, port: options.port });
    req.write = () => {}; req.destroy = () => {};
    req.end = () => {
      queueMicrotask(() => {
        raw.emit('connect');
        req.emit('connect', { statusCode: 200 }, raw, Buffer.alloc(0));
      });
      return req;
    };
    return req;
  };
  tls.connect = function () {
    observed.tls++;
    const socket = new EventEmitter(); socket.authorized = true; socket.destroy = () => {};
    queueMicrotask(() => socket.emit('secureConnect'));
    return socket;
  };
  https.request = function (_url, options, response) {
    const req = new EventEmitter(); req.write = () => {}; req.destroy = () => { req.destroyed = true; };
    req.end = () => { if (!req.destroyed) { observed.posts++; response({ statusCode: 200 }); } return req; };
    queueMicrotask(() => options.agent.createConnection(options, (error, socket) => {
      if (error) { req.emit('error', error); return; }
      req.emit('socket', socket);
      if (mode === 'early-body') {
        try { req.end(body); } catch (error) { req.emit('error', error); }
      }
    }));
    return req;
  };
  const gate = installControlledNetwork({ sendAuthorized: mode !== 'unarmed',
    priceExpiresAt: new Date(Date.now() + 30000).toISOString(),
    proxyUrl: 'http://127.0.0.1:7890', trustProxyDns: true });
  class FakeRegistry {
    createTransport(guard) {
      return (url, init) => new Promise((resolve, reject) => {
        const agent = new https.Agent();
        agent.createConnection = function (_options, callback) {
          try {
            const connect = http.request({ hostname: mode === 'remote-proxy' ? '192.0.2.10' : '127.0.0.1', port: 7890,
              method: mode === 'proxy-get' ? 'GET' : 'CONNECT', agent: false,
              path: mode === 'wrong-target' ? 'internal.example:443' : mode === 'wrong-port' ? 'api.deepseek.com:444' : 'api.deepseek.com:443',
              maxHeaderSize: 8192, headers: mode === 'proxy-auth' ? { Host: 'api.deepseek.com:443', 'Proxy-Authorization': 'fake-only' } : { Host: 'api.deepseek.com:443' },
            });
            connect.on('error', callback);
            connect.on('connect', (_response, socket) => {
              try {
                const secure = tls.connect({ socket: mode === 'other-tunnel' ? new EventEmitter() : socket,
                  servername: mode === 'wrong-sni' ? 'other.example' : 'api.deepseek.com', rejectUnauthorized: mode !== 'tls-off',
                  ...(mode === 'tls-identity-bypass' ? { checkServerIdentity: () => undefined } : {}) });
                callback(null, secure);
              } catch (error) { callback(error); }
            });
            connect.end();
          } catch (error) { callback(error); }
        };
        try {
          const req = https.request(url, { method: 'POST', agent: mode === 'direct-fallback' ? false : agent,
            rejectUnauthorized: true, servername: 'api.deepseek.com' }, () => resolve(new Response('OK')));
          req.on('error', reject);
          req.once('socket', socket => socket.once('secureConnect', () => {
            if (req.destroyed) return;
            try { guard(); req.end(init.body); } catch (error) { reject(error); }
          }));
        } catch (error) { reject(error); }
      });
    }
    async *streamControlledTrial(_provider, _input, guard) {
      const response = await this.createTransport(guard)(target, { method: 'POST', redirect: 'error', body });
      yield { type: 'text_delta', text: await response.text() };
    }
  }
  try {
    gate.attachRegistry(FakeRegistry.prototype);
    check(gate.approve('fake-provider') === (mode !== 'unarmed'), mode + ': permit state');
    let error, values = [];
    try { for await (const value of new FakeRegistry().streamControlledTrial('fake-provider', input, () => {})) values.push(value); }
    catch (failure) { error = failure; }
    if (mode === 'success') {
      if (error) throw error;
      check(observed.connect === 1 && observed.raw === 1 && observed.tls === 1 && observed.posts === 1, 'exactly one ordered proxy/TLS/POST chain');
      check(values[0]?.text === 'OK', 'origin response returned');
      check(gate.approve('fake-provider') === false, 'no second permit');
    } else {
      check(!!error, mode + ': rejected');
      check(observed.posts === 0, mode + ': no origin body');
      check(gate.status().denied > 0, mode + ': gate records safe denial');
    }
    cases++; console.log('PASS ' + mode);
  } finally {
    gate.restore();
    http.request = originals.httpRequest; https.request = originals.httpsRequest;
    tls.connect = originals.tlsConnect; net.Socket.prototype.connect = originals.socketConnect;
  }
}

(async () => {
  for (const mode of ['success', 'unarmed', 'remote-proxy', 'proxy-get', 'wrong-target', 'wrong-port', 'proxy-auth', 'other-tunnel', 'wrong-sni', 'tls-off', 'tls-identity-bypass', 'direct-fallback', 'early-body']) await run(mode);
  for (const options of [{ proxyUrl: 'http://127.0.0.1:7890' }, { trustProxyDns: true },
    { proxyUrl: 'http://user:fake@127.0.0.1:7890', trustProxyDns: true },
    { proxyUrl: 'http://localhost:7890', trustProxyDns: true },
    { proxyUrl: 'http://127.0.0.1:65536', trustProxyDns: true }]) {
    assert.throws(() => installControlledNetwork({ ...options, priceExpiresAt: new Date(Date.now() + 30000).toISOString() })); assertions++;
  }
  console.log('CONTROLLED_PROXY_GATE_PASS ' + JSON.stringify({ cases, assertions, realSockets: 0, publicRequests: 0, realKeyReads: 0 }));
})().catch(error => { console.error('CONTROLLED_PROXY_GATE_FAIL ' + String(error)); process.exitCode = 1; });
