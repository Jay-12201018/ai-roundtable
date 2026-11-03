import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { artifactOf, memberOf } from './support/fixture';
import { expect, generateArtifact, newDiscussion, openArtifacts, seedDeepSeekRoom, statusHas, test, type Harness, type RunningApp } from './support/app';

const feeNew = 'export const COMMISSION = 0.08;\n';
const feeOld = 'export const COMMISSION = 0.15;\n';
const script = '#!/bin/sh\n# 只是文本，不会被执行\ntouch "$(dirname "$0")/PWNED"\n';
const candidate = JSON.stringify({ title: '试点代码', summary: '费用与夜间规则。', notes: [], files: [
  { path: 'src/fee.ts', language: 'typescript', description: '费用', content: feeNew },
  { path: 'src/rules/night.sh', language: 'shell', description: '夜间规则', content: script },
  { path: 'docs/说明.md', language: 'markdown', description: null, content: '# 说明\n' },
  { path: 'linked/leak.ts', language: 'typescript', description: '穿过符号链接', content: 'export const leaked = true;\n' },
  { path: 'aux.ts', language: 'typescript', description: '保留名', content: 'export {};\n' },
] });

const tree = (top: string, dir = top): string[] => readdirSync(dir).sort().flatMap(name => {
  const path = join(dir, name);
  const info = lstatSync(path);
  const entry = `${relative(top, path)} ${info.isSymbolicLink() ? `-> ${readlinkSync(path)}` : info.isDirectory() ? 'dir' : `${info.mtimeMs} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`}`;
  return info.isDirectory() ? [entry, ...tree(top, path)] : [entry];
});

async function writableCode(running: RunningApp, fixtureCode: string, setReply: (code: string) => void) {
  setReply(fixtureCode);
  await seedDeepSeekRoom(running);
  await newDiscussion(running, 'E2E 讨论', '写出试点的费用和夜间规则。');
  await running.page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(running.page, '已完成');
  await openArtifacts(running.page);
  const reader = await generateArtifact(running.page, 3);
  await expect(reader).toContainText('有效');
  await reader.getByRole('button', { name: '写入文件夹…' }).click();
  return running.page.locator('dialog.code-export');
}

// SPEC: code files are written only after the host previews and confirms them, and after path checks.
test('preview and cancel write nothing; confirming writes only the ticked files; nothing outside the folder changes', async ({ harness }) => {
  const { fixture } = harness;
  const running = await harness.launch();
  const { page } = running;

  const workspace = join(harness.profile, 'workspace');
  const project = join(workspace, 'project');
  const outside = join(workspace, 'outside');
  mkdirSync(join(project, 'src'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(project, 'src/fee.ts'), feeOld);
  writeFileSync(join(outside, 'sentinel.txt'), '根外的哨兵文件\n');
  writeFileSync(join(outside, 'leak.ts'), 'export const leaked = false;\n');
  symlinkSync('../outside', join(project, 'linked'));
  const outsideBefore = tree(outside);
  const projectBefore = tree(project);

  const dialog = await writableCode(running, candidate, code => { fixture.reply = body => artifactOf(body) ? code : `${memberOf(body)}的发言。`; });
  // Cancelling the system folder dialog: back at the intro, nothing checked.
  await dialog.locator('.modal-foot').getByRole('button', { name: '选择文件夹…' }).click();
  await expect(dialog).not.toContainText('请在弹出的窗口里选择文件夹');
  await expect(dialog).not.toContainText('没有勾选的文件不会写入');
  expect(tree(project)).toEqual(projectBefore);

  await running.answerOpen(project);
  await dialog.locator('.modal-foot').getByRole('button', { name: '选择文件夹…' }).click();
  await expect(dialog).toContainText('没有勾选的文件不会写入，现在还什么都没写。');
  await expect(dialog.locator('.cx-summary')).toContainText('新建 2 · 覆盖 1 · 不能写入 2');
  const row = (path: string) => dialog.locator('.cx-file').filter({ has: page.locator('.cx-path', { hasText: path }) });
  await expect(row('linked/leak.ts'), 'A link leaving the folder is refused').toContainText('路径上有一段是符号链接');
  await expect(row('aux.ts'), 'A reserved name is refused').toContainText('系统保留的名字');
  await expect(row('src/fee.ts'), 'An overwrite shows its diff').toContainText('COMMISSION = 0.15');
  await expect(dialog.locator('input[type=checkbox]'), 'Refused files cannot be ticked').toHaveCount(3);
  await expect(dialog.locator('input[type=checkbox]:checked'), 'New files start ticked, the overwrite does not (D141)').toHaveCount(2);
  await expect(dialog.getByRole('checkbox', { name: '覆盖 src/fee.ts' })).not.toBeChecked();
  expect(tree(project), 'The preview wrote nothing').toEqual(projectBefore);

  // Closing without confirming writes nothing either.
  await expect(dialog.locator('.modal-foot button').last()).toHaveText('写入 2 个文件');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(tree(project), 'Cancelling wrote nothing').toEqual(projectBefore);

  const reader = page.locator('dialog.artifact-reader');
  await reader.getByRole('button', { name: '写入文件夹…' }).click();
  await expect(dialog).toContainText('没有勾选的文件不会写入');
  await dialog.getByRole('checkbox', { name: '新建 docs/说明.md' }).click();
  await dialog.getByRole('checkbox', { name: '覆盖 src/fee.ts' }).click();
  await dialog.getByRole('button', { name: '写入 2 个文件（含覆盖 1 个）' }).click();
  await expect(dialog).toContainText('已写入 2 个文件');

  expect(readFileSync(join(project, 'src/fee.ts'), 'utf8')).toBe(feeNew);
  expect(readFileSync(join(project, 'src/rules/night.sh'), 'utf8')).toBe(script);
  expect(existsSync(join(project, 'docs')), 'Not ticked, not written').toBe(false);
  expect(existsSync(join(project, 'aux.ts'))).toBe(false);
  expect(existsSync(join(project, 'src/rules/PWNED')), 'Written, never run').toBe(false);
  expect(lstatSync(join(project, 'src/rules/night.sh')).mode & 0o111, 'Not executable').toBe(0);
  expect(tree(outside), 'The sentinel folder outside never changed').toEqual(outsideBefore);

  const [exports, files] = harness.sql('SELECT root_path FROM code_exports', "SELECT path, outcome FROM code_export_files ORDER BY path");
  expect(exports).toHaveLength(1);
  expect(files.filter(file => file.outcome === 'written').map(file => file.path).sort()).toEqual(['src/fee.ts', 'src/rules/night.sh']);
  await running.expectNoNetwork();
  await running.quit();
});

// Escapes in the model's own text never reach the disk. A path that is wrong as text fails the candidate's validation,
// so it cannot be written at all; a well-formed path into .git is refused file by file in the preview.
const escaping = (path: string) => JSON.stringify({ title: '逃逸', summary: '路径逃逸。', notes: [], files: [
  { path, language: 'typescript', description: null, content: 'export const escaped = true;\n' },
  { path: 'ok.ts', language: 'typescript', description: null, content: 'export const ok = true;\n' },
] });
async function escapeCandidate(harness: Harness, path: string) {
  const running = await harness.launch();
  const { page } = running;
  const project = join(harness.profile, 'workspace', 'project');
  const outside = join(harness.profile, 'workspace', 'outside');
  mkdirSync(project, { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, 'sentinel.txt'), '根外的哨兵文件\n');
  harness.fixture.reply = body => artifactOf(body) ? escaping(path) : `${memberOf(body)}的发言。`;
  await seedDeepSeekRoom(running);
  await newDiscussion(running, 'E2E 讨论', '路径逃逸的目标。');
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成');
  await openArtifacts(page);
  return { running, page, project, outside, outsideBefore: tree(outside), reader: await generateArtifact(page, 3) };
}

for (const [name, path] of [['a parent-directory escape', '../outside/escape.ts'], ['an absolute path', '/tmp/roundtable-e2e-absolute.ts']] as const) {
  test(`${name} in a code version fails validation, so nothing can be written`, async ({ harness }) => {
    const { running, reader, outside, outsideBefore } = await escapeCandidate(harness, path);
    await expect(reader).toContainText('格式检查没有通过');
    await expect(reader).toContainText('路径');
    await expect(reader.getByRole('button', { name: '写入文件夹…' })).toHaveCount(0);
    expect(tree(outside)).toEqual(outsideBefore);
    expect(existsSync('/tmp/roundtable-e2e-absolute.ts')).toBe(false);
    await running.quit();
  });
}

test('a path into .git passes validation but is refused in the preview, and the rest can still be written', async ({ harness }) => {
  const { running, page, reader, project, outside, outsideBefore } = await escapeCandidate(harness, '.git/hooks/pre-commit');
  await expect(reader).toContainText('有效');
  await reader.getByRole('button', { name: '写入文件夹…' }).click();
  const dialog = page.locator('dialog.code-export');
  await running.answerOpen(project);
  await dialog.locator('.modal-foot').getByRole('button', { name: '选择文件夹…' }).click();
  await expect(dialog.locator('.cx-summary')).toContainText('新建 1 · 不能写入 1');
  await expect(dialog.locator('input[type=checkbox]')).toHaveCount(1);
  await dialog.getByRole('button', { name: '写入 1 个文件' }).click();
  await expect(dialog).toContainText('已写入 1 个文件');
  expect(readFileSync(join(project, 'ok.ts'), 'utf8')).toContain('ok');
  expect(existsSync(join(project, '.git')), 'Nothing went into .git').toBe(false);
  expect(tree(outside)).toEqual(outsideBefore);
  await running.quit();
});
