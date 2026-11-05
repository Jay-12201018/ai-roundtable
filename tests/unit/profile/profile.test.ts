// @vitest-environment node
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decideProfile, resolveRealPath, systemAppDataDirectory, type ProfileFacts } from '../../../src/main/profile';

const top = mkdtempSync(join(realpathSync(tmpdir()), 'roundtable-profile-'));
afterAll(() => rmSync(top, { recursive: true, force: true }));
let counter = 0;
/** A fresh appData and a system one, on the real file system, since links are the point. */
function world() {
  const base = join(top, String(++counter));
  const appData = join(base, 'appData'); const systemAppData = join(base, 'system');
  mkdirSync(appData, { recursive: true }); mkdirSync(systemAppData, { recursive: true });
  const facts = (userData: string, overrides: Partial<ProfileFacts> = {}): ProfileFacts => ({ packaged: false, userData, sessionData: userData, appData, appName: 'Electron', systemAppData, caseInsensitive: true, ...overrides });
  return { base, appData, systemAppData, facts };
}

describe('unpackaged (D148)', () => {
  it('with no folder of its own, goes to the development folder under the current appData', () => {
    const { appData, systemAppData, facts } = world();
    expect(decideProfile(facts(join(appData, 'Electron')))).toEqual({ action: 'develop', userData: join(appData, 'ai-roundtable-dev') });
    // appData moved after Electron set its default: the default is still under the system's folder.
    expect(decideProfile(facts(join(systemAppData, 'Electron')))).toEqual({ action: 'develop', userData: join(appData, 'ai-roundtable-dev') });
  });

  it('when the default is the official folder (`electron .`, `pnpm dev`), goes to the development folder and not there', () => {
    const { appData, facts } = world();
    expect(decideProfile(facts(join(appData, 'ai-roundtable'), { appName: 'ai-roundtable' }))).toEqual({ action: 'develop', userData: join(appData, 'ai-roundtable-dev') });
  });

  it('keeps an isolated folder it was explicitly given, and the trial folder', () => {
    const { base, appData, facts } = world();
    for (const folder of [join(base, 'isolated/userData'), join(appData, 'ai-roundtable-trial'), join(appData, 'ai-roundtable-dev'), join(appData, 'ai-roundtable2')]) expect(decideProfile(facts(folder))).toEqual({ action: 'keep' });
  });

  it('refuses the official folder when explicitly given, under appData or the system folder, by either name and in any case', () => {
    const { appData, systemAppData, facts } = world();
    for (const folder of [join(appData, 'ai-roundtable'), join(appData, 'AI Roundtable'), join(systemAppData, 'ai-roundtable'), join(appData, 'AI-ROUNDTABLE'), join(appData, 'ai-roundtable/inside')]) {
      expect(decideProfile(facts(folder)), folder).toMatchObject({ action: 'refuse', path: folder });
    }
    // Where paths do not ignore case, another case is another folder.
    expect(decideProfile(facts(join(appData, 'AI-ROUNDTABLE'), { caseInsensitive: false }))).toEqual({ action: 'keep' });
  });

  it('refuses a link to the official folder, whether the folder exists, the link dangles or a parent is the link', () => {
    const { base, appData, facts } = world();
    const dangling = join(base, 'dangling'); symlinkSync(join(appData, 'ai-roundtable'), dangling);
    expect(decideProfile(facts(dangling))).toMatchObject({ action: 'refuse', path: dangling });
    mkdirSync(join(appData, 'ai-roundtable'));
    const link = join(base, 'link'); symlinkSync(join(appData, 'ai-roundtable'), link);
    expect(decideProfile(facts(link))).toMatchObject({ action: 'refuse', path: link });
    const hop = join(base, 'hop'); symlinkSync(link, hop);
    expect(decideProfile(facts(hop))).toMatchObject({ action: 'refuse' });
    const below = join(link, 'below');
    expect(decideProfile(facts(below))).toMatchObject({ action: 'refuse', path: below });
    const parent = join(base, 'parent'); symlinkSync(appData, parent);
    expect(decideProfile(facts(join(parent, 'ai-roundtable')))).toMatchObject({ action: 'refuse' });
  });

  it('refuses when the official folder is itself a link and the folder given is its target', () => {
    const { base, appData, facts } = world();
    const elsewhere = join(base, 'elsewhere'); mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(appData, 'ai-roundtable'));
    expect(decideProfile(facts(elsewhere))).toMatchObject({ action: 'refuse', path: elsewhere });
  });

  it('refuses a development folder that is a link to the official one', () => {
    const { appData, facts } = world();
    symlinkSync(join(appData, 'ai-roundtable'), join(appData, 'ai-roundtable-dev'));
    expect(decideProfile(facts(join(appData, 'Electron')))).toMatchObject({ action: 'refuse', path: join(appData, 'ai-roundtable-dev') });
  });

  it('refuses session data in the official folder, even with userData elsewhere', () => {
    const { base, appData, facts } = world();
    const sessionData = join(appData, 'ai-roundtable');
    expect(decideProfile(facts(join(base, 'isolated'), { sessionData }))).toMatchObject({ action: 'refuse', path: sessionData });
  });

  it('does not open what it cannot tell apart: a path it cannot resolve is refused', () => {
    const { base, facts } = world();
    expect(decideProfile(facts(join(base, 'x'), { real: () => { throw new Error('no answer'); } }))).toMatchObject({ action: 'refuse' });
    const loop = join(base, 'loop'); symlinkSync(loop, loop);
    expect(decideProfile(facts(loop))).toMatchObject({ action: 'refuse' });
  });
});

describe('packaged (D148)', () => {
  it('keeps its folder, the official one included, and resolves nothing', () => {
    const { appData, facts } = world();
    expect(decideProfile(facts(join(appData, 'ai-roundtable'), { packaged: true, appName: 'ai-roundtable', real: () => { throw new Error('not asked'); } }))).toEqual({ action: 'keep' });
  });
});

describe('paths (D148)', () => {
  it('finds the end of a path that does not exist yet through real parents', () => {
    const { base } = world();
    const real = join(base, 'real'); mkdirSync(real); symlinkSync(real, join(base, 'via'));
    expect(resolveRealPath(join(base, 'via/not/yet'))).toBe(join(realpathSync(base), 'real/not/yet'));
  });
  it('knows each platform\'s default, from the account and not HOME', () => {
    expect(systemAppDataDirectory('darwin', '/Users/a', { HOME: '/moved' })).toBe('/Users/a/Library/Application Support');
    expect(systemAppDataDirectory('linux', '/home/a', {})).toBe('/home/a/.config');
    expect(systemAppDataDirectory('linux', '/home/a', { XDG_CONFIG_HOME: '/x' })).toBe('/x');
    expect(systemAppDataDirectory('win32', '/a', { APPDATA: 'C:/r' })).toBe('C:/r');
  });
});
