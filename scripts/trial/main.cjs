// `pnpm trial`: the production build with its own profile (~/Library/Application Support/ai-roundtable-trial on macOS).
// Keys use the system safeStorage as in normal use. The real profile (…/ai-roundtable) is never opened.
// `--check` prints the resolved paths and exits without creating anything.
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, dialog } = require('electron');
const { appDataDirectory, trialProfile, ensureTrialProfile, REAL_NAME } = require('./profile.cjs');

const check = process.argv.includes('--check');
const fail = message => {
  console.error(`AI 圆桌试用版无法启动：${message}`);
  if (!check && app.isReady()) dialog.showErrorBox('AI 圆桌试用版无法启动', message);
  app.exit(1);
};
try {
  if (app.isReady()) throw new Error('必须在应用就绪前设置独立目录。');
  const appData = app.getPath('appData');
  if (resolve(appData) !== resolve(appDataDirectory())) throw new Error(`appData 与预期不一致：${appData}`);
  const directory = trialProfile(appData);
  const real = join(appData, REAL_NAME);
  const root = resolve(__dirname, '../..');
  const entry = join(root, 'out/main/index.js');
  if (check) {
    console.log(JSON.stringify({ trialProfile: directory, realProfile: real, entry, entryBuilt: fs.existsSync(entry), created: fs.existsSync(directory) }));
    app.exit(0);
  } else {
    if (!fs.existsSync(entry)) throw new Error('尚未构建，请先运行 pnpm build（pnpm trial 会自动构建）。');
    // Name the app so its windows, menu and system Keychain item are distinct from the main install.
    app.setName('AI Roundtable Trial');
    const paths = ensureTrialProfile(directory);
    for (const [name, path] of Object.entries(paths)) {
      fs.mkdirSync(path, { recursive: true, mode: 0o700 });
      app.setPath(name, path);
      if (app.getPath(name) !== path) throw new Error(`无法设置 ${name} 目录。`);
    }
    if (resolve(app.getPath('userData')) === resolve(real)) throw new Error('userData 指向真实数据目录，已停止。');
    // The built renderer, not a dev server, and no inherited one-shot trial authorizations.
    for (const name of ['ELECTRON_RENDERER_URL']) delete process.env[name];
    console.log(`AI 圆桌试用版：数据目录 ${directory}`);
    import(pathToFileURL(entry).href).catch(error => fail(error instanceof Error ? error.message : String(error)));
  }
} catch (error) { fail(error instanceof Error ? error.message : String(error)); }
