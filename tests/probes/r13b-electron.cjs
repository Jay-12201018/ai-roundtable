// R13B production-entry probe: top-ups, write-offs, time-of-day/cache settlement, summaries and the usage report through
// the real built Main/Preload/App, private profile, fake safeStorage. Only https://api.deepseek.com is redirected to an
// owned loopback fixture, and Main's settlement clock is replaced by a clearly named fixture clock (D106); nothing leaves the host.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, session, safeStorage, dialog } = require('electron');

const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === '--restart', 'Usage: electron r13b-electron.cjs [--restart private-manifest.json]');
const restarting = args.length === 2;
assert.equal(app.isReady(), false, 'Isolation must precede readiness/Main');
app.commandLine.appendSwitch('use-mock-keychain');
assert.equal(app.commandLine.hasSwitch('use-mock-keychain'), true, 'Chromium Keychain isolation switch missing');
const directory = restarting ? dirname(resolve(args[1])) : fs.mkdtempSync(join(tmpdir(), 'roundtable-r13b-production-'));
assert.ok(basename(directory).startsWith('roundtable-r13b-production-') && fs.realpathSync(dirname(directory)) === fs.realpathSync(tmpdir()), 'Only this probe owned temporary profile is allowed');
assert.ok(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'Profile directory cannot be a symlink');
assert.equal(fs.statSync(directory).uid, process.getuid());
const manifestPath = join(directory, 'r13b-manifest.json');
assert.equal(restarting ? resolve(args[1]) : manifestPath, manifestPath);
const ownerPath = join(directory, 'r13b-owner.json');
if (!restarting) fs.writeFileSync(ownerPath, JSON.stringify({ probe: 'R13B production probe', uid: process.getuid(), directory }), { mode: 0o600, flag: 'wx' });
assert.deepEqual(JSON.parse(fs.readFileSync(ownerPath, 'utf8')), { probe: 'R13B production probe', uid: process.getuid(), directory });
const prior = restarting ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : undefined;
if (restarting) assert.equal(prior.status, 'FIRST_PASS_SUMMARY_IN_FLIGHT');
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
const resultPath = join(directory, restarting ? 'r13b-restart.json' : 'r13b-first.json');
const save = () => fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
const fake = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'r13b-fixture-only',
  encryptString: value => { result.fakeSafeStorage.encrypt++; return Buffer.from([...Buffer.from(value)].map(value => value ^ 0xa5)); },
  decryptString: value => { result.fakeSafeStorage.decrypt++; return Buffer.from([...value].map(value => value ^ 0xa5)).toString(); },
  setUsePlainTextEncryption: () => { throw new Error('Fixture does not allow plaintext storage'); },
};
for (const name of Object.getOwnPropertyNames(safeStorage).filter(name => typeof safeStorage[name] === 'function')) assert.ok(Object.hasOwn(fake, name), 'Unisolated safeStorage method: ' + name);
for (const [name, implementation] of Object.entries(fake)) { safeStorage[name] = implementation; assert.equal(safeStorage[name], implementation); result.fakeSafeStorage.replacedMethods.push(name); }

const http = require('node:http');
const { syncBuiltinESMExports } = require('node:module');
const fakeKey = 'r13b-fake-deepseek-key';
// The fixture's provider usage with DeepSeek's cache split: 100 cache hits + 200 misses, 6 output tokens.
// Off-peak: 100×0.02 + 200×1 + 6×4 = 226 micro-CNY; peak: 100×0.04 + 200×2 + 6×8 = 452 (648 without the split).
const usage = { prompt_tokens: 300, completion_tokens: 6, prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 200 };
const requests = []; let port; let mode = 'ok'; let hung;
const fixture = http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const summary = body.messages.some(message => message.content.includes('【请写摘要】'));
    requests.push({ method: req.method, path: req.url, model: body.model, maxTokens: body.max_tokens, thinking: body.thinking, keyMatches: req.headers.authorization === `Bearer ${fakeKey}`, summary,
      summaryLabel: body.messages.some(message => message.content.includes('【讨论摘要 · 覆盖第 1–3 条，由主持人确认】')) });
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/deepseek/chat/completions');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
    emit({ id: 'owned-fixture', choices: [{ index: 0, delta: { content: summary ? `夹具摘要：三位成员讨论了校园跑腿平台（请求 ${requests.length}）` : `DeepSeek 夹具回复 ${requests.length}` }, finish_reason: null }] });
    if (mode === 'hang') { hung = res; return; }
    if (mode === 'no-usage') { setTimeout(() => { emit({ id: 'owned-fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }); res.end('data: [DONE]\n\n'); }, 50); return; }
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
const fail = error => { result.status = 'FAIL'; result.error = error instanceof Error ? error.stack : typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error); save(); console.error('R13B_FAIL ' + JSON.stringify({ resultPath, error: result.error })); app.exit(1); };
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

// Beijing local time (UTC+8) for the fixture clock: Friday 2026-10-23, 21:00 is off-peak and 10:00 is peak.
const beijing = local => new Date(`${local}+08:00`);
let clock = beijing('2026-10-23T21:00:00');
const exportPath = join(directory, 'usage-export.csv');

async function main() {
  await new Promise(done => fixture.listen(0, '127.0.0.1', done)); port = fixture.address().port;
  const production = await import(pathToFileURL(entry).href);
  const { ProviderRegistry: Registry, settlementClock } = production;
  assert.equal(typeof Registry, 'function'); assert.equal(typeof settlementClock?.now, 'function');
  // D106 fixture clock: only the settlement time source is replaced; policy, rates and ledger stay production code.
  settlementClock.now = () => new Date(clock);
  const transport = Registry.prototype.createTransport;
  Registry.prototype.createTransport = function (guard, diagnostics, proxyKind) {
    const send = transport.call(this, guard, diagnostics, proxyKind);
    return (url, init) => { const target = new URL(String(url));
      assert.equal(target.origin, 'https://api.deepseek.com', 'Only the DeepSeek target may be redirected');
      return send(`http://127.0.0.1:${port}/deepseek${target.pathname}${target.search}`, init); };
  };
  // The CSV export writes only where the user picks; the probe answers the native dialog with its own profile path.
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
  await guarded; const window = await loaded; const contents = window.webContents;
  contents.setBackgroundThrottling(false);
  const preferences = contents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
  const js = code => contents.executeJavaScript(code);
  const until = async (code, message, timeout = 60000) => { const deadline = Date.now() + timeout; for (;;) { const value = await js(code); if (value) return value; if (Date.now() > deadline) throw new Error('Timed out: ' + message); await sleep(50); } };
  const api = (path, ...input) => js(`window.roundtable.${path}(...${JSON.stringify(input)})`);
  const snapshot = runId => api('run.getSnapshot', runId);
  const settledRun = runId => until(`window.roundtable.run.getSnapshot(${JSON.stringify(runId)}).then(s => ['completed','error','paused'].includes(s.status) && !s.messages.some(m => m.status === 'streaming') && !(s.summaries ?? []).some(x => x.requests.some(r => r.status === 'generating')))`, 'run settled');
  check(await js(`typeof window.roundtable.run.addBudget === 'function' && typeof window.roundtable.usage.writeOff === 'function' && typeof window.roundtable.summary.generate === 'function' && !('invoke' in window.roundtable) && typeof require === 'undefined'`), 'Typed R13B bridge only');

  if (restarting) {
    await sleep(1500);
    check(requests.length === 0, 'Restart sent no request (no automatic retry, recovery or summary resend)');
    const runA = await snapshot(prior.runA);
    const summary = runA.summaries.find(item => item.summaryId === prior.summaryId);
    const interrupted = summary.requests.find(request => request.requestId === prior.inFlightRequestId);
    check(interrupted?.status === 'interrupted', 'The in-flight summary request is interrupted, not resent');
    const charge = runA.charges.find(item => item.requestId === prior.inFlightRequestId);
    check(charge?.kind === 'summary' && charge.state === 'unknown' && charge.chargedMicro === charge.reservedMicro && charge.chargedMicro > 0, 'Its charge is unknown at the full reservation, never zero');
    check(runA.messages.find(message => message.id === prior.inFlightMessageId)?.status === 'aborted', 'Its partial text is kept as an aborted version');
    check(summary.confirmedMessageIds.includes(prior.confirmedMessageId) && runA.versions.find(v => v.messageId === prior.confirmedMessageId)?.active, 'The confirmed summary version stays effective');
    check(runA.budget.topUps.length === 1 && runA.budget.limitMicro === 1_001_000, 'Top-up history survives restart');
    check(runA.charges.filter(item => item.settlement?.period === 'off_peak' && item.chargedMicro === 226).length === 3, 'Off-peak cache settlement survives restart');
    const runC = await snapshot(prior.runC);
    check(runC.charges[0].writeOffs?.at(-1)?.amountMicro === 100 && runC.budget.writtenOffMicro === 100, 'Write-off survives restart');
    const report = await api('usage.getReport');
    check(report.totals.unknown.count === 1 && report.totals.writtenOff.count === 1 && report.totals.settled.count === prior.settledCount, 'Usage report after restart: one new unknown (the interrupted summary), the write-off and every settlement');
    await js(`localStorage.setItem('roundtable.runId', ${JSON.stringify(prior.runA)}); location.reload(); true`);
    await until(`document.body.innerText.includes('讨论摘要')`, 'summary rendered after restart');
    await sleep(500); check(requests.length === 0, 'Viewing the Run after restart sent no request');
  } else {
    const provider = await api('settings.createProvider', { name: 'DeepSeek 直连', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'deepseek-flash' }] });
    await api('settings.setKey', { providerId: provider.id, apiKey: fakeKey });
    await api('settings.confirmTarget', { providerId: provider.id, baseUrl: 'https://api.deepseek.com', confirmed: true });
    const room = await api('rooms.createRoom', { name: 'R13B 用量探针', objective: 'DeepSeek fixture' });
    const people = [['起草者', '起草'], ['审查者', '审查'], ['综合者', '综合']];
    for (const [index, [name, role]] of people.entries()) await api('rooms.createAgent', { roomId: room.id, displayName: name, roleTemplateId: role, systemPrompt: '', providerId: provider.id, modelId: 'deepseek-flash', enabled: true, displayOrder: index });

    // D104: a budget that cannot cover the first request stops before sending; a top-up continues the same Run.
    const runA = await api('run.start', { roomId: room.id, task: '设计一个校园跑腿平台', workflowSnapshot: {}, maxTurns: 3, budgetMicroCny: 1000 });
    await until(`window.roundtable.run.getSnapshot(${JSON.stringify(runA.runId)}).then(s => s.status === 'error')`, 'budget stop');
    check(requests.length === 0 && (await snapshot(runA.runId)).budget.blocked?.reason === 'insufficient', 'Budget stop sent zero requests');
    const topUp = await api('run.addBudget', { runId: runA.runId, clientRequestId: 'probe-top-up', amountMicroCny: 1_000_000, resume: true });
    check(topUp.resumed === true && topUp.duplicate === false, 'Top-up recorded and the Run continued');
    check((await api('run.addBudget', { runId: runA.runId, clientRequestId: 'probe-top-up', amountMicroCny: 1_000_000, resume: true })).duplicate === true, 'Repeated top-up delivery is recorded once');
    await until(`window.roundtable.run.getSnapshot(${JSON.stringify(runA.runId)}).then(s => s.status === 'completed')`, 'resumed run completed');
    let a = await snapshot(runA.runId);
    check(requests.length === 3 && a.budget.limitMicro === 1_001_000 && a.budget.topUps.length === 1 && a.budget.initialLimitMicro === 1000, 'Three requests after the top-up; limit = start + top-up');
    // D106: off-peak fixture clock and the provider cache split.
    check(a.charges.every(c => c.state === 'settled' && c.accountedMicro === 648 && c.chargedMicro === 226 && c.settlement?.period === 'off_peak' && c.settlement.cacheHitTokens === 100), 'Off-peak + cache settlement: 226 each, 648 kept as the peak evidence');
    check(a.budget.settledMicro === 678 && a.budget.remainingMicro === 1_001_000 - 678, 'Budget counts the settled amounts');

    // D107: a summary is previewed, generated as one budgeted request, then used only after confirmation.
    clock = beijing('2026-10-23T10:00:00');
    const preview = await api('summary.preview', { runId: runA.runId });
    check(preview.available && preview.firstNumber === 1 && preview.lastNumber === 3 && preview.agentId === a.execution.membersSnapshot.find(m => m.displayName === '综合者').agentId && preview.cost.kind === 'priced' && preview.cost.maxMicro > 0, 'Preview: messages 1–3, written by the synthesizer, with a maximum cost');
    check(requests.length === 3, 'Preview sent nothing');
    const generated = await api('summary.generate', { runId: runA.runId, clientRequestId: 'probe-summary', agentId: preview.agentId, throughSlotId: preview.throughSlotId });
    await settledRun(runA.runId);
    a = await snapshot(runA.runId);
    const summaryCharge = a.charges.find(c => c.requestId === generated.requestId);
    check(requests.length === 4 && requests[3].summary && requests[3].maxTokens === 4096, 'One summary request sent');
    check(summaryCharge?.kind === 'summary' && summaryCharge.state === 'settled' && summaryCharge.chargedMicro === 452 && summaryCharge.settlement.period === 'peak', 'Summary settled at the peak cache price (452)');
    check(a.budget.settledMicro === 678 + 452, 'Summary spend counts against the Run budget');
    check(a.summaries[0].confirmedMessageIds.length === 0, 'Generated summary waits for confirmation');
    const confirmed = await api('summary.confirm', { runId: runA.runId, clientRequestId: 'probe-confirm', messageId: generated.messageId });
    check(confirmed.summaryId === generated.summaryId && (await snapshot(runA.runId)).summaries[0].confirmedMessageIds[0] === generated.messageId, 'Host confirmation recorded');

    // A peak Run in the same room, so the report has both periods.
    const runB = await api('run.start', { roomId: room.id, task: '高峰时段的运行', workflowSnapshot: {}, maxTurns: 1 });
    await until(`window.roundtable.run.getSnapshot(${JSON.stringify(runB.runId)}).then(s => s.status === 'completed')`, 'peak run');
    check((await snapshot(runB.runId)).charges[0].settlement.period === 'peak' && (await snapshot(runB.runId)).charges[0].chargedMicro === 452, 'Peak Run settles at 452');

    // D105: an answer without usage is unknown at its cap until the host writes it off.
    mode = 'no-usage';
    const runC = await api('run.start', { roomId: room.id, task: '没有返回用量的运行', workflowSnapshot: {}, maxTurns: 1 });
    await until(`window.roundtable.run.getSnapshot(${JSON.stringify(runC.runId)}).then(s => s.status === 'completed')`, 'no-usage run');
    let c = await snapshot(runC.runId);
    check(c.charges[0].state === 'unknown' && c.budget.unknownMicro === c.charges[0].reservedMicro, 'Missing usage is unknown at the full reservation');
    const writeOff = await api('usage.writeOff', { runId: runC.runId, requestId: c.charges[0].requestId, clientRequestId: 'probe-write-off', amountMicroCny: 100, basis: '控制台用量明细（夹具）', acknowledgedUncertainty: true });
    c = await snapshot(runC.runId);
    check(!writeOff.duplicate && c.charges[0].state === 'unknown' && c.charges[0].chargedMicro === 100 && c.budget.unknownMicro === 0 && c.budget.writtenOffMicro === 100, 'Write-off counts the console amount; the unknown row stays');
    mode = 'ok';

    // D108: the report and CSV agree with the ledgers.
    const report = await api('usage.getReport');
    const runs = await Promise.all([runA.runId, runB.runId, runC.runId].map(snapshot));
    const ledger = runs.reduce((sum, run) => sum + run.budget.settledMicro + run.budget.unknownMicro + run.budget.writtenOffMicro, 0);
    check(report.totals.totalMicro === ledger && report.totals.settled.count === 5 && report.totals.settled.offPeakCount === 3 && report.totals.writtenOff.count === 1 && report.totals.unknown.count === 0, 'Report totals equal the Run ledgers');
    check(report.byRun.length === 3 && report.byModel.length === 1 && report.byDate.length >= 1, 'Report groups by Run, model and date');
    const exported = await api('usage.exportCsv');
    const csv = fs.readFileSync(exportPath, 'utf8');
    check(exported.saved && exported.rows === 6 && csv.startsWith('﻿请求ID') && csv.trim().split('\r\n').length === 7 && csv.includes('空闲价') && csv.includes('已核销'), 'CSV export: one row per ledger entry, with period and write-off');

    // Crash while regenerating the summary: its reservation must survive as unknown and never be resent.
    mode = 'hang';
    const again = await api('summary.generate', { runId: runA.runId, clientRequestId: 'probe-regenerate', agentId: preview.agentId, throughSlotId: preview.throughSlotId, summaryId: generated.summaryId });
    await until(`window.roundtable.run.getSnapshot(${JSON.stringify(runA.runId)}).then(s => s.messages.find(m => m.id === ${JSON.stringify(again.messageId)})?.content.length > 0)`, 'summary streaming');
    const inFlight = await snapshot(runA.runId);
    check(inFlight.charges.find(item => item.requestId === again.requestId)?.state === 'reserved', 'In-flight summary holds its reservation');
    fs.writeFileSync(manifestPath, JSON.stringify({ status: 'FIRST_PASS_SUMMARY_IN_FLIGHT', directory, providerId: provider.id, runA: runA.runId, runB: runB.runId, runC: runC.runId,
      summaryId: generated.summaryId, confirmedMessageId: generated.messageId, inFlightRequestId: again.requestId, inFlightMessageId: again.messageId, settledCount: 5 }), { mode: 0o600, flag: 'wx' });
  }
  assert.deepEqual(result.nodeNetworkAttempts, []); assert.deepEqual(result.chromiumNetworkAttempts, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.preloadErrors, []);
  check(!JSON.stringify(result).includes(fakeKey), 'Key absent from probe result');
  result.requests = requests; result.status = 'PASS'; save();
  console.log('R13B_PRODUCTION_PASS ' + JSON.stringify({ phase: result.phase, resultPath, manifestPath, checks: result.checks.length, requests: requests.length, liveApi: false }));
  if (restarting) { await new Promise(done => { fixture.closeAllConnections(); fixture.close(done); }); app.quit(); }
  else { check(hung && !hung.destroyed, 'Summary request still open at the crash'); app.exit(0); }
}
save(); main().catch(fail);
