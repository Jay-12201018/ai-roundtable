// Finite production-entry probe: fake secrets, an owned loopback fixture, no live-model permission.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { syncBuiltinESMExports } = require('node:module');
const { app, session, safeStorage, dialog, Menu, net: electronNet } = require('electron');

const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === '--restart', 'Usage: electron deepseek-trial-electron.cjs [--restart owned-manifest.json]');
const restarting = args.length === 2;
assert.equal(app.isReady(), false, 'Isolation must precede readiness and the production Main');
app.commandLine.appendSwitch('use-mock-keychain');
assert.ok(app.commandLine.hasSwitch('use-mock-keychain'));
const directory = restarting ? dirname(resolve(args[1])) : fs.mkdtempSync(join(tmpdir(), 'roundtable-deepseek-trial-'));
assert.ok(basename(directory).startsWith('roundtable-deepseek-trial-'));
assert.equal(fs.realpathSync(dirname(directory)), fs.realpathSync(tmpdir()));
assert.ok(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink());
assert.equal(fs.statSync(directory).uid, process.getuid());
const ownerPath = join(directory, 'trial-owner.json');
const manifestPath = join(directory, 'trial-manifest.json');
if (restarting) assert.equal(resolve(args[1]), manifestPath);
else fs.writeFileSync(ownerPath, JSON.stringify({ probe: 'DeepSeek controlled trial production', uid: process.getuid(), directory }), { mode: 0o600, flag: 'wx' });
for (const file of [ownerPath, ...(restarting ? [manifestPath] : [])]) {
  assert.ok(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink());
  assert.equal(fs.statSync(file).uid, process.getuid());
}
assert.deepEqual(JSON.parse(fs.readFileSync(ownerPath, 'utf8')), { probe: 'DeepSeek controlled trial production', uid: process.getuid(), directory });
const prior = restarting ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : undefined;
if (restarting) { assert.equal(prior.status, 'PASS'); assert.equal(prior.directory, directory); }
const paths = Object.fromEntries(['userData', 'sessionData', 'logs'].map(name => [name, join(directory, name)]));
for (const [name, path] of Object.entries(paths)) {
  fs.mkdirSync(path, { recursive: true, mode: 0o700 });
  assert.ok(fs.lstatSync(path).isDirectory() && !fs.lstatSync(path).isSymbolicLink());
  assert.equal(fs.statSync(path).uid, process.getuid());
  app.setPath(name, path); assert.equal(app.getPath(name), path);
}
const dbPath = join(paths.userData, 'ai-roundtable.db');
assert.equal(fs.existsSync(dbPath), restarting);
delete process.env.ELECTRON_RENDERER_URL;
const root = resolve(__dirname, '../..');
const entry = join(root, 'out/main/index.js');
const preload = join(root, 'out/preload/index.cjs');
const renderer = join(root, 'out/renderer/index.html');
for (const file of [entry, preload, renderer]) assert.ok(fs.existsSync(file), 'Production build missing: ' + file);
const resultPath = join(directory, restarting ? 'trial-restart.json' : 'trial-first.json');
const result = { status: 'RUNNING', phase: restarting ? 'restart' : 'first', directory, paths, dbPath,
  entry, preload, renderer, runtime: { electron: process.versions.electron, node: process.versions.node, abi: process.versions.modules, arch: process.arch },
  isolatedBeforeReady: !app.isReady(), chromiumMockKeychain: true, realKeychainCalls: 0,
  fakeStorage: { replacedMethods: [], encrypt: 0, decrypt: 0 }, policyInjected: false,
  nodeNetworkAttempts: [], chromiumNetworkAttempts: [], mappedTargets: [], requests: [], dialogs: [],
  preloadErrors: [], consoleErrors: [], checks: [] };
const save = () => fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
const check = (name, test) => { assert.ok(test, name); assert.ok(!result.checks.includes(name), 'Duplicate assertion name'); result.checks.push(name); };
const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); assert.ok(!result.checks.includes(name), 'Duplicate assertion name'); result.checks.push(name); };
const fakeKey = 'deepseek-trial-fake-key-only';
const fake = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'deepseek-trial-fixture-only',
  encryptString: value => { result.fakeStorage.encrypt++; return Buffer.from([...Buffer.from(value)].map(byte => byte ^ 0xa5)); },
  decryptString: value => { result.fakeStorage.decrypt++; return Buffer.from([...value].map(byte => byte ^ 0xa5)).toString(); },
  setUsePlainTextEncryption: () => { throw new Error('Probe forbids plaintext secret storage'); },
};
const storageMethods = Object.getOwnPropertyNames(safeStorage).filter(name => typeof safeStorage[name] === 'function');
assert.ok(storageMethods.length > 0);
for (const name of storageMethods) assert.ok(Object.hasOwn(fake, name), 'Unisolated safeStorage method: ' + name);
for (const [name, implementation] of Object.entries(fake)) {
  safeStorage[name] = implementation; assert.equal(safeStorage[name], implementation); result.fakeStorage.replacedMethods.push(name);
}

const http = require('node:http');
const https = require('node:https');
let fixturePort;
let fixtureMode = 'ok';
const fixture = http.createServer(async (request, response) => {
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    assert.equal(request.method, 'POST'); assert.equal(request.url, '/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer ' + fakeKey, 'Wrong Provider credential');
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.deepEqual(body, { model: 'deepseek-flash', messages: [{ role: 'user', content: 'Reply OK.' }], stream: true,
      max_tokens: 128, stream_options: { include_usage: true }, thinking: { type: 'disabled' } });
    const call = { method: request.method, path: request.url, credentialMatches: true, body, mode: fixtureMode, aborted: false };
    result.requests.push(call);
    response.on('close', () => { if (!response.writableEnded) call.aborted = true; });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: fixtureMode === 'hang' ? 'partial controlled fixture' : 'OK' }, finish_reason: null }] }) + '\n\n');
    if (fixtureMode === 'hang') return;
    response.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 71, completion_tokens: 8 } }) + '\n\n');
    response.end('data: [DONE]\n\n');
  } catch (error) { fail(error); }
});
const originalRequest = http.request;
http.request = function (url) {
  const value = typeof url === 'string' || url instanceof URL ? new URL(url) : url;
  if (value.hostname !== '127.0.0.1' || Number(value.port) !== fixturePort) {
    result.nodeNetworkAttempts.push('HTTP outside owned fixture'); throw new Error('Probe forbids nonfixture HTTP');
  }
  return originalRequest.apply(this, arguments);
};
http.get = () => { throw new Error('Probe does not use http.get'); };
const denyNetwork = name => () => { result.nodeNetworkAttempts.push(name); throw new Error('Probe forbids remote transport'); };
https.request = https.get = denyNetwork('HTTPS');
globalThis.fetch = async () => denyNetwork('global fetch')();
electronNet.request = denyNetwork('Electron net.request');
electronNet.fetch = async () => denyNetwork('Electron net.fetch')();
syncBuiltinESMExports();

let scenario = 'idle';
let providerId = restarting ? prior.providerId : undefined;
dialog.showMessageBox = async (...values) => {
  const options = values.at(-1);
  result.dialogs.push({ scenario, title: options.title ?? null, message: options.message, detail: options.detail ?? '',
    buttons: options.buttons ?? [], defaultId: options.defaultId ?? null, cancelId: options.cancelId ?? null });
  if (options.message === '选择本次测试的 Provider') {
    assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
    assert.equal(options.buttons.length, 2); assert.ok(options.buttons[1].includes(providerId));
    assert.ok(['cancel', 'success', 'hang', 'restart-blocked'].includes(scenario));
    return { response: 1 };
  }
  if (options.title === '授权一次 DeepSeek 受控测试') {
    assert.ok(['cancel', 'success', 'hang'].includes(scenario), 'Unexpected new authorization');
    assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
    assert.deepEqual(options.buttons, ['取消', '授权并发送这一次请求']);
    for (const text of [providerId, 'https://api.deepseek.com', 'deepseek-flash', '单 Agent', 'Reply OK.', '估算', '未校准', '并非精确计数', 'max_tokens=128', '关闭思考', '¥0.05', '不是服务商账单的绝对硬上限', '不自动重试']) assert.ok(options.detail.includes(text), 'Missing authorization detail: ' + text);
    return { response: scenario === 'cancel' ? 0 : 1 };
  }
  if (options.message === '没有发起新的自动重试' || options.message.startsWith('受控测试：')) return { response: 0 };
  throw new Error('Unexpected production dialog');
};

const loaded = new Promise((resolveWindow, reject) => app.once('browser-window-created', (_event, window) => {
  window.webContents.on('preload-error', (_event, file, error) => { result.preloadErrors.push({ file, error: String(error) }); reject(error); });
  window.webContents.on('console-message', (event, level, message) => { if (event.level === 'error' || level === 3) result.consoleErrors.push(event.message ?? message); });
  window.webContents.once('did-finish-load', () => resolveWindow(window));
}));
const guarded = app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const remote = /^(https?|wss?):/u.test(details.url);
    if (remote) result.chromiumNetworkAttempts.push(details.url);
    callback({ cancel: remote });
  });
});
const timeout = setTimeout(() => fail(new Error('Controlled trial production probe exceeded 120 seconds')), 120000);
process.once('exit', () => clearTimeout(timeout));
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
function fail(error) {
  result.status = 'FAIL'; result.error = error instanceof Error ? error.stack : String(error); save();
  console.error('DEEPSEEK_TRIAL_PRODUCTION_FAIL ' + JSON.stringify({ resultPath, error: result.error }));
  app.exit(1);
}
async function waitFor(read, accepts, message) {
  const deadline = Date.now() + 15000;
  while (true) {
    const value = await read();
    if (accepts(value)) return value;
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
}
const Sqlite = require(join(root, 'node_modules/better-sqlite3'));
function readTrials() {
  const database = new Sqlite(dbPath, { readonly: true, fileMustExist: true });
  try {
    return database.prepare('SELECT data_json FROM controlled_trials ORDER BY rowid').pluck().all().map(value => JSON.parse(value));
  } finally { database.close(); }
}
const finishedDialog = () => result.dialogs.filter(value => value.scenario === scenario
  && (value.message === '没有发起新的自动重试' || value.message.startsWith('受控测试：'))).length;
async function clickTrial(item, nextScenario) {
  scenario = nextScenario;
  const before = finishedDialog();
  item.click();
  await waitFor(finishedDialog, count => count > before, 'Production menu did not finish: ' + scenario);
  await new Promise(resolveTick => setImmediate(resolveTick));
}

async function main() {
  await new Promise(resolveListen => fixture.listen(0, '127.0.0.1', resolveListen));
  fixturePort = fixture.address().port;
  const built = await import(pathToFileURL(entry).href);
  const Registry = built.ProviderRegistry;
  assert.equal(typeof Registry, 'function', 'Production registry export missing');
  const originalModelPolicy = Registry.prototype.resolveModelPolicy;
  const originalCapabilities = Registry.prototype.resolveCapabilities;
  const createTransport = Registry.prototype.createTransport;
  Registry.prototype.createTransport = function (guard) {
    const transport = createTransport.call(this, guard);
    return (url, init) => {
      const target = new URL(String(url));
      assert.equal(target.href, 'https://api.deepseek.com/chat/completions', 'Only the exact production DeepSeek generation route may map to the fixture');
      result.mappedTargets.push(target.href);
      return transport('http://127.0.0.1:' + fixturePort + '/chat/completions', init);
    };
  };
  await guarded;
  const window = await loaded; const contents = window.webContents;
  equal('actual production Renderer loaded', contents.getURL(), pathToFileURL(renderer).href);
  const preferences = contents.getLastWebPreferences();
  check('sandbox and restricted Node boundary', preferences.sandbox && preferences.contextIsolation && !preferences.nodeIntegration && preferences.webSecurity);
  result.bridge = await contents.executeJavaScript(`(()=>{const a=window.roundtable;if(!a||'invoke' in a||'resolveKey' in a.settings||typeof require!=='undefined'||typeof process!=='undefined')throw new Error('Restricted bridge missing');return {restricted:true,settings:Object.keys(a.settings).sort()};})()`);
  check('real Preload bridge available', result.bridge.restricted);
  const trialMenu = Menu.getApplicationMenu().items.find(item => item.label === '受控测试');
  check('production native trial menu installed', Boolean(trialMenu?.submenu));
  const start = trialMenu.submenu.items.find(item => item.label === 'DeepSeek 单次测试…');
  const stop = trialMenu.submenu.items.find(item => item.label === '停止本次测试');
  check('production start and Stop actions installed', Boolean(start && stop));

  if (!restarting) {
    result.provider = await contents.executeJavaScript(`(async()=>{const a=window.roundtable.settings;const provider=await a.createProvider({name:'DeepSeek controlled fixture',kind:'openai-compatible',baseUrl:'https://api.deepseek.com',enabled:true,isDefault:false,defaultModelId:'deepseek-flash',customModels:[{id:'deepseek-flash',name:'DeepSeek Flash'}]});const key=await a.setKey({providerId:provider.id,apiKey:${JSON.stringify(fakeKey)}});await a.confirmTarget({providerId:provider.id,baseUrl:'https://api.deepseek.com',confirmed:true});return {provider,key};})()`);
    providerId = result.provider.provider.id;
    equal('fake encrypted Key configured through real IPC', result.provider.key.state, 'configured');
    check('setup DTO does not echo fake Key', !JSON.stringify(result.provider).includes(fakeKey));
    const beforeCancel = result.fakeStorage.decrypt;
    await clickTrial(start, 'cancel');
    equal('cancel sends zero requests', result.requests.length, 0);
    equal('cancel does not decrypt Key', result.fakeStorage.decrypt, beforeCancel);
    equal('cancel does not reserve or write trial', readTrials().length, 0);
    check('native confirmation defaults to cancel and states estimation risk', result.dialogs.some(value => value.scenario === 'cancel' && value.title === '授权一次 DeepSeek 受控测试' && value.defaultId === 0));

    await clickTrial(start, 'success');
    equal('one authorization creates exactly one SDK HTTP request', result.requests.length, 1);
    check('SDK body has fixed prompt output limit and thinking disabled', result.requests[0].credentialMatches && result.requests[0].body.max_tokens === 128 && result.requests[0].body.thinking.type === 'disabled');
    const settled = readTrials()[0];
    equal('successful trial settles', settled.state, 'settled');
    equal('successful trial completes', settled.outcome, 'completed');
    equal('provider usage retained separately', settled.observedUsage, { inputTokens: 71, outputTokens: 8 });
    equal('actual input usage retained', settled.actualInputTokens, 71);
    equal('actual output usage retained', settled.actualOutputTokens, 8);
    equal('CNY accounting uses reported usage', settled.accountedMicroCny, 206);
    equal('preflight input remains a distinct estimate', settled.estimatedInputTokens, 67);
    equal('preflight estimated cost is not replaced by settlement', settled.estimatedMicroCny, 1158);
    equal('partial text persisted from production stream', settled.text, 'OK');
    result.settledId = settled.id;
    const beforeStrict = result.fakeStorage.decrypt;
    result.strict = await contents.executeJavaScript(`window.roundtable.settings.testConnection({providerId:${JSON.stringify(providerId)},level:'generation',modelId:'deepseek-flash',allowGeneration:true})`);
    equal('ordinary generation remains unsupported', result.strict.result.error.code, 'unsupported');
    equal('ordinary generation did not read Key', result.fakeStorage.decrypt, beforeStrict);
    equal('ordinary generation made no HTTP request', result.requests.length, 1);

    fixtureMode = 'hang'; scenario = 'hang';
    start.click();
    await waitFor(readTrials, rows => rows.length === 2 && rows[1].text === 'partial controlled fixture', 'No production partial before Stop');
    const blockedRun = await contents.executeJavaScript(`(async()=>{const a=window.roundtable;const room=await a.room.createDemo('Controlled trial mutual exclusion');try{await a.run.start({roomId:room.roomId,task:'Mock must wait',workflowSnapshot:{},maxTurns:1});throw new Error('Concurrent Run accepted');}catch(error){return error.code;}})()`);
    equal('production IPC refuses a concurrent ordinary Run', blockedRun, 'invalid_state');
    const originalCloseDialog = dialog.showMessageBoxSync;
    let closePrompts = 0;
    dialog.showMessageBoxSync = (...values) => { const options = values.at(-1); assert.equal(options.defaultId, 0); assert.deepEqual(options.buttons, ['取消', '退出并停止生成']); closePrompts++; return 0; };
    window.close();
    equal('trial-only window close asks before continuing', closePrompts, 1);
    check('cancelled window close preserves active trial window', !window.isDestroyed());
    dialog.showMessageBoxSync = originalCloseDialog;
    stop.click();
    await waitFor(finishedDialog, count => count > 0, 'Stop did not finish production menu request');
    await waitFor(() => result.requests[1]?.aborted, Boolean, 'Stop did not abort owned HTTP socket');
    const unknown = readTrials()[1];
    equal('second explicit request was not automatically retried', result.requests.length, 2);
    equal('Stop retains partial output', unknown.text, 'partial controlled fixture');
    equal('Stop leaves billing unknown', unknown.state, 'unknown');
    equal('Stop cancellation is retained', unknown.outcome, 'cancelled');
    equal('Stop retains full CNY reservation', unknown.reservedMicroCny, 50000);
    equal('missing usage never becomes zero cost', [unknown.actualInputTokens, unknown.actualOutputTokens, unknown.accountedMicroCny, unknown.observedUsage], [null, null, null, null]);
    result.unknownId = unknown.id;
  } else {
    equal('restart makes zero automatic requests', result.requests.length, 0);
    const rows = readTrials();
    equal('settled and unknown records survive restart', rows.length, 2);
    equal('settled usage and accounting survive restart', [rows[0].id, rows[0].state, rows[0].accountedMicroCny], [prior.settledId, 'settled', 206]);
    equal('unresolved reservation survives restart', [rows[1].id, rows[1].state, rows[1].reservedMicroCny], [prior.unknownId, 'unknown', 50000]);
    equal('restart preserves partial and unknown cost', [rows[1].text, rows[1].accountedMicroCny], ['partial controlled fixture', null]);
    result.restoredKey = await contents.executeJavaScript(`window.roundtable.settings.getProviderKeyState({providerId:${JSON.stringify(providerId)}})`);
    equal('fake encrypted Key restores in fresh process', result.restoredKey.state, 'configured');
    await contents.executeJavaScript(`window.roundtable.settings.confirmTarget({providerId:${JSON.stringify(providerId)},baseUrl:'https://api.deepseek.com',confirmed:true})`);
    const beforeBlocked = result.fakeStorage.decrypt;
    await clickTrial(start, 'restart-blocked');
    check('unknown reservation blocks a new test before final authorization', result.dialogs.some(value => value.scenario === 'restart-blocked' && value.message === '没有发起新的自动重试' && value.detail.includes('invalid_state')));
    equal('unknown reservation never opens a new charging confirmation', result.dialogs.filter(value => value.scenario === 'restart-blocked' && value.title === '授权一次 DeepSeek 受控测试').length, 0);
    equal('unknown reservation blocks before Key read', result.fakeStorage.decrypt, beforeBlocked);
    equal('restart and blocked test send zero requests', result.requests.length, 0);
    equal('blocked test creates no new trial record', readTrials().length, 2);
  }
  result.records = readTrials(); result.providerId = providerId;
  check('trial and ordinary DTOs contain no fake Key', !JSON.stringify({ records: result.records, provider: result.provider, strict: result.strict, restoredKey: result.restoredKey, dialogs: result.dialogs }).includes(fakeKey));
  equal('Node network remains inside owned fixture', result.nodeNetworkAttempts, []);
  equal('Chromium never attempts network', result.chromiumNetworkAttempts, []);
  equal('no production Preload error', result.preloadErrors, []);
  equal('no production Renderer console error', result.consoleErrors, []);
  for (const name of storageMethods) assert.equal(safeStorage[name], fake[name], 'safeStorage isolation changed');
  check('all safeStorage methods stay fake', storageMethods.every(name => result.fakeStorage.replacedMethods.includes(name))
    && Object.getOwnPropertyNames(safeStorage).filter(name => typeof safeStorage[name] === 'function').every(name => safeStorage[name] === fake[name]));
  check('no model policy or counter injected', Registry.prototype.resolveModelPolicy === originalModelPolicy && Registry.prototype.resolveCapabilities === originalCapabilities);
  check('assertions actually executed', result.checks.length >= (restarting ? 20 : 35));
  result.assertions = result.checks.length; result.status = 'PASS'; save();
  if (!restarting) fs.writeFileSync(manifestPath, JSON.stringify({ status: 'PASS', directory, providerId, settledId: result.settledId, unknownId: result.unknownId }, null, 2), { mode: 0o600, flag: 'wx' });
  console.log('DEEPSEEK_TRIAL_PRODUCTION_PASS ' + JSON.stringify({ resultPath, manifestPath, assertions: result.assertions, localFixtureRequests: result.requests.length, liveApi: false }));
  await new Promise(resolveClose => { fixture.closeAllConnections(); fixture.close(resolveClose); });
  app.quit();
}
save();
console.log('DEEPSEEK_TRIAL_PRODUCTION_ISOLATION ' + JSON.stringify({ resultPath, manifestPath, paths }));
main().catch(fail);
