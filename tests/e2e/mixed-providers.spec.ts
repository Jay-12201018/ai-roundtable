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
  'stopped-service', 'stopped-member', 'stopped-service-dark', 'stopped-member-dark',
  'limit-thinking', 'limit-reached', 'limit-reached-dark', 'limit-details', 'limit-continued', 'limit-finished', 'failure-card', 'failure-card-dark', 'failure-discussion', 'failure-details', 'failure-recovered', 'failure-list-refused', 'failure-rekey', 'setup-blocked', 'setup-first', 'setup-dialogue', 'setup-dialogue-dark', 'setup-dialogue-finished', 'setup-five', 'setup-three', 'setup-review', 'setup-custom', 'setup-narrow', 'setup-narrow-dark', 'setup-eight', 'setup-eight-dark',
  'multimodal-wizard', 'multimodal-member', 'discover-wizard', 'discover-members', 'discover-services', 'discover-delisted', 'discover-delisted-dark', 'pick-model', 'picked-discussion', 'picked-members', 'picked-member-dialog', 'picked-default', 'picked-finished', 'picked-members-dark', 'thinking-wait', 'quota-used-up', 'quota-regenerated']);
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
  await page.locator('dialog[open]').getByRole('button', { name: service }).click();
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

/** Picks a model the way a person reads it: under its service's heading, by its ID. */
async function pickModel(page: Page, choice: { service: string; id: string }) {
  const value = await page.locator(`dialog[open] select optgroup[label="${choice.service}"] option`, { hasText: `（${choice.id}）` }).getAttribute('value');
  await page.getByLabel('模型').selectOption(value!);
}

async function changeMember(running: RunningApp, name: string, option: { service: string; id: string }) {
  const { page } = running;
  await page.getByRole('button', { name: `「${name}」：编辑、排序、归档、删除` }).click();
  await page.getByRole('menuitem', { name: /编辑/u }).click();
  await pickModel(page, option);
  await page.locator('dialog[open]').getByRole('button', { name: '保存' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

async function addMember(running: RunningApp, role: RegExp, name: string, option: { service: string; id: string }, shot?: string) {
  const { page } = running;
  await page.getByRole('button', { name: '添加成员' }).click();
  await page.getByRole('button', { name: role }).click();
  await page.getByLabel('名字').fill(name);
  await pickModel(page, option);
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
  await changeMember(running, '审查者', { service: 'Kimi', id: 'kimi-k3.1-pro' });
  await changeMember(running, '综合者', { service: '智谱 GLM', id: 'glm-5.3' });
  await addMember(running, /^反方/u, '反方', { service: '豆包', id: 'doubao-seed-2-1-pro-260915' });
  await capture(running, 'room', '房间：四位成员各用一家服务，都写着“可以使用”。');

  // The first reply is held so 暂停 and 点名 happen as a person would do them.
  await newDiscussion(running, roomName, '交叉审计校园跑腿的试点方案。');
  await expect(page.getByText(/共 4 回合/u).first(), 'The sentence says what will happen with four members').toBeVisible();
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
  // On the new-discussion page: who is in the way, why, and the list to change it, right there.
  await expect(page.getByRole('button', { name: '开始讨论' })).toBeDisabled();
  await expect(page.getByText('还不能开始：审查者、综合者的模型要先处理', { exact: false })).toBeVisible();
  await expect(page.locator('.setup-row', { hasText: '审查者' })).toContainText('这个服务已不再支持');
  await expect(page.locator('.setup-row', { hasText: '综合者' })).toContainText('这个模型已不再支持');
  await capture(running, 'setup-blocked', '开始按钮不可用时：输入框上方写明是哪几位成员，原因写在各自那一行，下拉框就地可改。');
  expect(fixture.requests, 'Nothing is sent for a discussion that cannot start').toEqual([]);

  await page.locator('.sidebar .sb-item', { hasText: 'E2E 讨论' }).first().click();
  await changeMember(running, '审查者', { service: 'DeepSeek 直连', id: 'deepseek-flash' });
  await changeMember(running, '综合者', { service: 'DeepSeek 直连', id: 'deepseek-v4-pro' });
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

test('D143 the host picks the model: every model of a service is offered, nothing is swapped, and what goes out is what was picked', async ({ harness }) => {
  test.setTimeout(120_000);
  const { fixture } = harness;
  fixture.reply = body => `${memberOf(body) ?? '成员'}（${body.model}）的发言。`;
  const running = await harness.launch();
  const { page } = running;
  await theme(running, 'light');

  // The list is on screen with its default visible, and can be changed before saving.
  await page.getByRole('button', { name: '连接…' }).click();
  await page.getByRole('button', { name: /^通义千问/u }).click();
  const dialog = page.locator('dialog[open]');
  const list = dialog.getByRole('combobox', { name: '模型' });
  await expect(list).toBeVisible();
  await expect(list).toHaveValue('qwen3.7-plus');
  expect((await list.locator('option').allTextContents()).length, 'Every model of the service is offered').toBe(14);
  await list.selectOption('qwen3.8-flash');
  await dialog.getByRole('textbox', { name: 'API Key' }).fill(FAKE_KEY);
  await capture(running, 'pick-model', '连接通义千问：模型下拉框始终显示，默认项看得见，这里改成 Qwen3.8 Flash；每个模型都有一句说明。');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  // The three members made for this service use what was picked, and the page says so.
  for (const name of ['起草者', '审查者', '综合者']) await expect(page.getByRole('combobox', { name: `${name} 的模型` }).locator('option:checked')).toContainText('Qwen3.8 Flash');
  await capture(running, 'picked-discussion', '第一场讨论：三位成员的模型下拉框都显示 Qwen3.8 Flash，就在目标上方。');
  const roomName = (await running.api<{ name: string }[]>('rooms.listRooms'))[0]!.name;
  await page.locator('.sidebar .sb-item', { hasText: roomName }).first().click();
  await expect(page.locator('.room-page').getByText('Qwen3.8 Flash · 可以使用')).toHaveCount(3);
  await capture(running, 'picked-members', '房间：三位成员都显示 Qwen3.8 Flash。');

  // One member takes another model of the same service, from the list grouped by service.
  await page.getByRole('button', { name: '「审查者」：编辑、排序、归档、删除' }).click();
  await page.getByRole('menuitem', { name: /编辑/u }).click();
  await expect(page.locator('dialog[open] select optgroup[label="通义千问"] option')).toHaveCount(14);
  await pickModel(page, { service: '通义千问', id: 'qwen3.7-max' });
  await capture(running, 'picked-member-dialog', '编辑成员：模型按服务分组，这位成员单独换成 Qwen3.7 Max。');
  await page.locator('dialog[open]').getByRole('button', { name: '保存' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.room-page').getByText('Qwen3.7 Max · 可以使用')).toHaveCount(1);

  // Changing the service's default leaves the members as they are.
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  const card = page.getByRole('region', { name: '通义千问' });
  await expect(card).toContainText('默认模型只影响之后新建的成员');
  await card.locator('.model-row', { hasText: 'qwen3.8-max' }).getByRole('button', { name: '设为默认' }).click();
  await expect(card.locator('.model-row', { hasText: 'qwen3.8-max' })).toContainText('默认');
  await capture(running, 'picked-default', '设置 › 模型服务：随时可以改默认模型，已有成员不变。');
  await page.locator('.sidebar .sb-item', { hasText: roomName }).first().click();
  await expect(page.locator('.room-page').getByText('Qwen3.8 Flash · 可以使用')).toHaveCount(2);
  await expect(page.locator('.room-page').getByText('Qwen3.7 Max · 可以使用')).toHaveCount(1);
  await theme(running, 'dark');
  await capture(running, 'picked-members-dark', '深色主题：成员各自的模型。');
  await theme(running, 'light');

  await newDiscussion(running, roomName, '试点方案。');
  await expect(page.getByRole('combobox', { name: '审查者 的模型' }).locator('option:checked')).toContainText('Qwen3.7 Max');
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成');
  await capture(running, 'picked-finished', '讨论结束：服务收到的 model 就是所选的模型。');
  expect(discussionRequests(fixture).map(request => [request.service, request.raw.model])).toEqual([['qwen', 'qwen3.8-flash'], ['qwen', 'qwen3.7-max'], ['qwen', 'qwen3.8-flash']]);
  if (screens) writeFileSync(join(screens, 'captions.json'), JSON.stringify(captions, null, 1));
  await running.quit();
});

test('new discussion: choose how it runs and how many, give each one a model, and what goes out is what was chosen', async ({ harness }) => {
  test.setTimeout(240_000);
  const { fixture } = harness;
  fixture.reply = body => `${memberOf(body) ?? '成员'}（${body.model}）的发言。`;
  const running = await harness.launch();
  const { page } = running;
  await theme(running, 'light');
  await page.getByRole('button', { name: '连接…' }).click();
  await connect(running, /^DeepSeek/u);

  const rows = () => page.locator('.setup-row b').allTextContents();
  const model = (name: string) => page.getByRole('combobox', { name: `${name} 的模型` });
  const mode = (name: string) => page.locator('.setup-seg').getByRole('button', { name, exact: true });
  const count = page.locator('.member-count-value');
  const pick = async (name: string, service: string, id: string) => {
    const value = await model(name).locator(`optgroup[label="${service}"] option`, { hasText: `（${id}）` }).getAttribute('value');
    await model(name).selectOption(value!);
    await expect(model(name)).toBeEnabled();
    await expect(model(name)).toHaveValue(value!);
  };
  const started = () => fixture.requests.filter(request => request.maxTokens !== 8);

  // Opens on free discussion with three; everything is on the page without a click.
  await expect(mode('自由讨论')).toHaveAttribute('aria-pressed', 'true');
  await expect(count).toHaveText('3');
  expect(await rows()).toEqual(['起草者', '审查者', '综合者']);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await capture(running, 'setup-first', '新讨论页：讨论方式、几位成员、成员和模型从上到下，输入框在最下面，打开就看得见。默认自由讨论、3 人。');

  // A goal typed first survives connecting another service from here.
  const box = page.getByRole('textbox', { name: '讨论目标' });
  await box.click();
  await page.keyboard.press('Meta+A');
  await running.ime('shidian', '校园跑腿的试点方案');
  await page.getByRole('button', { name: '连接更多模型服务' }).click();
  await connect(running, /^Kimi/u);
  await expect(box, 'The goal is still there').toHaveValue('校园跑腿的试点方案');
  await expect(model('审查者').locator('optgroup[label="Kimi"] option').first()).toBeAttached();
  await expect(page.getByRole('button', { name: '连接更多模型服务' })).toHaveCount(0);

  // Two-person dialogue: only two rows, each on its own service.
  await mode('双人对话').click();
  await expect(page.locator('.setup-row')).toHaveCount(2);
  await expect(page.getByText('固定 2 人')).toBeVisible();
  await expect(page.getByRole('button', { name: '增加一位成员' })).toHaveCount(0);
  await pick('起草者', 'DeepSeek', 'deepseek-v4-pro');
  await pick('审查者', 'Kimi', 'kimi-k3');
  await capture(running, 'setup-dialogue', '双人对话：固定 2 人，只有两行，分别选了不同服务的模型。');
  await theme(running, 'dark');
  await capture(running, 'setup-dialogue-dark', '深色主题：双人对话。');
  await theme(running, 'light');
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成');
  await expect(page.locator('.setup')).toHaveCount(0);
  await capture(running, 'setup-dialogue-finished', '讨论开始后这些控件收起，不占讨论区。');
  let sent = started();
  expect(new Set(sent.map(request => `${memberOf(request as never)}|${request.service}|${request.raw.model}`))).toEqual(new Set(['起草者|deepseek|deepseek-v4-pro', '审查者|kimi|kimi-k3']));

  // Free discussion with five: two more members are made from the role templates.
  const roomName = (await running.api<{ name: string }[]>('rooms.listRooms'))[0]!.name;
  await newDiscussion(running, roomName, '第二场：五个人讨论');
  await mode('自由讨论').click();
  await expect(count).toHaveText('3');
  await page.getByRole('button', { name: '增加一位成员' }).click();
  await expect(count).toHaveText('4');
  await page.getByRole('button', { name: '增加一位成员' }).click();
  await expect(count).toHaveText('5');
  expect(await rows()).toEqual(['起草者', '审查者', '综合者', '反方', '核查员']);
  await pick('综合者', 'Kimi', 'kimi-k3.1-pro');
  await pick('反方', 'Kimi', 'kimi-k3');
  await pick('核查员', 'DeepSeek', 'deepseek-flash');
  await capture(running, 'setup-five', '自由讨论改成 5 人：多出来的两位按角色模板新建，模型各选各的。');
  const before = fixture.requests.length;
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成');
  sent = fixture.requests.slice(before);
  expect(sent.map(request => request.raw.model)).toEqual(['deepseek-v4-pro', 'kimi-k3', 'kimi-k3.1-pro', 'kimi-k3', 'deepseek-flash']);

  // Back to three and to five: the two who stepped out return as they were.
  await newDiscussion(running, roomName, '第三场');
  await page.getByRole('button', { name: '减少一位成员' }).click();
  await expect(count).toHaveText('4');
  await page.getByRole('button', { name: '减少一位成员' }).click();
  await expect(count).toHaveText('3');
  expect(await rows()).toEqual(['起草者', '审查者', '综合者']);
  await capture(running, 'setup-three', '减回 3 人：只显示前三位，多出来的两位暂不参与，配置保留。');
  const [kept] = harness.sql("SELECT display_name AS name, enabled, model_id AS model FROM agents WHERE display_name IN ('反方','核查员') ORDER BY display_order");
  expect(kept).toEqual([{ name: '反方', enabled: 0, model: 'kimi-k3' }, { name: '核查员', enabled: 0, model: 'deepseek-flash' }]);
  await page.getByRole('button', { name: '增加一位成员' }).click();
  await expect(count).toHaveText('4');
  await page.getByRole('button', { name: '增加一位成员' }).click();
  await expect(count).toHaveText('5');
  await expect(model('反方').locator('option:checked')).toContainText('kimi-k3');
  await expect(model('核查员').locator('option:checked')).toContainText('deepseek-flash');

  // The room remembers: reload, and it is still free discussion with five.
  await page.reload();
  await page.waitForSelector('.sidebar');
  await newDiscussion(running, roomName, '第三场');
  await expect(mode('自由讨论')).toHaveAttribute('aria-pressed', 'true');
  await expect(count).toHaveText('5');

  // The review chain: the writer and the reviewer by role, and the page names them.
  await mode('审查修订链').click();
  await expect(page.locator('.setup-row')).toHaveCount(2);
  await expect(page.getByText('起草者写、审查者挑错', { exact: false })).toBeVisible();
  await capture(running, 'setup-review', '审查修订链：固定 2 人，写明谁写、谁挑错，按实际发言的人显示。');
  const third = fixture.requests.length;
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成', 60_000);
  sent = fixture.requests.slice(third);
  expect(sent.map(request => [memberOf(request as never), request.raw.model])).toEqual([['起草者', 'deepseek-v4-pro'], ['审查者', 'kimi-k3'], ['起草者', 'deepseek-v4-pro'], ['审查者', 'kimi-k3'], ['起草者', 'deepseek-v4-pro']]);

  // Every step of the flow can still be adjusted, behind one link.
  await newDiscussion(running, roomName, '第四场');
  await mode('深度辩论').click();
  await expect(count).toHaveText('5');
  await page.getByRole('button', { name: '自定义流程' }).click();
  const dialog = page.getByRole('dialog', { name: '讨论方式' });
  await expect(dialog.getByLabel('最多回合')).toHaveValue('20');
  await expect(dialog).toContainText('立论');
  await dialog.getByLabel('最多回合').fill('24');
  await expect(dialog.getByRole('button', { name: '用于这个房间' })).toBeEnabled();
  await capture(running, 'setup-custom', '“自定义流程”打开原来的细调：阶段、轮数、上限一个都没少。');
  await dialog.getByRole('button', { name: '用于这个房间' }).click();
  await page.getByRole('button', { name: '减少一位成员' }).click();
  await expect(count).toHaveText('4');
  const stored = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith('roundtable.workflow.'))?.[1]);
  expect(JSON.parse(stored!).draft.turnLimit, 'The adjusted limit is kept').toBe('24');

  // A narrow window and a full room: the rows fit and the goal stays on screen.
  const inView = () => page.evaluate(() => { const box = document.querySelector('.dock')!.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; });
  const allOnScreen = () => page.evaluate(() => { const area = document.querySelector('.discussion-empty')!; return area.scrollHeight <= area.clientHeight + 1; });
  await mode('自由讨论').click();
  await expect(mode('自由讨论')).toHaveAttribute('aria-pressed', 'true');
  await expect(count, 'Between adjustable modes the number stays').toHaveText('4');
  await expect(page.getByText('没有找到这个房间的讨论方式', { exact: false }), 'Choosing free discussion is not a lost mode').toHaveCount(0);
  await page.getByRole('button', { name: '减少一位成员' }).click();
  await expect(count).toHaveText('3');
  await size(running, 1280, 800);
  expect(await allOnScreen(), 'The three steps and the box fit one screen at 1280×800').toBe(true);
  expect(await inView()).toBe(true);
  await size(running, 800);
  expect(await noSideScroll(running), 'No horizontal scroll at 800').toBe(true);
  expect(await inView(), 'The goal box is on screen').toBe(true);
  await capture(running, 'setup-narrow', '800 宽：没有横向滚动，输入框在屏幕内。');
  await theme(running, 'dark');
  await capture(running, 'setup-narrow-dark', '800 宽、深色。');
  await theme(running, 'light');
  await size(running, 1280, 800);
  for (const expected of ['4', '5', '6', '7', '8']) {
    await page.getByRole('button', { name: '增加一位成员' }).click();
    await expect(count).toHaveText(expected);
  }
  await expect(page.getByRole('button', { name: '增加一位成员' })).toBeDisabled();
  expect(await rows()).toEqual(['起草者', '审查者', '综合者', '反方', '核查员', '成员 6', '成员 7', '成员 8']);
  expect(await inView(), 'The goal box stays on screen with eight members').toBe(true);
  expect(await allOnScreen(), 'Eight members scroll inside their own list').toBe(true);
  expect(await page.locator('.setup-list').evaluate(list => list.scrollHeight > list.clientHeight)).toBe(true);
  expect(await noSideScroll(running)).toBe(true);
  await capture(running, 'setup-eight', '8 位成员：成员列表自己滚动，三步和输入框都在屏幕内。新成员的模型是默认模型，可以逐个改。');
  await theme(running, 'dark');
  await capture(running, 'setup-eight-dark', '8 位成员、深色。');
  await theme(running, 'light');
  if (screens) writeFileSync(join(screens, 'captions.json'), JSON.stringify(captions, null, 1));
  await running.quit();
});

test('D146 a discussion that reaches its duration limit says so and carries on in place; a slow model shows it is still waiting', async ({ harness }) => {
  test.setTimeout(180_000);
  const { fixture } = harness;
  fixture.reply = body => `${memberOf(body) ?? '成员'}的发言。`;
  // The second member thinks past the limit and has not said a word; once continued, it answers.
  let holding = true;
  fixture.reasoning = () => '内部推演';
  fixture.holdAfterReasoning = body => holding && memberOf(body) === '审查者';
  const running = await harness.launch();
  const { page } = running;
  await theme(running, 'light');
  await page.getByRole('button', { name: '连接…' }).click();
  await connect(running, /^DeepSeek/u);
  const roomName = (await running.api<{ name: string }[]>('rooms.listRooms'))[0]!.name;
  await newDiscussion(running, roomName, '试点方案。');
  await page.getByRole('button', { name: '自定义流程' }).click();
  const dialog = page.getByRole('dialog', { name: '讨论方式' });
  await expect(dialog.getByLabel('时长上限'), 'Two hours unless changed').toHaveValue('120');
  await dialog.getByLabel('时长上限').fill('1');
  await expect(dialog.getByRole('button', { name: '用于这个房间' })).toBeEnabled();
  await dialog.getByRole('button', { name: '用于这个房间' }).click();
  await page.getByRole('button', { name: '开始讨论' }).click();

  // Still waiting: it says so, for how long, and how to leave.
  await expect(page.getByText(/还没有输出文字… 已等待 \d+ 秒/u)).toBeVisible();
  await expect(page.getByRole('button', { name: '停止' }).first()).toBeVisible();
  await capture(running, 'limit-thinking', '模型在思考，一个字没出：写明还在等、等了多久，“停止”就在手边。');

  // The limit: said as the limit, with one way on and nothing sent.
  await expect(page.getByText('这场讨论达到了时长上限（1 分钟）。').first()).toBeVisible({ timeout: 70_000 });
  await expect(page.getByText('已到时长上限').first()).toBeVisible();
  const atLimit = await page.evaluate(() => document.body.innerText);
  for (const word of ['超时', '网络', '运行失败', '重试当前回合']) expect(atLimit, word).not.toContain(word);
  await capture(running, 'limit-reached', '到达时长上限：如实说是这场讨论的上限，不说超时和网络；一个“继续讨论”，写明会发什么、还能运行多久。');
  await theme(running, 'dark');
  await capture(running, 'limit-reached-dark', '深色主题：到达时长上限。');
  await theme(running, 'light');
  if (!(await page.locator('.run-panel').isVisible())) await page.getByRole('button', { name: '本场信息' }).click();
  await page.locator('.dev-details summary').click();
  await expect(page.locator('.dev-details')).toContainText('这场讨论达到了时长上限（1 分钟）。');
  await expect(page.locator('.run-panel')).toContainText('点“继续讨论”后接着进行');
  await capture(running, 'limit-details', '运行详情写明停止原因。');
  const sent = fixture.requests.length;
  await page.waitForTimeout(1500);
  expect(fixture.requests.length, 'Nothing is sent again on its own').toBe(sent);
  const attempts = (): number => harness.sql('SELECT COUNT(*) AS n FROM request_attempts')[0]![0].n;
  const before = attempts();

  // Carrying on: asks the unfinished member again, keeps the record, and finishes.
  holding = false;
  await page.getByRole('button', { name: '继续讨论' }).click();
  await expect(page.getByText('审查者的发言。').first()).toBeVisible({ timeout: 30_000 });
  await capture(running, 'limit-continued', '继续后没说完的这位成员重新回复，没有另开一场。');
  await expect(page.getByText(/讨论已完成/u).first()).toBeVisible({ timeout: 30_000 });
  expect(await page.getByText('这场讨论达到了时长上限').count()).toBe(0);
  expect(attempts(), 'The stopped attempt stays beside the new one').toBeGreaterThan(before);
  await capture(running, 'limit-finished', '讨论完成：之前的发言都在，也没有再被上限掐断。');

  if (screens) writeFileSync(join(screens, 'captions.json'), JSON.stringify(captions, null, 1));
  await running.quit();
});

test('when a service refuses: the page says what the service said in its own code, in plain words, and the green label follows what was last seen', async ({ harness }) => {
  test.setTimeout(120_000);
  const { fixture } = harness;
  const words = 'The model does not exist or you do not have access to it';
  fixture.reply = body => `${memberOf(body) ?? '成员'}的发言。`;
  const running = await harness.launch();
  const { page } = running;
  await theme(running, 'light');
  await page.getByRole('button', { name: '连接…' }).click();
  await connect(running, /^DeepSeek/u);
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  const card = page.getByRole('region', { name: 'DeepSeek' });
  await expect(card).toContainText('可以使用');

  // A test that fails turns the green label, and shows the service's code but not its words.
  fixture.chatError = () => ({ status: 404, body: { error: { code: 'InvalidEndpointOrModel.NotFound', message: words } } });
  await card.getByRole('button', { name: '测试连接' }).click();
  await expect(card).toContainText('最近一次测试失败');
  await expect(card).not.toContainText('可以使用');
  await expect(card).toContainText('服务商找不到这个模型，或者它还没在服务商那里开通，请到服务商控制台检查。');
  await expect(card).toContainText('服务商返回：InvalidEndpointOrModel.NotFound（HTTP 404）');
  await capture(running, 'failure-card', '测试失败：不再显示绿色“可以使用”；写明原因和服务商返回的错误码，不显示服务商的原话。');
  await theme(running, 'dark');
  await capture(running, 'failure-card-dark', '深色主题：测试失败。');
  await theme(running, 'light');

  // The same in a discussion, and in 运行详情.
  const roomName = (await running.api<{ name: string }[]>('rooms.listRooms'))[0]!.name;
  await newDiscussion(running, roomName, '试点方案。');
  await page.getByRole('button', { name: '开始讨论' }).click();
  await expect(page.getByText('运行失败').first()).toBeVisible();
  await expect(page.getByText('服务商返回：InvalidEndpointOrModel.NotFound（HTTP 404）').first()).toBeVisible();
  await expect(page.getByText('生成失败', { exact: true })).toBeVisible();
  await expect(page.getByText('已保留部分文字')).toHaveCount(0);
  await capture(running, 'failure-discussion', '讨论失败：同样的中文说明和服务商错误码，没有英文原文。');
  if (!(await page.locator('.run-panel').isVisible())) await page.getByRole('button', { name: '本场信息' }).click();
  await page.locator('.dev-details summary').click();
  await expect(page.locator('.dev-details')).toContainText('服务商返回：InvalidEndpointOrModel.NotFound（HTTP 404）');
  await capture(running, 'failure-details', '运行详情：最近一次失败写着服务商返回的错误码。');
  const text = await page.evaluate(() => document.body.innerText);
  for (const english of ['Requested resource was not found', words, 'InvalidEndpointOrModel.NotFound: ']) expect(text).not.toContain(english);
  const [stored] = harness.sql("SELECT payload_json AS payload FROM run_events WHERE type='turn_failed' LIMIT 1");
  expect(JSON.stringify(stored)).toContain('InvalidEndpointOrModel.NotFound');
  expect(JSON.stringify(stored)).not.toContain(words);
  expect(running.output).not.toContain(words);

  // Still there after a reload, read from Main.
  await page.reload();
  await page.waitForSelector('.sidebar');
  await page.locator('.sb-runs .sb-item').first().click();
  await expect(page.getByText('服务商返回：InvalidEndpointOrModel.NotFound（HTTP 404）').first()).toBeVisible();

  // A test that passes brings the green label back.
  fixture.chatError = undefined;
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  await card.getByRole('button', { name: '测试连接' }).click();
  await expect(card).toContainText('已收到回复，连接正常');
  await expect(card).toContainText('可以使用');
  await expect(card).not.toContainText('最近一次测试失败');
  await capture(running, 'failure-recovered', '测试成功后恢复绿色。');

  // A refused model list says the Key may be at fault, until a test settles it.
  fixture.modelListStatus = 401;
  await card.getByRole('button', { name: '刷新模型列表' }).click();
  await expect(card).toContainText('可能是 Key 的问题，也可能是这家的接口不接受这种访问');
  await page.reload();
  await page.waitForSelector('.sidebar');
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  await expect(card).toContainText('Key 可能有问题');
  await expect(card).not.toContainText('可以使用');
  await capture(running, 'failure-list-refused', '模型列表接口拒绝时不显示绿色，提示用“测试连接”确认。');
  await card.getByRole('button', { name: '测试连接' }).click();
  await expect(card).toContainText('可以使用');

  // Replacing a Key tests that service's own model.
  fixture.modelListStatus = undefined;
  await page.getByRole('button', { name: '添加服务' }).click();
  await connect(running, /^Kimi/u);
  const kimi = page.getByRole('region', { name: 'Kimi', exact: true });
  await kimi.getByRole('button', { name: '更换', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('textbox', { name: 'API Key' }).fill(FAKE_KEY);
  const before = fixture.requests.length;
  await dialog.getByRole('button', { name: '测试连接' }).click();
  await expect(dialog.getByText('已收到回复，连接正常')).toBeVisible();
  expect(fixture.requests.slice(before).map(request => [request.service, request.raw.model])).toEqual([['kimi', 'kimi-k3.1-pro']]);
  await capture(running, 'failure-rekey', '更换 Key 窗口的测试连接，用的是这家服务自己的默认模型。');
  await dialog.getByRole('button', { name: '关闭' }).first().click();
  if (screens) writeFileSync(join(screens, 'captions.json'), JSON.stringify(captions, null, 1));
  await running.quit();
});

test('D143 a model that can read images takes part with text, and the page says images are not sent yet', async ({ harness }) => {
  test.setTimeout(120_000);
  const { fixture } = harness;
  fixture.reply = body => `${memberOf(body) ?? '成员'}（${body.model}）的发言。`;
  const running = await harness.launch();
  const { page } = running;
  await theme(running, 'light');
  await page.getByRole('button', { name: '连接…' }).click();
  await page.getByRole('button', { name: /^智谱 GLM/u }).click();
  const dialog = page.locator('dialog[open]');
  const list = dialog.getByRole('combobox', { name: '模型' });
  await list.selectOption('glm-5v-turbo');
  expect(await list.locator('option[value="glm-5v-turbo"]').textContent()).toContain('多模态');
  expect(await list.locator('option[value="glm-5.3"]').textContent()).not.toContain('多模态');
  await expect(dialog).toContainText('标“多模态”的模型能看图：讨论里附的图片会发给它。');
  await dialog.getByRole('textbox', { name: 'API Key' }).fill(FAKE_KEY);
  await capture(running, 'multimodal-wizard', '多模态模型可以选，说明里写明多模态；下面写清附的图片会发给它。');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const roomName = (await running.api<{ name: string }[]>('rooms.listRooms'))[0]!.name;
  await page.locator('.sidebar .sb-item', { hasText: roomName }).first().click();
  await page.getByRole('button', { name: '「审查者」：编辑、排序、归档、删除' }).click();
  await page.getByRole('menuitem', { name: /编辑/u }).click();
  await expect(page.locator('dialog[open]')).toContainText('讨论里附的图片会发给它');
  await capture(running, 'multimodal-member', '编辑成员：选中多模态模型时同样写明。');
  await page.locator('dialog[open]').getByRole('button', { name: '取消' }).click();
  await newDiscussion(running, roomName, '试点方案。');
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成');
  expect(fixture.requests.map(request => request.raw.model)).toEqual(['glm-5v-turbo', 'glm-5v-turbo', 'glm-5v-turbo']);
  for (const request of fixture.requests) for (const message of request.messages) expect(typeof message.content).toBe('string');
  if (screens) writeFileSync(join(screens, 'captions.json'), JSON.stringify(captions, null, 1));
  await running.quit();
});

test('D143 a service\'s own list adds its new model: only its own, picked by the host, sent as picked; a model that leaves is not replaced', async ({ harness }) => {
  test.setTimeout(120_000);
  const { fixture } = harness;
  fixture.reply = body => `${memberOf(body) ?? '成员'}（${body.model}）的发言。`;
  fixture.modelList = () => ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v9', 'vendor-x1', 'deepseek-translation-1'];
  const running = await harness.launch();
  const { page } = running;
  await theme(running, 'light');
  expect(fixture.modelListRequests, 'Nothing is asked at startup').toEqual([]);

  await page.getByRole('button', { name: '连接…' }).click();
  await page.getByRole('button', { name: /^DeepSeek/u }).click();
  const dialog = page.locator('dialog[open]');
  const list = dialog.getByRole('combobox', { name: '模型' });
  await expect(list.locator('option', { hasText: 'deepseek-v9' }), 'Nothing is asked before a Key is saved').toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'API Key' }).fill(FAKE_KEY);
  await page.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText('已收到回复，连接正常')).toBeVisible();
  await expect(list.locator('option', { hasText: 'deepseek-v9' })).toHaveCount(1);
  const labels = await list.locator('option').allTextContents();
  expect(labels.at(-1), 'New models come last, by their ID and with no note').toBe('deepseek-v9');
  expect(labels.join()).not.toContain('vendor-x1');
  expect(labels.join()).not.toContain('translation');
  await list.selectOption('deepseek-v9');
  await capture(running, 'discover-wizard', '服务商列表多了一个本品牌新模型：排在内置模型后面，只显示模型 ID；其他品牌和翻译模型都没有进来。');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  for (const request of fixture.modelListRequests) {
    expect(request.path, 'Only the fixed address').toBe('/deepseek/models');
    expect(request.headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
  }

  await expect(page.getByRole('combobox', { name: '起草者 的模型' }).locator('option:checked')).toHaveText('deepseek-v9');
  const roomName = (await running.api<{ name: string }[]>('rooms.listRooms'))[0]!.name;
  await page.locator('.sidebar .sb-item', { hasText: roomName }).first().click();
  await expect(page.locator('.room-page').getByText('deepseek-v9 · 可以使用')).toHaveCount(3);
  await capture(running, 'discover-members', '三位成员用的就是选中的新模型。');
  await newDiscussion(running, roomName, '试点方案。');
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成');
  expect(fixture.requests.filter(request => request.maxTokens !== 8).map(request => request.raw.model)).toEqual(['deepseek-v9', 'deepseek-v9', 'deepseek-v9']);

  // The card says where the list came from and can ask again.
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  const card = page.getByRole('region', { name: 'DeepSeek' });
  await expect(card).toContainText('已按服务商的列表更新');
  await expect(card.locator('.model-row', { hasText: 'deepseek-v9' })).toBeVisible();
  await capture(running, 'discover-services', '服务卡片：写明模型列表来自服务商，旁边是“刷新模型列表”；上限和内置模型一样可以改。');

  // The list drops the new model and a built-in one. Nothing changes by itself; the page says so.
  const asked = fixture.modelListRequests.length;
  fixture.modelList = () => ['deepseek-flash'];
  await card.getByRole('button', { name: '刷新模型列表' }).click();
  await expect(card.locator('.model-row', { hasText: 'deepseek-v4-pro' })).toContainText('服务商列表里已经没有这个模型，可能已下线');
  await expect(card.locator('.model-row', { hasText: 'deepseek-v9' })).toHaveCount(0);
  expect(fixture.modelListRequests.length, 'One press, one request').toBe(asked + 1);
  await page.locator('.sidebar .sb-item', { hasText: roomName }).first().click();
  await expect(page.locator('.room-page').getByText('deepseek-v9 · 服务商列表里已经没有这个模型，可能已下线，请换一个')).toHaveCount(3);
  await capture(running, 'discover-delisted', '模型从服务商列表消失：成员的选择不变，写明可能已下线，由主持人决定。');
  await theme(running, 'dark');
  await capture(running, 'discover-delisted-dark', '深色主题：模型可能已下线。');
  await theme(running, 'light');
  const [agents] = harness.sql('SELECT DISTINCT model_id AS model FROM agents');
  expect(agents).toEqual([{ model: 'deepseek-v9' }]);

  // A failure leaves the built-in list and says so plainly.
  fixture.modelList = () => undefined;
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  await card.getByRole('button', { name: '刷新模型列表' }).click();
  await expect(card).toContainText('这家服务没有给出可用的模型列表，继续用内置列表');
  await expect(card.locator('.model-row', { hasText: 'deepseek-flash' })).toBeVisible();
  if (screens) writeFileSync(join(screens, 'captions.json'), JSON.stringify(captions, null, 1));
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
