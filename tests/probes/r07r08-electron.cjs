// Finite production-entry smoke. Only private fixture data and a fully fake safeStorage backend.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, session, safeStorage, screen } = require('electron');

const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === '--restart', 'Usage: electron r07r08-electron.cjs [--restart private-manifest.json]');
const restarting = args.length === 2;
assert.equal(app.isReady(), false, 'Isolation must precede readiness/Main');
app.commandLine.appendSwitch('use-mock-keychain');
assert.equal(app.commandLine.hasSwitch('use-mock-keychain'), true, 'Chromium Keychain isolation switch missing');
const directory = restarting ? dirname(resolve(args[1])) : fs.mkdtempSync(join(tmpdir(), 'roundtable-r78-production-'));
assert.ok(basename(directory).startsWith('roundtable-r78-production-') && fs.realpathSync(dirname(directory)) === fs.realpathSync(tmpdir()), 'Only this probe owned temporary profile is allowed');
assert.ok(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'Profile directory cannot be a symlink');
assert.equal(fs.statSync(directory).uid, process.getuid());
const manifestPath = join(directory, 'r78-manifest.json');
assert.equal(restarting ? resolve(args[1]) : manifestPath, manifestPath);
// --restart needs the first phase's manifest; without it (the first phase failed), fail with a non-zero exit instead
// of letting Electron report a load error and exit 0.
if (restarting && !fs.existsSync(manifestPath)) {
  console.error('R78_PRODUCTION_FAIL ' + JSON.stringify({ error: 'Missing first-phase manifest: ' + manifestPath }));
  process.exit(1);
}
const ownerPath = join(directory, 'r78-owner.json');
if (!restarting) fs.writeFileSync(ownerPath, JSON.stringify({ probe: 'R78 production smoke', uid: process.getuid(), directory }), { mode: 0o600, flag: 'wx' });
const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
assert.deepEqual(owner, { probe: 'R78 production smoke', uid: process.getuid(), directory });
assert.equal(fs.statSync(ownerPath).uid, process.getuid());
const prior = restarting ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : undefined;
if (restarting) assert.equal(prior.status, 'PASS');
const paths = Object.fromEntries(['userData', 'sessionData', 'logs'].map(name => [name, join(directory, name)]));
for (const [name, path] of Object.entries(paths)) { fs.mkdirSync(path, { recursive: true, mode: 0o700 }); assert.ok(fs.lstatSync(path).isDirectory() && !fs.lstatSync(path).isSymbolicLink(), 'Profile child cannot be a symlink'); app.setPath(name, path); assert.equal(app.getPath(name), path); }
assert.equal(fs.existsSync(join(paths.userData, 'ai-roundtable.db')), restarting);
delete process.env.ELECTRON_RENDERER_URL;
const root = resolve(__dirname, '../..');
const entry = join(root, 'out/main/index.js'); const preload = join(root, 'out/preload/index.cjs'); const renderer = join(root, 'out/renderer/index.html');
for (const file of [entry, preload, renderer]) assert.ok(fs.existsSync(file), 'Build missing: ' + file);
const result = { status: 'RUNNING', phase: restarting ? 'restart' : 'first', directory, paths, entry, preload, renderer, runtime: { electron: process.versions.electron, node: process.versions.node, abi: process.versions.modules, arch: process.arch }, isolationBeforeReady: !app.isReady(), chromiumMockKeychain: app.commandLine.hasSwitch('use-mock-keychain'), fakeSafeStorage: { replacedMethods: [], encrypt: 0, decrypt: 0 }, nodeNetworkAttempts: [], chromiumNetworkAttempts: [], consoleErrors: [], preloadErrors: [], checks: [] };
const resultPath = join(directory, restarting ? 'r78-restart.json' : 'r78-first.json');
const save = () => fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
const fake = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'r78-fixture-only',
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
// Guard Node transports as well as Chromium; configuration/Mock must never reach the network.
for (const [module, names] of [['node:http', ['request', 'get']], ['node:https', ['request', 'get']], ['node:net', ['connect', 'createConnection']], ['node:tls', ['connect']]]) {
  const transport = require(module);
  for (const name of names) transport[name] = () => { result.nodeNetworkAttempts.push(module + '.' + name); throw new Error('Network disabled in R78 smoke'); };
}
globalThis.fetch = async () => { result.nodeNetworkAttempts.push('fetch'); throw new Error('Network disabled in R78 smoke'); };
let quitting = false;
const fail = error => { result.status = 'FAIL'; result.error = error instanceof Error ? error.stack : String(error); save(); console.error('R78_PRODUCTION_FAIL ' + JSON.stringify({ resultPath, error: result.error })); app.exit(1); };
const timeout = setTimeout(() => fail(new Error('R78 production smoke exceeded 240 seconds including shutdown')), 240000);
process.on('uncaughtException', fail); process.on('unhandledRejection', fail); process.once('exit', () => clearTimeout(timeout));
const loaded = new Promise((resolveWindow, reject) => app.once('browser-window-created', (_event, window) => {
  window.webContents.on('preload-error', (_event, file, error) => { result.preloadErrors.push({ file, error: String(error) }); reject(error); });
  window.webContents.on('console-message', (event, oldLevel, oldMessage) => { if (event.level === 'error' || oldLevel === 3) result.consoleErrors.push(event.message ?? oldMessage); });
  window.webContents.on('render-process-gone', (_event, details) => { if (!quitting) reject(new Error('Renderer gone: ' + details.reason)); });
  window.webContents.once('did-finish-load', () => resolveWindow(window));
}));
const guarded = app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const network = /^(?:https?|wss?):/u.test(details.url);
    if (network) result.chromiumNetworkAttempts.push({ url: details.url, resourceType: details.resourceType });
    callback({ cancel: network });
  });
});
save(); console.log('R78_PRODUCTION_ISOLATION ' + JSON.stringify({ directory, paths, resultPath, manifestPath, phase: result.phase, safeStorage: 'fake-only, no OS calls' }));
async function main() {
  await import(pathToFileURL(entry).href); await guarded;
  const window = await loaded; const contents = window.webContents;
  // A hidden or covered window throttles the Renderer's timers (seconds per step, then minutes) while Main's Mock keeps
  // streaming: clicks land after the Run has finished and steps crawl into the overall timeout. The probe checks the UI,
  // not Chromium's background scheduling, so it keeps the page at full speed wherever the window ends up on screen.
  contents.setBackgroundThrottling(false);
  // Each page script has its own deadline; on expiry it names the probe step the page recorded last.
  const bounded = async (label, milliseconds, run) => {
    let timer;
    const expired = new Promise((_resolve, reject) => { timer = setTimeout(async () => {
      const step = await Promise.race([contents.executeJavaScript('window.__r78Step ?? "(none recorded)"'), new Promise(resolveStep => setTimeout(() => resolveStep('(Renderer did not answer)'), 2000))]).catch(error => '(unreadable: ' + error.message + ')');
      reject(new Error(label + ' exceeded ' + milliseconds + ' ms; last step: ' + step));
    }, milliseconds); });
    try { return await Promise.race([run(), expired]); } finally { clearTimeout(timer); }
  };
  assert.equal(contents.getURL(), pathToFileURL(renderer).href);
  const preferences = contents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.webSecurity, true);
  result.preferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true };
  result.bridge = await contents.executeJavaScript(`(() => {
    const check = (value, message) => { if (!value) throw new Error(message); };
    check(typeof require === 'undefined' && typeof process === 'undefined', 'Renderer Node exposed');
    const api = window.roundtable;
    // R12 added the host group: exactly one typed method, no generic invoke/send.
    // R13B added the summary and usage groups (typed methods only).
    check(JSON.stringify(Object.keys(api).sort()) === JSON.stringify(['host','room','rooms','run','settings','summary','usage']), 'Unexpected Bridge groups');
    check(JSON.stringify(Object.keys(api.summary)) === JSON.stringify(['preview','generate','confirm']) && JSON.stringify(Object.keys(api.usage)) === JSON.stringify(['getReport','writeOff','exportCsv']), 'Unexpected summary/usage surface');
    check(JSON.stringify(Object.keys(api.host)) === JSON.stringify(['command']) && typeof api.host.command === 'function', 'Unexpected host surface');
    const rooms = ['archiveAgent','archiveRoom','createAgent','createRoom','deleteAgent','deleteRoom','getAgentConfiguration','getRoomConfiguration','listAgentConfigurations','listRoomMessages','listRoomRuns','listRooms','reorderAgents','updateAgent','updateRoom'];
    const settings = ['confirmTarget','createProvider','deleteKey','deleteProvider','getKeyStorageStatus','getProviderConfiguration','getProviderKeyState','listModels','listProviderSummaries','setKey','testConnection','updateProvider'];
    check(JSON.stringify(Object.keys(api.rooms).sort()) === JSON.stringify(rooms), 'Unexpected rooms surface');
    check(JSON.stringify(Object.keys(api.settings).sort()) === JSON.stringify(settings), 'Unexpected settings surface');
    check(!('invoke' in api) && !('send' in api) && !('resolveKey' in api.settings) && !('invoke' in api.host) && !('send' in api.host)
      && !('invoke' in api.summary) && !('invoke' in api.usage), 'Unrestricted capability exposed');
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
    check(csp.includes("connect-src 'none';") && !/unsafe-eval|localhost|127\\.0\\.0\\.1/u.test(csp), 'Production CSP broadened');
    return { groups: Object.keys(api).sort(), rooms: Object.keys(api.rooms).sort(), settings: Object.keys(api.settings).sort(), csp };
  })()`);
  // Await real-bridge rejections after isolation/Main loading and before any PASS or quit.
  result.bridgeErrors = await contents.executeJavaScript(`(async () => {
    const checks = [], errors = [], marker = 'r78-bridge-fixture-secret';
    const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
    const cases = [
      [() => window.roundtable.rooms.getRoomConfiguration({ id: 'r78-never-created-room', apiKey: marker }), 'invalid_input', 'Invalid request parameters'],
      [() => window.roundtable.settings.getProviderConfiguration({ id: 'r78-never-created-provider' }), 'not_found', 'Requested resource was not found'],
    ];
    for (const [action, code, message] of cases) {
      let error;
      try { await action(); } catch (rejected) { error = rejected; }
      check(error && typeof error === 'object' && !(error instanceof Error), code + ': plain DTO');
      check(Object.getPrototypeOf(error) === Object.prototype, code + ': object prototype');
      check(error.code === code, code + ': exact code');
      check(error.message === message, code + ': fixed message');
      check(error.retryable === false, code + ': exact retryable');
      const keys = Object.getOwnPropertyNames(error).sort();
      const expected = code === 'invalid_input' ? ['code','field','message','retryable'] : ['code','message','retryable'];
      check(JSON.stringify(keys) === JSON.stringify(expected) && Object.getOwnPropertySymbols(error).length === 0, code + ': strict fields');
      check(!('stack' in error) && !('name' in error) && !('detail' in error) && !('cause' in error), code + ': no error internals');
      check(code === 'invalid_input' ? error.field === 'arguments' : !('field' in error), code + ': whitelisted field');
      check(!JSON.stringify(error).includes(marker) && !JSON.stringify(error).includes('/Users/'), code + ': no secret or local path');
      errors.push({ code: error.code, message: error.message, retryable: error.retryable, keys });
    }
    return { checks, errors };
  })()`);
  assert.equal(result.bridgeErrors.checks.length, 18, 'Both real-bridge paths must execute all security assertions');
  assert.deepEqual(result.bridgeErrors.errors.map(error => error.code), ['invalid_input', 'not_found']);
  console.log('R78_REAL_BRIDGE_ASSERTIONS ' + JSON.stringify({ cases: 2, assertions: result.bridgeErrors.checks.length, errors: result.bridgeErrors.errors }));
  const ui = require('./r07r08-ui.cjs');
  if (restarting) {
    result.ui = await bounded('UI restart phase', 90000, () => ui(contents, 'restart', prior.saved));
  } else {
    const first = await bounded('UI first phase', 90000, () => ui(contents, 'first')); result.first = first;
    const refreshed = new Promise(resolveLoad => contents.once('did-finish-load', resolveLoad)); contents.reload(); await refreshed;
    result.ui = await bounded('UI resume phase', 90000, () => ui(contents, 'resume', first.saved));
  }
  result.sizes = [];
  for (const [width, height] of [[800,600],[1024,768],[1280,800],[1600,1000]]) {
    window.setSize(width, height);
    const workArea = screen.getDisplayMatching(window.getBounds()).workArea;
    const actualSize = window.getSize();
    assert.deepEqual(actualSize, [width, Math.min(height, workArea.height)], 'Window bounds differ from requested size/display work area');
    for (const theme of ['light', 'dark']) {
      for (const page of ['讨论','房间与成员','模型设置']) {
      const item = 'Layout ' + (result.sizes.length + 1) + ' (' + width + '×' + height + ' ' + theme + ' ' + page + ')';
      const layout = await bounded(item, 20000, () => contents.executeJavaScript(`(async () => {
        const visible = element => !element.closest('[hidden]') && !element.closest('[inert]') && element.getClientRects().length > 0;
        const byName = name => [...document.querySelectorAll('button')].find(element => visible(element) && (element.getAttribute('aria-label') === name || element.textContent.trim() === name));
        const named = (name, scope = document) => [...scope.querySelectorAll('button')].find(element => visible(element) && element.textContent.trim() === name);
        // Each step waits for its own condition under its own deadline and records itself, so a stall names the step.
        const item = ${JSON.stringify(item)};
        const until = async (label, read, failure = 'timed out waiting for ' + label, milliseconds = 3000) => {
          window.__r78Step = item + ': ' + label; const deadline = Date.now() + milliseconds;
          for (;;) {
            const value = read(); if (value) return value;
            if (Date.now() > deadline) throw new Error(item + ': ' + failure + ' (' + milliseconds + ' ms)');
            await new Promise(resolve => setTimeout(resolve, 16));
          }
        };
        // A drawer is usable once its slide-in has finished (the .18s ui-drawer-in animation).
        const settled = element => element && visible(element) && element.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity) && element;
        const press = async name => { const button = await until('control ' + name, () => { const element = byName(name); return element && !element.disabled && element; }, 'Layout control unavailable: ' + name); button.click(); };
        // The resize reaches the Renderer asynchronously; start once the layout has folded (or unfolded) for this width.
        await until('layout for width ${width}', () => innerWidth === ${width}
          && [...document.querySelectorAll('.sidebar')].some(element => visible(element) && !element.closest('.drawer')) === (${width} >= 1024), 'Layout did not follow the window width');
        // R16: pages are reached from the sidebar (a drawer below 1024px); 返回讨论 leads back.
        const pages = { '讨论': '.composer', '房间与成员': '.rooms-feature', '模型设置': '.settings-feature' };
        const go = async target => {
          if (target === '讨论') { if (byName('返回讨论')) await press('返回讨论'); }
          else {
            const entry = target === '房间与成员' ? '管理房间与成员' : '设置';
            if (!byName(entry)) { await press('打开导航'); await until('navigation drawer settled', () => settled(document.querySelector('.drawer.is-left')), 'Navigation drawer did not open'); }
            await press(entry);
          }
          await until(target + ' page shown', () => { const shown = document.querySelector(pages[target]); return shown && visible(shown) && !document.querySelector('.drawer'); }, 'Page not shown: ' + target);
        };
        // 外观 lives in 设置; it applies to every page and is remembered.
        await go('模型设置'); await press(${JSON.stringify(theme === 'light' ? '浅色' : '深色')});
        await until('theme ${theme} applied', () => document.documentElement.dataset.theme === ${JSON.stringify(theme)}, 'Theme did not apply');
        await go(${JSON.stringify(page)});
        const actual = document.documentElement.dataset.theme;
        if (actual !== ${JSON.stringify(theme)}) throw new Error('Theme did not apply');
        const reach = async (element, label) => {
          if (!element || !visible(element)) throw new Error('Unreachable control: ' + label);
          element.scrollIntoView({ block:'center', inline:'nearest' });
          await until('in viewport: ' + label, () => { const rect = element.getBoundingClientRect();
            return rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1; }, 'Control outside viewport: ' + label, 1000);
        };
        const actions = [];
        if (${width} === 800 && ${JSON.stringify(page)} === '讨论') {
          // D098: idle, the composer offers 开始讨论 in the slot run controls take while a Run is live. D111: with a
          // finished Run selected (as here), the box continues it and that slot is the explicit 新讨论.
          const continuing = document.querySelector('.composer textarea[aria-label="继续讨论"]');
          if (continuing) { await reach(continuing, '继续讨论 box'); await reach(named('新讨论', document.querySelector('.composer')), '新讨论'); }
          else await reach(named('开始讨论', document.querySelector('.composer')), '开始讨论');
          const menu = byName('打开导航'); await reach(menu, 'navigation drawer button'); menu.click();
          await until('navigation drawer settled', () => settled(document.querySelector('.drawer.is-left')), 'Navigation drawer did not open');
          await reach(document.querySelector('.drawer.is-left .sidebar'), 'navigation drawer');
          await reach(byName('关闭导航'), 'close navigation'); byName('关闭导航').click();
          await until('navigation drawer closed', () => !document.querySelector('.drawer'), 'Navigation drawer did not close');
          const panel = byName('本场信息'); await reach(panel, '本场信息 button'); panel.click();
          await until('本场信息 drawer settled', () => settled(document.querySelector('.drawer.is-right')), '本场信息 drawer did not open');
          await reach(document.querySelector('.drawer.is-right .run-panel h2'), '本场信息 drawer');
          await reach(byName('关闭本场信息'), 'close 本场信息'); byName('关闭本场信息').click();
          await until('本场信息 drawer closed', () => !document.querySelector('.drawer'), '本场信息 drawer did not close');
          actions.push('navigation and 本场信息 drawers opened, reached, closed');
        }
        if (${width} === 800 && ${JSON.stringify(page)} === '房间与成员') {
          for (const action of ['新建房间','新增成员']) {
            if (action === '新增成员') { (await until('成员配置 tab', () => named('成员配置'), 'Unreachable control: 成员配置')).click(); }
            const open = await until(action + ' button', () => named(action), 'Unreachable control: ' + action); await reach(open, action);
            if (open.disabled) throw new Error('Editor unavailable'); open.click();
            const dialog = await until(action + ' modal open', () => document.querySelector('dialog[open]'), 'Real modal not opened');
            await reach(named(action === '新建房间' ? '保存房间' : '保存成员', dialog), 'modal save');
            const cancel = named('取消', dialog); await reach(cancel, 'modal cancel'); cancel.click();
            await until(action + ' modal closed', () => !document.querySelector('dialog[open]'), 'Modal did not close on 取消');
            actions.push(action + ' modal save/cancel reachable');
          }
        }
        if (${width} === 800 && ${JSON.stringify(page)} === '模型设置') {
          const provider = [...document.querySelectorAll('.settings-navigation button')].find(element => visible(element) && element.textContent.trim().startsWith('Smoke Real A ·'));
          await reach(provider, 'saved real Provider'); provider.click();
          const key = await until('Smoke Real A editor loaded', () => { const editor = document.querySelector('.settings-editor');
            return editor && [...editor.querySelectorAll('input')].some(input => input.value === 'Smoke Real A') && editor.querySelector('input[type="password"]'); }, 'Unreachable control: Key input'); await reach(key, 'Key input');
          await reach(named('保存或替换 Key'), 'Key save'); await reach(named('删除 Key'), 'Key deletion');
          await reach(named('发起生成测试'), 'last settings action'); actions.push('long settings Key and last action reached without invoking generation');
        }
        const width = document.documentElement.clientWidth, scroll = document.documentElement.scrollWidth;
        if (scroll > width + 1) throw new Error('Horizontal page overflow: ' + scroll + '/' + width);
        return { theme: actual, width, height: innerHeight, scrollWidth: scroll, background: getComputedStyle(document.documentElement).backgroundColor, actions };
      })()`));
      result.sizes.push({ requested: [width,height], actualWindow: actualSize, workArea, constrainedByWorkArea: height > workArea.height, page, ...layout });
      if ((width === 800 && theme === 'dark' || width === 1280 && theme === 'light') && page === '模型设置') {
        const screenshot = join(directory, 'r78-' + result.phase + '-' + width + '-' + theme + '.png');
        fs.writeFileSync(screenshot, (await contents.capturePage()).toPNG());
      }
      }
    }
  }
  assert.notEqual(result.sizes.find(value => value.theme === 'light').background, result.sizes.find(value => value.theme === 'dark').background, 'Light/dark canvas colors identical');
  assert.deepEqual(result.preloadErrors, []); assert.deepEqual(result.consoleErrors, []);
  assert.deepEqual(result.nodeNetworkAttempts, []); assert.deepEqual(result.chromiumNetworkAttempts, []);
  for (const name of safeStorageMethods) assert.equal(safeStorage[name], fake[name], 'safeStorage fixture changed during production smoke');
  if (!restarting) assert.ok(result.fakeSafeStorage.encrypt >= 4);
  assert.ok(result.fakeSafeStorage.decrypt > 0);
  result.saved = result.ui.saved; result.checks = result.ui.checks;
  result.status = 'PASS'; result.shutdown = 'requested through real Main app.quit; final exit/data audit is separate'; save();
  if (!restarting) fs.writeFileSync(manifestPath, JSON.stringify({ status: 'PASS', directory, saved: result.saved }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log('R78_PRODUCTION_RESULT ' + JSON.stringify({ status: result.status, resultPath, manifestPath, phase: result.phase }));
  quitting = true; app.quit();
}
main().catch(fail);
