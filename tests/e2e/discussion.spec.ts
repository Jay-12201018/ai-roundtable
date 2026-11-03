import { expect, memberTexts, statusHas, statusLine, test, threadItems } from './support/app';

// SPEC: three Mock Agents finish a discussion in one room, shown live and stored in SQLite. First use, real clicks.
test('three Mock members finish one discussion in one room, shown live and stored in SQLite', async ({ harness }) => {
  const running = await harness.launch();
  const { page } = running;
  await page.getByRole('button', { name: '开始试玩' }).click();
  await expect(page.getByText('这场讨论要解决什么？')).toBeVisible();

  const goal = page.getByRole('textbox', { name: '讨论目标' });
  await goal.click();
  await page.keyboard.press('Meta+A');
  await running.ime('xiaoyuan', '为学校设计一个校园跑腿平台的试点方案。', { enterWhileComposing: true });
  await expect(goal).toHaveValue('为学校设计一个校园跑腿平台的试点方案。');
  expect(harness.sql('SELECT COUNT(*) AS n FROM workflow_runs')[0][0].n, 'An IME Enter starts nothing').toBe(0);
  await page.getByRole('button', { name: '开始讨论' }).click();

  // Live: one reply is seen growing on screen while the run is in progress.
  const seen = new Set<number>();
  await expect.poll(async () => {
    seen.add((await memberTexts(page).first().textContent().catch(() => ''))?.length ?? 0);
    return seen.size;
  }, { intervals: [20], timeout: 10_000 }).toBeGreaterThanOrEqual(3);

  await statusHas(page, '已完成');
  await expect(threadItems(page)).toHaveCount(3);
  const shown = await memberTexts(page).allTextContents();
  expect(shown[0]).toContain('Mock 起草');
  expect(shown[1]).toContain('Mock 审查');
  expect(shown[2]).toContain('Mock 定稿');
  await expect(page.locator('.msg-name')).toHaveText(['起草者', '审查者', '综合者']);
  // What the side panel says about money and requests is true for demo members.
  await expect(page.locator('.run-panel')).toContainText('演示成员不联网、不花钱');
  await expect(page.locator('.run-panel')).not.toContainText('DeepSeek');
  await expect(page.locator('.run-panel')).not.toContainText('真实请求');

  // Stored while the app still runs: the same text, in order, in one room.
  const [runs, messages, turns] = harness.sql(
    'SELECT id, room_id, status FROM workflow_runs',
    "SELECT sender_name, content, status, room_id FROM messages WHERE sender_type <> 'host' ORDER BY created_at, rowid",
    'SELECT status, turn_index FROM turns ORDER BY turn_index');
  expect(runs).toHaveLength(1);
  expect(runs[0].status).toBe('completed');
  expect(messages.map(row => row.sender_name)).toEqual(['起草者', '审查者', '综合者']);
  expect(messages.map(row => row.content)).toEqual(shown);
  expect(new Set(messages.map(row => row.room_id))).toEqual(new Set([runs[0].room_id]));
  expect(turns.map(row => row.status)).toEqual(['completed', 'completed', 'completed']);
  await running.expectNoNetwork();
  await running.quit();
});

test('a discussion survives a normal quit and reads the same after reopening', async ({ harness }) => {
  let running = await harness.launch();
  await running.page.getByRole('button', { name: '开始试玩' }).click();
  await running.page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(running.page, '已完成');
  const shown = await memberTexts(running.page).allTextContents();
  await running.quit();

  running = await harness.launch();
  await expect(running.page.locator('.welcome'), 'Not first use any more').toHaveCount(0);
  await running.page.locator('.sb-runs .sb-item').first().click();
  await expect(memberTexts(running.page)).toHaveText(shown);
  await expect(statusLine(running.page)).toContainText('已完成');
  await running.quit();
});
