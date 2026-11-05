// D148: an unpackaged app never opens the official data folder. Run with plain Node: `node tests/probes/profile-guard.cjs`.
// The parent only stats the official folder (never opens a file in it), before and after. Each child is Electron running this
// file: it points appData at its own temporary folder and checks that took effect BEFORE it loads the built Main, so the real
// folders are out of reach whatever Main decides. Never replace this with `pnpm dev`, `electron-vite dev` or a moved HOME.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { homedir, tmpdir, userInfo } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const MARKER = 'R148_CHILD ';
const root = resolve(__dirname, '../..');
const entry = join(root, 'out/main/index.js');

if (process.versions.electron) child(); else parent();

/** Mode, size and times of everything under a folder, by lstat only. */
function statTree(folder, out = {}) {
  const info = fs.lstatSync(folder, { throwIfNoEntry: false });
  if (!info) return out;
  out[folder] = [info.mode, info.size, info.mtimeMs, info.ctimeMs];
  if (info.isDirectory()) for (const name of fs.readdirSync(folder)) statTree(join(folder, name), out);
  return out;
}

function parent() {
  const { spawnSync } = require('node:child_process');
  assert.ok(fs.readFileSync(entry, 'utf8').includes('ai-roundtable-dev'), 'The build has no guard: run pnpm build first, and do not go on');
  const official = join(userInfo().homedir, 'Library/Application Support/ai-roundtable');
  const electron = require('electron');
  const before = statTree(official);
  const failures = []; const report = [];
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('ELECTRON_') && !name.startsWith('ROUNDTABLE_') && name !== 'NODE_OPTIONS'));
  for (const scenario of ['default', 'isolated', 'official', 'link', 'inside']) {
    const directory = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'roundtable-guard-'));
    const done = spawnSync(electron, [__filename, scenario, directory], { env, encoding: 'utf8', timeout: 90_000, cwd: root });
    const output = done.stdout + done.stderr;
    const line = output.split('\n').find(text => text.startsWith(MARKER));
    const seen = line ? JSON.parse(line.slice(MARKER.length)) : undefined;
    const dev = join(directory, 'ai-roundtable-dev'); const named = join(directory, 'ai-roundtable');
    const databases = Object.keys(statTree(directory)).filter(path => /ai-roundtable\.db/u.test(basename(path))).map(path => path.slice(directory.length + 1));
    const check = (condition, what) => { if (!condition) failures.push(`${scenario}: ${what}`); };
    if (scenario === 'default') {
      check(done.status === 0, `exit ${done.status}`);
      check(seen?.userData === dev && seen?.sessionData === dev, `userData ${seen?.userData}, sessionData ${seen?.sessionData}`);
      check(seen?.before !== dev && seen?.appData === directory, 'appData was not in place before Main');
      check(fs.existsSync(join(dev, 'ai-roundtable.db')), 'no database in the development folder');
      check(!fs.existsSync(named), 'a folder named as the official one appeared');
    } else if (scenario === 'isolated') {
      check(done.status === 0, `exit ${done.status}`);
      check(seen?.userData === join(directory, 'chosen'), `userData ${seen?.userData}`);
      check(fs.existsSync(join(directory, 'chosen/ai-roundtable.db')), 'no database in the folder it was given');
      check(!fs.existsSync(dev) && !fs.existsSync(named), 'other folders appeared');
    } else {
      check(done.status === 1, `exit ${done.status}`);
      check(output.includes('未打包的应用不能使用正式数据目录'), 'no clear error');
      check(databases.length === 0, `databases: ${databases}`);
      check(!fs.existsSync(dev), 'went to the development folder instead of refusing');
      check(!line, 'Main went on after refusing');
    }
    report.push({ scenario, exit: done.status, before: seen?.before?.replace(directory, '<临时目录>'), underElectron: Object.keys(statTree(join(directory, 'Electron'))).map(path => path.slice(directory.length + 1)), userData: seen?.userData?.replace(directory, '<临时目录>'), databases, entries: fs.readdirSync(directory), refusal: output.split('\n').find(text => text.includes('未打包的应用'))?.replaceAll(directory, '<临时目录>') });
    if (!failures.some(text => text.startsWith(`${scenario}:`))) fs.rmSync(directory, { recursive: true, force: true });
    else report.at(-1).kept = directory;
  }
  const after = statTree(official);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => JSON.stringify(before[path]) !== JSON.stringify(after[path]));
  if (changed.length) failures.push(`official folder changed: ${changed.map(path => path.slice(official.length)).join(', ')}`);
  console.log(JSON.stringify({ status: failures.length ? 'FAIL' : 'PASS', failures, scenarios: report, officialEntries: Object.keys(before).length, officialChanged: changed.length }, null, 1));
  process.exit(failures.length ? 1 : 0);
}

function child() {
  const { app, safeStorage, session } = require('electron');
  const [scenario, directory] = process.argv.slice(2);
  // Refuses to go on unless this is a folder its parent just made, and before anything of the app is loaded.
  assert.equal(app.isReady(), false, 'Isolation must precede readiness and Main');
  assert.ok(basename(directory).startsWith('roundtable-guard-') && fs.realpathSync(dirname(directory)) === fs.realpathSync(tmpdir()), 'Only this probe\'s temporary folder');
  assert.ok(!resolve(directory).startsWith(homedir()) || resolve(tmpdir()).startsWith(homedir()), 'Not under the home folder');
  const before = app.getPath('userData');
  app.setPath('appData', directory);
  assert.equal(app.getPath('appData'), directory, 'appData is not in place: Main must not load');
  for (const name of ['logs', 'crashDumps', 'userCache']) { app.setPath(name, join(directory, name)); assert.equal(app.getPath(name), join(directory, name)); }
  if (scenario === 'isolated') app.setPath('userData', join(directory, 'chosen'));
  if (scenario === 'official') app.setPath('userData', join(directory, 'ai-roundtable'));
  if (scenario === 'inside') app.setPath('userData', join(directory, 'ai-roundtable/inside'));
  if (scenario === 'link') {
    fs.mkdirSync(join(directory, 'ai-roundtable'));
    fs.symlinkSync(join(directory, 'ai-roundtable'), join(directory, 'looks-fine'));
    app.setPath('userData', join(directory, 'looks-fine'));
  }
  app.commandLine.appendSwitch('use-mock-keychain');
  const fake = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'guard-fixture-only',
    encryptString: value => Buffer.from([...Buffer.from(value)].map(byte => byte ^ 0xa5)), decryptString: value => Buffer.from([...value].map(byte => byte ^ 0xa5)).toString(),
    setUsePlainTextEncryption: () => { throw new Error('Fixture does not allow plaintext storage'); } };
  for (const name of Object.getOwnPropertyNames(safeStorage).filter(name => typeof safeStorage[name] === 'function')) assert.ok(Object.hasOwn(fake, name), 'Unisolated safeStorage method: ' + name);
  Object.assign(safeStorage, fake);
  for (const [module, names] of [['node:http', ['request', 'get']], ['node:https', ['request', 'get']], ['node:net', ['connect', 'createConnection']], ['node:tls', ['connect']]]) {
    const transport = require(module);
    for (const name of names) transport[name] = () => { throw new Error('Network disabled in this probe'); };
  }
  globalThis.fetch = async () => { throw new Error('Network disabled in this probe'); };
  delete process.env.ELECTRON_RENDERER_URL;
  app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: /^(?:https?|wss?):/u.test(details.url) })));
  app.once('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', () => {
    console.log(MARKER + JSON.stringify({ before, appData: app.getPath('appData'), userData: app.getPath('userData'), sessionData: app.getPath('sessionData') }));
    app.quit();
  }));
  import(pathToFileURL(entry).href).catch(error => { console.error(String(error)); app.exit(2); });
}
