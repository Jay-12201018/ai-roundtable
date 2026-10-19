// Real launcher + production Main, with owned fake storage and an independently confined loopback fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const { app, BrowserWindow, Menu, dialog, safeStorage } = require('electron');
assert.ok(app && !app.isReady(), 'Actual Electron before-ready isolation required');
const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2), restart = args.length === 2 && args[0] === '--restart';
assert.ok(args.length === 0 || restart);
const dir = restart ? path.dirname(path.resolve(args[1])) : fs.mkdtempSync(path.join(os.tmpdir(), 'roundtable-final-readiness-probe-'));
assert.ok(path.basename(dir).startsWith('roundtable-final-readiness-probe-'));
assert.equal(fs.realpathSync(path.dirname(dir)), fs.realpathSync(os.tmpdir()));
assert.ok(!fs.lstatSync(dir).isSymbolicLink() && fs.statSync(dir).uid === process.getuid());
const manifestPath = path.join(dir, 'manifest.json');
if (restart) assert.equal(path.resolve(args[1]), manifestPath);
const prior = restart ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : undefined;
if (restart) { assert.equal(prior.status, 'PASS'); assert.equal(prior.directory, dir); }
const build = path.join(dir, 'build'), profile = path.join(dir, 'profile');
// A main acceptance snapshot must not overwrite an application's existing out directory.
const requestedOut = process.env.ROUNDTABLE_PROBE_OUT ?? path.join(root, 'out');
assert.ok(path.isAbsolute(requestedOut), 'Probe output must be absolute');
const sourceOut = path.resolve(requestedOut);
assert.equal(fs.realpathSync(sourceOut), sourceOut, 'Probe output cannot be symlinked');
assert.ok(fs.lstatSync(sourceOut).isDirectory() && fs.statSync(sourceOut).uid === process.getuid(), 'Owned output directory required');
for (const relative of ['main/index.js', 'preload/index.cjs', 'renderer/index.html']) {
  const file = path.join(sourceOut, relative);
  assert.equal(fs.realpathSync(file), file, 'Probe entry cannot be symlinked');
  assert.ok(fs.lstatSync(file).isFile() && fs.statSync(file).uid === process.getuid(), 'Owned production entry required');
}
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!restart) {
  fs.mkdirSync(build, { mode: 0o700 }); fs.mkdirSync(profile, { mode: 0o700 });
  fs.cpSync(sourceOut, path.join(build, 'out'), { recursive: true });
  fs.writeFileSync(path.join(build, 'package.json'), JSON.stringify({ type: 'module' }));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(build, 'node_modules'));
  fs.writeFileSync(path.join(build, 'build-manifest.json'), JSON.stringify({ main: sha }));
  const id = randomUUID();
  fs.writeFileSync(path.join(profile, 'owner.json'), JSON.stringify({ root: profile, uid: process.getuid(), fixtureOnly: true,
    appName: 'Roundtable-Owned-Final-' + id, service: 'Roundtable-Owned-Fixture-' + id, accounts: ['fixture-current', 'fixture-legacy'] }), { mode: 0o600, flag: 'wx' });
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) fs.mkdirSync(path.join(profile, 'data', name), { recursive: true, mode: 0o700 });
}
const owner = JSON.parse(fs.readFileSync(path.join(profile, 'owner.json'), 'utf8'));
assert.equal(owner.fixtureOnly, true); assert.equal(owner.root, profile);
const resultPath = path.join(dir, restart ? 'restart.json' : 'first.json');
const dbPath = path.join(profile, 'data/userData/ai-roundtable.db');
const result = { status: 'RUNNING', directory: dir, phase: restart ? 'restart' : 'first', main: sha, publicApiCalls: 0, realKeychainCalls: 0,
  fakeEncrypt: 0, fakeDecrypt: 0, requests: [], dialogs: [], checks: [], blockedNetworkAttempts: [], fixtureClockOnly: true, sourceOut };
const save = () => fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
const check = (name, actual) => { assert.ok(actual, name); assert.ok(!result.checks.includes(name)); result.checks.push(name); };
const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); assert.ok(!result.checks.includes(name)); result.checks.push(name); };
const RealDate = Date, tick = performance.now(), epoch = RealDate.parse('2026-10-19T12:00:00Z');
result.fixtureClock = new RealDate(epoch).toISOString();
globalThis.Date = class extends RealDate { constructor(...values) { super(...(values.length ? values : [epoch + performance.now() - tick])); } static now() { return epoch + Math.floor(performance.now() - tick); } };
app.commandLine.appendSwitch('use-mock-keychain');
const fakeKey = 'final-readiness-owned-fake-key';
const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'owned-final-fixture',
  encryptString: text => { result.fakeEncrypt++; return Buffer.from([...Buffer.from(text)].map(b => b ^ 0xa5)); },
  decryptString: bytes => { result.fakeDecrypt++; return Buffer.from([...bytes].map(b => b ^ 0xa5)).toString(); },
  setUsePlainTextEncryption: () => { throw new Error('No plaintext fixture storage'); } };
for (const name of Object.getOwnPropertyNames(safeStorage).filter(n => typeof safeStorage[n] === 'function')) assert.ok(Object.hasOwn(storage, name));
for (const [name, fn] of Object.entries(storage)) safeStorage[name] = fn;
const guardLog = path.join(dir, 'fake-guard.jsonl'); fs.writeFileSync(guardLog, '{"event":"loaded-no-OS","fixtureOnly":true}\n', { mode: 0o600 });
Object.assign(process.env, { ROUNDTRIAL_SERVICE: owner.service, ROUNDTRIAL_ACCOUNT: owner.accounts[0], ROUNDTRIAL_LEGACY_ACCOUNT: owner.accounts[1],
  ROUNDTRIAL_GUARD_LOG: guardLog, ROUNDTRIAL_DRY: '1', ROUNDTRIAL_RESULT: path.join(dir, restart ? 'startup-restart.json' : 'startup-first.json') });
for (const name of ['ROUNDTABLE_CONNECT_PROXY', 'ROUNDTABLE_TRUST_PROXY_DNS', 'DYLD_INSERT_LIBRARIES', 'ELECTRON_RENDERER_URL']) delete process.env[name];
let scenario = 'idle';
dialog.showMessageBox = async (...values) => {
  const opts = values.at(-1);
  result.dialogs.push({ scenario, title: opts.title ?? null, message: opts.message, detail: opts.detail ?? '', buttons: opts.buttons ?? [], defaultId: opts.defaultId, cancelId: opts.cancelId });
  if (opts.message === '选择本次测试的 Provider') return { response: 1 };
  if (opts.message === '选择人工核对的请求') return { response: scenario === 'reconcile-cancel' ? 0 : 1 };
  if (opts.title === '人工核对服务商控制台') {
    assert.equal(opts.defaultId, 0); assert.equal(opts.cancelId, 0); assert.equal(opts.checkboxChecked, false);
    assert.ok(opts.detail.includes('不证明绝对没有费用'));
    return { response: scenario === 'reconcile-retain' ? 1 : 2, checkboxChecked: true };
  }
  if (opts.title === '明确批准处理此笔客户端预留') {
    assert.equal(opts.defaultId, 0); assert.equal(opts.cancelId, 0); assert.equal(opts.checkboxChecked, false);
    return { response: scenario === 'reconcile-release-cancel' ? 0 : 1, checkboxChecked: true };
  }
  if (opts.title === '准备本会话单次发送许可') { assert.equal(scenario, 'one-request'); assert.equal(opts.defaultId, 0); return { response: 1 }; }
  if (opts.title === '授权一次 DeepSeek 受控测试') {
    assert.equal(opts.defaultId, 0); assert.equal(opts.cancelId, 0);
    if (scenario !== 'one-request') { assert.deepEqual(opts.buttons, ['取消']); return { response: 0 }; }
    assert.deepEqual(opts.buttons, ['取消', '授权并发送这一次请求']);
    for (const term of ['Reply OK.', 'max_tokens=128', '单 Agent', '¥0.05', '不是服务商账单的绝对硬上限']) assert.ok(opts.detail.includes(term));
    return { response: 1 };
  }
  return { response: 0 };
};
const Sqlite = require(path.join(root, 'node_modules/better-sqlite3'));
const query = (sql, ...args) => { const db = new Sqlite(dbPath, { readonly: true, fileMustExist: true }); try { return db.prepare(sql).all(...args); } finally { db.close(); } };
const trials = () => query('SELECT data_json,reservation_released FROM controlled_trials ORDER BY rowid');
const audits = () => query('SELECT data_json FROM controlled_trial_reconciliations ORDER BY rowid').map(row => JSON.parse(row.data_json));
const http = require('node:http'), https = require('node:https'), net = require('node:net');
let port, finished = false, timeout;
const fixture = http.createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/chat/completions'); assert.equal(req.headers.authorization, 'Bearer ' + fakeKey);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.deepEqual(body, { model: 'deepseek-flash', messages: [{ role: 'user', content: 'Reply OK.' }], stream: true, max_tokens: 128, stream_options: { include_usage: true }, thinking: { type: 'disabled' } });
    result.requests.push({ path: req.url, method: req.method, fixedBody: true, fakeKeyMatched: true });
    assert.equal(result.requests.length, 1, 'One-shot fixture received more than one request');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: null }] }) + '\n\n');
    res.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 71, completion_tokens: 8 } }) + '\n\ndata: [DONE]\n\n');
  } catch (error) { fail(error); }
});
const nativeExit = app.exit.bind(app);
function fail(error) { clearTimeout(timeout); result.status = 'FAIL'; result.error = error instanceof assert.AssertionError ? error.message : error.name; save(); console.error('FINAL_READINESS_PRODUCTION_FAIL ' + JSON.stringify({ resultPath, error: result.error })); nativeExit(1); }
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
app.exit = code => {
  if (!finished || code !== 0) return nativeExit(code || 1);
  try {
    equal('exit SQLite integrity', query('PRAGMA integrity_check')[0].integrity_check, 'ok');
    equal('exit migration is v5', query('SELECT MAX(version) AS n FROM schema_migrations')[0].n, 5);
    equal('exit preserves original unknown JSON', trials()[0].data_json, result.originalUnknownJson);
    equal('exit persists exactly the manual decisions', audits().map(a => a.decision), ['retain_reservation', 'release_reservation']);
    result.status = 'PASS'; result.assertions = result.checks.length; save();
    if (!restart) fs.writeFileSync(manifestPath, JSON.stringify({ status: 'PASS', directory: dir, providerId: result.providerId, originalUnknownJson: result.originalUnknownJson }), { mode: 0o600, flag: 'wx' });
    console.log('FINAL_READINESS_PRODUCTION_PASS ' + JSON.stringify({ resultPath, manifestPath, assertions: result.assertions, localFixtureRequests: result.requests.length, publicApiCalls: 0, realKeychainCalls: 0 }));
    return nativeExit(0);
  } catch (error) { fail(error); }
};
async function waitFor(read, accepts, message) {
  const end = performance.now() + 10000;
  for (;;) { const value = await read(); if (accepts(value)) return value; assert.ok(performance.now() < end, message); await new Promise(r => setTimeout(r, 20)); }
}
const doneDialog = rows => rows.some(row => ['没有发起新的自动重试', '人工决定已记录', '当前会话不能再次准备许可'].includes(row.message) || row.message.startsWith('受控测试：'));
async function action(item, name, complete = doneDialog) {
  scenario = name; const before = result.dialogs.length; item.click();
  await waitFor(() => result.dialogs.slice(before), complete, 'Native action did not finish: ' + name);
  await new Promise(r => setImmediate(r));
}
async function main() {
  await new Promise(r => fixture.listen(0, '127.0.0.1', r)); port = fixture.address().port;
  // This outer breaker is installed before the launch gate captures native transports.
  const deny = label => { result.blockedNetworkAttempts.push(label); throw new Error('Only owned fixture transport is permitted'); };
  const nativeRequest = http.request, nativeConnect = net.Socket.prototype.connect;
  http.request = function (input, ...rest) {
    const url = typeof input === 'string' || input instanceof URL ? new URL(input) : input;
    if ((url.hostname ?? url.host) !== '127.0.0.1' || Number(url.port) !== port) return deny('HTTP outside fixture');
    return nativeRequest.call(this, input, ...rest);
  };
  http.get = () => deny('http.get'); https.request = https.get = () => deny('HTTPS');
  net.Socket.prototype.connect = function (...values) {
    const cfg = Array.isArray(values[0]) ? values[0][0] : values[0];
    if (!cfg || cfg.host !== '127.0.0.1' || Number(cfg.port) !== port || cfg.path) return deny('TCP outside fixture');
    return nativeConnect.apply(this, values);
  };
  require('node:tls').connect = () => deny('TLS outside fixture');
  require('node:dns/promises').lookup = async () => deny('DNS'); globalThis.fetch = async () => deny('fetch'); syncBuiltinESMExports();
  // Test-only fixture mapping is not a production launcher flag and cannot grant permission.
  const gateModule = require(path.join(root, 'scripts/controlled-desktop/controlled-network.cjs'));
  const install = gateModule.installControlledNetwork;
  let gate;
  gateModule.installControlledNetwork = options => { gate = install({ ...options, fixtureOnly: true, fixtureOrigin: 'http://127.0.0.1:' + port + '/' }); return gate; };
  const launcher = path.join(root, 'scripts/controlled-desktop/main.cjs');
  process.argv = [process.execPath, launcher, build, profile, sha]; require(launcher);
  const startup = await waitFor(() => JSON.parse(fs.readFileSync(process.env.ROUNDTRIAL_RESULT, 'utf8')), s => s.status === 'READY', 'Launcher not READY');
  equal('latest real launcher begins unarmed', [startup.sendAuthorized, startup.network.granted, startup.network.started], [false, 0, 0]);
  equal('real launcher uses expected build', startup.main, sha);
  const window = BrowserWindow.getAllWindows()[0], wc = window.webContents;
  const prefs = wc.getLastWebPreferences(); check('real restricted sandbox bridge', prefs.sandbox && prefs.contextIsolation && !prefs.nodeIntegration && prefs.webSecurity);
  check('real preload offers no generic invoke or Key resolution', await wc.executeJavaScript(`!!window.roundtable && !('invoke' in window.roundtable) && !('resolveKey' in window.roundtable.settings) && typeof require==='undefined'`));
  const menu = Menu.getApplicationMenu().items.find(i => i.label === '受控测试');
  const item = label => { const value = menu.submenu.items.find(i => i.label === label); assert.ok(value, label); return value; };
  const start = item('DeepSeek 单次测试…'), permit = item('准备本会话单次许可…'), reconcile = item('人工对账与预留处理…');
  if (!restart) {
    result.providerId = await wc.executeJavaScript(`(async()=>{const a=window.roundtable.settings;const p=await a.createProvider({name:'Owned final fixture',kind:'openai-compatible',baseUrl:'https://api.deepseek.com',enabled:true,isDefault:false,defaultModelId:'deepseek-flash',customModels:[{id:'deepseek-flash',name:'Flash'}]});await a.setKey({providerId:p.id,apiKey:${JSON.stringify(fakeKey)}});await a.confirmTarget({providerId:p.id,baseUrl:'https://api.deepseek.com',confirmed:true});return p.id;})()`);
    const decrypt = result.fakeDecrypt;
    await action(start, 'default-unarmed');
    equal('default unarmed action sends nothing', result.requests.length, 0); equal('default unarmed never decrypts Key', result.fakeDecrypt, decrypt);
    equal('default unarmed does not reserve budget', trials(), []);
    const now = new Date().toISOString(), keyRevision = query('SELECT key_revision FROM providers WHERE id=?', result.providerId)[0].key_revision;
    const original = { id: randomUUID(), requestId: randomUUID(), providerId: result.providerId, keyRevision,
      modelId: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', prompt: 'Reply OK.', createdAt: now,
      priceReviewedAt: '2026-10-17T16:00:00.000Z', priceExpiresAt: '2026-10-18T16:00:00.000Z', priceEvidence: 'owned historical fixture',
      inputMicroCnyPerToken: 2, outputMicroCnyPerToken: 8, estimatedInputTokens: 67, estimatedMicroCny: 1158, reservedMicroCny: 50000, maxOutputTokens: 128,
      state: 'unknown', outcome: 'error', actualInputTokens: null, actualOutputTokens: null, observedUsage: null, accountedMicroCny: null, text: '', errorCode: 'network_error' };
    result.originalUnknownJson = JSON.stringify(original);
    const db = new Sqlite(dbPath); try { db.prepare('INSERT INTO controlled_trials(id,request_id,provider_id,state,data_json) VALUES(?,?,?,?,?)').run(original.id, original.requestId, original.providerId, original.state, result.originalUnknownJson); } finally { db.close(); }
    await action(start, 'unknown-blocked'); equal('unknown blocks request before Key', result.fakeDecrypt, decrypt);
    await action(reconcile, 'reconcile-cancel', rows => rows.length === 1);
    equal('reconciliation cancel writes no audit', audits(), []); equal('reconciliation cancel keeps reserve', trials()[0].reservation_released, 0);
    await action(reconcile, 'reconcile-retain'); equal('retention records one manual decision', audits().map(a => a.decision), ['retain_reservation']);
    equal('retention keeps reserve', trials()[0].reservation_released, 0);
    await action(reconcile, 'reconcile-release-cancel', rows => rows.some(r => r.title === '明确批准处理此笔客户端预留'));
    equal('cancelled final release writes no audit', audits().length, 1); equal('cancelled final release keeps reserve', trials()[0].reservation_released, 0);
    await action(reconcile, 'reconcile-release'); equal('explicit native release records second decision', audits().map(a => a.decision), ['retain_reservation', 'release_reservation']);
    equal('explicit native release only changes separate marker', trials()[0].reservation_released, 1);
    equal('manual decisions preserve exact original unknown JSON', trials()[0].data_json, result.originalUnknownJson);
    equal('reconciliation never decrypts Key', result.fakeDecrypt, decrypt); equal('reconciliation sends zero requests', result.requests.length, 0);
    check('audit keeps uncertainty and timestamp', audits().every(a => a.acknowledgedUncertainty === true && a.evidence === 'dashboard_no_displayed_usage' && a.evidenceSummary.includes('不证明绝对没有费用') && Number.isFinite(Date.parse(a.reviewedAt))));
    await action(permit, 'one-request');
    equal('two native confirmations produce one local request', result.requests.length, 1);
    const settled = JSON.parse(trials()[1].data_json);
    equal('actual usage is settled separately', [settled.state, settled.text, settled.actualInputTokens, settled.actualOutputTokens, settled.accountedMicroCny], ['settled', 'OK', 71, 8, 206]);
    equal('estimate remains clearly separate', [settled.estimatedInputTokens, settled.estimatedMicroCny, settled.reservedMicroCny], [67, 1158, 50000]);
    const afterRequestDecrypt = result.fakeDecrypt;
    await action(permit, 'second-permit'); equal('used process cannot grant a second request', result.requests.length, 1);
    await action(start, 'second-start'); equal('ordinary menu cannot replay one-shot', result.requests.length, 1); equal('replay refusal occurs before Key', result.fakeDecrypt, afterRequestDecrypt);
    equal('launch gate reports exactly one grant and one request', [gate.status().granted, gate.status().started, gate.status().sendAuthorized], [1, 1, false]);
  } else {
    result.providerId = prior.providerId; result.originalUnknownJson = prior.originalUnknownJson;
    equal('new process automatically sends nothing', result.requests.length, 0);
    equal('new process preserves reconciliation and original unknown', [trials().length, trials()[0].data_json, trials()[0].reservation_released, audits().length], [2, prior.originalUnknownJson, 1, 2]);
    await wc.executeJavaScript(`window.roundtable.settings.confirmTarget({providerId:${JSON.stringify(result.providerId)},baseUrl:'https://api.deepseek.com',confirmed:true})`);
    const before = result.fakeDecrypt; await action(start, 'restart-unarmed');
    equal('restart has no inherited send permission', [result.requests.length, gate.status().granted, gate.status().started], [0, 0, 0]);
    equal('restart unarmed refuses before Key', result.fakeDecrypt, before);
  }
  const beforeStrict = result.fakeDecrypt;
  const strict = await wc.executeJavaScript(`window.roundtable.settings.testConnection({providerId:${JSON.stringify(result.providerId)},level:'generation',modelId:'deepseek-flash',allowGeneration:true})`);
  equal('ordinary real Run policy remains blocked', strict.result.error.code, 'unsupported'); equal('strict refusal does not decrypt Key', result.fakeDecrypt, beforeStrict);
  check('no Key in ordinary dialogs/audits/trial history', !JSON.stringify({ dialogs: result.dialogs, trials: trials(), audits: audits() }).includes(fakeKey));
  equal('outer breaker saw no public-network attempt', result.blockedNetworkAttempts, []);
  check('all safeStorage remains fake', Object.entries(storage).every(([name, fn]) => safeStorage[name] === fn));
  check('nonempty scoped acceptance executed', result.checks.length >= (restart ? 12 : 30));
  finished = true; clearTimeout(timeout); await new Promise(r => fixture.close(r)); app.quit();
}
timeout = setTimeout(() => fail(new Error('Bounded final readiness probe timeout')), 60000);
main().catch(fail);
