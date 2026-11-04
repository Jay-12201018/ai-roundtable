// Pre-merge quality hands-on acceptance: real mouse/keyboard input (DevTools Input domain) and IME-composed Chinese
// drive the production build: a pasted API Key is stopped in the model ID field, the disabled Key input explains
// itself, the session target is confirmed, a 3-member DeepSeek room runs, Pause is pressed without touching Stop and
// Stop asks before it acts. Only the https://api.deepseek.com transport is redirected to an owned loopback fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, session, safeStorage } = require('electron');

const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === '--restart', 'Usage: electron premerge-quality-acceptance.cjs [--restart private-manifest.json]');
// --restart: the same profile again, after a key-like model ID was written into it the way older builds allowed (D096).
const restarting = args.length === 2;
assert.equal(app.isReady(), false, 'Isolation must precede readiness/Main');
app.commandLine.appendSwitch('use-mock-keychain');
assert.equal(app.commandLine.hasSwitch('use-mock-keychain'), true, 'Chromium Keychain isolation switch missing');
const directory = restarting ? dirname(resolve(args[1])) : fs.mkdtempSync(join(tmpdir(), 'roundtable-premerge-acceptance-'));
assert.ok(basename(directory).startsWith('roundtable-premerge-acceptance-') && fs.realpathSync(dirname(directory)) === fs.realpathSync(tmpdir()), 'Only this probe owned temporary profile is allowed');
assert.ok(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'Profile directory cannot be a symlink');
assert.equal(fs.statSync(directory).uid, process.getuid());
const manifestPath = join(directory, 'premerge-manifest.json');
assert.equal(restarting ? resolve(args[1]) : manifestPath, manifestPath);
const ownerPath = join(directory, 'premerge-owner.json');
if (!restarting) fs.writeFileSync(ownerPath, JSON.stringify({ probe: 'Pre-merge quality acceptance', uid: process.getuid(), directory }), { mode: 0o600, flag: 'wx' });
assert.deepEqual(JSON.parse(fs.readFileSync(ownerPath, 'utf8')), { probe: 'Pre-merge quality acceptance', uid: process.getuid(), directory });
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
  fakeSafeStorage: { replacedMethods: [], encrypt: 0, decrypt: 0 }, mainLog: [], nodeNetworkAttempts: [], chromiumNetworkAttempts: [], consoleErrors: [], preloadErrors: [], checks: [] };
const dbBytes = () => Buffer.concat(['', '-wal', '-shm'].map(suffix => join(paths.userData, 'ai-roundtable.db' + suffix)).filter(file => fs.existsSync(file)).map(file => fs.readFileSync(file)));
const resultPath = join(directory, restarting ? 'premerge-acceptance-restart.json' : 'premerge-acceptance.json');
const save = () => fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
const fake = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'premerge-fixture-only',
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
const fakeKey = 'premerge-fake-deepseek-key';
// Synthetic look-alike of a pasted DeepSeek key, typed into the model ID field; never a real credential.
const pastedKey = 'sk-premerge0fake0key0for0probe0only';
// The fixture's provider usage: inside the byte bound, so a settled request costs 300×2 + 6×8 = 648 micro-CNY.
const usage = { prompt_tokens: 300, completion_tokens: 6 };
const requests = []; let port; let holdNext = false; let lengthNext = false; const held = [];
const fixture = http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ method: req.method, path: req.url, model: body.model, maxTokens: body.max_tokens, thinking: body.thinking, keyMatches: req.headers.authorization === `Bearer ${fakeKey}`, messages: body.messages });
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/deepseek/chat/completions');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
    emit({ id: 'owned-fixture', choices: [{ index: 0, delta: { content: `DeepSeek 夹具回复 ${requests.length}` }, finish_reason: null }] });
    // `lengthNext` makes the next reply stop at the output limit, as DeepSeek reports with finish_reason=length.
    const reason = lengthNext ? 'length' : 'stop'; lengthNext = false;
    const finish = () => {
      if (res.destroyed) return;
      emit({ id: 'owned-fixture', choices: [{ index: 0, delta: {}, finish_reason: reason }] });
      emit({ id: 'owned-fixture', choices: [], usage });
      res.end('data: [DONE]\n\n');
    };
    // A held request stays open (as a slow model would) until the script releases it or the app aborts it.
    if (holdNext) { holdNext = false; held.push(finish); return; }
    setTimeout(finish, 50);
  } catch (error) { fail(error); }
});
const originalRequest = http.request;
http.request = function (url) { const target = new URL(String(url)); assert.equal(target.hostname, '127.0.0.1'); assert.equal(Number(target.port), port); return originalRequest.apply(this, arguments); };
http.get = () => { throw new Error('Unexpected HTTP get'); };
const https = require('node:https'); https.request = https.get = () => { result.nodeNetworkAttempts.push('remote https blocked'); throw new Error('Remote TLS blocked'); };
globalThis.fetch = async () => { result.nodeNetworkAttempts.push('global fetch blocked'); throw new Error('Remote fetch blocked'); };
for (const name of ['ROUNDTABLE_TRIAL_ALLOW_ONCE', 'ROUNDTABLE_TRIAL_PROVIDER_ID']) delete process.env[name];
syncBuiltinESMExports();
let failureShot;
const fail = async error => { try { await failureShot?.(); } catch { /* best effort */ } result.status = 'FAIL'; result.error = error instanceof Error ? error.stack : typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error); save(); console.error('PREMERGE_ACCEPTANCE_FAIL ' + JSON.stringify({ resultPath, error: result.error })); app.exit(1); };
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


const screens = resolve(root, 'docs/verification/premerge-quality-screens');

async function main() {
  await new Promise(done => fixture.listen(0, '127.0.0.1', done)); port = fixture.address().port;
  if (restarting) {
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).status, 'PASS', 'First phase must have passed');
    // Simulate a database written before D096: the pasted key sits in all three model fields.
    const Driver = require('better-sqlite3'); const seed = new Driver(join(paths.userData, 'ai-roundtable.db'));
    seed.prepare('UPDATE providers SET default_model_id=?, custom_models_json=?').run(pastedKey, JSON.stringify([{ id: 'deepseek-flash', name: 'DeepSeek Flash' }, { id: pastedKey, name: 'oops' }]));
    check(seed.prepare('UPDATE agents SET model_id=? WHERE display_name=?').run(pastedKey, '审查者').changes === 1, 'Seeded the reviewer');
    seed.close();
    check(dbBytes().includes(Buffer.from(pastedKey)), 'Before startup the plaintext is in the database file');
    const info = console.info;
    console.info = (...values) => { result.mainLog.push(values.join(' ')); info(...values); };
  }
  const { ProviderRegistry: Registry } = await import(pathToFileURL(entry).href);
  const transport = Registry.prototype.createTransport;
  Registry.prototype.createTransport = function (guard, diagnostics) {
    const send = transport.call(this, guard, diagnostics);
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
  if (!restarting) for (const old of fs.readdirSync(screens)) if (/^\d\d-.*\.png$/u.test(old)) fs.rmSync(join(screens, old));
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
    const label = e => e.getAttribute('aria-label') || (e.tagName !== 'BUTTON' && e.labels?.[0]?.textContent?.trim()) || e.closest('label')?.firstChild?.textContent?.trim() || (e.type === 'checkbox' ? e.closest('label')?.textContent?.trim() : '') || (n => { const c = n.cloneNode(true); c.querySelectorAll('[aria-hidden="true"]').forEach(x => x.remove()); return c.textContent.trim(); })(e);
    let list = [...document.querySelectorAll(o.selector || 'button')].filter(e => visible(e) && (o.prefix ? label(e).startsWith(name) : label(e) === name));
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
  // Clicks at a fixed screen point, the way a host clicks again without moving the mouse.
  const clickAt = async ({ x, y }) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(150);
  };
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
  let shot = restarting ? fs.readdirSync(screens).filter(file => /^\d\d-.*\.png$/u.test(file)).length : 0;
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

  const status = () => js(`document.querySelector('[role=status][aria-label=运行状态]').textContent`);
  const keyField = `document.querySelector('input[type=password]')`;

  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u;
  if (restarting) {
    // Step R1: startup cleared every stored copy and said so without the value.
    check(result.mainLog.includes('已清除 3 处疑似 API Key 的模型 ID'), 'Main logged only the count of cleared places');
    check(!dbBytes().includes(Buffer.from(pastedKey)), 'After startup the plaintext is gone from the database file, WAL and SHM');
    // The earlier discussion, read before the room is opened (opening a room leaves the selected discussion).
    const earlier = await until(`window.roundtable.run.getSnapshot(localStorage.getItem('roundtable.runId')).then(run => run.execution.task)`, 'earlier run restored');
    await click('校园跑腿讨论', { selector: '.sb-item' });
    await until(`document.querySelector('.room-page') && document.body.innerText.includes('审查者')`, 'room loaded');
    const roomText = await text();
    check(roomText.includes('还没选模型，暂时不会参与讨论'), 'The member left without a model is told to choose one');
    check(!roomText.includes(pastedKey), 'The key never reaches the page');
    await capture('purged-member', '把一串合成的 sk- 假值直接写进数据库三处模型 ID（Provider 默认模型、自定义模型、审查者的模型），模拟旧版本留下的数据后重启：启动时已全部清除，日志只记"已清除 3 处疑似 API Key 的模型 ID"，数据库文件（含 WAL/SHM）里再也找不到这串明文。房间页里审查者显示“还没选模型，暂时不会参与讨论 · 去选择”，其他成员不受影响。', '.room-page');
    await click('「审查者」：编辑、排序、归档、删除'); await click('编辑…', { selector: '[role=menuitem]' });
    const option = await js(`[...document.querySelectorAll('dialog[open] option')].find(o => o.value.endsWith('\\u0000deepseek-flash'))?.value`);
    check(Boolean(option), 'deepseek-flash is still offered for the member');
    await choose('模型', option); await click('保存', { scope: 'dialog[open]' });
    await until(`!document.querySelector('dialog[open]') && !document.body.innerText.includes('还没选模型')`, 'reviewer model chosen again');
    await capture('purged-member-fixed', '在成员菜单里点“编辑…”，给审查者重新选 DeepSeek 直连 · DeepSeek Flash 并保存：提示消失，成员恢复可用。', '.room-page');
    await click('设置');
    await until(`document.querySelector('.svc-card') && document.body.innerText.includes('deepseek-flash')`, 'service card');
    const purged = await js(`window.roundtable.settings.listProviderSummaries().then(list => window.roundtable.settings.getProviderConfiguration({ id: list[0].id }))`);
    check(purged.defaultModelId === null && JSON.stringify(purged.customModels) === JSON.stringify([{ id: 'deepseek-flash', name: 'DeepSeek Flash' }]), 'The default model is empty and only deepseek-flash remains after the purge');
    check(!(await text()).includes(pastedKey) && !(await text()).includes('已经隐藏'), 'Nothing key-like is left to hide');
    await capture('purged-provider', '设置 › 模型服务：DeepSeek 直连的默认模型已被清空，自定义模型里那条疑似 Key 的条目已删除，只剩 deepseek-flash；页面上没有任何密钥文本。', '.svc-card');
    // Step R2: the earlier Run's members are named by their Provider, never by its UUID.
    await click('校园跑腿讨论', { selector: '.sb-item' });
    const runAt = await until(`(() => { const e = [...document.querySelectorAll('.sb-runs .sb-item')].find(e => e.textContent.startsWith(${JSON.stringify(earlier)})); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, 'earlier run listed');
    await clickAt(runAt);
    // R16: the identity line names the model; the service is in each message's 请求详情.
    await until(`document.querySelectorAll('.thread-item [aria-label=请求详情]').length > 0`, 'earlier run shown');
    await js(`document.querySelectorAll('.thread-item [aria-label=请求详情]').forEach(button => button.click()); true`);
    const lines = await until(`(() => { const lines = [...document.querySelectorAll('.msg-details')].map(node => node.textContent); return lines.length ? lines : null; })()`, 'request details');
    check(lines.every(line => line.includes('服务DeepSeek 直连') && !uuidPattern.test(line)), 'Request details name the Provider, not its UUID');
    check(!uuidPattern.test(await text()), 'No UUID anywhere on the discussion page');
    await capture('provider-name', '重启后打开上一次运行（成员快照冻结的是 Provider ID）：每条消息的身份行显示"Drafter · Provider：DeepSeek 直连 · Model：deepseek-flash"，不再显示 UUID。Provider 找不到时显示"Provider 已删除"（单元测试覆盖）。', 0);
  } else {
  // Step 1 (D096, R16 batch 2): in the connect wizard, a pasted API Key in the model name is flagged at once and cannot be saved.
  await click('设置'); await click('添加服务');
  await click('自定义服务', { selector: '.choice', prefix: true });
  await field('服务名称'); await selectAll(); await ime('deepseek', 'DeepSeek 直连');
  await field('地址'); await type('https://api.deepseek.com');
  check(await js(`document.querySelector('dialog[open] .target').textContent`) === 'Key 只会发往 https://api.deepseek.com', 'The typed address is written above the Key');
  await field('模型名'); await type(pastedKey);
  check((await text()).includes('这看起来是 API Key，不是模型名。Key 请填在「API Key」一栏；这里只填模型名，例如 deepseek-flash。'), 'A pasted key is flagged at once in Chinese');
  check(await js(`[...document.querySelectorAll('input')].find(e => e.labels?.[0]?.textContent === '模型名').getAttribute('aria-invalid')`) === 'true', 'The field is marked invalid');
  await field('API Key'); await type(fakeKey);
  await click('保存', { scope: 'dialog[open] .modal-foot' });
  check((await js('window.roundtable.settings.listProviderSummaries()')).length === 0, 'Saving is refused: no Provider was created');
  check(await js(`[...document.querySelectorAll('input')].every(e => e.value !== ${JSON.stringify(fakeKey)})`), 'The refused attempt cleared the Key field');
  await capture('model-id-key-blocked', '连接向导 › 自定义服务：在“模型名”里误填了一串 sk- 开头的内容（合成的假值）：输入框立即标红，提示“这看起来是 API Key，不是模型名。Key 请填在「API Key」一栏……”；点“保存并连接”被拒绝，没有创建服务，Key 输入框也已清空。上方写明“Key 只会发往 https://api.deepseek.com”。', 'dialog[open]');

  // Step 2: the right model name; the address the Key goes to stays written right above the Key.
  await field('模型名'); await selectAll(); await type('deepseek-flash');
  check(!(await text()).includes('这看起来是 API Key'), 'The warning clears once a model name is typed');
  await capture('key-blocked-reason', '改成 deepseek-flash 后提示消失。Key 只有一个入口：“Key 只会发往 https://api.deepseek.com”写在 API Key 上方。', 'dialog[open]');

  // Step 3: the Key is typed and saved with Enter; that is the last step, and the first discussion is right there (D136).
  await field('API Key'); await type(fakeKey); await key('Enter');
  await until(`document.body.innerText.includes('这场讨论要解决什么？')`, 'key saved');
  check(!(await text()).includes(fakeKey), 'The Key is never echoed in the page');
  await capture('key-saved-last-step', '按 Enter 保存：向导关闭，直接到第一场讨论，房间和三位成员已经建好。');

  // Step 4: the service card says it is ready; nothing is asked again at the next launch (D136).
  await click('设置');
  await until(`document.body.innerText.includes('可以使用')`, 'service ready');
  check((await text()).includes('已保存（不显示）'), 'The card says the Key is saved and does not show it');
  await capture('session-confirmed', '设置 › 模型服务：“DeepSeek 直连 · 可以使用”，API Key“已保存（不显示）”。');

  // Step 5: the room made for the first service (D6-A), renamed; three DeepSeek members.
  await click('我的第一场讨论', { selector: '.sb-item' });
  await until(`document.querySelector('.room-page')`, 'room page');
  await click('编辑'); await field('房间名称'); await selectAll(); await ime('xiaoyuan', '校园跑腿讨论'); await click('保存');
  await until(`document.querySelector('.room-page h1')?.textContent === '校园跑腿讨论'`, 'room renamed');
  check((await text()).split('deepseek-flash · 可以使用').length === 4, 'Three members on deepseek-flash, each usable');
  await capture('members', '连接后自动建好的房间改名为“校园跑腿讨论”（输入法组合输入）：起草者、审查者、综合者三位成员都写着“DeepSeek Flash · 可以使用”。', '.room-page');

  // Step 6: start, then pause without moving the pointer: 开始讨论 turns into 暂停 at the same spot.
  await click('新讨论', { scope: '.room-page' });
  await field('讨论目标'); await selectAll(); await ime('sheji', '设计一个校园跑腿平台');
  check(!(await js(`document.querySelector('label.chip-check input').checked`)), 'Step-by-step is off by default');
  holdNext = true;
  // Where the host's pointer rests after clicking 开始讨论; measured without scrolling, never re-aimed afterwards.
  const startAt = await js(`(() => { const r = document.querySelector('.composer .controls .slot').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  check(await js(`document.elementFromPoint(${startAt.x}, ${startAt.y})?.closest('button')?.textContent`) === '开始讨论', 'The slot under the pointer is 开始讨论');
  await clickAt(startAt);
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('运行中') && document.querySelectorAll('.thread-item').length === 1`, 'first reply streaming');
  check(requests.length === 1 && held.length === 1, 'The first request is in flight');
  check(await js(`document.elementFromPoint(${startAt.x}, ${startAt.y})?.closest('button')?.textContent`) === '暂停', 'Under the unmoved pointer, 开始讨论 has become 暂停');
  // R16 design: 停止 first, red and set apart; then 下一步 and the 暂停/继续 slot where the host just clicked.
  check(await js(`[...document.querySelector('[aria-label=运行控制]').querySelectorAll('button')].map(b => b.textContent).join('|')`) === '停止|下一步|暂停', 'The in-place bar is 停止 (apart), 下一步, then 暂停 in the start slot');
  check(await js(`![...document.querySelectorAll('.run-panel button')].some(b => ['暂停', '继续', '下一步', '停止'].includes(b.textContent))`), 'The side panel has no second set of run buttons');
  await clickAt(startAt);
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('正在暂停')`, 'pausing');
  check(!(await js(`Boolean(document.querySelector('[aria-label=确认停止运行]'))`)), 'Pause never opens the Stop confirmation');
  await capture('pause-in-place', '点“开始讨论”后鼠标不动，第一位成员开始输出时在原位置再点一下：那里已经原地变成“暂停”，页头变为“正在暂停”，当前回合继续说完。控制条依次是 暂停、下一步、停止；停止在末尾、与前两个隔开、红色描边。右侧主持人面板不再有第二套运行按钮。', '.topbar');
  held.shift()();
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已暂停')`, 'paused');
  const paused = await snapshot();
  check(paused.status === 'paused' && paused.usage.length === 1 && paused.usage[0].state === 'reported', 'Pause finished the turn and recorded its usage; nothing was stopped');
  check(await js(`document.elementFromPoint(${startAt.x}, ${startAt.y})?.closest('button')?.textContent`) === '继续', 'Paused, the same spot offers 继续');

  // Step 7: continue from the same spot; while the reviewer is speaking, Stop asks first without covering Pause.
  holdNext = true;
  await clickAt(startAt);
  await until(`document.querySelectorAll('.thread-item').length === 2 && document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('运行中')`, 'second reply streaming');
  await click('停止');
  const confirmText = await js(`document.querySelector('[aria-label=确认停止运行]')?.textContent ?? ''`);
  check(confirmText.includes('已生成的部分文字会保留') && confirmText.includes('服务商可能已经计入用量'), 'The confirmation explains partial output and possible charges');
  check((await snapshot()).status === 'running', 'The first click on Stop sends nothing');
  check(await js(`document.activeElement?.textContent === '不停止'`), 'Focus rests on the safe choice');
  check(await js(`!document.elementFromPoint(${startAt.x}, ${startAt.y})?.closest('button')?.disabled && document.elementFromPoint(${startAt.x}, ${startAt.y})?.closest('button')?.textContent === '暂停'`), 'The confirmation does not cover or disable 暂停');
  await capture('stop-confirm', '“继续”同样在原位置；审查者输出中点控制条末尾的“停止”：控制条下方出现轻量确认——“停止会立即中止当前回合，并结束本次运行。已生成的部分文字会保留；这次请求已经发出，可能已经计费，无法确认用量时按预留上限计入本次花费。”以及“停止讨论”“不停止”（焦点在“不停止”）。“暂停”仍在原处可用，运行仍是“运行中”。', '.composer');
  await click('不停止');
  check(!(await js(`Boolean(document.querySelector('[aria-label=确认停止运行]'))`)) && (await status()).includes('运行中'), '不停止 keeps the Run going');
  await click('停止'); await click('停止讨论');
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已停止')`, 'stopped');
  const stopped = await snapshot();
  check((await text()).includes('重试和续写会重新发送请求，可能再次计费。'), 'Retry and continue warn that they may bill again');
  check(stopped.status === 'cancelled' && stopped.messages[1].status === 'aborted' && stopped.messages[1].content.length > 0, 'Stop kept the partial reply');
  check(stopped.usage.find(c => c.requestId === stopped.attempts.find(a => a.messageId === stopped.messages[1].id).requestId).state === 'unknown', 'The stopped request is recorded as an unknown charge, not zero');
  // Settled: no run controls; the slot offers 新讨论 (the box still takes an interjection for a retry).
  check(await js(`document.elementFromPoint(${startAt.x}, ${startAt.y})?.closest('button')?.textContent`) === '新讨论', 'Settled, the slot offers 新讨论');
  await capture('stopped', '点“不停止”后运行继续；再点“停止”并“停止讨论”：页头“已停止”，审查者已输出的部分文字保留并标为“已中止”，这次请求在预算栏按未知费用（预留上限）计入、不记为 0。输入区原位置变回“开始讨论”；右侧“重试当前回合”“续写部分回复”下方提示“重试和续写会重新发送请求，可能再次计费。”', '.topbar');
  const reviewer = requests[1].messages;

  // Step 8: step-by-step from the start — pause after each turn, interject, then 下一步.
  await click('新讨论', { scope: '.controls' });
  await click('每回合后暂停', { selector: 'input[type=checkbox]' });
  check(await js(`document.querySelector('label.chip-check input').checked`), 'Step-by-step checked');
  await field('讨论目标'); await selectAll(); await ime('dingjia', '讨论跑腿平台的定价');
  await capture('step-option', '开始前在输入区勾选“每个回合结束后暂停，方便插话或点名”（默认不勾选，勾选后会记住），任务改为“讨论跑腿平台的定价”（输入法输入）。', '.composer');
  const before = requests.length;
  await clickAt(startAt);
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已暂停') && document.querySelectorAll('.thread-item').length === 1`, 'auto-paused after the first turn');
  const stepRun = await snapshot();
  check(requests.length === before + 1 && stepRun.status === 'paused' && stepRun.turns.length === 1, 'Exactly one turn ran, then the Run paused by itself');
  await field('主持人插话'); await ime('qingzhongdian', '请重点比较按距离计价和固定价');
  await click('发送插话');
  await until(`document.querySelectorAll('.thread-item').length === 2`, 'interjection shown');
  await capture('step-paused-interject', '开始后第一位成员（起草者）说完，运行自动暂停（页头“已暂停”），没有和模型抢时间；在右侧“插话”里用输入法输入“请重点比较按距离计价和固定价”并发送，插话出现在时间线上。输入区提示：可以在“主持人控制”里插话或点名，然后点“下一步”让下一位发言，或点“继续”自动运行。', '.topbar');
  await click('下一步');
  await until(`document.querySelectorAll('.thread-item').length === 3 && document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已暂停')`, 'stepped once');
  check(requests.length === before + 2, 'One step sends exactly one request');
  check(requests.at(-1).messages.at(-1).content.includes('【主持人插话】\n> 请重点比较按距离计价和固定价'), 'The next speaker received the interjection as a host entry');
  await capture('step-next', '点“下一步”：只让下一位（审查者）发言一次，说完再次自动暂停；它收到的上下文里包含刚才的主持人插话（脚本核对了请求体）。右侧显示"下一位：综合者（按计划）"，输入区仍是 继续 / 下一步 / 停止。', 2);

  // Step 9 (D103): finish the step-by-step Run from the same in-place control, then set the output limit, which is
  // folded under 更多设置 ; here it becomes 2048.
  await click('继续');
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已完成')`, 'step-by-step run finished');
  // D111: a finished discussion is continued from its box; a new one is the explicit 新讨论 button.
  await click('新讨论', { scope: '.controls' });
  await click('每回合后暂停', { selector: 'input[type=checkbox]' });
  check(!(await js(`document.querySelector('label.chip-check input').checked`)), 'Back to automatic');
  check(!(await js(`Boolean(document.querySelector('[role=group][aria-label=更多设置]'))`)), '更多设置 starts folded');
  const startSpot = await js(`(() => { const r = document.querySelector('.composer .controls .slot').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await click('更多设置');
  await field('单次输出上限（token）'); await selectAll(); await type('2048');
  await field('讨论目标'); await selectAll(); await ime('jieduan', '比较三种跑腿定价方案');
  check(await js(`document.elementFromPoint(${startSpot.x}, ${startSpot.y})?.closest('button')?.textContent`) === '开始讨论', 'Opening 更多设置 does not move 开始讨论');
  await capture('output-limit', '开始前点输入区的"更多设置"：在控制行上方展开"单次输出上限（token）"（默认 8192，这里改为 2048），"开始讨论"位置不变；并说明"每次请求按这个上限预留费用，实际按用量结算；回复写到上限会保留并标注，可以续写。不能超过成员所用模型允许的最大值（DeepSeek Flash 为 32768）"。平时收起，不占常用路径。', '.composer');

  // Step 10 (D102): the first reply stops at the output limit; it is kept and marked, and the Run goes on.
  const beforeTruncation = requests.length;
  lengthNext = true;
  await click('开始讨论');
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已完成') && document.querySelectorAll('.thread-item').length === 3`, 'run completed after a truncated reply');
  const finished = await snapshot();
  check(requests.length === beforeTruncation + 3 && requests.slice(beforeTruncation).every(r => r.maxTokens === 2048), 'Three requests, each with max_tokens 2048');
  const firstTurn = finished.turns[0];
  check(finished.turns.every(t => t.status === 'completed') && finished.attempts.find(a => a.messageId === firstTurn.messageId).finishReason === 'length', 'The truncated Turn completed and the Run went on');
  check(finished.usage.length === 3 && finished.usage.every(c => c.state === 'reported'), 'Every request, the truncated one included, has its usage');
  check(requests[beforeTruncation + 1].messages.at(-1).content.includes('（此发言因单次输出上限被截断，后面的内容没有写完，可能不完整。）'), 'The next member was told the reply is unfinished');
  check((await js(`document.querySelectorAll('.thread-item')[0].innerText`)).includes('写到单次上限停下了') && !(await text()).includes('运行失败'), 'The truncated reply is marked, never shown as a failure');
  await capture('truncated', 'DeepSeek 夹具让起草者的回复以 finish_reason=length 结束：这条回复保留并标注"已达单次输出上限，内容可能不完整。"，下方有"续写"；运行没有失败，审查者和综合者照常发言，页头"已完成"。脚本核对了审查者收到的上下文里这条发言带有"（此发言因单次输出上限被截断，后面的内容没有写完，可能不完整。）"，三次请求都按用量结算。', 0);

  // Step 11 (D102): 续写 continues it as a new version with its own request and usage.
  const original = finished.messages.find(m => m.id === firstTurn.messageId).content;
  await click('续写', { slot: 0 });
  await until(`(async () => { const s = await window.roundtable.run.getSnapshot(localStorage.getItem('roundtable.runId'));
    return !s.host?.generation && s.versions.filter(v => v.slotId === ${JSON.stringify(firstTurn.turnId)}).length === 2; })()`, 'continuation finished');
  const extended = await snapshot();
  const slotVersions = extended.versions.filter(v => v.slotId === firstTurn.turnId);
  const continuation = requests.at(-1).messages;
  check(continuation.at(-2).role === 'assistant' && continuation.at(-2).content === original && continuation.at(-1).content === 'Continue the previous response from where it stopped.', 'The continuation sends the kept text and asks to continue');
  check(slotVersions[1].origin === 'continue' && slotVersions[1].active && extended.messages.find(m => m.id === slotVersions[1].messageId).content.startsWith(original), 'The continuation is the new effective version and starts from the kept text');
  check(extended.usage.length === 4 && extended.usage.every(c => c.state === 'reported'), 'The continuation is its own request with its own usage');
  await capture('continued', '运行结束后点"续写"：发出新请求（携带原回复并请求接着写），生成"续写 · 当前有效 · 版本 2/2"，内容从原来的文字接着写、不再标注截断；原版本保留为版本 1，后面两条发言标为"受影响"，可按需重新生成。', 0);

  // The reviewer saw the drafter's reply as quoted discussion on the user side, never as its own assistant turn.
  check(reviewer.filter(m => m.role !== 'system').map(m => m.role).join(',') === 'user', 'The reviewer request has one user block and no assistant message');
  check(reviewer.at(-1).content.includes('【成员「起草者」· 起草】\n> DeepSeek 夹具回复 1') && reviewer.at(-1).content.includes('现在由你（成员「审查者」· 审查）发言'), 'Labelled, quoted drafter reply and the turn cue');
  check(requests.every(r => r.keyMatches && r.model === 'deepseek-flash' && r.thinking === undefined), 'Requests carried the saved Key, the approved model and thinking disabled');
  result.reviewerMessages = reviewer;

  await js(`document.querySelectorAll('.thread-item [aria-label=请求详情]').forEach(button => button.click()); true`);
  const identityLines = await until(`(() => { const lines = [...document.querySelectorAll('.msg-details')].map(node => node.textContent); return lines.length ? lines : null; })()`, 'request details');
  check(identityLines.every(line => line.includes('服务DeepSeek 直连') && !uuidPattern.test(line)), 'Request details name the Provider, not its UUID');
  fs.writeFileSync(manifestPath, JSON.stringify({ status: 'PASS' }) + '\n', { mode: 0o600 });
  }
  assert.deepEqual(result.nodeNetworkAttempts, []); assert.deepEqual(result.chromiumNetworkAttempts, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.preloadErrors, []);
  check(!JSON.stringify(result).includes(fakeKey) && !JSON.stringify(result).includes(pastedKey), 'Neither key appears in the result');
  cdp.detach();
  result.requests = requests.map(({ messages: _messages, ...rest }) => rest); result.status = 'PASS'; save();
  console.log('PREMERGE_ACCEPTANCE_PASS ' + JSON.stringify({ resultPath, checks: result.checks.length, screens: result.screens.length, requests: requests.length, liveApi: false }));
  await new Promise(done => { fixture.closeAllConnections(); fixture.close(done); }); app.quit();
}
save(); main().catch(fail);
