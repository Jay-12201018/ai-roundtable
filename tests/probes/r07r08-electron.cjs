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
  assert.equal(contents.getURL(), pathToFileURL(renderer).href);
  const preferences = contents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.webSecurity, true);
  result.preferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true };
  result.bridge = await contents.executeJavaScript(`(() => {
    const check = (value, message) => { if (!value) throw new Error(message); };
    check(typeof require === 'undefined' && typeof process === 'undefined', 'Renderer Node exposed');
    const api = window.roundtable;
    check(JSON.stringify(Object.keys(api).sort()) === JSON.stringify(['room','rooms','run','settings']), 'Unexpected Bridge groups');
    const rooms = ['archiveAgent','archiveRoom','createAgent','createRoom','deleteAgent','deleteRoom','getAgentConfiguration','getRoomConfiguration','listAgentConfigurations','listRoomMessages','listRoomRuns','listRooms','reorderAgents','updateAgent','updateRoom'];
    const settings = ['confirmTarget','createProvider','deleteKey','deleteProvider','getKeyStorageStatus','getProviderConfiguration','getProviderKeyState','listModels','listProviderSummaries','setKey','testConnection','updateProvider'];
    check(JSON.stringify(Object.keys(api.rooms).sort()) === JSON.stringify(rooms), 'Unexpected rooms surface');
    check(JSON.stringify(Object.keys(api.settings).sort()) === JSON.stringify(settings), 'Unexpected settings surface');
    check(!('invoke' in api) && !('send' in api) && !('resolveKey' in api.settings), 'Unrestricted capability exposed');
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
    result.ui = await ui(contents, 'restart', prior.saved);
  } else {
    const first = await ui(contents, 'first'); result.first = first;
    const refreshed = new Promise(resolveLoad => contents.once('did-finish-load', resolveLoad)); contents.reload(); await refreshed;
    result.ui = await ui(contents, 'resume', first.saved);
  }
  result.sizes = [];
  for (const [width, height] of [[800,600],[1024,768],[1280,800],[1600,1000]]) {
    window.setSize(width, height);
    const workArea = screen.getDisplayMatching(window.getBounds()).workArea;
    const actualSize = window.getSize();
    assert.deepEqual(actualSize, [width, Math.min(height, workArea.height)], 'Window bounds differ from requested size/display work area');
    for (const theme of ['light', 'dark']) {
      for (const page of ['讨论','房间与成员','模型设置']) {
      const layout = await contents.executeJavaScript(`(async () => {
        const visible = element => !element.closest('[hidden]') && element.getClientRects().length > 0;
        const button = [...document.querySelectorAll('button')].find(element => visible(element) && element.textContent.trim() === ${JSON.stringify(page)});
        if (!button || button.disabled) throw new Error('Layout page button unavailable');
        button.click(); await new Promise(resolve => setTimeout(resolve, 80));
        const select = document.querySelector('.theme-control select');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(theme)});
        select.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 80));
        const actual = document.documentElement.dataset.theme;
        if (actual !== ${JSON.stringify(theme)}) throw new Error('Theme did not apply');
        const reach = async (element, label) => {
          if (!element || !visible(element)) throw new Error('Unreachable control: ' + label);
          element.scrollIntoView({ block:'center', inline:'nearest' }); await new Promise(resolve => setTimeout(resolve, 30));
          const rect = element.getBoundingClientRect();
          if (rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1) throw new Error('Control outside viewport: ' + label);
        };
        const named = (name, scope = document) => [...scope.querySelectorAll('button')].find(element => visible(element) && element.textContent.trim() === name);
        const actions = [];
        if (${width} === 800 && ${JSON.stringify(page)} === '讨论') {
          const toggle = document.querySelector('.controls-toggle'); await reach(toggle, 'host controls toggle'); toggle.click(); await new Promise(resolve => setTimeout(resolve, 30));
          for (const name of ['暂停','下一步','继续','停止']) await reach(named(name, document.querySelector('#host-controls')), name);
          await reach(toggle, 'host controls collapse'); toggle.click(); actions.push('host controls expanded, reached, collapsed');
        }
        if (${width} === 800 && ${JSON.stringify(page)} === '房间与成员') {
          for (const action of ['新建房间','新增成员']) {
            if (action === '新增成员') { named('成员配置').click(); await new Promise(resolve => setTimeout(resolve, 80)); }
            const open = named(action); await reach(open, action); if (open.disabled) throw new Error('Editor unavailable'); open.click(); await new Promise(resolve => setTimeout(resolve, 80));
            const dialog = document.querySelector('dialog[open]'); if (!dialog) throw new Error('Real modal not opened');
            await reach(named(action === '新建房间' ? '保存房间' : '保存成员', dialog), 'modal save');
            const cancel = named('取消', dialog); await reach(cancel, 'modal cancel'); cancel.click(); await new Promise(resolve => setTimeout(resolve, 40));
            actions.push(action + ' modal save/cancel reachable');
          }
        }
        if (${width} === 800 && ${JSON.stringify(page)} === '模型设置') {
          const provider = [...document.querySelectorAll('.settings-navigation button')].find(element => visible(element) && element.textContent.trim().startsWith('Smoke Real A ·'));
          await reach(provider, 'saved real Provider'); provider.click(); await new Promise(resolve => setTimeout(resolve, 100));
          const key = document.querySelector('.settings-editor input[type="password"]'); await reach(key, 'Key input');
          await reach(named('保存或替换 Key'), 'Key save'); await reach(named('删除 Key'), 'Key deletion');
          await reach(named('发起生成测试'), 'last settings action'); actions.push('long settings Key and last action reached without invoking generation');
        }
        const width = document.documentElement.clientWidth, scroll = document.documentElement.scrollWidth;
        if (scroll > width + 1) throw new Error('Horizontal page overflow: ' + scroll + '/' + width);
        return { theme: actual, width, height: innerHeight, scrollWidth: scroll, background: getComputedStyle(document.documentElement).backgroundColor, actions };
      })()`);
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
