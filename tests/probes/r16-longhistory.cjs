// R16 long-history measurement in the production build: one real Run with 1000+ public messages (host interjections
// added through the trusted host IPC, member replies from the DeepSeek loopback fixture), then a reply streaming every
// 32ms while the probe reads at the bottom, scrolls up with the mouse wheel, selects text and jumps back. Records DOM
// size, frame gaps and anchor drift. Usage: electron tests/probes/r16-longhistory.cjs
const { resolve } = require('node:path');
const { createProbe } = require('./r16-harness.cjs');

const probe = createProbe({ prefix: 'roundtable-r16-longhistory', name: 'R16_LONGHISTORY', timeoutMs: 1200000 });
const { fixture, check, sleep, result } = probe;
const screens = resolve(probe.root, 'docs/verification/r16-impl-screens/long-history');
const INTERJECTIONS = 1000;

const longReply = '### 补充\n\n| 项 | 说明 |\n| --- | --- |\n| 范围 | 两栋宿舍楼 |\n| 时段 | 8:00–22:00 |\n\n```text\n骑手实得 = 基础费 × (1 − 抽成)\n```\n\n' + '这一段用来拉长回复，检查长消息在窗口化时的高度测量。'.repeat(40);
fixture.reply = () => longReply;

async function main() {
  const ui = await probe.start({ screens });
  const { js, until, api, mouse, send, click, capture } = ui;
  const provider = await api('settings.createProvider', { name: 'DeepSeek 直连', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] });
  await api('settings.setKey', { providerId: provider.id, apiKey: 'r16-long-fake-key' });
  const room = await api('rooms.createRoom', { name: '长历史', objective: '' });
  for (const [index, name] of ['起草者', '审查者', '综合者'].entries()) {
    await api('rooms.createAgent', { roomId: room.id, displayName: name, roleTemplateId: '成员', systemPrompt: '', providerId: provider.id, modelId: 'deepseek-flash', enabled: true, displayOrder: index });
  }
  // Setup through the same trusted IPC the UI uses: a step-mode Run, then 1000 host interjections of mixed length.
  const run = await api('run.start', { roomId: room.id, task: '长历史阅读测量', mode: 'step', maxTurns: 64 });
  await until(`window.roundtable.run.getSnapshot(${JSON.stringify(run.runId)}).then(s => s.status === 'paused')`, 'first turn paused', 60000);
  const started = Date.now();
  await js(`(async () => {
    const runId = ${JSON.stringify(run.runId)};
    for (let index = 0; index < ${INTERJECTIONS}; index++) {
      const content = index % 10 === 0 ? '第 ' + index + ' 条主持人补充：\\n\\n- 要点一\\n- 要点二\\n\\n' + '较长的说明。'.repeat(20) : '第 ' + index + ' 条主持人插话';
      await window.roundtable.host.command({ runId, clientRequestId: crypto.randomUUID(), kind: 'interject', content });
    }
    return true;
  })()`);
  result.setupMs = Date.now() - started;
  await js(`localStorage.setItem('roundtable.runId', ${JSON.stringify(run.runId)}); location.reload(); true`);
  const openStarted = Date.now();
  await until(`document.querySelector('.thread-list[data-virtual]') && document.body.innerText.includes('第 999 条主持人插话')`, 'long history opened at the latest message', 60000);
  result.openMs = Date.now() - openStarted;
  await ui.ensureLocator();
  const snapshot = await ui.runSnapshot();
  check(snapshot.messages.length >= 1000, `Run has ${snapshot.messages.length} public messages (≥ 1000)`);
  const dom = () => js(`({ items: document.querySelectorAll('.thread-item').length, nodes: document.querySelectorAll('*').length,
    atBottom: (() => { const s = document.querySelector('.timeline-scroll'); return s.scrollHeight - s.scrollTop - s.clientHeight < 48; })() })`);
  result.dom = { opened: await dom() };
  check(result.dom.opened.items < 80, `Opened with ${result.dom.opened.items} rendered messages of ${snapshot.messages.length}`);

  // Stream the next reply every 32ms (60 chunks) and watch frames while reading at the bottom.
  fixture.chunkMs = 32; fixture.chunks = 400; // about 13 s of streaming, longer than all the reading checks below
  await js(`window.__frames = []; (function tick(last) { requestAnimationFrame(now => { window.__frames.push(now - last); if (window.__frames.length < 100000) tick(now); }); })(performance.now()); true`);
  await click('下一步');
  await until(`[...document.querySelectorAll('.thread-item')].at(-1)?.innerText.includes('拉长回复')`, 'streaming reply visible', 30000);
  await sleep(800);
  result.dom.streamingAtBottom = await dom();
  check(result.dom.streamingAtBottom.atBottom && result.dom.streamingAtBottom.items < 80, 'Streaming at the bottom: follows, DOM bounded');

  // Scroll up with the real mouse wheel while the reply keeps streaming; the anchor must not move.
  const box = await js(`(() => { const r = document.querySelector('.timeline-scroll').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  for (let index = 0; index < 30; index++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -1500 }); await sleep(30); }
  await sleep(600);
  const anchor = await js(`(() => { const s = document.querySelector('.timeline-scroll'); const top = s.getBoundingClientRect().top;
    const item = [...document.querySelectorAll('.thread-item')].find(e => e.getBoundingClientRect().top >= top); return { key: item.dataset.key, top: item.getBoundingClientRect().top, text: item.innerText.slice(0, 20) }; })()`);
  await sleep(1500);
  const drift = await js(`(() => { const e = [...document.querySelectorAll('.thread-item')].find(e => e.dataset.key === ${JSON.stringify(anchor.key)}); return e ? e.getBoundingClientRect().top - ${anchor.top} : null; })()`);
  result.anchor = { ...anchor, driftPx: drift };
  check((await ui.status()).includes('运行中'), 'The reply was still streaming while the anchor was measured');
  check(drift !== null && Math.abs(drift) <= 2, `Reading up: the anchored message moved ${drift}px while the reply streamed`);
  check(await js(`!!document.querySelector('.jump-latest')`), 'The new-content pill is shown while reading older messages');
  result.dom.readingUp = await dom();
  check(result.dom.readingUp.items < 80, 'DOM bounded while reading up');
  await capture('long-history-reading', '长历史：向上翻阅时流式输出继续，页面不动，下方出现“有新消息 · 回到最新”');

  // Select text in an old message: still no jump.
  await js(`(() => { const p = [...document.querySelectorAll('.thread-item .bubble, .thread-item .md p')][2]; const range = document.createRange(); range.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(range); return true; })()`);
  const selectedTop = await js(`document.querySelector('.timeline-scroll').scrollTop`);
  await sleep(1000);
  const selectedAfter = await js(`document.querySelector('.timeline-scroll').scrollTop`); const selectedStatus = await ui.status();
  check(Math.abs(selectedAfter - selectedTop) <= 2 && selectedStatus.includes('运行中'), `Selecting text keeps the position while the reply streams (${selectedTop} → ${selectedAfter}, ${selectedStatus})`);
  await js(`getSelection().removeAllRanges(); true`);

  // Back to the latest with the pill.
  const pill = await js(`(() => { const r = document.querySelector('.jump-latest').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await mouse(pill.x, pill.y);
  await until(`(() => { const s = document.querySelector('.timeline-scroll'); return s.scrollHeight - s.scrollTop - s.clientHeight < 48; })()`, 'back at the latest', 10000);
  check(await js(`[...document.querySelectorAll('.thread-item')].at(-1).innerText.includes('拉长回复')`), 'The streaming reply is in view again');
  await until(`document.querySelector('[role=status][aria-label="运行状态"]').textContent.includes('已暂停')`, 'reply finished', 60000);

  const frames = await js(`window.__frames.slice(5)`);
  frames.sort((a, b) => a - b);
  const pick = q => Math.round(frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] * 10) / 10;
  result.frames = { count: frames.length, p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), max: Math.round(frames.at(-1)) };
  check(result.frames.p95 < 50, `Frame gap p95 ${result.frames.p95}ms while streaming over ${snapshot.messages.length} messages`);
  result.messages = snapshot.messages.length;
  console.log('R16_LONGHISTORY_METRICS ' + JSON.stringify({ messages: result.messages, setupMs: result.setupMs, openMs: result.openMs, dom: result.dom, anchor: result.anchor, frames: result.frames }));
  await ui.finish();
}
main().catch(probe.fail);
