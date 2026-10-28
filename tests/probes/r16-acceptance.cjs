// R16 batch 1 hands-on acceptance of the new discussion screen, through the production build with real mouse,
// keyboard and IME input. Isolation, network blocking and the DeepSeek loopback fixture come from r16-harness.cjs.
// One screenshot per step into docs/verification/r16-impl-screens/. Usage: electron tests/probes/r16-acceptance.cjs
const { resolve } = require('node:path');
const { clipboard } = require('electron');
const { createProbe } = require('./r16-harness.cjs');

const probe = createProbe({ prefix: 'roundtable-r16-acceptance', name: 'R16_ACCEPTANCE', timeoutMs: 900000 });
const { fixture, check, sleep } = probe;
const screens = resolve(probe.root, 'docs/verification/r16-impl-screens');
const fakeKey = 'r16-fake-deepseek-key';

const code = '骑手实得 = 基础费 × (1 − 抽成) + 距离加价\n2 元单：2 × 0.92 = 1.84 元';
const replies = {
  起草者: '### 试点方案（初稿）\n\n1. **范围：**3 栋宿舍楼，试点 4 周，覆盖约 2,400 名学生。\n2. **服务：**代取快递、食堂代买、打印店代取三类。\n3. **定价：**基础费 2 元/单，超过 1 公里每 500 米加 0.5 元；平台抽成 15%。\n4. **目标：**日均 300 单，平均 25 分钟内送达。',
  审查者: '只补三处问题，不重复初稿：\n\n| 问题 | 风险 | 建议 |\n| --- | --- | --- |\n| 夜间配送 | 22 点后宿舍门禁，骑手安全没有保障 | 22 点后暂停接单 |\n| 抽成 15% | 2 元的单骑手只拿到 1.7 元，留不住人 | 试点期抽成降到 8% |\n| 日均 300 单 | 没有依据 | 先做一周问卷 |',
  综合者: `综合两位的意见，算一笔账：\n\n\`\`\`text\n${code}\n\`\`\`\n\n参考资料见 [学校后勤公告](https://example.edu/notice)。<script>window.__pwned = 1</script> <img src=x onerror="window.__pwned=3"> [不安全的链接](javascript:window.__pwned=2)`,
};
fixture.reply = body => {
  const last = body.messages.at(-1).content;
  if (last.includes('【请写摘要】')) return '**摘要**：试点 2 栋宿舍楼、2 周；22 点后暂停接单；抽成试点期 8%。未决：骑手保险。';
  const member = /现在由你（成员「([^」]+)」/u.exec(last)?.[1];
  return replies[member] ?? '好的，我补充一点。';
};


// Measured contrast of rendered text against the colour actually behind it (WCAG 2.x relative luminance).
const contrastScript = `(() => {
  const parse = value => { const m = value.match(/rgba?\\(([^)]+)\\)/u); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/u).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const behind = element => { for (let e = element; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; } return parse(getComputedStyle(document.documentElement).backgroundColor); };
  const ratio = (fg, bg) => { const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return Math.round((a + 0.05) / (b + 0.05) * 100) / 100; };
  const pick = { 正文: '.thread-item .md p', 成员名: '.msg-name', 模型名: '.msg-meta', 页脚金额: '.msg-foot .cost', 侧栏元信息: '.sb-foot .meta', 侧栏讨论: '.sb-runs .sb-item', 状态胶囊: '.tb-sub .pill',
    主按钮: '.controls .slot', 停止: '.controls .is-danger', 提示条: '.note .note-body', 输入框提示: '.dock-hint', 主持人气泡: '.bubble', 本场信息说明: '.ctx-note' };
  const out = {};
  for (const [name, selector] of Object.entries(pick)) { const e = document.querySelector(selector); if (!e || !e.getClientRects().length) continue; const fg = parse(getComputedStyle(e).color); out[name] = ratio(fg, behind(e)); }
  // Control boundary: the composer outline against the canvas (non-text, needs 3:1).
  const composer = document.querySelector('.composer'); if (composer) out['输入框边框'] = ratio(parse(getComputedStyle(composer).borderTopColor), behind(composer.parentElement));
  return out;
})()`;

async function main() {
  const ui = await probe.start({ screens, fixedClock: '2026-10-23T10:00:00+08:00' });
  const { js, until, click, field, key, selectAll, ime, type, capture, api, status, text, resize, find, mouse, runSnapshot } = ui;
  const statusHas = (value, timeout) => until(`(document.querySelector('[role=status][aria-label="运行状态"]')?.textContent ?? '').includes(${JSON.stringify(value)})`, 'status ' + value, timeout);
  const noOverflow = async label => check(await js('document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth'), `${label}: no horizontal page scroll`);
  // R16 batch 2: 外观 is a section of 设置; the discussion is reopened from its entry in the sidebar.
  const setTheme = async value => {
    const task = (await runSnapshot())?.execution?.task;
    await click('设置', { selector: '.sb-item' }); await click('外观');
    await click({ system: '跟随系统', light: '浅色', dark: '深色' }[value], { selector: '.choice' });
    check(await js(`document.documentElement.dataset.theme`) === value, `Theme ${value} applied`);
    await click(task, { selector: '.sb-runs .sb-item', prefix: true });
  };

  // Setup (accepted hands-on in R13A/R13B): a DeepSeek Provider with a fake Key and confirmed session target,
  // and a room with three DeepSeek members. Everything after this is real input in the new screen.
  const provider = await api('settings.createProvider', { name: 'DeepSeek 直连', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] });
  await api('settings.setKey', { providerId: provider.id, apiKey: fakeKey });
  await api('settings.confirmTarget', { providerId: provider.id, baseUrl: 'https://api.deepseek.com', confirmed: true });
  const room = await api('rooms.createRoom', { name: '校园跑腿讨论', objective: '' });
  const agents = [];
  for (const [index, [name, role]] of [['起草者', '起草'], ['审查者', '审查'], ['综合者', '综合']].entries()) {
    agents.push(await api('rooms.createAgent', { roomId: room.id, displayName: name, roleTemplateId: role, systemPrompt: '', providerId: provider.id, modelId: 'deepseek-flash', enabled: true, displayOrder: index }));
  }
  await js('location.reload(); true'); await until(`document.querySelector('.sidebar')`, 'reloaded'); await ui.ensureLocator();

  // ── 1. New discussion ──────────────────────────────────────────────
  // R16 batch 2: the room opens on its page; 新讨论 there starts a discussion in it.
  await click('校园跑腿讨论', { selector: '.sb-item' }); await click('新讨论', { scope: '.room-page' });
  await until(`document.body.innerText.includes('这场讨论要解决什么？') && document.body.innerText.includes('起草者、审查者、综合者')`, 'empty room state');
  await field('讨论目标'); await selectAll();
  // An Enter that only confirms the IME candidate must not start anything; ⌘Enter is the start shortcut.
  await ime('sheji', '为学校设计一个校园跑腿平台的试点方案：说清服务范围、定价、骑手来源和衡量指标。', { enterWhileComposing: true });
  check(fixture.requests.length === 0 && !(await js(`document.querySelector('[aria-label="运行控制"]')`)), 'IME Enter in the goal box did not start a discussion');
  await capture('new-light', '新讨论');
  await click('更多设置');
  check(await js(`document.querySelector('[role=group][aria-label="更多设置"] [aria-label="单次输出上限（token）"]').value`) === '4096', 'Output limit defaults to 4096 in 更多设置');
  await capture('settings-pop-light', '更多设置');
  await key('Escape');
  check(!(await js(`document.querySelector('[role=group][aria-label="更多设置"]')`)), 'Esc closes the settings popover');

  // ── 2. Start: 开始讨论 becomes 暂停 in place ──────────────────────────
  fixture.mode = 'hang';
  const start = await ui.point('开始讨论', { noScroll: true });
  await field('讨论目标'); await key('Enter', 4); // ⌘Enter
  await until(`document.querySelector('[aria-label="运行控制"]')`, 'run controls');
  const pause = await ui.point('暂停', { noScroll: true });
  check(Math.abs(pause.left + pause.w - (start.left + start.w)) < 1.5 && Math.abs(pause.top - start.top) < 1.5 && Math.abs(pause.w - start.w) < 1.5, 'D098: 暂停 takes exactly the place and width of 开始讨论');
  check(await js(`document.querySelector('[aria-label="讨论目标"]') === null && document.querySelector('[aria-label="主持人插话"]') !== null`), 'Running: the box is now the interjection box');
  await until(`document.querySelector('.thread-item .md')?.textContent.includes('试点方案')`, 'streamed text visible');
  check((await status()).includes('运行中') && (await text()).includes('正在发言 · 已预留最高 ¥'), 'Status says running; the streaming reply shows its reservation');
  await capture('running-light', '运行中');

  // ── 3. D4: @ names the next speaker and interjects; Enter while composing does not send ──
  await click('点名', { selector: '.chip' });
  await until(`document.querySelector('[role=listbox][aria-label="点名下一位"]')`, 'mention menu');
  await key('ArrowDown'); await key('ArrowDown');
  await capture('mention-menu-light', '@ 点名菜单');
  await key('Enter');
  check((await js(`document.querySelector('[aria-label="主持人插话"]').value`)).startsWith('@综合者 '), 'Picking from the menu writes @综合者 into the box');
  await ime('qingzhongdian', '请重点算一下骑手收入，22 点后不接单。', { enterWhileComposing: true });
  check(fixture.requests.length === 1 && !(await runSnapshot()).host?.override, 'Enter while composing sent nothing');
  await key('Enter');
  await until(`document.body.innerText.includes('已点名综合者并发送插话')`, 'D4 feedback');
  let snap = await runSnapshot();
  check(snap.host.override?.agentId === agents[2].id && snap.messages.some(message => message.content === '@综合者 请重点算一下骑手收入，22 点后不接单。'), 'D4: setOverride then interject both reached Main');
  check((await js(`document.querySelector('[aria-label="下一位"]').textContent`)).includes('下一位：综合者（主持人点名'), 'Next-speaker line shows the override');
  await capture('interjected-light', '带 @ 的插话', '.msg.is-host');

  // ── 4. Pause in place; a standing instruction from the box ──────────
  await click('暂停');
  await statusHas('正在暂停');
  fixture.mode = 'ok'; fixture.release();
  await statusHas('已暂停', 30000);
  const resume = await ui.point('继续', { noScroll: true });
  check(Math.abs(resume.left - pause.left) < 1.5 && Math.abs(resume.top - pause.top) < 1.5 && Math.abs(resume.w - pause.w) < 1.5, 'D098: 继续 takes the place of 暂停');
  await field('主持人插话'); await ime('suoyou', '所有金额精确到元，并标出依据。');
  await click('设为持续指令');
  await until(`document.body.innerText.includes('已设为持续指令')`, 'instruction saved');
  snap = await runSnapshot();
  check(snap.host.instructions.some(item => item.status === 'active' && item.content === '所有金额精确到元，并标出依据。'), 'Standing instruction set from the box');
  await capture('paused-light', '暂停后');

  // ── 5. Stop asks once, above the button, and 继续 does not move ─────
  await click('停止');
  await until(`document.querySelector('[role=dialog][aria-label="确认停止运行"]')`, 'stop confirm');
  const resumeDuring = await ui.point('继续', { noScroll: true });
  check(resumeDuring.left === resume.left && resumeDuring.top === resume.top, 'The confirmation does not move 继续');
  check(await js(`document.activeElement?.textContent === '不停止'`), 'Focus starts on 不停止');
  check((await js(`document.querySelector('[role=dialog][aria-label="确认停止运行"]').innerText`)).includes('后续回合不再执行'), 'Paused wording does not claim a request in flight');
  await capture('stop-confirm-light', '确认停止');
  await key('Escape');
  check(!(await js(`document.querySelector('[role=dialog][aria-label="确认停止运行"]')`)) && await js(`document.activeElement?.textContent?.includes('停止')`), 'Esc cancels and returns focus to 停止');

  // ── 6. 下一步 lets exactly the named member speak, then 继续 runs to the end ──
  await click('下一步');
  await until(`document.querySelectorAll('.msg-name').length === 2`, 'one step');
  await statusHas('已暂停', 30000);
  snap = await runSnapshot();
  check(snap.turns.length === 2 && snap.turns[1].agentId === agents[2].id && Boolean(snap.turns[1].overrideActionId), '下一步 ran one Turn: the named 综合者');
  check(fixture.requests[1].messages.some(message => message.content.includes('所有金额精确到元')), 'The standing instruction reached the next request');
  await click('继续');
  await statusHas('已完成', 30000);
  snap = await runSnapshot();
  // D110: the named 综合者 is inserted; the plan's 审查者 and 综合者 still speak.
  check(snap.turns.map(turn => agents.findIndex(agent => agent.id === turn.agentId)).join() === '0,2,1,2', 'Order: 起草者, 综合者 (named, inserted), 审查者, 综合者');
  check(await js(`window.__pwned === undefined && !document.querySelector('a[href^="javascript"]') && !document.querySelector('.md script, .md img')`), 'Model HTML and javascript: links are never executed or loaded');
  await capture('completed-light', '已完成', '.codeblock');

  // Copy code, and an https link goes through Main's confirmation.
  await click('复制代码');
  check(clipboard.readText() === code, 'Copy code puts the exact code on the clipboard');
  const link = await js(`(() => { const a = [...document.querySelectorAll('.md a')].find(e => e.textContent === '学校后勤公告'); a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await mouse(link.x, link.y); await sleep(400);
  check(probe.result.externalLinkPrompts.length === 1 && probe.result.externalLinkPrompts[0].detail === 'https://example.edu/notice', 'An https link asks Main before opening (the probe answered 取消)');

  // ── 7. Edit → affected → regenerate from the note ──────────────────
  await click('修改', { slot: 0 });
  await field('修改消息内容'); await selectAll(); await ime('fangan', '### 试点方案（主持人修改）\n\n1. **范围：**2 栋宿舍楼，试点 2 周。\n2. **时段：**8:00–22:00，22 点后不接单。');
  await key('Enter');
  await until(`document.querySelectorAll('.thread-item .note').length >= 2 && document.body.innerText.includes('版本 2/2')`, 'edited and affected');
  check((await js(`document.querySelectorAll('.thread-item')[0].innerText`)).includes('主持人修改'), 'Version 2/2 from the host edit');
  await capture('edited-affected-light', '修改后受影响', '.thread-item:nth-child(3) .note');
  const before = fixture.requests.length;
  await click('重新生成', { scope: '.note', which: 'last' });
  await until(`[...document.querySelectorAll('.thread-item')].at(-1).innerText.includes('版本 2/2')`, 'regenerated', 30000);
  check(fixture.requests.length === before + 1, 'Regenerate sent exactly one request');
  await capture('regenerated-light', '重新生成', '.thread-item:last-child');

  // ── 8. 本场信息: members and instructions; edit an instruction ─────
  await click('成员', { selector: '[role=tab]', prefix: true });
  await capture('panel-members-light', '本场信息 成员');
  await click('指令', { selector: '[role=tab]', prefix: true });
  await click('修改', { scope: '.instr' });
  await field('修改持续指令'); await selectAll(); await ime('jine', '所有金额精确到元，标出依据；不确定的数字写“待核实”。');
  await click('保存修改');
  await until(`document.querySelector('.instr')?.innerText.includes('第 2 版')`, 'instruction revised');
  await click('运行详情（排查问题时用）', { selector: 'summary' });
  await capture('panel-instructions-light', '本场信息 指令');
  await click('运行详情（排查问题时用）', { selector: 'summary' });
  await click('产物', { selector: '[role=tab]' });
  const panelText = await js(`document.querySelector('.run-panel').innerText`);
  // R14: the artifacts tab is live; it states the cost and the adoption rule, without development terms.
  check(panelText.includes('整理成…') && panelText.includes('每次生成发送 1 次请求') && panelText.includes('模型写的版本要你采用后才算数') && !panelText.includes('即将推出') && !/R1[45]/u.test(panelText), 'Artifacts tab states cost and adoption without development terms');
  await click('进度', { selector: '[role=tab]' });

  // ── 9. Summary: dialog with coverage and cost; nothing is sent until the button ─
  await click('生成讨论摘要…');
  await until(`document.querySelector('dialog.modal .summary-cost')`, 'summary dialog');
  check(fixture.requests.length === before + 1, 'Opening the summary dialog sent nothing');
  await capture('summary-dialog-light', '摘要对话框');
  await click('生成摘要（发送 1 次请求）');
  await until(`document.querySelector('.summary-card')?.innerText.includes('待确认')`, 'summary pending', 30000);
  await capture('summary-pending-light', '摘要待确认', '.summary-card');
  await click('确认使用');
  await until(`document.querySelector('.summary-card')?.innerText.includes('已确认 · 之后的发言用它代替原文')`, 'summary confirmed');
  check(await js(`document.querySelectorAll('.msg.is-covered').length >= 1`), 'Covered originals are marked and still shown');
  await capture('summary-confirmed-light', '摘要已确认', '.summary-card');

  // ── 10. Truncated → 续写; stop from paused ──────────────────────────
  await click('新讨论', { selector: '.sb-new' });
  await field('讨论目标'); await ime('dingjia', '把定价细化到每类订单');
  await click('每回合后暂停', { selector: 'input[type=checkbox]' });
  fixture.mode = 'length';
  await click('开始讨论');
  await statusHas('已暂停', 30000);
  await until(`document.body.innerText.includes('写到单次上限停下了')`, 'truncated note');
  await capture('truncated-light', '写到上限', '.thread-item .note');
  fixture.mode = 'ok';
  await click('续写', { scope: '.note' });
  await until(`document.querySelector('.thread-item')?.innerText.includes('版本 2/2')`, 'continued', 30000);
  check((await js(`document.querySelector('.thread-item').innerText`)).includes('续写'), 'Continuation is version 2 marked 续写');
  await capture('continued-light', '续写', '.thread-item');
  await click('停止'); await click('停止讨论');
  await statusHas('已停止', 30000);
  check((await text()).includes('已停止 · 已生成的文字都保留'), 'Stopped notice at the end');
  await capture('stopped-light', '已停止');

  // ── 11. Budget stop → top up and continue ───────────────────────────
  await click('新讨论', { selector: '.sb-new' });
  await field('讨论目标'); await ime('baoxian', '骑手保险怎么买');
  await click('更多设置'); await field('本次运行预算（元）'); await selectAll(); await type('0.001'); await key('Escape');
  await click('开始讨论');
  await until(`document.querySelector('[role=alert][aria-label="预算不足"]')`, 'budget stop');
  check(await js(`document.querySelector('.budget-chip').classList.contains('is-warn')`) && (await status()).includes('已因预算停止'), 'Budget chip and status turn to the budget stop');
  check(!(await find('重试当前回合')) && !(await find('续写部分回复')), 'No retry/continue while the budget holds the Run');
  check(await js(`[...document.querySelectorAll('.controls .slot')].some(e => e.textContent === '继续' && e.disabled)`), '继续 is greyed with its reason');
  await capture('budget-stop-light', '预算停下');
  await field('追加预算（元）', { scope: '.notice-card' }); await selectAll(); await type('0.5');
  await click('追加并继续');
  await statusHas('已暂停', 30000);
  check((await runSnapshot()).budget.topUps.length === 1, 'Top-up recorded and the same Run continued');
  await capture('topped-up-light', '追加后继续');

  // ── 12. Unknown cost → write-off from the amount in the footer ──────
  fixture.mode = 'no-usage';
  await click('下一步');
  await until(`[...document.querySelectorAll('.cost')].some(e => e.textContent.startsWith('费用未知'))`, 'unknown cost', 30000);
  await statusHas('已暂停', 30000);
  await click('费用未知', { selector: '.cost', prefix: true, which: 'last' });
  await click('核销', { scope: '.msg-details' });
  await field('实际金额（元）'); await type('0.0003');
  await field('依据说明'); await ime('kongzhitai', '控制台十月二十三日用量明细');
  await click('我已在服务商控制台核对过这次请求的实际扣费', { selector: 'input[type=checkbox]' });
  await capture('writeoff-form-light', '核销表单', '.writeoff-form');
  await click('保存核销');
  await until(`[...document.querySelectorAll('.cost')].some(e => e.textContent.startsWith('已核销 ¥0.0003'))`, 'written off');
  fixture.mode = 'ok';
  await capture('written-off-light', '已核销', '.msg-details');

  // Measured contrast in the light theme on this paused discussion (text ≥ 4.5:1, control boundary ≥ 3:1).
  probe.result.contrast = { light: await js(contrastScript) };
  for (const [name, value] of Object.entries(probe.result.contrast.light)) check(value >= (name === '输入框边框' ? 3 : 4.5), `Light contrast ${name} ${value}:1`);

  // ── 13. Narrow windows: 1280, 1024 drawer, 800 drawers; no horizontal scroll ─
  await resize(1280, 800); await noOverflow('1280');
  await capture('w1280-light', '1280');
  await resize(1024, 768); await noOverflow('1024');
  check(!(await js(`document.querySelector('.app-context')`)), '1024: 本场信息 is no longer a column');
  await click('本场信息');
  await until(`document.querySelector('.drawer.is-right')`, 'panel drawer');
  await capture('w1024-panel-drawer-light', '1024 抽屉');
  await key('Escape');
  check(!(await js(`document.querySelector('.drawer')`)) && await js(`document.activeElement?.getAttribute('aria-label') === '本场信息'`), 'Esc closes the drawer and focus returns to its button');
  await resize(800, 600); await noOverflow('800');
  await capture('w800-paused-light', '800 暂停');
  await click('打开导航');
  await until(`document.querySelector('.drawer.is-left')`, 'nav drawer');
  await capture('w800-nav-drawer-light', '800 导航抽屉');
  await key('Escape');
  await click('本次预算', { prefix: true, selector: '.budget-chip' });
  await until(`document.querySelector('.drawer.is-right')`, 'panel drawer at 800');
  await capture('w800-panel-drawer-light', '800 本场信息抽屉');
  await key('Escape');

  // ── 14. Dark theme over the same paths ─────────────────────────────
  await resize(1440, 900);
  await setTheme('dark');
  await capture('paused-dark', '深色 暂停');
  probe.result.contrast.dark = await js(contrastScript);
  for (const [name, value] of Object.entries(probe.result.contrast.dark)) check(value >= (name === '输入框边框' ? 3 : 4.5), `Dark contrast ${name} ${value}:1`);
  await click('为学校设计一个校园跑腿平台的试点方案', { selector: '.sb-runs .sb-item', prefix: true });
  await until(`document.querySelector('.summary-card')`, 'first run reopened');
  await capture('summary-dark', '深色 摘要', '.summary-card');
  await js(`document.querySelectorAll('.thread-item')[2]?.scrollIntoView({ block: 'center' }); true`);
  await capture('table-dark', '深色 表格');
  await click('新讨论', { selector: '.sb-new' });
  await field('讨论目标'); await ime('pinggu', '评估一下试点的风险');
  // Main runs one discussion at a time; the paused one is named before 开始讨论, not after a refused start.
  await until(`document.querySelector('.composer-blocked')?.textContent.includes('骑手保险怎么买')`, 'another discussion still live');
  check(await js(`[...document.querySelectorAll('.controls .slot')].some(e => e.textContent === '开始讨论' && e.disabled)`), 'Start waits while another discussion is live');
  await capture('blocked-dark', '深色 另一场未结束');
  await click('回到那场讨论');
  await statusHas('已暂停');
  await click('停止'); await click('停止讨论');
  await statusHas('已停止', 30000);
  await click('新讨论', { selector: '.sb-new' });
  await click('更多设置'); await field('本次运行预算（元）'); await selectAll(); await type('1'); await key('Escape');
  await click('每回合后暂停', { selector: 'input[type=checkbox]' });
  await field('讨论目标'); await selectAll(); await ime('pinggu', '评估一下试点的风险');
  await capture('new-dark', '深色 新讨论');
  fixture.mode = 'hang';
  await click('开始讨论');
  await until(`document.querySelector('.thread-item .md')`, 'streaming in dark');
  await click('停止');
  await until(`document.querySelector('[role=dialog][aria-label="确认停止运行"]')`, 'stop confirm in dark');
  check((await js(`document.querySelector('[role=dialog][aria-label="确认停止运行"]').innerText`)).includes('可能已经计费'), 'Running stop wording warns of a billed request and its cap');
  await capture('stop-confirm-dark', '深色 运行中停止');
  await click('停止讨论');
  await statusHas('已停止', 30000);
  fixture.mode = 'ok'; fixture.release();
  await until(`document.body.innerText.includes('重试当前回合')`, 'retry offered after an aborted turn');
  await capture('stopped-retry-dark', '深色 停止后重试');
  await click('重试当前回合');
  await statusHas('已完成', 30000);
  await capture('retried-dark', '深色 重试完成');
  await resize(800, 600); await noOverflow('800 dark');
  await capture('w800-dark', '深色 800');
  await click('本场信息');
  await until(`document.querySelector('.drawer.is-right')`, 'panel drawer dark');
  await capture('w800-panel-drawer-dark', '深色 800 抽屉');
  await key('Escape');
  // 200% zoom at 1600×1000: the usable width is 800, so the narrow layout applies and the controls stay reachable.
  await resize(1600, 1000);
  ui.contents.setZoomFactor(2); await until(`window.innerWidth === 800`, '200% zoom applied', 10000); await sleep(400);
  await noOverflow('1600 at 200%');
  check(await js(`(() => { const r = document.querySelector('.composer').getBoundingClientRect(); const stop = [...document.querySelectorAll('.controls button')].map(e => e.getBoundingClientRect());
    return r.bottom <= innerHeight && r.right <= innerWidth && !!document.querySelector('[aria-label="打开导航"]') && stop.every(b => b.right <= innerWidth && b.bottom <= innerHeight); })()`), '200%: composer, controls and the navigation button are all on screen');
  await capture('zoom200-dark', '深色 200% 缩放');
  ui.contents.setZoomFactor(1); await until(`window.innerWidth === 1600`, 'zoom reset', 10000);
  // Reduced motion: the live dot and drawer animations stop.
  await ui.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  check(await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`), 'Reduced motion emulated');
  check(await js(`(() => { const e = document.createElement('span'); e.className = 'pill is-live'; e.innerHTML = '<span class="dot"></span>'; document.body.append(e); const d = getComputedStyle(e.firstChild).animationDuration; e.remove(); return d === '0s'; })()`), 'Reduced motion: the live status dot does not pulse');
  await ui.send('Emulation.setEmulatedMedia', { features: [] });
  await resize(1440, 900);
  await setTheme('light');

  check(!JSON.stringify(probe.result).includes(fakeKey), 'Key absent from the result');
  await ui.finish();
}
main().catch(probe.fail);
