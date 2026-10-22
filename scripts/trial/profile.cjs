// Where the isolated trial profile lives, and the checks that keep it away from the real profile.
const fs = require('node:fs');
const { basename, dirname, join, resolve } = require('node:path');

const TRIAL_NAME = 'ai-roundtable-trial';
const REAL_NAME = 'ai-roundtable';
const MARKER = 'trial-profile.json';

/** The platform's per-user application data directory, matching Electron's app.getPath('appData'). */
function appDataDirectory(env = process.env, platform = process.platform, home = require('node:os').homedir()) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support');
  if (platform === 'win32') return env.APPDATA || join(home, 'AppData', 'Roaming');
  return env.XDG_CONFIG_HOME || join(home, '.config');
}

/**
 * Resolves the trial profile under appData and refuses anything that is, contains, or links to the real profile.
 * Returns the absolute trial directory; throws with a Chinese reason otherwise.
 */
function trialProfile(appData) {
  const root = resolve(appData);
  const directory = join(root, TRIAL_NAME);
  const real = join(root, REAL_NAME);
  if (basename(directory) !== TRIAL_NAME || dirname(directory) !== root || directory === real) throw new Error('试用目录解析异常，已停止。');
  if (fs.existsSync(directory)) {
    const info = fs.lstatSync(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${directory} 不是普通目录（可能是链接），已停止。`);
    if (fs.existsSync(real) && fs.realpathSync(directory) === fs.realpathSync(real)) throw new Error('试用目录指向真实数据目录，已停止。');
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error('试用目录不属于当前用户，已停止。');
  }
  return directory;
}

/** Creates the trial profile (0700) with an ownership marker, so reset only ever deletes a directory trial created. */
function ensureTrialProfile(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const marker = join(directory, MARKER);
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, JSON.stringify({ profile: TRIAL_NAME, createdAt: new Date().toISOString() }) + '\n', { mode: 0o600, flag: 'wx' });
  const value = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (value.profile !== TRIAL_NAME) throw new Error('试用目录标记不匹配，已停止。');
  return { userData: directory, sessionData: directory, logs: join(directory, 'logs') };
}

module.exports = { TRIAL_NAME, REAL_NAME, MARKER, appDataDirectory, trialProfile, ensureTrialProfile };
