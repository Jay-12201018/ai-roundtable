// R14 hands-on acceptance: structured artifacts through the production build with real mouse, keyboard and IME input.
// Isolation, network blocking and the DeepSeek loopback fixture come from r16-harness.cjs; the fixture answers each
// artifact request with scripted JSON (one deliberately invalid). Two launches of one profile:
//   electron tests/probes/r14-acceptance.cjs                   discussion → four artifacts → invalid JSON fixed by hand → source edited → regenerate → export
//   electron tests/probes/r14-acceptance.cjs --restart <dir>   artifacts, versions and states are intact; nothing is sent
// Screenshots go to docs/verification/r14-screens/ (01–39 first launch, 40–49 restart).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { basename, join, resolve } = require('node:path');
const { clipboard, dialog } = require('electron');
const { createProbe } = require('./r16-harness.cjs');

const args = process.argv.slice(2).filter(arg => !arg.startsWith('--inspect'));
const phase = args[0] === '--restart' ? 'restart' : 'first';
assert.ok(phase === 'first' ? args.length === 0 : args.length === 2, 'Usage: electron r14-acceptance.cjs [--restart <profile directory>]');
const probe = createProbe({ prefix: 'roundtable-r14', name: 'R14', timeoutMs: 900000, phase, reuse: phase === 'first' ? undefined : args[1] });
const { fixture, check, sleep, result } = probe;
const screens = resolve(probe.root, 'docs/verification/r14-screens');
const fakeKey = 'r14-fake-deepseek-key';
// The probe copies to the system clipboard; it starts from a known value so nothing earlier is read or recorded.
clipboard.writeText('r14-probe-clipboard-start');
const exportsDir = join(probe.directory, 'exports');
fs.mkdirSync(exportsDir, { recursive: true, mode: 0o700 });
// Main's save dialog: the probe "picks" a file in its own directory and records what it was offered.
result.saveDialogs = [];
dialog.showSaveDialog = async (_window, options) => { result.saveDialogs.push({ title: options.title, name: basename(options.defaultPath), filters: options.filters });
  return { canceled: false, filePath: join(exportsDir, basename(options.defaultPath)) }; };

const replies = {
  起草者: '### 试点方案（初稿）\n\n1. 范围：3 栋宿舍楼，试点 4 周。\n2. 定价：基础费 2 元/单，平台抽成 15%。\n3. 骑手：招募 20 名在校生。',
  审查者: '两处问题：抽成 15% 偏高，骑手留不住；22 点后宿舍门禁，夜间单要暂停。负责人和上线日期都还没定。',
  综合者: '综合：试点抽成降到 8%，22 点后暂停接单；先做一周问卷再定目标。由起草者整理问卷，第 2 周前完成。',
};
const json = value => JSON.stringify(value, null, 2);
const prd = (scope = '3 栋宿舍楼') => json({
  title: '校园跑腿试点 PRD', background: `学校希望在${scope}试点校园跑腿，先验证需求和定价。<script>window.__pwned = 1</script>`,
  goals: ['验证学生对跑腿服务的需求', '找到骑手愿意接受的抽成比例'],
  requirements: [
    { id: 'R1', title: '下单与接单', description: `学生可以在${scope}范围内发布跑腿订单，骑手接单后**实时**看到取送地点。`, priority: 'must', acceptanceCriteria: ['填写取件和送达地点后可以提交订单', '骑手接单后 1 分钟内双方都能看到状态'], sources: [1] },
    { id: 'R2', title: '定价与抽成', description: '基础费 2 元/单，平台抽成 8%。<img src=x onerror="window.__pwned=2">', priority: 'must', acceptanceCriteria: ['结算页显示基础费和抽成'], sources: [1, 3] },
    { id: 'R3', title: '夜间暂停', description: '22 点后暂停接单，避开宿舍门禁。', priority: 'should', acceptanceCriteria: ['22:00 后下单入口显示“暂停接单”'], sources: [2, 3] },
  ],
  nonGoals: ['不做校外配送'], openQuestions: ['试点的衡量指标还没定'],
});
const invalidMinutes = '```json\n' + json({
  title: '校园跑腿试点讨论纪要', summary: '三位成员讨论了试点范围、定价和夜间安排。', participants: '起草者、审查者、综合者',
  conclusions: [{ text: '抽成从 15% 降到 8%', sources: [2, 3] }, { text: '22 点后暂停接单', sources: [7] }],
  decisions: [{ text: '先做一周问卷再定目标', rationale: '目标还没有依据', sources: [3] }],
  openIssues: [{ text: '负责人和上线日期', sources: [2] }],
}) + '\n```';
const actions = json({ title: '校园跑腿试点行动清单', items: [
  { id: 'A1', task: '整理需求问卷', owner: '起草者', due: '第 2 周前', status: 'todo', sources: [3] },
  { id: 'A2', task: '招募 20 名在校生骑手', owner: null, due: null, status: 'todo', sources: [1] },
  { id: 'A3', task: '确认宿舍门禁时间', owner: null, due: null, status: 'blocked', sources: [2] },
] });
const code = json({ title: '订单费用计算', summary: '按基础费 2 元和 8% 抽成计算骑手收入；22 点后拒绝下单。', files: [
  { path: 'src/pilot/fee.ts', language: 'typescript', description: '费用与夜间规则', content: "export const BASE_FEE = 2;\nexport const COMMISSION = 0.08;\n\n/** 骑手实收：基础费扣掉平台抽成。 */\nexport function riderIncome(fee = BASE_FEE): number {\n  return Math.round(fee * (1 - COMMISSION) * 100) / 100;\n}\n\nexport function canOrder(hour: number): boolean {\n  return hour < 22;\n}\n" },
], notes: ['没有处理节假日', '金额精确到分'] });
// The first code request finds no code in this discussion and says so (D124); the regeneration then writes some.
const nothingCode = json({ nothing: '讨论记录中没有出现任何代码设计或实现要求，没有可整理的代码候选。' });
const artifactReplies = { '需求文档（PRD）': [prd(), prd('2 栋宿舍楼')], 会议纪要: [invalidMinutes], 行动清单: [actions, actions], 代码候选: [nothingCode, code] };
const artifactKind = body => /整理「([^」]+)」。只输出 JSON 对象。$/u.exec(body.messages.at(-1).content)?.[1];
fixture.reply = body => {
  const kind = artifactKind(body);
  if (kind) return artifactReplies[kind].shift() ?? '{}';
  return replies[/现在由你（成员「([^」]+)」/u.exec(body.messages.at(-1).content)?.[1]] ?? '好的，补充一点。';
};

async function main() {
  const ui = await probe.start({ screens, width: 1280, height: 800, keepScreens: phase !== 'first', firstShot: phase === 'first' ? 0 : 39 });
  const { js, until, click, field, key, selectAll, ime, type, capture, resize, api, text, runSnapshot, finish } = ui;
  const has = (value, timeout) => until(`document.body.innerText.includes(${JSON.stringify(value)})`, value, timeout);
  const statusHas = (value, timeout) => until(`(document.querySelector('[role=status][aria-label="运行状态"]')?.textContent ?? '').includes(${JSON.stringify(value)})`, 'status ' + value, timeout);
  const noOverflow = async label => check(await js('document.documentElement.scrollWidth <= window.innerWidth'), `${label}: no horizontal page scroll`);
  const reader = () => js(`document.querySelector('dialog.artifact-reader')?.innerText ?? ''`);
  const readerHas = (value, timeout) => until(`(document.querySelector('dialog.artifact-reader')?.innerText ?? '').includes(${JSON.stringify(value)})`, 'reader ' + value, timeout);
  const panelOpen = async () => {
    if (!(await js(`Boolean(document.querySelector('.run-panel'))`))) await click('本场信息');
    await until(`document.querySelector('.run-panel')`, 'panel');
    await click('产物', { selector: '[role=tab]', prefix: true });
    await until(`document.querySelector('.art-panel')`, 'artifacts tab');
  };
  const theme = async value => {
    const task = (await runSnapshot())?.execution?.task;
    await click('设置', { selector: '.sb-item' }); await click('外观'); await click(value === 'dark' ? '深色' : '浅色', { selector: '.choice' });
    check(await js('document.documentElement.dataset.theme') === value, 'Theme ' + value);
    await click(task, { selector: '.sb-runs .sb-item', prefix: true });
    await until(`document.querySelector('.thread-item')`, 'discussion reopened');
  };
  const artifactsOf = async () => (await api('artifact.list', { runId: (await runSnapshot()).runId })).artifacts;
  const safe = async label => check(await js(`window.__pwned === undefined && !document.querySelector('dialog.artifact-reader script, dialog.artifact-reader img')`), label + ': model HTML is shown as text, never run or loaded');

  if (phase === 'first') {
    // Setup (accepted hands-on in R13A–R16): DeepSeek with a fake Key and a confirmed target, a room of three members.
    const provider = await api('settings.createProvider', { name: 'DeepSeek 直连', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] });
    await api('settings.setKey', { providerId: provider.id, apiKey: fakeKey });
    const room = await api('rooms.createRoom', { name: '校园跑腿讨论', objective: '' });
    for (const [index, [name, role]] of [['起草者', '起草'], ['审查者', '审查'], ['综合者', '综合']].entries())
      await api('rooms.createAgent', { roomId: room.id, displayName: name, roleTemplateId: role, systemPrompt: '', providerId: provider.id, modelId: 'deepseek-flash', enabled: true, displayOrder: index });
    await js('location.reload(); true'); await until(`document.querySelector('.sidebar')`, 'reloaded'); await ui.ensureLocator();

    // ── 1. A finished discussion ────────────────────────────────────────────
    await click('校园跑腿讨论', { selector: '.sb-item' }); await click('新讨论', { scope: '.room-page' });
    await has('这场讨论要解决什么？');
    await field('讨论目标'); await selectAll(); await ime('shidian', '为学校设计一个校园跑腿平台的试点方案：说清范围、定价和夜间安排。');
    await click('开始讨论');
    await statusHas('已完成', 60000);
    check((await runSnapshot()).turns.length === 3 && fixture.requests.length === 3, 'Three Turns, three requests');

    // ── 2. 本场信息 › 产物 ────────────────────────────────────────────────────
    await panelOpen();
    const panel = await js(`document.querySelector('.art-panel').innerText`);
    for (const piece of ['整理成…', '需求文档（PRD）', '会议纪要', '行动清单', '代码候选', '点一下就生成', '每次生成发送 1 次请求', '文件路径和代码，不会执行；可以逐个文件确认，写入你选的文件夹'])
      check(panel.includes(piece), 'Panel says: ' + piece);
    check(!panel.includes('即将推出') && !/R1[45]/u.test(panel), 'No placeholder or development terms');
    await capture('panel-light', '讨论结束后打开“本场信息 › 产物”：四类产物各一行，写明它是什么；顶部说明点一下就生成、每次发送 1 次请求，默认由综合类角色来写。“代码候选”写明不会执行、采用后可以逐个文件确认写入主持人选的文件夹。', '.art-panel');

    // ── 3. PRD: 换人… shows who writes and on what; a valid version is usable at once ─
    const sent = fixture.requests.length;
    await click('换人…', { scope: '.artifact', which: 0 });
    await until(`document.querySelector('dialog[open] .summary-send')`, 'generate dialog');
    const dialogText = await js(`document.querySelector('dialog[open]').innerText`);
    check(dialogText.includes('根据这场讨论的第 1–3 条发言整理一份需求文档（PRD）') && dialogText.includes('综合者（deepseek-flash）'), 'Dialog: basis range and the synthesizer by default');
    check(dialogText.includes('费用由服务商收取') && !/¥|预计/u.test(dialogText) && dialogText.includes('不会自动重试'), 'Dialog: who bills, no estimate, no automatic retry');
    check(fixture.requests.length === sent, 'Opening the dialog sent nothing');
    await capture('prd-dialog', '点“需求文档（PRD）”旁的“换人…”：对话框写明依据第 1–3 条发言、默认由综合者来写，可以换人；说明费用由服务商收取、不会自动重试。', 'dialog[open]');
    fixture.mode = 'hang';
    await click('生成（发送 1 次请求）');
    await until(`document.querySelector('dialog.artifact-reader')`, 'reader opens');
    await readerHas('正在生成：已收到');
    // The first text is on disk at once, so the reader shows real progress, not 0.
    await until(`/已收到 [1-9]/u.test(document.querySelector('dialog.artifact-reader')?.innerText ?? '') && document.querySelector('dialog.artifact-reader .art-raw')?.innerText.includes('校园跑腿')`, 'progress shown');
    await capture('prd-generating', '发送后对话框原地换成产物阅读器：第 1 版“生成中”，写着已收到多少字符（第一段输出一到就落盘，之后每 2 KB 或每秒一次），原始输出里能看到已经收到的部分；完成后自动检查格式；底部是“中止生成”。', 'dialog.artifact-reader');
    fixture.mode = 'ok'; fixture.release();
    await readerHas('已通过格式检查', 30000);
    check(fixture.requests.length === sent + 1 && fixture.requests.at(-1).maxTokens === 8192, 'Exactly one request, output limit 8192');
    check(!JSON.stringify(fixture.requests.at(-1)).includes('response_format'), 'No provider JSON mode is requested');
    await safe('PRD');
    const prdText = await reader();
    for (const piece of ['校园跑腿试点 PRD', 'R1', '下单与接单', '必须', '验收标准', '第 1 条', '<script>window.__pwned = 1</script>', '复制 Markdown'])
      check(prdText.includes(piece), 'PRD shows: ' + piece);
    await capture('prd-candidate', '完成后直接可用：结构化显示标题、背景、目标、每条需求（编号、优先级、说明、验收标准清单、来源发言按钮）。模型写在背景里的 <script> 和需求里的 <img onerror> 原样显示为文字，没有执行或加载。底部主按钮“采用这一版”；采用前没有复制和导出。', 'dialog.artifact-reader');
    await click('复制 Markdown');
    await readerHas('已复制为 Markdown。');
    const markdown = clipboard.readText();
    check(markdown.startsWith('# 校园跑腿试点 PRD') && markdown.includes('### R1 下单与接单（必须）') && markdown.includes('（来源：第 1 条发言）') && markdown.includes('依据讨论第 1–3 条发言'), 'Markdown on the clipboard');
    check(!markdown.includes('只输出一个 JSON 对象') && !markdown.includes('【第 1 条') && !markdown.includes(fakeKey), 'Nothing from the request leaves with the export');
    await capture('prd-adopted', '格式检查通过就有“复制 Markdown”“复制 JSON”“另存为…”。点“复制 Markdown”后提示“已复制为 Markdown。”，剪贴板里是整理好的 Markdown（含来源和依据范围）。', 'dialog.artifact-reader');

    // A cited message goes back to its place in the timeline.
    await click('第 2 条', { selector: 'button.art-source' });
    await until(`!document.querySelector('dialog.artifact-reader') && document.querySelector('.thread-item.is-revealed')`, 'revealed message');
    check(await js(`document.querySelector('.thread-item.is-revealed').innerText.includes('两处问题')`), 'The revealed item is message 2');
    await capture('source-revealed', '在需求里点来源“第 2 条”：阅读器关闭，时间线滚到第 2 条（审查者）并短暂高亮，停止跟随最新消息。', '.thread-item.is-revealed');

    // ── 4. Minutes: invalid JSON kept with field-located errors, fixed by hand ─
    await panelOpen();
    const beforeMinutes = fixture.requests.length;
    await click('生成', { scope: '.artifact', which: 0 });
    await readerHas('格式检查没有通过', 30000);
    check(fixture.requests.length === beforeMinutes + 1, 'One click, one request');
    const invalidText = await reader();
    check(invalidText.includes('参与者') && invalidText.includes('应该是列表') && invalidText.includes('决策 第 1 项 › 决定人') && invalidText.includes('缺少这个字段'), 'Errors name the fields');
    check(invalidText.includes('格式检查没有通过：3 处问题') && invalidText.includes('第 7 条不在这次依据的发言里（第 1–3 条）'), 'The out-of-range source is listed with the schema errors, all at once');
    check(await js(`document.querySelectorAll('dialog.artifact-reader .art-issues li').length === 3`), 'Exactly three problems, none repeated');
    check(await js(`document.querySelectorAll('dialog.artifact-reader .art-raw > span.is-bad').length >= 3`), 'The raw output marks the lines');
    check(await js(`document.querySelector('dialog.artifact-reader .art-raw').innerText.includes('\`\`\`json')`), 'The raw output is kept exactly, fence included');
    const afterInvalid = fixture.requests.length;
    await sleep(1500);
    check(fixture.requests.length === afterInvalid, 'No automatic retry after an invalid output');
    await capture('minutes-invalid', '会议纪要的夹具故意返回不合格的 JSON：状态“校验失败”，写明有几处问题、原始输出完整保留、没有自动重试。三处问题一次列全，每条写明字段和行号：“参与者：应该是列表”“决策 第 1 项 › 决定人：缺少这个字段（不知道就写 null，不能省略）”，以及结论第 2 项引用了不存在的“第 7 条”（这次依据第 1–3 条）——来源编号和格式错误同时检查，不用改完前两处才发现第三处。原始输出带行号并把出错的行标红。主按钮“修改为有效版本…”。等待 1.5 秒确认没有自动重发。', 'dialog.artifact-reader');
    await click('修改为有效版本…');
    await until(`document.querySelector('.art-json')`, 'editor');
    await field('产物 JSON'); await selectAll();
    const halfFixed = invalidMinutes.replace('"participants": "起草者、审查者、综合者"', '"participants": ["起草者", "审查者", "综合者", "主持人"]').replace('"rationale": "目标还没有依据"', '"rationale": "目标还没有依据",\n      "decidedBy": null');
    await type(halfFixed);
    await until(`document.querySelector('.art-check')?.innerText.includes('还有 1 处问题')`, 'one issue left');
    check((await reader()).includes('第 7 条不在这次依据的发言里（第 1–3 条）'), 'The cited number must exist');
    await capture('minutes-editing', '点“修改为有效版本…”：在带实时校验的 JSON 编辑框里修改。改好“参与者”（写成列表）和“决定人”（讨论没说，写 null 表示未知）后，实时校验显示只剩一开始就列出的那 1 处：结论第 2 项引用了不存在的“第 7 条”（这次依据第 1–3 条）。每处问题前的“第 N 行”可以点，光标直接跳到那一行。“保存为新版本”在校验通过前不可用。', 'dialog.artifact-reader');
    await click('第', { selector: '.art-issues button', prefix: true });
    check(await js(`document.activeElement === document.querySelector('.art-json') && document.activeElement.selectionEnd > document.activeElement.selectionStart`), 'Clicking the line number selects that line');
    await selectAll(); await type(halfFixed.replace('"sources": [\n        7\n      ]', '"sources": [\n        3\n      ]'));
    await until(`document.querySelector('.art-check')?.innerText.includes('格式正确，可以保存')`, 'valid edit');
    await click('保存为新版本');
    await readerHas('你修改的版本，已通过格式检查');
    const minutes = (await artifactsOf()).find(item => item.kind === 'minutes');
    check(minutes.versions.map(version => `${version.number}:${version.origin}:${version.status}`).join() === '1:generate:invalid,2:edit:valid', 'Version 1 kept invalid, version 2 the host edit');
    check(fixture.requests.length === afterInvalid, 'Fixing by hand sent nothing');
    const minutesText = await reader();
    check(minutesText.includes('决定人') && minutesText.includes('未知'), 'Unknown shown as 未知');
    await capture('minutes-fixed', '保存后成为第 2 版“你修改的版本”，直接有效；决策的“决定人”显示为“未知”。版本下拉里第 1 版仍是“校验失败”，原始输出可随时查看。整个修改没有发出请求。', 'dialog.artifact-reader');
    await key('Escape');

    // ── 5. Action list with unknown owners and dates; code candidate preview ──
    await panelOpen();
    await click('生成', { scope: '.artifact', which: 0 });
    await readerHas('已通过格式检查', 30000);
    const actionsText = await reader();
    check(actionsText.includes('2 项没有明确负责人，标为“未知”') && actionsText.includes('第 2 周前') && actionsText.includes('受阻'), 'Unknown owners stay unknown; dates as said');
    await capture('actions-candidate', '行动清单：事项、负责人、截止时间、状态、来源。讨论里没指派的负责人和没说的截止时间显示为“未知”，顶部提示“2 项没有明确负责人”；截止时间照抄讨论原话“第 2 周前”，没有换算成日期。', 'dialog.artifact-reader');
    // D125: a request that ends without a result says why, what it cost and what to do; nothing is retried.
    fixture.mode = 'hang';
    await click('重新生成', { scope: 'dialog.artifact-reader .modal-foot' });
    await readerHas('正在生成：已收到', 30000);
    await click('中止生成');
    await readerHas('这次请求已中止。', 30000);
    fixture.mode = 'ok'; fixture.release();
    const stoppedText = await reader();
    check(stoppedText.includes('请求可能已经发出，服务商可能已经计入用量。') && stoppedText.includes('没有自动重试，可以重新生成。'), 'A stopped request says why, its cost and the next step');
    check(await js(`[...document.querySelectorAll('dialog.artifact-reader .modal-foot button')].find(e => e.textContent.includes('重新生成'))?.className.includes('primary')`), 'Regenerate is the next step');
    const stopped = (await artifactsOf()).find(item => item.kind === 'actions').versions.at(-1);
    check(stopped.status === 'failed' && stopped.request.status === 'aborted' && stopped.request.errorCode === 'cancelled', 'The public code is recorded: cancelled');
    const afterStop = fixture.requests.length;
    await sleep(1500);
    check(fixture.requests.length === afterStop, 'Nothing is retried after a stop');
    await capture('actions-stopped', '在行动清单里点“重新生成”，生成到一半点“中止生成”：第 2 版写明“这次请求已中止。请求可能已经发出，服务商可能已经计入用量。”没有自动重试；“重新生成”成为主按钮，部分输出保留。', 'dialog.artifact-reader');
    await key('Escape');
    await panelOpen();
    await click('换人…', { scope: '.artifact', which: 0 });
    await until(`document.querySelector('dialog[open] .summary-send')`, 'code dialog');
    const codeDialog = await js(`document.querySelector('dialog[open]').innerText`);
    check(codeDialog.includes('讨论里没有涉及代码时，模型会如实说明“没有可整理的内容”，不会硬凑代码；这次请求仍会计入服务商的用量。'), 'The dialog says an honest nothing still costs a request');
    await click('生成（发送 1 次请求）');
    await readerHas('没有可整理的内容', 30000);
    const emptyText = await reader();
    check(emptyText.includes('这不是模型出错') && emptyText.includes('讨论记录中没有出现任何代码设计或实现要求') && !emptyText.includes('校验失败'), 'Nothing of this kind is its own state, with the reason');
    check(!(await ui.find('复制 JSON')), 'Nothing to export');
    await capture('code-empty', '这场讨论没有涉及代码：模型按约定只回了 {"nothing": 原因}。阅读器显示“没有可整理的内容”（中性灰，不是红色的校验失败），写明这不是模型出错、这一版不能导出，并原样给出模型的说明；底部是“重新生成…”（主按钮）和“自己写一版…”，没有采用和导出。', 'dialog.artifact-reader');
    await click('重新生成', { scope: 'dialog.artifact-reader .modal-foot' });
    await readerHas('第 2 版', 30000); await readerHas('已通过格式检查', 30000);
    const codeText = await reader();
    check(codeText.includes('“写入文件夹…”会先逐个文件列出新建、覆盖和差异，只写你勾选的文件；不会运行任何代码。') && codeText.includes('src/pilot/fee.ts') && codeText.includes('riderIncome'), 'Code preview with path and code');
    await capture('code-candidate', '代码候选：写明“写入文件夹…”会先逐个文件列出差异、不会运行任何代码；每个文件显示相对路径、语言和行数，代码用净化后的代码块显示（可复制）。', 'dialog.artifact-reader');
    const codeAdopted = await reader();
    check(!codeAdopted.includes('另存为…') && codeAdopted.includes('写入文件夹…') && codeAdopted.includes('“写入文件夹…”会先逐个文件列出新建、覆盖和差异'), 'No plain file save for code; R15 writing is offered and explained');
    const candidates = await api('artifact.listCodeCandidates', { runId: (await runSnapshot()).runId });
    check(candidates.candidates.length === 1 && candidates.candidates[0].files[0].path === 'src/pilot/fee.ts' && candidates.candidates[0].status === 'valid', 'R15 sees the valid code version');
    check(fs.readdirSync(exportsDir).length === 0 && !fs.existsSync(join(probe.directory, 'src')), 'Nothing written to disk for code');
    await capture('code-adopted', '代码候选可以“复制 Markdown / JSON”；没有“另存为…”，取而代之的是红色的“写入文件夹…”（R15）。', 'dialog.artifact-reader');
    await key('Escape');

    // ── 6. A source message edited → affected → regenerate ──────────────────
    await click('修改', { slot: 0 });
    await field('修改消息内容'); await selectAll(); await ime('fanwei', '### 试点方案（主持人修改）\n\n1. 范围：2 栋宿舍楼，试点 2 周。\n2. 定价：基础费 2 元/单，平台抽成 8%。');
    await key('Enter');
    await until(`document.body.innerText.includes('版本 2/2')`, 'edited');
    await panelOpen();
    await until(`document.querySelectorAll('.art-panel .tag.is-warn').length >= 3`, 'affected tags');
    await capture('panel-affected', '主持人修改第 1 条发言后，产物标签页里依据了第 1 条的需求文档、行动清单、代码候选都标“受影响”（会议纪要是主持人自己改的版本，按修改时的原文记录依据，同样受影响）。', '.art-panel');
    await click('打开需求文档（PRD）', { prefix: true });
    await readerHas('受影响：');
    check((await reader()).includes('依据的第 1 条发言在这一版写成后被修改或重新生成'), 'The note names the message');
    await capture('prd-affected', '打开需求文档：顶部提示“受影响：依据的第 1 条发言在这一版写成后被修改或重新生成，内容可能已经过时”，旁边就是“重新生成”。', 'dialog.artifact-reader');
    await click('换人…', { scope: 'dialog.artifact-reader .modal-foot' });
    await until(`[...document.querySelectorAll('dialog[open] h2')].some(e => e.textContent === '重新生成需求文档（PRD）')`, 'regenerate dialog');
    check((await js(`[...document.querySelectorAll('dialog[open]')].at(-1).innerText`)).includes('会作为新的一版保存，之前的版本都保留'), 'Regenerating keeps earlier versions');
    await capture('prd-regenerate-dialog', '“换人…”打开“重新生成需求文档（PRD）”：沿用上次的成员（综合者），说明会作为新的一版、之前的版本都保留。', 'dialog[open]:last-of-type');
    await click('取消', { which: 'last' });
    await until(`document.querySelectorAll('dialog[open]').length === 1`, 'back to the reader');
    const beforeRegen = fixture.requests.length;
    await click('重新生成', { scope: 'dialog.artifact-reader .note' });
    await readerHas('第 2 版', 30000); await readerHas('已通过格式检查', 30000);
    check(fixture.requests.length === beforeRegen + 1 && JSON.stringify(fixture.requests.at(-1).messages).includes('试点方案（主持人修改）'), 'One request, based on the edited message');
    check(!(await reader()).includes('受影响：'), 'The new version is not affected');
    await capture('prd-regenerated', '重新生成得到第 2 版（依据修改后的第 1 条，范围改成 2 栋），不再受影响。版本下拉里第 1 版仍保留并标“受影响”。', 'dialog.artifact-reader');

    // ── 7. Save as a file through Main's dialog ─────────────────────────────
    await click('另存为…');
    await click('Markdown 文件（.md）');
    await readerHas('已保存为“校园跑腿试点 PRD.md”。');
    const saved = fs.readFileSync(join(exportsDir, '校园跑腿试点 PRD.md'), 'utf8');
    check(saved.includes('2 栋宿舍楼') && saved.includes('第 2 版') && !saved.includes(fakeKey), 'The saved file is version 2');
    check(result.saveDialogs.length === 1 && result.saveDialogs[0].title === '导出产物' && result.saveDialogs[0].filters[0].extensions[0] === 'md', 'Main asked where to save');
    await capture('prd-saved', '“另存为… › Markdown 文件（.md）”由 Main 弹出系统保存对话框，只写入主持人选的文件（探针选了自己的临时目录），提示“已保存为‘校园跑腿试点 PRD.md’”；状态变成“有效 · 已导出”。', 'dialog.artifact-reader');

    // ── 8. Dark theme, 800 wide ──────────────────────────────────────────
    await key('Escape');
    await theme('dark'); await resize(800, 600);
    await click('本场信息'); await until(`document.querySelector('.drawer.is-right')`, 'drawer');
    await click('产物', { selector: '[role=tab]', prefix: true });
    await noOverflow('panel 800 dark');
    await capture('panel-800-dark', '800×600 深色：本场信息变成右侧抽屉，产物列表的状态（有效 · 已导出、你修改的版本、受影响）清楚可读，无横向滚动。', '.art-panel');
    await click('打开会议纪要', { prefix: true });
    await until(`document.querySelector('dialog.artifact-reader')`, 'reader 800');
    await noOverflow('reader 800 dark');
    await capture('minutes-800-dark', '800×600 深色：阅读器占满窗口留边，长内容在中间滚动，头部（版本、状态）和底部按钮固定；“未知”标记在深色下仍清楚。', 'dialog.artifact-reader');
    // A native select popup cannot be driven through the page; the probe sets the value as a choice would.
    await js(`(() => { const s = document.querySelector('dialog.artifact-reader select[aria-label="版本"]'); s.focus(); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, [...s.options].find(o => o.text.startsWith('第 1 版')).value); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await readerHas('格式检查没有通过');
    await capture('minutes-v1-800-dark', '在版本下拉里切回第 1 版：原样的不合格输出、逐项错误和标红的行都还在（深色）。', 'dialog.artifact-reader');
    await key('Escape');
    await resize(1280, 800);
    await click('用量', { selector: '.sb-item', prefix: true });
    await until(`document.querySelector('.usage-page')`, 'usage page');
    await field('时间范围'); await js(`(() => { const e = document.querySelector('[aria-label="时间范围"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, 'all'); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await click('按用途', { selector: '[role=tab]' });
    await until(`document.querySelector('.usage-page')?.innerText.includes('产物（文档、清单、代码候选）')`, 'usage by purpose');
    await capture('usage-by-purpose-dark', '用量页新增“按用途”：讨论发言、产物（文档、清单、代码候选）分开汇总请求数、用量和金额；导出的 CSV 里产物请求的类型写“产物”。');
    await theme('light');
    await finish();
    console.log('R14_RESTART_PROFILE ' + probe.directory);
    return;
  }

  // ── Restart: everything is as it was, and nothing is sent ─────────────────
  const before = fixture.requests.length;
  const task = '为学校设计一个校园跑腿平台的试点方案';
  await click(task, { selector: '.sb-runs .sb-item', prefix: true });
  await until(`document.querySelector('.thread-item')`, 'discussion reopened');
  await panelOpen();
  const list = await artifactsOf();
  const states = list.map(item => `${item.kind}:${item.versions.map(version => `${version.number}${version.origin[0]}-${version.status}`).join('/')}`).join(' ');
  check(states === 'prd:1g-exported/2r-exported minutes:1g-invalid/2e-valid actions:1g-valid/2r-failed code:1g-empty/2r-valid', 'Artifacts, versions and states after restart: ' + states);
  check(list.find(item => item.kind === 'actions').versions[1].request.errorCode === 'cancelled', 'The recorded error code survives the restart');
  check(list.find(item => item.kind === 'prd').versions[0].affectedNumbers.join() === '1', 'The affected mark survives');
  await capture('restart-panel', '重启应用后重新打开这场讨论：四份产物、各自的版本和状态（有效 · 已导出、你修改的版本、受影响）都在。', '.art-panel');
  await click('打开会议纪要', { prefix: true });
  await readerHas('你修改的版本');
  await capture('restart-minutes', '重启后打开会议纪要：第 2 版（你修改的）有效，版本下拉里第 1 版仍是校验失败、原始输出完整。', 'dialog.artifact-reader');
  await key('Escape');
  await sleep(1500);
  check(fixture.requests.length === before && before === 0, 'Nothing was sent after the restart');
  const Sqlite = require('better-sqlite3');
  const db = new Sqlite(join(probe.paths.userData, 'ai-roundtable.db'), { readonly: true });
  try {
    check(db.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get() === 15, 'Migration 15');
    check(db.prepare('SELECT COUNT(*) FROM artifact_versions').pluck().get() === 8 && db.prepare('SELECT COUNT(*) FROM artifact_requests').pluck().get() === 7
      && db.prepare("SELECT COUNT(*) FROM request_usage WHERE kind='artifact' AND state='reported'").pluck().get() === 6 && db.prepare("SELECT COUNT(*) FROM request_usage WHERE kind='artifact' AND state='unknown'").pluck().get() === 1,
      'Eight versions; six artifact requests with usage and the stopped one unknown');
    check(db.prepare("SELECT error_code FROM artifact_requests WHERE status='aborted'").pluck().all().join() === 'cancelled', 'Only the public code is stored');
    check(db.prepare("SELECT empty_reason FROM artifact_versions WHERE validation='empty'").pluck().all().join() === '讨论记录中没有出现任何代码设计或实现要求，没有可整理的代码候选。', 'The empty answer and its reason are stored');
    check(db.prepare("SELECT COUNT(*) FROM artifact_exports WHERE target='file'").pluck().get() === 1, 'One file export');
  } finally { db.close(); }
  await finish();
}

main().catch(probe.fail);
