// R13A production-entry probe: the real DeepSeek policy and budget ledger, private profile, fake safeStorage.
// Only the transport for https://api.deepseek.com is redirected to an owned loopback fixture; nothing leaves the host.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, session, safeStorage } = require('electron');

const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === '--restart', 'Usage: electron r13a-electron.cjs [--restart private-manifest.json]');
const restarting = args.length === 2;
assert.equal(app.isReady(), false, 'Isolation must precede readiness/Main');
app.commandLine.appendSwitch('use-mock-keychain');
assert.equal(app.commandLine.hasSwitch('use-mock-keychain'), true, 'Chromium Keychain isolation switch missing');
const directory = restarting ? dirname(resolve(args[1])) : fs.mkdtempSync(join(tmpdir(), 'roundtable-r13a-production-'));
assert.ok(basename(directory).startsWith('roundtable-r13a-production-') && fs.realpathSync(dirname(directory)) === fs.realpathSync(tmpdir()), 'Only this probe owned temporary profile is allowed');
assert.ok(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'Profile directory cannot be a symlink');
assert.equal(fs.statSync(directory).uid, process.getuid());
const manifestPath = join(directory, 'r13a-manifest.json');
assert.equal(restarting ? resolve(args[1]) : manifestPath, manifestPath);
const ownerPath = join(directory, 'r13a-owner.json');
if (!restarting) fs.writeFileSync(ownerPath, JSON.stringify({ probe: 'R13A production probe', uid: process.getuid(), directory }), { mode: 0o600, flag: 'wx' });
assert.deepEqual(JSON.parse(fs.readFileSync(ownerPath, 'utf8')), { probe: 'R13A production probe', uid: process.getuid(), directory });
const prior = restarting ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : undefined;
if (restarting) assert.equal(prior.status, 'FIRST_PASS_CRASHED_IN_FLIGHT');
const paths = Object.fromEntries(['userData', 'sessionData', 'logs'].map(name => [name, join(directory, name)]));
for (const [name, path] of Object.entries(paths)) { fs.mkdirSync(path, { recursive: true, mode: 0o700 }); assert.ok(!fs.lstatSync(path).isSymbolicLink()); app.setPath(name, path); assert.equal(app.getPath(name), path); }
const realProfile = join(app.getPath('appData'), 'ai-roundtable');
assert.notEqual(resolve(paths.userData), resolve(realProfile), 'Probe must never open the real profile');
assert.equal(fs.existsSync(join(paths.userData, 'ai-roundtable.db')), restarting);
delete process.env.ELECTRON_RENDERER_URL;
const root = resolve(__dirname, '../..');
const build = process.env.ROUNDTABLE_PROBE_BUILD ? resolve(process.env.ROUNDTABLE_PROBE_BUILD) : join(root, 'out');
const entry = join(build, 'main/index.js'); const preload = join(build, 'preload/index.cjs'); const renderer = join(build, 'renderer/index.html');
for (const file of [entry, preload, renderer]) assert.ok(fs.existsSync(file), 'Build missing: ' + file);
const result = { status: 'RUNNING', phase: restarting ? 'restart' : 'first', directory, paths, runtime: { electron: process.versions.electron, node: process.versions.node, abi: process.versions.modules },
  fakeSafeStorage: { replacedMethods: [], encrypt: 0, decrypt: 0 }, nodeNetworkAttempts: [], chromiumNetworkAttempts: [], consoleErrors: [], preloadErrors: [], checks: [] };
const resultPath = join(directory, restarting ? 'r13a-restart.json' : 'r13a-first.json');
const save = () => fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
const fake = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'r13a-fixture-only',
  encryptString: value => { result.fakeSafeStorage.encrypt++; return Buffer.from([...Buffer.from(value)].map(value => value ^ 0xa5)); },
  decryptString: value => { result.fakeSafeStorage.decrypt++; return Buffer.from([...value].map(value => value ^ 0xa5)).toString(); },
  setUsePlainTextEncryption: () => { throw new Error('Fixture does not allow plaintext storage'); },
};
for (const name of Object.getOwnPropertyNames(safeStorage).filter(name => typeof safeStorage[name] === 'function')) assert.ok(Object.hasOwn(fake, name), 'Unisolated safeStorage method: ' + name);
for (const [name, implementation] of Object.entries(fake)) { safeStorage[name] = implementation; assert.equal(safeStorage[name], implementation); result.fakeSafeStorage.replacedMethods.push(name); }

const http = require('node:http');
const { syncBuiltinESMExports } = require('node:module');
const fakeKey = 'r13a-fake-deepseek-key';
// The fixture's provider usage: inside the byte bound, so a settled request costs 300×2 + 6×8 = 648 micro-CNY.
const usage = { prompt_tokens: 300, completion_tokens: 6 };
const requests = []; let port; let mode = 'ok'; let hung;
const fixture = http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ method: req.method, path: req.url, model: body.model, maxTokens: body.max_tokens, thinking: body.thinking, keyMatches: req.headers.authorization === `Bearer ${fakeKey}` });
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/deepseek/chat/completions');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
    emit({ id: 'owned-fixture', choices: [{ index: 0, delta: { content: `DeepSeek 夹具回复 ${requests.length}` }, finish_reason: null }] });
    if (mode === 'hang') { hung = res; return; }
    setTimeout(() => {
      if (res.destroyed) return;
      emit({ id: 'owned-fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      emit({ id: 'owned-fixture', choices: [], usage });
      res.end('data: [DONE]\n\n');
    }, 50);
  } catch (error) { fail(error); }
});
const originalRequest = http.request;
http.request = function (url) { const target = new URL(String(url)); assert.equal(target.hostname, '127.0.0.1'); assert.equal(Number(target.port), port); return originalRequest.apply(this, arguments); };
http.get = () => { throw new Error('Unexpected HTTP get'); };
const https = require('node:https'); https.request = https.get = () => { result.nodeNetworkAttempts.push('remote https blocked'); throw new Error('Remote TLS blocked'); };
globalThis.fetch = async () => { result.nodeNetworkAttempts.push('global fetch blocked'); throw new Error('Remote fetch blocked'); };
for (const name of ['ROUNDTABLE_CONNECT_PROXY', 'ROUNDTABLE_TRUST_PROXY_DNS', 'ROUNDTABLE_TRIAL_ALLOW_ONCE', 'ROUNDTABLE_TRIAL_PROVIDER_ID']) delete process.env[name];
syncBuiltinESMExports();
const fail = error => { result.status = 'FAIL'; result.error = error instanceof Error ? error.stack : typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error); save(); console.error('R13A_FAIL ' + JSON.stringify({ resultPath, error: result.error })); app.exit(1); };
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
const check = (value, message) => { result.checks.push(message); if (!value) throw new Error('Check failed: ' + message); };
const sleep = ms => new Promise(done => setTimeout(done, ms));

async function main() {
  await new Promise(done => fixture.listen(0, '127.0.0.1', done)); port = fixture.address().port;
  const { ProviderRegistry: Registry } = await import(pathToFileURL(entry).href);
  assert.equal(typeof Registry, 'function');
  // Policy, quoting, reservation and settlement stay production code; only the official DeepSeek target is redirected.
  const transport = Registry.prototype.createTransport;
  Registry.prototype.createTransport = function (guard, diagnostics, proxyKind) {
    const send = transport.call(this, guard, diagnostics, proxyKind);
    return (url, init) => { const target = new URL(String(url));
      assert.equal(target.origin, 'https://api.deepseek.com', 'Only the DeepSeek target may be redirected');
      return send(`http://127.0.0.1:${port}/deepseek${target.pathname}${target.search}`, init); };
  };
  await guarded; const window = await loaded; const contents = window.webContents;
  const preferences = contents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
  const js = code => contents.executeJavaScript(code);
  const until = async (code, message, timeout = 60000) => { const deadline = Date.now() + timeout; for (;;) { const value = await js(code); if (value) return value; if (Date.now() > deadline) throw new Error('Timed out: ' + message); await sleep(50); } };
  const api = (path, ...input) => js(`window.roundtable.${path}(...${JSON.stringify(input)})`);
  const text = () => js('document.body.innerText');
  check(await js(`typeof window.roundtable.run.start === 'function' && !('invoke' in window.roundtable) && typeof require === 'undefined'`), 'Typed bridge only');

  if (restarting) {
    await sleep(1500);
    check(requests.length === 0, 'Restart sent no request (no automatic retry, recovery or replay)');
    const settled = await api('run.getSnapshot', prior.settledRunId);
    check(settled.status === 'completed' && settled.charges.length === 3 && settled.charges.every(c => c.state === 'settled' && c.accountedMicro === 648), 'Settled usage and cost survive restart');
    check(settled.budget.settledMicro === 1944 && settled.budget.remainingMicro === 1_000_000 - 1944, 'Run spend survives restart');
    const blocked = await api('run.getSnapshot', prior.blockedRunId);
    check(blocked.status === 'error' && blocked.budget.blocked?.reason === 'insufficient' && blocked.turns.length === 0, 'Budget block survives restart');
    const crashed = await api('run.getSnapshot', prior.crashedRunId);
    const [charge] = crashed.charges;
    check(crashed.status === 'interrupted', 'The crashed Run is interrupted, not resumed');
    check(charge.state === 'unknown' && charge.chargedMicro === prior.crashedReservedMicro && charge.chargedMicro > 0 && charge.accountedMicro === null, 'The in-flight request is unknown at its full reservation, never zero');
    check(crashed.budget.unknownMicro === prior.crashedReservedMicro && crashed.budget.reservedMicro === 0, 'Unknown cost counts against the budget after restart');
    check((await api('settings.getProviderKeyState', { providerId: prior.providerId })).state === 'configured', 'safeStorage-encrypted Key restored');
    await js(`localStorage.setItem('roundtable.runId', ${JSON.stringify(prior.crashedRunId)}); location.reload(); true`);
    await until(`document.body.innerText.includes('费用未知（按上限计')`, 'unknown cost shown after restart');
    check((await text()).includes('含未知费用按上限计'), 'Run budget bar shows unknown spend at the cap');
    await sleep(500); check(requests.length === 0, 'Viewing the interrupted Run sent no request');
  } else {
    const provider = await api('settings.createProvider', { name: 'DeepSeek 直连', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'deepseek-flash' }] });
    await api('settings.setKey', { providerId: provider.id, apiKey: fakeKey });
    await api('settings.confirmTarget', { providerId: provider.id, baseUrl: 'https://api.deepseek.com', confirmed: true });
    check(!JSON.stringify(await api('settings.getProviderConfiguration', { id: provider.id })).includes(fakeKey), 'Key absent from public configuration');
    const room = await api('rooms.createRoom', { name: 'R13A 预算探针', objective: 'DeepSeek fixture' });
    for (let i = 0; i < 2; i++) await api('rooms.createAgent', { roomId: room.id, displayName: `DeepSeek 成员${i}`, roleTemplateId: i ? 'Critic' : 'Drafter', systemPrompt: '', providerId: provider.id, modelId: 'deepseek-flash', enabled: true, displayOrder: i });
    // A Mock-only Run of the same room is impossible now; real members must pass the production DeepSeek policy.
    const started = await api('run.start', { roomId: room.id, task: '设计一个校园跑腿平台', workflowSnapshot: {}, maxTurns: 3 });
    check(started.budget?.limitMicro === 1_000_000, 'Default Run budget is ¥1');
    await until(`window.roundtable.run.getSnapshot(${JSON.stringify(started.runId)}).then(s => s.status === 'completed')`, 'normal run completed');
    const settled = await api('run.getSnapshot', started.runId);
    check(requests.length === 3 && requests.every(r => r.model === 'deepseek-flash' && r.maxTokens === 1024 && r.thinking?.type === 'disabled' && r.keyMatches), 'Three DeepSeek requests with max_tokens, thinking disabled and the saved Key');
    check(settled.charges.length === 3 && settled.charges.every(c => c.state === 'settled' && c.inputTokens === 300 && c.outputTokens === 6 && c.accountedMicro === 648 && c.reservedMicro === c.inputTokenBound * 2 + 1024 * 8), 'Each request reserved its maximum and settled at ¥2/M input and ¥8/M output');
    check(settled.budget.settledMicro === 1944 && settled.budget.reservedMicro === 0 && settled.budget.remainingMicro === 1_000_000 - 1944, 'Run spend and remaining budget');
    await js(`localStorage.setItem('roundtable.runId', ${JSON.stringify(started.runId)}); location.reload(); true`);
    await until(`document.querySelectorAll('.message-usage').length === 3`, 'per-message usage rendered');
    const page = await text();
    check(page.includes('输入 300 / 输出 6 tokens · 花费 ¥0.000648') && page.includes('累计花费 ¥0.0019') && page.includes('剩余额度 ¥0.9981'), 'UI shows per-message usage/cost and Run totals');

    const sent = requests.length;
    const blocked = await api('run.start', { roomId: room.id, task: '预算不足的运行', workflowSnapshot: {}, maxTurns: 3, budgetMicroCny: 1000 });
    await until(`window.roundtable.run.getSnapshot(${JSON.stringify(blocked.runId)}).then(s => s.status === 'error')`, 'budget block');
    const blockedSnapshot = await api('run.getSnapshot', blocked.runId);
    check(requests.length === sent && blockedSnapshot.turns.length === 0 && blockedSnapshot.charges.length === 0, 'Insufficient budget sent zero requests and created no Turn');
    check(blockedSnapshot.budget.blocked?.reason === 'insufficient' && blockedSnapshot.budget.blocked.remainingMicro === 1000 && blockedSnapshot.budget.blocked.requiredMicro > 1000, 'Block records required vs remaining');
    await js(`localStorage.setItem('roundtable.runId', ${JSON.stringify(blocked.runId)}); location.reload(); true`);
    await until(`document.body.innerText.includes('运行预算不足：下一次请求最高可能花费')`, 'Chinese budget message');
    check((await text()).includes('剩余额度 ¥0.0010，已拒绝发送。'), 'UI explains the refusal in Chinese');

    // Crash with one request in flight: the reservation must survive as unknown, never be released as zero.
    mode = 'hang';
    const crashed = await api('run.start', { roomId: room.id, task: '中断中的运行', workflowSnapshot: {}, maxTurns: 3 });
    await until(`window.roundtable.run.getSnapshot(${JSON.stringify(crashed.runId)}).then(s => s.messages[0]?.content.length > 0)`, 'in-flight request streaming');
    const inFlight = await api('run.getSnapshot', crashed.runId);
    check(requests.length === sent + 1 && inFlight.charges[0].state === 'reserved' && inFlight.budget.reservedMicro === inFlight.charges[0].reservedMicro, 'In-flight request holds its reservation');
    await js(`localStorage.setItem('roundtable.runId', ${JSON.stringify(crashed.runId)}); location.reload(); true`);
    await until(`document.body.innerText.includes('生成中 · 已预留最高')`, 'reservation shown while streaming');
    check((await text()).includes('进行中预留'), 'Run budget bar shows the in-flight reservation');
    fs.writeFileSync(manifestPath, JSON.stringify({ status: 'FIRST_PASS_CRASHED_IN_FLIGHT', directory, providerId: provider.id, roomId: room.id,
      settledRunId: started.runId, blockedRunId: blocked.runId, crashedRunId: crashed.runId, crashedReservedMicro: inFlight.charges[0].reservedMicro }), { mode: 0o600, flag: 'wx' });
  }
  assert.deepEqual(result.nodeNetworkAttempts, []); assert.deepEqual(result.chromiumNetworkAttempts, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.preloadErrors, []);
  check(!JSON.stringify(result).includes(fakeKey), 'Key absent from probe result');
  result.requests = requests; result.status = 'PASS'; save();
  console.log('R13A_PRODUCTION_PASS ' + JSON.stringify({ phase: result.phase, resultPath, manifestPath, checks: result.checks.length, requests: requests.length, liveApi: false }));
  // The first phase ends like a crash: no graceful shutdown and the request still open, so the restart sees it in flight.
  if (restarting) { await new Promise(done => { fixture.closeAllConnections(); fixture.close(done); }); app.quit(); }
  else { check(hung && !hung.destroyed, 'Request still open at the crash'); app.exit(0); }
}
save(); main().catch(fail);
