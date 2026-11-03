// R12 hands-on acceptance: drives the production build with real input events (Chrome DevTools Input domain),
// Chinese text via IME composition, and saves one screenshot per step. Mock Provider only; network blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, session, safeStorage, screen } = require('electron');

const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === '--restart', 'Usage: electron r12-acceptance.cjs');
const restarting = args.length === 2;
assert.equal(app.isReady(), false, 'Isolation must precede readiness/Main');
app.commandLine.appendSwitch('use-mock-keychain');
assert.equal(app.commandLine.hasSwitch('use-mock-keychain'), true, 'Chromium Keychain isolation switch missing');
const directory = restarting ? dirname(resolve(args[1])) : fs.mkdtempSync(join(tmpdir(), 'roundtable-r12-acceptance-'));
assert.ok(basename(directory).startsWith('roundtable-r12-acceptance-') && fs.realpathSync(dirname(directory)) === fs.realpathSync(tmpdir()), 'Only this probe owned temporary profile is allowed');
assert.ok(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'Profile directory cannot be a symlink');
assert.equal(fs.statSync(directory).uid, process.getuid());
const manifestPath = join(directory, 'r12-manifest.json');
assert.equal(restarting ? resolve(args[1]) : manifestPath, manifestPath);
const ownerPath = join(directory, 'r12-owner.json');
if (!restarting) fs.writeFileSync(ownerPath, JSON.stringify({ probe: 'R12 acceptance probe', uid: process.getuid(), directory }), { mode: 0o600, flag: 'wx' });
const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
assert.deepEqual(owner, { probe: 'R12 acceptance probe', uid: process.getuid(), directory });
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
const resultPath = join(directory, restarting ? 'r12-acceptance-restart.json' : 'r12-acceptance.json');
const save = () => fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
const fake = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'r12-fixture-only',
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
const https = require('node:https');
const { syncBuiltinESMExports } = require('node:module');
const { holdFocus, emulateFocus, imeInput } = require('./ime-input.cjs');
const { settleViewport } = require('./settle-viewport.cjs');
http.request = http.get = () => { result.nodeNetworkAttempts.push('http blocked'); throw new Error('HTTP blocked'); };
https.request = https.get = () => { result.nodeNetworkAttempts.push('https blocked'); throw new Error('HTTPS blocked'); };
globalThis.fetch = async () => { result.nodeNetworkAttempts.push('global fetch blocked'); throw new Error('Remote fetch blocked'); };
for (const name of ['ROUNDTABLE_CONNECT_PROXY', 'ROUNDTABLE_TRUST_PROXY_DNS', 'ROUNDTABLE_TRIAL_ALLOW_ONCE', 'ROUNDTABLE_TRIAL_PROVIDER_ID']) delete process.env[name];
syncBuiltinESMExports();
const fail = error => { result.status = 'FAIL'; result.error = error instanceof Error ? error.stack : typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error); save(); console.error('R12_ACCEPTANCE_FAIL ' + JSON.stringify({ resultPath, error: result.error })); app.exit(1); };
const timer = setTimeout(() => fail(new Error('Bounded acceptance probe timed out')), 480000);
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

const screens = resolve(root, 'docs/verification/r12-screens');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const check = (value, message) => { result.checks.push(message); if (!value) throw new Error('Check failed: ' + message); };

async function main() {
  await import(pathToFileURL(entry).href);
  await guarded; const window = await loaded; const contents = window.webContents;
  // The probe window may be covered or behind other windows while it runs; keep its timers and rendering at full speed.
  contents.setBackgroundThrottling(false);
  const preferences = contents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
  window.setContentSize(1440, 900);
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
  await js(`window.__r12 = (name, o = {}) => {
    const visible = e => e && !e.closest('[hidden]') && e.getClientRects().length > 0;
    const label = e => e.getAttribute('aria-label') || (e.tagName !== 'BUTTON' && e.labels?.[0]?.textContent?.trim()) || e.closest('label')?.firstChild?.textContent?.trim() || e.textContent.trim();
    let list = [...document.querySelectorAll(o.selector || 'button')].filter(e => visible(e) && label(e) === name);
    if (o.slot !== undefined) { const slot = document.querySelectorAll('.thread-item')[o.slot]; list = list.filter(e => slot && slot.contains(e)); }
    if (o.scope) list = list.filter(e => e.closest(o.scope));
    const e = o.which === 'last' ? list.at(-1) : list[o.which || 0];
    if (!e) return null;
    e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: e.disabled === true };
  }; true`);
  const point = async (name, options = {}) => until(`(() => { const p = window.__r12(${JSON.stringify(name)}, ${JSON.stringify(options)}); return p && !p.disabled ? p : null; })()`, 'control ' + name);
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
  // Path 2 drives one composition by hand; each step waits for the state the page reports (composition events and the
  // field value), never a fixed delay.
  const trackIme = () => js(`(() => { const e = document.activeElement; if (!e || e.__imeTracked) return true; e.__imeTracked = true;
    window.__ime = { start: 0, end: 0 }; e.addEventListener('compositionstart', () => window.__ime.start++); e.addEventListener('compositionend', () => window.__ime.end++); return true; })()`);
  // The text around the selection the composition replaces, so the expected value is exact.
  const around = () => js(`(() => { const e = document.activeElement; return { prefix: e.value.slice(0, e.selectionStart), suffix: e.value.slice(e.selectionEnd) }; })()`);
  const composing = ({ prefix, suffix }, pinyin) => until(`window.__ime.start > window.__ime.end && document.activeElement.value === ${JSON.stringify(prefix + pinyin + suffix)}`, 'composition shown: ' + pinyin);
  const commit = async ({ prefix, suffix }, committed) => {
    const ends = await js('window.__ime.end');
    await send('Input.insertText', { text: committed });
    await until(`window.__ime.end > ${ends} && document.activeElement.value === ${JSON.stringify(prefix + committed + suffix)}`, 'composition committed: ' + committed);
  };
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
  const snapshot = () => js(`window.roundtable.run.getSnapshot(localStorage.getItem('roundtable.runId'))`);
  const status = () => js(`document.querySelector('[role=status][aria-label=运行状态]').textContent`);
  const text = () => js('document.body.innerText');
  const Sqlite = require('better-sqlite3');
  const inputsOf = runId => { const db = new Sqlite(join(paths.userData, 'ai-roundtable.db'), { readonly: true }); try {
    return db.prepare('SELECT a.turn_id AS turnId,t.turn_index AS turnIndex,a.attempt_index AS attemptIndex,a.input_snapshot AS input FROM request_attempts a JOIN turns t ON t.id=a.turn_id WHERE a.run_id=? ORDER BY a.rowid').all(runId).map(row => ({ ...row, input: JSON.parse(row.input) }));
  } finally { db.close(); } };

  // Setup only: a demo room with three Mock members (room management itself is R07, not under test here).
  const { roomId } = await js(`window.roundtable.room.createDemo('R12 实操验收')`);
  // R16: changing page refreshes the sidebar; the room opens on its page, where 新讨论 starts a discussion in it.
  await click('用量'); await click('Mock 圆桌', { scope: '.sidebar' }); await click('新讨论', { scope: '.room-page' });

  // Path 1: @Override the next speaker while the first Turn is streaming.
  await field('讨论目标'); await selectAll(); await ime('sheji', '设计一个校园二手书交换平台');
  // 本场信息 › 成员 offers 点名 per member (the box's @ is covered by the R16 probe); open it before the fast Mock Run starts.
  await click('成员', { selector: '[role=tab]' });
  await click('开始讨论');
  await until(`document.querySelector('.thread-item .md')?.textContent.length > 0`, 'first Turn streaming');
  await click('点名 综合者');
  const queued = await snapshot();
  await click('暂停');
  check(queued.turns.length === 1 && queued.turns[0].status === 'running' && queued.host.override, 'Override queued while the first Turn was still streaming');
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已暂停')`, 'paused after the current Turn');
  check((await snapshot()).turns.length === 1 && (await snapshot()).turns[0].status === 'completed', 'The streaming Turn finished normally; the named member has not started yet');
  await until(`document.body.innerText.includes('下一位：综合者（主持人点名')`, 'next speaker prompt');
  check((await js(`document.querySelector('[aria-label=下一位]').textContent`)).includes('下一位：综合者（主持人点名'), 'The line above the box names the next speaker and that the host chose them');
  await capture('override-queued', '起草者生成过程中点名"综合者"（随后暂停）：起草者的回合正常完成未被打断；右侧"下一位发言"显示"综合者（主持人点名，排在下一回合…）"，页头状态显示"已暂停 · 下一位：综合者（主持人点名）"，"点名 综合者"按钮为选中态，可"取消点名"。', 'header');

  // Path 2: interjection with IME — Enter during composition must not send; Shift+Enter is a new line.
  await field('主持人插话'); await trackIme();
  const interjection = await around();
  await send('Input.imeSetComposition', { text: 'zhuchiren', selectionStart: 9, selectionEnd: 9 });
  await composing(interjection, 'zhuchiren');
  // A real IME reports the confirming Enter as keyCode 229 (VK_PROCESSKEY) while the composition is open.
  await js(`window.__keyDowns = 0; document.activeElement.addEventListener('keydown', () => window.__keyDowns++); true`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
  await until('window.__keyDowns >= 1', 'the IME Enter reached the field');
  check(!(await snapshot()).messages.some(m => m.senderName === '主持人'), 'Enter during IME composition did not send the interjection');
  check(await js('window.__ime.start > window.__ime.end'), 'The composition is still open after the IME Enter');
  // The screenshot does not scroll or move focus, so the open composition is left untouched.
  await capture('ime-composing', '主持人插话框处于中文输入法组合状态（拼音 zhuchiren 未上屏）时按下回车：只确认输入、没有发送，时间线没有新增主持人消息。');
  await composing(interjection, 'zhuchiren');
  await commit(interjection, '请先评估成本风险');
  await key('Enter', 8); await ime('liechu', '再列出三个最关键的问题');
  const drafted = await js(`document.querySelector('[aria-label="主持人插话"]').value`);
  check(drafted === '请先评估成本风险\n再列出三个最关键的问题', 'Shift+Enter kept a line break and the IME text intact: ' + JSON.stringify(drafted));
  await key('Enter');
  await until(`document.body.innerText.includes('再列出三个最关键的问题') && document.querySelector('[aria-label="主持人插话"]').value === ''`, 'interjection sent');
  await capture('interjection-sent', '回车发送后，插话以"主持人 · 主持人插话"出现在公共时间线（保留两行原文），输入框清空，并提示"插话已加入公共历史，从下一回合起可见"。', '.host-slot.is-host');

  // Path 3: standing instruction — set, revise, (later) clear.
  await click('指令', { selector: '[role=tab]' });
  await field('新增持续指令'); await ime('suoyou', '所有回答使用中文并编号'); await click('添加持续指令');
  await until(`document.body.innerText.includes('第 1 版 · 从下一次发言起生效')`, 'instruction active');
  await capture('instruction-active', '新增持续指令后显示为"生效中 · 第 1 版 · 仅影响之后开始的请求"，并提供"修改""清除"。', '.host-instructions');
  await click('修改', { scope: '.instr' });
  check(await js(`document.activeElement?.getAttribute('aria-label') === '修改持续指令'`), 'Clicking 修改 moves keyboard focus into the instruction editor');
  check(await js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存修改').disabled`), 'Saving an unchanged instruction is not offered');
  await selectAll(); await ime('suoyou', '所有回答使用中文、编号，并控制在五点以内'); await click('保存修改');
  await until(`document.body.innerText.includes('第 2 版 · 从下一次发言起生效')`, 'instruction revised');
  await capture('instruction-revised', '修改持续指令后，内容更新为新文本，状态变为"第 2 版"（旧版本保留在主持人记录中）。', '.host-instructions');

  await click('下一步');
  await until(`(() => { const s = document.querySelector('[role=status][aria-label=运行状态]').textContent; return s.includes('已暂停') && document.querySelectorAll('.thread-item').length >= 3; })()`, 'named member spoke');
  const afterStep = await snapshot();
  check(afterStep.turns[1].agentId.endsWith('-agent-synthesizer') && afterStep.turns[1].overrideActionId, 'The named member (综合者) spoke next as a host-directed Turn');
  const stepInputs = inputsOf(afterStep.runId);
  const second = JSON.stringify(stepInputs[1].input.messages);
  check(second.includes('所有回答使用中文、编号，并控制在五点以内') && !second.includes('"所有回答使用中文并编号"'), 'The request after the revision used only the revised instruction');
  check(second.includes('再列出三个最关键的问题') && !JSON.stringify(stepInputs[0].input.messages).includes('再列出三个最关键的问题'), 'The interjection reached the next request but not the one already started');
  await capture('override-spoke', '点"下一步"后，被点名的"综合者"发言，消息带"主持人点名"标记；"下一位"恢复为按计划的"审查者"。', 2);

  await click('清除', { scope: '.instr' });
  await until(`document.body.innerText.includes('没有生效中的持续指令')`, 'instruction cleared');
  await capture('instruction-cleared', '清除后显示"没有生效中的持续指令"和"已清除 1 条指令；历史版本保留在主持人记录中"。', '.host-panel h3:nth-of-type(3)');
  await click('继续');
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已完成')`, 'run completed');
  const done = await snapshot();
  // D111: a completed Run is continued from the same box; a new discussion is the explicit 新讨论 button.
  check(await js(`!!document.querySelector('[aria-label=继续讨论]') && !document.querySelector('[aria-label=讨论目标]')`), 'A completed Run offers to continue in place, not a new-goal box');
  // D110: the named member is inserted; the plan's critic and synthesizer still speak.
  check(done.turns.map(t => t.agentId.split('-agent-')[1]).join() === 'drafter,synthesizer,critic,synthesizer', 'Order: 起草者 → 被点名的综合者（插入）→ 按计划的审查者 → 按计划的综合者');
  const third = JSON.stringify(inputsOf(done.runId)[2].input.messages);
  check(!third.includes('所有回答使用中文'), 'The request after clearing carried no standing instruction');

  // Path 4: edit a completed message, then regenerate a later one; inspect old/new versions and affected marks.
  await click('修改', { slot: 0 });
  check(await js(`document.activeElement?.getAttribute('aria-label') === '修改消息内容'`), 'Clicking 修改 moves keyboard focus into the message editor');
  await selectAll(); await ime('kaichang', '主持人修订：先做校内试点，再考虑跨校'); await click('保存为新版本');
  await until(`document.body.innerText.includes('主持人修订：先做校内试点') && [...document.querySelectorAll('.thread-item .note')].filter(note => note.textContent.includes('受影响')).length === 3`, 'edit applied');
  await capture('edited-affected', '修改第一条已完成消息：显示新内容、"主持人修改 · 当前有效"和"版本 2/2"；后面三条 Agent 回复出现"受影响"说明（它们基于旧版本生成）。', '.thread-item');
  await click('重新生成', { slot: 2 });
  await until(`document.querySelectorAll('.thread-item')[2].querySelectorAll('button[aria-label="查看上一个版本"]').length === 1 && !document.body.innerText.includes('正在重新生成')`, 'regeneration finished');
  const regenerated = await snapshot();
  check(regenerated.status === 'completed' && regenerated.versions.filter(v => v.slotId === done.turns[1].turnId).length === 2, 'Regeneration added a version without changing the completed Run');
  const regenInput = JSON.stringify(inputsOf(done.runId).at(-1).input.messages);
  check(regenInput.includes('主持人修订：先做校内试点') && regenInput.includes('再列出三个最关键的问题') && !regenInput.includes('Mock 审查'),
    'Regeneration used the revised opening and the earlier interjection, but not the later 审查者 message');
  await capture('regenerated', '对"综合者"的回复点"重新生成"：生成新的版本 2/2（重新生成），依据修订后的开场；第一条修改后的版本仍保留"主持人修改"标记。', 2);
  await click('查看上一个版本', { slot: 2 });
  await until(`document.querySelectorAll('.thread-item')[2].innerText.includes('未生效的历史版本')`, 'old version shown');
  await capture('old-version', '点"‹"查看"综合者"的旧版本：标为"原始 · 未生效的历史版本"，原文完整保留，并提供"设为当前版本"。', 2);

  // Path 5a (D102): a tiny output limit no longer fails the Run. Each reply is kept and marked as truncated, the Run
  // goes on to the next member, and once it has finished a truncated reply can be continued as a new version.
  await click('新讨论', { scope: '.controls' });
  // R16 batch 2 (D116): 讨论方式 is a dialog that Main checks as you edit; 用于这个房间 remembers it for the room.
  await click('讨论方式：自由讨论 · 3 回合');
  await field('单次发言上限'); await selectAll(); await send('Input.insertText', { text: '3' });
  await until(`document.body.innerText.includes('已核对：预计 3 回合')`, 'workflow checked');
  await click('用于这个房间');
  await field('讨论目标'); await selectAll(); await ime('jieduan', '演示截断与续写'); await click('开始讨论');
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已完成')`, 'run completed despite truncation');
  const truncated = await snapshot();
  check(truncated.turns.length > 1 && truncated.turns.every(t => t.status === 'completed'), 'Every Turn completed and the Run went on to the next member');
  check(truncated.attempts.every(a => a.status === 'completed' && a.finishReason === 'length'), 'Each reply was kept as complete-but-truncated, none failed');
  check((await text()).includes('写到单次上限停下了') && !(await text()).includes('运行失败'), 'The timeline marks truncation and never says the Run failed');
  await capture('truncated', '单次输出上限设为 3 后开始：每条回复写到上限都被保留并标注"已达单次输出上限，内容可能不完整。"，运行没有失败，依次轮到下一位直到"已完成"；每条下方提供"续写"。', 0);
  const truncatedSlot = truncated.turns[0].turnId;
  await click('续写', { slot: 0 });
  await until(`(async () => { const s = await window.roundtable.run.getSnapshot(localStorage.getItem('roundtable.runId'));
    return !s.host?.generation && s.versions.filter(v => v.slotId === ${JSON.stringify(truncatedSlot)}).length === 2; })()`, 'continuation finished');
  const continued = await snapshot();
  const versions = continued.versions.filter(v => v.slotId === truncatedSlot);
  const original = continued.messages.find(m => m.id === versions[0].messageId).content;
  check(versions[1].origin === 'continue' && versions[1].active && !versions[0].active, 'The continuation is the new effective version; the original stays as version 1');
  check(continued.messages.find(m => m.id === versions[1].messageId).content.startsWith(original) && continued.status === 'completed', 'The continuation starts from the kept text; the Run status is unchanged');
  await capture('continued', '运行结束后点第一条的"续写"：生成"续写 · 当前有效 · 版本 2/2"，从原来的文字接着写（这里仍受上限 3 限制，所以再次标注截断，可以继续续写）；原版本保留为版本 1，后续发言被标为受影响。', 0);

  // The 3-token mode was only for this path: back to the room's default before the next one.
  await click('新讨论', { scope: '.controls' }); await click('讨论方式：自由讨论'); await click('恢复默认');
  await until(`document.querySelector('[aria-label="讨论方式：自由讨论 · 3 回合"]')`, 'default mode restored');
  // Path 5b: Stop keeps the partial text; an explicit retry then succeeds.
  // The production Mock finishes a 3-turn Run in about 1.5 s, so Stop (now two clicks, D098) can lose the race to the
  // end of the Run. Each attempt waits for explicit state: the first turn streaming, then the confirmation, then a
  // cancelled Run whose only turn is the first one. A lost race starts a fresh Run; the attempt count is recorded.
  const stopState = `(async () => { const s = await window.roundtable.run.getSnapshot(localStorage.getItem('roundtable.runId'));
    return s.status === 'cancelled' ? (s.turns.length === 1 ? 'first' : 'later') : s.status === 'completed' ? 'completed' : document.querySelector('[aria-label=确认停止运行]') ? 'confirm' : ''; })()`;
  for (result.stopAttempts = 1; ; result.stopAttempts++) {
    check(result.stopAttempts <= 3, 'Stop landed in the first turn within three Runs');
    // After a later-turn stop the box still interjects; 新讨论 brings back the goal box.
    if (await js(`!document.querySelector('[aria-label=讨论目标]')`)) await click('新讨论', { scope: '.controls' });
    await field('讨论目标'); await selectAll(); await ime('tingzhi', '演示停止后重试'); await click('开始讨论');
    await until(`document.querySelectorAll('.thread-item').length === 1 && document.querySelector('.thread-item .md')?.textContent.length > 6 || document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已完成')`, 'streaming before stop');
    if ((await status()).includes('已完成')) continue;
    await click('停止');
    if (await until(stopState, 'stop confirmation or Run end') !== 'confirm') continue;
    // Clicked where it is right now, without waiting for it: if the Run ended meanwhile, the confirmation is gone.
    const confirmAt = await js(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent === '停止讨论'); if (!b) return null;
      const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!confirmAt) continue;
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: confirmAt.x, y: confirmAt.y, button: 'left', clickCount: 1 });
    const outcome = await until(stopState.replace("'confirm'", "''"), 'stopped');
    if (outcome === 'first') break;
  }
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已停止')`, 'stopped');
  await capture('stopped-partial', '生成中点"停止"：状态"已停止"，已输出的部分文字保留并标为"已中止"。', '.thread-item');
  await click('重试当前回合');
  await until(`document.querySelector('[role=status][aria-label=运行状态]').textContent.includes('已完成')`, 'retry succeeded');
  const recovered = await snapshot();
  const firstSlot = recovered.versions.filter(v => v.slotId === recovered.turns[0].turnId);
  check(firstSlot.length === 2 && firstSlot[0].active === false && firstSlot[1].active === true, 'The stopped attempt stays as version 1; the retry is the effective version 2');
  check(recovered.messages.find(m => m.id === firstSlot[0].messageId).status === 'aborted', 'Partial text of the stopped attempt kept as aborted');
  await capture('retry-succeeded', '"重试当前回合"后新请求成功并继续完成运行；第一条显示"重试 · 当前有效 · 版本 2/2"，被停止的部分输出作为版本 1 保留。', '.thread-item');

  assert.deepEqual(result.nodeNetworkAttempts, []); assert.deepEqual(result.chromiumNetworkAttempts, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.preloadErrors, []);
  cdp.detach();
  result.status = 'PASS'; save();
  console.log('R12_ACCEPTANCE_PASS ' + JSON.stringify({ resultPath, checks: result.checks.length, screens: result.screens.length, liveApi: false }));
  app.quit();
}
save(); main().catch(fail);
