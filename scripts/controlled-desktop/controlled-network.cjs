// Local launch policy. It does not approve a model policy or a paid request.
const { AsyncLocalStorage } = require('node:async_hooks');
const http = require('node:http'), https = require('node:https'), net = require('node:net'), tls = require('node:tls');
const { syncBuiltinESMExports } = require('node:module');
const assert = require('node:assert/strict');

function installControlledNetwork(options = {}) {
  const target = 'https://api.deepseek.com/chat/completions';
  assert.ok(options.target === undefined || options.target === target);
  const expires = Date.parse(options.priceExpiresAt);
  assert.ok(Number.isFinite(expires));
  let wireTarget = new URL(target);
  if (options.fixtureOrigin !== undefined) {
    assert.equal(options.fixtureOnly, true);
    const origin = new URL(options.fixtureOrigin);
    assert.ok((origin.protocol === 'http:' && origin.hostname === '127.0.0.1' || origin.protocol === 'https:' && origin.hostname === 'localhost') && origin.port && origin.pathname === '/' && !origin.username && !origin.password && !origin.search && !origin.hash);
    wireTarget = new URL('/chat/completions', origin);
  } else assert.ok(!options.fixtureOnly);
  const controlled = new AsyncLocalStorage(), wire = new AsyncLocalStorage();
  const metrics = { granted: 0, started: 0, denied: 0 };
  const original = { httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get,
    netConnect: net.connect, netCreate: net.createConnection, socketConnect: net.Socket.prototype.connect,
    tlsConnect: tls.connect, fetch: globalThis.fetch };
  let pending, used = false, attached;
  const deny = () => { metrics.denied++; throw new Error('Controlled request is not authorized by this launch policy'); };
  const current = lease => {
    if (!lease || !lease.active || Date.now() >= expires || Date.now() >= lease.until) deny();
  };
  const socketOptions = args => {
    const context = wire.getStore(); current(context?.lease);
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (!context.nativeStarted || !first || typeof first !== 'object' || first.path
      || first.host !== wireTarget.hostname || Number(first.port) !== Number(wireTarget.port || 443)
      || first.lookup !== context.lookup) deny();
    return context;
  };
  const rawRequest = (native, protocol) => function (url, opts, callback) {
    const context = wire.getStore(); current(context?.lease);
    if (context.nativeStarted || protocol !== wireTarget.protocol || String(url) !== wireTarget.href
      || opts?.method !== 'POST' || opts.agent !== false || typeof opts.lookup !== 'function'
      || protocol === 'https:' && (opts.rejectUnauthorized !== true || opts.servername !== wireTarget.hostname)) deny();
    context.nativeStarted = true; context.lookup = opts.lookup;
    return native.call(this, url, opts, callback);
  };
  http.request = rawRequest(original.httpRequest, 'http:'); https.request = rawRequest(original.httpsRequest, 'https:');
  http.get = https.get = deny;
  net.Socket.prototype.connect = function (...args) { socketOptions(args); return original.socketConnect.apply(this, args); };
  net.connect = function (...args) { socketOptions(args); return original.netConnect.apply(this, args); };
  net.createConnection = function (...args) { socketOptions(args); return original.netCreate.apply(this, args); };
  tls.connect = function (...args) {
    socketOptions(args);
    if (args[0].rejectUnauthorized !== true || args[0].servername !== wireTarget.hostname) deny();
    return original.tlsConnect.apply(this, args);
  };
  globalThis.fetch = async () => deny(); syncBuiltinESMExports();
  function approve(providerId) {
    if (options.sendAuthorized !== true || pending || used || Date.now() >= expires || typeof providerId !== 'string' || !providerId) return false;
    pending = { providerId, until: Math.min(Date.now() + 120000, expires), active: true, sent: false };
    metrics.granted++; return true;
  }
  function attachRegistry(proto) {
    assert.ok(!attached);
    const stream = proto.streamControlledTrial, transport = proto.createTransport;
    assert.equal(typeof stream, 'function'); assert.equal(typeof transport, 'function');
    attached = { proto, stream, transport };
    proto.streamControlledTrial = async function* (providerId, input, permit, diagnostics) {
      const lease = pending;
      if (options.sendAuthorized !== true || !lease || used || lease.providerId !== providerId) deny();
      current(lease);
      if (input.modelId !== 'deepseek-flash' || input.outputTokenLimit !== 128 || input.agentRole !== undefined || input.turnIndex !== undefined
        || input.messages?.length !== 1 || input.messages[0].role !== 'user' || input.messages[0].content !== 'Reply OK.' || typeof input.requestId !== 'string') deny();
      pending = undefined; used = true; lease.requestId = input.requestId;
      const iterator = stream.call(this, providerId, input, permit, diagnostics);
      try {
        for (;;) {
          const next = await controlled.run(lease, () => iterator.next());
          if (next.done) return next.value;
          yield next.value;
        }
      } finally {
        lease.active = false;
        if (iterator.return) await controlled.run(lease, () => iterator.return());
      }
    };
    proto.createTransport = function (guard, diagnostics) {
      const lease = controlled.getStore(); current(lease);
      const fetcher = transport.call(this, guard, diagnostics);
      return async (url, init = {}) => {
        current(lease);
        if (lease.sent || String(url) !== target || init.method !== 'POST' || init.redirect !== 'error' || typeof init.body !== 'string' || init.body.length > 2048) deny();
        let body; try { body = JSON.parse(init.body); } catch { deny(); }
        if (Object.keys(body).some(k => !['model','messages','stream','max_tokens','stream_options','thinking'].includes(k))
          || body.model !== 'deepseek-flash' || body.stream !== true || body.max_tokens !== 128
          || body.messages?.length !== 1 || Object.keys(body.messages[0]).length !== 2
          || body.messages[0].role !== 'user' || body.messages[0].content !== 'Reply OK.'
          || Object.keys(body.thinking ?? {}).length !== 1 || body.thinking.type !== 'disabled'
          || Object.keys(body.stream_options ?? {}).length !== 1 || body.stream_options.include_usage !== true) deny();
        init.signal?.throwIfAborted(); guard();
        lease.sent = true; metrics.started++;
        // Headers and their secret values are forwarded untouched, never inspected or logged.
        return wire.run({ lease, nativeStarted: false }, () => fetcher(wireTarget.href, init));
      };
    };
  }
  function restore() {
    if (attached) { attached.proto.streamControlledTrial = attached.stream; attached.proto.createTransport = attached.transport; }
    Object.assign(http, { request: original.httpRequest, get: original.httpGet });
    Object.assign(https, { request: original.httpsRequest, get: original.httpsGet });
    Object.assign(net, { connect: original.netConnect, createConnection: original.netCreate });
    net.Socket.prototype.connect = original.socketConnect; tls.connect = original.tlsConnect; globalThis.fetch = original.fetch;
    syncBuiltinESMExports();
  }
  return { approve, attachRegistry, status: () => ({ ...metrics, sendAuthorized: options.sendAuthorized === true, expiresAt: options.priceExpiresAt }), restore };
}
module.exports = { installControlledNetwork };
