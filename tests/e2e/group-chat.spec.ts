import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, root, seedDeepSeekRoom, statusHas, test, type RunningApp } from './support/app';
import { memberOf, textIn } from './support/fixture';

// D149–D153, in the real build on an isolated profile, with the loopback service. A fixture proves the flow, not how the chat feels.
const screens = join(root, 'docs/verification/group-chat-1-screens');
const shots = Boolean(process.env.ROUNDTABLE_GROUP_CHAT_SCREENS);
let shot = 0;
/** One screenshot from the window itself, in the light and dark themes, when this run is producing the record. */
async function capture(running: RunningApp, name: string) {
  if (!shots) return;
  mkdirSync(screens, { recursive: true });
  const number = String(++shot).padStart(2, '0');
  for (const theme of ['light', 'dark'] as const) {
    await running.page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await running.page.waitForTimeout(150);
    const data = await running.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
    writeFileSync(join(screens, `${number}-${name}-${theme}.png`), Buffer.from(data, 'base64'));
  }
  await running.page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
}
const names: Array<[string, string]> = [['林舟', '产品'], ['阿哲', '工程'], ['小雨', '总结']];
const isSchedule = (body: { messages: any[] }) => textIn(body.messages[0]).includes('调度程序');
const replies = (page: RunningApp['page']) => page.locator('.thread-item article.msg:not(.is-host)');
const spoke = (page: RunningApp['page']) => page.locator('.thread-item article.msg:not(.is-host) .msg-name').allTextContents();
const open = async (running: RunningApp) => {
  const seeded = await seedDeepSeekRoom(running, '群聊房间', { chat: true, names });
  await running.page.locator('.sidebar .sb-item', { hasText: '群聊房间' }).first().click();
  await running.page.locator('.room-page').getByRole('button', { name: '新讨论' }).click();
  await expect(running.page.getByRole('heading', { name: '想和大家聊点什么？' })).toBeVisible();
  await expect(firstBox(running), 'A chat opens empty').toHaveValue('');
  return seeded;
};
const firstBox = (running: RunningApp) => running.page.getByRole('textbox', { name: '第一条消息' });
const chatBox = (running: RunningApp) => running.page.getByRole('textbox', { name: '发消息' });
const say = async (running: RunningApp, text: string) => { await chatBox(running).fill(text); await chatBox(running).press('Enter'); };
const first = async (running: RunningApp, text: string) => { await firstBox(running).fill(text); await firstBox(running).press('Enter'); };
const waiting = (running: RunningApp) => statusHas(running.page, '等你说话');

test('群聊 is the default; the four stricter ways are one click away and still work', async ({ harness }) => {
  const running = await harness.launch(); const { page } = running;
  await open(running);
  await expect(page.locator('.setup-seg [aria-pressed="true"]')).toHaveText('群聊');
  await expect(page.locator('.setup-strict')).toContainText('更严格的流程');
  await expect(page.getByRole('button', { name: '自定义流程' })).toHaveCount(0);
  await expect(page.getByText('每回合后暂停')).toHaveCount(0);
  await capture(running, 'default-group-chat');
  for (const name of ['自由讨论', '双人对话', '审查修订链', '深度辩论']) {
    await page.locator('.setup-seg').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.setup-seg [aria-pressed="true"]')).toHaveText(name);
    await expect(page.getByRole('button', { name: '开始讨论' })).toBeVisible();
  }
  await capture(running, 'strict-ways');
  // Each of them runs to its end, the old way.
  harness.fixture.reply = body => `${memberOf(body)}的发言`;
  harness.fixture.chunks = 1; harness.fixture.chunkMs = 1;
  for (const [name, turns] of [['自由讨论', 3], ['双人对话', 4], ['审查修订链', 5], ['深度辩论', 12]] as const) {
    await page.locator('.setup-seg').getByRole('button', { name, exact: true }).click();
    await page.getByRole('textbox', { name: '讨论目标' }).fill(`比较一下两个方案（${name}）`);
    await page.getByRole('button', { name: '开始讨论' }).click();
    await statusHas(page, '已完成');
    await expect(replies(page)).toHaveCount(turns);
    expect(textIn(harness.fixture.requests.at(-1)!.messages.at(-1)), 'The old way keeps its old words').toContain('贡献');
    await page.locator('.composer .controls').getByRole('button', { name: '新讨论' }).click();
  }
  expect(harness.fixture.requests.every(request => request.raw.thinking === undefined)).toBe(true);
  await running.quit();
});

test('集合开会！: everyone answers, briefly, differently, and the box stays ready', async ({ harness }) => {
  const running = await harness.launch(); const { page } = running; const { fixture } = harness;
  await open(running);
  const lines: Record<string, string> = { 林舟: '到，刚开完上一个 😄', 阿哲: '来了，是哪个方案要挑刺？', 小雨: '我在，我来记一下。' };
  fixture.reply = body => lines[memberOf(body)!]!;
  fixture.chunkMs = 60;
  await first(running, '集合开会！');
  await expect(firstBox(running)).toHaveCount(0);
  await expect(page.getByRole('status', { name: '谁在说话' })).toContainText('正在输入');
  await expect(page.getByRole('status', { name: '谁在说话' })).toContainText('已等待');
  await expect(chatBox(running)).toBeEnabled();
  await capture(running, 'gather-typing');
  await waiting(running);
  expect((await spoke(page)).sort()).toEqual(['小雨', '林舟', '阿哲']);
  expect(fixture.requests.filter(isSchedule), 'No model is asked for this').toHaveLength(0);
  expect(fixture.requests.every(request => request.raw.thinking?.type === 'disabled'), 'A quick word skips thinking').toBe(true);
  expect(textIn(fixture.requests[0]!.messages.at(-1))).toContain('别和前面的人重样');
  await capture(running, 'gather-done');
  await running.quit();
});

test('@A 写前端，@B 写后端: only they act, with an IME, and the box says who will answer', async ({ harness }) => {
  const running = await harness.launch(); const { page } = running; const { fixture } = harness;
  await open(running);
  fixture.reply = body => `${memberOf(body)}认领了`;
  await firstBox(running).click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('@');
  const menu = page.getByRole('listbox', { name: '点名成员' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option')).toHaveCount(3);
  await capture(running, 'mention-menu');
  // Enter in the middle of an IME confirms the word; it picks nobody and sends nothing.
  await running.ime('lin', '林', { enterWhileComposing: true });
  await expect(menu.getByRole('option')).toHaveCount(1);
  expect(harness.sql('SELECT COUNT(*) AS n FROM workflow_runs')[0][0].n).toBe(0);
  await page.keyboard.press('Enter');
  await expect(firstBox(running)).toHaveValue('@林舟 ');
  await running.ime('xieqianduan', '写前端，');
  await page.keyboard.type('@');
  await running.ime('azhe', '阿哲');
  await page.keyboard.press('Enter');
  await running.ime('xiehouduan', '写后端');
  await expect(firstBox(running)).toHaveValue('@林舟 写前端，@阿哲 写后端');
  await expect(page.getByRole('status', { name: '会回应的成员' })).toContainText('林舟、阿哲');
  await capture(running, 'mention-two');
  await page.keyboard.press('Enter');
  await waiting(running);
  expect(await spoke(page)).toEqual(['林舟', '阿哲']);
  expect(fixture.requests.filter(isSchedule)).toHaveLength(0);
  expect(textIn(fixture.requests[0]!.messages.at(-1))).toContain('> 写前端');
  expect(textIn(fixture.requests[1]!.messages.at(-1))).toContain('> 写后端');
  expect(fixture.requests.every(request => request.raw.thinking === undefined), 'A delivery keeps its thinking').toBe(true);
  await capture(running, 'mention-done');

  // In the chat box too: a name after Chinese words, chosen by mouse.
  await chatBox(running).click();
  await running.ime('qing', '请');
  await page.keyboard.type('@');
  await page.getByRole('listbox', { name: '点名成员' }).getByRole('option', { name: /小雨/u }).click();
  await expect(chatBox(running)).toHaveValue('请@小雨 ');
  await page.keyboard.press('Enter');
  await expect(page.locator('.thread-item article.msg:not(.is-host) .msg-name')).toHaveCount(3);
  await waiting(running);
  expect(await spoke(page)).toEqual(['林舟', '阿哲', '小雨']);
  await running.quit();
});

test('a simple question: one, briefly', async ({ harness }) => {
  const running = await harness.launch(); const { page } = running; const { fixture } = harness;
  await open(running);
  fixture.reply = () => '周三。';
  await first(running, '今天星期几？');
  await waiting(running);
  expect(await spoke(page)).toHaveLength(1);
  expect(fixture.requests.filter(isSchedule)).toHaveLength(0);
  expect(textIn(fixture.requests[0]!.messages.at(-1))).toContain('答完就停');
  const week = ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()]!;
  expect(textIn(fixture.requests[0]!.messages.find(message => textIn(message).startsWith('今天是')))).toContain(`星期${week}`);
  expect(fixture.requests[0]!.messages.some(message => message.role === 'system' && textIn(message).includes('只说有依据的事'))).toBe(true);
  await capture(running, 'simple-question');
  await running.quit();
});

test('a new message stops the reply being generated at once, keeps its words and is answered instead', async ({ harness }) => {
  const running = await harness.launch(); const { page } = running; const { fixture } = harness;
  await open(running);
  fixture.mode = body => memberOf(body) === '林舟' ? 'hang' : 'ok';
  fixture.reply = body => memberOf(body) === '林舟' ? '我先说一下我的想法，这个方案的范围应该收窄一点，因为第一期人手不够' : `${memberOf(body)}按新消息回应`;
  await first(running, '@林舟 @小雨 看看这个方案');
  await expect(replies(page).first()).toContainText('我先说');
  await capture(running, 'interrupt-before');
  await expect(page.getByRole('button', { name: '停止' })).toBeEnabled();
  await say(running, '@阿哲 先别管范围，算一下成本');
  await expect(replies(page).first()).toContainText('被打断');
  await waiting(running);
  // 小雨 was queued and stands down; 林舟 is not asked again.
  expect(await spoke(page)).toEqual(['林舟', '阿哲']);
  expect(fixture.requests.filter(request => memberOf(request as never) === '林舟')).toHaveLength(1);
  expect(textIn(fixture.requests.at(-1)!.messages.at(-1))).toContain('> 先别管范围');
  await capture(running, 'interrupt-after');
  await running.quit();
});

test('stop is one click, nothing is lost, and the next message goes on', async ({ harness }) => {
  const running = await harness.launch(); const { page } = running; const { fixture } = harness;
  await open(running);
  fixture.mode = () => 'hang';
  fixture.reply = () => '这段话会被停在这里，后面的内容不会发出来';
  await first(running, '@林舟 说说');
  await expect(replies(page).first()).toContainText('这段话');
  await page.getByRole('button', { name: '停止' }).click();
  await statusHas(page, '已停止');
  await expect(replies(page).first()).toContainText('已停止');
  await expect(page.getByText('已停止 · 已生成的文字都保留')).toBeVisible();
  await expect(page.getByRole('button', { name: '让 TA 重说' })).toBeVisible();
  await capture(running, 'stopped');
  fixture.mode = () => 'ok';
  await say(running, '@阿哲 你说');
  await waiting(running);
  expect(await spoke(page)).toEqual(['林舟', '阿哲']);
  await running.quit();
});

test('when the rules cannot tell, a fast model decides; bad JSON or a failing service changes nothing the host can see', async ({ harness }) => {
  const running = await harness.launch(); const { page } = running; const { fixture } = harness;
  await open(running);
  fixture.reply = body => isSchedule(body) ? JSON.stringify({ speakers: [{ name: '阿哲', intent: 'challenge', length: 'medium' }, { name: '小雨', intent: 'summarize', length: 'short' }] }) : `${memberOf(body)}的看法`;
  await first(running, '这个方向怎么看');
  await waiting(running);
  expect(await spoke(page)).toEqual(['阿哲', '小雨']);
  const asked = fixture.requests.filter(isSchedule);
  expect(asked).toHaveLength(1);
  expect(asked[0]!.model).toBe('deepseek-flash');
  expect(asked[0]!.maxTokens).toBeLessThanOrEqual(400);
  expect(asked[0]!.raw.thinking).toEqual({ type: 'disabled' });
  await capture(running, 'scheduled');

  // Invalid JSON.
  fixture.reply = body => isSchedule(body) ? '我觉得让阿哲来说' : `${memberOf(body)}照常回复`;
  await say(running, '换个角度又怎么看');
  await waiting(running);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await spoke(page)).length).toBe(4);
  await capture(running, 'schedule-invalid-json');

  // The service fails for the scheduling request only.
  fixture.chatError = body => (body.messages as any[])[0] && textIn(body.messages[0]).includes('调度程序') ? { status: 500, body: { error: { code: 'server_error' } } } : undefined;
  await say(running, '再换个角度怎么看');
  await waiting(running);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await spoke(page)).length).toBe(6);
  await capture(running, 'schedule-service-failed');
  fixture.chatError = undefined;

  // Usage shows it under its own purpose.
  await page.locator('.sidebar .sb-item', { hasText: '用量' }).click();
  await page.getByRole('tab', { name: '按用途' }).click();
  await expect(page.locator('table.data')).toContainText('群聊调度');
  await capture(running, 'usage-by-purpose');
  await running.quit();
});


test('a demo room chats without any network', async ({ harness }) => {
  const running = await harness.launch(); const { page } = running;
  await page.getByRole('button', { name: '开始试玩' }).click();
  await expect(page.getByRole('heading', { name: '想和大家聊点什么？' })).toBeVisible();
  await firstBox(running).fill('集合开会！');
  await page.getByRole('button', { name: '发送' }).click();
  await waiting(running);
  await expect(replies(page)).toHaveCount(3);
  const words = await page.locator('.thread-item .msg-body').allTextContents();
  expect(new Set(words).size).toBe(3);
  expect(words.join()).not.toContain('Mock');
  expect(harness.fixture.requests).toHaveLength(0);
  await capture(running, 'demo-chat');
  await running.expectNoNetwork();
  await running.quit();
});

test('twelve replies to one message is where it stops, it says so, and the next message goes on', async ({ harness }) => {
  const running = await harness.launch(); const { page } = running; const { fixture } = harness;
  const { agents, room } = await open(running);
  // Eight people in the room: the most one scheduling answer can name, and a chat that wants to go on.
  const provider = (await running.api<any[]>('settings.listProviderSummaries'))[0];
  const others = ['老周', '小唐', '阿成', '老陆', '苏苏'];
  for (const [index, displayName] of others.entries()) await running.api('rooms.createAgent', { roomId: room.id, displayName, roleTemplateId: '同事', systemPrompt: '', providerId: provider.id, modelId: 'deepseek-flash', enabled: true, displayOrder: agents.length + index });
  await page.reload(); await page.waitForSelector('.sidebar');
  fixture.chunks = 1; fixture.chunkMs = 1;
  const everyone = [...names.map(([name]) => name), ...others];
  fixture.reply = body => isSchedule(body) ? JSON.stringify({ speakers: everyone.map(name => ({ name, intent: 'reply', length: 'short' })), more: true }) : `${memberOf(body)}又说了一句`;
  await first(running, '这个方向怎么样，再想想');
  await waiting(running);
  expect(await spoke(page)).toHaveLength(12);
  expect(fixture.requests.filter(isSchedule)).toHaveLength(2);
  const notice = page.getByText('这条消息的回复到了 12 次发言的上限，大家先停下了。发新消息可以继续。');
  await expect(notice).toBeVisible();
  await capture(running, 'limit');
  fixture.reply = body => `${memberOf(body)}收到`;
  await say(running, '@阿哲 那就这样');
  await expect(notice).toHaveCount(0, { timeout: 15_000 });
  await waiting(running);
  expect(await spoke(page)).toHaveLength(13);
  await running.quit();
});

test('a group chat reads the same after a restart, and the next message goes on', async ({ harness }) => {
  let running = await harness.launch(); const { fixture } = harness;
  await open(running);
  fixture.reply = body => `${memberOf(body)}说了`;
  await first(running, '@林舟 @阿哲 看看');
  await waiting(running);
  await running.quit();
  running = await harness.launch();
  await running.page.locator('.sb-runs .sb-item').first().click();
  await waiting(running);
  expect(await spoke(running.page)).toEqual(['林舟', '阿哲']);
  await say(running, '@小雨 你也说说');
  await expect(running.page.locator('.thread-item article.msg:not(.is-host) .msg-name')).toHaveCount(3);
  await waiting(running);
  await running.quit();
});

test('a crash in the middle of a reply: its words stay, nothing is sent again, and the next message goes on', async ({ harness }) => {
  let running = await harness.launch(); const { fixture } = harness;
  await open(running);
  fixture.mode = () => 'hang';
  fixture.reply = () => '这句话说到一半应用就崩了，后面没有了';
  await first(running, '@林舟 @阿哲 看看');
  await expect(replies(running.page).first()).toContainText('这句话');
  await running.kill();
  const sent = fixture.requests.length;
  fixture.mode = () => 'ok'; fixture.reply = body => `${memberOf(body)}回来了`;
  running = await harness.launch();
  await running.page.locator('.sb-runs .sb-item').first().click();
  await statusHas(running.page, '已中断');
  await expect(replies(running.page).first()).toContainText('这句话');
  await running.page.waitForTimeout(500);
  expect(fixture.requests.length, 'Nothing goes out by itself').toBe(sent);
  await capture(running, 'after-crash');
  await say(running, '@小雨 你来说说');
  await waiting(running);
  expect(await spoke(running.page)).toEqual(['林舟', '小雨']);
  await running.quit();
});

test('typing 停止 stops everything, nobody answers, and it says so; 停止这个方案 is just talk', async ({ harness }) => {
  const running = await harness.launch(); const { page } = running; const { fixture } = harness;
  await open(running);
  fixture.mode = () => 'hang';
  fixture.reply = () => '这段话说到一半，后面还有两位排着';
  await first(running, '@林舟 @阿哲 @小雨 都看看');
  await expect(replies(page).first()).toContainText('这段话');
  const sent = fixture.requests.length;
  await say(running, '停止');
  await expect(replies(page).first()).toContainText('被打断');
  await waiting(running);
  await expect(page.getByText('大家停下了，发新消息可以继续。')).toBeVisible();
  await page.waitForTimeout(400);
  expect(fixture.requests.length, 'Nothing more goes out').toBe(sent);
  expect(await spoke(page)).toEqual(['林舟']);
  await capture(running, 'typed-stop');

  // Saying it again with nothing going on changes nothing but the chat.
  await say(running, '别说了');
  await expect(page.locator('.bubble', { hasText: '别说了' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(fixture.requests.length).toBe(sent);

  fixture.mode = () => 'ok';
  fixture.reply = body => isSchedule(body) ? JSON.stringify({ speakers: [{ name: '阿哲', intent: 'reply', length: 'medium' }] }) : `${memberOf(body)}说换一个`;
  await say(running, '停止这个方案，换一个');
  await expect(page.locator('.thread-item article.msg:not(.is-host) .msg-name')).toHaveCount(2);
  await expect(page.getByText('大家停下了，发新消息可以继续。')).toHaveCount(0);
  await running.quit();
});

test('a word like 1 gets one short reply and no model', async ({ harness }) => {
  const running = await harness.launch(); const { page } = running; const { fixture } = harness;
  await open(running);
  fixture.reply = () => '嗯，我在。';
  await first(running, '1');
  await waiting(running);
  expect(await spoke(page)).toHaveLength(1);
  expect(fixture.requests.filter(isSchedule)).toHaveLength(0);
  await capture(running, 'very-short');
  await running.quit();
});

test('一位失败，其他人照常说，等大家说完再让 TA 重说，位置不变', async ({ harness }) => {
  const running = await harness.launch(); const { page } = running; const { fixture } = harness;
  await open(running);
  let refusing = true;
  fixture.chatError = body => refusing && memberOf(body as never) === '林舟' ? { status: 500, body: { error: { code: 'server_error' } } } : undefined;
  fixture.reply = body => memberOf(body) === '林舟' ? '林舟重说了一句。' : `${memberOf(body)}照常说了一句。`;
  await first(running, '集合开会！');
  await waiting(running);
  expect((await spoke(page)).sort()).toEqual(['小雨', '林舟', '阿哲']);
  const failed = replies(page).filter({ hasText: '林舟' });
  await expect(failed.getByRole('button', { name: '让 TA 重说' })).toBeEnabled();
  await expect(failed).toContainText('server_error');
  await expect(failed, 'Nothing was said, so it does not claim to keep anything').not.toContainText('部分输出已保留');
  await expect(failed).not.toContainText('没有生成文字');
  await expect(page.getByRole('heading', { name: '运行失败' })).toHaveCount(0);
  await capture(running, 'one-failed');
  const before = await spoke(page);
  const count = fixture.requests.length;
  refusing = false;
  await failed.getByRole('button', { name: '让 TA 重说' }).click();
  await expect(failed).toContainText('林舟重说了一句。');
  await waiting(running);
  expect(await spoke(page), 'Everyone stays where they were').toEqual(before);
  expect(fixture.requests.length, 'One request: nobody else speaks and no model is asked').toBe(count + 1);
  await expect(failed.getByRole('button', { name: '让 TA 重说' })).toHaveCount(0);
  await capture(running, 'one-failed-retried');
  await running.quit();
});

test('这个方向大家怎么看：所有人都回应，不调度', async ({ harness }) => {
  const running = await harness.launch(); const { page } = running; const { fixture } = harness;
  await open(running);
  fixture.reply = body => `${memberOf(body)}说说自己的看法。`;
  await first(running, '这个方向大家怎么看：做一个校园二手平台');
  await waiting(running);
  expect((await spoke(page)).sort()).toEqual(['小雨', '林舟', '阿哲']);
  expect(fixture.requests.filter(isSchedule)).toHaveLength(0);
  expect(fixture.requests.every(request => request.raw.thinking === undefined), 'A few sentences keep their thinking').toBe(true);
  await capture(running, 'everyone-asked');
  await running.quit();
});
