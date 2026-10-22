// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const profile = require('../../scripts/trial/profile.cjs') as {
  appDataDirectory(env?: NodeJS.ProcessEnv, platform?: string, home?: string): string;
  trialProfile(appData: string): string;
  ensureTrialProfile(directory: string): { userData: string; sessionData: string; logs: string };
};
const reset = resolve(__dirname, '../../scripts/trial/reset.cjs');
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function home() {
  const value = mkdtempSync(join(tmpdir(), 'roundtable-trial-home-')); homes.push(value);
  const appData = profile.appDataDirectory({}, process.platform, value);
  mkdirSync(appData, { recursive: true });
  return { home: value, appData, trial: join(appData, 'ai-roundtable-trial'), real: join(appData, 'ai-roundtable') };
}
const runReset = (homeDirectory: string, ...args: string[]) =>
  spawnSync(process.execPath, [reset, ...args], { env: { ...process.env, HOME: homeDirectory, APPDATA: '', XDG_CONFIG_HOME: '', ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });

it('resolves the trial profile next to, and never at, the real profile', () => {
  expect(profile.appDataDirectory({}, 'darwin', '/Users/u')).toBe('/Users/u/Library/Application Support');
  const f = home();
  expect(profile.trialProfile(f.appData)).toBe(f.trial);
  expect(profile.ensureTrialProfile(f.trial)).toEqual({ userData: f.trial, sessionData: f.trial, logs: join(f.trial, 'logs') });
  expect(existsSync(join(f.trial, 'trial-profile.json'))).toBe(true);
});

it('refuses a trial path that is a link, even one pointing at the real profile', () => {
  const f = home(); mkdirSync(f.real); writeFileSync(join(f.real, 'ai-roundtable.db'), 'real');
  symlinkSync(f.real, f.trial);
  expect(() => profile.trialProfile(f.appData)).toThrow(/链接/u);
});

it('resets only a marked trial profile, after an explicit --yes, leaving the real profile alone', () => {
  const f = home(); mkdirSync(f.real); writeFileSync(join(f.real, 'ai-roundtable.db'), 'real');
  expect(runReset(f.home).stdout).toContain('没有试用数据');
  mkdirSync(f.trial);
  const unmarked = runReset(f.home, '--yes');
  expect(unmarked.status).toBe(1); expect(existsSync(f.trial)).toBe(true);
  profile.ensureTrialProfile(f.trial); writeFileSync(join(f.trial, 'ai-roundtable.db'), 'trial');
  expect(runReset(f.home).stdout).toContain('pnpm trial:reset --yes'); expect(existsSync(f.trial)).toBe(true);
  const deleted = runReset(f.home, '--yes');
  expect(deleted.status).toBe(0); expect(existsSync(f.trial)).toBe(false);
  expect(existsSync(join(f.real, 'ai-roundtable.db'))).toBe(true);
});
