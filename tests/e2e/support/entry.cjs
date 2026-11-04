// E2E entry: runs in Electron's Main before the built app and refuses to start it unless every data path is the test's
// own temporary directory. Keys use a fake safeStorage, Node and Chromium network are blocked, and only the fixture's
// service addresses are redirected to the test's loopback fixture. Native dialogs answer from a queue the test
// fills. Same isolation as tests/probes/r16-harness.cjs, without its in-process driver: Playwright drives the page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { syncBuiltinESMExports } = require('node:module');
const { tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, dialog, ipcMain, safeStorage, session, shell } = require('electron');

const EXIT_REFUSED = 78;
const refuse = message => { console.error(`E2E_ISOLATION_REFUSED ${message}`); process.exit(EXIT_REFUSED); };

// Only a directory this test just created under the system temp directory. Nothing else is opened, not even to look.
function ownedProfile() {
  const given = process.env.ROUNDTABLE_E2E_PROFILE;
  if (!given) refuse('ROUNDTABLE_E2E_PROFILE is not set');
  const directory = resolve(given);
  if (!basename(directory).startsWith('roundtable-e2e-')) refuse('profile is not named as a test directory');
  if (fs.realpathSync(dirname(directory)) !== fs.realpathSync(tmpdir())) refuse('profile is not directly under the system temp directory');
  const info = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!info || !info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()) refuse('profile is not an owned real directory');
  return directory;
}

if (app.isReady()) refuse('app is already ready');
const profile = ownedProfile();
const paths = Object.fromEntries(['userData', 'sessionData', 'logs'].map(name => [name, join(profile, name)]));
for (const [name, path] of Object.entries(paths)) {
  fs.mkdirSync(path, { recursive: true, mode: 0o700 });
  app.setPath(name, path);
  if (app.getPath(name) !== path) refuse(`could not set ${name}`);
}
app.commandLine.appendSwitch('use-mock-keychain');
for (const name of ['ELECTRON_RENDERER_URL']) delete process.env[name];

const state = globalThis.__e2e = {
  profile, fakeSafeStorage: { encrypt: 0, decrypt: 0 }, nodeNetworkAttempts: [], chromiumNetworkAttempts: [], externalOpens: [],
  ipc: { calls: 0, events: 0, leaks: [] }, secret: process.env.ROUNDTABLE_E2E_SECRET ?? '',
  // Native dialogs: the test queues answers and reads what was asked. An empty queue means the host cancelled.
  dialogs: { open: [], save: [], asked: [] },
};

const fake = {
  isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'e2e-fixture-only',
  encryptString: value => { state.fakeSafeStorage.encrypt++; return Buffer.from([...Buffer.from(value)].map(byte => byte ^ 0xa5)); },
  decryptString: value => { state.fakeSafeStorage.decrypt++; return Buffer.from([...value].map(byte => byte ^ 0xa5)).toString(); },
  setUsePlainTextEncryption: () => { throw new Error('The fixture does not allow plaintext storage'); },
};
for (const method of Object.getOwnPropertyNames(safeStorage).filter(method => typeof safeStorage[method] === 'function')) assert.ok(Object.hasOwn(fake, method), 'Unisolated safeStorage method: ' + method);
for (const [method, implementation] of Object.entries(fake)) safeStorage[method] = implementation;

dialog.showOpenDialog = async (_window, options) => { state.dialogs.asked.push({ kind: 'open', title: options.title }); return state.dialogs.open.shift() ?? { canceled: true, filePaths: [] }; };
dialog.showSaveDialog = async (_window, options) => { state.dialogs.asked.push({ kind: 'save', title: options.title, defaultName: basename(options.defaultPath) }); return state.dialogs.save.shift() ?? { canceled: true, filePath: '' }; };
// The first button is the safe one everywhere in Main (取消).
dialog.showMessageBoxSync = (_window, options) => { state.dialogs.asked.push({ kind: 'message', title: options.title, detail: options.detail }); return 0; };
dialog.showErrorBox = (title, content) => { state.dialogs.asked.push({ kind: 'error', title, detail: content }); };
shell.openExternal = async url => { state.externalOpens.push(url); };

const fixturePort = Number(process.env.ROUNDTABLE_E2E_FIXTURE_PORT);
const originalRequest = http.request;
http.request = function (url) {
  const target = new URL(String(url));
  if (target.hostname !== '127.0.0.1' || Number(target.port) !== fixturePort) { state.nodeNetworkAttempts.push(target.origin); throw new Error('Remote HTTP blocked'); }
  return originalRequest.apply(this, arguments);
};
http.get = () => { state.nodeNetworkAttempts.push('http.get'); throw new Error('Remote HTTP blocked'); };
https.request = https.get = () => { state.nodeNetworkAttempts.push('https'); throw new Error('Remote TLS blocked'); };
globalThis.fetch = async () => { state.nodeNetworkAttempts.push('fetch'); throw new Error('Remote fetch blocked'); };
syncBuiltinESMExports();

// Every IPC answer and event is checked for the fake Key on its way to the page.
const carries = value => { try { return Boolean(state.secret) && (JSON.stringify(value) ?? '').includes(state.secret); } catch { return false; } };
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (...args) => {
  const answer = await listener(...args);
  state.ipc.calls++;
  if (carries(answer)) state.ipc.leaks.push(channel);
  return answer;
});
app.on('browser-window-created', (_event, window) => {
  const send = window.webContents.send.bind(window.webContents);
  window.webContents.send = (channel, ...args) => { state.ipc.events++; if (carries(args)) state.ipc.leaks.push(channel); return send(channel, ...args); };
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, answer) => {
    const blocked = /^(https?|wss?):/u.test(details.url);
    if (blocked) state.chromiumNetworkAttempts.push(details.url);
    answer({ cancel: blocked });
  });
});

const fixtureServices = { 'https://api.deepseek.com': 'deepseek', 'https://api.moonshot.cn': 'kimi', 'https://open.bigmodel.cn': 'glm', 'https://ark.cn-beijing.volces.com': 'doubao', 'https://dashscope.aliyuncs.com': 'qwen' };
const build = process.env.ROUNDTABLE_E2E_BUILD ? resolve(process.env.ROUNDTABLE_E2E_BUILD) : resolve(__dirname, '../../../out');
import(pathToFileURL(join(build, 'main/index.js')).href).then(({ ProviderRegistry }) => {
  // This entry alone adds the loopback fixture to what the transport may reach; the app's own entry has no way to.
  const hosts = ProviderRegistry.prototype.transportHosts;
  ProviderRegistry.prototype.transportHosts = function () {
    const allowed = hosts.call(this);
    return { has: host => host === `127.0.0.1:${fixturePort}` || allowed.has(host) };
  };
  const transport = ProviderRegistry.prototype.createTransport;
  ProviderRegistry.prototype.createTransport = function (guard, diagnostics) {
    const send = transport.call(this, guard, diagnostics);
    return (url, init) => {
      const target = new URL(String(url));
      const service = fixtureServices[target.origin];
      assert.ok(service, 'Only the fixture services may be redirected');
      return send(`http://127.0.0.1:${fixturePort}/${service}${target.pathname}${target.search}`, init);
    };
  };
}).catch(error => { console.error('E2E_ENTRY_FAILED', error); process.exit(1); });
