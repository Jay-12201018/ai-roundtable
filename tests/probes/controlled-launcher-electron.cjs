// Owned fixture only: real production entry, fake safeStorage, no public transport or send permission.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow, Menu, dialog, safeStorage, session } = require('electron');
const { syncBuiltinESMExports } = require('node:module');
assert.ok(app && !app.isReady(), 'Use the actual Electron executable before readiness');
const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const proxyMode = args.includes('--proxy-mode');
if (proxyMode) args.splice(args.indexOf('--proxy-mode'), 1);
assert.ok(args.length === 0 || args.length === 2 && args[0] === '--restart');
const restart = args.length === 2;
const dir = restart ? path.dirname(path.resolve(args[1])) : fs.mkdtempSync(path.join(os.tmpdir(), 'roundtable-launcher-probe-'));
assert.ok(path.basename(dir).startsWith('roundtable-launcher-probe-'));
assert.equal(fs.realpathSync(path.dirname(dir)), fs.realpathSync(os.tmpdir()));
assert.ok(!fs.lstatSync(dir).isSymbolicLink() && fs.statSync(dir).uid === process.getuid());
const manifestFile = path.join(dir, 'probe-manifest.json');
if (restart) assert.equal(path.resolve(args[1]), manifestFile);
const prior = restart ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : undefined;
if (restart) { assert.equal(prior.status, 'PASS'); assert.equal(prior.directory, dir); }
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.match(sha, /^[a-f0-9]{40}$/u);
const buildRoot = path.join(dir, 'build');
const profileRoot = path.join(dir, 'profile');
if (!restart) {
  fs.mkdirSync(buildRoot, { mode: 0o700 }); fs.mkdirSync(profileRoot, { mode: 0o700 });
  fs.cpSync(path.join(root, 'out'), path.join(buildRoot, 'out'), { recursive: true });
  fs.writeFileSync(path.join(buildRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(buildRoot, 'node_modules'));
  // Version/source acceptance is covered by launcher.py tests; this fixture exercises only the real JS entry.
  fs.writeFileSync(path.join(buildRoot, 'build-manifest.json'), JSON.stringify({ main: sha }));
  const identity = randomUUID();
  fs.writeFileSync(path.join(profileRoot, 'owner.json'), JSON.stringify({ root: profileRoot, uid: process.getuid(), fixtureOnly: true,
    appName: 'Roundtable-Owned-Launcher-Probe-' + identity, service: 'Roundtable-Owned-Fixture-' + identity,
    accounts: ['owned-fixture-current', 'owned-fixture-legacy'] }), { mode: 0o600, flag: 'wx' });
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) fs.mkdirSync(path.join(profileRoot, 'data', name), { recursive: true, mode: 0o700 });
}
const owner = JSON.parse(fs.readFileSync(path.join(profileRoot, 'owner.json'), 'utf8'));
assert.equal(owner.fixtureOnly, true); assert.equal(owner.root, profileRoot);
const resultPath = path.join(dir, restart ? 'restart-result.json' : 'first-result.json');
const dbPath = path.join(profileRoot, 'data/userData/ai-roundtable.db');
const result = { status: 'RUNNING', phase: restart ? 'restart' : 'first', directory: dir, main: sha,
  publicApiCalls: 0, realKeychainCalls: 0, blockedNetworkAttempts: [], fakeEncrypt: 0, fakeDecrypt: 0, dialogs: [], checks: [],
  isolatedProfile: profileRoot, fixtureClockOnly: true, productionPriceChanged: false };
const save = () => fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
const check = (name, test) => { assert.ok(test, name); assert.ok(!result.checks.includes(name)); result.checks.push(name); };
const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); assert.ok(!result.checks.includes(name)); result.checks.push(name); };
// The clock only permits reaching the cancel path; the launch gate itself is expired and unarmed.
const RealDate = Date, tick = performance.now(), epoch = RealDate.parse('2026-10-18T00:00:00Z');
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [epoch + performance.now() - tick])); } static now() { return epoch + Math.floor(performance.now() - tick); } };
app.commandLine.appendSwitch('use-mock-keychain');
const fakeKey = 'owned-launcher-fixture-key-only';
const fakeStorage = {
  isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'owned-launcher-fixture',
  encryptString: value => { result.fakeEncrypt++; return Buffer.from([...Buffer.from(value)].map(byte => byte ^ 0xa5)); },
  decryptString: value => { result.fakeDecrypt++; return Buffer.from([...value].map(byte => byte ^ 0xa5)).toString(); },
  setUsePlainTextEncryption: () => { throw new Error('Plaintext storage is forbidden'); },
};
for (const name of Object.getOwnPropertyNames(safeStorage).filter(n => typeof safeStorage[n] === 'function')) {
  assert.ok(Object.hasOwn(fakeStorage, name), 'Unisolated safeStorage method');
}
for (const [name, method] of Object.entries(fakeStorage)) safeStorage[name] = method;
const guardLog = path.join(dir, 'fake-guard.jsonl');
fs.writeFileSync(guardLog, '{"fixtureOnly":true,"event":"loaded-no-OS"}\n', { mode: 0o600 });
Object.assign(process.env, { ROUNDTRIAL_SERVICE: owner.service, ROUNDTRIAL_ACCOUNT: owner.accounts[0],
  ROUNDTRIAL_LEGACY_ACCOUNT: owner.accounts[1], ROUNDTRIAL_GUARD_LOG: guardLog,
  ROUNDTRIAL_DRY: '1', ROUNDTRIAL_RESULT: path.join(dir, restart ? 'startup-restart.json' : 'startup-first.json') });
delete process.env.ROUNDTABLE_CONNECT_PROXY; delete process.env.ROUNDTABLE_TRUST_PROXY_DNS;
if (proxyMode) Object.assign(process.env, { ROUNDTABLE_CONNECT_PROXY: 'http://127.0.0.1:9', ROUNDTABLE_TRUST_PROXY_DNS: '1' });
delete process.env.DYLD_INSERT_LIBRARIES; delete process.env.ELECTRON_RENDERER_URL;
let scenario = 'idle';
dialog.showMessageBox = async (...values) => {
  const options = values.at(-1);
  result.dialogs.push({ scenario, title: options.title ?? null, message: options.message, detail: options.detail ?? '',
    buttons: options.buttons ?? [], defaultId: options.defaultId ?? null, cancelId: options.cancelId ?? null });
  if (options.message === '选择本次测试的 Provider') return { response: 1 };
  return { response: 0 }; // Never return permission to the final native authorization dialog.
};
const Sqlite = require(path.join(root, 'node_modules/better-sqlite3'));
const read = sql => { const db = new Sqlite(dbPath, { readonly: true, fileMustExist: true }); try { return db.prepare(sql).all(); } finally { db.close(); } };
const trials = () => read('SELECT data_json FROM controlled_trials ORDER BY rowid').map(row => JSON.parse(row.data_json));
// Independent breaker: even a launch-policy defect cannot send a public request.
const denyNetwork = () => { result.blockedNetworkAttempts.push('unexpected transport'); throw new Error('Owned launcher probe forbids all network'); };
for (const transport of [require('node:http'), require('node:https')]) transport.request = transport.get = denyNetwork;
require('node:net').Socket.prototype.connect = denyNetwork;
require('node:tls').connect = denyNetwork;
require('node:dns/promises').lookup = async () => denyNetwork();
globalThis.fetch = async () => denyNetwork(); syncBuiltinESMExports();
const nativeExit = app.exit.bind(app);
let finished = false;
app.exit = code => {
  if (!finished || code !== 0) return nativeExit(code || 1);
  try {
    equal('exit database integrity', read('PRAGMA integrity_check')[0].integrity_check, 'ok');
    equal('exit database migration remains v4', read('SELECT MAX(version) AS version FROM schema_migrations')[0].version, 4);
    equal('exit preserves the exact unknown evidence', trials(), [result.unknown]);
    result.status = 'PASS'; result.assertions = result.checks.length; save();
    if (!restart) fs.writeFileSync(manifestFile, JSON.stringify({ status: 'PASS', directory: dir, unknown: result.unknown, providerId: result.providerId }), { mode: 0o600, flag: 'wx' });
    console.log('CONTROLLED_LAUNCHER_PRODUCTION_PASS ' + JSON.stringify({ resultPath, manifestFile, assertions: result.assertions, publicApiCalls: 0, realKeychainCalls: 0 }));
    return nativeExit(0);
  } catch (error) { return fail(error); }
};
const timeout = setTimeout(() => fail(new Error('Owned launcher fixture timeout')), 45000);
function fail(error) { clearTimeout(timeout); result.status = 'FAIL'; result.error = error instanceof assert.AssertionError ? error.message : error.name; save(); console.error('CONTROLLED_LAUNCHER_PRODUCTION_FAIL ' + JSON.stringify({ resultPath, error: result.error })); return nativeExit(1); }
async function waitFor(readValue, accepts, label) {
  const deadline = performance.now() + 10000;
  for (;;) { const value = await readValue(); if (accepts(value)) return value; assert.ok(performance.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 20)); }
}
async function main() {
  const entry = path.join(root, 'scripts/controlled-desktop/main.cjs');
  process.argv = [process.execPath, entry, buildRoot, profileRoot, sha];
  require(entry);
  const startup = await waitFor(() => JSON.parse(fs.readFileSync(process.env.ROUNDTRIAL_RESULT, 'utf8')), row => row.status === 'READY', 'Startup READY missing');
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => { const remote = /^(https?|wss?|ftp):/u.test(details.url); if (remote) result.blockedNetworkAttempts.push('Chromium remote'); callback({ cancel: remote }); });
  equal('real entry reports the expected main SHA', startup.main, sha);
  check('launcher has no send permission', startup.sendAuthorized === false && startup.network.sendAuthorized === false && startup.network.granted === 0 && startup.network.started === 0);
  equal('actual Main and launch gate use the explicit network route', startup.network.networkRoute, proxyMode ? 'trusted-loopback-connect' : 'direct');
  check('launch network lease is expired', RealDate.parse(startup.network.expiresAt) === 0);
  const window = BrowserWindow.getAllWindows()[0], contents = window.webContents;
  const { ProviderRegistry } = await import(pathToFileURL(path.join(buildRoot, 'out/main/index.js')).href);
  const confirmTarget = ProviderRegistry.prototype.confirmTarget;
  let mainProxy;
  ProviderRegistry.prototype.confirmTarget = function (input) { mainProxy = this.options.proxy; return confirmTarget.call(this, input); };
  check('dynamic main title', window.getTitle().includes(sha.slice(0, 7)) && window.getTitle().includes('未授权发送'));
  const prefs = contents.getLastWebPreferences();
  check('actual production sandbox bridge boundary', prefs.sandbox && prefs.contextIsolation && !prefs.nodeIntegration && prefs.webSecurity);
  check('restricted real Preload bridge', await contents.executeJavaScript(`(()=>{const a=window.roundtable;return !!a&&typeof a.settings.createProvider==='function'&&!('invoke' in a)&&!('resolveKey' in a.settings)&&typeof require==='undefined'&&typeof process==='undefined';})()`));
  const menu = Menu.getApplicationMenu().items.find(item => item.label === '受控测试');
  const start = menu?.submenu.items.find(item => item.label === 'DeepSeek 单次测试…');
  const recent = menu?.submenu.items.find(item => item.label === '查看最近测试记录…');
  check('actual native controlled menu actions', Boolean(start && recent));
  const clickStart = async label => { scenario = label; const before = result.dialogs.length; start.click(); await waitFor(() => result.dialogs.slice(before), rows => rows.some(row => row.message === '没有发起新的自动重试'), 'Start action did not finish safely'); };
  if (!restart) {
    result.providerId = await contents.executeJavaScript(`(async()=>{const a=window.roundtable.settings;const p=await a.createProvider({name:'Owned launcher fixture',kind:'openai-compatible',baseUrl:'https://api.deepseek.com',enabled:true,isDefault:false,defaultModelId:'deepseek-flash',customModels:[{id:'deepseek-flash',name:'DeepSeek Flash'}]});await a.setKey({providerId:p.id,apiKey:${JSON.stringify(fakeKey)}});await a.confirmTarget({providerId:p.id,baseUrl:'https://api.deepseek.com',confirmed:true});return p.id;})()`);
    const beforeDecrypt = result.fakeDecrypt;
    await clickStart('cancel');
    const confirmation = result.dialogs.find(row => row.scenario === 'cancel' && row.title === '授权一次 DeepSeek 受控测试');
    check('real native confirmation was reached', Boolean(confirmation));
    equal('unarmed launcher offers cancel only', confirmation.buttons, ['取消']);
    check('native confirmation defaults cancel', confirmation.defaultId === 0 && confirmation.cancelId === 0);
    check('confirmation explains fixed request and estimate risk', ['Reply OK.', 'max_tokens=128', '单 Agent', '¥0.05', '不是服务商账单的绝对硬上限', '未授权新的单次发送许可'].every(t => confirmation.detail.includes(t)));
    equal('cancel does not read a Key', result.fakeDecrypt, beforeDecrypt);
    equal('cancel creates no billing record', trials().length, 0);
    const strict = await contents.executeJavaScript(`window.roundtable.settings.testConnection({providerId:${JSON.stringify(result.providerId)},level:'generation',modelId:'deepseek-flash',allowGeneration:true})`);
    equal('ordinary real generation remains unsupported', strict.result.error.code, 'unsupported');
    equal('ordinary rejected generation does not read a Key', result.fakeDecrypt, beforeDecrypt);
    const now = new Date().toISOString();
    result.unknown = { id: randomUUID(), requestId: randomUUID(), providerId: result.providerId, modelId: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', prompt: 'Reply OK.', keyRevision: randomUUID(), createdAt: now,
      priceReviewedAt: '2026-10-17T16:00:00.000Z', priceExpiresAt: '2026-10-18T16:00:00.000Z', priceEvidence: 'owned fixture only',
      inputMicroCnyPerToken: 2, outputMicroCnyPerToken: 8, estimatedInputTokens: 67, estimatedMicroCny: 1158, reservedMicroCny: 50000, maxOutputTokens: 128,
      state: 'unknown', outcome: 'error', actualInputTokens: null, actualOutputTokens: null, observedUsage: null, accountedMicroCny: null, text: '', errorCode: 'network_error',
      diagnostics: { version: 1, stage: proxyMode ? 'proxy' : 'dns', category: proxyMode ? 'proxy_rejected' : 'dns_failed', evidence: 'client_invoked', startedAt: now, updatedAt: now, clientInvokedAt: now } };
    const db = new Sqlite(dbPath); try { db.prepare('INSERT INTO controlled_trials(id,request_id,provider_id,state,data_json) VALUES(?,?,?,?,?)').run(result.unknown.id, result.unknown.requestId, result.providerId, 'unknown', JSON.stringify(result.unknown)); } finally { db.close(); }
  } else {
    result.providerId = prior.providerId; result.unknown = prior.unknown;
    equal('restart preserves unknown reservation and evidence', trials(), [prior.unknown]);
    await contents.executeJavaScript(`window.roundtable.settings.confirmTarget({providerId:${JSON.stringify(result.providerId)},baseUrl:'https://api.deepseek.com',confirmed:true})`);
  }
  equal('production Registry receives the same explicit route', mainProxy, proxyMode ? { hostname: '127.0.0.1', port: 9 } : undefined);
  ProviderRegistry.prototype.confirmTarget = confirmTarget;
  const beforeRecent = result.fakeDecrypt;
  scenario = 'recent'; recent.click();
  const shown = result.dialogs.find(row => row.scenario === 'recent');
  check('recent record displays safe route evidence and retained reserve', Boolean(shown) && [proxyMode ? '代理响应或目标被拒绝' : 'DNS 解析失败', '无法确认服务商是否收到', '仍保留 ¥0.05', '人工核对'].every(t => shown.detail.includes(t)));
  if (proxyMode) check('proxy diagnostics do not claim an origin HTTP response', shown.detail.includes('本机代理 CONNECT 隧道') && !/HTTP \d{3}/u.test(shown.detail));
  equal('recent viewing does not read a Key', result.fakeDecrypt, beforeRecent);
  const beforeConfirmations = result.dialogs.filter(row => row.title === '授权一次 DeepSeek 受控测试').length;
  await clickStart('unknown-blocked');
  equal('unknown reserve prevents another final confirmation', result.dialogs.filter(row => row.title === '授权一次 DeepSeek 受控测试').length, beforeConfirmations);
  equal('unknown reserve rejects before reading a Key', result.fakeDecrypt, beforeRecent);
  equal('unknown reserve is not modified', trials(), [result.unknown]);
  const finalStartup = JSON.parse(fs.readFileSync(process.env.ROUNDTRIAL_RESULT, 'utf8'));
  equal('desktop stays unarmed', finalStartup.sendAuthorized, false);
  check('all safeStorage methods remain owned fakes', Object.entries(fakeStorage).every(([name, fn]) => safeStorage[name] === fn));
  check('ordinary DTOs and diagnostics do not echo fake Key', !JSON.stringify({ dialogs: result.dialogs, unknown: trials() }).includes(fakeKey));
  equal('zero Node Chromium or DNS network attempts', result.blockedNetworkAttempts, []);
  check('assertions really executed', result.checks.length >= (restart ? 15 : 24));
  finished = true; clearTimeout(timeout); app.quit();
}
main().catch(fail);
