import { memberOf } from './support/fixture';
import { expect, memberTexts, newDiscussion, seedDeepSeekRoom, statusHas, streamed, test, threadItems } from './support/app';

const replies: Record<string, string> = {
  起草者: '起草者的完整方案：范围三栋楼，试点四周，基础费两元。',
  审查者: '审查者的完整意见：抽成偏高，夜间安全没有保障。',
  综合者: '综合者的完整结论：抽成八个点，晚上十点后暂停接单。',
};
const GOAL = '为学校设计一个校园跑腿平台的试点方案。';

// SPEC: any Turn can be stopped and its partial text stays. The fixture holds the chosen member's reply half way, so
// the stop lands mid-stream every time; it shares the path every Provider's chunks take.
for (const [index, member] of ['起草者', '审查者', '综合者'].entries()) {
  test(`stop during turn ${index + 1} (${member}) keeps its partial text and runs nobody after it`, async ({ harness }) => {
    const { fixture } = harness;
    fixture.reply = body => replies[memberOf(body)!] ?? '好的。';
    fixture.mode = body => memberOf(body) === member ? 'hang' : 'ok';
    const running = await harness.launch();
    const { page } = running;
    await seedDeepSeekRoom(running);
    await newDiscussion(running, 'E2E 讨论', GOAL);
    await page.getByRole('button', { name: '开始讨论' }).click();

    const partial = replies[member]!.slice(0, 5);
    await streamed(page, index, partial);
    await page.getByRole('button', { name: '停止' }).click();
    const confirm = page.getByRole('dialog', { name: '确认停止运行' });
    await expect(confirm).toContainText(`${member}正在发言`);
    await confirm.getByRole('button', { name: '停止讨论' }).click();
    await statusHas(page, '已停止');

    await expect(page.getByText('已停止 · 已生成的文字都保留')).toBeVisible();
    await expect(threadItems(page)).toHaveCount(index + 1);
    const shown = (await memberTexts(page).nth(index).textContent())!;
    expect(shown.startsWith(partial) && shown.length < replies[member]!.length, `Partial: ${shown}`).toBe(true);

    const [[run], messages] = harness.sql('SELECT status FROM workflow_runs', "SELECT content, status FROM messages WHERE sender_type <> 'host' ORDER BY created_at, rowid");
    expect(run.status).toBe('cancelled');
    expect(messages).toHaveLength(index + 1);
    expect(messages.at(-1).content).toBe(shown);
    // Nothing runs after the stop, even with the held reply let go.
    fixture.release();
    await page.waitForTimeout(800);
    expect(fixture.requests).toHaveLength(index + 1);
    await running.expectNoNetwork();
    await running.quit();
  });
}

// SPEC: the host can name the next Agent with @.
test('the host names the next speaker with @, through the IME, and that member speaks next', async ({ harness }) => {
  const { fixture } = harness;
  fixture.reply = body => replies[memberOf(body)!] ?? '好的。';
  fixture.mode = 'hang';
  const running = await harness.launch();
  const { page } = running;
  const { agents } = await seedDeepSeekRoom(running);
  await newDiscussion(running, 'E2E 讨论', GOAL);
  await page.getByRole('button', { name: '开始讨论' }).click();
  await streamed(page, 0, '起草者');

  await page.locator('.chip', { hasText: '点名' }).click();
  await expect(page.getByRole('listbox', { name: '点名下一位' })).toBeVisible();
  const box = page.getByRole('textbox', { name: '主持人插话' });
  await expect(box, 'The chip hands the caret to the box, as a person would see it').toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(box).toHaveValue(/^@综合者 /u);
  await running.ime('zhongdian', '请重点算一下骑手收入。', { enterWhileComposing: true });
  expect(fixture.requests, 'An IME Enter sends nothing').toHaveLength(1);
  await page.keyboard.press('Enter');
  await expect(page.getByText('已点名综合者并发送插话')).toBeVisible();

  fixture.mode = 'ok';
  fixture.release();
  await statusHas(page, '已完成');
  await expect(page.locator('.msg-name').nth(1)).toHaveText('综合者');
  const asked = fixture.requests[1]!;
  expect(memberOf(asked as never)).toBe('综合者');
  expect(JSON.stringify(asked.messages)).toContain('请重点算一下骑手收入。');
  const snapshot = await running.page.evaluate(() => (window as any).roundtable.run.getSnapshot(localStorage.getItem('roundtable.runId')));
  expect(snapshot.turns[1].agentId).toBe(agents[2].id);
  expect(snapshot.turns[1].overrideActionId).toBeTruthy();
  expect(snapshot.messages.some((message: { content: string }) => message.content === '@综合者 请重点算一下骑手收入。')).toBe(true);
  await running.expectNoNetwork();
  await running.quit();
});

// SPEC: a Run can be stepped, paused and resumed.
test('pause lets the current turn finish, step runs exactly one more, resume runs to the end', async ({ harness }) => {
  const { fixture } = harness;
  fixture.reply = body => replies[memberOf(body)!] ?? '好的。';
  fixture.mode = 'hang';
  const running = await harness.launch();
  const { page } = running;
  await seedDeepSeekRoom(running);
  await newDiscussion(running, 'E2E 讨论', GOAL);
  await page.getByRole('button', { name: '开始讨论' }).click();
  await streamed(page, 0, '起草者');

  await page.getByRole('button', { name: '暂停' }).click();
  await statusHas(page, '正在暂停');
  fixture.mode = 'ok';
  fixture.release();
  await statusHas(page, '已暂停');
  await expect(memberTexts(page)).toHaveText([replies.起草者!]);
  await page.waitForTimeout(600);
  expect(fixture.requests, 'Paused: nothing further is sent').toHaveLength(1);

  await page.getByRole('button', { name: '下一步' }).click();
  await expect(memberTexts(page)).toHaveText([replies.起草者!, replies.审查者!]);
  await statusHas(page, '已暂停');
  await page.waitForTimeout(600);
  expect(fixture.requests, 'Exactly one step').toHaveLength(2);

  await page.getByRole('button', { name: '继续' }).click();
  await statusHas(page, '已完成');
  await expect(memberTexts(page)).toHaveText([replies.起草者!, replies.审查者!, replies.综合者!]);
  expect(fixture.requests).toHaveLength(3);
  const [[run], turns] = harness.sql('SELECT status FROM workflow_runs', 'SELECT status FROM turns ORDER BY turn_index');
  expect(run.status).toBe('completed');
  expect(turns.map(row => row.status)).toEqual(['completed', 'completed', 'completed']);
  await running.expectNoNetwork();
  await running.quit();
});
