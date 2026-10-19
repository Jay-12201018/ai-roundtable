// No receipt is claimed here: reopening the desktop cannot authorize a paid request.
const { app, session, net: electronNet, dialog, Menu } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { installControlledNetwork } = require('./controlled-network.cjs');
const [buildRoot, profileRoot, mainSha] = process.argv.slice(2);
assert.ok(app && !app.isReady() && /^[a-f0-9]{40}$/u.test(mainSha));
const owner = JSON.parse(fs.readFileSync(path.join(profileRoot, 'owner.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(buildRoot, 'build-manifest.json')));
assert.equal(manifest.main, mainSha); assert.equal(profileRoot, owner.root); assert.equal(process.getuid(), owner.uid);
app.setName(owner.appName);
assert.equal(process.env.ROUNDTRIAL_SERVICE, owner.service);
assert.equal(process.env.ROUNDTRIAL_ACCOUNT, owner.accounts[0]); assert.equal(process.env.ROUNDTRIAL_LEGACY_ACCOUNT, owner.accounts[1]);
assert.ok(fs.readFileSync(process.env.ROUNDTRIAL_GUARD_LOG, 'utf8').includes('loaded-no-OS'));
app.commandLine.appendSwitch('disable-features', 'AppleKeychainUseSecItem');
app.commandLine.appendSwitch('disable-background-networking'); app.commandLine.appendSwitch('disable-component-update');
const dry = process.env.ROUNDTRIAL_DRY === '1';
if (dry) assert.equal(owner.fixtureOnly, true);
else assert.notEqual(owner.fixtureOnly, true);
assert.equal(app.commandLine.hasSwitch('use-mock-keychain'), dry);
for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) {
  const p = path.join(profileRoot, 'data', name);
  assert.ok(fs.statSync(p).isDirectory() && !fs.lstatSync(p).isSymbolicLink()); app.setPath(name, p);
}
// Unarmed desktop has no valid network lease; Main retains its own reviewed price expiry checks.
const gate = installControlledNetwork({ sendAuthorized: false, priceExpiresAt: new Date(0).toISOString() });
const result = { main: mainSha, pid: process.pid, status: 'STARTING', sendAuthorized: false, keyContentInspected: false };
const write = () => { result.network = gate.status(); fs.writeFileSync(process.env.ROUNDTRIAL_RESULT, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 }); };
const denyElectron = () => { throw new Error('Renderer and Electron network access remain disabled'); };
electronNet.request = denyElectron; electronNet.fetch = async () => denyElectron();
const protectSession = s => {
  s.setPermissionRequestHandler((_w, _p, cb) => cb(false)); s.setPermissionCheckHandler(() => false);
  s.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => cb({ cancel: /^(https?|wss?|ftp):/u.test(d.url) }));
};
app.on('session-created', protectSession); app.whenReady().then(() => protectSession(session.defaultSession));
const nativeDialog = dialog.showMessageBox.bind(dialog);
dialog.showMessageBox = async (...args) => {
  const opts = args.at(-1);
  if (opts.title !== '授权一次 DeepSeek 受控测试') return nativeDialog(...args);
  assert.equal(opts.defaultId, 0); assert.equal(opts.cancelId, 0);
  return nativeDialog(...args.slice(0, -1), { ...opts, buttons: ['取消'],
    detail: '当前启动仅用于已验收 main 的安全检查；未授权新的单次发送许可。\n\n' + opts.detail });
};
function fail() { result.status = 'FAIL'; write(); console.error('CONTROLLED_DESKTOP_STARTUP_FAILED'); app.exit(1); }
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
const timer = setTimeout(fail, 30000);
const loaded = new Promise(resolve => app.once('browser-window-created', (_e, w) => {
  w.webContents.once('preload-error', fail); w.webContents.once('did-finish-load', () => resolve(w));
}));
async function main() {
  const built = await import(pathToFileURL(path.join(buildRoot, 'out/main/index.js')).href);
  gate.attachRegistry(built.ProviderRegistry.prototype);
  const w = await loaded, prefs = w.webContents.getLastWebPreferences();
  assert.ok(prefs.sandbox && prefs.contextIsolation && !prefs.nodeIntegration && prefs.webSecurity);
  assert.equal(w.webContents.getURL(), pathToFileURL(path.join(buildRoot, 'out/renderer/index.html')).href);
  const controlled = Menu.getApplicationMenu().items.find(i => i.label === '受控测试');
  assert.ok(controlled?.submenu.items.some(i => i.label === 'DeepSeek 单次测试…'));
  result.checks = ['same owned profile and Keychain identity', 'version-bound production build', 'sandbox Preload intact', 'native controlled menu installed', 'real requests remain unarmed'];
  result.status = 'READY'; w.setTitle('AI 圆桌 · main ' + mainSha.slice(0, 7) + ' · 未授权发送');
  w.show(); w.focus(); app.dock?.show(); app.focus({ steal: true });
  clearTimeout(timer); write(); console.log('CONTROLLED_DESKTOP_READY ' + mainSha);
}
write(); main().catch(fail);
