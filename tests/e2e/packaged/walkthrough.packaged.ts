import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { RunningApp, clean, memberTexts, root, statusHas, threadItems } from '../support/app';

// Hands-on acceptance of the built package: a first launch, one demo discussion, a normal quit and a reopen, with a
// screenshot per step. Nothing is sent over the network (the demo members are local), and the Key store is the mock
// keychain. The real data folders are never read here: only string comparisons, and a kernel rule that denies them.
//
// Isolation, in the order it is established (the cases run serially: a failure stops everything after it):
//  1. On the development Electron of the same version: --user-data-dir decides the folder, and a Seatbelt rule (macOS's
//     sandbox-exec) denies a stand-in folder.
//  2. The package itself starts under that rule, denied the real folders, and reports the test folder. Chromium's own
//     sandbox cannot nest inside Seatbelt, so this one launch uses --no-sandbox and does nothing else.
//  3. Proven, the package runs in the form a person gets, with Chromium's sandbox on; Main's report and lsof are checked
//     on every launch and a wrong path kills it. HOME and CFFIXED_USER_HOME also move appData and home into a fake home,
//     so even a package ignoring the switch would land there.
const here = fileURLToPath(new URL('.', import.meta.url));
const electronBinary = createRequire(import.meta.url)('electron') as unknown as string;
const executable = join(root, 'dist/mac-arm64/AI Roundtable.app/Contents/MacOS/AI Roundtable');
const screens = join(root, 'docs/verification/r17a-screens');
const realFolders = ['ai-roundtable', 'ai-roundtable-trial'].map(name => join(homedir(), 'Library/Application Support', name));

const work = mkdtempSync(join(realpathSync(tmpdir()), 'roundtable-e2e-packaged-'));
const fakeHome = join(work, 'home');
const userData = join(work, 'userData');
const database = join(userData, 'ai-roundtable.db');
const isolatedEnv = { ...clean(process.env), HOME: fakeHome, CFFIXED_USER_HOME: fakeHome };
const isolatedArgs = [`--user-data-dir=${userData}`, '--use-mock-keychain'];
const seatbelt = (denied: string[]) => `(version 1)(allow default)${denied.map(path => `(deny file* (subpath ${JSON.stringify(path)}))`).join('')}`;
const result: Record<string, unknown> = { steps: [] };
// macOS reports the temp directory as /var/folders while its real path is /private/var/folders.
const real = (path: string) => path.replace(/^\/var\//u, '/private/var/');
const scrub = (value: string) => real(value).split(work).join('$TMPDIR/roundtable-e2e-packaged');

let shot = 0;
async function capture(running: RunningApp, name: string, caption: string) {
  await running.page.waitForTimeout(300);
  const base64 = await running.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
  const file = `${String(++shot).padStart(2, '0')}-${name}.png`;
  writeFileSync(join(screens, file), Buffer.from(base64, 'base64'));
  (result.steps as unknown[]).push({ file, caption });
}

/** Everything the running process has open, by path, from the OS and not from the app. */
function openFiles(pid: number) {
  return execFileSync('lsof', ['-Fn', '-p', String(pid)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1));
}
function connections(pid: number) {
  const out = spawnSync('lsof', ['-a', '-nP', '-i', '-p', String(pid), '-Fn'], { encoding: 'utf8' }).stdout;
  return out.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1));
}

async function launch(): Promise<RunningApp> {
  const app = await electron.launch({ executablePath: executable, args: isolatedArgs, env: isolatedEnv, cwd: work });
  return checked(app);
}

async function checked(app: ElectronApplication): Promise<RunningApp> {
  const running = new RunningApp(app, await app.firstWindow(), work);
  const pid = running.process.pid!;
  const report = await app.evaluate(({ app }) => ({ isPackaged: app.isPackaged, name: app.getName(), version: app.getVersion(), userData: app.getPath('userData'), appData: app.getPath('appData'), home: app.getPath('home'), logs: app.getPath('logs') }));
  // Stops the run at once on any path outside the working directory.
  if (report.userData !== userData || !real(report.appData).startsWith(fakeHome) || !real(report.home).startsWith(fakeHome)) {
    running.process.kill('SIGKILL');
    throw new Error(`Packaged app is not isolated: ${JSON.stringify(report)}`);
  }
  expect(report.isPackaged).toBe(true);
  await running.page.waitForSelector('.app-shell');
  await expect.poll(() => existsSync(database)).toBe(true);
  const files = openFiles(pid);
  for (const real of realFolders) expect(files.filter(file => file.startsWith(real)), 'The OS sees no open file in the real folder').toEqual([]);
  expect(files.some(file => file === database), 'The OS sees the database open in the test folder').toBe(true);
  result.report = { isPackaged: report.isPackaged, name: report.name, version: report.version, userData: scrub(report.userData), appData: scrub(report.appData), home: scrub(report.home), logs: scrub(report.logs) };
  result.databaseOpenInTestFolder = true;
  return running;
}

const sql = (...statements: string[]) => JSON.parse(execFileSync(electronBinary, [join(root, 'tests/e2e/support/db.cjs'), database, JSON.stringify(statements)], { cwd: root, encoding: 'utf8', env: { ...clean(process.env), ELECTRON_RUN_AS_NODE: '1' } }));
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

test.afterAll(() => {
  writeFileSync(join(screens, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  rmSync(work, { recursive: true, force: true });
});

test.describe.configure({ mode: 'serial' });

test('the switch and the deny rule hold on this Electron version, before the package starts', () => {
  mkdirSync(fakeHome, { recursive: true });
  const standIn = join(work, 'stand-in');
  mkdirSync(standIn);
  writeFileSync(join(standIn, 'sentinel'), 'x');
  const out = spawnSync('/usr/bin/sandbox-exec', ['-p', seatbelt([standIn]), electronBinary, join(here, 'isolation-proof.cjs'), `--user-data-dir=${userData}`, '--no-sandbox'],
    { cwd: root, encoding: 'utf8', env: { ...isolatedEnv, ROUNDTABLE_PROOF_DENIED: standIn }, timeout: 30_000 });
  const line = out.stdout.split('\n').find(text => text.startsWith('ISOLATION_PROOF '));
  if (!line) throw new Error(`No proof: ${out.stderr}`);
  const proof = JSON.parse(line.slice('ISOLATION_PROOF '.length)) as { userData: string; read: string; write: string };
  expect(proof.userData, 'The switch decides the folder').toBe(userData);
  expect(proof.read, 'The kernel denies reading the stand-in').toBe('EPERM');
  expect(proof.write, 'The kernel denies writing the stand-in').toBe('EPERM');
  result.proof = { userData: scrub(proof.userData), standInRead: proof.read, standInWrite: proof.write };
});

test('the package itself, denied the real folders by the kernel, reports the test folder', async () => {
  const wrapper = join(work, 'seatbelt-launch.sh');
  writeFileSync(wrapper, '#!/bin/sh\nexec /usr/bin/sandbox-exec -p "$ROUNDTABLE_SEATBELT" "$ROUNDTABLE_EXECUTABLE" "$@"\n', { mode: 0o700 });
  const app = await electron.launch({ executablePath: wrapper, args: [...isolatedArgs, '--no-sandbox'], cwd: work,
    env: { ...isolatedEnv, ROUNDTABLE_SEATBELT: seatbelt(realFolders), ROUNDTABLE_EXECUTABLE: executable } });
  const running = await checked(app);
  await expect(running.page.locator('.welcome')).toBeVisible();
  result.packageUnderDenyRule = { userData: scrub(await app.evaluate(({ app }) => app.getPath('userData'))), name: await app.evaluate(({ app }) => app.getName()) };
  await running.quit();
  // The next launch is a first launch again.
  rmSync(userData, { recursive: true, force: true });
});

test('first launch, one demo discussion, quit and reopen in the installed form', async () => {
  test.setTimeout(180_000);
  for (const old of readdirSync(screens)) if (/^\d\d-.*\.png$/u.test(old)) rmSync(join(screens, old));
  let running = await launch();
  let page = running.page;
  await expect(page.locator('.welcome')).toBeVisible();
  await capture(running, 'first-launch', '首次启动打包后的应用：欢迎页给出“连接模型服务”和“先试玩演示”两条路，说明费用由服务商收取、数据只存在这台电脑上。');

  await page.getByRole('button', { name: '开始试玩' }).click();
  await expect(page.getByText('这场讨论要解决什么？')).toBeVisible();
  const goal = page.getByRole('textbox', { name: '讨论目标' });
  await goal.click();
  await page.keyboard.press('Meta+A');
  await running.ime('xiaoyuan', '为学校设计一个校园跑腿平台的试点方案。', { enterWhileComposing: true });
  await capture(running, 'demo-room', '点“开始试玩”：建好演示房间和三位成员。讨论目标用模拟输入法写入中文，确认候选的回车没有误触发开始。');

  await page.getByRole('button', { name: '开始讨论' }).click();
  await expect(memberTexts(page).first()).toContainText('Mock');
  await capture(running, 'running', '讨论进行中：“开始讨论”原地变成“暂停”，第一位成员的回复正在流式显示。');
  await statusHas(page, '已完成');
  await expect(threadItems(page)).toHaveCount(3);
  await capture(running, 'completed', '三位演示成员依次发言完成，状态“已完成”。');
  const shown = await memberTexts(page).allTextContents();
  const stored = sql("SELECT content FROM messages WHERE sender_type <> 'host' ORDER BY created_at, rowid")[0].map((row: { content: string }) => row.content);
  expect(stored).toEqual(shown);
  result.connectionsDuringDiscussion = connections(running.process.pid!).filter(address => !/127\.0\.0\.1|\[::1\]|localhost/u.test(address));
  expect(result.connectionsDuringDiscussion, 'The demo opens no connection beyond loopback').toEqual([]);

  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  await page.getByRole('button', { name: '外观' }).click();
  await page.locator('.choice', { hasText: '深色' }).click();
  await expect.poll(() => theme(page)).toBe('dark');
  await page.locator('.sb-runs .sb-item').first().click();
  await capture(running, 'completed-dark', '切到深色主题后的同一场讨论。');
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  await page.getByRole('button', { name: '外观' }).click();
  await page.locator('.choice', { hasText: '浅色' }).click();
  await running.quit();
  await expect.poll(() => running.process.exitCode ?? running.process.signalCode, { message: 'Quit ends the process' }).not.toBeNull();
  result.quitExitCode = running.process.exitCode;

  running = await launch();
  page = running.page;
  await expect(page.locator('.welcome'), 'Not first use any more').toHaveCount(0);
  await capture(running, 'reopened', '关闭后重新打开：不再显示欢迎页，侧栏里有演示房间和刚才那场讨论。');
  await page.locator('.sb-runs .sb-item').first().click();
  await expect(memberTexts(page)).toHaveText(shown);
  await statusHas(page, '已完成');
  await capture(running, 'reopened-discussion', '打开那场讨论：三条发言和状态与关闭前完全一致，没有重新生成。');
  const [[run], [version]] = sql('SELECT status FROM workflow_runs', 'SELECT MAX(version) AS version FROM schema_migrations');
  expect(run.status).toBe('completed');
  result.schemaVersion = version.version;
  await running.quit();
});
