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
assert.ok(args.length === 0, 'Usage: electron premerge-quality-acceptance.cjs');
const restarting = false;
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
  fakeSafeStorage: { replacedMethods: [], encrypt: 0, decrypt: 0 }, nodeNetworkAttempts: [], chromiumNetworkAttempts: [], consoleErrors: [], preloadErrors: [], checks: [] };
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
const fakeKey = 'premerge-fake-deepseek-key';
// Synthetic look-alike of a pasted DeepSeek key, typed into the model ID field; never a real credential.
const pastedKey = 'sk-premerge0fake0key0for0probe0only';
// The fixture's provider usage: inside the byte bound, so a settled request costs 300×2 + 6×8 = 648 micro-CNY.
const usage = { prompt_tokens: 300, completion_tokens: 6 };
const requests = []; let port; let holdNext = false; const held = [];
const fixture = http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ method: req.method, path: req.url, model: body.model, maxTokens: body.max_tokens, thinking: body.thinking, keyMatches: req.headers.authorization === `Bearer ${fakeKey}`, messages: body.messages });
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/deepseek/chat/completions');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
    emit({ id: 'owned-fixture', choices: [{ index: 0, delta: { content: `DeepSeek 夹具回复 ${requests.length}` }, finish_reason: null }] });
    const finish = () => {
      if (res.destroyed) return;
      emit({ id: 'owned-fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
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
for (const name of ['ROUNDTABLE_CONNECT_PROXY', 'ROUNDTABLE_TRUST_PROXY_DNS', 'ROUNDTABLE_TRIAL_ALLOW_ONCE', 'ROUNDTABLE_TRIAL_PROVIDER_ID']) delete process.env[name];
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
  const { ProviderRegistry: Registry } = await import(pathToFileURL(entry).href);
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
  // Locates a visible control by accessible name (aria-label, own text or enclosing label) and scrolls it into view.
  await js(`window.__r13a = (name, o = {}) => {
    const visible = e => e && !e.closest('[hidden]') && e.getClientRects().length > 0;
    const label = e => e.getAttribute('aria-label') || e.closest('label')?.firstChild?.textContent?.trim() || (e.type === 'checkbox' ? e.closest('label')?.textContent?.trim() : '') || e.textContent.trim();
    let list = [...document.querySelectorAll(o.selector || 'button')].filter(e => visible(e) && label(e) === name);
    if (o.slot !== undefined) { const slot = document.querySelectorAll('.message')[o.slot]; list = list.filter(e => slot && slot.contains(e)); }
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
  const selectAll = () => key('a', 4);
  // Chinese text arrives the way an IME delivers it: a composition (pinyin) that is then committed.
  const ime = async (pinyin, committed) => {
    await send('Input.imeSetComposition', { text: pinyin, selectionStart: pinyin.length, selectionEnd: pinyin.length });
    await sleep(120);
    await send('Input.insertText', { text: committed });
    await sleep(120);
  };
  let shot = 0;
  const capture = async (name, caption, focus) => {
    if (typeof focus === 'number') await js(`document.querySelectorAll('.message')[${focus}]?.scrollIntoView({ block: 'center' }); true`);
    else if (focus) await js(`document.querySelector(${JSON.stringify(focus)})?.scrollIntoView({ block: 'center' }); true`);
    await sleep(350);
    const file = `${String(++shot).padStart(2, '0')}-${name}.png`;
    fs.writeFileSync(join(screens, file), (await contents.capturePage()).toPNG());
    result.screens.push({ file, caption });
  };

  result.screens = [];
  const text = () => js('document.body.innerText');
  // A native <select> opens an OS popup that page input events cannot drive; it is set like a user's pick (focus + change).
  const choose = (name, value) => js(`(() => { const e = [...document.querySelectorAll('select')].find(e => e.closest('label')?.firstChild?.textContent?.trim() === ${JSON.stringify(name)});
    e.focus(); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; })()`);
  const type = text => send('Input.insertText', { text }).then(() => sleep(120));
  const snapshot = () => js(`window.roundtable.run.getSnapshot(localStorage.getItem('roundtable.runId'))`);

  const status = () => js(`document.querySelector('.timeline .status').textContent`);
  const keyField = `document.querySelector('input[type=password]')`;

  // Step 1: a pasted API Key in the model ID field is flagged at once and cannot be saved.
  await click('模型设置'); await click('新增 Provider');
  await field('Provider 名称'); await ime('deepseek', 'DeepSeek 直连');
  check(await choose('Provider 类型', 'openai-compatible') === 'openai-compatible', 'Provider type OpenAI-Compatible');
  await field('Base URL'); await type('https://api.deepseek.com');
  await click('我已核对请求目标', { selector: 'input[type=checkbox]' });
  check(await js(`document.getElementById('settings-default-model-help').textContent`) === '例如 deepseek-flash', 'The model ID field shows an example before anything is typed');
  await field('默认模型 ID'); await type(pastedKey);
  check((await text()).includes('这看起来是 API Key，不是模型 ID。请先删掉它；保存配置后，在下方出现的“API Key”输入框里填写。'), 'A pasted key is flagged at once in Chinese');
  check(await js(`document.querySelector('[aria-describedby=settings-default-model-help]').getAttribute('aria-invalid')`) === 'true', 'The field is marked invalid');
  await click('保存配置');
  check((await js(`document.querySelector('.settings-editor h2').textContent`)) === '新增 Provider' && (await js('window.roundtable.settings.listProviderSummaries()')).length === 0, 'Saving is refused: no Provider was created');
  await capture('model-id-key-blocked', '在“默认模型 ID”里误填了一串 sk- 开头的内容（合成的假值）：输入框立即标红，下方提示“这看起来是 API Key，不是模型 ID。请先删掉它；保存配置后，在下方出现的“API Key”输入框里填写。”；点“保存配置”被拒绝，没有创建 Provider。输入框下方原本显示示例“例如 deepseek-flash”。', '#settings-default-model-help');

  // Step 2: the right model ID saves; the Key input explains why it is unavailable and how to fix it.
  await field('默认模型 ID'); await selectAll(); await type('deepseek-flash');
  check(!(await text()).includes('这看起来是 API Key'), 'The warning clears once a model ID is typed');
  await field('新增模型 ID'); await type('deepseek-flash'); await field('新增模型名称'); await type('DeepSeek Flash');
  await click('添加自定义模型');
  await click('保存配置');
  await until(`document.body.innerText.includes('编辑 Provider')`, 'provider saved');
  check(await js(`${keyField}.disabled`), 'After saving, the Key input is unavailable until the target is checked');
  check((await js(`document.getElementById('settings-key-blocked').textContent`)).includes('输入框暂不可用：填写 Key 之前，请先核对 Key 将发往的请求目标：https://api.deepseek.com/'), 'The reason sits right next to the Key input');
  check((await js(`${keyField}.getAttribute('aria-describedby')`)).includes('settings-key-blocked'), 'The reason is announced with the input');
  check((await js(`document.querySelector('.settings-progress').textContent`)).includes('下一步：在下方“API Key”一栏核对请求目标并填写 Key。'), 'The progress line names the next step');
  await capture('key-blocked-reason', '保存配置后，“API Key”输入框不可用。紧挨着输入框说明原因：“输入框暂不可用：填写 Key 之前，请先核对 Key 将发往的请求目标：https://api.deepseek.com/”，并给出一键操作“目标无误，启用输入框”。（编辑页顶部另有“接入进度”，此时写着“下一步：在下方“API Key”一栏核对请求目标并填写 Key。”，见第 4 张截图的位置。）', '#settings-key-blocked');

  // Step 3: one click enables and focuses the input; the Key is typed and saved with Enter.
  await click('目标无误，启用输入框');
  await until(`!${keyField}.disabled && document.activeElement === ${keyField}`, 'key input enabled and focused');
  check(await js(`[...document.querySelectorAll('input[type=checkbox]')].find(e => e.closest('label')?.textContent.trim() === '我已核对请求目标').checked`), 'The one click is the same target check as the checkbox');
  await type(fakeKey); await key('Enter');
  await until(`document.body.innerText.includes('已配置；系统安全存储。')`, 'key saved');
  check(!(await text()).includes(fakeKey), 'The Key is never echoed in the page');
  check((await text()).includes('最后一步：确认本次会话的请求目标 https://api.deepseek.com/。'), 'The last step appears under the Key');
  check(!(await text()).includes('输入框暂不可用'), 'Only one next step is shown once the Key is saved');
  await capture('key-saved-last-step', '点“目标无误，启用输入框”：输入框立即可用并获得焦点，“我已核对请求目标”同时被勾选。键入假 Key 按 Enter 保存后显示“已配置；系统安全存储。”（Key 不回显）。Key 下方只出现一个下一步：“最后一步：确认本次会话的请求目标 https://api.deepseek.com/……”和按钮“目标无误，确认本次会话”。（首轮实操时这里同时出现了“输入框暂不可用”和“最后一步”两个提示，已改为只显示一个。）', '.settings-section');

  // Step 4: confirm the session target right there.
  await click('目标无误，确认本次会话');
  await until(`document.querySelector('.settings-progress').textContent.includes('本次会话目标：已确认')`, 'session confirmed');
  check((await text()).includes('已就绪：房间成员可以向此 Provider 发送真实请求'), 'Progress says the Provider is ready');
  check(!(await text()).includes('最后一步'), 'The last-step box goes away');
  await capture('session-confirmed', '点“目标无误，确认本次会话”：接入进度三项都变为完成——配置已保存、API Key 已配置、本次会话目标已确认，并写明“已就绪：房间成员可以向此 Provider 发送真实请求（仍受模型审核和运行预算限制）”。整个“新增 Provider → 填 Key → 确认会话目标”在一屏内完成。', '.settings-progress');

  // Step 5: a room with three DeepSeek members.
  await click('返回讨论'); await click('房间与成员'); await click('新建房间');
  await field('房间名称'); await ime('xiaoyuan', '校园跑腿讨论'); await click('保存房间');
  await until(`document.body.innerText.includes('新增成员')`, 'room saved');
  for (const [index, [pinyin, name, role]] of [['qicao', '起草者', 'Drafter'], ['shencha', '审查者', 'Critic'], ['zonghe', '综合者', 'Synthesizer']].entries()) {
    await click('新增成员');
    await field('成员名称'); await ime(pinyin, name);
    await field('成员角色'); await type(role);
    const providerValue = await js(`[...document.querySelectorAll('option')].find(o => o.textContent.startsWith('DeepSeek 直连'))?.value`);
    await choose('Provider', providerValue);
    check(await js(`document.querySelector('input[list]').value`) === 'deepseek-flash', 'Choosing the Provider pre-fills its default model ' + index);
    await click('保存成员');
    await until(`!document.querySelector('dialog[open], .rooms-dialog') && document.body.innerText.split('${name}').length > 1`, 'member saved ' + index);
  }
  await capture('members', '新建房间“校园跑腿讨论”，添加“起草者（Drafter）”“审查者（Critic）”“综合者（Synthesizer）”三个成员，Provider 均为“DeepSeek 直连”，Model 自动带出 deepseek-flash。', '.rooms-feature');

  // Step 6: start, then pause without moving the pointer: 开始协作 turns into 暂停 at the same spot.
  await click('讨论');
  await field('任务目标'); await selectAll(); await ime('sheji', '设计一个校园跑腿平台');
  await field('本次运行预算（元）'); await selectAll(); await type('0.05');
  check(!(await js(`document.querySelector('.composer-step input').checked`)), 'Step-by-step is off by default');
  holdNext = true;
  // Where the host's pointer rests after clicking 开始协作; measured without scrolling, never re-aimed afterwards.
  const startAt = await js(`(() => { const r = [...document.querySelectorAll('.composer-actions button')].find(b => b.textContent === '开始协作').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await clickAt(startAt);
  await until(`document.querySelector('.timeline .status').textContent.includes('运行中') && document.querySelectorAll('.message').length === 1`, 'first reply streaming');
  check(requests.length === 1 && held.length === 1, 'The first request is in flight');
  check(await js(`document.elementFromPoint(${startAt.x}, ${startAt.y})?.closest('button')?.textContent`) === '暂停', 'Under the unmoved pointer, 开始协作 has become 暂停');
  check(await js(`[...document.querySelector('[aria-label=运行控制]').querySelectorAll('button')].map(b => b.textContent).join('|')`) === '暂停|下一步|停止', 'The in-place bar is 暂停, 下一步, then 停止 at the end');
  check(await js(`![...document.querySelectorAll('#host-controls button')].some(b => ['暂停', '继续', '下一步', '停止'].includes(b.textContent))`), 'The side panel has no second set of run buttons');
  await clickAt(startAt);
  await until(`document.querySelector('.timeline .status').textContent.includes('正在暂停')`, 'pausing');
  check(!(await js(`Boolean(document.querySelector('[aria-label=确认停止运行]'))`)), 'Pause never opens the Stop confirmation');
  await capture('pause-in-place', '点“开始协作”后鼠标不动，第一位成员开始输出时在原位置再点一下：那里已经原地变成“暂停”，页头变为“正在暂停”，当前回合继续说完。控制条依次是 暂停、下一步、停止；停止在末尾、与前两个隔开、红色描边。右侧主持人面板不再有第二套运行按钮。', '.app-navigation');
  held.shift()();
  await until(`document.querySelector('.timeline .status').textContent.includes('已暂停')`, 'paused');
  const paused = await snapshot();
  check(paused.status === 'paused' && paused.charges.length === 1 && paused.charges[0].state === 'settled', 'Pause finished the turn and settled its request; nothing was stopped');
  check(await js(`document.elementFromPoint(${startAt.x}, ${startAt.y})?.closest('button')?.textContent`) === '继续', 'Paused, the same spot offers 继续');

  // Step 7: continue from the same spot; while the reviewer is speaking, Stop asks first without covering Pause.
  holdNext = true;
  await clickAt(startAt);
  await until(`document.querySelectorAll('.message').length === 2 && document.querySelector('.timeline .status').textContent.includes('运行中')`, 'second reply streaming');
  await click('停止');
  const confirmText = await js(`document.querySelector('[aria-label=确认停止运行]')?.textContent ?? ''`);
  check(confirmText.includes('已生成的部分文字会保留') && confirmText.includes('可能已经计费'), 'The confirmation explains partial output and possible charges');
  check((await snapshot()).status === 'running', 'The first click on Stop sends nothing');
  check(await js(`document.activeElement?.textContent === '不停止'`), 'Focus rests on the safe choice');
  check(await js(`!document.elementFromPoint(${startAt.x}, ${startAt.y})?.closest('button')?.disabled && document.elementFromPoint(${startAt.x}, ${startAt.y})?.closest('button')?.textContent === '暂停'`), 'The confirmation does not cover or disable 暂停');
  await capture('stop-confirm', '“继续”同样在原位置；审查者输出中点控制条末尾的“停止”：控制条下方出现轻量确认——“停止会立即中止当前回合，并结束本次运行。已生成的部分文字会保留；这次请求已经发出，可能已经计费，无法确认用量时按预留上限计入本次花费。”以及“确认停止”“不停止”（焦点在“不停止”）。“暂停”仍在原处可用，运行仍是“运行中”。', '.composer');
  await click('不停止');
  check(!(await js(`Boolean(document.querySelector('[aria-label=确认停止运行]'))`)) && (await status()).includes('运行中'), '不停止 keeps the Run going');
  await click('停止'); await click('确认停止');
  await until(`document.querySelector('.timeline .status').textContent.includes('已停止')`, 'stopped');
  const stopped = await snapshot();
  check((await text()).includes('重试和续写会重新发送请求，可能再次计费。'), 'Retry and continue warn that they may bill again');
  check(stopped.status === 'cancelled' && stopped.messages[1].status === 'aborted' && stopped.messages[1].content.length > 0, 'Stop kept the partial reply');
  check(stopped.charges.find(c => c.requestId === stopped.attempts.find(a => a.messageId === stopped.messages[1].id).requestId).state === 'unknown', 'The stopped request is recorded as an unknown charge, not zero');
  check(await js(`document.elementFromPoint(${startAt.x}, ${startAt.y})?.closest('button')?.textContent`) === '开始协作', 'Settled, the slot is 开始协作 again');
  await capture('stopped', '点“不停止”后运行继续；再点“停止”并“确认停止”：页头“已停止”，审查者已输出的部分文字保留并标为“已中止”，这次请求在预算栏按未知费用（预留上限）计入、不记为 0。输入区原位置变回“开始协作”；右侧“重试当前回合”“续写部分回复”下方提示“重试和续写会重新发送请求，可能再次计费。”', '.app-navigation');
  const reviewer = requests[1].messages;

  // Step 8: step-by-step from the start — pause after each turn, interject, then 下一步.
  await click('每个回合结束后暂停，方便插话或点名', { selector: 'input[type=checkbox]' });
  check(await js(`document.querySelector('.composer-step input').checked`), 'Step-by-step checked');
  await field('任务目标'); await selectAll(); await ime('dingjia', '讨论跑腿平台的定价');
  await capture('step-option', '开始前在输入区勾选“每个回合结束后暂停，方便插话或点名”（默认不勾选，勾选后会记住），任务改为“讨论跑腿平台的定价”（输入法输入）。', '.composer');
  const before = requests.length;
  await clickAt(startAt);
  await until(`document.querySelector('.timeline .status').textContent.includes('已暂停') && document.querySelectorAll('.message').length === 1`, 'auto-paused after the first turn');
  const stepRun = await snapshot();
  check(requests.length === before + 1 && stepRun.status === 'paused' && stepRun.turns.length === 1, 'Exactly one turn ran, then the Run paused by itself');
  await field('主持人插话'); await ime('qingzhongdian', '请重点比较按距离计价和固定价');
  await click('发送插话');
  await until(`document.querySelectorAll('.message').length === 2`, 'interjection shown');
  await capture('step-paused-interject', '开始后第一位成员（起草者）说完，运行自动暂停（页头“已暂停”），没有和模型抢时间；在右侧“插话”里用输入法输入“请重点比较按距离计价和固定价”并发送，插话出现在时间线上。输入区提示：可以在“主持人控制”里插话或点名，然后点“下一步”让下一位发言，或点“继续”自动运行。', '.app-navigation');
  await click('下一步');
  await until(`document.querySelectorAll('.message').length === 3 && document.querySelector('.timeline .status').textContent.includes('已暂停')`, 'stepped once');
  check(requests.length === before + 2, 'One step sends exactly one request');
  check(requests.at(-1).messages.at(-1).content.includes('【主持人插话】\n> 请重点比较按距离计价和固定价'), 'The next speaker received the interjection as a host entry');
  await capture('step-next', '点“下一步”：只让下一位（审查者）发言一次，说完再次自动暂停；它收到的上下文里包含刚才的主持人插话（脚本核对了请求体）。右侧显示"下一位：综合者（按计划）"，输入区仍是 继续 / 下一步 / 停止。', 2);

  // The reviewer saw the drafter's reply as quoted discussion on the user side, never as its own assistant turn.
  check(reviewer.filter(m => m.role !== 'system').map(m => m.role).join(',') === 'user', 'The reviewer request has one user block and no assistant message');
  check(reviewer.at(-1).content.includes('【成员「起草者」· Drafter】\n> DeepSeek 夹具回复 1') && reviewer.at(-1).content.includes('现在由你（成员「审查者」· Critic）发言'), 'Labelled, quoted drafter reply and the turn cue');
  check(requests.every(r => r.keyMatches && r.model === 'deepseek-flash' && r.thinking?.type === 'disabled'), 'Requests carried the saved Key, the approved model and thinking disabled');
  result.reviewerMessages = reviewer;

  assert.deepEqual(result.nodeNetworkAttempts, []); assert.deepEqual(result.chromiumNetworkAttempts, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.preloadErrors, []);
  check(!JSON.stringify(result).includes(fakeKey) && !JSON.stringify(result).includes(pastedKey), 'Neither key appears in the result');
  cdp.detach();
  result.requests = requests.map(({ messages: _messages, ...rest }) => rest); result.status = 'PASS'; save();
  console.log('PREMERGE_ACCEPTANCE_PASS ' + JSON.stringify({ resultPath, checks: result.checks.length, screens: result.screens.length, requests: requests.length, liveApi: false }));
  await new Promise(done => { fixture.closeAllConnections(); fixture.close(done); }); app.quit();
}
save(); main().catch(fail);
