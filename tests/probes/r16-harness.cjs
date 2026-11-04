// R16 hands-on harness: an isolated profile (userData/sessionData/logs in an owned temp directory, fake safeStorage,
// mock keychain), all Node and Chromium network blocked, and only https://api.deepseek.com redirected to an owned
// loopback fixture that speaks DeepSeek's SSE. Input goes through the DevTools Input domain like a real mouse,
// keyboard and IME. Must be required before the app is ready.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, session, safeStorage, dialog } = require('electron');
const http = require('node:http');
const { syncBuiltinESMExports } = require('node:module');
const { holdFocus, emulateFocus, imeInput } = require('./ime-input.cjs');

function isolate(prefix, reuse) {
  assert.equal(app.isReady(), false, 'Isolation must precede readiness/Main');
  app.commandLine.appendSwitch('use-mock-keychain');
  // A restart phase reopens the profile its own first phase created (same prefix, owned, under the system temp directory).
  const directory = reuse ? resolve(reuse) : fs.mkdtempSync(join(tmpdir(), `${prefix}-`));
  assert.ok(basename(directory).startsWith(`${prefix}-`) && fs.realpathSync(dirname(directory)) === fs.realpathSync(tmpdir()), 'Only this probe owned temporary profile is allowed');
  assert.ok(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink());
  assert.equal(fs.statSync(directory).uid, process.getuid());
  const paths = Object.fromEntries(['userData', 'sessionData', 'logs'].map(name => [name, join(directory, name)]));
  for (const [name, path] of Object.entries(paths)) { fs.mkdirSync(path, { recursive: true, mode: 0o700 }); app.setPath(name, path); assert.equal(app.getPath(name), path); }
  const realProfile = join(app.getPath('appData'), 'ai-roundtable');
  assert.notEqual(resolve(paths.userData), resolve(realProfile), 'Probe must never open the real profile');
  assert.equal(fs.existsSync(join(paths.userData, 'ai-roundtable.db')), Boolean(reuse), reuse ? 'A restart reopens an existing profile' : 'A first phase starts empty');
  delete process.env.ELECTRON_RENDERER_URL;
  for (const name of ['ROUNDTABLE_TRIAL_ALLOW_ONCE', 'ROUNDTABLE_TRIAL_PROVIDER_ID']) delete process.env[name];
  return { directory, paths };
}

function createProbe({ prefix, name, timeoutMs = 600000, reuse, phase = 'first' }) {
  const { directory, paths } = isolate(prefix, reuse);
  const root = resolve(__dirname, '../..');
  const build = process.env.ROUNDTABLE_PROBE_BUILD ? resolve(process.env.ROUNDTABLE_PROBE_BUILD) : join(root, 'out');
  const entry = join(build, 'main/index.js');
  for (const file of [entry, join(build, 'preload/index.cjs'), join(build, 'renderer/index.html')]) assert.ok(fs.existsSync(file), 'Build missing: ' + file);
  const result = { status: 'RUNNING', probe: name, directory, runtime: { electron: process.versions.electron, node: process.versions.node }, fakeSafeStorage: { encrypt: 0, decrypt: 0 },
    nodeNetworkAttempts: [], chromiumNetworkAttempts: [], consoleErrors: [], preloadErrors: [], externalLinkPrompts: [], checks: [], screens: [] };
  const resultPath = join(directory, phase === 'first' ? `${prefix}.json` : `${prefix}-${phase}.json`);
  const save = () => fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  const fake = {
    isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'r16-fixture-only',
    encryptString: value => { result.fakeSafeStorage.encrypt++; return Buffer.from([...Buffer.from(value)].map(byte => byte ^ 0xa5)); },
    decryptString: value => { result.fakeSafeStorage.decrypt++; return Buffer.from([...value].map(byte => byte ^ 0xa5)).toString(); },
    setUsePlainTextEncryption: () => { throw new Error('Fixture does not allow plaintext storage'); },
  };
  for (const method of Object.getOwnPropertyNames(safeStorage).filter(method => typeof safeStorage[method] === 'function')) assert.ok(Object.hasOwn(fake, method), 'Unisolated safeStorage method: ' + method);
  for (const [method, implementation] of Object.entries(fake)) safeStorage[method] = implementation;
  // Main asks before opening an https link; the probe answers 取消 and records what it was asked.
  dialog.showMessageBoxSync = (_window, options) => { result.externalLinkPrompts.push({ title: options.title, message: options.message, detail: options.detail, buttons: options.buttons }); return 0; };
  dialog.showErrorBox = (title, content) => { result.consoleErrors.push(`errorBox: ${title} ${content}`); };

  // DeepSeek-shaped SSE fixture. `fixture.mode` per request: ok | hang | length | no-usage; `fixture.reply(body)` picks text.
  const fixture = { mode: 'ok', requests: [], hung: [], port: 0, chunkMs: 40, chunks: 6, reply: () => '好的。' };
  const usage = { prompt_tokens: 300, completion_tokens: 6, prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 200 };
  let failNow;
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      // The connect wizard checks a Key with the model list; nothing is generated.
      if (req.method === 'GET') { fixture.requests.push({ path: req.url, method: 'GET', model: '', maxTokens: 0, mode: 'ok', messages: [] }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'deepseek-flash' }] })); return; }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const mode = typeof fixture.mode === 'function' ? fixture.mode(body) : fixture.mode;
      fixture.requests.push({ path: req.url, model: body.model, maxTokens: body.max_tokens, mode, messages: body.messages });
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/deepseek/chat/completions');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = value => { if (!res.destroyed) res.write(`data: ${JSON.stringify(value)}\n\n`); };
      const text = fixture.reply(body);
      const parts = []; const size = Math.max(1, Math.ceil(text.length / fixture.chunks));
      for (let index = 0; index < text.length; index += size) parts.push(text.slice(index, index + size));
      const finish = reason => {
        emit({ id: 'owned-fixture', choices: [{ index: 0, delta: {}, finish_reason: reason }] });
        if (mode !== 'no-usage') emit({ id: 'owned-fixture', choices: [], usage: reason === 'length' ? { ...usage, completion_tokens: body.max_tokens } : usage });
        if (!res.destroyed) res.end('data: [DONE]\n\n');
      };
      for (const [index, part] of parts.entries()) {
        emit({ id: 'owned-fixture', choices: [{ index: 0, delta: { content: part }, finish_reason: null }] });
        if (mode === 'hang' && index === Math.min(1, parts.length - 1)) {
          // Hold the rest until the probe releases it (or Main aborts the request).
          await new Promise(release => fixture.hung.push(release));
        } else await new Promise(done => setTimeout(done, fixture.chunkMs));
        if (res.destroyed) return;
      }
      finish(mode === 'length' ? 'length' : 'stop');
    } catch (error) { failNow?.(error); }
  });
  fixture.release = () => { const waiting = fixture.hung.splice(0); for (const release of waiting) release(); return waiting.length; };
  const originalRequest = http.request;
  http.request = function (url) {
    const target = new URL(String(url)); assert.equal(target.hostname, '127.0.0.1'); assert.equal(Number(target.port), fixture.port); return originalRequest.apply(this, arguments);
  };
  http.get = () => { throw new Error('Unexpected HTTP get'); };
  const https = require('node:https'); https.request = https.get = () => { result.nodeNetworkAttempts.push('remote https blocked'); throw new Error('Remote TLS blocked'); };
  globalThis.fetch = async () => { result.nodeNetworkAttempts.push('global fetch blocked'); throw new Error('Remote fetch blocked'); };
  syncBuiltinESMExports();

  let failureShot;
  const fail = async error => {
    try { await failureShot?.(); } catch { /* best effort */ }
    result.status = 'FAIL'; result.error = error instanceof Error ? error.stack : typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error);
    save(); console.error(`${name}_FAIL ` + JSON.stringify({ resultPath, error: result.error })); app.exit(1);
  };
  failNow = fail;
  const timer = setTimeout(() => fail(new Error('Bounded probe timed out')), timeoutMs);
  process.once('exit', () => clearTimeout(timer)); process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
  const loaded = new Promise((yes, no) => app.once('browser-window-created', (_event, window) => {
    window.webContents.on('preload-error', (_e, _file, error) => { result.preloadErrors.push('preload failure'); no(error); });
    window.webContents.on('console-message', event => { if (event.level === 'error') result.consoleErrors.push(event.message); });
    window.webContents.once('did-finish-load', () => yes(window));
  }));
  const guarded = app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_c, _p, cb) => cb(false));
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => { const blocked = /^(https?|wss?):/u.test(details.url); if (blocked) result.chromiumNetworkAttempts.push('blocked network'); cb({ cancel: blocked }); });
  });
  const sleep = ms => new Promise(done => setTimeout(done, ms));
  const check = (value, message) => { result.checks.push(message); if (!value) throw new Error('Check failed: ' + message); };

  async function start({ screens, width = 1440, height = 900, keepScreens = false, firstShot = 0 }) {
    await new Promise(done => server.listen(0, '127.0.0.1', done)); fixture.port = server.address().port;
    const { ProviderRegistry: Registry } = await import(pathToFileURL(entry).href);
    const hosts = Registry.prototype.transportHosts;
    Registry.prototype.transportHosts = function () { const allowed = hosts.call(this); return { has: host => host === `127.0.0.1:${fixture.port}` || allowed.has(host) }; };
    const transport = Registry.prototype.createTransport;
    Registry.prototype.createTransport = function (guard, diagnostics) {
      const send = transport.call(this, guard, diagnostics);
      return (url, init) => { const target = new URL(String(url));
        assert.equal(target.origin, 'https://api.deepseek.com', 'Only the DeepSeek target may be redirected');
        return send(`http://127.0.0.1:${fixture.port}/deepseek${target.pathname}${target.search}`, init); };
    };
    await guarded; const window = await loaded; const contents = window.webContents;
    contents.setBackgroundThrottling(false);
    const preferences = contents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
    window.setContentSize(width, height);
    holdFocus(window);
    failureShot = async () => { fs.writeFileSync(join(directory, 'failure.png'), (await contents.capturePage()).toPNG()); result.failureText = await contents.executeJavaScript('document.body.innerText'); };
    if (screens && !keepScreens) { fs.mkdirSync(screens, { recursive: true }); for (const old of fs.readdirSync(screens)) if (/^\d\d-.*\.png$/u.test(old)) fs.rmSync(join(screens, old)); }
    const cdp = contents.debugger; cdp.attach('1.3');
    const send = (method, params = {}) => cdp.sendCommand(method, params);
    await emulateFocus(send);
    const js = code => contents.executeJavaScript(code);
    const until = async (code, message, timeout = 60000) => {
      const deadline = Date.now() + timeout;
      for (;;) { const value = await js(code); if (value) return value; if (Date.now() > deadline) throw new Error('Timed out: ' + message); await sleep(50); }
    };
    // Finds a visible control by accessible name (aria-label, enclosing label or own text) and scrolls it into view.
    const locator = `window.__r16 = (name, o = {}) => {
      const visible = e => e && !e.closest('[hidden]') && !e.closest('[inert]') && e.getClientRects().length > 0;
      // Visible text without decorations marked aria-hidden (a service logo, an icon), as a name is read.
      const shown = e => { const c = e.cloneNode(true); c.querySelectorAll('[aria-hidden="true"]').forEach(x => x.remove()); return c.textContent; };
      const label = e => (e.getAttribute('aria-label') || (e.tagName !== 'BUTTON' && e.labels && e.labels[0] ? e.labels[0].textContent : '') || (e.closest('label') && e.tagName !== 'BUTTON' ? e.closest('label').textContent : '') || shown(e) || '').trim();
      let list = [...document.querySelectorAll(o.selector || 'button,[role=option],summary')].filter(e => visible(e) && (o.prefix ? label(e).startsWith(name) : label(e) === name));
      if (o.scope) list = list.filter(e => e.closest(o.scope));
      if (o.slot !== undefined) { const slot = document.querySelectorAll('.thread-item')[o.slot]; list = list.filter(e => slot && slot.contains(e)); }
      const e = o.which === 'last' ? list.at(-1) : list[o.which || 0];
      if (!e) return null;
      if (!o.noScroll) e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top, disabled: e.disabled === true || e.getAttribute('aria-disabled') === 'true', focused: e === document.activeElement };
    }; true`;
    const ensureLocator = () => js(locator);
    await ensureLocator();
    const find = (name, options = {}) => js(`window.__r16(${JSON.stringify(name)}, ${JSON.stringify({ noScroll: true, ...options })})`);
    const point = async (name, options = {}) => until(`(() => { const p = (window.__r16 || (() => null))(${JSON.stringify(name)}, ${JSON.stringify(options)}); return p && (${options.allowDisabled ? 'true' : 'false'} || !p.disabled) ? p : null; })()`, 'control ' + name, options.timeout);
    const mouse = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };
    const click = async (name, options) => { const { x, y } = await point(name, options); await sleep(60); await mouse(x, y); await sleep(160); };
    // A click on a field ends with the caret in it.
    const field = async (name, options = {}) => {
      const located = { selector: 'textarea,input,select', ...options };
      await click(name, located);
      await until(`(window.__r16(${JSON.stringify(name)}, ${JSON.stringify({ ...located, noScroll: true })}) || {}).focused`, 'focus in ' + name, 5000);
    };
    const keys = {
      Enter: { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, Escape: { code: 'Escape', windowsVirtualKeyCode: 27 }, Tab: { code: 'Tab', windowsVirtualKeyCode: 9 },
      ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40 }, ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38 }, a: { code: 'KeyA', windowsVirtualKeyCode: 65 },
    };
    const key = async (keyName, modifiers = 0) => {
      const map = keys[keyName];
      const down = { type: map.text && !(modifiers & 4) ? 'keyDown' : 'rawKeyDown', key: keyName, modifiers, ...map, unmodifiedText: map.text, ...(keyName === 'a' && modifiers & 4 ? { commands: ['selectAll'] } : {}) };
      if (modifiers & 4) delete down.text;
      await send('Input.dispatchKeyEvent', down);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: map.code, windowsVirtualKeyCode: map.windowsVirtualKeyCode, modifiers });
      await sleep(140);
    };
    // Chinese arrives as an IME delivers it: a pinyin composition, optionally an Enter that only confirms, then the commit.
    const { selectAll, ime } = imeInput({ send, js, until, key });
    const type = text => send('Input.insertText', { text }).then(() => sleep(120));
    let shot = firstShot;
    const capture = async (file, caption, focus) => {
      if (focus) await js(`(() => { const e = typeof ${JSON.stringify(focus)} === 'string' ? document.querySelector(${JSON.stringify(focus)}) : null; e?.scrollIntoView({ block: 'center' }); return true; })()`);
      await sleep(400);
      const name = `${String(++shot).padStart(2, '0')}-${file}.png`;
      fs.writeFileSync(join(screens, name), (await contents.capturePage()).toPNG());
      result.screens.push({ file: name, caption });
      save();
    };
    const resize = async (w, h) => { window.setContentSize(w, h); await until(`window.innerWidth === ${w}`, `resize to ${w}`, 10000); await sleep(300); };
    const api = (path, ...input) => js(`window.roundtable.${path}(...${JSON.stringify(input)})`);
    const runSnapshot = () => js(`window.roundtable.run.getSnapshot(localStorage.getItem('roundtable.runId'))`);
    const status = () => js(`document.querySelector('[role=status][aria-label="运行状态"]')?.textContent ?? ''`);
    const text = () => js('document.body.innerText');
    const finish = async () => {
      assert.deepEqual(result.nodeNetworkAttempts, []); assert.deepEqual(result.chromiumNetworkAttempts, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.preloadErrors, []);
      cdp.detach();
      result.requests = fixture.requests.map(({ messages, ...rest }) => ({ ...rest, messageCount: messages.length }));
      result.status = 'PASS'; save();
      console.log(`${name}_PASS ` + JSON.stringify({ resultPath, checks: result.checks.length, screens: result.screens.length, requests: fixture.requests.length, liveApi: false }));
      fixture.release();
      await new Promise(done => { server.closeAllConnections(); server.close(done); }); app.quit();
    };
    return { window, contents, send, js, until, ensureLocator, find, point, mouse, click, field, key, selectAll, ime, type, capture, resize, api, runSnapshot, status, text, finish };
  }
  return { directory, paths, root, result, save, fixture, fail, check, sleep, start };
}

module.exports = { createProbe };
