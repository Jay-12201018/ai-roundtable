// R16 batch 2 hands-on acceptance (E settings and connect wizard, F rooms, members and discussion modes, G first use and
// usage) through the production build with real mouse, keyboard and IME input. Isolation, network blocking and the
// DeepSeek loopback fixture come from r16-harness.cjs; a loopback CONNECT proxy owned by this probe answers 检测代理.
// Three launches of one profile:
//   electron tests/probes/r16-batch2-acceptance.cjs                      first run (welcome → demo → connect → room → mode → discussion → proxy)
//   electron tests/probes/r16-batch2-acceptance.cjs --restart <dir>      the saved proxy is in effect; nothing asks to confirm the target again (D113)
//   electron tests/probes/r16-batch2-acceptance.cjs --restart2 <dir>     direct again: a discussion sends without confirming; a new Key needs it
// Screenshots go to docs/verification/r16-batch2-screens/ (01–29, 40–49, 60–79).
const assert = require('node:assert/strict');
const http = require('node:http');
const { resolve } = require('node:path');
const { app } = require('electron');
const { createProbe } = require('./r16-harness.cjs');

const args = process.argv.slice(2).filter(arg => !arg.startsWith('--inspect'));
const phase = args[0] === '--restart' ? 'restart' : args[0] === '--restart2' ? 'restart2' : 'first';
assert.ok(phase === 'first' ? args.length === 0 : args.length === 2, 'Usage: electron r16-batch2-acceptance.cjs [--restart|--restart2 <profile directory>]');
const probe = createProbe({ prefix: 'roundtable-r16-batch2', name: 'R16_BATCH2', timeoutMs: 900000, phase, reuse: phase === 'first' ? undefined : args[1] });
const { fixture, check, sleep, result } = probe;
const screens = resolve(probe.root, 'docs/verification/r16-batch2-screens');
const fakeKey = 'r16b2-fake-deepseek-key';

// A relaunch would start this script again outside its phase: record it instead (the restart phases relaunch by hand).
result.relaunches = 0; result.quitRequests = 0;
app.relaunch = () => { result.relaunches++; };

const replies = {
  起草者: '### 试点方案（初稿）\n\n1. 范围：3 栋宿舍楼，试点 4 周。\n2. 定价：基础费 2 元/单，抽成 15%。',
  审查者: '两处问题：抽成 15% 偏高，骑手留不住；22 点后宿舍门禁，夜间单要暂停。',
  综合者: '综合：试点抽成 8%，22 点后暂停接单，先做一周问卷再定目标。',
  老周: '我唱个反调：2 元单在雨天没人接，试点数据会很难看。',
};
fixture.reply = body => replies[/现在由你（成员「([^」]+)」/u.exec(body.messages.at(-1).content)?.[1]] ?? '好的，补充一点。';

// The owned loopback CONNECT proxy: answers 200 and closes; nothing passes through it.
const connects = [];
const proxy = http.createServer();
proxy.on('connect', (request, socket) => { connects.push({ url: request.url, headers: Object.keys(request.headers) }); socket.end('HTTP/1.1 200 Connection Established\r\n\r\n'); });

async function main() {
  await new Promise(done => proxy.listen(0, '127.0.0.1', done)); fixture.proxyPort = proxy.address().port;
  const ui = await probe.start({ screens, width: 1280, height: 800, fixedClock: '2026-10-28T16:30:00+08:00', keepScreens: phase !== 'first', firstShot: phase === 'first' ? 0 : phase === 'restart' ? 39 : 59 });
  const { js, until, click, field, key, selectAll, ime, type, capture, resize, api, text, runSnapshot, finish } = ui;
  const has = value => until(`document.body.innerText.includes(${JSON.stringify(value)})`, value);
  const statusHas = (value, timeout) => until(`(document.querySelector('[role=status][aria-label="运行状态"]')?.textContent ?? '').includes(${JSON.stringify(value)})`, 'status ' + value, timeout);
  const noOverflow = async label => check(await js('document.documentElement.scrollWidth <= window.innerWidth'), `${label}: no horizontal page scroll`);
  const theme = async value => {
    await click('设置', { selector: '.sb-item' }); await click('外观'); await click(value === 'dark' ? '深色' : '浅色', { selector: '.choice' });
    check(await js('document.documentElement.dataset.theme') === value, 'Theme ' + value);
  };
  const openNav = async () => { if (await js(`!document.querySelector('.app-side')`)) await click('打开导航'); };
  const keyLeak = async () => check(!(await text()).includes(fakeKey) && await js(`[...document.querySelectorAll('input')].every(e => !e.value.includes(${JSON.stringify(fakeKey)}))`), 'The Key never shows in the page');
  const providers = () => api('settings.listProviderSummaries');
  const deepseek = async () => (await providers()).find(provider => provider.kind === 'openai-compatible');

  if (phase === 'first') {
    // ── G · first use ──────────────────────────────────────────────────────────
    await has('让几位 AI 围坐一桌，替你把问题讨论透');
    const welcome = await text();
    for (const piece of ['连接模型服务', '先试玩演示', '回复是预先写好的示例，不代表真实模型的水平', '建房间、选成员（默认起草 · 审查 · 综合）', '所有数据只保存在这台电脑上', '还没有房间。连接模型或开始试玩后，会自动建好第一个房间。', '未连接模型'])
      check(welcome.includes(piece), 'Welcome says: ' + piece);
    check(await js(`!document.querySelector('[aria-label="讨论目标"]')`), 'No goal box before anything exists');
    await noOverflow('welcome 1280');
    await capture('welcome-1280-light', '首次启动（1280，浅色）：没有服务也没有房间，主区域是欢迎页——“连接模型服务”（主推，墨绿描边）和“先试玩演示”（写明回复是预先写好的示例、不代表真实模型水平）；下方三步说明与数据/Key 安全说明；侧栏写“还没有房间……会自动建好第一个房间”，设置旁提示“未连接模型”。');
    await theme('dark'); await resize(800, 600); await openNav(); await click('AI 圆桌', { selector: '.brand-home' });
    await has('先试玩演示'); await noOverflow('welcome 800');
    await capture('welcome-800-dark', '800×600 深色：欢迎页两张卡片改为上下排列，无横向滚动。点侧栏左上角“AI 圆桌”可以从设置回到首页（实操中发现首次使用时离开欢迎页后没有回来的入口，已补上）。');
    await resize(1280, 800); await theme('light'); await click('AI 圆桌', { selector: '.brand-home' });

    // D6-A: 开始试玩 — the demo service and 演示房间, the goal in the box, nothing started.
    await click('开始试玩');
    await has('这场讨论要解决什么？');
    const demoProvider = (await providers()).find(provider => provider.kind === 'mock');
    check(demoProvider && !demoProvider.isDefault, 'The demo service exists and is not the default');
    const demoRoom = (await api('rooms.listRooms')).find(room => room.name === '演示房间');
    const demoMembers = await api('rooms.listAgentConfigurations', { roomId: demoRoom.id });
    check(demoMembers.map(member => member.displayName).join() === '起草者,审查者,综合者' && demoMembers.every(member => member.modelId === 'mock'), 'Three demo members on Mock');
    check((await js(`document.querySelector('[aria-label="讨论目标"]').value`)).startsWith('为学校设计一个校园跑腿平台的试点方案'), 'The demo goal is in the box');
    check(fixture.requests.length === 0 && await js(`!localStorage.getItem('roundtable.runId')`), 'Nothing started');
    await capture('demo-ready', '点“开始试玩”：建好“演示（Mock）”服务（不是默认服务）和“演示房间”，三位演示成员起草者、审查者、综合者；示例目标已填进输入框，但没有自动开始。');
    await click('开始讨论');
    await statusHas('已完成', 60000);
    check((await runSnapshot()).turns.length === 3 && fixture.requests.length === 0, 'The demo discussion ran on Mock, with no network');
    await capture('demo-done', '演示讨论跑完：三位演示成员依次发言（Mock，不联网、不花钱）。');

    // ── E · connect wizard (D113) ───────────────────────────────────────────────
    await click('设置', { selector: '.sb-item' }); await click('添加服务');
    const step1 = await js(`document.querySelector('dialog[open]').innerText`);
    for (const [service, line] of [['OpenAI', '官方接口。价格尚未审核，暂时不能用于讨论。'], ['Anthropic Claude', '官方接口。价格尚未审核，暂时不能用于讨论。'], ['Google Gemini', '官方接口。价格尚未审核，暂时不能用于讨论。']])
      check(step1.includes(service) && step1.includes(line), service + ' says its price is unreviewed before setup');
    check(step1.includes('价格尚未审核，暂时不能用于讨论。') && step1.includes('“价格尚未审核”的服务可以保存 Key、检查连接，但在价格核对之前不会发送讨论请求'), 'Compatible services say so too');
    await capture('wizard-1-services', '设置 › 模型服务 › 添加服务，第 1 步：DeepSeek（推荐，已按官方价格核对）预选；OpenAI、Claude、Gemini、其他兼容服务都写明“价格尚未审核，暂时不能用于讨论”，配置之前就说清楚；演示（Mock）写明回复是预设示例。', 'dialog[open]');
    await click('下一步');
    check(await js(`document.querySelector('dialog[open] .target').textContent`) === 'Key 只会发往 https://api.deepseek.com', 'The address is written right above the Key');
    check((await text()).includes('保存即表示你确认了上面的地址'), 'Saving is the confirmation');
    await field('API Key'); await type(fakeKey);
    await capture('wizard-2-key', '第 2 步：地址“Key 只会发往 https://api.deepseek.com”写在 API Key 正上方，底部“保存即表示你确认了上面的地址”（D1-B）；Key 输入框是密码框，说明写明存进系统钥匙串、不会出现在记录/日志/导出里。', 'dialog[open]');
    await click('保存并连接');
    await has('DeepSeek 已连接'); await has('已为你建好房间「我的第一场讨论」');
    await keyLeak();
    const connected = await text();
    check(connected.includes('Key 还没有核对') && connected.includes('这个服务没有免费检查 Key 的接口'), 'DeepSeek has no free Key check, and the page says so');
    check(connected.includes('DeepSeek Flash 可以用于讨论') && connected.includes('约 ¥0.0001'), 'The model is usable; the optional paid check states its cost');
    check(fixture.requests.length === 0, 'Connecting sent no generation request');
    const ds = await deepseek();
    check(ds.isDefault && (await api('settings.getProviderKeyState', { providerId: ds.id })).sessionTargetConfirmed === true, 'DeepSeek is the default service with its target confirmed');
    await capture('wizard-3-connected', '第 3 步：Key 已存进钥匙串、地址已确认；DeepSeek 没有免费检查 Key 的接口，如实写“Key 还没有核对”；“DeepSeek Flash 可以用于讨论（价格已核对）”；可选“试发一条（约 ¥0.0001）”；连接第一个真实服务后自动建好“我的第一场讨论”（D6-A），三位成员都用 DeepSeek Flash。没有发出任何生成请求。', 'dialog[open]');
    await click('去开始讨论');
    await has('这场讨论要解决什么？');
    check((await js(`document.querySelector('[role=status][aria-label="运行状态"]')?.textContent ?? ''`)).includes('我的第一场讨论'), '去开始讨论 opens the new room');

    // ── F · room page, members, discussion mode ───────────────────────────────
    await click('我的第一场讨论', { selector: '.sb-item' });
    await until(`document.querySelector('.room-page')`, 'room page');
    check((await text()).split('DeepSeek Flash · 可以使用').length === 4, 'Three default members on DeepSeek Flash, each usable');
    check(await js(`[...document.querySelectorAll('.sidebar .sb-item')].some(e => e.getAttribute('aria-label') === '我的第一场讨论' && e.textContent.includes('3 人'))`), 'The sidebar shows the member count');
    await click('编辑'); await field('房间名称'); await selectAll(); await ime('xiaoyuan', '校园跑腿讨论'); await click('保存');
    await until(`document.querySelector('.room-page h1')?.textContent === '校园跑腿讨论'`, 'renamed');
    await click('添加成员'); await click('反方', { selector: '.choice', prefix: true });
    await field('名字'); await selectAll(); await ime('laozhou', '老周');
    check(await js(`document.querySelector('dialog[open] textarea').value.startsWith('你是反方。')`), 'The 反方 template fills 设定');
    check((await js(`document.querySelector('dialog[open]').innerText`)).includes('可以使用：Key 已保存，价格已核对。'), 'The default model is preselected and usable');
    await capture('member-dialog', '添加成员：六个角色模板，选“反方”自动填好名字、角色和设定；名字改成“老周”（输入法组合输入）；写明名字与角色的区别，以及“起草、审查、综合会自动带上内置的发言要求；其他角色按设定发言”；模型默认是默认服务的 DeepSeek Flash，“可以使用”。', 'dialog[open]');
    await click('添加');
    await until(`!document.querySelector('dialog[open]') && document.body.innerText.includes('老周')`, 'member added');
    await click('调整「老周」的顺序', { prefix: true }); await key('ArrowUp'); await key('ArrowUp');
    const roomId = (await api('rooms.listRooms')).find(room => room.name === '校园跑腿讨论').id;
    await until(`window.roundtable.rooms.listAgentConfigurations({ roomId: ${JSON.stringify(roomId)} }).then(list => list.map(a => a.displayName).join() === '起草者,老周,审查者,综合者')`, 'reordered by keyboard');
    await click('老周 参与讨论', { selector: '[role=switch]' });
    await until(`window.roundtable.rooms.listAgentConfigurations({ roomId: ${JSON.stringify(roomId)} }).then(list => list.find(a => a.displayName === '老周').enabled === false)`, 'switched off');
    await has('老周 暂不参与之后的讨论。');
    await capture('room-page', '房间页（单页）：改名为“校园跑腿讨论”；成员行写模型与可用状态；老周用键盘（拖动柄上按两次 ↑）移到第 2 位，再关掉“参与讨论”（变灰，“已暂停参与”）；讨论方式、讨论记录、归档或删除（删除是红色描边，与普通操作分开）。侧栏房间旁显示人数。');

    await click('更改');
    await click('审查修订链', { selector: '.choice', prefix: true });
    await until(`(document.querySelector('dialog[open] [role=status]')?.textContent ?? '').startsWith('已核对：预计 5 回合')`, 'workflow checked');
    check((await js(`document.querySelector('dialog[open]').innerText`)).includes('综合者不在这个流程里'), 'The dialog says who is not in the flow');
    await capture('mode-dialog', '讨论方式对话框（D2-B）：选“审查修订链”，起草和修订自动分给起草者、审查和复审分给审查者（按角色挑选）；改动即时由 Main 核对：“已核对：预计 5 回合……成员严格依次发言”；底部说明综合者不在流程里；“用于这个房间”。', 'dialog[open]');
    await click('用于这个房间');
    await until(`!document.querySelector('dialog[open]') && document.body.innerText.includes('起草：起草者 → 审查：审查者')`, 'mode remembered');
    await theme('dark'); await click('校园跑腿讨论', { selector: '.sb-item' });
    await capture('room-page-dark', '1280 深色：房间页的讨论方式卡片写着“审查修订链”和每个阶段的成员、回合与时长上限；停用的老周变灰。');
    await theme('light');

    // A discussion in the remembered mode: Main checks it again at the start; the status line and messages show the stage.
    await click('校园跑腿讨论', { selector: '.sb-item' }); await click('新讨论', { scope: '.room-page' });
    check(await js(`document.querySelector('[aria-label^="讨论方式："]').getAttribute('aria-label')`) === '讨论方式：审查修订链', 'The composer chip shows the remembered mode');
    await field('讨论目标'); await selectAll(); await ime('sheji', '为学校设计一个校园跑腿平台的试点方案：说清范围、定价和衡量指标。');
    fixture.chunkMs = 250;
    await click('开始讨论');
    await statusHas('第 1/5 步 · 起草', 30000);
    await capture('run-stage', '开始讨论：开始前 Main 按当时的成员重新核对讨论方式；状态行写“第 1/5 步 · 起草 · 起草者正在发言”。');
    fixture.chunkMs = 40;
    await statusHas('已完成', 90000);
    const run = await runSnapshot();
    check(run.workflow.templateId === 'review-revision' && run.turns.length === 5, 'Five plan turns in the review chain');
    check(fixture.requests.length === 5 && fixture.requests.every(request => request.model === 'deepseek-flash'), 'Five DeepSeek requests, nothing else');
    const tags = await js(`[...document.querySelectorAll('.thread-item .msg-head .tag')].map(e => e.textContent)`);
    check(JSON.stringify(tags) === JSON.stringify(['起草', '审查', '修订', '复审', '定稿']), 'Each message carries its stage: ' + JSON.stringify(tags));
    await capture('run-done', '讨论按审查修订链完成：每条发言头部带阶段标签（起草、审查、修订、复审、定稿）；老周已停用、综合者不在流程里，都没有发言。');

    // R13B leftover: a budget stop shows no greyed retry / continue anywhere.
    await click('新讨论', { scope: '.controls' });
    await field('讨论目标'); await selectAll(); await ime('yusuan', '预算很小的一场');
    await click('更多设置'); await field('本次运行预算（元）'); await selectAll(); await type('0.001'); await key('Escape');
    await click('开始讨论');
    await until(`document.querySelector('[role=alert][aria-label=预算不足]')`, 'budget stop');
    const stopped = await text();
    check(!stopped.includes('重试当前回合') && !stopped.includes('续写部分回复'), 'No retry or continue after a budget stop');
    check(await js(`![...document.querySelectorAll('button')].some(b => ['重试当前回合', '续写部分回复'].includes(b.textContent.trim()))`), 'Not even disabled');
    await capture('budget-stop', 'R13B 遗留问题复查：预算 ¥0.001 放不下一次请求，运行在发送前停下；时间线末尾只有“追加并继续”，本场信息里没有灰色的“重试当前回合 / 续写部分回复”。');

    // D6 companion: a room that never had a discussion can be deleted, after a red second step.
    await click('新建房间'); await field('房间名称'); await ime('linshi', '临时房间'); await click('新建');
    await until(`document.querySelector('.room-page h1')?.textContent === '临时房间'`, 'temporary room');
    check((await text()).split('DeepSeek Flash · 可以使用').length === 4, 'A new room has three default members on the default service');
    await click('删除…');
    check(await js(`document.activeElement?.textContent === '取消'`), 'Focus starts on 取消');
    await capture('room-delete', '新建“临时房间”（自动带三位默认成员）后在房间页底部点红色“删除…”：确认对话框写明不可撤销，删除按钮红底，焦点默认在“取消”。');
    await click('删除', { scope: 'dialog[open]' });
    await until(`!document.querySelector('dialog[open]') && !document.body.innerText.includes('临时房间')`, 'room deleted');
    check(!(await api('rooms.listRooms')).some(room => room.name === '临时房间'), 'Deleted in Main');

    // G · usage page with a time range.
    await click('用量', { selector: '.sb-item' });
    await until(`document.querySelector('.usage-page [aria-label="合计"]')`, 'usage');
    const usage = await text();
    check(usage.includes('5 次请求') || usage.includes('6 次请求'), 'This month counts the DeepSeek requests');
    check(usage.includes('按讨论') && usage.includes('待核对的未知费用'), 'Groupings and unknown charges');
    await capture('usage-month', '用量页（1280 浅色）：时间范围默认“本月”；合计、已结算、未知（按上限计）、已核销四张卡片；按讨论 / 按模型 / 按日期；说明写明按请求发出时间归入月份。');
    await field('时间范围'); await js(`(() => { const e = document.querySelector('[aria-label="时间范围"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, 'last-month'); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await has('上月没有使用真实模型的请求');
    await capture('usage-last-month', '时间范围选“上月”：如实写“上月没有使用真实模型的请求”，并提示可以换成“全部”。');
    await theme('dark'); await resize(800, 600); await openNav(); await click('用量', { selector: '.sb-item' });
    await until(`document.querySelector('.usage-page [aria-label="合计"]')`, 'usage dark'); await noOverflow('usage 800');
    await capture('usage-800-dark', '800×600 深色：统计卡片改为两列，表格在卡片内横向滚动，页面本身无横向滚动。');

    // E · network and proxy (D115) at 800 dark, then 1280 light.
    await openNav(); await click('设置', { selector: '.sb-item' }); await click('网络与代理');
    // Nothing waits for a restart yet: the note is neutral and says what runs now.
    await has('当前生效：直连，没有使用代理。改动保存后，重启应用才会生效。');
    check(!(await js(`document.querySelector('.net-effect').classList.contains('is-pending')`)), 'Neutral note while nothing waits for a restart');
    await click('通过本机代理连接', { selector: '[role=switch]' });
    await field('端口'); await selectAll(); await type(String(fixture.proxyPort));
    await has('要使用代理，需要勾选“由代理解析域名”。');
    check(await js(`[...document.querySelectorAll('button')].find(b => b.textContent === '保存设置').disabled`), 'Saving needs the explicit name-resolution choice');
    await noOverflow('network 800');
    await capture('network-800-dark', '设置 › 网络与代理（800 深色，设置分类变成顶部横向标签）：打开代理开关、端口填本机代理；“由代理解析域名”默认不勾，不勾时写明不能保存。当前生效：直连。');
    await resize(1280, 800); await theme('light'); await click('网络与代理');
    await click('通过本机代理连接', { selector: '[role=switch]' });
    await field('端口'); await selectAll(); await type(String(fixture.proxyPort));
    await click('由代理解析域名', { selector: 'input[type=checkbox]', prefix: true });
    await click('检测代理');
    await has('可以通过代理连到 api.deepseek.com');
    check(connects.length === 1 && connects[0].url === 'api.deepseek.com:443' && !connects[0].headers.includes('authorization') && !connects[0].headers.includes('proxy-authorization'), 'One keyless CONNECT to the fixed DeepSeek host');
    await click('保存设置'); await has('已保存，重启应用后生效。');
    await capture('network-saved', '勾选“由代理解析域名”（说明代理能看到访问哪个服务、看不到 Key 和内容）后“检测代理”：只做一次不带 Key 的 CONNECT 握手，显示“可以通过代理连到 api.deepseek.com”；保存后写明重启生效，出现“立即重启”。');
    const quit = app.quit; app.quit = () => { result.quitRequests++; };
    try { await click('立即重启'); await until(`true`, 'relaunch requested'); await sleep(500); } finally { app.quit = quit; }
    check(result.relaunches === 1 && result.quitRequests === 1, '立即重启 asked Main to relaunch and quit');
    await keyLeak();
  }

  if (phase === 'restart') {
    // The saved proxy is what this launch uses; the confirmed target was remembered (D113).
    await until(`document.querySelector('.sidebar')`, 'loaded');
    await click('设置', { selector: '.sb-item' });
    await has('可以使用');
    const card = await js(`document.querySelector('section[aria-label="DeepSeek"]').innerText`);
    check(card.includes('官方地址，保存 Key 时已确认') && card.includes('已保存（不显示）') && !card.includes('需要确认地址'), 'After a restart DeepSeek is usable without confirming again');
    const ds = await deepseek();
    check((await api('settings.getProviderKeyState', { providerId: ds.id })).sessionTargetConfirmed === true, 'Main remembered the confirmation');
    await capture('restart-services', '重启后（同一个 profile）设置 › 模型服务：DeepSeek 仍是“可以使用”，“官方地址，保存 Key 时已确认”——不再要求每次启动确认（D1-B / D113）。');
    await click('网络与代理');
    const savedPort = (await api('network.getSettings')).saved.port;
    check((await api('network.getSettings')).effective.source === 'settings', 'Main took the proxy from the saved settings at launch');
    await has(`当前生效：已开启 127.0.0.1:${savedPort}（来自这个页面的设置）`);
    check(!(await js(`document.querySelector('.net-effect').classList.contains('is-pending')`)), 'After the restart nothing is pending');
    check(await js(`document.querySelector('[role=switch]').getAttribute('aria-checked')`) === 'true', 'The saved proxy is shown as on');
    await capture('restart-network', `重启后 网络与代理：写明“当前生效：已开启 127.0.0.1:${savedPort}（来自这个页面的设置）”——Main 在启动时读到了页面保存的代理；没有待生效的改动，提示条是中性底色。`);
    await click('通过本机代理连接', { selector: '[role=switch]' }); await click('保存设置');
    await has('已保存，重启应用后生效。'); await has('保存的改动在重启应用后生效');
    check(await js(`document.querySelector('.net-effect').classList.contains('is-pending')`), 'A saved change waiting for a restart is marked');
    const quit = app.quit; app.quit = () => { result.quitRequests++; };
    try { await click('立即重启'); await sleep(500); } finally { app.quit = quit; }
    check(result.relaunches === 1, 'Restart requested to go direct again');
    await capture('restart-proxy-off', '关掉代理并保存：提示条转为提醒色，写明“保存的改动在重启应用后生效”，仍显示当前生效的是代理；点“立即重启”。');
  }

  if (phase === 'restart2') {
    await until(`document.querySelector('.sidebar')`, 'loaded');
    await click('设置', { selector: '.sb-item' }); await click('网络与代理');
    await has('当前生效：直连，没有使用代理');
    // D113: a discussion sends right away after the restart, with no confirmation step.
    await click('校园跑腿讨论', { selector: '.sb-item' }); await click('新讨论', { scope: '.room-page' });
    await field('讨论目标'); await selectAll(); await ime('chongqi', '重启后直接开始');
    const before = fixture.requests.length;
    await click('开始讨论');
    await statusHas('已完成', 90000);
    check(fixture.requests.length === before + 5, 'Five requests sent after the restart without confirming the target');
    await capture('restart-run', '再次重启（直连）后直接开始一场讨论：没有任何确认目标的步骤，审查修订链的 5 次请求照常发出并完成；讨论方式仍是房间记住的“审查修订链”。');
    // A new Key withdraws the confirmation at once: the card says so, a start is refused, one click confirms again.
    const ds = await deepseek();
    await api('settings.setKey', { providerId: ds.id, apiKey: fakeKey + '-new' });
    await click('设置', { selector: '.sb-item' });
    await has('需要确认地址');
    check((await js(`document.querySelector('section[aria-label="DeepSeek"] [role=note]')?.textContent ?? ''`)).includes('这把 Key 只会发往 https://api.deepseek.com'), 'The card writes the address beside the confirmation');
    await capture('rekey-needs-confirm', '换了 Key（这里用 API 模拟在别处换 Key）后，绑定立即失效：卡片显示“需要确认地址”，并写明“这把 Key 只会发往 https://api.deepseek.com……确认地址”。');
    await click('校园跑腿讨论', { selector: '.sb-item' }); await click('新讨论', { scope: '.room-page' });
    await field('讨论目标'); await selectAll(); await ime('jujue', '确认之前的一场');
    const refusedBefore = fixture.requests.length;
    await click('开始讨论');
    await until(`document.querySelector('.composer-alerts [role=alert]')`, 'refused start');
    check(fixture.requests.length === refusedBefore, 'Nothing sent before the new Key is confirmed');
    await capture('rekey-refused', '确认之前开始讨论：Main 拒绝发送，输入框上方说明原因，没有发出请求。');
    await click('设置', { selector: '.sb-item' });
    await click('确认地址');
    await has('地址已确认，之后不再询问');
    await has('可以使用');
    await capture('rekey-confirmed', '点“确认地址”：卡片回到“可以使用”，提示“之后不再询问；更换 Key 或地址时会再请你确认”。');
    // Replacing the Key through the page: the wizard writes the address above the Key again; saving is the new confirmation.
    await click('更换');
    check(await js(`document.querySelector('dialog[open] .target').textContent`) === 'Key 只会发往 https://api.deepseek.com', 'Replacing the Key shows the address again');
    await resize(800, 600);
    await capture('rekey-wizard-800', '800×600 浅色：在卡片上点“更换”，向导直接进入填 Key 这一步，地址再次写在 Key 上方，“保存并连接”即重新确认。');
    await key('Escape'); await resize(1280, 800); await theme('dark'); await click('模型服务'); await has('可以使用');
    await capture('services-dark', '1280 深色：设置 › 模型服务（演示服务“内置”、DeepSeek“可以使用”）。');
    await theme('light');
    await keyLeak();
  }
  await new Promise(done => { proxy.closeAllConnections(); proxy.close(done); });
  await finish();
}
main().catch(probe.fail);
