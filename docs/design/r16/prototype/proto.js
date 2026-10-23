/* AI 圆桌 · R16 界面原型。纯静态示意：所有数据是写死的示例，按钮只切换原型状态，不调用任何真实接口。 */
'use strict';

/* ───────────── 图标（线性 1.6px，与 lucide-react 同一气质） ───────────── */
const P = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  plus: 'M12 5v14M5 12h14',
  panel: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM15 4v16',
  sidebar: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 4v16',
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  play: 'M7 5l12 7-12 7z',
  step: 'M5 5l9 7-9 7zM18 5v14',
  stop: 'M7 7h10v10H7z',
  send: 'M12 19V5M6 11l6-6 6 6',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 8v5a2.5 2.5 0 0 0 5 0v-1a9 9 0 1 0-3.5 7.1',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v8',
  down: 'M6 9l6 6 6-6',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  regen: 'M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  cut: 'M4 6h16M4 11h16M4 16h7M15 16h.01M18 16h.01',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  key: 'M8 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10.8 12.2L19 4M16 7l3 3',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
  sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  chart: 'M3 20h18M6 16v-5M11 16V6M16 16v-8',
  users: 'M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c1.8.7 3 2.8 3 6',
  flow: 'M5 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 6h7a3 3 0 0 1 3 3v7',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6',
  table: 'M4 4h16v16H4zM4 10h16M10 4v16',
  list: 'M10 6h10M10 12h10M10 18h10M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17',
  code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  plug: 'M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5',
  flask: 'M9 3h6M10 3v6L5 19a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7.5 15h9',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  yen: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 7.5L12 12l3.5-4.5M12 12v5M9 13h6M9 15.5h6',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  spark: 'M12 4v4M12 16v4M4 12h4M16 12h4',
};
const ic = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[name]}"${name === 'more' || name === 'grip' ? ' stroke-width="3"' : ''}/></svg>`;
const LOGO = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="4.2"/>${[0, 60, 120, 180, 240, 300].map(a => { const r = a * Math.PI / 180; return `<circle cx="${(12 + 8.6 * Math.cos(r)).toFixed(2)}" cy="${(12 + 8.6 * Math.sin(r)).toFixed(2)}" r="1.7" fill="currentColor" stroke="none"/>`; }).join('')}</svg>`;

/* ───────────── 原型状态 ───────────── */
const SCENES = [
  ['上手', 'welcome', '首次使用 · 欢迎'],
  ['上手', 'setup1', '连接模型 · ① 选择服务'],
  ['上手', 'setup2', '连接模型 · ② 填写 Key'],
  ['上手', 'setup3', '连接模型 · ③ 检查连接'],
  ['讨论', 'new', '新讨论 · 未开始'],
  ['讨论', 'run', '讨论 · 运行中'],
  ['讨论', 'stop', '讨论 · 确认停止'],
  ['讨论', 'paused', '讨论 · 暂停后点名与插话'],
  ['讨论', 'detail', '讨论 · 版本 / 受影响 / 截断 / 摘要'],
  ['讨论', 'summary', '讨论 · 截断与摘要'],
  ['讨论', 'budget', '讨论 · 预算停下'],
  ['讨论', 'workflow', '讨论方式（工作流）'],
  ['房间', 'room', '房间与成员'],
  ['房间', 'member', '添加成员 · 角色模板'],
  ['设置', 'settings', '设置 · 模型服务'],
  ['设置', 'network', '设置 · 网络与代理'],
  ['设置', 'appearance', '设置 · 外观'],
  ['用量', 'usage', '用量'],
];
const S = { scene: 'run', theme: 'light', w: 1440, h: 900, ctx: null, tab: null, nav: false, pop: null, capture: false };

function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.get('scene')) S.scene = q.get('scene');
  if (q.get('theme')) S.theme = q.get('theme');
  if (q.get('w')) S.w = Number(q.get('w'));
  if (q.get('h')) S.h = Number(q.get('h'));
  S.ctx = q.has('ctx') ? q.get('ctx') === 'open' : null;
  S.tab = q.get('tab');
  S.nav = q.get('nav') === 'open';
  S.pop = q.get('pop');
  S.capture = q.get('capture') === '1';
}
function writeHash() {
  const q = new URLSearchParams({ scene: S.scene, theme: S.theme, w: S.w, h: S.h });
  if (S.ctx !== null) q.set('ctx', S.ctx ? 'open' : 'closed');
  if (S.tab) q.set('tab', S.tab);
  if (S.nav) q.set('nav', 'open');
  if (S.pop) q.set('pop', S.pop);
  if (S.capture) q.set('capture', '1');
  history.replaceState(null, '', '#' + q);
}
const go = (scene, extra = {}) => { Object.assign(S, { scene, ctx: null, tab: null, nav: false, pop: null }, extra); render(); };

/* ───────────── 示例数据（取自 R13B 真实实测的讨论主题，内容为示意） ───────────── */
const MEMBERS = [
  { id: 'a', name: '起草者', role: '起草', model: 'DeepSeek Flash', init: '起' },
  { id: 'b', name: '审查者', role: '审查', model: 'DeepSeek Flash', init: '审' },
  { id: 'c', name: '综合者', role: '综合', model: 'DeepSeek Flash', init: '综' },
];
const TITLE = '设计一个校园跑腿平台的试点方案';
const GOAL = '为学校设计一个校园跑腿平台的试点方案：先小范围试点，说清服务范围、定价、骑手来源和衡量指标，总预算 2 万元以内。';

const BODY = {
  draft: `<h3>试点方案（初稿）</h3><ol>
    <li><strong>范围：</strong>3 栋宿舍楼，试点 4 周，覆盖约 2,400 名学生。</li>
    <li><strong>服务：</strong>代取快递、食堂代买、打印店代取三类。</li>
    <li><strong>定价：</strong>基础费 2 元/单，超过 1 公里每 500 米加 0.5 元；平台抽成 15%。</li>
    <li><strong>骑手：</strong>在校学生兼职，上岗前完成 30 分钟安全培训。</li>
    <li><strong>目标：</strong>日均 300 单，平均 25 分钟内送达，差评率低于 3%。</li></ol>`,
  draftEdited: `<h3>试点方案（初稿）</h3><ol>
    <li><strong>范围：</strong>2 栋宿舍楼，试点 2 周，考试周前一周结束。</li>
    <li><strong>服务：</strong>代取快递、食堂代买、打印店代取三类。</li>
    <li><strong>定价：</strong>基础费 2 元/单，超过 1 公里每 500 米加 0.5 元；平台抽成 15%。</li>
    <li><strong>时段：</strong>8:00–22:00，22 点后不接单。</li></ol>`,
  review: `<p>只补三处问题，不重复初稿：</p>
    <div class="table-wrap"><table><thead><tr><th>问题</th><th>风险</th><th>建议</th></tr></thead><tbody>
    <tr><td>夜间配送</td><td>22 点后宿舍门禁，骑手安全没有保障</td><td>22 点后暂停接单</td></tr>
    <tr><td>抽成 15%</td><td>2 元的单骑手只拿到 1.7 元，留不住人</td><td>试点期抽成降到 8%</td></tr>
    <tr><td>日均 300 单</td><td>没有依据</td><td>先做一周问卷，按意向人数的 10% 估算</td></tr>
    </tbody></table></div>`,
  revisePartial: `<h3>修订稿</h3><p>按主持人的新范围和审查意见调整：</p><ul>
    <li><strong>范围：</strong>2 栋宿舍楼、2 周，考试周前一周结束。</li>
    <li><strong>时段：</strong>8:00–22:00，22 点后暂停接单。</li>
    <li><strong>抽成：</strong>试点期 8%，2 元单骑手实得 1.84 元<span class="caret" aria-hidden="true"></span></li></ul>`,
  revise: `<h3>修订稿</h3><p>按主持人的新范围和审查意见调整：</p><ul>
    <li><strong>范围：</strong>2 栋宿舍楼、2 周，考试周前一周结束。</li>
    <li><strong>时段：</strong>8:00–22:00，22 点后暂停接单。</li>
    <li><strong>抽成：</strong>试点期 8%，2 元单骑手实得 1.84 元。</li>
    <li><strong>单量：</strong>第一周发问卷，按意向人数的 10% 定日均目标（预计 120–160 单）。</li></ul>`,
  reviseCut: `<h3>修订稿</h3><ul>
    <li><strong>范围：</strong>2 栋宿舍楼、2 周，考试周前一周结束。</li>
    <li><strong>抽成：</strong>试点期 8%，2 元单骑手实得 1.84 元。</li>
    <li><strong>节奏：</strong>第一周只开放快递代取，第二周根据前 7 天的数据决定是否扩展到</li></ul>`,
  rereview: `<p>修订稿基本可行。补一个算账，确认 8% 抽成下骑手收入：</p>
    <div class="codeblock"><div class="codeblock-head"><span>text</span><button class="btn icon" title="复制代码" aria-label="复制代码">${'COPY'}</button></div><pre><span class="k">骑手实得</span> = 基础费 × (1 − 抽成) + 距离加价
2 元单：2 × 0.92 = 1.84 元
日均 140 单、12 名骑手 → 每人每天约 21 元</pre></div>
    <p>每人每天 21 元偏低，建议试点期由平台每单补贴 0.5 元，两周总补贴约 <strong>980 元</strong>，在 2 万元预算内。</p>`,
  summary: `试点：2 栋宿舍楼、2 周、8:00–22:00；只做快递代取起步。定价基础费 2 元、抽成 8%，平台每单补贴 0.5 元。单量按问卷意向人数的 10% 估算。未决：骑手保险。`,
};
BODY.rereview = BODY.rereview.replace('COPY', ic('copy'));

/* ───────────── 通用片段 ───────────── */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const btn = (label, cls = '', attrs = '') => `<button type="button" class="btn ${cls}" ${attrs}>${label}</button>`;
const iconBtn = (name, label, attrs = '') => `<button type="button" class="btn icon" aria-label="${label}" title="${label}" ${attrs}>${ic(name)}</button>`;

function sidebar(active, { empty = false } = {}) {
  const room = (name, current, runs, meta = '') => `
    <button class="sb-item" data-go="room" ${current === 'room' ? 'aria-current="page"' : ''}>${ic('users')}<span class="t">${name}</span><span class="meta">${meta}</span></button>
    ${runs ? `<div class="sb-runs">${runs}</div>` : ''}`;
  const run = (title, dot, scene, cur) => `<button class="sb-item" data-go="${scene}" ${cur ? 'aria-current="page"' : ''}><span class="run-dot ${dot}"></span><span class="t">${title}</span></button>`;
  const discussing = ['run', 'stop', 'paused', 'budget', 'detail', 'summary', 'new', 'workflow'].includes(active);
  const runs = [
    run(TITLE, active === 'budget' ? 'warn' : active === 'detail' || active === 'summary' ? '' : 'live', active === 'detail' || active === 'summary' ? 'detail' : active === 'budget' ? 'budget' : 'run', discussing && active !== 'new' && active !== 'workflow'),
    run('再讨论一次定价', '', 'detail', false),
    run('骑手保险怎么买', '', 'detail', false),
  ].join('');
  return `<nav class="sidebar ${S.nav ? 'open' : ''}" aria-label="应用导航">
    <div class="sb-top"><div class="brand">${LOGO}AI 圆桌</div>${S.w < 1024 ? iconBtn('x', '关闭导航', 'data-act="nav"') : iconBtn('sidebar', '收起导航')}</div>
    <button class="btn sb-new" data-go="new" ${empty ? 'disabled' : ''}>${ic('plus')}新讨论</button>
    <div class="sb-scroll">
      <div class="sb-label"><span>房间</span>${empty ? '' : iconBtn('plus', '新建房间')}</div>
      ${empty ? `<p class="small muted" style="padding:4px 8px">还没有房间。连接模型或开始试玩后，会自动建好第一个房间。</p>` : `
      ${room('校园跑腿讨论', active === 'room' || active === 'member' ? 'room' : '', runs, '3 人')}
      ${room('周报写作小组', '', '', '2 人')}
      ${room('支付功能评审', '', '', '4 人')}`}
    </div>
    <div class="sb-foot">
      <button class="sb-item" data-go="usage" ${active === 'usage' ? 'aria-current="page"' : ''}>${ic('chart')}<span class="t">用量</span>${empty ? '' : '<span class="meta">本月 ¥0.31</span>'}</button>
      <button class="sb-item" data-go="settings" ${['settings', 'network', 'appearance'].includes(active) ? 'aria-current="page"' : ''}>${ic('sliders')}<span class="t">设置</span>${empty ? '<span class="meta warn-text">未连接模型</span>' : ''}</button>
    </div>
  </nav>`;
}

function memberLabel(m) { return `<span class="avatar">${m.init}</span><span class="msg-name">${m.name}</span><span class="msg-meta">${m.model}</span>`; }

/* 一条成员发言：身份一行、正文、状态提示（如有）、底部元信息与操作。 */
function agentMsg({ n, m, body, tags = '', notes = '', ver, origin, cost, streaming, covered, actions = true }) {
  const foot = streaming ? `<div class="msg-foot"><span class="typing">${ic('spark')}正在发言 · 已预留最高 ¥0.0386</span></div>` : `
    <div class="msg-foot">
      ${ver ? `<span class="ver">${iconBtn('left', '上一个版本')}<span>版本 ${ver}</span>${iconBtn('right', '下一个版本')}</span><span class="sep">·</span>` : ''}
      ${origin ? `<span>${origin}</span><span class="sep">·</span>` : ''}
      ${cost ? `<span class="cost" title="${cost[1]}">${cost[0]}</span>` : ''}
      ${actions ? `<span style="flex:1"></span>${iconBtn('copy', '复制')}${iconBtn('edit', '修改（保存为新版本）')}${iconBtn('regen', '重新生成')}${iconBtn('more', '更多：查看请求详情、复制为 Markdown')}` : ''}
    </div>`;
  return `<article class="msg ${covered ? 'covered' : ''}" aria-label="第 ${n} 条 · ${m.name}">
    <div class="msg-head">${memberLabel(m)}${tags}<span class="msg-num">#${n}</span></div>
    <div class="msg-body md">${body}</div>${notes}${foot}</article>`;
}
function hostMsg({ n, text, label = '主持人插话', foot = '' }) {
  return `<article class="msg host" aria-label="第 ${n} 条 · 主持人">
    <div class="host-label"><span>${label}</span><span>·</span><span>#${n}</span></div>
    <div class="bubble">${text}</div>
    <div class="msg-foot">${foot || `<span>从下一回合起所有成员可见</span>${iconBtn('copy', '复制')}${iconBtn('edit', '修改（保存为新版本）')}`}</div></article>`;
}
const note = (kind, iconName, text, act = '') => `<div class="msg-note ${kind}" role="note">${ic(iconName)}<div class="grow">${text}</div>${act ? `<div class="act">${act}</div>` : ''}</div>`;

function topbar({ title, status, sub, budget, ctxToggle = true }) {
  return `<header class="topbar">
    ${iconBtn('menu', '打开导航', 'class="btn icon menu-btn" data-act="nav"').replace('class="btn icon" ', '')}
    <div class="tb-title"><h1>${title}</h1><div class="tb-sub">${status}${sub ? `<span class="sep tb-hide-narrow">·</span><span class="tb-hide-narrow">${sub}</span>` : ''}</div></div>
    <div class="tb-actions">
      ${budget || ''}
      <span class="avatar-stack tb-hide-narrow" title="成员：起草者、审查者、综合者">${MEMBERS.map(m => `<span class="avatar sm">${m.init}</span>`).join('')}</span>
      ${ctxToggle ? iconBtn('panel', '本场信息', `data-act="ctx" aria-expanded="${ctxShown()}"`) : ''}
    </div></header>`;
}
const budgetChip = (spent, limit, pct, warn) => `<button class="budget-chip ${warn ? 'warn' : ''}" data-act="ctx" title="本次预算：已花 ${spent}，上限 ${limit}">${ic('yen')}<span><b>${spent}</b> / ${limit}</span><span class="mini-bar"><i style="width:${pct}%"></i></span></button>`;

/* ───────────── 输入区 ───────────── */
function composer(mode) {
  const chipToggle = (label, on) => `<button class="chip ${on ? 'on' : ''}" aria-pressed="${on}"><span class="check">${on ? ic('check') : ''}</span>${label}</button>`;
  if (mode === 'setup') {
    return `<div class="dock"><div class="dock-inner">
      ${S.pop === 'more' ? morePop() : ''}
      <div class="composer">
        <div class="composer-text"><div class="ta" role="textbox" aria-multiline="true" aria-label="讨论目标">${GOAL}</div></div>
        <div class="composer-row">
          <div class="chips">
            <button class="chip" data-go="workflow">${ic('flow')}审查修订链${ic('down')}</button>
            <button class="chip" data-act="more">${ic('yen')}预算 ¥1.00${ic('down')}</button>
            ${chipToggle('每回合后暂停', false)}
            <button class="chip" data-act="more" aria-label="更多设置">${ic('more')}</button>
          </div>
          <div class="controls"><button class="btn primary slot">开始讨论</button></div>
        </div>
      </div>
      <div class="dock-hint"><span><span class="kbd">⌘</span> <span class="kbd">Enter</span> 开始</span><span>·</span><span>每次发言前按预算预留费用，结束后按实际用量结算</span></div>
    </div></div>`;
  }
  if (mode === 'completed') {
    return `<div class="dock"><div class="dock-inner"><div class="composer">
        <div class="composer-text"><div class="ta ph">在这个房间开始新的讨论，写下目标和约束…</div></div>
        <div class="composer-row">
          <div class="chips"><button class="chip" data-go="workflow">${ic('flow')}审查修订链${ic('down')}</button><button class="chip">${ic('yen')}预算 ¥1.00${ic('down')}</button>${chipToggle('每回合后暂停', false)}</div>
          <div class="controls"><button class="btn primary slot" disabled title="写下目标后可以开始">开始讨论</button></div>
        </div></div>
      <div class="dock-hint"><span>写下目标后即可开始 · 沿用上次的讨论方式和预算，不用重新应用</span></div></div></div>`;
  }
  const paused = mode === 'paused', budget = mode === 'budget';
  const text = paused
    ? `<span class="mention">@审查者</span> 复审只看两件事：22 点停单后骑手收入少了多少；8% 抽成能不能留住人。`
    : '';
  const ph = budget ? '仍然可以插话；追加预算后，下一位会看到' : '插话，所有成员从下一回合起可见；输入 @ 点名下一位…';
  const next = paused ? `<div class="next-strip">${ic('clock')}<span>已暂停，等你决定 · 下一位：<b>审查者</b>（复审，按计划）</span></div>`
    : mode === 'run' || mode === 'stop' ? `<div class="next-strip">${ic('clock')}<span>下一位：<b>审查者</b>（复审，按计划）</span></div>` : '';
  const ctrl = budget
    ? `<button class="btn primary slot" disabled title="预算不足，先在上方追加">继续</button>`
    : `<button class="btn danger sm" data-act="stop" aria-expanded="${S.pop === 'stop'}">${ic('stop')}停止</button><span class="gap"></span>
       <button class="btn sm" ${paused ? '' : 'disabled title="当前发言结束、暂停后可以单步"'}>${ic('step')}下一步</button>
       ${paused ? `<button class="btn primary slot">${ic('play')}继续</button>` : `<button class="btn primary slot">${ic('pause')}暂停</button>`}`;
  const hint = budget ? '预算不足：在上方追加预算后继续；已有发言都保留'
    : paused ? '<span><span class="kbd">Enter</span> 发送插话</span><span>·</span><span>下一步：只让下一位说一次</span><span>·</span><span>继续：恢复自动轮流</span>'
    : '<span>暂停会等起草者说完再停</span><span>·</span><span>停止会立即中止当前发言</span>';
  return `<div class="dock"><div class="dock-inner">
    ${S.pop === 'mention' || (paused && S.pop === null) ? mentionPop() : ''}
    ${next}
    <div class="composer">
      <div class="composer-text"><div class="ta ${text ? '' : 'ph'}" role="textbox" aria-multiline="true" aria-label="主持人插话">${text || ph}</div>
        <button class="send" aria-label="发送插话" ${text ? '' : 'disabled'}>${ic('send')}</button></div>
      <div class="composer-row">
        <div class="chips">
          <button class="chip" data-act="mention" aria-pressed="${S.pop === 'mention' || (paused && S.pop === null)}">${ic('at')}点名</button>
          <button class="chip" title="把这段话作为持续指令：之后每位成员的每次发言都遵守，可随时修改或清除">${ic('pin')}设为持续指令</button>
        </div>
        <div class="controls" style="position:relative">${S.pop === 'stop' ? stopPop() : ''}${ctrl}</div>
      </div>
    </div>
    <div class="dock-hint">${hint}</div>
  </div></div>`;
}
function mentionPop() {
  return `<div class="pop" style="left:0; bottom:calc(100% + 8px); width:340px" role="listbox" aria-label="点名下一位">
    <h4>点名下一位发言</h4>
    <button class="pop-item active" role="option" aria-selected="true"><span class="avatar sm">审</span><span class="t">审查者<br><small>按计划本来就是下一位（复审）</small></span>${ic('check')}</button>
    <button class="pop-item" role="option" disabled style="opacity:1"><span class="avatar sm">起</span><span class="t" style="color:var(--text-2)">起草者<br><small>不在当前阶段（复审）</small></span></button>
    <button class="pop-item" role="option" disabled><span class="avatar sm">综</span><span class="t" style="color:var(--text-2)">综合者<br><small>不在本次讨论方式里</small></span></button>
    <div class="pop-foot">被点名的成员排在下一回合发言，不会打断正在进行的发言。按流程讨论时，只能点名当前阶段的成员。</div>
  </div>`;
}
function stopPop() {
  const live = S.scene !== 'paused';
  return `<div class="pop stop-pop" role="dialog" aria-label="确认停止">
    <h3>停止这次讨论？</h3>
    <p>${live ? '起草者正在发言，已生成的文字会保留。这次请求已经发出，可能已经计费；拿不到用量时按预留上限 ¥0.0386 计入。' : '后续回合不再进行，已有发言都会保留。'}停止后不会自动继续；需要时可以对最后一条发言重试或续写（会再次计费）。</p>
    <div class="row">${btn('不停止', '', 'autofocus data-act="stop"')}${btn('停止讨论', 'danger solid')}</div></div>`;
}
function morePop() {
  return `<div class="pop" style="left:120px; bottom:calc(100% + 8px); width:360px; padding:14px 16px">
    <label class="field"><span>本次预算</span><div class="money-input"><span>¥</span><input value="1.00" aria-label="本次预算（元）"></div>
      <span class="help">花到上限就停下，之后可以追加。默认 1 元，DeepSeek 一场 5 回合的讨论通常不到 0.1 元。</span></label>
    <label class="field" style="margin:0"><span>单次发言上限</span><div class="inline-fields"><input class="input" style="width:110px" value="4096"><span class="muted small">tokens</span></div>
      <span class="help">每位成员一次最多写这么长（约 3,000 汉字）。写到上限会保留并标注，可以续写。</span></label></div>`;
}

/* ───────────── 右侧「本场」面板 ───────────── */
function ctxShown() {
  const def = ['run', 'stop', 'paused', 'detail', 'summary', 'budget'].includes(S.scene) && S.w >= 1280;
  return S.ctx === null ? def : S.ctx;
}
function contextPanel(variant) {
  const tab = S.tab || (S.scene === 'summary' ? 'instructions' : variant === 'detail' ? 'artifacts' : 'progress');
  const t = (id, label, count = '') => `<button class="tab" role="tab" data-tab="${id}" aria-selected="${tab === id}">${label}${count ? `<span class="count">${count}</span>` : ''}</button>`;
  let body = '';
  if (tab === 'progress') body = progressTab(variant);
  if (tab === 'members') body = membersTab(variant);
  if (tab === 'instructions') body = instructionsTab();
  if (tab === 'artifacts') body = artifactsTab(variant);
  return `<aside class="context" aria-label="本场信息">
    <div class="ctx-head"><h2>本场信息</h2>${iconBtn('x', '关闭', 'data-act="ctx"')}</div>
    <div class="tabs" role="tablist">${t('progress', '进度')}${t('members', '成员', '3')}${t('instructions', '指令', '1')}${t('artifacts', '产物')}</div>
    <div class="ctx-body">${body}</div>
    <details class="dev"><summary>运行详情（排查问题时用）</summary><dl><dt>运行 ID</dt><dd>run_8f2c…41ad</dd><dt>事件序列</dt><dd>23</dd><dt>回合</dt><dd>3 / 12</dd><dt>状态来源</dt><dd>主进程快照 · 已同步</dd></dl></details>
  </aside>`;
}
function progressTab(v) {
  const warn = v === 'budget';
  const b = { run: ['¥0.0062', '¥1.00', '¥0.9552', '¥0.0386', 1, 4], paused: ['¥0.0089', '¥1.00', '¥0.9911', '—', 1, 0], detail: ['¥0.0286', '¥1.00', '¥0.9714', '—', 3, 0], budget: ['¥0.0472', '¥0.05', '¥0.0028', '—', 94, 0] }[v === 'stop' ? 'run' : v];
  const steps = v === 'detail'
    ? [['done', '起草', '起草者', '1 回合'], ['done', '审查', '审查者', '1 回合'], ['done', '修订', '起草者', '1 回合'], ['done', '复审', '审查者', '1 回合'], ['', '定稿', '起草者 · 复审后结束，未执行', '']]
    : v === 'budget'
      ? [['done', '起草', '起草者', '1 回合'], ['done', '审查', '审查者', '1 回合'], ['now', '修订', '起草者 · 因预算未开始', ''], ['', '复审', '审查者', ''], ['', '定稿', '起草者', '']]
      : [['done', '起草', '起草者', '1 回合'], ['done', '审查', '审查者', '1 回合'], [v === 'paused' ? 'done' : 'now', '修订', v === 'paused' ? '起草者' : '起草者 · 正在发言', v === 'paused' ? '1 回合' : ''], [v === 'paused' ? 'now' : '', '复审', v === 'paused' ? '审查者 · 下一位' : '审查者', ''], ['', '定稿', '起草者', '']];
  return `<section class="ctx-sec"><h3>预算 ${warn ? '<span class="pill warn">已用完</span>' : `<button class="link small">追加</button>`}</h3>
      <div class="budget-meter ${warn ? 'warn' : ''}"><div class="big">${b[0]} <small>/ ${b[1]}</small></div>
      <div class="bar"><i style="width:${b[4]}%"></i>${b[5] ? `<i class="res" style="width:${b[5]}%"></i>` : ''}</div>
      <div class="rows"><span>剩余</span><span>${b[2]}</span><span>进行中预留</span><span>${b[3]}</span><span>未知费用</span><span>无</span></div></div>
      ${warn ? '' : '<p class="small muted" style="margin:8px 2px 0">按官方单价估算，DeepSeek 空闲时段按半价；实际扣费以控制台为准。</p>'}</section>
    <section class="ctx-sec"><h3>讨论方式 <button class="link small" data-go="workflow">查看</button></h3>
      <p class="small muted" style="margin:-4px 0 12px">审查修订链 · 第 ${v === 'detail' ? '4' : v === 'paused' ? '3' : '3'} / 5 步 · 用时 ${v === 'detail' ? '3 分 40 秒' : '1 分 12 秒'}（上限 5 分钟）</p>
      <ol class="steps">${steps.map(([st, t, s, r]) => `<li class="${st}"><span class="mark">${st === 'done' ? ic('check') : ''}</span><span><span class="t">${t}</span><span class="s">${s}</span></span><span class="r">${r}</span></li>`).join('')}</ol></section>`;
}
function membersTab(v) {
  const state = { run: ['正在发言', '下一位', '不在本流程'], paused: ['刚发言', '下一位', '不在本流程'], detail: ['—', '—', '生成了摘要'], budget: ['等待中', '—', '不在本流程'], stop: ['正在发言', '下一位', '不在本流程'] }[v];
  return `<section class="ctx-sec"><h3>本场成员</h3>${MEMBERS.map((m, i) => `
    <div class="member-row"><span class="avatar">${m.init}</span><div class="info"><b>${m.name}</b><small>角色：${m.role} · ${m.model}</small></div><span class="pill ${state[i] === '正在发言' ? 'live' : ''}">${state[i]}</span></div>`).join('')}
    <p class="small muted" style="margin-top:12px">成员名单在讨论开始时固定；在「房间」里改成员，只影响之后的讨论。点名请在下方输入框里输入 @。</p></section>`;
}
function instructionsTab() {
  return `<section class="ctx-sec"><h3>持续指令 <span class="small muted" style="font-weight:400">每次发言都会遵守</span></h3>
    <div class="instr"><p>所有金额精确到元，并标出依据；不确定的数字写“待核实”。</p><small><span>第 2 版 · 从下一次发言起生效</span><span class="grow"></span><button class="link">修改</button><button class="link" style="color:var(--danger)">清除</button></small></div>
    <p class="small muted">在输入框写好一段话，点「设为持续指令」即可添加。已清除 1 条，记录保留在运行详情里。</p></section>`;
}
function artifactsTab(v) {
  return `<p class="reserve-note">${ic('info')} 预留位置：结构化产物属于 R14，代码导出属于 R15。这里只示意入口和状态写法。</p>
    <section class="ctx-sec"><h3>整理成…</h3>
      <div class="artifact">${ic('file')}<div class="grow"><b>方案文档</b><small>${v === 'detail' ? '校园跑腿试点方案 · 已校验 · 来自第 1–5 条' : '讨论完成后可以生成'}</small></div>${v === 'detail' ? btn('查看', 'sm') : ''}</div>
      <div class="artifact">${ic('table')}<div class="grow"><b>对比表</b><small>${v === 'detail' ? '三种抽成方案 · 草稿 · 待你确认' : '把讨论中的方案并排比较'}</small></div>${v === 'detail' ? btn('查看', 'sm') : ''}</div>
      <div class="artifact">${ic('list')}<div class="grow"><b>行动清单</b><small>负责人、截止时间、来源发言</small></div>${btn('生成', 'sm quiet')}</div>
      <div class="artifact">${ic('code')}<div class="grow"><b>代码候选</b><small>预览 diff 和路径，逐个文件确认后才写入磁盘；不会执行生成的代码</small></div></div>
    </section>
    <p class="small muted">生成产物是一次真实请求，开始前会显示预计最高花费。</p>`;
}

/* ───────────── 讨论界面 ───────────── */
function discussion({ variant, title = TITLE, status, sub, budget, thread, dock }) {
  return {
    nav: variant,
    main: `${topbar({ title, status, sub, budget })}
      <div class="scroll"><div class="thread">${thread}</div></div>${dock}`,
    ctx: contextPanel(variant),
  };
}
const goalCard = `<div class="goal-card"><div class="lbl">讨论目标</div><p>${GOAL}</p></div><div class="sys-line">审查修订链 · 起草者 → 审查者 → 起草者 → 审查者 → 起草者 · 预算 ¥1.00</div>`;
const M = id => MEMBERS.find(m => m.id === id);
const cost = (yuan, detail) => [yuan, detail];

const RENDER = {
  run: () => discussion({
    variant: 'run',
    status: `<span class="pill live"><span class="dot"></span>运行中</span><span>第 3 / 5 步 · 起草者正在修订</span>`,
    sub: '审查修订链',
    budget: budgetChip('¥0.0062', '¥1.00', 5),
    thread: goalCard
      + agentMsg({ n: 1, m: M('a'), body: BODY.draft, cost: cost('¥0.0021', '输入 1,284 / 输出 236 tokens · 按空闲价（高峰价的一半）') })
      + agentMsg({ n: 2, m: M('b'), body: BODY.review, cost: cost('¥0.0024', '输入 1,602 / 输出 312 tokens · 按空闲价') })
      + hostMsg({ n: 3, text: '试点范围改成两栋楼、为期两周，考试周前结束。另外 22 点以后不接单。' })
      + agentMsg({ n: 4, m: M('a'), body: BODY.revisePartial, streaming: true, tags: '<span class="tag">修订</span>' }),
    dock: composer('run'),
  }),
  stop: () => { S.pop = S.pop || 'stop'; return RENDER.run(); },
  paused: () => discussion({
    variant: 'paused',
    status: `<span class="pill"><span class="dot"></span>已暂停</span><span>第 3 / 5 步完成 · 等你决定</span>`,
    sub: '审查修订链',
    budget: budgetChip('¥0.0089', '¥1.00', 1),
    thread: goalCard
      + agentMsg({ n: 1, m: M('a'), body: BODY.draft, cost: cost('¥0.0021', '输入 1,284 / 输出 236 tokens · 按空闲价') })
      + agentMsg({ n: 2, m: M('b'), body: BODY.review, cost: cost('¥0.0024', '输入 1,602 / 输出 312 tokens · 按空闲价') })
      + hostMsg({ n: 3, text: '试点范围改成两栋楼、为期两周，考试周前结束。另外 22 点以后不接单。' })
      + agentMsg({ n: 4, m: M('a'), body: BODY.revise, tags: '<span class="tag">修订</span>', cost: cost('¥0.0027', '输入 1,950 / 输出 298 tokens · 按空闲价') }),
    dock: composer('paused'),
  }),
  detail: () => discussion({
    variant: 'detail',
    status: `<span class="pill ok">${ic('check')}已完成</span><span>4 回合 · 花费 ¥0.0286</span>`,
    sub: '审查修订链 · 复审后结束',
    budget: budgetChip('¥0.0286', '¥1.00', 3),
    thread: goalCard
      + `<span class="${S.scene === 'detail' ? 'anchor' : ''}"></span>` + agentMsg({ n: 1, m: M('a'), body: BODY.draftEdited, ver: '2 / 2', origin: '主持人修改',
        tags: '<span class="tag accent" title="摘要生成后修改过，所以这条会照常发给之后的成员，紧跟在摘要后面">摘要后已修改 · 照常发送</span>', cost: cost('¥0.0021', '原始版本的花费；主持人修改不产生费用') })
      + agentMsg({ n: 2, m: M('b'), body: BODY.review, covered: true, tags: '<span class="tag" title="原文保留；之后的发言用摘要代替它">已由摘要代替</span>',
        notes: note('', 'alert', '<b>受影响</b> · 写这条时依据的是第 1 条的旧版本（已被主持人修改），内容可能过时。', `${btn('重新生成', 'sm')}<span class="small muted">最多约 ¥0.004</span>`),
        cost: cost('¥0.0024', '输入 1,602 / 输出 312 tokens · 按空闲价') })
      + hostMsg({ n: 3, text: '试点范围改成两栋楼、为期两周，考试周前结束。另外 22 点以后不接单。', foot: '<span class="tag">已由摘要代替</span>' })
      + `<span class="${S.scene === 'summary' ? 'anchor' : ''}"></span>` + agentMsg({ n: 4, m: M('a'), body: BODY.reviseCut, covered: true, tags: '<span class="tag">修订</span><span class="tag">已由摘要代替</span>',
        notes: note('', 'cut', '<b>写到单次上限停下了</b> · 4,096 tokens，内容可能不完整。续写会生成新版本，按新请求计费。', btn('续写', 'sm')),
        cost: cost('¥0.0071', '输入 2,140 / 输出 4,096 tokens · 按空闲价') })
      + `<section class="summary" aria-label="讨论摘要（覆盖第 1–4 条）">
          <div class="summary-head">${ic('layers')}<b>讨论摘要</b><span class="tag">覆盖第 1–4 条</span><span class="tag accent">${ic('check')}已确认 · 之后的发言用它代替原文</span></div>
          <div class="summary-body">${BODY.summary}</div>
          ${note('', 'alert', '<b>受影响</b> · 生成摘要后，第 1 条被修改。修改后的原文会紧跟摘要发给之后的成员；建议重新生成摘要，把修改整理进去。', `${btn('重新生成摘要…', 'sm primary')}<span class="small muted">最多 ¥0.0390</span>`)}
          <div class="msg-foot"><span>由综合者生成 · 原文保留在上方</span><span class="sep">·</span><span class="cost" title="输入 3,880 / 输出 142 tokens · 按空闲价">¥0.0039</span><span style="flex:1"></span>${iconBtn('copy', '复制')}${iconBtn('edit', '修改（保存为新版本并确认使用）')}</div>
        </section>`
      + agentMsg({ n: 5, m: M('b'), body: BODY.rereview, tags: '<span class="tag">复审</span>', cost: cost('¥0.0031', '输入 2,016（缓存命中 1,280）/ 输出 344 tokens · 按空闲价') })
      + `<div class="sys-line">讨论已完成 · 复审后结束（按讨论方式设定）</div>`,
    dock: composer('completed'),
  }),
  summary: () => RENDER.detail(),
  budget: () => discussion({
    variant: 'budget',
    status: `<span class="pill warn">${ic('alert')}已因预算停止</span><span>第 3 / 5 步前停下</span>`,
    sub: '审查修订链',
    budget: budgetChip('¥0.0472', '¥0.05', 94, true),
    thread: goalCard.replace('预算 ¥1.00', '预算 ¥0.05')
      + agentMsg({ n: 1, m: M('a'), body: BODY.draft, cost: cost('¥0.0193', '输入 1,284 / 输出 236 tokens · 按高峰价') })
      + agentMsg({ n: 2, m: M('b'), body: BODY.review, cost: cost('¥0.0279', '输入 1,602 / 输出 312 tokens · 按高峰价') })
      + hostMsg({ n: 3, text: '试点范围改成两栋楼、为期两周，考试周前结束。另外 22 点以后不接单。' })
      + `<div class="notice" role="alert"><h3>${ic('alert')}预算用完了，已暂停发送</h3>
          <p>下一位（起草者）这次发言最多可能花 ¥0.0386，本次只剩 ¥0.0028。追加预算后会从这里接着讨论，已有发言都保留。</p>
          <div class="row"><div class="money-input"><span>¥</span><input value="1.00" aria-label="追加预算（元）"></div>${btn('追加并继续', 'primary')}</div>
          <p class="hint">至少还差 ¥0.0358。预算只能追加、不能减少，每笔追加都单独记录。</p></div>`,
    dock: composer('budget'),
  }),
  new: () => ({
    nav: 'new',
    main: `${topbar({ title: '新讨论', status: '<span>校园跑腿讨论</span>', sub: '3 位成员', ctxToggle: false })}
      <div class="scroll"><div class="empty-room">
        <span class="avatar-stack">${MEMBERS.map(m => `<span class="avatar">${m.init}</span>`).join('')}</span>
        <h2>这场讨论要解决什么？</h2>
        <p>起草者、审查者会按「审查修订链」轮流发言：起草 → 审查 → 修订 → 复审 → 定稿。你随时可以暂停、插话或点名。</p>
        <div class="suggest"><button>接着上次：把定价细化到每类订单</button><button>比较三种骑手招募方式</button><button>给试点写一份 1 页的汇报</button></div>
      </div></div>${composer('setup')}`,
  }),
  workflow: () => {
    const base = RENDER.new();
    const tpl = (name, desc, bars, on) => `<button class="choice" aria-pressed="${on}"><b>${name}</b><small>${desc}</small><span class="mini-flow">${'<i></i>'.repeat(bars)}</span></button>`;
    const stage = (n, name, who, extra = '') => `<div class="wf-stage"><span class="n">${n}</span><b>${name}</b><span class="flow-line">${who.map(w => `<span class="member-chip"><span class="avatar sm">${w[0]}</span>${w}</span>`).join('')}</span><span class="small muted">${extra}</span></div>`;
    base.overlay = `<div class="scrim"><div class="dialog wide" role="dialog" aria-label="讨论方式">
      <div class="dlg-head"><div class="grow"><h2>讨论方式</h2><p>决定谁在什么时候发言。这个房间会记住你的选择，每次开始时按当时的成员自动核对，不用重复应用。</p></div>${iconBtn('x', '关闭', 'data-go="new"')}</div>
      <div class="dlg-body">
        <div class="choice-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
          ${tpl('自由讨论', '全员按顺序轮流发言，适合发散。', 3, false)}
          ${tpl('双人对话', '两位成员来回讨论一个问题。', 2, false)}
          ${tpl('审查修订链', '起草 → 审查 → 修订 → 复审 → 定稿。', 5, true)}
          ${tpl('深度辩论', '各自陈述 → 两轮交锋 → 总结。', 4, false)}
        </div>
        <div class="card" style="margin-top:18px">
          ${stage(1, '起草', ['起草者'])}${stage(2, '审查', ['审查者'])}${stage(3, '修订', ['起草者'])}${stage(4, '复审', ['审查者'], '复审后结束 ▾')}${stage(5, '定稿', ['起草者'], '不执行')}
        </div>
        <div style="display:flex; gap:16px; flex-wrap:wrap; margin-top:16px">
          <label class="field" style="margin:0"><span>最多回合</span><input class="input" style="width:96px" value="12"></label>
          <label class="field" style="margin:0"><span>时长上限</span><div class="inline-fields"><input class="input" style="width:96px" value="5"><span class="muted small">分钟（暂停不计时）</span></div></label>
          <label class="field" style="margin:0"><span>单次发言上限</span><div class="inline-fields"><input class="input" style="width:96px" value="4096"><span class="muted small">tokens</span></div></label>
        </div>
        <div class="callout accent" style="margin-top:16px">${ic('check')}<span>已核对：预计 4 回合（复审后结束），起草者 → 审查者 → 起草者 → 审查者。成员严格依次发言，不会同时生成。</span></div>
      </div>
      <div class="dlg-foot"><span class="left">综合者不在这个流程里，可以在讨论中生成摘要。</span>${btn('取消', '', 'data-go="new"')}${btn('用于这个房间', 'primary', 'data-go="new"')}</div>
    </div></div>`;
    return base;
  },
  welcome: () => ({
    nav: 'welcome', empty: true,
    main: `<div class="topbar" style="border-bottom:0">${iconBtn('menu', '打开导航', 'class="btn icon menu-btn" data-act="nav"').replace('class="btn icon" ', '')}<span style="flex:1"></span></div>
      <div class="welcome"><div class="welcome-inner">
        <div class="welcome-logo">${LOGO}</div>
        <h1>让几位 AI 围坐一桌，替你把问题讨论透</h1>
        <p class="sub">你是主持人：定目标、点名、插话、随时暂停。先连接一个模型服务，或者用演示成员试一场。</p>
        <div class="start-cards">
          <div class="start-card primary"><h2>${ic('plug', 'lg')}连接模型服务</h2><p>支持 DeepSeek、OpenAI、Claude、Gemini 和兼容 OpenAI 接口的服务。用你自己的 API Key，费用由服务商直接收取。</p>${btn('连接…', 'primary', 'data-go="setup1"')}</div>
          <div class="start-card"><h2>${ic('flask', 'lg')}先试玩演示</h2><p>用三位演示成员跑一场完整讨论，体验暂停、插话和点名。不联网、不需要 Key、不花钱；回复是预先写好的示例，不代表真实模型的水平。</p>${btn('开始试玩', '', 'data-go="new"')}</div>
        </div>
        <div class="three-steps"><span><i>1</i>连接模型</span><span><i>2</i>建房间、选成员（默认起草 · 审查 · 综合）</span><span><i>3</i>写下目标，开始讨论</span></div>
        <div class="trust">${ic('lock')}所有数据只保存在这台电脑上。Key 存进系统钥匙串，只会发往你确认过的服务地址。</div>
      </div></div>`,
  }),
  setup1: () => setupDialog(1),
  setup2: () => setupDialog(2),
  setup3: () => setupDialog(3),
  room: () => roomPage(),
  member: () => { const r = roomPage(); r.overlay = memberDialog(); return r; },
  settings: () => settingsPage('models'),
  network: () => settingsPage('network'),
  appearance: () => settingsPage('appearance'),
  usage: () => usagePage(),
};

function setupDialog(step) {
  const base = RENDER.welcome();
  const st = (n, label) => `<span class="s ${n < step ? 'done' : n === step ? 'now' : ''}"><span class="n">${n < step ? ic('check') : n}</span>${label}</span>`;
  const svc = (logo, name, desc, on, extra = '') => `<button class="choice" aria-pressed="${on}"><b><span class="svc-logo" style="width:28px;height:28px;font-size:11px">${logo}</span>${name}</b><small>${desc}</small>${extra}</button>`;
  let body = '', foot = '';
  if (step === 1) {
    body = `<div class="choice-grid">
      ${svc('DS', 'DeepSeek', '中文好、价格低，已按官方价格核对计费。', true, '<span class="badge tag accent">推荐</span>')}
      ${svc('AI', 'OpenAI', '官方接口。', false)}
      ${svc('An', 'Anthropic Claude', '官方接口。价格尚未审核，暂时不能用于讨论。', false)}
      ${svc('G', 'Google Gemini', '官方接口。价格尚未审核，暂时不能用于讨论。', false)}
      ${svc('⋯', '其他兼容服务', 'Kimi、通义千问、硅基流动等兼容 OpenAI 接口的服务，需要填写地址。', false)}
      ${svc(ic('flask'), '演示（Mock）', '不联网、不花钱，回复是预设示例。', false)}
    </div>
    <p class="small muted" style="margin:14px 0 0">“价格尚未审核”的服务可以保存 Key、检查连接，但在价格核对之前不会发送讨论请求，避免花费算不清。</p>`;
    foot = `<span class="left">之后可以在「设置 → 模型服务」里添加更多。</span>${btn('取消', '', 'data-go="welcome"')}${btn('下一步', 'primary', 'data-go="setup2"')}`;
  } else if (step === 2) {
    body = `<div class="target">${ic('lock')}<span>Key 只会发往 <code>https://api.deepseek.com</code></span><span style="flex:1"></span><button class="link small">更改地址</button></div>
      <label class="field" style="margin-top:18px"><span>API Key</span><input class="input mono" type="password" value="xxxxxxxxxxxxxxxxxxxxxxxxxx" aria-describedby="key-help">
        <span class="help" id="key-help">在 DeepSeek 开放平台的「API Keys」页面创建并复制。保存后存进 macOS 钥匙串；不会出现在讨论记录、日志和导出文件里，也不会再显示出来。</span></label>
      <label class="field"><span>默认模型</span><select class="select"><option>DeepSeek Flash（deepseek-flash）· 快、便宜，适合多数讨论</option></select>
        <span class="help">新成员默认用这个模型，每位成员也可以单独换。</span></label>
      <details class="adv" style="border:0"><summary style="padding:4px 0; color:var(--text-2)">高级：服务名称、请求地址、更多模型</summary><p class="small muted">一般不用改。地址必须以 https:// 开头（本机服务可以用 http://localhost）。</p></details>`;
    foot = `<span class="left">${ic('shield')} 保存即表示你确认了上面的地址</span>${btn('上一步', '', 'data-go="setup1"')}${btn('保存并连接', 'primary', 'data-go="setup3"')}`;
  } else {
    body = `<ul class="check-list">
        <li>${ic('check', 'ok')}<span><b>已保存</b><br><span class="small muted">Key 已存进系统钥匙串，请求地址 https://api.deepseek.com 已确认。</span></span></li>
        <li>${ic('check', 'ok')}<span><b>Key 有效</b><br><span class="small muted">已用免费的模型列表接口检查，没有生成内容、没有产生费用。</span></span></li>
        <li>${ic('check', 'ok')}<span><b>DeepSeek Flash 可以用于讨论</b><br><span class="small muted">价格已核对（2026-10-20），讨论时按官方单价预留和结算。</span></span></li>
      </ul>
      <div class="callout" style="margin-top:18px">${ic('info')}<span>想确认真的能生成？可以试发一条很短的消息，约 ¥0.0001。${btn('试发一条', 'sm', 'style="margin-left:6px"')}</span></div>
      <div class="callout accent" style="margin-top:10px">${ic('users')}<span>下一步：已为你建好房间「我的第一场讨论」，三位成员（起草者、审查者、综合者）都使用 DeepSeek Flash。</span></div>`;
    foot = `${btn('稍后再说', '', 'data-go="welcome"')}${btn('去开始讨论', 'primary', 'data-go="new"')}`;
  }
  base.overlay = `<div class="scrim"><div class="dialog wide" role="dialog" aria-label="连接模型服务">
    <div class="dlg-head"><div class="grow"><h2>${step === 1 ? '连接模型服务' : step === 2 ? '填写 DeepSeek 的 API Key' : 'DeepSeek 已连接'}</h2><p>${step === 1 ? '选一个你有账号的服务。只需要做一次。' : step === 2 ? '费用由 DeepSeek 直接从你的账户扣除；AI 圆桌不收取任何费用。' : '可以开始讨论了。'}</p></div>${iconBtn('x', '关闭', 'data-go="welcome"')}</div>
    <div class="stepper">${st(1, '选择服务')}<span class="line"></span>${st(2, '填写 Key')}<span class="line"></span>${st(3, '检查连接')}</div>
    <div class="dlg-body">${body}</div><div class="dlg-foot">${foot}</div></div></div>`;
  return base;
}

function roomPage() {
  const row = (m, status, i) => `<div class="card-row"><span class="grip" aria-label="拖动调整顺序">${ic('grip')}</span><span class="avatar">${m.init}</span>
    <div class="grow"><b>${m.name}</b> <span class="tag" style="margin-left:6px">${m.role}</span><small>${status}</small></div>
    <button class="switch" role="switch" aria-checked="true" aria-label="${m.name} 参与讨论"></button>${iconBtn('more', `${m.name}：编辑、归档、删除`)}</div>`;
  return {
    nav: 'room',
    main: `${topbar({ title: '校园跑腿讨论', status: '<span>房间设置</span>', sub: '3 位成员 · 3 次讨论', ctxToggle: false })}
    <div class="page"><div class="page-inner">
      <div class="page-head"><div class="grow"><h1>校园跑腿讨论</h1><p>默认目标：为学校设计校园跑腿平台的试点方案。新讨论会预填这个目标，可以改。</p></div>${btn(`${ic('edit')}编辑`, '')}${btn(`${ic('plus')}新讨论`, 'primary', 'data-go="new"')}</div>
      <section class="section"><h2><span class="grow">成员</span>${btn(`${ic('plus')}添加成员`, 'sm', 'data-go="member"')}</h2>
        <p class="lead">按顺序轮流发言（使用审查修订链时按流程分配）。拖动调整顺序。改动只影响之后开始的讨论。</p>
        <div class="card">
          ${row(MEMBERS[0], 'DeepSeek Flash · 可以使用', 0)}
          ${row(MEMBERS[1], 'DeepSeek Flash · 可以使用', 1)}
          <div class="card-row"><span class="grip">${ic('grip')}</span><span class="avatar">综</span><div class="grow"><b>综合者</b> <span class="tag" style="margin-left:6px">综合</span><small class="warn-text">${ic('alert')} 还没选模型，暂时不会参与讨论 · <button class="link">去选择</button></small></div><button class="switch" role="switch" aria-checked="true" aria-label="综合者 参与讨论"></button>${iconBtn('more', '综合者：编辑、归档、删除')}</div>
        </div></section>
      <section class="section"><h2><span class="grow">讨论方式</span>${btn('更改', 'sm', 'data-go="workflow"')}</h2>
        <div class="card"><div class="card-row">${ic('flow', 'lg')}<div class="grow"><b>审查修订链</b><small>起草者 → 审查者 → 起草者 → 审查者 → 起草者 · 最多 12 回合 · 5 分钟</small></div></div></div></section>
      <section class="section"><h2><span class="grow">讨论记录</span><button class="link small">全部</button></h2>
        <div class="card">
          <div class="card-row"><span class="run-dot live"></span><div class="grow"><b>${TITLE}</b><small>运行中 · 今天 23:48 · ¥0.0062</small></div>${btn('打开', 'sm quiet', 'data-go="run"')}</div>
          <div class="card-row"><span class="run-dot"></span><div class="grow"><b>再讨论一次定价</b><small>已完成 · 10/23 23:31 · ¥0.0003</small></div>${btn('打开', 'sm quiet', 'data-go="detail"')}</div>
          <div class="card-row"><span class="run-dot"></span><div class="grow"><b>骑手保险怎么买</b><small>已停止 · 部分输出已保留 · 10/22 21:05 · ¥0.0011</small></div>${btn('打开', 'sm quiet', 'data-go="detail"')}</div>
        </div></section>
      <section class="section"><h2>归档或删除</h2>
        <div class="danger-zone"><div class="grow"><b>归档房间</b><small>从列表隐藏，不能开始新讨论；记录都保留，可以随时恢复。</small></div>${btn(`${ic('archive')}归档`, '')}</div>
        <div class="danger-zone" style="margin-top:10px"><div class="grow"><b>删除房间</b><small>不可撤销。只有从没讨论过的房间可以删除；有记录的请归档。</small></div>${btn(`${ic('trash')}删除…`, 'danger')}</div>
      </section>
    </div></div>`,
  };
}
function memberDialog() {
  const role = (name, desc, on) => `<button class="choice" aria-pressed="${on}" style="min-height:76px"><b>${name}</b><small>${desc}</small></button>`;
  return `<div class="scrim"><div class="dialog wide" role="dialog" aria-label="添加成员">
    <div class="dlg-head"><div class="grow"><h2>添加成员</h2><p>先选一个角色，名字和设定会自动填好，都可以再改。</p></div>${iconBtn('x', '关闭', 'data-go="room"')}</div>
    <div class="dlg-body">
      <div class="choice-grid">
        ${role('起草', '先拿出一版完整方案。', false)}
        ${role('审查', '找出最关键的问题，给依据和改法，不重写。', true)}
        ${role('综合', '整合分歧，做取舍，给结论。', false)}
        ${role('反方', '专门唱反调，压力测试方案。', false)}
        ${role('事实核查', '核对数字、出处和前提。', false)}
        ${role('自定义', '自己写角色和设定。', false)}
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 16px; margin-top:20px">
        <label class="field"><span>名字</span><input class="input" value="审查者"><span class="help">显示在讨论里，随你取，比如“老周”或“B”。</span></label>
        <label class="field"><span>角色</span><input class="input" value="审查"><span class="help">决定 TA 做什么。起草、审查、综合会自动带上内置的发言要求。</span></label>
      </div>
      <label class="field"><span>设定 <span class="muted small" style="font-weight:400">可选</span></span><textarea class="textarea">你负责审查。指出方案里最关键的 3 个问题，每个给出依据和改法；不要重写全文，不要重复别人说过的内容。</textarea></label>
      <label class="field" style="margin:0"><span>模型</span><select class="select"><option>DeepSeek · DeepSeek Flash（deepseek-flash）</option></select><span class="help ok-text">${ic('check')} 可以使用：Key 已保存，价格已核对</span></label>
    </div>
    <div class="dlg-foot">${btn('取消', '', 'data-go="room"')}${btn('添加', 'primary', 'data-go="room"')}</div></div></div>`;
}

function settingsPage(sub) {
  const navItem = (id, icon, label) => `<button class="sb-item" ${id === 'data' ? 'title="原型未画此页"' : `data-go="${id === 'models' ? 'settings' : id}"`} ${sub === id ? 'aria-current="page"' : ''}>${ic(icon)}<span class="t">${label}</span></button>`;
  let content = '';
  if (sub === 'models') {
    content = `<div class="page-head"><div class="grow"><h1>模型服务</h1><p>成员用哪个服务、哪个模型，在房间里为每位成员选。这里管理连接和 Key。</p></div>${btn(`${ic('plus')}添加服务`, 'primary', 'data-go="setup1"')}</div>
      <div class="card" style="margin-bottom:12px">
        <div class="card-row"><div class="svc grow"><span class="svc-logo">DS</span><div><b>DeepSeek</b> <span class="pill ok" style="margin-left:6px">${ic('check')}可以使用</span><small>2 个模型 · Key 在钥匙串 · 经本机代理</small></div></div>${iconBtn('down', '收起')}</div>
        <dl class="kv"><dt>请求地址</dt><dd>https://api.deepseek.com <span class="small muted">· 官方地址，保存 Key 时已确认</span></dd>
          <dt>API Key</dt><dd>已保存（不显示） <button class="link small" style="margin-left:8px">更换</button></dd></dl>
        <div class="model-row"><b>DeepSeek Flash</b><code>deepseek-flash</code><span class="tag accent">默认</span><span style="flex:1"></span><span class="small muted">价格已核对 · 10/20</span></div>
        <div class="model-row"><b>DeepSeek Pro</b><code>deepseek-pro</code><span style="flex:1"></span><span class="small muted">价格已核对 · 10/20</span></div>
        <div class="model-row"><button class="link small">${ic('plus')} 添加模型</button><span class="small muted">名字照服务商文档填写；列表里没有的也可以手动加。</span></div>
        <div class="model-row" style="flex-wrap:wrap">${btn('检查连接', 'sm')}<span class="small muted">免费，不生成内容</span><span style="width:12px"></span>${btn('试发一条', 'sm')}<span class="small muted">约 ¥0.0001</span><span style="flex:1"></span><span class="small ok-text">${ic('check')} 上次检查：Key 有效 · 23:40</span></div>
        <details class="adv"><summary>高级与删除</summary><div style="padding:0 16px 16px; display:grid; gap:10px">
          <label class="field" style="margin:0"><span>请求地址</span><input class="input mono" value="https://api.deepseek.com"><span class="help">一般不用改。改了地址需要重新填写 Key，防止 Key 被发到别处。</span></label>
          <div class="danger-zone"><div class="grow"><b>删除 Key 或这个服务</b><small>正在使用它的成员需要改选模型；已有讨论记录不受影响。</small></div>${btn('删除 Key…', 'danger sm')}${btn('删除服务…', 'danger sm')}</div></div></details>
      </div>
      <div class="card" style="margin-bottom:12px"><div class="card-row"><div class="svc grow"><span class="svc-logo">AI</span><div><b>OpenAI</b> <span class="pill warn" style="margin-left:6px">还没填写 Key</span><small>保存了配置，但还不能使用</small></div></div>${btn('填写 Key', 'sm')}</div></div>
      <div class="card"><div class="card-row"><div class="svc grow"><span class="svc-logo">${ic('flask')}</span><div><b>演示（Mock）</b> <span class="pill" style="margin-left:6px">内置</span><small>不联网、不花钱，回复是预设示例。适合试玩和排查问题。</small></div></div>${iconBtn('right', '展开')}</div></div>`;
  } else if (sub === 'network') {
    content = `<div class="page-head"><div class="grow"><h1>网络与代理</h1><p>在国内访问部分服务时需要通过代理。这里只支持你电脑上运行的代理软件（例如 Clash、Surge 的本机端口）。</p></div></div>
      <div class="card">
        <div class="card-row"><div class="grow"><b>通过本机代理连接</b><small>只用于 DeepSeek、Claude、Gemini 的官方地址，其他服务直连。</small></div><button class="switch" role="switch" aria-checked="true" aria-label="通过本机代理连接"></button></div>
        <div style="padding:16px">
          <label class="field"><span>代理地址</span><div class="inline-fields"><select class="select" style="width:150px"><option>127.0.0.1</option><option>[::1]</option></select><span class="muted">:</span><input class="input" style="width:100px" value="7890" aria-label="端口"></div>
            <span class="help">在代理软件里找“HTTP 代理端口”或“混合端口”。只能填本机地址。</span></label>
          <label class="field" style="grid-template-columns:auto 1fr; align-items:start; gap:10px"><input type="checkbox" checked style="margin-top:3px; width:16px; height:16px; accent-color:var(--accent)"><span style="font-weight:400">由代理解析域名<span class="help" style="display:block; margin-top:2px">很多代理需要这样才能连通。代理会知道你访问了哪个服务，但看不到 Key 和讨论内容：连接仍然加密，并校验服务器证书。</span></span></label>
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap">${btn('检测代理', 'sm')}<span class="small ok-text">${ic('check')} 可以通过代理连到 api.deepseek.com</span></div>
        </div>
        <div class="card-row" style="background:var(--warn-soft); border-radius:0 0 var(--r-md) var(--r-md)">${ic('info')}<div class="grow small">改动在<b>重启应用</b>后生效。当前生效：已开启 127.0.0.1:7890（来自环境变量 ROUNDTABLE_CONNECT_PROXY）。</div>${btn('立即重启', 'sm')}</div>
      </div>
`;
  } else {
    const card = (icon, label, on) => `<button class="choice" aria-pressed="${on}" style="align-items:center; text-align:center; min-height:96px">${ic(icon, 'xl')}<b>${label}</b></button>`;
    content = `<div class="page-head"><div class="grow"><h1>外观</h1><p>默认跟随系统，切换后立即生效并记住。</p></div></div>
      <div class="choice-grid" style="max-width:520px">${card('monitor', '跟随系统', S.theme !== 'light' && S.theme !== 'dark')}${card('sun', '浅色', S.theme === 'light')}${card('moon', '深色', S.theme === 'dark')}</div>
      <section class="section" style="margin-top:28px"><h2>阅读</h2><div class="card">
        <div class="card-row"><div class="grow"><b>正文字号</b><small>只影响讨论正文；界面跟随系统缩放。</small></div><div class="seg"><button>小</button><button aria-pressed="true">标准</button><button>大</button></div></div>
        <div class="card-row"><div class="grow"><b>减少动画</b><small>默认跟随系统“减弱动态效果”。</small></div><button class="switch" role="switch" aria-checked="false" aria-label="减少动画"></button></div></div></section>`;
  }
  return {
    nav: sub === 'models' ? 'settings' : sub,
    main: `<div class="topbar narrow-only">${iconBtn('menu', '打开导航', 'class="btn icon menu-btn" data-act="nav"').replace('class="btn icon" ', '')}<div class="tb-title"><h1>设置</h1></div></div>
      <div class="settings"><nav class="settings-nav" aria-label="设置分类"><h1>设置</h1>${navItem('models', 'plug', '模型服务')}${navItem('network', 'globe', '网络与代理')}${navItem('appearance', 'sun', '外观')}${navItem('data', 'shield', '数据与隐私')}</nav>
      <div class="page"><div class="page-inner">${content}</div></div></div>`,
  };
}

function usagePage() {
  const r = (t, s, req, inp, out, settled, unk, wo, tot) => `<tr><td><button class="link" style="color:var(--text); text-decoration:none; font-weight:600" data-go="detail">${t}</button><small>${s}</small></td><td>${req}</td><td>${inp}</td><td>${out}</td><td>${settled}</td><td>${unk}</td><td>${wo}</td><td class="total">${tot}</td></tr>`;
  return {
    nav: 'usage',
    main: `<div class="topbar narrow-only">${iconBtn('menu', '打开导航', 'class="btn icon menu-btn" data-act="nav"').replace('class="btn icon" ', '')}<div class="tb-title"><h1>用量</h1></div></div>
    <div class="page"><div class="page-inner" style="max-width:1000px">
      <div class="page-head"><div class="grow"><h1>用量与花费</h1><p>按本机记录的用量和官方单价估算（空闲时段半价、缓存命中按缓存价），用于预算和核对。实际扣费以服务商控制台为准。</p></div>
        <select class="select" style="width:auto"><option>本月</option></select>${btn(`${ic('download')}导出 CSV`, '')}</div>
      <div class="stats">
        <div class="stat"><span>合计</span><strong>¥0.3124</strong><small>42 次请求</small></div>
        <div class="stat"><span>已结算</span><strong>¥0.2738</strong><small>40 次，其中 31 次按空闲价；全按高峰价为 ¥0.4912</small></div>
        <div class="stat warn"><span>未知（按上限计）</span><strong>¥0.0386</strong><small>1 次 · 到控制台核对后可以核销</small></div>
        <div class="stat"><span>已核销</span><strong>¥0.0003</strong><small>1 次，原按上限计 ¥0.0386</small></div>
      </div>
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px"><div class="seg" role="group" aria-label="汇总方式"><button aria-pressed="true">按讨论</button><button>按模型</button><button>按日期</button></div></div>
      <div class="card table-card"><table class="data"><thead><tr><th>讨论</th><th>请求</th><th>输入 tokens</th><th>输出 tokens</th><th>已结算</th><th>未知</th><th>已核销</th><th>合计</th></tr></thead><tbody>
        ${r(TITLE, '校园跑腿讨论 · 10/24 23:48', 5, '8,880<small>缓存命中 1,280</small>', '5,330', '¥0.0286<small>空闲价 5 次</small>', '—', '—', '¥0.0286')}
        ${r('骑手保险怎么买', '校园跑腿讨论 · 10/22 21:05', 3, '4,210', '980', '¥0.0011', '¥0.0386<small>1 次</small>', '—', '¥0.0397')}
        ${r('再讨论一次定价', '校园跑腿讨论 · 10/23 23:31', 1, '0', '0', '—', '—', '¥0.0003<small>1 次</small>', '¥0.0003')}
        ${r('本周周报：增长组', '周报写作小组 · 10/21 10:12', 6, '12,402', '3,118', '¥0.0352<small>空闲价 0 次</small>', '—', '—', '¥0.0352')}
      </tbody></table></div>
      <section class="section" style="margin-top:28px"><h2>待核对的未知费用</h2>
        <p class="lead">这些请求已经发出，但没拿到服务商的用量（例如中途停止或断网），所以先按预留上限计入。到控制台查到实际扣费后，可以填进来；原记录会保留。</p>
        <div class="card"><div class="card-row"><span class="avatar">起</span><div class="grow"><b>起草者 · 骑手保险怎么买</b><small>DeepSeek Flash · 10/22 21:05 · 中途停止 · 按上限计 ¥0.038574</small></div>${btn('核销…', 'sm')}</div></div></section>
    </div></div>`,
  };
}

/* ───────────── 渲染 ───────────── */
function render() {
  document.documentElement.dataset.theme = S.theme;
  document.documentElement.classList.toggle('capture', S.capture);
  const view = (RENDER[S.scene] || RENDER.run)();
  const showCtx = view.ctx && ctxShown();
  const wide = S.w >= 1280;
  const frame = document.getElementById('frame');
  frame.style.width = S.w + 'px'; frame.style.height = S.h + 'px';
  frame.innerHTML = `<div class="app">
    ${sidebar(view.nav, { empty: view.empty })}
    <main class="main">${view.main}</main>
    ${showCtx ? view.ctx : ''}
    ${S.nav && S.w < 1024 ? '<div class="scrim-drawer nav" data-act="nav"></div>' : ''}
    ${showCtx && !wide ? '<div class="scrim-drawer ctx" data-act="ctx"></div>' : ''}
  </div>
  ${view.overlay || ''}`;
  // 运行中的讨论跟随最新发言；已完成的讨论定位到示意的位置。
  const scroller = frame.querySelector('.scroll');
  const anchor = frame.querySelector('.anchor');
  if (scroller && anchor) scroller.scrollTop = anchor.offsetTop - 16;
  else if (scroller) scroller.scrollTop = scroller.scrollHeight;
  renderBar();
  writeHash();
}
function renderBar() {
  const bar = document.getElementById('bar');
  const groups = [...new Set(SCENES.map(s => s[0]))];
  bar.innerHTML = `<b>AI 圆桌 · R16 原型</b>
    <label class="grp">画面 <select id="scene">${groups.map(g => `<optgroup label="${g}">${SCENES.filter(s => s[0] === g).map(s => `<option value="${s[1]}" ${s[1] === S.scene ? 'selected' : ''}>${s[2]}</option>`).join('')}</optgroup>`).join('')}</select></label>
    <span class="grp">主题 ${['light', 'dark'].map(t => `<button data-theme-set="${t}" aria-pressed="${S.theme === t}">${t === 'light' ? '浅色' : '深色'}</button>`).join('')}</span>
    <span class="grp">窗口 ${[[1600, 1000], [1440, 900], [1280, 800], [1024, 768], [800, 600]].map(([w, h]) => `<button data-size="${w}x${h}" aria-pressed="${S.w === w}">${w}</button>`).join('')}</span>
    <span class="grp" style="color:#b9b5ac">点击界面里的导航、按钮可以切换画面；所有数据都是示例。</span>`;
}

document.addEventListener('click', event => {
  const el = event.target.closest('[data-go],[data-act],[data-tab],[data-theme-set],[data-size]');
  if (!el) return;
  if (el.dataset.go) return go(el.dataset.go);
  if (el.dataset.tab) { S.tab = el.dataset.tab; return render(); }
  if (el.dataset.themeSet) { S.theme = el.dataset.themeSet; return render(); }
  if (el.dataset.size) { [S.w, S.h] = el.dataset.size.split('x').map(Number); S.ctx = null; S.nav = false; return render(); }
  const act = el.dataset.act;
  if (act === 'ctx') { S.ctx = !ctxShown(); return render(); }
  if (act === 'nav') { S.nav = !S.nav; return render(); }
  if (act === 'stop') { S.pop = S.pop === 'stop' ? 'none' : 'stop'; return render(); }
  if (act === 'mention') { S.pop = (S.pop === 'mention' || (S.scene === 'paused' && S.pop === null)) ? 'none' : 'mention'; return render(); }
  if (act === 'more') { S.pop = S.pop === 'more' ? 'none' : 'more'; return render(); }
});
document.addEventListener('change', event => { if (event.target.id === 'scene') go(event.target.value); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && S.pop && S.pop !== 'none') { S.pop = 'none'; render(); } });
readHash();
render();
