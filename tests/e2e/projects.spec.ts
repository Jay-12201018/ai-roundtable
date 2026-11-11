import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FAKE_KEY, expect, root, statusHas, test, type RunningApp } from './support/app';
import { memberOf, textIn } from './support/fixture';

// D167–D170 in the real build, on an isolated profile, with the loopback service: 独立讨论 and the 常用阵容, projects with their
// 项目说明 and default mode, and the sidebar's three lists. A fixture proves the structure, not what real models say.
const screens = join(root, 'docs/verification/projects-phase1-screens');
const shots = Boolean(process.env.ROUNDTABLE_PROJECTS_SCREENS);
let shot = 0;
const captions: Array<{ file: string; caption: string }> = [];
/** Screenshots from the window itself (webContents.capturePage), light then dark, when this run is producing the record. */
async function capture(running: RunningApp, name: string, caption: string, themes: ReadonlyArray<'light' | 'dark'> = ['light', 'dark']) {
  if (!shots) return;
  mkdirSync(screens, { recursive: true });
  const number = String(++shot).padStart(2, '0');
  for (const theme of themes) {
    await running.page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await running.page.waitForTimeout(200);
    const data = await running.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
    const file = `${number}-${name}-${theme}.png`;
    writeFileSync(join(screens, file), Buffer.from(data, 'base64'));
    captions.push({ file, caption });
  }
  await running.page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  writeFileSync(join(screens, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
}
async function size(running: RunningApp, width: number, height = 800) {
  await running.app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0]!.setContentSize(w!, h!); }, [width, height]);
  await expect.poll(() => running.page.evaluate(() => window.innerWidth)).toBe(width);
}

const isSchedule = (body: { messages: any[] }) => textIn(body.messages[0]).includes('调度程序');
const memberRequests = (fixture: { requests: any[] }) => fixture.requests.filter(request => !isSchedule(request));
const briefIn = (request: { messages: any[] }) => request.messages.filter(message => message.role === 'system' && textIn(message).startsWith('【项目说明'));
const replies = (page: RunningApp['page']) => page.locator('.thread-item article.msg:not(.is-host)');
const firstBox = (running: RunningApp) => running.page.getByRole('textbox', { name: '第一条消息' });
const chatBox = (running: RunningApp) => running.page.getByRole('textbox', { name: '发消息' });
const recent = (page: RunningApp['page']) => page.getByRole('list', { name: '最近讨论' }).getByRole('listitem');
const waiting = (running: RunningApp) => statusHas(running.page, '等你说话');

/** One connected service, as the wizard leaves it: the default one, with its Key (the wizard itself is covered in key-safety.spec). */
async function connect(running: RunningApp) {
  const provider = await running.api('settings.createProvider', { name: 'DeepSeek 直连', kind: 'compatible', baseUrl: 'https://api.deepseek.com', isDefault: true, defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] });
  await running.api('settings.setKey', { providerId: provider.id, apiKey: FAKE_KEY });
  await running.page.reload();
  await running.page.waitForSelector('.sidebar');
  return provider;
}
/** Types Chinese the way a person does: an IME composition into the focused box. */
async function type(running: RunningApp, box: ReturnType<typeof firstBox>, pinyin: string, text: string) {
  await box.click();
  await running.page.keyboard.press('Meta+A');
  await running.ime(pinyin, text);
  await expect(box).toHaveValue(text);
}

test('独立讨论: starts without a project on the lineup, continues, survives a restart, and is listed with who took part', async ({ harness }) => {
  const { fixture } = harness;
  fixture.reply = body => isSchedule(body) ? '{"speakers":[]}' : `${memberOf(body)}：收到。`;
  fixture.chunks = 2; fixture.chunkMs = 5;
  let running = await harness.launch(); let { page } = running;
  await connect(running);

  // Nothing was open, so the app opens on a new discussion: no project to make, three members ready on the default model.
  await expect(page.getByRole('heading', { name: '想和大家聊点什么？' })).toBeVisible();
  await expect(page.getByRole('status', { name: '运行状态' })).toContainText('独立讨论');
  await expect(page.locator('.setup-list .setup-who b')).toHaveText(['林舟', '阿哲', '小雨']);
  await expect(page.locator('.setup-model')).toHaveCount(3);
  for (const select of await page.locator('.setup-model').all()) await expect(select.locator('option:checked')).toContainText('DeepSeek Flash');
  await expect(page.getByText('成员来自常用阵容，这里的改动只用于这一场。')).toBeVisible();
  await expect(page.getByText('不属于任何项目的讨论会列在这里。点上面的「新讨论」开始一场。')).toBeVisible();
  await expect(page.getByText('还没有项目。几场讨论要共用成员和背景时，点「+」建一个。')).toBeVisible();
  expect(harness.sql("SELECT kind, COUNT(*) AS n FROM rooms GROUP BY kind ORDER BY kind")[0]).toEqual([{ kind: 'lineup', n: 1 }, { kind: 'standalone', n: 1 }]);
  await capture(running, 'landing-new-discussion', '打开应用就是一场新讨论：不用先建项目，成员是常用阵容的三位，模型已经选好；侧栏三栏是新讨论、项目、最近讨论。');

  await type(running, firstBox(running), 'dajia', '大家觉得周末团建去哪里好');
  await firstBox(running).press('Enter');
  await waiting(running);
  await expect(replies(page)).toHaveCount(3);
  for (const request of memberRequests(fixture)) expect(briefIn(request), 'A discussion outside a project carries no project brief').toEqual([]);
  // Listed at once under 最近讨论, with the three who took part.
  await expect(recent(page)).toHaveCount(1);
  await expect(recent(page).first().locator('.t')).toHaveText('大家觉得周末团建去哪里好');
  await expect(recent(page).first().locator('.sb-faces .avatar')).toHaveText(['林', '阿', '小']);
  await capture(running, 'standalone-chat', '第一条消息发出后，三位成员回应；这场讨论出现在“最近讨论”，前面是三位成员的小头像。');

  // Continuing is the same discussion.
  await chatBox(running).click();
  await running.ime('xiaoyu', '@小雨 你来定一个');
  await chatBox(running).press('Enter');
  await waiting(running);
  await expect(replies(page)).toHaveCount(4);
  expect(harness.sql('SELECT COUNT(*) AS n FROM workflow_runs')[0][0].n).toBe(1);

  // 新讨论 from the sidebar: another one, from the lineup again. Taking a member out here changes this discussion only.
  await page.locator('.sidebar .sb-new').click();
  await expect(page.getByRole('heading', { name: '想和大家聊点什么？' })).toBeVisible();
  await expect(page.locator('.setup-list .setup-who b')).toHaveText(['林舟', '阿哲', '小雨']);
  await page.getByRole('button', { name: '减少一位成员' }).click();
  await expect(page.locator('.setup-list .setup-who b')).toHaveText(['林舟', '阿哲']);
  await capture(running, 'new-discussion-two-members', '从侧栏再开一场：这一场只留两位成员。页面写明“这里的改动只用于这一场”，并给出修改常用阵容的入口。');
  await type(running, firstBox(running), 'liangwei', '两位说说第一步做什么');
  await firstBox(running).press('Enter');
  await waiting(running);
  await expect(replies(page).locator('.msg-name')).toHaveText(['林舟', '阿哲']);
  await expect(recent(page).locator('.t')).toHaveText(['两位说说第一步做什么', '大家觉得周末团建去哪里好']);
  await expect(recent(page).first().locator('.sb-faces .avatar')).toHaveText(['林', '阿']);
  // The lineup is as it was: three members, all taking part.
  expect(harness.sql("SELECT display_name, enabled FROM agents WHERE room_id='roundtable-lineup' ORDER BY display_order")[0]).toEqual([{ display_name: '林舟', enabled: 1 }, { display_name: '阿哲', enabled: 1 }, { display_name: '小雨', enabled: 1 }]);

  // A restart: both are still listed; the older one opens with its words and goes on.
  await running.quit();
  running = await harness.launch(); page = running.page;
  await expect(recent(page).locator('.t')).toHaveText(['两位说说第一步做什么', '大家觉得周末团建去哪里好']);
  await recent(page).nth(1).getByRole('button').first().click();
  await expect(replies(page)).toHaveCount(4);
  await expect(page.locator('.thread-item article.msg.is-host').last()).toContainText('@小雨 你来定一个');
  await chatBox(running).fill('@林舟 那就这么定');
  await chatBox(running).press('Enter');
  await waiting(running);
  await expect(replies(page)).toHaveCount(5);
  expect(harness.sql('SELECT COUNT(*) AS n FROM workflow_runs')[0][0].n).toBe(2);
  // The one just spoken in is now the most recent.
  await expect(recent(page).locator('.t')).toHaveText(['大家觉得周末团建去哪里好', '两位说说第一步做什么']);

  // Archiving from the row: out of the list, kept under 已归档, read-only until restored.
  await recent(page).nth(1).hover();
  await capture(running, 'recent-row-archive', '指到“最近讨论”的一行，右侧出现归档按钮；不提供删除，记录都保留。', ['light']);
  await recent(page).nth(1).getByRole('button', { name: '归档「两位说说第一步做什么」' }).click();
  await expect(recent(page)).toHaveCount(1);
  await page.getByRole('button', { name: '已归档（1）' }).click();
  await page.getByRole('list', { name: '已归档的讨论' }).getByRole('button').first().click();
  await expect(page.getByText('这场讨论已归档，只能查看。恢复后可以接着聊。')).toBeVisible();
  await expect(chatBox(running)).toHaveCount(0);
  await capture(running, 'archived-discussion', '打开已归档的讨论：内容都在，输入框的位置写明只能查看，并原地给出“恢复这场讨论”。');
  await page.getByRole('button', { name: '恢复这场讨论' }).click();
  await expect(chatBox(running)).toBeVisible();
  await expect(recent(page)).toHaveCount(2);
  await running.expectNoNetwork();
  await running.quit();
});

test('常用阵容 is changed in 设置; new discussions get it and earlier ones keep who they had', async ({ harness }) => {
  const { fixture } = harness;
  fixture.reply = body => isSchedule(body) ? '{"speakers":[]}' : `${memberOf(body)}：收到。`;
  fixture.chunks = 1; fixture.chunkMs = 1;
  const running = await harness.launch(); const { page } = running;
  await connect(running);
  await firstBox(running).fill('大家好，先认识一下');
  await firstBox(running).press('Enter');
  await waiting(running);
  await expect(replies(page)).toHaveCount(3);

  await page.locator('.sidebar .sb-item', { hasText: '设置' }).click();
  await page.locator('.settings-nav').getByRole('button', { name: '常用阵容' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '常用阵容' })).toBeVisible();
  // No model of their own is not a fault here: the page says what a new discussion will use.
  await expect(page.locator('.member-list .card-row')).toHaveCount(3);
  await expect(page.locator('.member-list .card-row').first()).toContainText('没有指定模型 · 新讨论时用默认模型（DeepSeek Flash）');
  await expect(page.locator('.lineup-page .warn-text')).toHaveCount(0);
  await capture(running, 'settings-lineup', '设置 › 常用阵容：侧栏“新讨论”默认带的成员。没有指定模型的成员写明新讨论时用默认模型，不显示成故障。');

  // Rename the first member with an IME, and add a fourth from a role template.
  await page.getByRole('button', { name: '「林舟」：编辑、排序、归档、删除' }).click();
  await page.getByRole('menuitem', { name: '编辑…' }).click();
  const dialog = page.getByRole('dialog');
  const nameBox = dialog.getByRole('textbox').first();
  await nameBox.click(); await page.keyboard.press('Meta+A');
  await running.ime('laolin', '老林');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.member-list .card-row').first()).toContainText('老林');
  await page.getByRole('button', { name: '添加成员' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^审查/u }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^(保存|添加)$/u }).click();
  await expect(page.locator('.member-list .card-row')).toHaveCount(4);
  await capture(running, 'settings-lineup-edited', '改名并加了一位成员之后的常用阵容。');

  await page.locator('.sidebar .sb-new').click();
  await expect(page.locator('.setup-list .setup-who b')).toHaveText(['老林', '阿哲', '小雨', '老陆']);
  await capture(running, 'new-discussion-new-lineup', '再点“新讨论”：成员就是刚改过的常用阵容。');
  // The discussion from before the change keeps the members it had, in its own record and in the sidebar.
  await expect(recent(page)).toHaveCount(1);
  await expect(recent(page).first().locator('.sb-faces .avatar')).toHaveText(['林', '阿', '小']);
  await recent(page).first().getByRole('button').first().click();
  await expect(replies(page).locator('.msg-name')).toHaveText(['林舟', '阿哲', '小雨']);
  await running.quit();
});

test('项目: its 项目说明 goes with every member\'s reply, its default mode opens every new discussion, and the sidebar keeps the lists apart', async ({ harness }) => {
  const { fixture } = harness;
  fixture.reply = body => isSchedule(body) ? '{"speakers":[]}' : `${memberOf(body)}的发言`;
  fixture.chunks = 1; fixture.chunkMs = 1;
  const running = await harness.launch(); const { page } = running;
  await connect(running);

  // A project from the sidebar's +, named with an IME.
  await page.getByRole('button', { name: '新建项目' }).click();
  await expect(page.getByRole('dialog')).toContainText('项目里的讨论共用成员、项目说明和默认讨论方式');
  await page.getByRole('textbox', { name: '项目名称' }).click();
  await running.ime('xiaoyuan', '校园跑腿');
  await capture(running, 'new-project-dialog', '新建项目：一个名称，说明项目里的讨论共用什么，会带好三位成员。', ['light']);
  await page.getByRole('dialog').getByRole('button', { name: '新建' }).click();
  await expect(page.locator('.room-page h1')).toContainText('校园跑腿');
  await expect(page.locator('.member-list .card-row')).toHaveCount(3);
  await expect(page.getByRole('list', { name: '项目' }).getByRole('button', { name: '校园跑腿' })).toHaveAttribute('aria-expanded', 'true');
  await capture(running, 'project-page-empty', '项目页：项目说明（还没有写，写明不写会怎样）、成员、默认讨论方式、讨论。侧栏“项目”一栏里它是展开的。');

  // 项目说明: written with an IME, saved on request, and the page says who will read it and what it costs.
  await page.getByRole('button', { name: '写项目说明' }).click();
  const brief = page.locator('.brief-form textarea');
  await brief.click();
  await running.ime('women', '我们在做校园跑腿平台，试点两所学校，预算五万。');
  await expect(page.locator('#room-brief-count')).toContainText('/ 4000 字');
  await capture(running, 'project-brief-editing', '写项目说明：上面写明每位成员每次发言前都会读到、不是指令、会算进输入用量；右下是字数和保存。', ['light']);
  await page.locator('.brief-form').getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('已保存项目说明。之后每次发言都会带上它，正在进行的讨论也一样。')).toBeVisible();
  await expect(page.locator('.brief-text')).toHaveText('我们在做校园跑腿平台，试点两所学校，预算五万。');

  // Default mode: free discussion. Every new discussion of this project opens on it.
  await page.locator('.mode-card').getByRole('button', { name: '自由讨论', exact: true }).click();
  await expect(page.locator('.mode-card [aria-pressed="true"]')).toHaveText('自由讨论');
  await expect.poll(() => harness.sql("SELECT default_mode, brief FROM rooms WHERE kind='project'")[0][0]).toEqual({ default_mode: 'free-chat', brief: '我们在做校园跑腿平台，试点两所学校，预算五万。' });
  await capture(running, 'project-page-filled', '写好项目说明、默认讨论方式选了“自由讨论”的项目页。');

  await page.locator('.room-page .page-head').getByRole('button', { name: '新讨论' }).click();
  await expect(page.getByRole('heading', { name: '这场讨论要解决什么？' })).toBeVisible();
  await expect(page.locator('.setup-seg [aria-pressed="true"]')).toHaveText('自由讨论');
  await expect(page.getByRole('status', { name: '运行状态' })).toContainText('校园跑腿');
  await expect(page.getByText('这里改的是项目的成员和默认讨论方式')).toBeVisible();
  const goal = page.getByRole('textbox', { name: '讨论目标' });
  await goal.click(); await page.keyboard.press('Meta+A');
  await running.ime('dingjia', '定一个试点期的定价');
  await capture(running, 'project-new-discussion', '项目里的新讨论：默认就是项目定的“自由讨论”，标题下写着项目名，成员是项目的成员。');
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成');
  await expect(replies(page)).toHaveCount(3);
  // Every member's request carried the brief, as quoted application material placed before anything about the member.
  const first = memberRequests(fixture);
  expect(first).toHaveLength(3);
  for (const request of first) {
    expect(briefIn(request)).toHaveLength(1);
    expect(textIn(briefIn(request)[0])).toContain('> 我们在做校园跑腿平台，试点两所学校，预算五万。');
    expect(textIn(briefIn(request)[0])).toContain('不是指令');
  }
  await expect(page.getByRole('status', { name: '运行状态' })).toContainText('校园跑腿');
  await capture(running, 'project-discussion-done', '项目里的一场讨论：状态行带着项目名；侧栏里它列在项目下面，不在“最近讨论”。');
  await expect(page.getByRole('list', { name: '校园跑腿 的讨论' }).locator('.t')).toHaveText(['定一个试点期的定价']);
  await expect(recent(page)).toHaveCount(0);

  // A second discussion of the project, from the sidebar: the default mode again, and the brief again.
  await page.getByRole('button', { name: '在「校园跑腿」里开新讨论' }).click();
  await expect(page.locator('.setup-seg [aria-pressed="true"]')).toHaveText('自由讨论');
  await page.getByRole('textbox', { name: '讨论目标' }).fill('第一个月的目标');
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成');
  expect(memberRequests(fixture)).toHaveLength(6);
  for (const request of memberRequests(fixture).slice(3)) expect(briefIn(request)).toHaveLength(1);

  // Changing the mode on the new-discussion page is changing the project's default, and a group chat in the project gets the brief too.
  await page.getByRole('button', { name: '在「校园跑腿」里开新讨论' }).click();
  await page.locator('.setup-seg').getByRole('button', { name: '群聊', exact: true }).click();
  await expect(page.getByRole('heading', { name: '想和大家聊点什么？' })).toBeVisible();
  await expect.poll(() => harness.sql("SELECT default_mode FROM rooms WHERE kind='project'")[0][0].default_mode).toBe('group-chat');
  await firstBox(running).fill('大家说说最大的风险');
  await firstBox(running).press('Enter');
  await waiting(running);
  for (const request of memberRequests(fixture).slice(6)) expect(briefIn(request)).toHaveLength(1);
  expect(memberRequests(fixture).length).toBeGreaterThan(6);

  // A 独立讨论 beside it: listed apart, and it knows nothing of the project.
  const before = memberRequests(fixture).length;
  await page.locator('.sidebar .sb-new').click();
  await expect(page.getByRole('status', { name: '运行状态' })).toContainText('独立讨论');
  await firstBox(running).fill('大家随便聊聊周末');
  await firstBox(running).press('Enter');
  await waiting(running);
  for (const request of memberRequests(fixture).slice(before)) { expect(briefIn(request)).toEqual([]); expect(JSON.stringify(request.messages)).not.toContain('校园跑腿'); }
  await expect(recent(page).locator('.t')).toHaveText(['大家随便聊聊周末']);
  // The project is still listed, closed now; opening it shows its three discussions again, newest first.
  const project = page.getByRole('list', { name: '项目' }).getByRole('button', { name: '校园跑腿' });
  await expect(project).toHaveAttribute('aria-expanded', 'false');
  await capture(running, 'sidebar-both-lists', '侧栏同时有项目和最近讨论：正在看的是独立讨论，项目收起。');
  await project.click();
  await expect(page.getByRole('list', { name: '校园跑腿 的讨论' }).locator('.t')).toHaveText(['大家说说最大的风险', '第一个月的目标', '定一个试点期的定价']);
  await expect(page.locator('.mode-card [aria-pressed="true"]')).toHaveText('群聊');
  await expect(page.locator('.run-list .card-row')).toHaveCount(3);
  await capture(running, 'project-page-with-discussions', '回到项目页：三场讨论都在，默认讨论方式已是刚才在新讨论页改成的“群聊”。');

  // Narrow window: the same navigation in a drawer, and the project page still reads.
  await size(running, 800, 600);
  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.getByRole('dialog', { name: '应用导航' }).getByRole('list', { name: '最近讨论' })).toBeVisible();
  await capture(running, 'narrow-drawer', '800×600：导航收进抽屉，三栏照旧。');
  await page.keyboard.press('Escape');
  await capture(running, 'narrow-project-page', '800×600 的项目页。');
  await size(running, 1280);

  // Archive the project: its discussions leave the sidebar with it and come back with it.
  await page.locator('.danger-zone').getByRole('button', { name: '归档' }).click();
  await expect(page.getByRole('button', { name: '恢复项目' })).toBeVisible();
  await expect(page.getByRole('list', { name: '项目' }).getByRole('listitem')).toHaveCount(0);
  await page.getByRole('button', { name: '已归档（1）' }).click();
  await expect(page.getByRole('list', { name: '已归档的项目' }).getByRole('button', { name: '校园跑腿' })).toBeVisible();
  expect(harness.sql('SELECT COUNT(*) AS n FROM workflow_runs')[0][0].n).toBe(4);
  await running.expectNoNetwork();
  await running.quit();
});
