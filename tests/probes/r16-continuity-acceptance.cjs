// Discussion continuity hands-on acceptance (D110–D112), through the production build with real mouse, keyboard
// and IME input. Isolation, network blocking and the DeepSeek loopback fixture come from r16-harness.cjs.
// One screenshot per step into docs/verification/r16-continuity-screens/.
// Usage: electron tests/probes/r16-continuity-acceptance.cjs
const { resolve } = require('node:path');
const { createProbe } = require('./r16-harness.cjs');

const probe = createProbe({ prefix: 'roundtable-r16-continuity', name: 'R16_CONTINUITY', timeoutMs: 900000 });
const { fixture, check } = probe;
const screens = resolve(probe.root, 'docs/verification/r16-continuity-screens');
const fakeKey = 'r16-continuity-fake-deepseek-key';

const replies = {
  起草者: ['### 试点方案（初稿）\n\n1. **范围：**3 栋宿舍楼，试点 4 周。\n2. **定价：**基础费 2 元/单，平台抽成 15%。\n3. **目标：**日均 300 单。',
    '我补一个风险：骑手不足时高峰期会超时，试点第一周要备 10 名兼职。'],
  审查者: ['两处问题：抽成 15% 时 2 元的单骑手只拿 1.7 元，留不住人；日均 300 单没有依据。',
    '核对了数字：2 元 × (1 − 15%) = 1.70 元，初稿没有算错；但改成 8% 后是 1.84 元，比初稿多 0.14 元。',
    '我补一个风险：夜间门禁后无人接单，需要提前公告服务时间。'],
  综合者: ['**综合：**抽成试点期降到 8%（骑手每单 1.84 元），22 点后暂停接单，先做一周问卷再定日均目标。',
    '**最终方案：**3 栋宿舍楼试点 4 周；基础费 2 元、抽成 8%；22 点后停单；第一周问卷校准日均目标。',
    '我补一个风险：问卷样本偏差，建议按楼栋分层抽样。'],
};
const used = {};
fixture.reply = body => {
  const member = /现在由你（成员「([^」]+)」/u.exec(body.messages.at(-1).content)?.[1];
  const index = used[member] = (used[member] ?? -1) + 1;
  return replies[member]?.[index] ?? '好的，我补充一点。';
};

async function main() {
  const ui = await probe.start({ screens });
  const { js, until, click, field, key, ime, capture, api, status, text, runSnapshot } = ui;
  const statusHas = (value, timeout) => until(`(document.querySelector('[role=status][aria-label="运行状态"]')?.textContent ?? '').includes(${JSON.stringify(value)})`, 'status ' + value, timeout);
  const strip = label => js(`document.querySelector('[role=status][aria-label=${JSON.stringify(label)}]')?.textContent ?? ''`);
  const speakers = snapshot => snapshot.turns.map(turn => snapshot.execution.membersSnapshot.find(member => member.agentId === turn.agentId).displayName);
  const lastRequest = () => fixture.requests.at(-1).messages.map(message => message.content).join('\n');

  const provider = await api('settings.createProvider', { name: 'DeepSeek 直连', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] });
  await api('settings.setKey', { providerId: provider.id, apiKey: fakeKey });
  const room = await api('rooms.createRoom', { name: '校园跑腿讨论', objective: '' });
  await js(`localStorage.setItem('roundtable.mode.${room.id}', 'free-chat')`);
  for (const [index, [name, role]] of [['起草者', '起草'], ['审查者', '审查'], ['综合者', '综合']].entries()) {
    await api('rooms.createAgent', { roomId: room.id, displayName: name, roleTemplateId: role, systemPrompt: '', providerId: provider.id, modelId: 'deepseek-flash', enabled: true, displayOrder: index });
  }
  await js('location.reload(); true'); await until(`document.querySelector('.sidebar')`, 'reloaded'); await ui.ensureLocator();

  // ── Path 1: a 3-round discussion; after round 2 the host names 审查者 ─────────────
  // R16 batch 2: the room opens on its page; 新讨论 there starts a discussion in it.
  await click('校园跑腿讨论', { selector: '.sb-item' }); await click('新讨论', { scope: '.room-page' });
  await until(`document.body.innerText.includes('这场讨论要解决什么？')`, 'empty room');
  await field('讨论目标'); await ui.selectAll();
  await ime('sheji', '为学校设计一个校园跑腿平台的试点方案：说清范围、定价和衡量指标。');
  await click('每回合后暂停', { selector: 'label' });
  await click('开始讨论');
  await statusHas('已暂停', 30000);
  await click('下一步');
  await until(`document.querySelectorAll('.thread-item .msg').length === 2 && (document.querySelector('[role=status][aria-label="运行状态"]')?.textContent ?? '').includes('已暂停')`, 'round 2 done', 30000);
  let snap = await runSnapshot();
  check(JSON.stringify(speakers(snap)) === JSON.stringify(['起草者', '审查者']), 'Rounds 1–2: 起草者, 审查者');
  check((await strip('下一位')).includes('下一位：综合者（按计划）'), 'Before naming: 综合者 is next by plan');
  await capture('round2-paused', '第 2 轮后暂停，按计划下一位是综合者');

  await click('点名', { selector: '.chip' });
  await until(`document.querySelector('[role=listbox][aria-label="点名下一位"]')`, 'mention menu');
  await key('ArrowDown'); await key('Enter');
  check((await js(`document.querySelector('[aria-label="主持人插话"]').value`)).startsWith('@审查者 '), '@审查者 written into the box');
  await ime('jiancha', '检查一下骑手收入那一段的数字。', { enterWhileComposing: true });
  await key('Enter');
  await until(`document.body.innerText.includes('已点名审查者并发送插话')`, 'override + interjection sent');
  const named = await strip('下一位');
  check(named.includes('下一位：审查者（主持人点名，插入一轮') && named.includes('之后回到原计划：综合者'), 'D110: the strip says 审查者 is inserted and 综合者 follows');
  await capture('named-critic', '点名审查者：插入一轮，之后回到原计划的综合者');
  await click('成员', { selector: '[role=tab]', prefix: true });
  check((await text()).includes('下一位：审查者（主持人点名，插入一轮') && (await text()).includes('之后回到原计划：综合者'), 'The members tab says the same');
  await capture('panel-members-named', '本场信息 › 成员：同样说明插入一轮，原计划不跳过', '.run-panel');

  await click('继续');
  await statusHas('已完成', 60000);
  snap = await runSnapshot();
  check(JSON.stringify(speakers(snap)) === JSON.stringify(['起草者', '审查者', '审查者', '综合者']), 'D110: 审查者 inserted, then 综合者 still speaks');
  check(Boolean(snap.turns[2].overrideActionId) && !snap.turns[3].overrideActionId, 'Only the named Turn is marked inserted');
  check(lastRequest().includes('检查一下骑手收入那一段的数字') && lastRequest().includes('核对了数字'), '综合者 read the host check and the inserted answer');
  await until(`document.body.innerText.includes('讨论已完成 · 可以在下方继续这场讨论')`, 'completed line');
  await capture('path1-done', '讨论结束：综合者照常发言，点名的一轮标“主持人点名”', '.msg-head .tag');

  // ── Path 2: after it ended, "@综合者 请总结" continues the same discussion ─────────────
  const runId = snap.runId;
  check(await js(`document.querySelector('[aria-label="继续讨论"]') !== null && document.querySelector('[aria-label="讨论目标"]') === null`), 'D111: the box continues this discussion; it is not a new-goal box');
  await until(`(document.querySelector('[role=status][aria-label="继续后谁回应"]')?.textContent ?? '').includes('各回应一次')`, 'round preview');
  check((await strip('继续后谁回应')).includes('起草者 → 审查者 → 综合者 各回应一次'), 'Without @ everyone answers once, in order');
  check(await js(`document.querySelector('[role=status][aria-label="继续后谁回应"] > span').getBoundingClientRect().height <= 22`), 'At 1440 wide the who-and-cost line fits on one line');
  check((await js(`document.querySelector('[aria-label="继续讨论"]').placeholder`)).includes('所有成员按顺序各回应一次'), 'Placeholder explains continuing');
  check(Boolean(await ui.find('新讨论')), '新讨论 stays an explicit button');
  await capture('completed-continue-box', '讨论结束后：输入框默认在这场讨论里继续，旁边是「新讨论」');
  await click('点名', { selector: '.chip' });
  await until(`document.querySelector('[role=listbox][aria-label="只让一位成员回应"]')`, 'continue mention menu');
  await capture('continue-mention', '继续时的 @：只让一位成员回应');
  await key('ArrowDown'); await key('ArrowDown'); await key('Enter');
  await ime('qingzongjie', '请总结一下最终方案。', { enterWhileComposing: true });
  await until(`(document.querySelector('[role=status][aria-label="继续后谁回应"]')?.textContent ?? '').includes('只由综合者回应一次')`, 'single preview');
  const requestsBefore = fixture.requests.length;
  check(requestsBefore === 4, 'Nothing was sent while typing');
  await capture('continue-at-synth', '带 @：只由综合者回应一次，发送前说明谁回应');
  await key('Enter');
  await statusHas('已完成', 60000);
  snap = await runSnapshot();
  check(snap.runId === runId && snap.continuations?.length === 1, 'D111: the same Run continued');
  check(JSON.stringify(speakers(snap)) === JSON.stringify(['起草者', '审查者', '审查者', '综合者', '综合者']), 'Only 综合者 answered');
  check(snap.turns[4].overrideActionId === snap.continuations[0].actionId, 'The answer belongs to the continuation');
  const synthRequest = lastRequest();
  for (const piece of ['试点方案（初稿）', '两处问题', '核对了数字', '检查一下骑手收入', '@综合者 请总结一下最终方案。']) check(synthRequest.includes(piece), '综合者 saw the whole history: ' + piece);
  check(fixture.requests.at(-1).messages.some(message => message.role === 'assistant' && message.content.includes('**综合：**')), "综合者's own earlier reply stays its own");
  await until(`document.body.innerText.includes('最终方案')`, 'summary rendered');
  await capture('continue-at-synth-done', '综合者在同一场讨论里总结，回合标“继续讨论”', '.thread-item:last-child');

  // ── Path 3: without @, everyone answers once ─────────────
  await field('继续讨论');
  await ime('zaige', '再各说一句：试点最大的风险是什么？');
  await until(`(document.querySelector('[role=status][aria-label="继续后谁回应"]')?.textContent ?? '').includes('起草者 → 审查者 → 综合者 各回应一次')`, 'round preview again');
  await capture('continue-round', '不带 @：所有成员按顺序各回应一次');
  await key('Enter');
  await statusHas('已完成', 90000);
  snap = await runSnapshot();
  check(JSON.stringify(speakers(snap).slice(5)) === JSON.stringify(['起草者', '审查者', '综合者']), 'D111: one round in roster order');
  check(snap.continuations.length === 2 && snap.turns.slice(5).every(turn => turn.overrideActionId === snap.continuations[1].actionId), 'Round answers belong to the second continuation');
  check(lastRequest().includes('试点最大的风险') && lastRequest().includes('骑手不足时高峰期会超时') && lastRequest().includes('夜间门禁后无人接单'), 'Later answers see earlier answers of the round');
  check(snap.usage.length === 8 && snap.usage.every(row => row.state === 'reported'), 'Every answer has its usage');
  await until(`document.body.innerText.includes('问卷样本偏差')`, 'round rendered');
  await capture('continue-round-done', '一轮结束：三位成员各回应一次', '.thread-item:last-child');

  // ── D112: no revision note anywhere, so the revision rule was never sent ─────────────
  check(fixture.requests.every(request => !JSON.stringify(request.messages).includes('写于前序修改之前') && !JSON.stringify(request.messages).includes('已由主持人修改')), 'D112: no request carried the revision rule');
  check(fixture.requests.every(request => request.messages[1].content.includes('3. 以你自己的身份直接发言')), 'D112: the remaining rules are numbered 1–3');

  await click('进度', { selector: '[role=tab]', prefix: true });
  check((await text()).includes('计划 3 / 3 回合 · 另有 5 轮插入（点名 1、继续讨论 4）'), 'Progress counts plan turns apart from inserted ones');
  await capture('panel-progress', '本场信息 › 进度：计划回合与插入的回合分开计数', '.run-panel');

  // R16 batch 2: 外观 is a section of 设置; the discussion is reopened from its entry in the sidebar.
  const themeTo = async label => {
    const task = (await runSnapshot()).execution.task;
    await click('设置', { selector: '.sb-item' }); await click('外观'); await click(label, { selector: '.choice' });
    await click(task, { selector: '.sb-runs .sb-item', prefix: true });
  };
  // Dark theme for the continue box.
  await themeTo('深色');
  await until(`(document.querySelector('[role=status][aria-label="继续后谁回应"]')?.textContent ?? '').includes('各回应一次')`, 'dark preview');
  await capture('continue-box-dark', '深色：继续讨论的输入框');
  await themeTo('浅色');

  // A new discussion is only the explicit button.
  await click('新讨论', { scope: '.dock' });
  await until(`document.querySelector('[aria-label="讨论目标"]') && document.body.innerText.includes('这场讨论要解决什么？')`, 'new discussion box');
  check(fixture.requests.length === 8, 'Opening 新讨论 sent nothing');
  check(!(await status()).includes('已完成') && (await status()).includes('校园跑腿讨论'), 'No Run selected after 新讨论: the top bar names the room');
  await capture('new-discussion', '点「新讨论」才开一场新的讨论；上一场在侧栏里');

  // ── Path 4 (D110): while 起草者 speaks, @审查者 — already next by plan — sends only the words ─────────────
  await field('讨论目标'); await ui.selectAll();
  await ime('pinggu', '评估一下试点的风险。');
  if (await js(`document.querySelector('label.chip-check input')?.checked`)) await click('每回合后暂停', { selector: 'label' });
  fixture.mode = 'hang';
  await click('开始讨论');
  await until(`document.querySelector('.thread-item .md')?.textContent.length > 0 && document.querySelector('[aria-label="主持人插话"]')`, 'drafter streaming');
  check((await strip('下一位')).includes('下一位：审查者（按计划）'), 'While 起草者 speaks, 审查者 is next by plan');
  await click('点名', { selector: '.chip' });
  await until(`document.querySelector('[role=listbox][aria-label="点名下一位"]')`, 'mention menu');
  check((await js(`document.querySelector('[role=listbox][aria-label="点名下一位"]').innerText`)).replace(/\s+/gu, '').includes('审查者按计划就是下一位：只发插话，不多插一轮'), 'The menu says naming 审查者 only sends the words');
  await key('ArrowDown'); await key('Enter');
  await ime('xianhe', '先核一下预算数字。', { enterWhileComposing: true });
  await key('Enter');
  await until(`document.body.innerText.includes('审查者按计划就是下一位，会在发言时看到你这段话（没有多插一轮）。')`, 'scheduled notice');
  snap = await runSnapshot();
  check(!snap.host.override && !snap.host.actions.some(action => action.kind === 'setOverride'), 'No Override was sent for the planned next speaker');
  check(snap.messages.some(message => message.content === '@审查者 先核一下预算数字。'), 'The words reached the public history');
  await capture('at-planned-next', '起草者发言时 @审查者（按计划就是下一位）：只发插话，提示“审查者按计划就是下一位，会在发言时看到你这段话（没有多插一轮）”');
  fixture.mode = 'ok'; fixture.release();
  await statusHas('已完成', 60000);
  snap = await runSnapshot();
  check(JSON.stringify(speakers(snap)) === JSON.stringify(['起草者', '审查者', '综合者']) && snap.turns.every(turn => !turn.overrideActionId), 'Order 起草者 → 审查者 → 综合者, nobody twice');
  const critic = fixture.requests.slice(8).find(request => request.messages.at(-1).content.includes('现在由你（成员「审查者」'));
  check(Boolean(critic) && JSON.stringify(critic.messages).includes('先核一下预算数字'), "审查者's own planned request carried the words");
  await capture('at-planned-next-done', '结束：起草者 → 审查者 → 综合者，审查者只说一次，回应了这段话', '.thread-item:last-child');
  await ui.finish();
}

main().catch(probe.fail);
