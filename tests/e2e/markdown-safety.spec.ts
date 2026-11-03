import { memberOf } from './support/fixture';
import { expect, newDiscussion, seedDeepSeekRoom, statusHas, test } from './support/app';

const hostile = [
  '**加粗**和`行内代码`。', '', '[学校公告](https://example.edu/notice)', '',
  '[不安全的链接](javascript:window.__pwned=1) [数据链接](data:text/html,<script>window.__pwned=2</script>)', '',
  '<script>window.__pwned = 3</script>', '<img src="https://tracker.example/x.png" onerror="window.__pwned = 4">', '<iframe src="https://example.com"></iframe>', '',
  '![跟踪图片](https://tracker.example/y.png)',
].join('\n');

// SPEC/R17: model Markdown renders as text and formatting only: no script, no remote load, no unsafe link; https asks first.
test('hostile Markdown from a model cannot run, load anything or open a link without asking', async ({ harness }) => {
  const { fixture } = harness;
  fixture.reply = body => memberOf(body) === '综合者' ? hostile : '好的。';
  const running = await harness.launch();
  const { page } = running;
  await seedDeepSeekRoom(running);
  await newDiscussion(running, 'E2E 讨论', 'Markdown 安全的目标。');
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成');

  const body = page.locator('.thread-item .msg-body .md').nth(2);
  await expect(body.locator('strong')).toHaveText('加粗');
  await expect(body.locator('code').first()).toHaveText('行内代码');
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  await expect(page.locator('.md script, .md img, .md iframe, .md object, .md embed')).toHaveCount(0);
  await expect(page.locator('.md a[href^="javascript"], .md a[href^="data"]')).toHaveCount(0);

  // An https link goes through Main's native question; answering 取消 opens nothing.
  await body.getByRole('link', { name: '学校公告' }).click();
  await expect.poll(async () => (await running.state()).dialogs.asked.filter(item => item.kind === 'message').length).toBe(1);
  const state = await running.state();
  expect(state.dialogs.asked.find(item => item.kind === 'message')?.detail).toBe('https://example.edu/notice');
  expect(state.externalOpens).toEqual([]);
  // The page itself never went anywhere and loaded nothing remote.
  expect(page.url().startsWith('file://')).toBe(true);
  await running.expectNoNetwork();
  await running.quit();
});
