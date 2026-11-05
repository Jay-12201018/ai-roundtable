// Runs inside the production renderer: real UI plus the typed bridge, Mock Provider only.
async function page(stage, saved = {}) {
  let assertions = 0;
  const check = (value, message) => { assertions++; if (!value) throw new Error(message); };
  const sleep = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (read, accepts, message) => { const deadline = Date.now() + 90000; for (;;) { const value = await read(); if (accepts(value)) return value; if (Date.now() > deadline) throw new Error(message); await sleep(); } };
  const visible = e => e && !e.closest('[hidden]') && e.getClientRects().length > 0;
  const buttons = name => [...document.querySelectorAll('button')].filter(e => visible(e) && (e.getAttribute('aria-label') === name || e.textContent.trim() === name));
  const clickIn = async (scope, name) => { const button = await wait(() => [...document.querySelectorAll(scope + ' button')].find(e => visible(e) && (e.getAttribute('aria-label') === name || e.textContent.trim() === name)), b => b && !b.disabled, 'Unavailable button in ' + scope + ': ' + name); button.click(); await sleep(); };
  const click = async (name, pick = list => list[0]) => { const button = await wait(() => pick(buttons(name)), b => b && !b.disabled, 'Unavailable button: ' + name); button.click(); await sleep(); };
  const field = name => [...document.querySelectorAll('input,select,textarea')].find(e => visible(e) && (e.getAttribute('aria-label') === name || e.labels?.[0]?.textContent?.trim() === name || e.closest('label')?.firstChild?.textContent?.trim() === name));
  const fill = async (name, value) => {
    const input = await wait(() => field(name), e => e && !e.disabled, 'Unavailable field: ' + name);
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await sleep();
  };
  const api = Object.fromEntries(Object.entries(window.roundtable).map(([area, methods]) => [area, Object.fromEntries(Object.entries(methods).map(([name, method]) =>
    [name, typeof method === 'function' ? (...args) => Promise.resolve(method(...args)).catch(error => { throw new Error(`${area}.${name} failed: ${JSON.stringify(error)}`); }) : method]))]));
  const text = () => document.body.innerText;
  const summary = run => ({
    status: run.status, sequence: run.sequence, turns: run.turns.map(turn => [turn.turnId, turn.agentId, turn.status, turn.messageId, turn.overrideActionId ?? null]),
    versions: run.versions.map(v => [v.messageId, v.slotId, v.versionNumber, v.origin, v.active, v.parentMessageId ?? null, v.affectedBy]),
    attempts: run.attempts.map(a => [a.requestId, a.status]), messages: run.messages.map(m => [m.id, m.status, m.content]),
    instructions: run.host.instructions, actions: run.host.actions.map(a => [a.actionId, a.kind, a.status]), override: run.host.override ?? null,
  });
  await wait(() => document.querySelector('.app-shell'), Boolean, 'App absent');
  check(typeof api.host?.command === 'function' && Object.keys(window.roundtable.host).join() === 'command', 'Typed host bridge missing');
  check(!('invoke' in window.roundtable) && typeof require === 'undefined', 'Bridge privilege leak');

  if (stage === 'restart') {
    const run = await api.run.getSnapshot(saved.runId);
    const now = summary(run);
    check(run.status === 'completed', 'Completed Run changed on restart');
    check(JSON.stringify(now.versions) === JSON.stringify(saved.summary.versions), 'Version chain or selection changed on restart');
    check(JSON.stringify(now.attempts) === JSON.stringify(saved.summary.attempts), 'Request attempts changed: an automatic request ran on restart');
    check(JSON.stringify(now.turns) === JSON.stringify(saved.summary.turns), 'Turns changed on restart');
    check(JSON.stringify(now.messages) === JSON.stringify(saved.summary.messages), 'Message text, partial or status changed on restart');
    check(JSON.stringify(now.instructions) === JSON.stringify(saved.summary.instructions), 'Instruction state changed on restart');
    check(JSON.stringify(now.actions) === JSON.stringify(saved.summary.actions), 'Host action log changed on restart');
    check(now.sequence === saved.summary.sequence, 'Event cursor advanced without a host action');
    // The renderer restores the saved Run and renders its effective branch.
    await wait(text, value => value.includes(saved.editedText), 'Edited effective version not rendered after restart');
    check(text().includes('主持人点名') && text().includes('主持人插话'), 'Host attribution lost in UI');
    check(buttons('查看上一个版本').length === saved.multiVersionSlots, 'Version navigation lost');
    check([...document.querySelectorAll('.thread-item .note')].filter(note => note.textContent.includes('受影响')).length === saved.affectedNotes, 'Affected marks differ after restart');
    await sleep(1500);
    const later = summary(await api.run.getSnapshot(saved.runId));
    check(JSON.stringify(later.attempts) === JSON.stringify(saved.summary.attempts) && later.sequence === saved.summary.sequence, 'Request started after restart');
    return { saved, assertions, requests: 0 };
  }

  // A demo room has three legacy Mock members (Drafter, Critic, Synthesizer); no Provider or Key is involved.
  const { roomId } = await api.room.createDemo('R12 probe room'); saved.roomId = roomId; localStorage.setItem(`roundtable.mode.${roomId}`, 'free-chat');
  // R16: changing page refreshes the sidebar; the room opens on its page, where 新讨论 starts a discussion in it.
  await click('用量'); await clickIn('.sidebar', 'Mock 圆桌'); await clickIn('.room-page', '新讨论');
  await fill('讨论目标', 'R12 主持人探针任务'); await click('开始讨论');
  const runId = await wait(() => localStorage.getItem('roundtable.runId'), Boolean, 'Run absent'); saved.runId = runId;
  await wait(() => api.run.getSnapshot(runId), run => run.messages[0]?.content, 'No streamed output');
  const synthesizer = `${roomId}-agent-synthesizer`;
  // D4: typing @ in the interjection box names the next speaker; with no other words only the override is sent.
  await fill('主持人插话', '@综合者'); await click('发送插话');
  await wait(() => api.run.getSnapshot(runId), run => run.host.override, 'Override not recorded');
  const queued = await api.run.getSnapshot(runId);
  check(queued.host.override?.agentId === synthesizer, 'Override not queued');
  check(queued.turns.length === 1 && queued.turns[0].status === 'running', 'Override was not queued while the first Turn was running');
  await wait(text, value => value.includes('下一位：综合者（主持人点名'), 'Next speaker not shown');
  await wait(() => api.run.getSnapshot(runId), run => run.turns.length === 2, 'Override Turn absent');
  await fill('主持人插话', 'R12 主持人插话：请关注风险'); await click('发送插话');
  // 本场信息 › 指令 adds a standing instruction at any time (the box's 设为持续指令 only while the Run is live).
  const tab = await wait(() => [...document.querySelectorAll('[role=tab]')].find(e => visible(e) && e.textContent.startsWith('指令')), Boolean, 'Instructions tab absent'); tab.click(); await sleep();
  await fill('新增持续指令', '请用编号列出要点'); await click('添加持续指令');
  const finished = await wait(() => api.run.getSnapshot(runId), run => run.status === 'completed' || run.status === 'error', 'Run did not finish');
  check(finished.status === 'completed', 'Run failed');
  // D110: the Override inserts the synthesizer; the plan then goes on with the critic and the synthesizer, nobody is skipped.
  check(JSON.stringify(finished.turns.map(t => t.agentId.split('-agent-')[1])) === JSON.stringify(['drafter', 'synthesizer', 'critic', 'synthesizer']), 'Override order wrong: ' + finished.turns.map(t => t.agentId));
  check(finished.turns[0].status === 'completed' && finished.turns[1].overrideActionId && !finished.turns[2].overrideActionId && !finished.turns[3].overrideActionId, 'Override Turn identity wrong');
  check(finished.host.actions.some(a => a.kind === 'setOverride' && a.status === 'consumed' && a.turnId === finished.turns[1].turnId), 'Override not consumed by its Turn');
  check(finished.messages.some(m => m.senderName === '主持人' && m.content === 'R12 主持人插话：请关注风险'), 'Interjection not in history');
  check(finished.host.instructions.some(i => i.status === 'active' && i.content === '请用编号列出要点'), 'Instruction not active');
  await wait(text, value => value.includes('主持人点名') && value.includes('主持人插话'), 'Host attribution not rendered');

  // Edit the first message through the UI; the original is kept and later answers are marked affected.
  await click('修改'); saved.editedText = 'R12 主持人修订后的开场';
  await fill('修改消息内容', saved.editedText); await click('保存为新版本');
  const edited = await wait(() => api.run.getSnapshot(runId), run => run.versions.some(v => v.origin === 'edit' && v.active), 'Edit version absent');
  const first = edited.turns[0];
  check(edited.messages.some(m => m.id === finished.turns[0].messageId && m.content === finished.messages.find(x => x.id === finished.turns[0].messageId).content), 'Original text overwritten');
  check(first.messageId !== finished.turns[0].messageId, 'Effective version unchanged');
  check(edited.versions.filter(v => v.affectedBy.length).length === 3, 'Downstream affected marks missing');
  await wait(() => [...document.querySelectorAll('.thread-item .note')].filter(note => note.textContent.includes('受影响')).length, n => n === 3, 'Affected marks not rendered');

  // Regenerate the last answer as a version job in the completed Run.
  await click('重新生成', list => list.at(-1));
  const regenerated = await wait(() => api.run.getSnapshot(runId), run => run.versions.some(v => v.origin === 'regenerate' && v.active) && !run.host.generation, 'Regeneration did not finish');
  check(regenerated.status === 'completed', 'Version job changed Run status');
  const job = regenerated.versions.find(v => v.origin === 'regenerate');
  check(job.parentMessageId === finished.turns[3].messageId && job.slotId === finished.turns[3].turnId, 'Regenerated version chain wrong');
  check(new Set(regenerated.attempts.map(a => a.requestId)).size === regenerated.attempts.length && regenerated.attempts.length === 5, 'Request identity reused');

  // Duplicate delivery through the real IPC is idempotent.
  const delivery = { runId, clientRequestId: 'r12-probe-duplicate', kind: 'setInstruction', content: '重复投递只记录一次' };
  const once = await api.host.command(delivery);
  const twice = await api.host.command(delivery);
  check(once.duplicate === false && twice.duplicate === true && twice.actionId === once.actionId, 'Duplicate delivery not idempotent');
  const conflicting = await api.host.command({ ...delivery, content: '不同内容' }).catch(e => e.message);
  check(String(conflicting).includes('invalid_input'), 'Reused client request identity accepted different content');
  // A completed Run accepts no Override or plain interjection (continuing it is run.continueDiscussion, D111); refusals are structured and record nothing.
  const refused = await api.host.command({ runId, clientRequestId: 'r12-probe-refused', kind: 'setOverride', agentId: synthesizer }).catch(e => e.message);
  check(String(refused).includes('invalid_state'), 'Completed Run accepted an Override');
  const refusedText = await api.host.command({ runId, clientRequestId: 'r12-probe-refused-2', kind: 'interject', content: 'x' }).catch(e => e.message);
  check(String(refusedText).includes('invalid_state'), 'Completed Run accepted an interjection');
  // Model text cannot command: no host action carries Agent-authored content.
  check(regenerated.host.actions.every(a => ['setOverride', 'interject', 'setInstruction', 'editMessage', 'regenerateMessage'].includes(a.kind)) && regenerated.host.actions.length === 5, 'Unexpected host action');

  const final = await api.run.getSnapshot(runId);
  saved.summary = summary(final);
  await wait(() => buttons('查看上一个版本').length, n => n === 2, 'Version navigation not rendered');
  saved.multiVersionSlots = buttons('查看上一个版本').length;
  saved.affectedNotes = [...document.querySelectorAll('.thread-item .note')].filter(note => note.textContent.includes('受影响')).length;
  check(saved.affectedNotes === final.versions.filter(v => v.active && v.affectedBy.length).length, 'Rendered affected marks differ from Main');
  return { saved, assertions, requests: final.attempts.length };
}
module.exports = (contents, stage, saved) => contents.executeJavaScript(`(${page.toString()})(${JSON.stringify(stage)},${JSON.stringify(saved)})`);
