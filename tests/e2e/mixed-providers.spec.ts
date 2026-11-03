import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { artifactOf, memberOf } from './support/fixture';
import { FAKE_KEY, expect, generateArtifact, memberTexts, newDiscussion, openArtifacts, root, statusHas, test, threadItems, type RunningApp } from './support/app';

// D134/D142: a discussion across the six built-in services, then one with user-added services of every interface type,
// all connected through the real wizard, each member on its own model. With ROUNDTABLE_E2E_SCREENS set it also keeps a
// screenshot per step, in the light and dark themes, at 1280 and 800 wide.
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

/** Paste a Key, keep the suggested model, save. That is the whole path for a built-in service (D136). */
async function connect(running: RunningApp, service: RegExp, shots?: { form?: string; test?: string }) {
  const { page } = running;
  await page.getByRole('button', { name: service }).click();
  await page.getByRole('textbox', { name: 'API Key' }).fill(FAKE_KEY);
  if (shots?.form) await capture(running, shots.form, '贴 Key：写明 Key 只会发往哪里、费用由谁收取；模型已选好一个。保存就能用，没有确认地址这一步。');
  if (shots?.test) {
    await page.getByRole('button', { name: '测试连接' }).click();
    await expect(page.getByText('Key 有效，连接正常')).toBeVisible();
    await capture(running, shots.test, '测试连接是可选的：有模型列表接口就只读列表，结果写在按钮旁边。');
  }
  await page.locator('dialog[open]').getByRole('button', { name: '保存' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

/** A user-added service: a name, an interface type, an address, a Key and a model name. */
async function connectCustom(running: RunningApp, name: string, type: string, address: string, model: string, shot?: string) {
  const { page } = running;
  await page.getByRole('button', { name: '添加服务' }).click();
  await page.getByRole('button', { name: /^自定义服务/u }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByLabel('服务名称').fill(name);
  await dialog.getByLabel('接口类型').selectOption({ label: type });
  await dialog.getByLabel(/^地址/u).fill(address);
  await dialog.getByRole('textbox', { name: 'API Key' }).fill(FAKE_KEY);
  await dialog.getByLabel('模型名').fill(model);
  if (shot) await capture(running, shot, '自定义服务：名称、接口类型、地址、Key、模型名，保存就能用。');
  await page.locator('dialog[open]').getByRole('button', { name: '保存' }).click();
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

const noSideScroll = (running: RunningApp) => running.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('paste a Key, start a discussion; six domestic services, then every interface type: name, pause, summarize, revoke, write an artifact, read the usage', async ({ harness }) => {
  test.setTimeout(300_000);
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
  await expect(page.getByText('支持 DeepSeek、Kimi、通义千问、智谱 GLM、豆包、MiniMax，也可以添加其他 OpenAI 兼容或自定义接口。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '连接…' }).click();
  await capture(running, 'wizard-choose', '选服务：六家国内服务、自定义服务和演示。卡片只写在哪里创建 Key，没有价格。');
  await connect(running, /^DeepSeek/u, { form: 'wizard-key', test: 'wizard-tested' });
  await expect(page.getByRole('heading', { name: '这场讨论要解决什么？' })).toBeVisible();
  await expect(page.getByText('3 位成员', { exact: false }).first()).toBeVisible();
  await capture(running, 'first-discussion', '保存后直接到第一场讨论：房间和三位成员已经建好，写下目标就能开始。');

  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  for (const service of [/^Kimi/u, /^通义千问/u, /^智谱 GLM/u, /^豆包/u, /^MiniMax/u]) {
    await page.getByRole('button', { name: '添加服务' }).click();
    await connect(running, service);
  }
  for (const name of ['Kimi', '通义千问', '智谱 GLM', '豆包', 'MiniMax']) await expect(page.getByRole('region', { name, exact: true })).toContainText('可以使用');
  await capture(running, 'services', '设置 › 模型服务：六家都可以使用，按模型写明上下文和最大输出。');

  // A model's limits are the host's to change.
  await page.getByRole('button', { name: '展开 DeepSeek' }).click().catch(() => undefined);
  const card = page.getByRole('region', { name: 'DeepSeek' });
  await card.getByRole('button', { name: 'DeepSeek Flash 的上限' }).click();
  await card.getByLabel('上下文长度（token）').fill('200000');
  await card.getByLabel('最大输出（token）').fill('999999999');
  await expect(card.getByRole('alert')).toContainText('上下文长度');
  await card.getByLabel('最大输出（token）').fill('8192');
  await capture(running, 'model-limits', '模型设置：上下文长度和最大输出可以改；默认值保守，写明为什么。');
  await card.getByRole('button', { name: '保存' }).click();
  await expect(card).toContainText('上下文 200,000 · 最大输出 8,192');

  // The wizard made the first room, every member on DeepSeek. Give each its own service.
  const rooms = await running.api<{ name: string }[]>('rooms.listRooms');
  const roomName = rooms[0]!.name;
  await page.locator('.sidebar .sb-item', { hasText: roomName }).first().click();
  await changeMember(running, '审查者', 'Kimi · Kimi K3.1 Pro（kimi-k3.1-pro）');
  await changeMember(running, '综合者', '通义千问 · Qwen3.7 Plus（qwen3.7-plus）');
  await addMember(running, /^反方/u, '反方', '智谱 GLM · GLM-5.3（glm-5.3）', 'member-model');
  await addMember(running, /^事实核查/u, '核查者', '豆包 · Doubao Seed 2.1 Pro（doubao-seed-2-1-pro-260915）');
  await addMember(running, /^事实核查/u, '观察者', 'MiniMax · MiniMax M3（MiniMax-M3）');
  await capture(running, 'room', '房间：六位成员各用一家国内服务，都写着“可以使用”。');

  // A discussion on domestic services only: the first reply is held so 暂停 and 点名 happen as a person would do them.
  await newDiscussion(running, roomName, '交叉审计校园跑腿的试点方案。');
  await expect(page.getByText(/自由讨论 · 6 回合/u).first(), 'The label says what will happen with six members').toBeVisible();
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
  await capture(running, 'named', '点名综合者（用通义千问）：插话和点名都进入公共历史。');
  await page.getByRole('button', { name: '继续' }).click();
  await statusHas(page, '已完成', 90_000);
  await capture(running, 'finished', '讨论结束：六家国内服务依次发言，都显示 token 用量，没有金额。');

  // Each service got what its documentation asks for, and only the domestic services were called.
  const sent = fixture.requests.filter(request => request.model !== '');
  expect([...new Set(sent.map(request => request.service))].sort()).toEqual(['deepseek', 'doubao', 'glm', 'kimi', 'minimax', 'qwen']);
  const by = (service: string) => sent.find(request => request.service === service)!;
  expect(by('deepseek').raw).toMatchObject({ model: 'deepseek-flash', max_tokens: 8192, thinking: { type: 'disabled' }, stream_options: { include_usage: true } });
  expect(by('kimi').raw).toMatchObject({ model: 'kimi-k3.1-pro', max_completion_tokens: 8192 });
  expect(by('kimi').raw).not.toHaveProperty('max_tokens');
  expect(by('kimi').raw).not.toHaveProperty('thinking');
  expect(by('qwen').raw).toMatchObject({ model: 'qwen3.7-plus', max_tokens: 8192, stream_options: { include_usage: true } });
  expect(by('glm').raw).toMatchObject({ model: 'glm-5.3', max_tokens: 8192 });
  expect(by('glm').raw).not.toHaveProperty('stream_options');
  expect(by('doubao').raw).toMatchObject({ model: 'doubao-seed-2-1-pro-260915', max_tokens: 8192, thinking: { type: 'disabled' } });
  expect(by('minimax').raw).toMatchObject({ model: 'MiniMax-M3', max_completion_tokens: 8192, reasoning_split: true });
  // The last speaker read everyone else's words as public text.
  const last = sent.at(-1)!;
  for (const words of ['deepseek · deepseek-flash', 'kimi · kimi-k3.1-pro', 'qwen · qwen3.7-plus', 'glm · glm-5.3']) expect(JSON.stringify(last.messages)).toContain(words);

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
  expect(fixture.requests.filter(request => request.model !== '').length, 'One click, one request').toBe(before + 1);
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
  for (const model of ['deepseek-flash', 'kimi-k3.1-pro', 'qwen3.7-plus', 'glm-5.3', 'doubao-seed-2-1-pro-260915', 'MiniMax-M3']) await expect(page.getByRole('table')).toContainText(model);
  await capture(running, 'usage-model', '用量页 · 按模型：六家分别汇总。');
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

  // User-added services of every interface type, in one discussion.
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  await page.getByRole('button', { name: '模型服务' }).click();
  await connectCustom(running, '公司模型', 'OpenAI 兼容', 'https://models.e2e.invalid/v1', 'company-model', 'custom-service');
  await connectCustom(running, '公司网关甲', 'Anthropic', 'https://anthropic-gateway.e2e.invalid', 'gateway-a');
  await connectCustom(running, '公司网关乙', 'Gemini', 'https://gemini-gateway.e2e.invalid/v1beta', 'gateway-b');
  await page.locator('.sidebar .sb-item', { hasText: roomName }).first().click();
  await changeMember(running, '审查者', '公司模型 · company-model（company-model）');
  await changeMember(running, '综合者', '公司网关甲 · gateway-a（gateway-a）');
  await changeMember(running, '反方', '公司网关乙 · gateway-b（gateway-b）');
  const custom = fixture.requests.length;
  await newDiscussion(running, roomName, '换几家自定义服务再审一次。');
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成', 90_000);
  await capture(running, 'custom-finished', '混用自定义服务：OpenAI 兼容、Anthropic、Gemini 三种接口和国内预设在同一场讨论里。');
  const later = fixture.requests.slice(custom).filter(request => request.model !== '');
  const on = (service: string) => later.find(request => request.service === service)!;
  expect(on('compatible').raw).toMatchObject({ model: 'company-model', max_tokens: 8192 });
  expect(on('anthropic').raw).toMatchObject({ model: 'gateway-a', max_tokens: 8192 });
  expect(on('anthropic').headers['x-api-key']).toBe(FAKE_KEY);
  expect(on('gemini').raw.generationConfig).toMatchObject({ maxOutputTokens: 8192 });
  expect(on('gemini').headers['x-goog-api-key']).toBe(FAKE_KEY);
  expect(JSON.stringify(later.at(-1)!.messages)).toContain('anthropic · gateway-a');

  // The proxy switch, in each state it can find (the system's answer is injected; no request is sent through it).
  const systemProxy = (answer: string) => running.app.evaluate(({ session }, answer) => { session.defaultSession.resolveProxy = async () => answer; }, answer);
  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  await page.getByRole('button', { name: '网络', exact: true }).click();
  const toggle = page.getByRole('switch', { name: '使用系统代理' });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText('未开启，直接连接。')).toBeVisible();
  await capture(running, 'network-off', '设置 › 网络：默认关闭，直接连接。文案不提任何软件和用途。');
  await systemProxy(`PROXY 127.0.0.1:${fixture.port}`);
  await toggle.click();
  await expect(page.getByText(`已检测到系统代理 127.0.0.1:${fixture.port}`)).toBeVisible();
  await page.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText('连接正常。')).toBeVisible();
  expect(fixture.connects, 'The check asked the proxy for a tunnel and sent nothing else').toBe(1);
  await capture(running, 'network-system', '打开开关：马上读到系统代理并写在开关旁，不用重启；测试连接只做一次握手。');
  await toggle.click();
  await systemProxy('DIRECT');
  await toggle.click();
  await expect(page.getByText('系统没有设置代理，将直接连接。')).toBeVisible();
  await capture(running, 'network-direct', '系统没有设置代理：如实说明将直接连接。');
  await toggle.click();
  await systemProxy('SOCKS5 127.0.0.1:1080');
  await toggle.click();
  await expect(page.getByText(/系统代理是 SOCKS，这个应用现在不支持，请求不会发出/u)).toBeVisible();
  await capture(running, 'network-socks', '系统代理是 SOCKS：说明不支持、请求不会发出，并指向手动填写；不会悄悄直连。');
  await page.getByText('高级：手动填写地址').click();
  await page.getByLabel('代理地址').fill('127.0.0.1');
  await page.getByLabel('端口').fill(String(fixture.port));
  await page.locator('.net-card').getByRole('button', { name: '保存' }).click();
  await expect(page.getByText(`使用手动填写的代理 127.0.0.1:${fixture.port}`)).toBeVisible();
  await capture(running, 'network-manual', '高级选项：手动地址优先于系统设置，能读不到系统代理时用。');

  // Dark theme and the narrow window, on the pages a person keeps open.
  await theme(running, 'dark');
  await capture(running, 'network-dark', '深色主题：网络。');
  await page.getByRole('button', { name: '模型服务' }).click();
  await capture(running, 'services-dark', '深色主题：模型服务。');
  await page.getByRole('button', { name: '添加服务' }).click();
  await capture(running, 'wizard-choose-dark', '深色主题：选服务。');
  await page.getByRole('button', { name: /^自定义服务/u }).click();
  await capture(running, 'wizard-custom-dark', '深色主题：自定义服务表单。');
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
  await page.getByRole('button', { name: '网络', exact: true }).click();
  await capture(running, 'network-800', '800 宽、浅色：网络。');
  expect(await noSideScroll(running), 'No horizontal scroll at 800').toBe(true);
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
