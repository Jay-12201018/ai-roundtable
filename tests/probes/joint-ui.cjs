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
  const button = name => [...document.querySelectorAll('button')].find(b => b.textContent === name);
  const click = async name => {
    await wait(() => button(name), b => b && !b.disabled, 'Button unavailable: ' + name);
    button(name).click();
  };
  const text = () => [...document.querySelectorAll('.message p')].map(p => p.textContent);
  await wait(() => document.querySelector('.app-shell'), Boolean, 'App not rendered');
  const api = window.roundtable;
  let id;
  const read = () => api.run.getSnapshot(id);
  const settled = (status, turns) => wait(read, s => s.status === status && s.turns.length === turns
    && JSON.stringify(text()) === JSON.stringify(s.messages.map(m => m.content)), 'DOM/snapshot did not settle: ' + status);
  if (stage === 'pause') {
    await click('开始 Mock 协作');
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
  await click('新建任务');
  await wait(() => localStorage.getItem('roundtable.runId'), value => value === null, 'New room selection not committed');
  await click('开始 Mock 协作');
  id = await wait(() => localStorage.getItem('roundtable.runId'), value => value && value !== completed.runId, 'New Run not saved');
  await wait(() => text(), t => t[0]?.length > 0, 'Stop partial absent');
  await click('停止');
  const stopped = await settled('cancelled', 1);
  const repeats = [];
  for (const name of ['重试当前回合', '续写部分回复']) {
    await click(name);
    await wait(read, s => s.messages.length === repeats.length + 2 && s.messages.at(-1).content.length > 0
      && text().length === s.messages.length, 'Repeat message absent');
    await click('停止');
    repeats.push(await settled('cancelled', 1));
  }
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
