import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { artifactOf, memberOf } from './support/fixture';
import { FAKE_KEY, expect, generateArtifact, memberTexts, newDiscussion, openArtifacts, root, seedDeepSeekRoom, statusHas, test, threadItems, type RunningApp } from './support/app';

// D134/D143: one discussion across several catalog services, connected through the real wizard, each member on its own
// model. With ROUNDTABLE_E2E_SCREENS set it also keeps the screenshots named in
// `kept`, in the light and dark themes.
const screens = process.env.ROUNDTABLE_E2E_SCREENS ? join(root, process.env.ROUNDTABLE_E2E_SCREENS) : undefined;
const kept = new Set(['welcome', 'wizard-choose', 'wizard-key', 'first-discussion', 'services', 'room', 'paused', 'finished', 'summary', 'artifact', 'usage-run',
  'settings-sections', 'services-dark', 'wizard-choose-dark', 'wizard-key-dark', 'discussion-dark', 'usage-dark',
  'stopped-service', 'stopped-member', 'stopped-service-dark', 'stopped-member-dark', 'thinking-wait', 'quota-used-up', 'quota-regenerated']);
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
  if (!screens || !kept.has(name)) return;
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

/** Pick a service, paste a Key, keep or pick a model from its list, save. That is the whole path (D136, D143). */
async function connect(running: RunningApp, service: RegExp, shots?: { form?: string; test?: string }) {
  const { page } = running;
  await page.getByRole('button', { name: service }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('textbox', { name: 'API Key' }).fill(FAKE_KEY);
  // The Key is the only thing to type: no address, no model name, and the model is a list.
  await expect(dialog.getByRole('textbox')).toHaveCount(1);
  await expect(dialog.getByRole('combobox', { name: '模型' })).toBeVisible();
  if (shots?.form) await capture(running, shots.form, '贴 Key：写明 Key 只会发往哪里、费用由谁收取；模型从列表里选。保存就能用，没有填地址或模型名的地方。');
  if (shots?.test) {
    await page.getByRole('button', { name: '测试连接' }).click();
    await expect(page.getByText('已收到回复，连接正常')).toBeVisible();
    await capture(running, shots.test, '测试连接是可选的：发一条很短的消息，结果写在按钮旁边。');
  }
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

async function changeMember(running: RunningApp, name: string, option: string) {
  const { page } = running;
  await page.getByRole('button', { name: `「${name}」：编辑、排序、归档、删除` }).click();
  await page.getByRole('menuitem', { name: /编辑/u }).click();
  await page.getByLabel('模型').selectOption({ label: option });
  await page.locator('dialog[open]').getByRole('button', { name: '保存' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

async function addMember(running: RunningApp, role: RegExp, name: string, option: string, shot?: string) {
  const { page } = running;
  await page.getByRole('button', { name: '添加成员' }).click();
  await page.getByRole('button', { name: role }).click();
  await page.getByLabel('名字').fill(name);
  await page.getByLabel('模型').selectOption({ label: option });
  if (shot) await capture(running, shot, '添加成员：每位成员独立选“服务 + 模型”。');
  await page.locator('dialog[open]').getByRole('button', { name: '添加' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

/** What a discussion sent: the eight-token connection test is not part of one. */
const discussionRequests = <T extends { maxTokens: number }>(fixture: { requests: T[] }) => fixture.requests.filter(request => request.maxTokens !== 8);

const noSideScroll = (running: RunningApp) => running.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('paste a Key, start a discussion, then mix several services: name, pause, summarize, revoke, write an artifact, read the usage', async ({ harness }) => {
  test.setTimeout(240_000);
  const { fixture } = harness;
  fixture.reply = body => {
    const kind = artifactOf(body);
    if (kind) return JSON.stringify({ title: '行动清单', items: [{ id: 'A1', task: '整理问卷', owner: null, due: null, status: 'todo', sources: [1] }] });
    if (JSON.stringify(body.messages).includes('【请写摘要】')) return '要点：先试点，后推广。';
    return `${memberOf(body) ?? '成员'}（${body.service} · ${body.model}）审计了上一位的说法。`;
  };
  const running = await harness.launch();
  const { page } = running;
  await theme(running, 'light');

  // The shortest path: paste a Key and the discussion is right there.
  await capture(running, 'welcome', '首次启动：欢迎页写明支持哪些服务、几位成员可以各用一家、费用由服务商收取。');
  await expect(page.getByText('支持国内主流大模型：DeepSeek、豆包、通义千问、Kimi、智谱 GLM、百度文心、腾讯混元、MiniMax。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '连接…' }).click();
  const offered = await page.locator('dialog[open] .choice-grid button').allTextContents();
  ['DeepSeek', '豆包', '通义千问', 'Kimi', '智谱 GLM', '百度文心', '腾讯混元', 'MiniMax', '演示'].forEach((name, index) => expect(offered[index]).toContain(name));
  expect(offered).toHaveLength(9);
  await capture(running, 'wizard-choose', '选服务：八家国内服务，DeepSeek 排第一并标推荐；另有不联网的演示。没有自定义。');
  await connect(running, /^DeepSeek/u, { form: 'wizard-key', test: 'wizard-tested' });
  await expect(page.getByRole('heading', { name: '这场讨论要解决什么？' })).toBeVisible();
  await expect(page.getByText('3 位成员', { exact: false }).first()).toBeVisible();
  await capture(running, 'first-discussion', '保存后直接到第一场讨论：房间和三位成员已经建好，写下目标就能开始。');

  // Three more services, the same way.
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  for (const service of [/^Kimi/u, /^智谱 GLM/u, /^豆包/u]) {
    await page.getByRole('button', { name: '添加服务' }).click();
    await connect(running, service);
  }
  for (const name of ['Kimi', '智谱 GLM', '豆包']) await expect(page.getByRole('region', { name, exact: true })).toContainText('可以使用');
  expect(discussionRequests(fixture), 'Saving sends nothing').toEqual([]);
  await capture(running, 'services', '设置 › 模型服务：四个服务都可以使用，保存时没有发任何请求。');
  // Settings is services, appearance and privacy.
  for (const name of ['模型服务', '外观', '数据与隐私']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '网络', exact: true })).toHaveCount(0);
  await capture(running, 'settings-sections', '设置只有模型服务、外观、数据与隐私。');

  // A model's limits are the host's to change.
  await page.getByRole('button', { name: '展开 DeepSeek' }).click().catch(() => undefined);
  const card = page.getByRole('region', { name: 'DeepSeek' });
  // Nothing here takes an address or a model name either.
  await expect(card.getByRole('textbox')).toHaveCount(0);
  for (const name of ['手动添加模型', '从服务商获取列表']) await expect(card.getByRole('button', { name })).toHaveCount(0);
  await card.getByText('高级与删除').click();
  await expect(card.getByRole('textbox')).toHaveCount(1);
  await expect(card.getByLabel('服务名称')).toBeVisible();
  await card.getByText('高级与删除').click();
  await card.getByRole('button', { name: 'DeepSeek Flash 的上限' }).click();
  await card.getByLabel('上下文长度（token）').fill('200000');
  await card.getByLabel('最大输出（token）').fill('999999999');
  await expect(card.getByRole('alert')).toContainText('上下文长度');
  await card.getByLabel('最大输出（token）').fill('8192');
  await card.getByRole('button', { name: '保存' }).click();
  await expect(card).toContainText('上下文 200,000 · 最大输出 8,192');

  // The wizard made the first room, every member on DeepSeek. Give the others their own service.
  const rooms = await running.api<{ name: string }[]>('rooms.listRooms');
  const roomName = rooms[0]!.name;
  await page.locator('.sidebar .sb-item', { hasText: roomName }).first().click();
  await changeMember(running, '审查者', 'Kimi · Kimi K3.1 Pro（kimi-k3.1-pro）');
  await changeMember(running, '综合者', '智谱 GLM · GLM-5.3（glm-5.3）');
  await addMember(running, /^反方/u, '反方', '豆包 · Doubao Seed 2.1 Pro（doubao-seed-2-1-pro-260915）');
  await capture(running, 'room', '房间：四位成员各用一家服务，都写着“可以使用”。');

  // The first reply is held so 暂停 and 点名 happen as a person would do them.
  await newDiscussion(running, roomName, '交叉审计校园跑腿的试点方案。');
  await expect(page.getByText(/自由讨论 · 4 回合/u).first(), 'The label says what will happen with four members').toBeVisible();
  await capture(running, 'composer', '开始前：输入框没有预算项；底部只说一句费用由服务商收取、这里不估算。');
  fixture.mode = 'hang';
  await page.getByRole('button', { name: '开始讨论' }).click();
  await expect(memberTexts(page).first()).toContainText('起草者');
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
  await page.getByRole('button', { name: '继续' }).click();
  await statusHas(page, '已完成', 90_000);
  await capture(running, 'finished', '讨论结束：四个服务依次发言，都显示 token 用量，没有金额。');

  // Every service gets the same request: one adapter, no per-service branch (D135).
  const sent = discussionRequests(fixture);
  expect([...new Set(sent.map(request => request.service))].sort()).toEqual(['deepseek', 'doubao', 'glm', 'kimi']);
  const by = (service: string) => sent.find(request => request.service === service)!;
  for (const [service, model] of [['deepseek', 'deepseek-flash'], ['kimi', 'kimi-k3.1-pro'], ['glm', 'glm-5.3'], ['doubao', 'doubao-seed-2-1-pro-260915']] as const) {
    expect(Object.keys(by(service).raw).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream', 'stream_options']);
    expect(by(service).raw).toMatchObject({ model, max_tokens: 8192, stream_options: { include_usage: true } });
    expect(by(service).headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
  }
  // The last speaker read everyone else's words as public text.
  const last = sent.at(-1)!;
  for (const words of ['deepseek · deepseek-flash', 'kimi · kimi-k3.1-pro', 'glm · glm-5.3']) expect(JSON.stringify(last.messages)).toContain(words);

  await page.locator('.usage-tag').first().click();
  await expect(page.getByRole('region', { name: '请求详情' }).first()).toContainText('输入 300（缓存命中 100） / 输出 6 tokens');
  await capture(running, 'request-details', '点 token 数：请求详情只有用量，没有计价。');

  // One click makes a summary; it is in use at once, and it can be taken back and used again (D140).
  if (!(await page.locator('.run-panel').isVisible())) await page.getByRole('button', { name: '本场信息' }).click();
  await page.getByRole('tab', { name: /^进度/u }).click();
  await expect(page.locator('.run-panel')).toContainText('费用由服务商收取，这里不估算');
  await capture(running, 'panel', '本场信息 › 进度：用量一行取代原来的预算卡片；没有空卡片。');
  const before = sent.length;
  await page.getByRole('button', { name: '生成讨论摘要' }).click();
  const summary = page.locator('.summary-card');
  await expect(summary).toContainText('之后的发言用它代替原文', { timeout: 30_000 });
  expect(discussionRequests(fixture).length, 'One click, one request').toBe(before + 1);
  await page.getByRole('button', { name: /回到最新/u }).click();
  await expect(summary).toBeInViewport();
  await capture(running, 'summary', '一键摘要：点了就生成，默认综合者来写，写完直接生效；旁边可以撤销、修改、换人。');
  await summary.getByRole('button', { name: '撤销' }).click();
  await expect(summary).toContainText('已撤销 · 之后的发言使用原文');
  await capture(running, 'summary-revoked', '撤销之后：写明之后用原文；摘要留着，一键恢复。');
  await summary.getByRole('button', { name: '恢复使用' }).click();
  await expect(summary).toContainText('之后的发言用它代替原文');

  // One click makes an artifact too, and a valid one can be used right away (D139).
  await openArtifacts(page);
  await capture(running, 'artifacts', '本场信息 › 产物：点“生成”就发送 1 次请求，默认综合者来写，“换人”放在旁边。');
  const reader = await generateArtifact(page, 2);
  await expect(reader).toContainText('有效', { timeout: 30_000 });
  await expect(reader.getByRole('button', { name: '复制 Markdown' })).toBeVisible();
  await capture(running, 'artifact', '产物：格式检查通过就能复制、另存；没有“采用”这一步。');
  await page.keyboard.press('Escape');

  // Usage page: tokens by discussion, model, date and purpose; CSV; no money.
  await page.locator('.sidebar .sb-item', { hasText: '用量' }).click();
  await expect(page.getByRole('heading', { name: '用量', exact: true })).toBeVisible();
  await expect(page.getByText(/费用由服务商收取，请到服务商控制台查看账单；这里不估算/u)).toBeVisible();
  await capture(running, 'usage-run', '用量页 · 按讨论：只有请求数和 token；写明费用由服务商收取。');
  await page.getByRole('tab', { name: '按模型' }).click();
  for (const model of ['deepseek-flash', 'kimi-k3.1-pro', 'glm-5.3', 'doubao-seed-2-1-pro-260915']) await expect(page.getByRole('table')).toContainText(model);
  await capture(running, 'usage-model', '用量页 · 按模型：四个服务分别汇总。');
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
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  await theme(running, 'dark');
  await capture(running, 'services-dark', '深色主题：模型服务。');
  await page.getByRole('button', { name: '添加服务' }).click();
  await capture(running, 'wizard-choose-dark', '深色主题：选服务。');
  await page.getByRole('button', { name: /^通义千问/u }).click();
  await capture(running, 'wizard-key-dark', '深色主题：贴 Key；通义千问写明地域要选北京。');
  await page.locator('dialog[open]').getByRole('button', { name: '关闭' }).first().click();
  await size(running, 800);
  await capture(running, 'services-800-dark', '800 宽、深色：模型服务没有横向滚动。');
  expect(await noSideScroll(running), 'No horizontal scroll at 800').toBe(true);
  await theme(running, 'light');
  await capture(running, 'services-800', '800 宽、浅色：模型服务。');
  await page.getByRole('button', { name: '添加服务' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: /^DeepSeek/u }).click();
  await capture(running, 'wizard-key-800', '800 宽、浅色：贴 Key 表单。');
  await page.locator('dialog[open]').getByRole('button', { name: '关闭' }).first().click();
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.locator('.sb-item', { hasText: '用量' }).click();
  await capture(running, 'usage-800', '800 宽、浅色：用量页。');
  expect(await noSideScroll(running), 'No horizontal scroll at 800').toBe(true);
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.locator('.sb-run, .sb-item').filter({ hasText: '交叉审计' }).first().click();
  await expect(threadItems(page).first()).toBeVisible();
  await capture(running, 'discussion-800', '800 宽、浅色：讨论页，摘要卡片在时间线里。');
  await theme(running, 'dark');
  await capture(running, 'discussion-800-dark', '800 宽、深色：讨论页。');
  await size(running, 1280);
  await capture(running, 'discussion-dark', '1280 宽、深色：讨论页。');
  await page.locator('.sidebar .sb-item', { hasText: '用量' }).click();
  await capture(running, 'usage-dark', '1280 宽、深色：用量页。');
  await theme(running, 'light');

  if (screens) writeFileSync(join(screens, 'captions.json'), JSON.stringify(captions, null, 1));
  await running.quit();
});

test('D143 what an older version left behind: a service outside the catalog stays with its name and sends nothing; its member is told to change model', async ({ harness }) => {
  test.setTimeout(120_000);
  const { fixture } = harness;
  fixture.reply = body => `${memberOf(body) ?? '成员'}的发言。`;
  let running = await harness.launch();
  await seedDeepSeekRoom(running);
  await running.quit();
  // As migration 14 leaves it: stopped, with its name; a second member on a model its service no longer has.
  harness.write(
    `INSERT INTO providers(id,name,type,base_url,enabled,is_default,custom_models_json,key_revision,created_at,updated_at) VALUES('old','旧版本的服务','compatible','https://gateway.e2e.invalid/v1',0,0,'[{"id":"old-model","name":"old-model"}]',0,'2026-10-23T02:00:00.000Z','2026-10-23T02:00:00.000Z')`,
    "UPDATE agents SET provider_id='old', model_id='old-model' WHERE display_name='审查者'",
    "UPDATE agents SET model_id='gone-model' WHERE display_name='综合者'");
  running = await harness.launch();
  const { page } = running;
  await theme(running, 'light');

  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  const stopped = page.getByRole('region', { name: '旧版本的服务' });
  await expect(stopped).toContainText('已停用');
  await expect(stopped).toContainText('这个服务已不再支持，可以删除。');
  await page.getByRole('button', { name: '展开 旧版本的服务' }).click();
  await expect(stopped).toContainText('https://gateway.e2e.invalid/v1');
  await expect(stopped.getByRole('switch')).toHaveCount(0);
  await expect(stopped.getByRole('textbox')).toHaveCount(0);
  await expect(stopped.getByRole('button', { name: '测试连接' })).toHaveCount(0);
  await expect(stopped.getByRole('button', { name: '删除服务…' })).toBeVisible();
  await capture(running, 'stopped-service', '旧版本留下的服务：保留原名，显示已停用，写明不再支持；只能删除，连同 Key。');
  await theme(running, 'dark');
  await capture(running, 'stopped-service-dark', '深色主题：旧版本留下的服务。');
  await theme(running, 'light');

  await page.locator('.sidebar .sb-item', { hasText: 'E2E 讨论' }).first().click();
  await expect(page.getByText('这个服务已不再支持，请换一个模型')).toBeVisible();
  await expect(page.getByText('这个模型已不再支持，请换一个')).toBeVisible();
  await capture(running, 'stopped-member', '房间：成员还写着原来的选择，并说明不再支持、请换一个。');
  await theme(running, 'dark');
  await capture(running, 'stopped-member-dark', '深色主题：房间里的成员。');
  await theme(running, 'light');

  await newDiscussion(running, 'E2E 讨论', '试点方案。');
  await page.getByRole('button', { name: '开始讨论' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '已不再支持，请在房间里给 TA 换一个模型' })).toBeVisible();
  expect(fixture.requests, 'Nothing is sent for a discussion that cannot start').toEqual([]);

  await page.locator('.sidebar .sb-item', { hasText: 'E2E 讨论' }).first().click();
  await changeMember(running, '审查者', 'DeepSeek 直连 · DeepSeek Flash（deepseek-flash）');
  await changeMember(running, '综合者', 'DeepSeek 直连 · DeepSeek V4 Pro（deepseek-v4-pro）');
  await newDiscussion(running, 'E2E 讨论', '试点方案。');
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成');
  expect(fixture.requests.map(request => request.model)).toEqual(['deepseek-flash', 'deepseek-flash', 'deepseek-v4-pro']);

  // Nobody uses it any more and no discussion did: it can go.
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  await page.getByRole('button', { name: /^(展开|收起) 旧版本的服务$/u }).first().waitFor();
  if (await page.getByRole('button', { name: '展开 旧版本的服务' }).count()) await page.getByRole('button', { name: '展开 旧版本的服务' }).click();
  await stopped.getByRole('button', { name: '删除服务…' }).click();
  await stopped.getByRole('button', { name: '确认删除服务' }).click();
  await expect(stopped).toHaveCount(0);
  await running.quit();
});

test('a member that thinks: the block stays out of the discussion, the wait says so, and a reply spent on thinking says how to fix it', async ({ harness }) => {
  test.setTimeout(120_000);
  const { fixture } = harness;
  fixture.reply = body => {
    const member = memberOf(body);
    if (member === '起草者') return '<think>内部推演：先算成本</think>\n\n起草者的方案正文。';
    if (member === '审查者') return '审查者的意见。';
    return body.max_tokens > 8192 ? '综合者的结论。' : '';
  };
  fixture.reasoning = body => memberOf(body) === '起草者' ? undefined : '内部推演：思考内容';
  fixture.holdAfterReasoning = body => memberOf(body) === '审查者';
  fixture.finishReason = body => memberOf(body) === '综合者' && body.max_tokens <= 8192 ? 'length' : 'stop';
  const running = await harness.launch();
  const { page } = running;
  await theme(running, 'light');
  await seedDeepSeekRoom(running);
  await newDiscussion(running, 'E2E 讨论', '试点方案。');
  await page.getByRole('button', { name: '开始讨论' }).click();

  await expect(memberTexts(page).first()).toHaveText('起草者的方案正文。');
  await expect(page.getByText('正在思考或生成，还没有输出文字…')).toBeVisible();
  await capture(running, 'thinking-wait', '思考期间：<think> 块和 reasoning_content 都不显示；第二位成员还没有正文，写明正在思考或生成，不像卡住。');
  await expect.poll(() => fixture.release(), { message: 'The reviewer is held after its reasoning' }).toBeGreaterThan(0);
  await statusHas(page, '已完成');

  // The reply spent on thinking says what happened and how to fix it.
  const note = page.locator('.note', { hasText: '这位成员的输出额度在思考阶段就用完了' });
  await expect(note).toBeVisible();
  await expect(note).toContainText('调高这个模型的最大输出');
  await capture(running, 'quota-used-up', '额度用完：第三位成员 8192 全用在思考上，没有正文。写明原因和解决办法，旁边就是“重新生成”。');

  // Thinking is nowhere: not on the page, not in the next member's request, not in the database.
  expect(await page.locator('.thread').allTextContents().then(texts => texts.join(''))).not.toContain('内部推演');
  const sent = fixture.requests.filter(request => request.model !== '');
  expect(JSON.stringify(sent[1]!.messages)).toContain('起草者的方案正文。');
  expect(JSON.stringify(sent.map(request => request.messages))).not.toContain('内部推演');
  const [messages] = harness.sql('SELECT content FROM messages');
  expect(JSON.stringify(messages)).not.toContain('内部推演');

  // Raising the model's limit takes effect on the retry.
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  const card = page.getByRole('region', { name: 'DeepSeek 直连' });
  // The only real service may already be open; the header says which it is once the list has loaded.
  await expect(page.getByRole('button', { name: /^(展开|收起) DeepSeek 直连$/u })).toBeVisible();
  if (await page.getByRole('button', { name: '展开 DeepSeek 直连' }).count()) await page.getByRole('button', { name: '展开 DeepSeek 直连' }).click();
  await card.getByRole('button', { name: 'DeepSeek Flash 的上限' }).click();
  await card.getByLabel('最大输出（token）').fill('16000');
  await card.getByRole('button', { name: '保存' }).click();
  await expect(card).toContainText('最大输出 16,000');
  await page.locator('.sb-runs .sb-item').first().click();
  await note.getByRole('button', { name: '重新生成' }).click();
  await expect(page.getByText('综合者的结论。')).toBeVisible();
  expect(fixture.requests.at(-1)!.maxTokens).toBe(16000);
  await expect(note).toHaveCount(0);
  await capture(running, 'quota-regenerated', '调高最大输出后重新生成：这次请求按 16000 发出，写出了正文。');
  if (screens) writeFileSync(join(screens, 'captions.json'), JSON.stringify(captions, null, 1));
  await running.quit();
});
