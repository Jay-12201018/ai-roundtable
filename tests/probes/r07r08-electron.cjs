// Finite production-entry smoke. Only private fixture data and a fully fake safeStorage backend.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
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
// What the page said goes with the failure: a script that throws reaches Main only as "Script failed to execute".
const fail = error => { result.status = 'FAIL'; result.error = error instanceof Error ? error.stack : String(error); save(); console.error('R78_PRODUCTION_FAIL ' + JSON.stringify({ resultPath, error: result.error, consoleErrors: result.consoleErrors })); app.exit(1); };
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
  const { ProviderRegistry: Registry } = await import(pathToFileURL(entry).href);
  // The built-in addresses are real services: this probe must not reach them, not even a name lookup.
  Registry.prototype.createTransport = () => async () => { throw new TypeError('Network disabled in R78 smoke'); };
  await guarded;
  const window = await loaded; const contents = window.webContents;
  // A hidden or covered window throttles the Renderer's timers (seconds per step, then minutes) while Main's Mock keeps
  // streaming: clicks land after the Run has finished and steps crawl into the overall timeout. The probe checks the UI,
  // not Chromium's background scheduling, so it keeps the page at full speed wherever the window ends up on screen.
  contents.setBackgroundThrottling(false);
  // Each page script has its own deadline; on expiry it names the probe step the page recorded last.
  const answer = (script, milliseconds) => Promise.race([contents.executeJavaScript(script), new Promise(resolveAnswer => setTimeout(() => resolveAnswer('(Renderer did not answer)'), milliseconds))]).catch(error => '(unreadable: ' + error.message + ')');
  // Electron has no occlusion getter and isVisible() stays true for a covered window, so the window server is asked which
  // windows lie above this one: bounds and layers need no permission. Covered means one of them contains the whole window; a minimized window is off screen, not covered.
  const occluded = () => {
    if (window.isMinimized()) return false;
    const id = Number(window.getMediaSourceId().split(':')[1]);
    const script = `ObjC.import('CoreGraphics'); ObjC.bindFunction('CFBridgingRelease', ['id', ['void *']]);
      JSON.stringify(ObjC.deepUnwrap($.CFBridgingRelease($.CGWindowListCopyWindowInfo(2, ${id}))).map(w => ({ owner: w.kCGWindowOwnerName, layer: w.kCGWindowLayer, alpha: w.kCGWindowAlpha, bounds: w.kCGWindowBounds })))`;
    try {
      const { x, y, width, height } = window.getBounds();
      const above = JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf8', timeout: 3000 }));
      // The Dock keeps a clear full-screen window at its own level (20; the menu bar's are 24 and 25).
      const covering = above.find(({ layer, alpha, bounds }) => ![20, 24, 25].includes(layer) && alpha === 1 && bounds.X <= x && bounds.Y <= y && bounds.X + bounds.Width >= x + width && bounds.Y + bounds.Height >= y + height);
      return covering ? 'by ' + covering.owner : false;
    } catch (error) { return '(unreadable: ' + error.message + ')'; }
  };
  // What was on screen when a step gave up.
  const lastScene = async () => {
    if (window.isDestroyed()) return { window: '(destroyed)' };
    const flags = { visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(), bounds: window.getBounds() };
    const page = await answer(`(async () => {
      const visible = element => !element.closest('[hidden]') && !element.closest('[inert]') && element.getClientRects().length > 0;
      const animations = element => element.getAnimations({ subtree: true }).map(animation => ({ name: animation.animationName ?? animation.transitionProperty ?? animation.id, playState: animation.playState, currentTime: animation.currentTime, iterations: animation.effect?.getTiming().iterations }));
      const drawer = element => element ? { present: true, visible: visible(element), animations: animations(element) } : { present: false };
      // A timeline that stands still over this half second means the page gets no frames; timers alone do not move it.
      const timelineBefore = document.timeline.currentTime; let frames = 0;
      const counting = () => { frames++; requestAnimationFrame(counting); }; requestAnimationFrame(counting);
      await new Promise(resolve => setTimeout(resolve, 500));
      return { step: window.__r78Step ?? '(none recorded)', left: drawer(document.querySelector('.drawer.is-left')), right: drawer(document.querySelector('.drawer.is-right')),
        visibilityState: document.visibilityState, hasFocus: document.hasFocus(), innerWidth, innerHeight, layout: document.querySelector('.app-shell')?.dataset.layout,
        framesIn500ms: frames, timelineAdvancedMs: document.timeline.currentTime - timelineBefore, trace: window.__r78Trace ?? [] };
    })()`, 3000);
    return { window: { ...flags, occluded: occluded() }, page };
  };
  const lastStep = async () => (await answer('window.__r78Step ?? "(none recorded)"', 2000)) + '; scene: ' + JSON.stringify(await lastScene());
  const bounded = async (label, milliseconds, run) => {
    let timer;
    const expired = new Promise((_resolve, reject) => { timer = setTimeout(async () => {
      reject(new Error(label + ' exceeded ' + milliseconds + ' ms; last step: ' + await lastStep()));
    }, milliseconds); });
    try { return await Promise.race([run(), expired]); }
    catch (error) {
      // A page script that throws names only itself; what it was doing is in the step it recorded. What it rejects with
      // is not this realm's Error, so it is read by what it says.
      const message = String(error?.message ?? error);
      throw new Error(message.includes('; last step: ') ? message : (message.startsWith(label) ? '' : label + ': ') + message + '; last step: ' + await lastStep());
    } finally { clearTimeout(timer); }
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
    // R14 added artifact (typed methods only; a file export asks Main's save dialog).
    // D147 added attachment: bytes go in, and nothing reads a file or takes a path.
    check(JSON.stringify(Object.keys(api).sort()) === JSON.stringify(['artifact','attachment','codeExport','host','room','rooms','run','settings','summary','usage']), 'Unexpected Bridge groups');
    check(JSON.stringify(Object.keys(api.attachment)) === JSON.stringify(['addImage']) && typeof api.attachment.addImage === 'function', 'Unexpected attachment surface');
    check(JSON.stringify(Object.keys(api.codeExport)) === JSON.stringify(['chooseRoot','preview','write']), 'Unexpected code export surface');
    check(JSON.stringify(Object.keys(api.artifact)) === JSON.stringify(['preview','generate','list','getVersion','edit','export','listCodeCandidates']), 'Unexpected artifact surface');
    check(JSON.stringify(Object.keys(api.summary)) === JSON.stringify(['preview','generate','confirm','revoke']) && JSON.stringify(Object.keys(api.usage)) === JSON.stringify(['getReport','exportCsv']), 'Unexpected summary/usage surface');
    check(JSON.stringify(Object.keys(api.host)) === JSON.stringify(['command']) && typeof api.host.command === 'function', 'Unexpected host surface');
    const rooms = ['archiveAgent','archiveRoom','createAgent','createRoom','createStandalone','deleteAgent','deleteRoom','getAgentConfiguration','getLineup','getRoomConfiguration','listAgentConfigurations','listRoomMessages','listRoomRuns','listRooms','listStandalone','reorderAgents','updateAgent','updateRoom'];
    const settings = ['createProvider','deleteKey','deleteProvider','getKeyStorageStatus','getProviderConfiguration','getProviderKeyState','listModelReadiness','listProviderSummaries','refreshModels','setKey','testConnection','updateProvider'];
    check(JSON.stringify(Object.keys(api.rooms).sort()) === JSON.stringify(rooms), 'Unexpected rooms surface');
    check(JSON.stringify(Object.keys(api.settings).sort()) === JSON.stringify(settings), 'Unexpected settings surface');
    check(!('invoke' in api) && !('send' in api) && !('resolveKey' in api.settings) && !('invoke' in api.host) && !('send' in api.host)
      && !('invoke' in api.summary) && !('invoke' in api.usage) && !('invoke' in api.artifact) && !('invoke' in api.attachment), 'Unrestricted capability exposed');
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
    check(csp.includes("connect-src 'none';") && !/unsafe-eval|localhost|127\\.0\\.0\\.1/u.test(csp), 'Production CSP broadened');
    // D147: images may come from the app, data URLs and Main's one image scheme, and from nowhere else.
    check(csp.includes("img-src 'self' data: rt-image:;") && !/file:|https?:/u.test(csp), 'Production image sources broadened');
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
        // Each change the waits saw, and each click, in order: an error can then tell a drawer that never came from one that came and went.
        const trail = window.__r78Trace = []; let seen;
        const mark = text => { trail.push(Math.round(performance.now()) + ' ' + text); if (trail.length > 40) trail.shift(); };
        const trace = () => { const shown = document.querySelector('.drawer');
          const now = [document.querySelector('.app-shell')?.dataset.layout, shown ? shown.className + (visible(shown) ? ' visible' : ' unusable') + ' [' + shown.getAnimations({ subtree: true }).map(animation => animation.playState) + ']' : 'no drawer', document.visibilityState, document.hasFocus() ? 'focused' : 'unfocused'].join(' | ');
          if (now !== seen) { seen = now; mark(now); } };
        const until = async (label, read, failure = 'timed out waiting for ' + label, milliseconds = 10000) => {
          window.__r78Step = item + ': ' + label; const deadline = Date.now() + milliseconds;
          for (;;) {
            trace(); const value = read(); if (value) return value;
            if (Date.now() > deadline) throw new Error(item + ': ' + failure + ' (' + milliseconds + ' ms)');
            await new Promise(resolve => setTimeout(resolve, 16));
          }
        };
        // A drawer is usable once its slide-in has finished (the .18s ui-drawer-in animation).
        const settled = element => element && visible(element) && element.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity) && element;
        const press = async name => { const button = await until('control ' + name, () => { const element = byName(name); return element && !element.disabled && element; }, 'Layout control unavailable: ' + name); mark('click ' + name); button.click(); };
        // The resize reaches the Renderer asynchronously; start once the layout has folded (or unfolded) for this width.
        await until('layout for width ${width}', () => innerWidth === ${width}
          && [...document.querySelectorAll('.sidebar')].some(element => visible(element) && !element.closest('.drawer')) === (${width} >= 1024), 'Layout did not follow the window width');
        // R16: pages are reached from the sidebar (a drawer below 1024px): the room by its name, the discussion by its entry under it
        // (the completed Run the UI phase selected last, as 返回讨论 led back to before).
        const pages = { '讨论': '.composer', '房间与成员': '.room-page', '模型设置': '.settings-shell' };
        const inSidebar = () => [...document.querySelectorAll('.sidebar')].find(element => visible(element));
        const sidebarButton = prefix => { const bar = inSidebar(); return bar && [...bar.querySelectorAll('button.sb-item')].find(element => element.textContent.trim().startsWith(prefix)); };
        const openNavigation = async () => { if (!inSidebar()) { await press('打开导航'); await until('navigation drawer settled', () => settled(document.querySelector('.drawer.is-left')), 'Navigation drawer did not open'); } };
        const go = async target => {
          await openNavigation();
          const entry = target === '模型设置' ? '设置' : target === '房间与成员' ? 'Smoke Roundtable' : 'R78 public three Agent collaboration';
          if (target === '讨论' && !sidebarButton(entry)) { (await until('room entry', () => sidebarButton('Smoke Roundtable'), 'Room entry missing')).click(); await openNavigation(); }
          (await until('sidebar entry ' + entry, () => sidebarButton(entry), 'Sidebar entry missing: ' + entry)).click();
          await until(target + ' page shown', () => { const shown = document.querySelector(pages[target]); return shown && visible(shown) && !document.querySelector('.drawer'); }, 'Page not shown: ' + target);
        };
        const openAppearance = async () => { await go('模型设置'); await press('外观'); };
        // 外观 lives in 设置; it applies to every page and is remembered.
        await openAppearance(); await press(${JSON.stringify(theme === 'light' ? '浅色' : '深色')});
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
          const menu = byName('打开导航'); await reach(menu, 'navigation drawer button'); mark('click 打开导航'); menu.click();
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
          for (const action of ['新建项目','添加成员']) {
            if (action === '新建项目') await openNavigation();
            const open = await until(action + ' button', () => byName(action), 'Unreachable control: ' + action); await reach(open, action);
            if (open.disabled) throw new Error('Editor unavailable'); open.click();
            const dialog = await until(action + ' modal open', () => document.querySelector('dialog[open]'), 'Real modal not opened');
            await reach(named(action === '新建项目' ? '新建' : '添加', dialog), 'modal save');
            const cancel = named('取消', dialog); await reach(cancel, 'modal cancel'); cancel.click();
            await until(action + ' modal closed', () => !document.querySelector('dialog[open]'), 'Modal did not close on 取消');
            actions.push(action + ' modal save/cancel reachable');
          }
          await reach(named('删除…'), 'room deletion (last action)');
        }
        if (${width} === 800 && ${JSON.stringify(page)} === '模型设置') {
          await press('模型服务');
          const card = await until('DeepSeek card', () => document.querySelector('section[aria-label="DeepSeek"]'), 'Unreachable control: DeepSeek');
          if (!card.querySelector('.svc-body')) named('展开 DeepSeek', card) || [...card.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === '展开 DeepSeek').click();
          const replace = await until('Key replacement', () => [...card.querySelectorAll('button')].find(element => visible(element) && element.textContent.trim() === '更换'), 'Unreachable control: 更换'); await reach(replace, 'Key replacement');
          const details = card.querySelector('details.adv'); if (!details.open) details.querySelector('summary').click();
          await reach(await until('Key deletion', () => named('删除 Key…', card), 'Unreachable control: 删除 Key…'), 'Key deletion');
          await reach(named('删除服务…', card), 'last settings action'); actions.push('Key replacement, deletion and the last action reached without invoking generation');
        }
        const width = document.documentElement.clientWidth, scroll = document.documentElement.scrollWidth;
        if (scroll > width + 1) throw new Error('Horizontal page overflow: ' + scroll + '/' + width);
        return { theme: actual, width, height: innerHeight, scrollWidth: scroll, background: getComputedStyle(document.documentElement).backgroundColor, actions };
      })()`));
      result.sizes.push({ requested: [width,height], actualWindow: actualSize, workArea, constrainedByWorkArea: height > workArea.height, page, ...layout });
      if ((width === 800 && theme === 'dark' || width === 1280 && theme === 'light') && page === '模型设置') {
        const screenshot = join(directory, 'r78-' + result.phase + '-' + width + '-' + theme + '.png');
        // capturePage never answers for a window that was resized while minimized. The checks above run either way; the
        // picture needs the window back, as it would for a person.
        if (window.isMinimized()) window.restore();
        await bounded(item + ' screenshot', 10000, async () => fs.writeFileSync(screenshot, (await contents.capturePage()).toPNG()));
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
