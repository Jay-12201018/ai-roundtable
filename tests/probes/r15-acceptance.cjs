// R15 hands-on acceptance: writing a valid code version into a folder, through the production build with real
// mouse, keyboard and IME input. Isolation, network blocking and the DeepSeek loopback fixture come from r16-harness.cjs.
// The folder the host "picks" in Main's dialog is a directory inside this probe's own temporary profile; a sentinel
// folder next to it (and a link into it) proves nothing outside the chosen folder changes. Two launches of one profile:
//   electron tests/probes/r15-acceptance.cjs                   generate → preview → partial write → external edit refused → link refused
//   electron tests/probes/r15-acceptance.cjs --restart <dir>   the write records are intact; the folder must be chosen again
// Screenshots go to docs/verification/r15-screens/ (01–39 first launch, 40–49 restart).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { join, relative, resolve } = require('node:path');
const { dialog } = require('electron');
const { createProbe } = require('./r16-harness.cjs');

const args = process.argv.slice(2).filter(arg => !arg.startsWith('--inspect'));
const phase = args[0] === '--restart' ? 'restart' : 'first';
assert.ok(phase === 'first' ? args.length === 0 : args.length === 2, 'Usage: electron r15-acceptance.cjs [--restart <profile directory>]');
const probe = createProbe({ prefix: 'roundtable-r15', name: 'R15', timeoutMs: 900000, phase, reuse: phase === 'first' ? undefined : args[1] });
const { fixture, check, sleep, result } = probe;
const screens = resolve(probe.root, 'docs/verification/r15-screens');
const fakeKey = 'r15-fake-deepseek-key';

// The folders: the one the host picks, and one outside it that must never change.
const workspace = join(probe.directory, 'workspace');
const project = join(workspace, 'pilot');
const outside = join(workspace, 'outside');
// Main's folder dialog: the probe answers from a queue (a cancel first) and records what it was asked.
result.openDialogs = [];
const answers = [];
dialog.showOpenDialog = async (_window, options) => {
  result.openDialogs.push({ title: options.title, buttonLabel: options.buttonLabel, properties: options.properties });
  return answers.shift() ?? { canceled: true, filePaths: [] };
};
const tree = dir => fs.readdirSync(dir).sort().flatMap(name => {
  const path = join(dir, name); const info = fs.lstatSync(path);
  const entry = `${relative(workspace, path)} ${info.isSymbolicLink() ? `-> ${fs.readlinkSync(path)}` : info.isDirectory() ? 'dir' : `${info.size} ${info.mtimeMs} ${createHash('sha256').update(fs.readFileSync(path)).digest('hex').slice(0, 16)}`}`;
  return info.isDirectory() && !info.isSymbolicLink() ? [entry, ...tree(path)] : [entry];
});

const replies = {
  起草者: '### 试点方案（初稿）\n\n1. 范围：3 栋宿舍楼，试点 4 周。\n2. 定价：基础费 2 元/单，平台抽成 15%。\n3. 夜间：22 点后暂停接单。',
  审查者: '抽成 15% 偏高，骑手留不住；建议 8%。夜间规则要写进代码，配置放在 config/settings.json。',
  综合者: '综合：抽成改为 8%，22 点后暂停接单；费用和夜间规则各一个文件，配置单独放。',
};
const json = value => JSON.stringify(value, null, 2);
const feeNew = "export const BASE_FEE = 2;\nexport const COMMISSION = 0.08;\n\n/** 骑手实收：基础费扣掉平台抽成。 */\nexport function riderIncome(fee = BASE_FEE): number {\n  return Math.round(fee * (1 - COMMISSION) * 100) / 100;\n}\n";
const feeOld = "export const BASE_FEE = 2;\nexport const COMMISSION = 0.15;\n\n/** 骑手实收：基础费扣掉平台抽成。 */\nexport function riderIncome(fee = BASE_FEE): number {\n  return Math.round(fee * (1 - COMMISSION) * 100) / 100;\n}\n";
const night = "#!/bin/sh\n# 这段只是文本：写入后不会被执行\ntouch \"$(dirname \"$0\")/PWNED\"\nexport const canOrder = (hour: number) => hour < 22;\n";
const settingsNew = json({ commission: 0.08, nightCutoff: 22, buildings: 3 }) + '\n';
const settingsOld = json({ commission: 0.15, nightCutoff: 23, buildings: 3 }) + '\n';
const readme = '# 校园跑腿试点\n\n费用和夜间规则见 src/pilot。\n';
const code = json({ title: '试点费用与夜间规则', summary: '按 8% 抽成计算骑手收入；22 点后暂停接单；配置单独放。', files: [
  { path: 'src/pilot/fee.ts', language: 'typescript', description: '费用', content: feeNew },
  { path: 'src/pilot/rules/night.ts', language: 'typescript', description: '夜间规则', content: night },
  { path: 'config/settings.json', language: 'json', description: '试点配置', content: settingsNew },
  { path: 'docs/试点说明.md', language: 'markdown', description: '说明', content: '# 试点说明\n\n- 抽成 8%\n- 22 点后暂停接单\n' },
  { path: 'README.md', language: 'markdown', description: null, content: readme },
  { path: 'aux.ts', language: 'typescript', description: '辅助函数', content: 'export {};\n' },
  { path: 'shared/config.ts', language: 'typescript', description: '共享配置', content: 'export const leaked = true;\n' },
], notes: ['节假日规则还没定'] });
const artifactKind = body => /整理「([^」]+)」。只输出 JSON 对象。$/u.exec(body.messages.at(-1).content)?.[1];
fixture.reply = body => artifactKind(body) === '代码候选' ? code : replies[/现在由你（成员「([^」]+)」/u.exec(body.messages.at(-1).content)?.[1]] ?? '好的，补充一点。';

async function main() {
  const ui = await probe.start({ screens, width: 1280, height: 800, keepScreens: phase !== 'first', firstShot: phase === 'first' ? 0 : 39 });
  const { js, until, click, field, key, selectAll, ime, capture, resize, api, runSnapshot, finish } = ui;
  const has = (value, timeout) => until(`document.body.innerText.includes(${JSON.stringify(value)})`, value, timeout);
  const statusHas = (value, timeout) => until(`(document.querySelector('[role=status][aria-label="运行状态"]')?.textContent ?? '').includes(${JSON.stringify(value)})`, 'status ' + value, timeout);
  const noOverflow = async label => check(await js('document.documentElement.scrollWidth <= window.innerWidth'), `${label}: no horizontal page scroll`);
  const readerHas = (value, timeout) => until(`(document.querySelector('dialog.artifact-reader')?.innerText ?? '').includes(${JSON.stringify(value)})`, 'reader ' + value, timeout);
  const exportText = () => js(`document.querySelector('dialog.code-export')?.innerText ?? ''`);
  const exportHas = (value, timeout) => until(`(document.querySelector('dialog.code-export')?.innerText ?? '').includes(${JSON.stringify(value)})`, 'export dialog ' + value, timeout);
  const rowText = path => js(`[...document.querySelectorAll('dialog.code-export .cx-file')].find(e => e.querySelector('.cx-path')?.textContent === ${JSON.stringify(path)})?.innerText ?? ''`);
  const read = path => fs.readFileSync(join(project, path), 'utf8');
  const panelOpen = async () => {
    if (!(await js(`Boolean(document.querySelector('.run-panel'))`))) await click('本场信息');
    await until(`document.querySelector('.run-panel')`, 'panel');
    await click('产物', { selector: '[role=tab]', prefix: true });
    await until(`document.querySelector('.art-panel')`, 'artifacts tab');
  };
  const task = '为学校设计一个校园跑腿平台的试点方案';
  const theme = async value => {
    await click('设置', { selector: '.sb-item' }); await click('外观'); await click(value === 'dark' ? '深色' : '浅色', { selector: '.choice' });
    check(await js('document.documentElement.dataset.theme') === value, 'Theme ' + value);
    await click(task, { selector: '.sb-runs .sb-item', prefix: true });
    await until(`document.querySelector('.thread-item')`, 'discussion reopened');
  };
  const openCode = async () => { await panelOpen(); await click('打开代码候选', { prefix: true }); await until(`document.querySelector('dialog.artifact-reader')`, 'reader'); await readerHas('src/pilot/fee.ts'); };
  const openExport = async () => { await click('写入文件夹…', { scope: 'dialog.artifact-reader' }); await until(`document.querySelector('dialog.code-export')`, 'export dialog'); };
  const recordsOf = async () => (await api('artifact.list', { runId: (await runSnapshot()).runId })).artifacts.find(item => item.kind === 'code').versions.at(-1).codeWrites ?? [];

  if (phase === 'first') {
    // The folder to write into, with an existing project, and a sentinel folder next to it reached by a link inside.
    fs.mkdirSync(join(project, 'src/pilot'), { recursive: true }); fs.mkdirSync(join(project, 'config')); fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(join(project, 'src/pilot/fee.ts'), feeOld); fs.writeFileSync(join(project, 'config/settings.json'), settingsOld); fs.writeFileSync(join(project, 'README.md'), readme);
    fs.writeFileSync(join(outside, 'config.ts'), 'export const leaked = false;\n'); fs.writeFileSync(join(outside, 'secret.txt'), '根外的哨兵文件\n');
    fs.symlinkSync('../outside', join(project, 'shared'));
    fs.mkdirSync(join(project, '.git/hooks'), { recursive: true });
    const outsideBefore = tree(outside);

    // Setup (accepted hands-on in R13A–R16): DeepSeek with a fake Key and a confirmed target, a room of three members.
    const provider = await api('settings.createProvider', { name: 'DeepSeek 直连', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] });
    await api('settings.setKey', { providerId: provider.id, apiKey: fakeKey });
    const room = await api('rooms.createRoom', { name: '校园跑腿讨论', objective: '' });
    for (const [index, [name, role]] of [['起草者', '起草'], ['审查者', '审查'], ['综合者', '综合']].entries())
      await api('rooms.createAgent', { roomId: room.id, displayName: name, roleTemplateId: role, systemPrompt: '', providerId: provider.id, modelId: 'deepseek-flash', enabled: true, displayOrder: index });
    await js('location.reload(); true'); await until(`document.querySelector('.sidebar')`, 'reloaded'); await ui.ensureLocator();

    // ── 1. A finished discussion and a valid code version ───────────────────
    await click('校园跑腿讨论', { selector: '.sb-item' }); await click('新讨论', { scope: '.room-page' });
    await has('这场讨论要解决什么？');
    await field('讨论目标'); await selectAll(); await ime('shidian', '为学校设计一个校园跑腿平台的试点方案：说清定价和夜间规则，并写出代码。');
    await click('开始讨论');
    await statusHas('已完成', 60000);
    await panelOpen();
    check((await js(`document.querySelector('.art-panel').innerText`)).includes('可以逐个文件确认，写入你选的文件夹'), 'The panel says code can be written, file by file');
    await click('生成', { scope: '.artifact', which: 3 });
    await readerHas('已通过格式检查', 30000);
    const writeButton = await js(`[...document.querySelectorAll('dialog.artifact-reader .modal-foot button')].find(b => b.textContent.includes('写入文件夹…'))?.className ?? ''`);
    check(writeButton.includes('is-danger'), 'The entry is styled as a dangerous action');
    check((await js(`document.querySelector('dialog.artifact-reader').innerText`)).includes('“写入文件夹…”会先逐个文件列出新建、覆盖和差异，只写你勾选的文件；不会运行任何代码。'), 'The reader explains what writing does');
    await capture('reader-adopted', '代码候选通过格式检查后，阅读器底部就有红色描边的“写入文件夹…”（和普通的复制按钮区分开）；正文上方写明会先逐个文件列出新建、覆盖和差异、只写勾选的文件、不会运行任何代码。没采用的候选没有这个按钮。', 'dialog.artifact-reader');

    // ── 2. The dialog; cancelling the folder dialog writes nothing ──────────
    await openExport();
    const intro = await exportText();
    for (const piece of ['把这一版的 7 个文件写进你选的文件夹，只会写在这个文件夹里面。', '新建的文件默认勾选，可以取消；覆盖现有文件要单独勾选。', '不会运行其中任何代码或命令，文件只作为文本写入。'])
      check(intro.includes(piece), 'Intro says: ' + piece);
    await capture('export-intro', '点“写入文件夹…”：先说明三步——选文件夹（只会写在它里面）、逐个文件查看会怎样、只写勾选的文件（覆盖要单独勾选），并写明不会运行任何代码或命令。此时还没有读写任何文件。', 'dialog.code-export');
    answers.push({ canceled: true, filePaths: [] });
    await click('选择文件夹…', { scope: 'dialog.code-export .modal-foot' });
    await until(`!(document.querySelector('dialog.code-export')?.innerText ?? '').includes('请在弹出的窗口里选择文件夹')`, 'cancel handled');
    check(result.openDialogs.length === 1 && result.openDialogs[0].title === '选择要写入的文件夹' && result.openDialogs[0].properties.includes('openDirectory'), 'Main asked for a folder in its own dialog');
    check((await exportText()).includes('选择文件夹…') && !(await exportText()).includes('新建 '), 'Cancelling the folder dialog leaves the intro, nothing previewed');

    answers.push({ canceled: false, filePaths: [join(project, '.git/hooks')] });
    await click('选择文件夹…', { scope: 'dialog.code-export .modal-foot' });
    await exportHas('这个文件夹在 .git 里面：那里的文件可能被 Git 自动执行，不能写入。请另选一个文件夹。');
    check(!(await exportText()).includes('新建 ') && fs.readdirSync(join(project, '.git/hooks')).length === 0, 'A folder inside .git is refused, nothing previewed or written');
    await capture('git-folder-refused', '在系统对话框里选了项目的 .git/hooks：Main 拒绝这个文件夹，对话框原地写明原因（那里的文件可能被 Git 自动执行），可以另选。', 'dialog.code-export');

    // ── 3. Preview: create, overwrite with diff, same, invalid, link refused ─
    const before = tree(workspace);
    answers.push({ canceled: false, filePaths: [project] });
    await click('选择文件夹…', { scope: 'dialog.code-export .modal-foot' });
    await exportHas('没有勾选的文件不会写入，现在还什么都没写。');
    const summary = await js(`document.querySelector('dialog.code-export .cx-summary').textContent`);
    check(summary.startsWith('新建 2 · 覆盖 2 · 内容相同 1 · 不能写入 2'), 'Summary: ' + summary);
    check((await rowText('src/pilot/rules/night.ts')).includes('会新建文件夹 src/pilot/rules'), 'A new file says which folders it creates');
    check((await rowText('README.md')).includes('和现有文件完全一样，不需要写入'), 'Same content needs no write');
    check((await rowText('aux.ts')).includes('系统保留的名字'), 'A reserved name is refused');
    check((await rowText('shared/config.ts')).includes('路径上有一段是符号链接，可能指向所选文件夹以外'), 'A link inside the folder is refused');
    check(await js(`document.querySelectorAll('dialog.code-export input[type=checkbox]').length`) === 4 && await js(`document.querySelectorAll('dialog.code-export input[type=checkbox]:checked').length`) === 2,
      'Four files can be ticked; the two new ones start ticked, the two overwrites do not (D141)');
    await click('新建 src/pilot/rules/night.ts', { selector: 'input[type=checkbox]' }); await click('新建 docs/试点说明.md', { selector: 'input[type=checkbox]' });
    check(await js(`[...document.querySelectorAll('dialog.code-export .modal-foot button')].at(-1).disabled`), 'Writing is unavailable when nothing is ticked');
    await click('新建 src/pilot/rules/night.ts', { selector: 'input[type=checkbox]' }); await click('新建 docs/试点说明.md', { selector: 'input[type=checkbox]' });
    check(JSON.stringify(tree(workspace)) === JSON.stringify(before), 'The preview changed nothing on disk');
    await capture('preview-top', '选好文件夹后，Main 只读检查每个文件：顶部是所选文件夹和“换一个文件夹… / 重新检查”；汇总“新建 2 · 覆盖 2 · 内容相同 1 · 不能写入 2”，并写明没勾选的不会写、现在什么都没写。所有可写的文件默认都不勾选，底部“写入文件”不可用并提示先勾选。', 'dialog.code-export');
    const feeDiff = await rowText('src/pilot/fee.ts');
    check(feeDiff.includes('export const COMMISSION = 0.15;') && feeDiff.includes('export const COMMISSION = 0.08;') && feeDiff.includes('+1 −1 行'), 'The overwrite shows its diff');
    await capture('preview-diff', '“覆盖”的文件默认展开差异：红底是现有文件里会被替换的行，绿底是新内容，左边是现有和新的行号；勾选框是红色的“覆盖”，和“写入”区分开。', '.cx-file.is-overwrite');
    await capture('preview-refused', '列表下方：README.md 内容相同、不需要写入；aux.ts 用了 Windows 保留名，路径无效；shared/config.ts 的 shared 是指向所选文件夹以外的符号链接，不能写入。这三行都没有勾选框。', '.cx-file.is-conflict');

    // ── 4. Tick a part, write, check the disk ───────────────────────────────
    // D141: new files start ticked, overwrites do not. Keep only night.ts of the new files.
    check(await js(`[...document.querySelectorAll('dialog.code-export .modal-foot button')].at(-1).textContent`) === '写入 2 个文件', 'Both new files start ticked');
    await click('新建 docs/试点说明.md', { selector: 'input[type=checkbox]' });
    check(await js(`[...document.querySelectorAll('dialog.code-export .modal-foot button')].at(-1).textContent`) === '写入 1 个文件', 'One create ticked');
    await click('覆盖 src/pilot/fee.ts', { selector: 'input[type=checkbox]' });
    const footer = await js(`(() => { const b = [...document.querySelectorAll('dialog.code-export .modal-foot button')].at(-1); return { text: b.textContent, cls: b.className }; })()`);
    check(footer.text === '写入 2 个文件（含覆盖 1 个）' && footer.cls.includes('is-danger'), 'With an overwrite ticked the button is red and says so');
    await capture('preview-selected', '只勾了两个：新建 night.ts、覆盖 fee.ts（勾上后整行变成浅红底）；config/settings.json 和 docs/试点说明.md 不勾。底部按钮变成红色实底的“写入 2 个文件（含覆盖 1 个）”。', 'dialog.code-export .modal-foot');
    check(JSON.stringify(tree(workspace)) === JSON.stringify(before), 'Ticking wrote nothing');
    await click('写入 2 个文件（含覆盖 1 个）');
    await exportHas('已写入 2 个文件');
    check(read('src/pilot/fee.ts') === feeNew && read('src/pilot/rules/night.ts') === night, 'The two ticked files are on disk, exactly');
    check(read('config/settings.json') === settingsOld && !fs.existsSync(join(project, 'docs')) && read('README.md') === readme, 'Unticked files are untouched');
    check((fs.statSync(join(project, 'src/pilot/rules/night.ts')).mode & 0o111) === 0 && !fs.existsSync(join(project, 'src/pilot/rules/PWNED')), 'The script is only text: not executable, not run');
    check(!fs.readdirSync(join(project, 'src/pilot')).some(name => name.includes('roundtable-tmp')), 'No temporary file is left');
    check(JSON.stringify(tree(outside)) === JSON.stringify(outsideBefore), 'Nothing outside the folder changed');
    const results = await exportText();
    check(results.includes('已覆盖') && results.includes('已新建') && results.includes('没有勾选') && results.includes('内容相同，不需要写入'), 'Each file has its outcome');
    await capture('result', '写入结果逐个文件列出：fee.ts 已覆盖、night.ts 已新建，其余标“跳过”并写各自的原因（没有勾选、内容相同、系统保留名、符号链接）。顶部“已写入 2 个文件”和位置、时间；底部写明只有标“已新建 / 已覆盖”的写到了磁盘，本应用不会运行它们。', 'dialog.code-export');
    await click('完成');
    await readerHas('写入了 2 个文件');
    await click('写入记录（1 次）', { selector: 'summary' });
    check((await js(`document.querySelector('dialog.artifact-reader [aria-label="写入记录"]').innerText`)).includes('写入 2 个，跳过 5 个'), 'The reader lists the write');
    await capture('reader-after', '回到阅读器：状态变成“有效 · 已导出”，写明最近一次在几点写入了 2 个文件；“写入记录（1 次）”默认收起，展开后是时间、文件夹、写入 2 个、跳过 5 个。', 'dialog.artifact-reader');
    await key('Escape');
    await until(`document.querySelector('.art-panel')?.innerText.includes('已写入 2 个文件')`, 'panel shows the write');
    await capture('panel-after', '产物列表里的代码候选显示“有效 · 已导出”和“已写入 2 个文件 · 时间”。', '.art-panel');

    // ── 5. An external edit after the preview is not overwritten ───────────
    await openCode(); await openExport();
    // The folder chosen in this window is checked again at once (checking only reads).
    await exportHas('没有勾选的文件不会写入');
    check(result.openDialogs.length === 3, 'The remembered folder needs no new dialog');
    check((await rowText('src/pilot/fee.ts')).includes('和现有文件完全一样') && (await rowText('config/settings.json')).includes('+2 −2 行'), 'The new check reflects the first write');
    await click('新建 docs/试点说明.md', { selector: 'input[type=checkbox]' });
    await click('覆盖 config/settings.json', { selector: 'input[type=checkbox]' });
    await capture('second-preview', '再次打开“写入文件夹…”：同一窗口里上次选的文件夹会立即重新检查（只读）。fee.ts 和 night.ts 现在“内容相同”；勾选覆盖 config/settings.json。', 'dialog.code-export');
    const external = json({ commission: 0.1, nightCutoff: 22, buildings: 4, note: '外部编辑器刚改过' }) + '\n';
    fs.writeFileSync(join(project, 'config/settings.json'), external);
    await click('写入 1 个文件（含覆盖 1 个）');
    await exportHas('没有写入任何文件');
    check(read('config/settings.json') === external, 'The external edit is kept, not overwritten');
    check((await exportText()).includes('目标在检查之后有变化，没有覆盖。请重新检查') && (await exportText()).includes('为了不覆盖你没看过的内容'), 'The result says why and what to do');
    await capture('changed-refused', '检查之后在外部改了 config/settings.json，再点写入：这个文件没有写入（“目标在检查之后有变化，没有覆盖”），磁盘上保留外部改动；没写入的文件排在最前面；顶部说明为了不覆盖没看过的内容，旁边是“重新检查”。', 'dialog.code-export');
    await click('重新检查', { scope: '.note' });
    await exportHas('没有勾选的文件不会写入');
    check((await rowText('config/settings.json')).includes('外部编辑器刚改过'), 'The new diff is against the external edit');
    await capture('rechecked', '重新检查后，差异是对着外部改过的新内容算的（能看到“外部编辑器刚改过”那一行会被替换），勾选全部清空，要重新确认。', '.cx-file.is-overwrite');
    check(JSON.stringify(tree(outside)) === JSON.stringify(outsideBefore), 'Still nothing outside the folder changed');

    // ── 6. Dark, 800 wide: preview and a create-only write ──────────────────
    await key('Escape'); await key('Escape');
    await theme('dark'); await resize(800, 600);
    await click('本场信息'); await until(`document.querySelector('.drawer.is-right')`, 'drawer');
    await click('产物', { selector: '[role=tab]', prefix: true });
    await click('打开代码候选', { prefix: true }); await readerHas('src/pilot/fee.ts');
    await noOverflow('reader 800 dark');
    await capture('reader-800-dark', '800×600 深色：阅读器占满窗口留边，“写入文件夹…”的红色描边在深色下仍清楚，写入记录默认收起。', 'dialog.artifact-reader');
    await openExport();
    await exportHas('没有勾选的文件不会写入');
    await noOverflow('preview 800 dark');
    await capture('preview-800-dark', '800×600 深色：长的文件夹路径自动换行；差异的行号、+/− 标记和红绿底色在深色下对比清楚；没有横向滚动。', '.cx-file.is-overwrite');
    await click('写入 1 个文件');
    await exportHas('已写入 1 个文件');
    check(read('docs/试点说明.md').includes('抽成 8%'), 'The Chinese file name was written');
    await noOverflow('result 800 dark');
    await capture('result-800-dark', '800×600 深色：只勾了新建 docs/试点说明.md，写入后“已写入 1 个文件”，其余逐个标跳过及原因。', 'dialog.code-export');
    await click('完成');
    await resize(1280, 800);
    await openExport(); await exportHas('没有勾选的文件不会写入');
    await capture('preview-1280-dark', '1280×800 深色：完整的检查结果；所有文件都已一致后，只剩 config/settings.json（覆盖）和两个不能写入的文件。', 'dialog.code-export');
    await key('Escape'); await key('Escape');
    await theme('light'); await resize(800, 600);
    await click('本场信息'); await until(`document.querySelector('.drawer.is-right')`, 'drawer');
    await click('产物', { selector: '[role=tab]', prefix: true });
    await click('打开代码候选', { prefix: true }); await readerHas('src/pilot/fee.ts');
    await openExport(); await exportHas('没有勾选的文件不会写入');
    await click('覆盖 config/settings.json', { selector: 'input[type=checkbox]' });
    await noOverflow('preview 800 light');
    await capture('preview-800-light', '800×600 浅色：勾选覆盖后整行浅红底，底部红色实底按钮换行后仍完整可见。', 'dialog.code-export .modal-foot');
    await key('Escape'); await key('Escape');
    await resize(1280, 800);
    check(read('config/settings.json') === external, 'Closing with a tick wrote nothing');
    check(JSON.stringify(tree(outside)) === JSON.stringify(outsideBefore), 'Nothing outside the folder changed, ever');
    const records = await recordsOf();
    check(records.map(item => `${item.written}/${item.skipped}/${item.failed}`).join(' ') === '2/5/0 0/6/1 1/6/0', 'Three writes recorded: ' + records.map(item => `${item.written}/${item.skipped}/${item.failed}`).join(' '));
    check(fixture.requests.length === 4, 'Writing sent no model request');
    await finish();
    console.log('R15_RESTART_PROFILE ' + probe.directory);
    return;
  }

  // ── Restart: the records are intact; the folder must be chosen again ──────
  const before = fixture.requests.length;
  await click(task, { selector: '.sb-runs .sb-item', prefix: true });
  await until(`document.querySelector('.thread-item')`, 'discussion reopened');
  await panelOpen();
  await until(`document.querySelector('.art-panel')?.innerText.includes('已写入 1 个文件')`, 'panel after restart');
  await capture('restart-panel', '重启应用后打开这场讨论：代码候选仍是“有效 · 已导出”，显示最近一次“已写入 1 个文件”和时间。', '.art-panel');
  await click('打开代码候选', { prefix: true }); await readerHas('src/pilot/fee.ts');
  await click('写入记录（3 次）', { selector: 'summary' });
  const history = await js(`document.querySelector('dialog.artifact-reader [aria-label="写入记录"]')?.innerText ?? ''`);
  check(history.includes('写入 1 个，跳过 6 个') && history.includes('1 个没有写入，跳过 6 个') && history.includes('写入 2 个，跳过 5 个'), 'All three writes are listed after the restart');
  await capture('restart-reader', '重启后阅读器的写入记录三次都在：写入 1 个；1 个没有写入；写入 2 个。', 'dialog.artifact-reader');
  await openExport();
  check((await exportText()).includes('选择文件夹…') && !(await exportText()).includes('没有勾选的文件不会写入'), 'After a restart the folder must be chosen again');
  await capture('restart-dialog', '重启后再点“写入文件夹…”：上次选的文件夹不会被沿用（文件夹授权只在本次运行有效），要重新选择。', 'dialog.code-export');
  await key('Escape'); await key('Escape');
  await sleep(800);
  check(fixture.requests.length === before && before === 0, 'Nothing was sent after the restart');
  const Sqlite = require('better-sqlite3');
  const db = new Sqlite(join(probe.paths.userData, 'ai-roundtable.db'), { readonly: true });
  try {
    check(db.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get() === 14, 'Migration 14');
    check(db.prepare('SELECT COUNT(*) FROM code_exports').pluck().get() === 3 && db.prepare('SELECT COUNT(*) FROM code_export_files').pluck().get() === 21, 'Three writes of seven files each are recorded');
    check(db.prepare("SELECT GROUP_CONCAT(reason) FROM code_export_files WHERE outcome='failed'").pluck().get() === 'target_changed', 'The refused overwrite is recorded with its reason');
    check(db.prepare('SELECT DISTINCT root_path FROM code_exports').pluck().all().join() === fs.realpathSync(project), 'The folder is recorded by its real path');
    const columns = db.prepare("SELECT name FROM pragma_table_info('code_export_files')").pluck().all();
    check(!columns.includes('content') && !JSON.stringify(db.prepare('SELECT * FROM code_export_files').all()).includes('COMMISSION'), 'No file contents are stored');
  } finally { db.close(); }
  await finish();
}

main().catch(probe.fail);
