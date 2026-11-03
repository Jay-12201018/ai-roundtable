// R13B hands-on acceptance: real mouse/keyboard input (DevTools Input domain) and IME-composed Chinese drive the
// production build through a budget stop and top-up, time-of-day/cache pricing, a summary (generate, confirm, edit,
// affected), a write-off and the usage page with CSV export. The real DeepSeek policy and ledger run; only the
// https://api.deepseek.com transport is redirected to an owned loopback fixture, and Main's settlement clock is a named
// fixture clock (D106). One screenshot per step.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, session, safeStorage, dialog } = require('electron');

const args = process.argv.slice(2);
assert.ok(args.length === 0, 'Usage: electron r13b-acceptance.cjs');
const restarting = false;
assert.equal(app.isReady(), false, 'Isolation must precede readiness/Main');
app.commandLine.appendSwitch('use-mock-keychain');
assert.equal(app.commandLine.hasSwitch('use-mock-keychain'), true, 'Chromium Keychain isolation switch missing');
const directory = restarting ? dirname(resolve(args[1])) : fs.mkdtempSync(join(tmpdir(), 'roundtable-r13b-acceptance-'));
assert.ok(basename(directory).startsWith('roundtable-r13b-acceptance-') && fs.realpathSync(dirname(directory)) === fs.realpathSync(tmpdir()), 'Only this probe owned temporary profile is allowed');
assert.ok(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'Profile directory cannot be a symlink');
assert.equal(fs.statSync(directory).uid, process.getuid());
const manifestPath = join(directory, 'r13b-acc-manifest.json');
assert.equal(restarting ? resolve(args[1]) : manifestPath, manifestPath);
const ownerPath = join(directory, 'r13b-acc-owner.json');
if (!restarting) fs.writeFileSync(ownerPath, JSON.stringify({ probe: 'R13B acceptance', uid: process.getuid(), directory }), { mode: 0o600, flag: 'wx' });
assert.deepEqual(JSON.parse(fs.readFileSync(ownerPath, 'utf8')), { probe: 'R13B acceptance', uid: process.getuid(), directory });
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
const resultPath = join(directory, restarting ? 'r13b-acceptance-restart.json' : 'r13b-acceptance.json');
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
const { holdFocus, emulateFocus, imeInput } = require('./ime-input.cjs');
const { settleViewport } = require('./settle-viewport.cjs');
const fakeKey = 'r13b-fake-deepseek-key';
// The fixture's provider usage with DeepSeek's cache split: 100 hits + 200 misses, 6 output tokens.
// Off-peak: 100×0.02 + 200×1 + 6×4 = 226 micro-CNY; peak: 100×0.04 + 200×2 + 6×8 = 452.
const usage = { prompt_tokens: 300, completion_tokens: 6, prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 200 };
const requests = []; let port; let mode = 'ok'; let hung;
const fixture = http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ method: req.method, path: req.url, model: body.model, maxTokens: body.max_tokens, thinking: body.thinking, keyMatches: req.headers.authorization === `Bearer ${fakeKey}` });
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/deepseek/chat/completions');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
    const summary = body.messages.some(message => message.content.includes('【请写摘要】'));
    const reply = summary ? '摘要：起草者提出按距离分档计价；审查者指出夜间配送缺少安全措施；综合者建议先在两栋宿舍楼试点。待定：骑手保险。'
      : { 审查者: '审查：夜间配送没有安全措施；抽成比例缺少依据，请给出测算。', 综合者: '综合：先在两栋宿舍楼试点两周，夜间 22 点后暂停接单；抽成按试点数据再定。' }[
        /现在由你（成员「([^」]+)」/u.exec(body.messages.at(-1).content)?.[1]] ?? '方案：按距离分三档计价，起步价 3 元；骑手由在校学生兼职，平台抽成 10%。';
    emit({ id: 'owned-fixture', choices: [{ index: 0, delta: { content: reply }, finish_reason: null }] });
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
let failureShot;
const fail = async error => { try { await failureShot?.(); } catch { /* best effort */ } result.status = 'FAIL'; result.error = error instanceof Error ? error.stack : typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error); save(); console.error('R13B_ACCEPTANCE_FAIL ' + JSON.stringify({ resultPath, error: result.error })); app.exit(1); };
const timer = setTimeout(() => fail(new Error('Bounded acceptance timed out')), 480000);
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


const screens = resolve(root, 'docs/verification/r13b-screens');
// Beijing local time (UTC+8): Friday 2026-10-23 21:00 is off-peak, 10:00 is peak.
const beijing = local => new Date(`${local}+08:00`);
let clock = beijing('2026-10-23T21:00:00');
const exportPath = join(directory, 'usage-export.csv');

async function main() {
  await new Promise(done => fixture.listen(0, '127.0.0.1', done)); port = fixture.address().port;
  const { ProviderRegistry: Registry, settlementClock } = await import(pathToFileURL(entry).href);
  // D106 fixture clock: only the settlement time source is replaced; policy, rates and ledger stay production code.
  settlementClock.now = () => new Date(clock);
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
  const transport = Registry.prototype.createTransport;
  Registry.prototype.createTransport = function (guard, diagnostics, proxyKind) {
    const send = transport.call(this, guard, diagnostics, proxyKind);
    return (url, init) => { const target = new URL(String(url));
      assert.equal(target.origin, 'https://api.deepseek.com', 'Only the DeepSeek target may be redirected');
      return send(`http://127.0.0.1:${port}/deepseek${target.pathname}${target.search}`, init); };
  };
  await guarded; const window = await loaded; const contents = window.webContents;
  // The probe window may be covered or behind other windows while it runs; keep its timers and rendering at full speed.
  contents.setBackgroundThrottling(false);
  const preferences = contents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
  window.setContentSize(1440, 900);
  failureShot = async () => { fs.writeFileSync(join(directory, 'failure.png'), (await contents.capturePage()).toPNG()); result.failureText = await contents.executeJavaScript('document.body.innerText'); };
  fs.mkdirSync(screens, { recursive: true });
  for (const old of fs.readdirSync(screens)) if (/^\d\d-.*\.png$/u.test(old)) fs.rmSync(join(screens, old));
  const cdp = contents.debugger; cdp.attach('1.3');
  const send = (method, params = {}) => cdp.sendCommand(method, params);
  const js = code => contents.executeJavaScript(code);
  const until = async (code, message, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    for (;;) { const value = await js(code); if (value) return value; if (Date.now() > deadline) throw new Error('Timed out: ' + message); await sleep(50); }
  };
  // The content size set above settles asynchronously; aim the first click only once the layout has it.
  result.viewport = { requested: { width: 1440, height: 900 }, actual: await settleViewport({ window, js, sleep }) };
  // The window stops taking key status so another window cannot end an open IME composition; the page still acts focused.
  holdFocus(window); await emulateFocus(send);
  // Locates a visible control by accessible name (aria-label, own text or enclosing label) and scrolls it into view.
  const locator = `window.__r13b = (name, o = {}) => {
    const visible = e => e && !e.closest('[hidden]') && e.getClientRects().length > 0;
    const label = e => e.getAttribute('aria-label') || (e.tagName !== 'BUTTON' && e.labels?.[0]?.textContent?.trim()) || e.closest('label')?.firstChild?.textContent?.trim() || (e.type === 'checkbox' ? e.closest('label')?.textContent?.trim() : '') || e.textContent.trim();
    let list = [...document.querySelectorAll(o.selector || 'button')].filter(e => visible(e) && label(e) === name);
    if (o.slot !== undefined) { const slot = document.querySelectorAll('.thread-item')[o.slot]; list = list.filter(e => slot && slot.contains(e)); }
    if (o.scope) list = list.filter(e => e.closest(o.scope));
    const e = o.which === 'last' ? list.at(-1) : list[o.which || 0];
    if (!e) return null;
    e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: e.disabled === true };
  }; true`;
  await js(locator);
  const point = async (name, options = {}) => until(`(() => { const p = window.__r13b(${JSON.stringify(name)}, ${JSON.stringify(options)}); return p && !p.disabled ? p : null; })()`, 'control ' + name);
  const click = async (name, options) => {
    const { x, y } = await point(name, options); await sleep(80);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(150);
  };
  const field = (name, options = {}) => click(name, { selector: 'textarea,input,select', ...options });
  const key = async (keyName, modifiers = 0) => {
    const map = { Enter: { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, a: { code: 'KeyA', windowsVirtualKeyCode: 65 } }[keyName];
    // Like a real keyboard, Enter (with or without Shift) carries text; the Cmd+A shortcut carries an editing command.
    const down = { type: map.text ? 'keyDown' : 'rawKeyDown', key: keyName, modifiers, ...map, unmodifiedText: map.text, ...(keyName === 'a' ? { commands: ['selectAll'] } : {}) };
    await send('Input.dispatchKeyEvent', down);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: map.code, windowsVirtualKeyCode: map.windowsVirtualKeyCode, modifiers });
    await sleep(120);
  };
  // Chinese text arrives the way an IME delivers it: a composition (pinyin) that is then committed.
  const { selectAll, ime } = imeInput({ send, js, until, key });
  let shot = 0;
  const capture = async (name, caption, focus) => {
    if (typeof focus === 'number') await js(`document.querySelectorAll('.thread-item')[${focus}]?.scrollIntoView({ block: 'center' }); true`);
    else if (focus) await js(`document.querySelector(${JSON.stringify(focus)})?.scrollIntoView({ block: 'center' }); true`);
    await sleep(350);
    const file = `${String(++shot).padStart(2, '0')}-${name}.png`;
    fs.writeFileSync(join(screens, file), (await contents.capturePage()).toPNG());
    result.screens.push({ file, caption });
  };

  result.screens = [];
  const text = () => js('document.body.innerText');
  // A native <select> opens an OS popup that page input events cannot drive; it is set like a user's pick (focus + change).
  const choose = (name, value) => js(`(() => { const e = [...document.querySelectorAll('select')].find(e => (e.labels?.[0]?.textContent?.trim() ?? e.closest('label')?.firstChild?.textContent?.trim()) === ${JSON.stringify(name)});
    e.focus(); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; })()`);
  const type = text => send('Input.insertText', { text }).then(() => sleep(120));
  const snapshot = () => js(`window.roundtable.run.getSnapshot(localStorage.getItem('roundtable.runId'))`);

  const api = (path, ...input) => js(`window.roundtable.${path}(...${JSON.stringify(input)})`);
  const status = () => js(`document.querySelector('[role=status][aria-label=运行状态]').textContent`);

  // Setup (already accepted hands-on in R13A): a DeepSeek direct Provider with a fake Key, its session target
  // confirmed, and a room with three DeepSeek members. Everything after this is driven by real input.
  const provider = await api('settings.createProvider', { name: 'DeepSeek 直连', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'deepseek-flash' }] });
  await api('settings.setKey', { providerId: provider.id, apiKey: fakeKey });
  await api('settings.confirmTarget', { providerId: provider.id, baseUrl: 'https://api.deepseek.com', confirmed: true });
  const room = await api('rooms.createRoom', { name: '校园跑腿讨论', objective: '' });
  for (const [index, [name, role]] of [['起草者', '起草'], ['审查者', '审查'], ['综合者', '综合']].entries()) {
    await api('rooms.createAgent', { roomId: room.id, displayName: name, roleTemplateId: role, systemPrompt: '', providerId: provider.id, modelId: 'deepseek-flash', enabled: true, displayOrder: index });
  }
  // Reload so the page reads the Provider list as it would after configuring it in Settings.
  await js('location.reload(); true'); await until(`document.querySelector('.sidebar')`, 'reloaded');
  await js(locator);
  // R16: changing page refreshes the sidebar; the room opens on its page, where 新讨论 starts a discussion in it.
  await click('用量'); await click('校园跑腿讨论', { scope: '.sidebar' }); await click('新讨论', { scope: '.room-page' });

  // Step 1 (D104): a budget smaller than one request stops before sending; the reason and the way on sit together.
  await field('讨论目标'); await selectAll(); await ime('sheji', '设计一个校园跑腿平台');
  await click('更多设置'); await field('本次运行预算（元）'); await selectAll(); await type('0.001');
  await click('开始讨论');
  await until(`document.querySelector('[role=alert][aria-label=预算不足]')`, 'budget stop notice');
  check(requests.length === 0, 'Budget stop sent zero requests');
  check((await text()).includes('预算不足，已暂停发送') && (await text()).includes('追加并继续'), 'The stop explains itself and offers 追加并继续 in place');
  await capture('budget-stop', '预算填 0.001 元后点"开始讨论"：发送前就被拦下（夹具没收到任何请求）。原因和继续的办法出现在同一处：最后一条消息的位置显示"预算不足，已暂停发送。下一次请求最高可能花费 …，剩余额度 ¥0.0010"，并给出"追加（元）"（建议值至少补足差额、不少于 ¥1）和"追加并继续"。', '.notice-card');

  // Step 2: top up ¥0.5 and continue the same Run; off-peak fixture clock, provider cache split.
  await field('追加预算（元）', { scope: '.notice-card' }); await selectAll(); await type('0.5');
  await click('追加并继续');
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已完成')`, 'run completed after top-up');
  let snapshot1 = await snapshot();
  check(requests.length === 3 && snapshot1.budget.limitMicro === 501_000 && snapshot1.budget.topUps.length === 1, 'Top-up of ¥0.5 recorded; the Run continued with three requests');
  check(snapshot1.charges.every(charge => charge.settlement?.period === 'off_peak' && charge.chargedMicro === 226), 'Settled off-peak with the cache split');
  // R16: each reply's footer amount opens its usage and price; 本场信息's budget card carries the top-up.
  await js(`document.querySelectorAll('.thread-item .cost').forEach(button => button.click()); true`);
  await until(`document.querySelectorAll('.thread-item .msg-details').length === 3`, 'request details opened');
  const page2 = await js(`[...document.querySelectorAll('.msg-details')].map(e => e.textContent).join('\\n')`);
  check((page2.match(/输入 300（缓存命中 100） \/ 输出 6 tokens · 花费 ¥0\.000226 · 按空闲价（高峰价的一半）/gu) ?? []).length === 3, 'Each reply says off-peak and the cache hits');
  check((await js(`document.querySelector('.budget-card').textContent`)).includes('/ ¥0.5010（含追加 ¥0.50）'), 'Budget card shows the top-up');
  await click('追加记录（1）', { selector: 'summary' });
  await capture('topped-up', '把追加金额改成 0.5 并点"追加并继续"：同一次运行从被拦下的地方继续，三位成员依次发言。预算栏显示"预算 ¥0.5010（含追加 ¥0.5000）"，展开的"追加记录"列出这次 +¥0.5000 和时间、开始时的 ¥0.0010。每条回复下写"输入 300（缓存命中 100） / 输出 6 tokens · 花费 ¥0.000226 · 按空闲价（高峰价的一半）"——夹具时钟是北京时间周五 21:00，按空闲价和缓存命中价结算（高峰未命中价应为 ¥0.000648）。', 0);

  // Step 3 (D107): the host opens the summary panel; coverage, writer and maximum cost come first, nothing is sent.
  clock = beijing('2026-10-23T10:00:00');
  await click('生成讨论摘要…');
  await until(`document.querySelector('dialog.modal .summary-cost')`, 'summary panel');
  check(requests.length === 3, 'Opening the summary panel sent nothing');
  const panel = await js(`({ text: document.querySelector('dialog.modal').innerText,
    through: document.querySelector('[aria-label="摘要覆盖到第几条"]').selectedOptions[0].textContent, writer: document.querySelector('[aria-label="生成摘要的成员"]').selectedOptions[0].textContent })`);
  check(panel.writer.startsWith('综合者') && panel.text.includes('预计最高 ¥') && panel.through.startsWith('第 1 条 到 第 3 条'), 'Panel shows coverage 1–3, the synthesizer and the maximum cost');
  await capture('summary-panel', '在右侧"主持人控制"点"生成讨论摘要…"，面板在时间线末尾打开（不自动生成）：覆盖范围"第 1 条 到 第 3 条"、默认由"综合者"来写，先说明"预计最高 ¥…：发送前按高峰价和输出上限预留，结束后按实际用量和时段结算"和当前剩余额度，按钮写明"生成摘要（发送 1 次请求）"。每条发言左上角的 #1、#2、#3 就是这里的编号。', 'dialog.modal');

  await click('生成摘要（发送 1 次请求）');
  await until(`document.querySelector('.summary-card') && document.querySelector('.summary-card').innerText.includes('待确认')`, 'summary generated');
  const summaryCharge = (await snapshot()).charges.find(charge => charge.kind === 'summary');
  check(requests.length === 4 && requests[3].maxTokens === 4096 && summaryCharge?.settlement?.period === 'peak' && summaryCharge.chargedMicro === 452, 'One summary request, settled at the peak cache price');
  await click('请求详情', { scope: '.summary-card' });
  check((await js(`document.querySelector('.summary-card .msg-details').innerText`)).includes('按高峰价'), 'The summary cost says peak');
  await capture('summary-pending', '点"生成摘要（发送 1 次请求）"：时间线末尾出现"讨论摘要 · 覆盖第 1–3 条 · 待确认 · 确认前之后的发言仍使用原文"，并提示先读一遍再确认。这次请求按夹具时钟周五 10:00 结算，显示"花费 ¥0.000452 · 按高峰价"（同样的用量在空闲时段是 ¥0.000226）。', '.summary-card');

  await click('确认使用');
  await until(`document.querySelector('.summary-card').innerText.includes('已确认 · 之后的发言用它代替原文')`, 'summary confirmed');
  check((await js(`document.querySelectorAll('.msg.is-covered').length`)) === 3, 'The three originals are marked as replaced, and still shown');
  await capture('summary-confirmed', '点"确认使用"：摘要标为"已确认 · 之后的发言用它代替原文"；上面三条原文仍完整显示，只在名字旁标注"已由摘要代替（第 1–3 条）"、正文变灰。', 0);

  // Step 4: the host edits the summary (Chinese via IME): a new version, confirmed by its author.
  await click('修改', { scope: '.summary-card' });
  await field('修改摘要内容'); await selectAll(); await ime('zhuchiren', '主持人修订：试点范围改为三栋宿舍楼；夜间 22 点后暂停接单；骑手保险仍待定。');
  await click('保存为新版本', { scope: '.summary-card' });
  await until(`document.querySelector('.summary-card').innerText.includes('主持人修订')`, 'summary edited');
  check((await js(`document.querySelector('.summary-card').innerText`)).includes('已确认 · 之后的发言用它代替原文') && (await js(`document.querySelector('.summary-card').innerText`)).includes('版本 2/2'), 'The edit is version 2 and used');
  await capture('summary-edited', '在摘要上点"修改"，用输入法改写并"保存为新版本"：变成版本 2/2（来源"主持人修改"），修改即视为主持人确认，仍是"已确认 · 之后的发言用它代替原文"；原版本可用 ‹ › 翻看。', '.summary-card');

  // Step 5 (D087): editing a covered original marks the summary affected.
  await click('修改', { slot: 0 });
  await field('修改消息内容'); await selectAll(); await ime('fangan', '方案（主持人修改）：按距离分两档计价，起步价 2 元。');
  await click('保存为新版本', { slot: 0 });
  await until(`document.querySelector('.summary-card').innerText.includes('受影响') && document.querySelector('.summary-card .note-cost')`, 'summary affected with regenerate cost');
  check((await snapshot()).versions.find(version => version.author === 'summary' && version.active)?.affectedBy.length > 0, 'Snapshot marks the summary affected');
  const affectedText = await js(`document.querySelector('.summary-card').innerText`);
  check(affectedText.includes('第 1 条被修改或重新生成') && affectedText.includes('修改后的发言会照常发给之后的成员') && affectedText.includes('建议重新生成摘要'), 'The note says the revision is sent and suggests regenerating');
  check((await js(`document.querySelector('.summary-card .note-cost').textContent`)).startsWith('最多 ¥'), 'The regenerate button shows its maximum cost');
  check((await js(`document.querySelectorAll('.thread-item')[0].innerText`)).includes('摘要后已修改 · 照常发送') && (await js(`document.querySelectorAll('.msg.is-covered').length`)) === 2, 'The revised message is no longer shown as replaced; the other two still are');
  await capture('summary-affected', '再修改被摘要覆盖的第 1 条原文（输入法输入）。摘要标出"受影响：这份摘要生成后，第 1 条被修改或重新生成。修改后的发言会照常发给之后的成员，紧跟在摘要后面，摘要里与之冲突的内容不再采用。建议重新生成摘要……"；"重新生成摘要…"旁直接显示预计最高花费。第 1 条的标注从"已由摘要代替"变成"摘要后已修改 · 照常发给后续成员"，第 2、3 条仍由摘要代替。（实际请求的输入由生产探针核对：下一次请求同时带摘要和这条修改及说明。）', '.summary-card');

  // Step 6 (D105): an answer without usage is unknown at the cap; the host writes it off from the console amount.
  mode = 'no-usage';
  // D111: a finished discussion is continued from its box; a new one is the explicit 新讨论 button.
  await click('新讨论', { scope: '.controls' });
  await field('讨论目标'); await selectAll(); await ime('dingjia', '再讨论一次定价');
  await click('更多设置'); await field('本次运行预算（元）'); await selectAll(); await type('1');
  await click('每回合后暂停', { selector: 'input[type=checkbox]' });
  await click('开始讨论');
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已暂停')`, 'paused after one turn');
  // R16: the footer amount is a button; it opens the request details, where the write-off is.
  const unknownLabel = await until(`[...document.querySelectorAll('.cost')].map(e => e.textContent).find(t => t.startsWith('费用未知 · 按上限 ¥'))`, 'unknown cost shown at the cap');
  await click(unknownLabel, { selector: '.cost' });
  check((await text()).includes('费用未知（按上限计'), 'Unknown cost explained at the cap');
  await click('核销', { scope: '.msg-details' });
  await field('实际金额（元）'); await type('0.0003');
  await field('依据说明'); await ime('kongzhitai', '控制台十月二十三日用量明细，这次请求 ¥0.0003');
  await click('我已在服务商控制台核对过这次请求的实际扣费', { selector: 'input[type=checkbox]' });
  await capture('writeoff-form', '新开一次逐回合运行，夹具这次不返回用量：回复下方是"费用未知（按上限计 ¥…）· 服务商未返回用量"。点"核销"，填写实际金额 0.0003、用输入法写依据说明、勾选"我已在服务商控制台核对过这次请求的实际扣费"后，"保存核销"才可用；表单说明原"未知"记录会保留、之后可以更正。', '.writeoff-form');
  await click('保存核销');
  await until(`document.body.innerText.includes('已核销 ¥0.000300')`, 'written off');
  const run2 = await snapshot();
  check(run2.charges[0].state === 'unknown' && run2.charges[0].chargedMicro === 300 && run2.budget.writtenOffMicro === 300 && run2.budget.unknownMicro === 0, 'Write-off counts ¥0.0003; the unknown row stays');
  check((await js(`document.querySelector('.budget-card').textContent`)).includes('已核销¥0.0003'), 'Budget card counts the written-off amount');
  check((await text()).includes('比原上限少 ¥') && !(await text()).includes('少计'), 'Write-off wording: 比原上限少, never 少计');
  await capture('written-off', '保存后这条显示"已核销 ¥0.000300（原按上限计 ¥…，比原上限少 ¥…） · 依据：…"，并可"更正核销"；预算栏的累计花费改按核销金额计（"含已核销 ¥0.0003"），剩余额度随之恢复。账本里原来的 unknown 记录没有改动。', 0);
  mode = 'ok';

  // Step 7 (D108): the usage page keeps the three categories apart and exports a CSV through Main.
  await click('用量');
  await until(`document.querySelector('.usage-page [aria-label="合计"]')`, 'usage page');
  const usagePage = await js(`document.querySelector('.usage-page').innerText`);
  check(usagePage.includes('已结算') && usagePage.includes('未知（按上限计）') && usagePage.includes('已核销') && usagePage.includes('全按高峰价为'), 'Usage totals by category');
  check(usagePage.includes('比原上限少 ¥'), 'Usage page uses the same write-off wording');
  await capture('usage-by-run', '顶部导航"用量"：合计、已结算（含"其中 3 次按空闲价；全按高峰价为 ¥…"对照）、未知（按上限计）、已核销分开列出；下方"按运行"表格逐次运行汇总 token 和三类金额，点运行名可回到该运行。', '.usage-page');
  await click('按日期');
  await click('导出 CSV');
  await until(`document.body.innerText.includes('已导出')`, 'exported');
  const csv = fs.readFileSync(exportPath, 'utf8');
  check(csv.startsWith('﻿请求ID') && csv.trim().split('\r\n').length === 6 && csv.includes('空闲价') && csv.includes('高峰价') && csv.includes('已核销'), 'CSV export with one row per ledger entry');
  await capture('usage-export', '切到"按日期"并点"导出 CSV"：Main 弹出系统保存对话框（探针用自己的临时目录作答），写入 5 条记录后页面提示"已导出 5 条记录到…"。CSV 每笔一行，含北京时间计价起止、空闲/高峰价、单价、按高峰价金额、计入金额和核销依据。', '.usage-page');

  // Step 8: dark theme — the same views must stay legible.
  // R16: 外观 is a section of 设置.
  await click('设置'); await click('外观'); await click('深色', { selector: '.choice' });
  check(await js(`document.documentElement.dataset.theme`) === 'dark', 'Dark theme selected');
  await click('用量'); await until(`document.querySelector('.usage-page [aria-label="合计"]')`, 'usage page again');
  await capture('usage-dark', '外观切到"深色"：用量页的卡片、表格、未知费用列表在深色主题下层级和对比度正常。', '.usage-page');
  await click('按讨论');
  const link = await js(`(() => { const e = [...document.querySelectorAll('.usage-page .data .row-link')].find(e => e.textContent.includes('设计一个校园跑腿平台')); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: link.x, y: link.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: link.x, y: link.y, button: 'left', clickCount: 1 });
  await until(`document.querySelector('.summary-card')`, 'run opened from the usage page');
  await capture('summary-dark', '在用量页"按运行"里点"设计一个校园跑腿平台"回到这次运行（深色主题）：被摘要代替的原文、受影响的摘要、空闲价/高峰价花费行都清楚可读。', '.summary-card');

  assert.deepEqual(result.nodeNetworkAttempts, []); assert.deepEqual(result.chromiumNetworkAttempts, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.preloadErrors, []);
  check(!JSON.stringify(result).includes(fakeKey) && !csv.includes(fakeKey), 'Key absent from the result and the CSV');
  cdp.detach();
  result.requests = requests; result.status = 'PASS'; save();
  console.log('R13B_ACCEPTANCE_PASS ' + JSON.stringify({ resultPath, checks: result.checks.length, screens: result.screens.length, requests: requests.length, liveApi: false }));
  await new Promise(done => { fixture.closeAllConnections(); fixture.close(done); }); app.quit();
}
save(); main().catch(fail);
