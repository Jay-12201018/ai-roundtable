import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';

/** D148: the folders an installed app keeps a person's data in, by the names it may have had. Nothing unpackaged opens them. */
export const OFFICIAL_PROFILE_NAMES = ['ai-roundtable', 'AI Roundtable'] as const;
export const DEVELOPMENT_PROFILE_NAME = 'ai-roundtable-dev';

export type ProfileFacts = {
  packaged: boolean; userData: string; sessionData: string; appData: string; appName: string;
  /** Where this user's app data is by default, whatever the current appData says. */
  systemAppData: string;
  /** Whether this platform's paths usually ignore case (macOS, Windows). */
  caseInsensitive: boolean;
  /** Absolute path with every link resolved, also for a path that does not exist yet. */
  real?: (path: string) => string;
};
export type ProfileDecision =
  | { action: 'keep' }
  | { action: 'develop'; userData: string }
  | { action: 'refuse'; path: string; message: string };

/** Resolves links on the way to a path even where it, or the end of it, does not exist yet, including a link to nothing. */
export function resolveRealPath(path: string, depth = 0): string {
  if (depth > 32) throw new Error('Too many links');
  const absolute = resolve(path);
  try { return realpathSync.native(absolute); } catch { /* Something on the way is missing. */ }
  if (lstatSync(absolute, { throwIfNoEntry: false })?.isSymbolicLink()) return resolveRealPath(resolve(dirname(absolute), readlinkSync(absolute)), depth + 1);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(resolveRealPath(parent, depth), basename(absolute));
}

/** Where this user's app data is by default. It reads the account's home, not HOME, so moving HOME does not move it. */
export function systemAppDataDirectory(platform: NodeJS.Platform, home: string, environment: Record<string, string | undefined>): string {
  if (platform === 'darwin') return join(home, 'Library/Application Support');
  if (platform === 'win32') return environment.APPDATA ?? join(home, 'AppData/Roaming');
  return environment.XDG_CONFIG_HOME ?? join(home, '.config');
}

/**
 * D148: decides, before anything is opened, whether this process may use the data folder it was given. A packaged app uses its
 * folder. An unpackaged one never uses the official folder: with no folder of its own it goes to the development folder, and one
 * explicitly pointed at the official folder, directly or through a link, is refused. Electron cannot say whether a folder was set
 * or is the default, so a folder equal to the default counts as not set; where that default is the official folder (`electron .`)
 * this means the development folder, which is also never the official one. There is deliberately no way to skip this.
 */
export function decideProfile(facts: ProfileFacts): ProfileDecision {
  if (facts.packaged) return { action: 'keep' };
  const real = facts.real ?? resolveRealPath;
  const roots = [facts.appData, facts.systemAppData];
  const refused = (path: string, why: string): ProfileDecision => ({ action: 'refuse', path, message: `未打包的应用不能使用正式数据目录（${path}${why}）。请用 pnpm trial，或在加载主进程之前把 userData 设到别的目录。` });
  try {
    const same = (value: string) => facts.caseInsensitive ? value.toLowerCase() : value;
    const officials = roots.flatMap(root => OFFICIAL_PROFILE_NAMES.map(name => same(real(join(root, name)))));
    // Inside the official folder counts too; a sibling such as ai-roundtable-trial does not.
    const official = (path: string) => { const target = same(real(path)); return officials.some(folder => { const way = relative(folder, target); return way === '' || !way.startsWith(`..${sep}`) && way !== '..' && !isAbsolute(way); }); };
    const unset = roots.some(root => resolve(join(root, facts.appName)) === resolve(facts.userData));
    const userData = unset ? join(facts.appData, DEVELOPMENT_PROFILE_NAME) : facts.userData;
    // Session data follows userData until something sets its own.
    const sessionData = resolve(facts.sessionData) === resolve(facts.userData) ? userData : facts.sessionData;
    if (official(userData)) return refused(userData, unset ? '，开发目录指向了它' : '');
    if (official(sessionData)) return refused(sessionData, '');
    return unset ? { action: 'develop', userData } : { action: 'keep' };
  } catch (error) {
    // A folder that cannot be told apart from the official one is not opened.
    return refused(facts.userData, `，无法解析真实路径：${error instanceof Error ? error.message : String(error)}`);
  }
}
