import { memberOf } from './support/fixture';
import { expect, memberTexts, newDiscussion, seedDeepSeekRoom, statusHas, streamed, test, projectRuns } from './support/app';

const REPLY = '这是一段写到一半就会被意外退出打断的回复，后面的字不应该出现。';

// SPEC: after a restart data is readable and an unfinished Run is interrupted; R17: nothing is sent again by itself.
test('after a crash mid-reply the data reads back, the run is interrupted and nothing is sent again', async ({ harness }) => {
  const { fixture } = harness;
  fixture.reply = () => REPLY;
  fixture.mode = 'hang';
  let running = await harness.launch();
  await seedDeepSeekRoom(running);
  await newDiscussion(running, 'E2E 讨论', '崩溃恢复的目标');
  await running.page.getByRole('button', { name: '开始讨论' }).click();
  await streamed(running.page, 0, REPLY.slice(0, 8));
  const partial = (await memberTexts(running.page).first().textContent())!;
  expect(partial.length).toBeLessThan(REPLY.length);
  expect(fixture.requests).toHaveLength(1);

  await running.kill();

  running = await harness.launch();
  const { page } = running;
  await (await projectRuns(running)).first().click();
  await statusHas(page, '已中断');
  await expect(page.getByText('执行已中断，部分输出已保留')).toBeVisible();
  await expect(page.getByText('为避免重复计费，不会自动重发')).toBeVisible();
  await expect(memberTexts(page).first()).toContainText(REPLY.slice(0, 8));

  const [[run], attempts] = harness.sql('SELECT status FROM workflow_runs', 'SELECT status FROM request_attempts');
  expect(run.status).toBe('interrupted');
  expect(attempts.map(row => row.status)).toEqual(['interrupted']);
  // Long enough for any automatic resend to show; opening the discussion is what a person would do first.
  await page.waitForTimeout(2000);
  expect(fixture.requests, 'Zero automatic resends after the restart').toHaveLength(1);

  // Giving up is the host's own choice and sends nothing either.
  await page.getByRole('button', { name: '放弃中断执行' }).click();
  await page.waitForTimeout(800);
  expect(fixture.requests).toHaveLength(1);
  await running.expectNoNetwork();
  await running.quit();
});

test('a second discussion killed mid-run is interrupted, and the earlier finished one stays intact', async ({ harness }) => {
  const { fixture } = harness;
  fixture.reply = body => `${memberOf(body)}的完整发言。`;
  let running = await harness.launch();
  await seedDeepSeekRoom(running);
  await newDiscussion(running, 'E2E 讨论', '第一场：已完成的讨论');
  await running.page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(running.page, '已完成');
  const finished = await memberTexts(running.page).allTextContents();

  fixture.mode = 'hang';
  await newDiscussion(running, 'E2E 讨论', '第二场：被杀掉的讨论');
  await running.page.getByRole('button', { name: '开始讨论' }).click();
  await streamed(running.page, 0, '起草者');
  const sent = fixture.requests.length;
  await running.kill();

  running = await harness.launch();
  const { page } = running;
  const statuses = harness.sql('SELECT status FROM workflow_runs ORDER BY created_at')[0].map(row => row.status);
  expect(statuses).toEqual(['completed', 'interrupted']);
  await (await projectRuns(running)).filter({ hasText: '第一场' }).click();
  await expect(memberTexts(page)).toHaveText(finished);
  await statusHas(page, '已完成');
  await page.waitForTimeout(1000);
  expect(fixture.requests).toHaveLength(sent);
  await running.quit();
});
