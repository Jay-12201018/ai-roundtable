import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { artifactOf, memberOf } from './support/fixture';
import { FAKE_KEY, expect, generateArtifact, memberTexts, newDiscussion, openArtifacts, root, statusHas, test, threadItems, type RunningApp } from './support/app';

// D134: one discussion across four services, connected through the real wizard, each member on its own model. With
// ROUNDTABLE_E2E_SCREENS set it also keeps a screenshot per step, in the light and dark themes, at 1280 and 800 wide.
const screens = process.env.ROUNDTABLE_E2E_SCREENS ? join(root, process.env.ROUNDTABLE_E2E_SCREENS) : undefined;
const captions: Array<{ file: string; caption: string }> = [];
let shot = 0;

/** Every line of text a person could read now that names money, with where it sits. */
const moneyWords = (page: Page) => page.evaluate(() => {
  const found: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (/[¥￥]|预算|花费|金额|价格|核销|预留|结算|元\b/u.test(text)) found.push(text.trim());
  }
  for (const element of document.querySelectorAll('[title],[aria-label],[placeholder]')) for (const name of ['title', 'aria-label', 'placeholder']) {
    const text = element.getAttribute(name) ?? '';
    if (/[¥￥]|预算|花费|金额|价格|核销|预留|结算/u.test(text)) found.push(text);
  }
  return found;
});

async function capture(running: RunningApp, name: string, caption: string) {
  // Whatever is on screen at a step, the money check runs on it, with or without screenshots.
  expect(await moneyWords(running.page), `No money words on: ${name}`).toEqual([]);
  if (!screens) return;
  await running.page.waitForTimeout(250);
  const base64 = await running.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
  const file = `${String(++shot).padStart(2, '0')}-${name}.png`;
  mkdirSync(screens, { recursive: true });
  writeFileSync(join(screens, file), Buffer.from(base64, 'base64'));
  captions.push({ file, caption });
}

async function size(running: RunningApp, width: number, height = 800) {
  await running.app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0]!.setContentSize(w!, h!); }, [width, height]);
  await expect.poll(() => running.page.evaluate(() => window.innerWidth)).toBe(width);
}
// The attribute the 外观 setting writes; choosing it in the settings page is covered by the R16 acceptance.
const theme = (running: RunningApp, value: 'light' | 'dark') => running.page.evaluate(value => { document.documentElement.dataset.theme = value; }, value);

async function wizard(running: RunningApp, service: RegExp, connected: string, shots?: { choose?: string; key?: string; done?: string }) {
  const { page } = running;
  await page.getByRole('button', { name: service }).click();
  if (shots?.choose) await capture(running, shots.choose, '向导第 1 步：选择服务。卡片只写是什么服务，没有价格和“未审核”。');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('textbox', { name: 'API Key' }).fill(FAKE_KEY);
  if (shots?.key) await capture(running, shots.key, '向导第 2 步：地址写在 Key 上方，保存即确认；写明费用由服务商收取、应用不估算。');
  await page.getByRole('button', { name: '保存并连接' }).click();
  await expect(page.getByRole('heading', { name: connected })).toBeVisible();
  await expect(page.getByText('Key 有效')).toBeVisible();
  await expect(page.getByText(/可以用于讨论/u)).toBeVisible();
  if (shots?.done) await capture(running, shots.done, '向导第 3 步：用模型列表接口核对 Key，没有生成内容；模型马上可以用于讨论。');
}

async function changeMember(running: RunningApp, name: string, option: string) {
  const { page } = running;
  await page.getByRole('button', { name: `「${name}」：编辑、排序、归档、删除` }).click();
  await page.getByRole('menuitem', { name: /编辑/u }).click();
  await page.getByLabel('模型').selectOption({ label: option });
  await page.locator('dialog[open]').getByRole('button', { name: '保存' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

test('three members on three services, a fourth on Gemini: discuss, name, pause, continue, summarize, write an artifact, read the usage', async ({ harness }) => {
  test.setTimeout(240_000);
  const { fixture } = harness;
  fixture.reply = body => {
    const kind = artifactOf(body);
    if (kind) return JSON.stringify({ title: '行动清单', items: [{ id: 'A1', task: '整理问卷', owner: null, due: null, status: 'todo', sources: [1] }] });
    if (body.messages.at(-1)?.content.includes('【请写摘要】') || JSON.stringify(body.messages).includes('【请写摘要】')) return '要点：先试点，后推广。';
    return `${memberOf(body) ?? '成员'}（${body.service} · ${body.model}）审计了上一位的说法。`;
  };
  const running = await harness.launch();
  const { page } = running;
  await theme(running, 'light');

  await capture(running, 'welcome', '首次启动：欢迎页写明支持哪些服务、三位成员可以各用一家、费用由服务商收取。');
  await expect(page.getByText(/支持 DeepSeek、OpenAI、Anthropic Claude、Google Gemini/u)).toBeVisible();
  await page.getByRole('button', { name: '连接…' }).click();
  await wizard(running, /^DeepSeek/u, 'DeepSeek 已连接', { choose: 'wizard-choose', key: 'wizard-key', done: 'wizard-done' });
  await page.getByRole('button', { name: '稍后再说' }).click();
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  for (const [service, title] of [[/^OpenAI/u, 'OpenAI 已连接'], [/^Anthropic Claude/u, 'Anthropic Claude 已连接'], [/^Google Gemini/u, 'Google Gemini 已连接']] as const) {
    await page.getByRole('button', { name: /添加服务|连接|添加模型服务/u }).first().click();
    await wizard(running, service, title);
    await page.getByRole('button', { name: '稍后再说' }).click();
  }
  await expect(page.getByRole('region', { name: 'OpenAI' })).toContainText('可以使用');
  await capture(running, 'services', '设置 › 模型服务：四家都可以使用，按模型写明上下文和最大输出。');

  // A model's limits are the host's to change.
  await page.getByRole('button', { name: '展开 DeepSeek' }).click().catch(() => undefined);
  const card = page.getByRole('region', { name: 'DeepSeek' });
  await card.getByRole('button', { name: 'DeepSeek Flash 的上限' }).click();
  await card.getByLabel('上下文长度（token）').fill('200000');
  await card.getByLabel('最大输出（token）').fill('999999999');
  await expect(card.getByRole('alert')).toContainText('上下文长度');
  await card.getByLabel('最大输出（token）').fill('16000');
  await capture(running, 'model-limits', '模型设置：上下文长度和最大输出可以改；默认值保守，写明为什么。');
  await card.getByRole('button', { name: '保存' }).click();
  await expect(card).toContainText('上下文 200,000 · 最大输出 16,000');

  // The wizard made the first room, every member on DeepSeek. Give each its own service; a fourth takes Gemini.
  const rooms = await running.api<{ name: string }[]>('rooms.listRooms');
  const roomName = rooms[0]!.name;
  await page.locator('.sidebar .sb-item', { hasText: roomName }).first().click();
  await changeMember(running, '审查者', 'OpenAI · GPT-6 Astra（gpt-6-astra）');
  await changeMember(running, '综合者', 'Anthropic Claude · Claude Opus 5.5（claude-opus-5-5）');
  await page.getByRole('button', { name: '添加成员' }).click();
  await page.getByRole('button', { name: /^反方/u }).click();
  await page.getByLabel('模型').selectOption({ label: 'Google Gemini · Gemini 3.8 Flash（gemini-3.8-flash）' });
  await capture(running, 'member-model', '添加成员：每位成员独立选“服务 + 模型”。');
  await page.locator('dialog[open]').getByRole('button', { name: '添加' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await capture(running, 'room', '房间：四位成员各用一家，都写着“可以使用”。');

  // A discussion: the first reply is held so 暂停 and 点名 happen as a person would do them.
  await newDiscussion(running, roomName, '交叉审计校园跑腿的试点方案。');
  await expect(page.getByText(/自由讨论 · 4 回合/u).first(), 'The label says what will happen with four members').toBeVisible();
  await capture(running, 'composer', '开始前：输入框没有预算项；底部只说一句费用由服务商收取、这里不估算。');
  await page.getByRole('button', { name: '更多设置' }).click();
  await capture(running, 'more-settings', '更多设置：只剩单次发言上限，说明思考也算在内、超过模型上限时按模型上限发送。');
  await page.keyboard.press('Escape');
  fixture.mode = 'hang';
  await page.getByRole('button', { name: '开始讨论' }).click();
  await expect(memberTexts(page).first()).toContainText('起草者');
  await capture(running, 'streaming', '运行中：标题栏没有预算胶囊，正在发言的成员不显示任何金额。');
  await page.getByRole('button', { name: '暂停' }).click();
  await statusHas(page, '正在暂停');
  fixture.mode = 'ok';
  fixture.release();
  await statusHas(page, '已暂停');
  await capture(running, 'paused', '暂停：这一回合说完才停。发言页脚显示 token 数；点开是输入、输出和缓存命中。');

  await page.locator('.chip', { hasText: '点名' }).click();
  const box = page.getByRole('textbox', { name: '主持人插话' });
  await expect(page.getByRole('listbox', { name: '点名下一位' })).toBeVisible();
  await page.getByRole('option', { name: /综合者/u }).click();
  await expect(box).toHaveValue(/^@综合者 /u);
  await running.ime('heshi', '请核实上一位的说法。');
  await page.keyboard.press('Enter');
  await expect(page.getByText('已点名综合者并发送插话')).toBeVisible();
  await capture(running, 'named', '点名综合者（用 Anthropic）：插话和点名都进入公共历史。');
  await page.getByRole('button', { name: '继续' }).click();
  await statusHas(page, '已完成', 60_000);
  await capture(running, 'finished', '讨论结束：四家模型依次发言，都显示 token 用量，没有金额。');

  // Each service got its own parameter and format.
  const sent = fixture.requests.filter(request => request.model !== '');
  const by = (service: string) => sent.find(request => request.service === service)!;
  expect(by('deepseek').raw).toMatchObject({ model: 'deepseek-flash', max_tokens: 8192, thinking: { type: 'disabled' } });
  expect(by('openai').raw).toMatchObject({ model: 'gpt-6-astra', max_completion_tokens: 8192 });
  expect(by('openai').raw).not.toHaveProperty('max_tokens');
  expect(by('anthropic').raw).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 8192 });
  expect(by('gemini').raw.generationConfig).toMatchObject({ maxOutputTokens: 8192 });
  // The last speaker read everyone else's words as public text.
  const lastGemini = sent.filter(request => request.service === 'gemini').at(-1)!;
  expect(JSON.stringify(lastGemini.messages)).toContain('deepseek · deepseek-flash');
  expect(JSON.stringify(lastGemini.messages)).toContain('openai · gpt-6-astra');
  expect(JSON.stringify(lastGemini.messages)).toContain('anthropic · claude-opus-5-5');

  // A usage row for each, and a message shows its tokens.
  await page.locator('.usage-tag').first().click();
  await expect(page.getByRole('region', { name: '请求详情' }).first()).toContainText('输入 300（缓存命中 100） / 输出 6 tokens');
  await capture(running, 'request-details', '点 token 数：请求详情只有用量，没有计价。');

  // Summary and artifact: nothing is sent until the host clicks.
  if (!(await page.locator('.run-panel').isVisible())) await page.getByRole('button', { name: '本场信息' }).click();
  await page.getByRole('tab', { name: /^进度/u }).click();
  await expect(page.locator('.run-panel')).toContainText('费用由服务商收取，这里不估算');
  await capture(running, 'panel', '本场信息 › 进度：用量一行取代原来的预算卡片；没有空卡片。');
  const before = fixture.requests.length;
  await page.getByRole('button', { name: '生成讨论摘要…' }).click();
  await expect(page.locator('dialog[open] .summary-send')).toContainText('费用由服务商收取');
  await capture(running, 'summary-dialog', '生成摘要：选范围和成员；发送前不估算花费，只说会发 1 次请求。');
  expect(fixture.requests, 'Opening the dialog sends nothing').toHaveLength(before);
  await page.locator('dialog[open]').getByRole('button', { name: '生成摘要（发送 1 次请求）' }).click();
  await expect(page.getByRole('button', { name: '确认使用' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '确认使用' }).click();
  await expect(page.getByText(/之后的发言用它代替原文/u).first()).toBeVisible();
  await capture(running, 'summary', '摘要已确认：请求由综合者的模型完成，计入用量。');

  await openArtifacts(page);
  await capture(running, 'artifacts', '本场信息 › 产物：每次生成发送 1 次请求，不再说预计花费。');
  const reader = await generateArtifact(page, 2);
  await expect(reader).toContainText('待采用', { timeout: 30_000 });
  await capture(running, 'artifact', '产物：格式检查通过后等主持人采用。');
  await page.keyboard.press('Escape');

  // Usage page: tokens by discussion, model, date and purpose; CSV; no money.
  await page.locator('.sidebar .sb-item', { hasText: '用量' }).click();
  await expect(page.getByRole('heading', { name: '用量', exact: true })).toBeVisible();
  await expect(page.getByText(/费用由服务商收取，请到服务商控制台查看账单；这里不估算/u)).toBeVisible();
  await capture(running, 'usage-run', '用量页 · 按讨论：只有请求数和 token；写明费用由服务商收取。');
  await page.getByRole('tab', { name: '按模型' }).click();
  for (const model of ['deepseek-flash', 'gpt-6-astra', 'claude-opus-5-5', 'gemini-3.8-flash']) await expect(page.getByRole('table')).toContainText(model);
  await capture(running, 'usage-model', '用量页 · 按模型：四家分别汇总。');
  await page.getByRole('tab', { name: '按用途' }).click();
  await expect(page.getByRole('table')).toContainText('讨论摘要');
  await expect(page.getByRole('table')).toContainText('产物');
  await capture(running, 'usage-kind', '用量页 · 按用途：发言、摘要、产物分开。');
  const csv = join(harness.profile, 'usage.csv');
  await running.answerSave(csv);
  await page.getByRole('button', { name: '导出 CSV' }).click();
  await expect.poll(() => readdirSync(harness.profile)).toContain('usage.csv');
  const exported = readFileSync(csv, 'utf8');
  expect(exported).toContain('输入tokens');
  expect(exported).not.toMatch(/金额|单价|预留|核销|¥/u);

  // Dark theme and the narrow window, on the pages a person keeps open.
  await theme(running, 'dark');
  await capture(running, 'usage-dark', '深色主题：用量页。');
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  await capture(running, 'services-dark', '深色主题：模型服务。');
  await size(running, 800);
  await capture(running, 'services-800-dark', '800 宽、深色：模型服务没有横向滚动。');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No horizontal scroll at 800').toBe(true);
  await theme(running, 'light');
  await capture(running, 'services-800', '800 宽、浅色：模型服务。');
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.locator('.sb-item', { hasText: '用量' }).click();
  await capture(running, 'usage-800', '800 宽、浅色：用量页。');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No horizontal scroll at 800').toBe(true);
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.locator('.sb-run, .sb-item').filter({ hasText: '交叉审计' }).first().click();
  await expect(threadItems(page).first()).toBeVisible();
  await capture(running, 'discussion-800', '800 宽、浅色：讨论页。');
  await theme(running, 'dark');
  await capture(running, 'discussion-800-dark', '800 宽、深色：讨论页。');
  await size(running, 1280);
  await capture(running, 'discussion-dark', '1280 宽、深色：讨论页。');
  await theme(running, 'light');

  await running.expectNoNetwork();
  if (screens) writeFileSync(join(screens, 'captions.json'), JSON.stringify(captions, null, 1));
  await running.quit();
});
