import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { artifactOf, memberOf } from './support/fixture';
import { expect, generateArtifact, newDiscussion, openArtifacts, seedDeepSeekRoom, statusHas, test, type RunningApp } from './support/app';

const json = (value: unknown) => JSON.stringify(value, null, 2);
const validPrd = json({
  title: '校园跑腿试点 PRD', background: '学校希望试点校园跑腿。<script>window.__pwned = 1</script>', goals: ['验证需求'],
  requirements: [{ id: 'R1', title: '下单与接单', description: '学生发布订单，骑手接单。<img src=x onerror="window.__pwned=2">', priority: 'must', acceptanceCriteria: ['可以提交订单'], sources: [1] }],
  nonGoals: [], openQuestions: [],
});
const invalidMinutes = '```json\n' + json({
  title: '讨论纪要', summary: '三位成员讨论了试点。', participants: '起草者、审查者、综合者',
  conclusions: [{ text: '抽成降到 8%', sources: [7] }], decisions: [], openIssues: [],
}) + '\n```';

async function finishedDiscussion(running: RunningApp) {
  await seedDeepSeekRoom(running);
  await newDiscussion(running, 'E2E 讨论', '为学校设计一个校园跑腿平台的试点方案。');
  await running.page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(running.page, '已完成');
}

// SPEC: structured results are validated by Zod. A valid one needs the host's adoption before it can leave; an invalid one is kept, explained and cannot be adopted or exported.
test('a valid artifact is shown safely, adopted by the host and only then exported', async ({ harness }) => {
  const { fixture } = harness;
  fixture.reply = body => artifactOf(body) ? validPrd : `${memberOf(body)}的发言。`;
  const running = await harness.launch();
  const { page } = running;
  await finishedDiscussion(running);
  const sent = fixture.requests.length;
  await openArtifacts(page);
  await page.locator('.artifact').first().getByRole('button', { name: /生成/u }).click();
  await expect(page.locator('dialog[open] .summary-cost')).toBeVisible();
  expect(fixture.requests, 'Opening the dialog sends nothing').toHaveLength(sent);
  await page.getByRole('button', { name: '生成（发送 1 次请求）' }).click();

  const reader = page.locator('dialog.artifact-reader');
  await expect(reader).toContainText('候选 · 待采用');
  expect(fixture.requests).toHaveLength(sent + 1);
  await expect(reader).toContainText('下单与接单');
  await expect(reader.getByText('<script>window.__pwned = 1</script>', { exact: false }), 'Model HTML is plain text').toBeVisible();
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  await expect(reader.locator('script, img')).toHaveCount(0);
  await expect(reader.getByRole('button', { name: '复制 Markdown' }), 'A candidate cannot be exported yet').toHaveCount(0);
  await expect(reader.getByRole('button', { name: '另存为…' })).toHaveCount(0);

  await reader.getByRole('button', { name: '采用这一版' }).click();
  await expect(reader).toContainText('已采用');
  await reader.getByRole('button', { name: '另存为…' }).click();
  const saved = join(harness.profile, 'exports', 'prd.md');
  mkdirSync(join(harness.profile, 'exports'));
  await running.answerSave(saved);
  await reader.getByRole('group', { name: '另存为' }).getByRole('button').first().click();
  await expect.poll(() => existsSync(saved)).toBe(true);
  const text = readFileSync(saved, 'utf8');
  expect(text.startsWith('# 校园跑腿试点 PRD')).toBe(true);
  expect(text).not.toContain('只输出');
  const [rows] = harness.sql('SELECT validation FROM artifact_versions');
  expect(rows.map(row => row.validation)).toEqual(['valid']);
  await running.expectNoNetwork();
  await running.quit();
});

test('an invalid artifact is kept with its problems, cannot be adopted or exported, and is not retried', async ({ harness }) => {
  const { fixture } = harness;
  fixture.reply = body => artifactOf(body) ? invalidMinutes : `${memberOf(body)}的发言。`;
  const running = await harness.launch();
  const { page } = running;
  await finishedDiscussion(running);
  const sent = fixture.requests.length;
  await openArtifacts(page);
  const reader = await generateArtifact(page, 1);
  await expect(reader).toContainText('格式检查没有通过');
  await expect(reader).toContainText('应该是列表');
  await expect(reader).toContainText('第 7 条不在这次依据的发言里');
  await expect(reader.locator('.art-raw'), 'The raw output is kept exactly').toContainText('```json');
  for (const name of ['采用这一版', '复制 Markdown', '复制 JSON', '另存为…', '写入文件夹…']) await expect(reader.getByRole('button', { name })).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(fixture.requests, 'No automatic retry').toHaveLength(sent + 1);
  const [versions, exports] = harness.sql('SELECT validation FROM artifact_versions', 'SELECT COUNT(*) AS n FROM artifact_exports');
  expect(versions.map(row => row.validation)).toEqual(['invalid']);
  expect(exports[0].n).toBe(0);
  expect(readdirSync(harness.profile).includes('exports')).toBe(false);
  await running.quit();
});

// The toy model's output takes the same path with no fixture at all.
test('the demo members can produce a valid artifact without any network', async ({ harness }) => {
  const running = await harness.launch();
  const { page } = running;
  await page.getByRole('button', { name: '开始试玩' }).click();
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成');
  await openArtifacts(page);
  const reader = await generateArtifact(page, 2);
  await expect(reader).toContainText('Mock 行动清单');
  await expect(reader).toContainText('候选 · 待采用');
  expect(harness.fixture.requests).toHaveLength(0);
  await running.expectNoNetwork();
  await running.quit();
});
