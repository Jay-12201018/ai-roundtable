// Called only by the R01 probe after its pre-ready profile and network isolation.
const assert = require('node:assert/strict');

async function page(stage) {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const wait = async (read, predicate, message) => {
    const deadline = Date.now() + 10000;
    while (true) {
      const value = await read();
      if (predicate(value)) return value;
      check(Date.now() < deadline, message);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const button = name => [...document.querySelectorAll('button')].find(b => !b.closest('[hidden]') && (b.getAttribute('aria-label') === name || b.textContent === name));
  const click = async name => {
    await wait(() => button(name), b => b && !b.disabled, 'Button unavailable: ' + name);
    button(name).click();
  };
  // R16: one .thread-item per slot; a member's text is its Markdown body, the host's is its bubble.
  const text = () => [...document.querySelectorAll('.thread-item')].map(item => item.querySelector('.msg-body .md, .bubble')?.textContent ?? '');
  // R12: one timeline entry per message slot, showing its effective version; earlier versions stay reachable.
  const effective = s => { if (!s.versions) return s.messages.map(m => m.content);
    const slots = new Map(); for (const m of s.messages) { const v = s.versions.find(item => item.messageId === m.id); if (!v) continue;
      const group = slots.get(v.slotId) ?? []; group.push({ ...v, content: m.content }); slots.set(v.slotId, group); }
    return [...slots.values()].map(group => { group.sort((a, b) => a.versionNumber - b.versionNumber); return (group.find(v => v.active) ?? group.at(-1)).content; }); };
  await wait(() => document.querySelector('.app-shell'), Boolean, 'App not rendered');
  const api = window.roundtable;
  const selectDemo = async () => {
    const { roomId } = await api.room.createDemo('R04-R06 regression fixture');
    /* D169: the mode is the project's own, kept by Main */ await window.roundtable.rooms.getRoomConfiguration({ id: roomId }).then(r => window.roundtable.rooms.updateRoom({ id: r.id, name: r.name, objective: r.objective, defaultMode: 'free-chat' }));
    // R16: rooms live in the sidebar; changing page refreshes it. The room opens on its page; 新讨论 starts there.
    await click('用量');
    const rooms = await api.rooms.listRooms();
    const index = rooms.findIndex(room => room.id === roomId);
    check(index >= 0, 'Fresh demo room absent');
    const items = () => document.querySelectorAll('.sidebar .sb-rooms > li > button.sb-item');
    await wait(items, buttons => buttons.length === rooms.length, 'Rooms projection stale');
    items()[index].click();
    await wait(() => document.querySelector('.room-page h1')?.textContent, value => value === 'Mock 圆桌', 'Room page not opened');
    await click('新讨论');
  };
  let id;
  const read = () => api.run.getSnapshot(id);
  const settled = (status, turns) => wait(read, s => s.status === status && s.turns.length === turns
    && JSON.stringify(text()) === JSON.stringify(effective(s)), 'DOM/snapshot did not settle: ' + status);
  if (stage === 'pause') {
    await selectDemo();
    await click('开始讨论');
    id = await wait(() => localStorage.getItem('roundtable.runId'), Boolean, 'Run identity not saved');
    await wait(() => text(), t => t[0]?.length > 0, 'First partial text absent');
    await click('暂停');
    return settled('paused', 1);
  }
  id = localStorage.getItem('roundtable.runId');
  check(id, 'Run identity lost on refresh');
  const refreshed = await settled('paused', 1);
  await click('下一步');
  const stepped = await settled('paused', 2);
  await click('继续');
  const completed = await settled('completed', 3);
  await selectDemo();
  await wait(() => localStorage.getItem('roundtable.runId'), value => value === null, 'New room selection not committed');
  // The goal box is empty after a start (R16); give the next discussion its own goal.
  const goal = document.querySelector('textarea[aria-label="讨论目标"]');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(goal, 'R04-R06 stop and repeat'); goal.dispatchEvent(new Event('input', { bubbles: true }));
  await click('开始讨论');
  id = await wait(() => localStorage.getItem('roundtable.runId'), value => value && value !== completed.runId, 'New Run not saved');
  await wait(() => text(), t => t[0]?.length > 0, 'Stop partial absent');
  await click('停止'); await click('停止讨论');
  const stopped = await settled('cancelled', 1);
  const repeats = [];
  for (const name of ['重试当前回合', '续写部分回复']) {
    await click(name);
    await wait(read, s => s.messages.length === repeats.length + 2 && s.messages.at(-1).content.length > 0
      && JSON.stringify(text()) === JSON.stringify(effective(s)), 'Repeat message absent');
    await click('停止'); await click('停止讨论');
    repeats.push(await settled('cancelled', 1));
  }
  // The original partial and both repeats remain reachable as versions of the first slot.
  const first = document.querySelectorAll('.thread-item')[0];
  // R16 hides version stepping while a reply streams; wait for the renderer to apply the final stop.
  await wait(() => first.textContent, value => value.includes('版本 3/3'), 'Repeat versions not reachable');
  first.querySelector('button[aria-label="查看上一个版本"]').click(); await new Promise(resolve => setTimeout(resolve, 50));
  first.querySelector('button[aria-label="查看上一个版本"]').click(); await new Promise(resolve => setTimeout(resolve, 50));
  check(first.querySelector('.msg-body .md').textContent === stopped.messages[0].content, 'Original partial not reachable');
  return { refreshed, stepped, completed, stopped, repeats, cspViolations: window.__r01ProbeViolations };
}

module.exports = async function jointUi(contents) {
  const paused = await contents.executeJavaScript(`(${page.toString()})('pause')`);
  const loaded = new Promise(resolve => contents.once('did-finish-load', resolve));
  contents.reload();
  await loaded;
  const result = await contents.executeJavaScript(`(${page.toString()})('resume')`);
  assert.deepEqual(result.refreshed, paused, 'Refresh created execution or changed durable evidence');
  assert.equal(result.completed.attempts.length, 3);
  for (const [i, snapshot] of result.repeats.entries()) {
    assert.equal(snapshot.turns.length, 1);
    assert.equal(snapshot.attempts.length, i + 2);
    assert.deepEqual(snapshot.messages[0], result.stopped.messages[0]);
    assert.deepEqual(snapshot.attempts[0], result.stopped.attempts[0]);
    assert.equal(new Set(snapshot.attempts.map(a => a.requestId)).size, i + 2);
    assert.equal(new Set(snapshot.messages.map(m => m.id)).size, i + 2);
  }
  assert.deepEqual(result.cspViolations, []);
  return { paused, ...result };
};
