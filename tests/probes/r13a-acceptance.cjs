// R13A hands-on acceptance: real mouse/keyboard input (DevTools Input domain) and IME-composed Chinese drive the
// production build through Settings, Rooms and a budgeted DeepSeek Run. The real DeepSeek policy and ledger run;
// only the https://api.deepseek.com transport is redirected to an owned loopback fixture. One screenshot per step.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, session, safeStorage } = require('electron');

const args = process.argv.slice(2);
assert.ok(args.length === 0, 'Usage: electron r13a-acceptance.cjs');
const restarting = false;
assert.equal(app.isReady(), false, 'Isolation must precede readiness/Main');
app.commandLine.appendSwitch('use-mock-keychain');
assert.equal(app.commandLine.hasSwitch('use-mock-keychain'), true, 'Chromium Keychain isolation switch missing');
const directory = restarting ? dirname(resolve(args[1])) : fs.mkdtempSync(join(tmpdir(), 'roundtable-r13a-acceptance-'));
assert.ok(basename(directory).startsWith('roundtable-r13a-acceptance-') && fs.realpathSync(dirname(directory)) === fs.realpathSync(tmpdir()), 'Only this probe owned temporary profile is allowed');
assert.ok(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'Profile directory cannot be a symlink');
assert.equal(fs.statSync(directory).uid, process.getuid());
const manifestPath = join(directory, 'r13a-manifest.json');
assert.equal(restarting ? resolve(args[1]) : manifestPath, manifestPath);
const ownerPath = join(directory, 'r13a-owner.json');
if (!restarting) fs.writeFileSync(ownerPath, JSON.stringify({ probe: 'R13A acceptance', uid: process.getuid(), directory }), { mode: 0o600, flag: 'wx' });
assert.deepEqual(JSON.parse(fs.readFileSync(ownerPath, 'utf8')), { probe: 'R13A acceptance', uid: process.getuid(), directory });
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
const resultPath = join(directory, restarting ? 'r13a-acceptance-restart.json' : 'r13a-acceptance.json');
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
const { holdFocus, emulateFocus, imeInput } = require('./ime-input.cjs');
const { settleViewport } = require('./settle-viewport.cjs');
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
let failureShot;
const fail = async error => { try { await failureShot?.(); } catch { /* best effort */ } result.status = 'FAIL'; result.error = error instanceof Error ? error.stack : typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error); save(); console.error('R13A_ACCEPTANCE_FAIL ' + JSON.stringify({ resultPath, error: result.error })); app.exit(1); };
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


const screens = resolve(root, 'docs/verification/r13a-screens');

async function main() {
  await new Promise(done => fixture.listen(0, '127.0.0.1', done)); port = fixture.address().port;
  const { ProviderRegistry: Registry, settlementClock } = await import(pathToFileURL(entry).href);
  // R13B settles by the time of day (D106); these R13A checks are about the peak cache-miss price, so the fixture
  // clock is pinned to a Beijing weekday peak instant (Friday 2026-10-23 10:00).
  settlementClock.now = () => new Date('2026-10-23T02:00:00.000Z');
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
  await js(`window.__r13a = (name, o = {}) => {
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
  }; true`);
  const point = async (name, options = {}) => until(`(() => { const p = window.__r13a(${JSON.stringify(name)}, ${JSON.stringify(options)}); return p && !p.disabled ? p : null; })()`, 'control ' + name);
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

  // Step 1 (R16 batch 2): connect DeepSeek with the wizard; the address is written above the Key (D113).
  await click('设置'); await click('添加服务');
  check(await js(`document.querySelector('dialog[open] .choice[aria-pressed=true] b').textContent.endsWith('DeepSeek')`), 'DeepSeek is the preselected service');
  await click('下一步');
  check(await js(`document.querySelector('dialog[open] .target').textContent`) === 'Key 只会发往 https://api.deepseek.com', 'The Key target is written above the Key');
  await capture('provider-saved', '设置 › 模型服务 › 添加服务：选 DeepSeek（推荐）后第 2 步写明“Key 只会发往 https://api.deepseek.com”，默认模型 DeepSeek Flash，底部“保存即表示你确认了上面的地址”。', 'dialog[open]');

  // Step 2: save a fake Key (never a real one); 保存并连接 saves it and confirms that address in one step.
  await field('API Key'); await type(fakeKey); await key('Enter');
  await until(`document.body.innerText.includes('DeepSeek 已连接')`, 'key saved');
  check(!(await text()).includes(fakeKey) && await js(`[...document.querySelectorAll('input')].every(e => !e.value.includes(${JSON.stringify(fakeKey)}))`), 'The Key is never echoed in the page');
  check((await text()).includes('DeepSeek Flash 可以用于讨论') && (await text()).includes('请求地址 https://api.deepseek.com 已确认'), 'The check says the model can be used and the address is confirmed');
  await capture('key-saved', '键入假 Key 按 Enter（等同“保存并连接”）：第 3 步写明“已保存……请求地址 https://api.deepseek.com 已确认”“DeepSeek Flash 可以用于讨论（价格已核对）”；DeepSeek 没有免费检查 Key 的接口，如实写“Key 还没有核对”。Key 不回显。已为第一个服务建好房间“我的第一场讨论”。', 'dialog[open]');
  await click('稍后再说');
  await until(`document.body.innerText.includes('可以使用')`, 'service usable');
  check((await text()).includes('官方地址，保存 Key 时已确认'), 'The card says when the address was confirmed');
  await capture('target-confirmed', '回到 设置 › 模型服务：DeepSeek 卡片显示“可以使用”，请求地址“官方地址，保存 Key 时已确认”，API Key“已保存（不显示）”。不再有单独的“确认本次会话目标”一步。', '.svc-card');

  // Step 3: the room made for the first service (D6-A), renamed and down to two DeepSeek members.
  await click('我的第一场讨论', { selector: '.sb-item' });
  await until(`document.querySelector('.room-page')`, 'room page');
  await click('编辑'); await field('房间名称'); await selectAll(); await ime('xiaoyuan', '校园跑腿讨论'); await click('保存');
  await until(`document.querySelector('.room-page h1')?.textContent === '校园跑腿讨论'`, 'room renamed');
  await click('「综合者」：编辑、排序、归档、删除'); await click('删除…', { selector: '[role=menuitem]' }); await click('删除', { scope: 'dialog[open]' });
  await until(`!document.querySelector('dialog[open]') && !document.querySelector('[aria-label="综合者 参与讨论"]')`, 'member removed');
  const roomId = await js(`window.roundtable.rooms.listRooms().then(rooms => rooms.find(room => room.name === '校园跑腿讨论').id)`);
  const members = await js(`window.roundtable.rooms.listAgentConfigurations({ roomId: ${JSON.stringify(roomId)} })`);
  check(members.map(member => member.displayName).join() === '起草者,审查者' && members.every(member => member.modelId === 'deepseek-flash'), 'Two DeepSeek members remain');
  check((await text()).split('DeepSeek Flash · 可以使用').length === 3, 'Each member says DeepSeek Flash can be used');
  await capture('members', '连接后自动建好的“我的第一场讨论”改名为“校园跑腿讨论”（中文由输入法组合输入），删掉综合者，留下起草者、审查者，都写着“DeepSeek Flash · 可以使用”。', '.room-page');

  // Step 4: a budgeted Run; each message shows usage and cost, the header shows spend and what is left.
  await click('新讨论', { scope: '.room-page' });
  await field('讨论目标'); await selectAll(); await ime('sheji', '设计一个校园跑腿平台');
  // R16: the budget is in the settings popover beside the goal.
  await click('更多设置'); await field('本次运行预算（元）'); await selectAll(); await type('0.05');
  await click('开始讨论');
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已完成')`, 'run completed');
  const done = await snapshot();
  check(done.charges.length === 3 && done.charges.every(c => c.state === 'settled' && c.accountedMicro === 648), 'Three settled requests at ¥0.000648 each');
  check(done.budget.limitMicro === 50000 && done.budget.settledMicro === 1944, 'The ¥0.05 budget and its spend');
  // R16: each reply's footer amount opens its usage and price; 本场信息's budget card has the Run totals.
  await js(`document.querySelectorAll('.thread-item .cost').forEach(button => button.click()); true`);
  await until(`document.querySelectorAll('.msg-details').length === 3`, 'request details opened');
  const page4 = await js(`[...document.querySelectorAll('.msg-details')].map(e => e.textContent).join('\\n')`);
  check((page4.match(/输入 300 \/ 输出 6 tokens · 花费 ¥0\.000648/gu) ?? []).length === 3, 'Every message shows its usage and cost');
  const card = await js(`document.querySelector('.budget-card').textContent`);
  check(card.includes('¥0.0019 / ¥0.05') && card.includes('剩余额度¥0.0481'), 'Run budget card totals');
  check(requests.length === 3 && requests.every(r => r.keyMatches && r.thinking?.type === 'disabled' && r.maxTokens === 4096), 'Requests carried the saved Key, max_tokens and thinking disabled');
  await capture('run-usage', '输入任务（输入法）并把"本次预算（元）"改为 0.05 后点"开始讨论"：三条 DeepSeek 回复下方各显示"输入 300 / 输出 6 tokens · 花费 ¥0.000648"；页头下方的预算栏显示"预算 ¥0.0500 · 累计花费 ¥0.0019 · 剩余额度 ¥0.0481"。', '.run-budget');

  // Step 5: an invalid budget is explained and cannot start. D111: a new discussion is the explicit 新讨论 button.
  await click('新讨论', { scope: '.controls' });
  await click('更多设置'); await field('本次运行预算（元）'); await selectAll(); await type('abc');
  check(await js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '开始讨论').disabled`), 'An invalid budget disables 开始讨论');
  check((await text()).includes('请输入 0.000001 到 1000 之间的金额'), 'Invalid budget explained inline');
  await capture('budget-invalid', '预算框输入"abc"：下方提示"请输入 0.000001 到 1000 之间的金额，最多 6 位小数。"，"开始讨论"不可用。', '.composer');

  // Step 6: a budget smaller than one request's maximum cost is refused before anything is sent.
  await field('本次运行预算（元）'); await selectAll(); await type('0.001');
  await field('讨论目标'); await selectAll(); await ime('zaitao', '再讨论一次定价');
  const before = requests.length;
  await click('开始讨论');
  await until(`document.body.innerText.includes('预算不足，已暂停发送') && document.body.innerText.includes('下一次请求最高可能花费')`, 'budget refusal shown');
  const blocked = await snapshot();
  check(requests.length === before && blocked.turns.length === 0 && blocked.status === 'error', 'Zero requests and no Turn when the budget is insufficient');
  check((await text()).includes('剩余额度 ¥0.0010。追加预算后从这里继续') && (await text()).includes('已因预算不足停止发送'), 'Chinese refusal and the bar marker');
  check((await js(`document.querySelector('[role=status][aria-label=运行状态]').textContent`)).includes('已因预算停止') && !(await text()).includes('配置成员后，输入目标并开始讨论'), 'Header says the budget stopped it, with no misleading empty-state hint');
  const required = `¥${(blocked.budget.blocked.requiredMicro / 1e6).toFixed(4)}`;
  await capture('budget-blocked', `预算改为 0.001 元再开始：在发送前拒绝（夹具未收到任何请求、没有新回合），页头状态"已因预算停止"，提示"预算不足，已暂停发送。下一次请求最高可能花费 ${required}，剩余额度 ¥0.0010。追加预算后从这里继续……"（R13B 起提示旁就是"追加并继续"），预算栏标出"已因预算不足停止发送"。实操中发现原来页头写"运行失败"、空时间线还提示"配置成员后…开始讨论"，已改正。`, '.run-budget');

  assert.deepEqual(result.nodeNetworkAttempts, []); assert.deepEqual(result.chromiumNetworkAttempts, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.preloadErrors, []);
  check(!JSON.stringify(result).includes(fakeKey), 'Key absent from the result');
  cdp.detach();
  result.requests = requests; result.status = 'PASS'; save();
  console.log('R13A_ACCEPTANCE_PASS ' + JSON.stringify({ resultPath, checks: result.checks.length, screens: result.screens.length, requests: requests.length, liveApi: false }));
  await new Promise(done => { fixture.closeAllConnections(); fixture.close(done); }); app.quit();
}
save(); main().catch(fail);
