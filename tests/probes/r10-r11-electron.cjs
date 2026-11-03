// Finite production-entry smoke. Only private fixture data and a fully fake safeStorage backend.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, session, safeStorage, screen } = require('electron');

const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === '--restart', 'Usage: electron r10r11-electron.cjs [--restart private-manifest.json]');
const restarting = args.length === 2;
assert.equal(app.isReady(), false, 'Isolation must precede readiness/Main');
app.commandLine.appendSwitch('use-mock-keychain');
assert.equal(app.commandLine.hasSwitch('use-mock-keychain'), true, 'Chromium Keychain isolation switch missing');
const directory = restarting ? dirname(resolve(args[1])) : fs.mkdtempSync(join(tmpdir(), 'roundtable-r10r11-production-'));
assert.ok(basename(directory).startsWith('roundtable-r10r11-production-') && fs.realpathSync(dirname(directory)) === fs.realpathSync(tmpdir()), 'Only this probe owned temporary profile is allowed');
assert.ok(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'Profile directory cannot be a symlink');
assert.equal(fs.statSync(directory).uid, process.getuid());
const manifestPath = join(directory, 'r10r11-manifest.json');
assert.equal(restarting ? resolve(args[1]) : manifestPath, manifestPath);
const ownerPath = join(directory, 'r10r11-owner.json');
if (!restarting) fs.writeFileSync(ownerPath, JSON.stringify({ probe: 'R10/R11 production smoke', uid: process.getuid(), directory }), { mode: 0o600, flag: 'wx' });
const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
assert.deepEqual(owner, { probe: 'R10/R11 production smoke', uid: process.getuid(), directory });
assert.equal(fs.statSync(ownerPath).uid, process.getuid());
const prior = restarting ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : undefined;
if (restarting) assert.equal(prior.status, 'PASS');
const paths = Object.fromEntries(['userData', 'sessionData', 'logs'].map(name => [name, join(directory, name)]));
for (const [name, path] of Object.entries(paths)) { fs.mkdirSync(path, { recursive: true, mode: 0o700 }); assert.ok(fs.lstatSync(path).isDirectory() && !fs.lstatSync(path).isSymbolicLink(), 'Profile child cannot be a symlink'); app.setPath(name, path); assert.equal(app.getPath(name), path); }
assert.equal(fs.existsSync(join(paths.userData, 'ai-roundtable.db')), restarting);
delete process.env.ELECTRON_RENDERER_URL;
const root = resolve(__dirname, '../..');
const build = process.env.ROUNDTABLE_PROBE_BUILD ? resolve(process.env.ROUNDTABLE_PROBE_BUILD) : join(root, 'out');
const entry = join(build, 'main/index.js'); const preload = join(build, 'preload/index.cjs'); const renderer = join(build, 'renderer/index.html');
for (const file of [entry, preload, renderer]) assert.ok(fs.existsSync(file), 'Build missing: ' + file);
const result = { status: 'RUNNING', phase: restarting ? 'restart' : 'first', directory, paths, entry, preload, renderer, runtime: { electron: process.versions.electron, node: process.versions.node, abi: process.versions.modules, arch: process.arch }, isolationBeforeReady: !app.isReady(), chromiumMockKeychain: app.commandLine.hasSwitch('use-mock-keychain'), fakeSafeStorage: { replacedMethods: [], encrypt: 0, decrypt: 0 }, nodeNetworkAttempts: [], chromiumNetworkAttempts: [], consoleErrors: [], preloadErrors: [], checks: [] };
const resultPath = join(directory, restarting ? 'r10r11-restart.json' : 'r10r11-first.json');
const save = () => fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
const fake = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'r10r11-fixture-only',
  encryptString: value => { result.fakeSafeStorage.encrypt++; return Buffer.from([...Buffer.from(value)].map(value => value ^ 0xa5)); },
  decryptString: value => { result.fakeSafeStorage.decrypt++; return Buffer.from([...value].map(value => value ^ 0xa5)).toString(); },
  setUsePlainTextEncryption: () => { throw new Error('Fixture does not allow plaintext storage'); },
};
const safeStorageMethods = Object.getOwnPropertyNames(safeStorage).filter(name => typeof safeStorage[name] === 'function');
assert.ok(safeStorageMethods.length > 0, 'safeStorage method inventory is empty');
for (const name of safeStorageMethods) assert.ok(Object.hasOwn(fake, name), 'Unisolated safeStorage method: ' + name);
for (const [name, implementation] of Object.entries(fake)) {
  safeStorage[name] = implementation; assert.equal(safeStorage[name], implementation, 'Cannot isolate safeStorage.' + name); result.fakeSafeStorage.replacedMethods.push(name);
}
assert.equal(safeStorage.isEncryptionAvailable, fake.isEncryptionAvailable);
assert.equal(safeStorage.encryptString, fake.encryptString); assert.equal(safeStorage.decryptString, fake.decryptString);
const http = require('node:http');
const { syncBuiltinESMExports } = require('node:module');
const requests = []; let port;
const fixture = http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const kind = req.url.startsWith('/anthropic/') ? 'anthropic' : 'gemini';
    assert.equal(req.headers[kind === 'anthropic' ? 'x-api-key' : 'x-goog-api-key'], 'r10r11-fake-' + kind);
    assert.equal(req.headers.authorization, undefined);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    requests.push({ kind, method: req.method, path: req.url, body });
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(kind === 'anthropic' ? { data: [{ id: 'fixture', display_name: 'Owned native fixture' }], has_more: false }
        : { models: [{ name: 'models/fixture', displayName: 'Owned native fixture', supportedGenerationMethods: ['generateContent'] }] })); return;
    }
    assert.equal(req.method, 'POST');
    assert.equal(kind === 'anthropic' ? body.max_tokens : body.generationConfig.maxOutputTokens, 128);
    assert.equal(body.max_completion_tokens, undefined);
    const text = 'Native public output ' + requests.length;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (kind === 'anthropic') {
      assert.equal(body.model, 'fixture'); assert.equal(body.stream, true);
      const emit = event => res.write('event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n');
      emit({ type: 'message_start', message: { id: 'owned-native-message', type: 'message', role: 'assistant', model: 'fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
      setTimeout(() => { if (res.destroyed) return; emit({ type: 'content_block_stop', index: 0 }); emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } }); emit({ type: 'message_stop' }); res.end(); }, 100);
    } else {
      assert.equal(body.generationConfig.candidateCount, 1);
      const emit = event => res.write('data: ' + JSON.stringify(event) + '\n\n');
      emit({ candidates: [{ index: 0, content: { role: 'model', parts: [{ text }] } }] });
      setTimeout(() => { if (res.destroyed) return; emit({ candidates: [{ index: 0, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4, thoughtsTokenCount: 0, cachedContentTokenCount: 0, totalTokenCount: 24 } }); res.end(); }, 100);
    }
  } catch (error) { fail(error); }
});
const originalRequest = http.request;
http.request = function (url) { const target = new URL(String(url)); assert.equal(target.hostname, '127.0.0.1'); assert.equal(Number(target.port), port); return originalRequest.apply(this, arguments); };
http.get = () => { throw new Error('Unexpected HTTP get'); };
const https = require('node:https'); https.request = https.get = () => { result.nodeNetworkAttempts.push('remote https blocked'); throw new Error('Remote TLS blocked'); };
globalThis.fetch = async () => { result.nodeNetworkAttempts.push('global fetch blocked'); throw new Error('Remote fetch blocked'); };
for (const name of ['ROUNDTABLE_CONNECT_PROXY', 'ROUNDTABLE_TRUST_PROXY_DNS', 'ROUNDTABLE_TRIAL_ALLOW_ONCE', 'ROUNDTABLE_TRIAL_PROVIDER_ID']) delete process.env[name];
syncBuiltinESMExports();
const fail = error => { result.status = 'FAIL'; result.error = error instanceof Error ? error.stack : typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error); save(); console.error('R10_R11_FAIL ' + JSON.stringify({ resultPath, error: result.error })); app.exit(1); };
const timer = setTimeout(() => fail(new Error('Bounded production probe timed out')), 240000);
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
async function main() {
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve)); port = fixture.address().port;
  const { ProviderRegistry: Registry } = await import(pathToFileURL(entry).href);
  assert.equal(typeof Registry, 'function');
  const transport = Registry.prototype.createTransport;
  Registry.prototype.createTransport = function (guard, diagnostics) {
    const send = transport.call(this, guard, diagnostics);
    return (url, init) => { const target = new URL(String(url)); const kind = target.origin === 'https://api.anthropic.com' ? 'anthropic' : target.origin === 'https://generativelanguage.googleapis.com' ? 'gemini' : null;
      assert.ok(kind, 'No non-native fixture target allowed'); return send(`http://127.0.0.1:${port}/${kind}${target.pathname}${target.search}`, init); };
  };
  await guarded; const window = await loaded; const contents = window.webContents;
  const preferences = contents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
  assert.equal(contents.getURL(), pathToFileURL(renderer).href);
  result.ui = await require('./r10-r11-ui.cjs')(contents, restarting ? 'restart' : 'first', prior?.saved);
  result.assertions = result.ui.assertions; assert.ok(result.assertions >= (restarting ? 8 : 50), 'Expected assertions did not execute');
  assert.deepEqual(result.nodeNetworkAttempts, []); assert.deepEqual(result.chromiumNetworkAttempts, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.preloadErrors, []);
  assert.ok(!JSON.stringify(result.ui).includes('r10r11-fake-'), 'Key leaked to public result');
  if (restarting) assert.equal(requests.length, 0, 'Restart automatically sent a request');
  else { assert.ok(requests.some(r => r.kind === 'anthropic' && r.method === 'POST')); assert.ok(requests.some(r => r.kind === 'gemini' && r.method === 'POST'));
    for (const run of result.ui.runs) {
      assert.equal(run.workflow.completedTurns, run.workflow.totalTurns);
      assert.deepEqual(run.turns.map(t => t.agentId), run.workflowSnapshot.steps.map(s => s.agentId));
      assert.equal(run.attempts.length, run.turns.length); assert.ok(run.attempts.every(a => a.status === 'completed'));
    }
    fs.writeFileSync(manifestPath, JSON.stringify({ status: 'PASS', directory, saved: result.ui.saved }), { mode: 0o600, flag: 'wx' });
  }
  result.requests = requests; result.status = 'PASS'; save();
  console.log('R10_R11_PRODUCTION_PASS ' + JSON.stringify({ resultPath, manifestPath, assertions: result.assertions, requests: requests.length, liveApi: false }));
  await new Promise(resolve => { fixture.closeAllConnections(); fixture.close(resolve); }); app.quit();
}
save(); main().catch(fail);
