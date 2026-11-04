import { spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { DeepSeekFixture } from './fixture';

const require = createRequire(import.meta.url);
const here = fileURLToPath(new URL('.', import.meta.url));
export const root = resolve(here, '../../..');
const electronBinary = require('electron') as unknown as string;
const { imeInput } = require('../../probes/ime-input.cjs') as {
  imeInput: (driver: { send: (method: string, params?: object) => Promise<unknown>; js: (code: string) => Promise<unknown>; until: (code: string, message: string, timeout?: number) => Promise<unknown>; key: (name: string, modifiers?: number) => Promise<unknown> }) => {
    selectAll: () => Promise<void>; ime: (pinyin: string, committed: string, options?: { enterWhileComposing?: boolean }) => Promise<void>;
  };
};

export const FAKE_KEY = 'e2e-fake-deepseek-key-5f1c9a7d3b';
const ENTRY = join(here, 'entry.cjs');
const WIDTH = 1280;
const HEIGHT = 800;
const DEEPSEEK = 'https://api.deepseek.com';

/** State entry.cjs keeps in Main. */
export type MainState = {
  profile: string; fakeSafeStorage: { encrypt: number; decrypt: number }; nodeNetworkAttempts: string[]; chromiumNetworkAttempts: string[]; externalOpens: string[];
  ipc: { calls: number; events: number; leaks: string[] };
  dialogs: { asked: { kind: string; title?: string; detail?: string; defaultName?: string }[] };
};

/** One launched app. It was refused unless its data paths are this test's profile; `launch` proves that again at runtime. */
export class RunningApp {
  output = '';
  readonly process: ChildProcess;
  constructor(readonly app: ElectronApplication, readonly page: Page, readonly profile: string) { this.process = app.process(); }

  /** Main's own view of isolation and network: fails the test on any data path outside the profile or any blocked attempt. */
  async state(): Promise<MainState> { return this.app.evaluate(() => (globalThis as unknown as { __e2e: MainState }).__e2e); }
  async expectNoNetwork() {
    const state = await this.state();
    expect(state.nodeNetworkAttempts).toEqual([]);
    expect(state.chromiumNetworkAttempts).toEqual([]);
  }
  api<T = any>(path: string, ...input: unknown[]): Promise<T> {
    return this.page.evaluate(({ path, input }) => {
      const [group, method] = path.split('.');
      return (window as any).roundtable[group!][method!](...input);
    }, { path, input });
  }
  /** Answers the next native folder dialog. */
  answerOpen(folder: string) { return this.app.evaluate((_e, folder) => { (globalThis as any).__e2e.dialogs.open.push({ canceled: false, filePaths: [folder] }); }, folder); }
  /** Answers the next native save dialog. */
  answerSave(file: string) { return this.app.evaluate((_e, file) => { (globalThis as any).__e2e.dialogs.save.push({ canceled: false, filePath: file }); }, file); }

  /** Chinese as an IME delivers it into the focused field: pinyin composition, optional confirming Enter, then the commit. */
  async ime(pinyin: string, committed: string, options?: { enterWhileComposing?: boolean }) {
    const cdp = await this.page.context().newCDPSession(this.page);
    const js = (code: string) => this.page.evaluate(code);
    const until = async (code: string, message: string, timeout = 5000) => {
      await expect.poll(() => js(code), { message, timeout }).toBeTruthy();
    };
    const key = () => this.page.keyboard.press('Meta+A');
    await imeInput({ send: (method, params) => cdp.send(method as never, params as never), js, until, key }).ime(pinyin, committed, options);
    await cdp.detach();
  }

  /** Abrupt death, as a crash or power loss would be: no shutdown code runs. */
  async kill() {
    const closed = new Promise<void>(done => this.process.once('exit', () => done()));
    this.process.kill('SIGKILL');
    await closed;
  }
  async quit() { await this.app.close(); }
}

export const clean = (env: NodeJS.ProcessEnv) => {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (value !== undefined && name !== 'NODE_OPTIONS' && !name.startsWith('ELECTRON_') && !name.startsWith('ROUNDTABLE_')) out[name] = value;
  return out;
};

/** Everything one test needs: its profile, its loopback fixture and the apps it launched. */
export class Harness {
  readonly profile = mkdtempSync(join(realpathSync(tmpdir()), 'roundtable-e2e-'));
  readonly running: RunningApp[] = [];
  constructor(readonly fixture: DeepSeekFixture) {}
  get database() { return join(this.profile, 'userData', 'ai-roundtable.db'); }

  async launch(): Promise<RunningApp> {
    const app = await electron.launch({ args: [ENTRY], cwd: root, env: {
      ...clean(process.env), ROUNDTABLE_E2E_PROFILE: this.profile, ROUNDTABLE_E2E_FIXTURE_PORT: String(this.fixture.port), ROUNDTABLE_E2E_SECRET: FAKE_KEY,
    } });
    const running = new RunningApp(app, await app.firstWindow(), this.profile);
    this.running.push(running);
    for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', chunk => { running.output += String(chunk); });
    // Runtime proof, before the test touches anything: Main reports the profile's folders and no other.
    const reported = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), logs: app.getPath('logs') }));
    const wanted = { userData: join(this.profile, 'userData'), sessionData: join(this.profile, 'sessionData'), logs: join(this.profile, 'logs') };
    if (JSON.stringify(reported) !== JSON.stringify(wanted)) {
      app.process().kill('SIGKILL');
      throw new Error(`Isolation proof failed: ${JSON.stringify(reported)}`);
    }
    await running.page.waitForSelector('.app-shell');
    await app.evaluate(({ BrowserWindow }, [width, height]) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setContentSize(width!, height!);
      // Another app taking key status would end an open IME composition (docs/verification/2026-10-29-maint-ime-probes.md).
      window.setFocusable(false);
      if (window.isFocused()) window.blur();
    }, [WIDTH, HEIGHT]);
    await expect.poll(() => running.page.evaluate(() => window.innerWidth)).toBe(WIDTH);
    return running;
  }

  /** Read-only SQL against this test's database, in Electron's Node (works while the app runs or after it died). */
  sql(...statements: string[]): any[][] { return this.database_(statements); }
  /** Puts in place what an older version left behind. Only while this test's app is closed. */
  write(...statements: string[]) { this.database_(statements, ['write']); }
  private database_(statements: string[], mode: string[] = []): any[][] {
    const result = spawnSync(electronBinary, [join(here, 'db.cjs'), this.database, JSON.stringify(statements), ...mode], { cwd: root, encoding: 'utf8', env: { ...clean(process.env), ELECTRON_RUN_AS_NODE: '1' }, timeout: 30_000 });
    if (result.status !== 0) throw new Error(`SQL failed: ${result.stderr}`);
    return JSON.parse(result.stdout);
  }
  async dispose(keep: boolean) {
    for (const running of this.running) {
      if (running.process.exitCode === null && running.process.signalCode === null) running.process.kill('SIGKILL');
    }
    await this.fixture.stop();
    if (keep) console.log(`Kept for inspection: ${this.profile}`);
    else rmSync(this.profile, { recursive: true, force: true });
  }
}

export const test = base.extend<{ harness: Harness }>({
  harness: async ({}, use, testInfo) => {
    const harness = new Harness(await new DeepSeekFixture().start());
    await use(harness);
    const failed = testInfo.status !== testInfo.expectedStatus;
    if (failed) for (const [index, running] of harness.running.entries()) {
      const shot = await running.page.screenshot().catch(() => undefined);
      if (shot) await testInfo.attach(`app-${index}`, { body: shot, contentType: 'image/png' });
      await testInfo.attach(`app-${index}-output`, { body: running.output });
    }
    await harness.dispose(failed);
  },
});
export { expect };

/** Page helpers shared by the specs: the words below are what the host reads on screen. */
export const statusLine = (page: Page) => page.getByRole('status', { name: '运行状态' });
export const threadItems = (page: Page) => page.locator('.thread-item');
export const memberTexts = (page: Page) => page.locator('.thread-item .msg-body .md');

/** A DeepSeek service with the fake Key, and a room of three members (the UI path is covered in key-safety.spec). */
export async function seedDeepSeekRoom(running: RunningApp, roomName = 'E2E 讨论') {
  const provider = await running.api('settings.createProvider', { name: 'DeepSeek 直连', kind: 'compatible', baseUrl: DEEPSEEK, defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] });
  await running.api('settings.setKey', { providerId: provider.id, apiKey: FAKE_KEY });
  const room = await running.api('rooms.createRoom', { name: roomName, objective: '' });
  const agents = [];
  for (const [index, [displayName, role]] of [['起草者', '起草'], ['审查者', '审查'], ['综合者', '综合']].entries())
    agents.push(await running.api('rooms.createAgent', { roomId: room.id, displayName, roleTemplateId: role, systemPrompt: '', providerId: provider.id, modelId: 'deepseek-flash', enabled: true, displayOrder: index }));
  await running.page.reload();
  await running.page.waitForSelector('.sidebar');
  return { provider, room, agents };
}

/** Waits for words in the status line. */
export const statusHas = (page: Page, words: string, timeout = 30_000) => expect(statusLine(page)).toContainText(words, { timeout });

/** The running request's partial text is on screen: the slot exists and has streamed something. */
export const streamed = (page: Page, index: number, words: string) => expect(memberTexts(page).nth(index)).toContainText(words);

/** 本场信息 › 产物. */
export async function openArtifacts(page: Page) {
  if (!(await page.locator('.run-panel').isVisible())) await page.getByRole('button', { name: '本场信息' }).click();
  await page.getByRole('tab', { name: /^产物/u }).click();
  await expect(page.locator('.art-panel')).toBeVisible();
}

/** Generates one artifact from the panel with one click (D140); the row order is PRD, minutes, actions, code. */
export async function generateArtifact(page: Page, row: 0 | 1 | 2 | 3) {
  await page.locator('.artifact').nth(row).getByRole('button', { name: '生成', exact: true }).click();
  return page.locator('dialog.artifact-reader');
}

/** Opens a new discussion in a sidebar room and writes the goal with the IME. Does not start it. */
export async function newDiscussion(running: RunningApp, roomName: string, goal: string) {
  const { page } = running;
  await page.locator('.sidebar .sb-item', { hasText: roomName }).first().click();
  await page.locator('.room-page').getByRole('button', { name: '新讨论' }).click();
  const box = page.getByRole('textbox', { name: '讨论目标' });
  await box.click();
  await page.keyboard.press('Meta+A');
  await running.ime('mubiao', goal);
}
