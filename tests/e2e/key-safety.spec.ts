import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { artifactOf, memberOf } from './support/fixture';
import { FAKE_KEY, expect, generateArtifact, newDiscussion, openArtifacts, statusHas, test } from './support/app';

const forms = (key: string) => [key, Buffer.from(key).toString('base64'), Buffer.from(key).toString('hex'), Buffer.from(key, 'utf16le').toString('latin1')];
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path]; });

// SPEC: a real Key is never stored in plain text and never reaches logs, exports or ordinary IPC. Typed in the real wizard;
// the fixture receiving it in the header proves the scans below are looking at a Key that was in use.
test('the Key is used for requests but never appears in the database, logs, exports or IPC answers', async ({ harness }) => {
  const { fixture } = harness;
  fixture.reply = body => artifactOf(body) ? JSON.stringify({ title: '行动清单', items: [{ id: 'A1', task: '整理问卷', owner: null, due: null, status: 'todo', sources: [1] }] }) : `${memberOf(body)}的发言。`;
  const running = await harness.launch();
  const { page } = running;

  // First use: connect DeepSeek through the wizard.
  await page.getByRole('button', { name: '连接…' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.locator('.target')).toContainText('Key 只会发往 https://api.deepseek.com');
  const key = page.getByRole('textbox', { name: 'API Key' });
  await key.fill(FAKE_KEY);
  await page.getByRole('button', { name: '保存并连接' }).click();
  await expect(page.getByText('Key 有效'), 'The model list answered; nothing was generated').toBeVisible();
  expect(fixture.requests.at(-1)!.path).toBe('/deepseek/models');
  await expect(page.getByText(/可以用于讨论/u)).toBeVisible();
  await page.getByRole('button', { name: '去开始讨论' }).click();

  // The wizard made the first room. A full discussion, an artifact, its export and the usage export.
  const rooms = await running.api<{ name: string }[]>('rooms.listRooms');
  expect(rooms).toHaveLength(1);
  await newDiscussion(running, rooms[0]!.name, 'Key 安全的目标。');
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成');
  expect(fixture.requests.find(request => request.path?.endsWith('/chat/completions'))!.headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
  await openArtifacts(page);
  const reader = await generateArtifact(page, 2);
  await reader.getByRole('button', { name: '采用这一版' }).click();
  const exportsDir = join(harness.profile, 'exports');
  mkdirSync(exportsDir);
  await reader.getByRole('button', { name: '另存为…' }).click();
  await running.answerSave(join(exportsDir, 'actions.json'));
  await reader.getByRole('group', { name: '另存为' }).getByRole('button', { name: /JSON/u }).click();
  await expect.poll(() => readdirSync(exportsDir)).toContain('actions.json');
  await page.keyboard.press('Escape');
  await page.locator('.sidebar .sb-item', { hasText: '用量' }).click();
  await running.answerSave(join(exportsDir, 'usage.csv'));
  await page.getByRole('button', { name: '导出 CSV' }).click();
  await expect.poll(() => readdirSync(exportsDir)).toContain('usage.csv');

  // Every answer and event Main sent the page while the Key was in use.
  const state = await running.state();
  expect(state.ipc.calls).toBeGreaterThan(10);
  expect(state.ipc.events).toBeGreaterThan(3);
  expect(state.ipc.leaks).toEqual([]);
  expect(state.fakeSafeStorage.encrypt, 'The Key went through the protected backend').toBeGreaterThan(0);
  // The check itself works: looking for a word that is in an answer finds it.
  await running.app.evaluate((_e, word) => { (globalThis as any).__e2e.secret = word; }, rooms[0]!.name);
  await running.api('rooms.listRooms');
  expect((await running.state()).ipc.leaks.length, 'The IPC check detects what it looks for').toBeGreaterThan(0);

  // What the page keeps: nothing in its storage, nothing on screen, nothing left in the field.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.documentElement.outerHTML);
  expect(stored).not.toContain(FAKE_KEY);

  await running.quit();
  const files = walk(harness.profile);
  expect(files.some(file => file.endsWith('ai-roundtable.db'))).toBe(true);
  expect(files.some(file => file.endsWith('usage.csv'))).toBe(true);
  // Every byte the app left in its profile (database, WAL, Chromium's local stores, logs, exports), raw and in common encodings.
  for (const file of files) {
    const bytes = readFileSync(file).toString('latin1');
    for (const form of forms(FAKE_KEY)) expect(bytes.includes(form), `${file} holds the Key`).toBe(false);
  }
  for (const form of forms(FAKE_KEY)) expect(running.output.includes(form), 'Process output holds the Key').toBe(false);
  // The scan reads the right bytes: text the host typed is found the same way, and the Key record exists without the Key.
  const typed = Buffer.from('Key 安全的目标。').toString('latin1');
  expect(files.some(file => readFileSync(file).toString('latin1').includes(typed)), 'The file scan detects what it looks for').toBe(true);
  const [records] = harness.sql('SELECT encrypted_value, backend FROM key_records');
  expect(records).toHaveLength(1);
  expect(records[0].encrypted_value).not.toContain(FAKE_KEY);
});
