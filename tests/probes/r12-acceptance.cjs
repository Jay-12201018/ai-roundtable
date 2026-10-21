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
  // Locates a visible control by accessible name (aria-label, own text or enclosing label) and scrolls it into view.
  await js(`window.__r12 = (name, o = {}) => {
    const visible = e => e && !e.closest('[hidden]') && e.getClientRects().length > 0;
    const label = e => e.getAttribute('aria-label') || e.closest('label')?.firstChild?.textContent?.trim() || e.textContent.trim();
    let list = [...document.querySelectorAll(o.selector || 'button')].filter(e => visible(e) && label(e) === name);
    if (o.slot !== undefined) { const slot = document.querySelectorAll('.host-slot')[o.slot]; list = list.filter(e => slot && slot.contains(e)); }
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
    if (typeof focus === 'number') await js(`document.querySelectorAll('.host-slot')[${focus}]?.scrollIntoView({ block: 'center' }); true`);
    else if (focus) await js(`document.querySelector(${JSON.stringify(focus)})?.scrollIntoView({ block: 'center' }); true`);
    await sleep(350);
    const file = `${String(++shot).padStart(2, '0')}-${name}.png`;
    fs.writeFileSync(join(screens, file), (await contents.capturePage()).toPNG());
    result.screens.push({ file, caption });
  };
  result.screens = [];
  const snapshot = () => js(`window.roundtable.run.getSnapshot(localStorage.getItem('roundtable.runId'))`);
  const status = () => js(`document.querySelector('.timeline .status').textContent`);
  const text = () => js('document.body.innerText');
  const Sqlite = require('better-sqlite3');
  const inputsOf = runId => { const db = new Sqlite(join(paths.userData, 'ai-roundtable.db'), { readonly: true }); try {
    return db.prepare('SELECT a.turn_id AS turnId,t.turn_index AS turnIndex,a.attempt_index AS attemptIndex,a.input_snapshot AS input FROM request_attempts a JOIN turns t ON t.id=a.turn_id WHERE a.run_id=? ORDER BY a.rowid').all(runId).map(row => ({ ...row, input: JSON.parse(row.input) }));
  } finally { db.close(); } };

  // Setup only: a demo room with three Mock members (room management itself is R07, not under test here).
  const { roomId } = await js(`window.roundtable.room.createDemo('R12 实操验收')`);
  await click('房间与成员'); await click('刷新房间'); await click('Mock 圆桌'); await click('讨论');

  // Path 1: @Override the next speaker while the first Turn is streaming.
  await field('任务目标'); await selectAll(); await ime('sheji', '设计一个校园二手书交换平台');
  await click('开始协作');
  await until(`document.querySelector('.host-slot p')?.textContent.length > 0`, 'first Turn streaming');
  await click('点名 综合者');
  const queued = await snapshot();
  await click('暂停');
  check(queued.turns.length === 1 && queued.turns[0].status === 'running' && queued.host.override, 'Override queued while the first Turn was still streaming');
  await until(`document.querySelector('.timeline .status').textContent.includes('已暂停')`, 'paused after the current Turn');
  check((await snapshot()).turns.length === 1 && (await snapshot()).turns[0].status === 'completed', 'The streaming Turn finished normally; the named member has not started yet');
  await until(`document.body.innerText.includes('下一位：综合者（主持人点名')`, 'next speaker prompt');
  check((await status()).includes('下一位：综合者（主持人点名）'), 'The header status names the next speaker and that the host chose them');
  await capture('override-queued', '起草者生成过程中点名"综合者"（随后暂停）：起草者的回合正常完成未被打断；右侧"下一位发言"显示"综合者（主持人点名，排在下一回合…）"，页头状态显示"已暂停 · 下一位：综合者（主持人点名）"，"点名 综合者"按钮为选中态，可"取消点名"。', 'header');

  // Path 2: interjection with IME — Enter during composition must not send; Shift+Enter is a new line.
  await field('主持人插话');
  await send('Input.imeSetComposition', { text: 'zhuchiren', selectionStart: 9, selectionEnd: 9 });
  // A real IME reports the confirming Enter as keyCode 229 (VK_PROCESSKEY) while the composition is open.
  await sleep(150);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
  await sleep(300);
  check(!(await snapshot()).messages.some(m => m.senderName === '主持人'), 'Enter during IME composition did not send the interjection');
  await capture('ime-composing', '主持人插话框处于中文输入法组合状态（拼音 zhuchiren 未上屏）时按下回车：只确认输入、没有发送，时间线没有新增主持人消息。', '.host-compose');
  await send('Input.insertText', { text: '请先评估成本风险' }); await sleep(120);
  await key('Enter', 8); await ime('liechu', '再列出三个最关键的问题');
  const drafted = await js(`document.querySelector('[aria-label="主持人插话"]').value`);
  check(drafted === '请先评估成本风险\n再列出三个最关键的问题', 'Shift+Enter kept a line break and the IME text intact: ' + JSON.stringify(drafted));
  await key('Enter');
  await until(`document.body.innerText.includes('再列出三个最关键的问题') && document.querySelector('[aria-label="主持人插话"]').value === ''`, 'interjection sent');
  await capture('interjection-sent', '回车发送后，插话以"主持人 · 主持人插话"出现在公共时间线（保留两行原文），输入框清空，并提示"插话已加入公共历史，从下一回合起可见"。', '.host-slot.is-host');

  // Path 3: standing instruction — set, revise, (later) clear.
  await field('新增持续指令'); await ime('suoyou', '所有回答使用中文并编号'); await click('添加持续指令');
  await until(`document.body.innerText.includes('生效中 · 第 1 版')`, 'instruction active');
  await capture('instruction-active', '新增持续指令后显示为"生效中 · 第 1 版 · 仅影响之后开始的请求"，并提供"修改""清除"。', '.host-instructions');
  await click('修改', { scope: '.host-instructions' });
  check(await js(`document.activeElement?.getAttribute('aria-label') === '修改持续指令'`), 'Clicking 修改 moves keyboard focus into the instruction editor');
  check(await js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存修改').disabled`), 'Saving an unchanged instruction is not offered');
  await selectAll(); await ime('suoyou', '所有回答使用中文、编号，并控制在五点以内'); await click('保存修改');
  await until(`document.body.innerText.includes('生效中 · 第 2 版')`, 'instruction revised');
  await capture('instruction-revised', '修改持续指令后，内容更新为新文本，状态变为"第 2 版"（旧版本保留在主持人记录中）。', '.host-instructions');

  await click('下一步');
  await until(`(() => { const s = document.querySelector('.timeline .status').textContent; return s.includes('已暂停') && document.querySelectorAll('.host-slot').length >= 3; })()`, 'named member spoke');
  const afterStep = await snapshot();
  check(afterStep.turns[1].agentId.endsWith('-agent-synthesizer') && afterStep.turns[1].overrideActionId, 'The named member (综合者) spoke next as a host-directed Turn');
  const stepInputs = inputsOf(afterStep.runId);
  const second = JSON.stringify(stepInputs[1].input.messages);
  check(second.includes('所有回答使用中文、编号，并控制在五点以内') && !second.includes('"所有回答使用中文并编号"'), 'The request after the revision used only the revised instruction');
  check(second.includes('再列出三个最关键的问题') && !JSON.stringify(stepInputs[0].input.messages).includes('再列出三个最关键的问题'), 'The interjection reached the next request but not the one already started');
  await capture('override-spoke', '点"下一步"后，被点名的"综合者"发言，消息带"主持人点名"标记；"下一位"恢复为按计划的"审查者"。', 2);

  await click('清除', { scope: '.host-instructions' });
  await until(`document.body.innerText.includes('没有生效中的持续指令')`, 'instruction cleared');
  await capture('instruction-cleared', '清除后显示"没有生效中的持续指令"和"已清除 1 条指令；历史版本保留在主持人记录中"。', '.host-panel h3:nth-of-type(3)');
  await click('继续');
  await until(`document.querySelector('.timeline .status').textContent.includes('已完成')`, 'run completed');
  const done = await snapshot();
  check((await text()).includes('运行已完成，不能再插话'), 'A completed Run explains why interjection is unavailable instead of showing a dead input');
  check(done.turns.map(t => t.agentId.split('-agent-')[1]).join() === 'drafter,synthesizer,critic', 'Order: 起草者 → 被点名的综合者 → 按计划的审查者');
  const third = JSON.stringify(inputsOf(done.runId)[2].input.messages);
  check(!third.includes('所有回答使用中文'), 'The request after clearing carried no standing instruction');

  // Path 4: edit a completed message, then regenerate a later one; inspect old/new versions and affected marks.
  await click('修改', { slot: 0 });
  check(await js(`document.activeElement?.getAttribute('aria-label') === '修改消息内容'`), 'Clicking 修改 moves keyboard focus into the message editor');
  await selectAll(); await ime('kaichang', '主持人修订：先做校内试点，再考虑跨校'); await click('保存为新版本');
  await until(`document.body.innerText.includes('主持人修订：先做校内试点') && document.querySelectorAll('.host-affected').length === 2`, 'edit applied');
  await capture('edited-affected', '修改第一条已完成消息：显示新内容、"主持人修改 · 当前有效"和"版本 2/2"；后面两条 Agent 回复出现"受影响"说明（它们基于旧版本生成）。', '.host-slot');
  await click('重新生成', { slot: 2 });
  await until(`document.querySelectorAll('.host-slot')[2].querySelectorAll('button[aria-label="查看上一个版本"]').length === 1 && !document.body.innerText.includes('正在重新生成')`, 'regeneration finished');
  const regenerated = await snapshot();
  check(regenerated.status === 'completed' && regenerated.versions.filter(v => v.slotId === done.turns[1].turnId).length === 2, 'Regeneration added a version without changing the completed Run');
  const regenInput = JSON.stringify(inputsOf(done.runId).at(-1).input.messages);
  check(regenInput.includes('主持人修订：先做校内试点') && regenInput.includes('再列出三个最关键的问题') && !regenInput.includes('Mock 审查'),
    'Regeneration used the revised opening and the earlier interjection, but not the later 审查者 message');
  await capture('regenerated', '对"综合者"的回复点"重新生成"：生成新的版本 2/2（重新生成），依据修订后的开场；第一条修改后的版本仍保留"主持人修改"标记。', 2);
  await click('查看上一个版本', { slot: 2 });
  await until(`document.querySelectorAll('.host-slot')[2].innerText.includes('未生效的历史版本')`, 'old version shown');
  await capture('old-version', '点"‹"查看"综合者"的旧版本：标为"原始 · 未生效的历史版本"，原文完整保留，并提供"设为当前版本"。', 2);

  // Path 5a: a real failure (output limit too small) and an explicit retry that fails again, keeping both attempts.
  await click('工作流');
  await field('单次输出上限（Token）'); await selectAll(); await send('Input.insertText', { text: '3' });
  await click('验证并预览'); await until(`document.body.innerText.includes('已验证的计划预览')`, 'workflow preview');
  await click('应用配置'); await click('讨论');
  await field('任务目标'); await selectAll(); await ime('shibai', '演示失败与手动重试'); await click('开始协作');
  await until(`document.querySelector('.timeline .status').textContent.includes('运行失败')`, 'run failed');
  const failed = await snapshot();
  check(failed.turns.length === 1 && failed.turns[0].status === 'failed', 'The first Turn failed (output limit reached)');
  await capture('failed', '单次输出上限设为 3 后开始：首个回合因输出不完整失败，页头"运行失败"，消息标为"生成失败 · 原始"并保留已输出的部分文字，失败原因"模型未完整完成响应，部分输出已保留。"直接显示在该消息下方；右侧出现"重试当前回合""续写部分回复"。', 'header');
  check(failed.attempts.length === 1, 'No automatic retry happened after the failure');
  check((await text()).includes('生成失败 · 原始') && (await js(`document.querySelector('.host-slot p').textContent.length > 0`)), 'The failed message keeps its partial text and is labelled as failed');
  await click('重试当前回合');
  await until(`(async () => { const s = await window.roundtable.run.getSnapshot(localStorage.getItem('roundtable.runId')); return s.attempts.length === 2 && s.status === 'error'; })()`, 'retry finished');
  const retried = await snapshot();
  check(new Set(retried.attempts.map(a => a.requestId)).size === 2, 'Retry used a new requestId');
  await capture('retry-failed-again', '手动"重试当前回合"：生成第 2 个版本，标为"生成失败 · 重试 · 当前版本（未完成）"，仍因同一输出上限失败；"‹ 版本 2/2"可切换查看两次失败的部分输出，均未被覆盖。', '.host-slot');

  // Path 5b: Stop keeps the partial text; an explicit retry then succeeds.
  await field('任务目标'); await selectAll(); await ime('tingzhi', '演示停止后重试'); await click('开始协作');
  await until(`document.querySelector('.host-slot p')?.textContent.length > 6`, 'streaming before stop');
  await click('停止');
  await until(`document.querySelector('.timeline .status').textContent.includes('已停止')`, 'stopped');
  await capture('stopped-partial', '生成中点"停止"：状态"已停止"，已输出的部分文字保留并标为"已中止"。', '.host-slot');
  await click('重试当前回合');
  await until(`document.querySelector('.timeline .status').textContent.includes('已完成')`, 'retry succeeded');
  const recovered = await snapshot();
  const firstSlot = recovered.versions.filter(v => v.slotId === recovered.turns[0].turnId);
  check(firstSlot.length === 2 && firstSlot[0].active === false && firstSlot[1].active === true, 'The stopped attempt stays as version 1; the retry is the effective version 2');
  check(recovered.messages.find(m => m.id === firstSlot[0].messageId).status === 'aborted', 'Partial text of the stopped attempt kept as aborted');
  await capture('retry-succeeded', '"重试当前回合"后新请求成功并继续完成运行；第一条显示"重试 · 当前有效 · 版本 2/2"，被停止的部分输出作为版本 1 保留。', '.host-slot');

  assert.deepEqual(result.nodeNetworkAttempts, []); assert.deepEqual(result.chromiumNetworkAttempts, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.preloadErrors, []);
  cdp.detach();
  result.status = 'PASS'; save();
  console.log('R12_ACCEPTANCE_PASS ' + JSON.stringify({ resultPath, checks: result.checks.length, screens: result.screens.length, liveApi: false }));
  app.quit();
}
save(); main().catch(fail);
