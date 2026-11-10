// Group-chat regression against REAL models, in the trial profile (never the real one): a fixed set of scripted conversations, each
// checked for who answered and how. It spends the tokens of whatever services the chosen room's members use, so it does nothing without
// `--paid-ok`. It never reads or prints a key: it starts the trial app exactly as `pnpm trial` does and talks to it through the page's own
// restricted API, like a host typing.
//
//   electron scripts/trial/regress.cjs --room-id <id> --paid-ok [--only <name,name>] [--out <report.md>]
//
// Without --paid-ok it lists the conversations and exits. Exit codes: 0 every check passed; 1 some failed; 2 usage or setup.
const fs = require('node:fs');
const { join } = require('node:path');
const { app, BrowserWindow } = require('electron');

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const paid = args.includes('--paid-ok');
const only = (option('--only') ?? '').split(',').filter(Boolean);
const roomId = option('--room-id');

const promise = /明天|明早|稍后|晚点|回头(给|发)|[0-9一二三两几半]+\s*(天|周|个?小时|分钟)(内|后|就|能|可以|左右)?(给|出|搞定|做完|完成|交)/u;
const few = (max, chars) => step => step.speakers.length >= 1 && step.speakers.length <= max && (!chars || step.replies.every(text => text.length <= chars));
/** Each conversation: host messages in order; `expect` returns true, or a string saying what was wrong. `stopAfterFirstWords` sends 停止 mid-reply. */
const conversations = [
  { name: 'gather-then-chat', steps: [
    { say: '集合开会！', expect: step => step.speakers.length === step.roster.length && step.replies.every(text => text.length <= 60) || '集合应该每人一句短的' },
    { say: '今天有点累', expect: step => few(2, 120)(step) || '闲聊应该一两个人轻松回一句' },
    { say: '？', expect: step => few(1, 80)(step) || '一个问号最多一个人短回' }] },
  { name: 'simple-question', steps: [
    { say: '登录用手机号还是邮箱好？', expect: step => few(2, 300)(step) || '随口一问一两个人回答就够' }] },
  { name: 'everyone-then-follow-up-then-new-topic', steps: [
    { say: '这个方向大家怎么看：做一个校园二手平台', expect: step => step.speakers.length === step.roster.length || '问大家应该每个人都回应' },
    { say: '那先做哪个功能', expect: step => step.relation === 'follow_up' && few(3)(step) || `应读成 follow_up，实际 ${step.relation}` },
    { say: '换个话题，周末团建去哪比较好', expect: step => step.relation === 'new_topic' && step.replies.every(text => !/二手/u.test(text)) || `应读成 new_topic 且不再提二手，实际 ${step.relation}` }] },
  { name: 'assign-two-then-correct-one', steps: [
    { say: '@林舟 用三句话写个产品简介，@阿哲 用三句话说技术选型', expect: step => step.speakers.join() === '林舟,阿哲' && step.intents.every(intent => intent === 'claim') && step.replies.every(text => !promise.test(text) && !/[?？]\s*$/u.test(text.trim())) || `应只有两位、直接交付、不报工期，实际 ${step.speakers.join()} ${step.intents.join()}` },
    { say: '林舟写的太空了，不太对', expect: step => step.relation === 'correction' && step.speakers.includes('林舟') || `应读成 correction 并让林舟复核，实际 ${step.relation} ${step.speakers.join()}` }] },
  { name: 'ask-one-then-why', steps: [
    { say: '@阿哲 你觉得最大的技术风险是什么', expect: step => step.speakers.join() === '阿哲' || '只应阿哲回答' },
    { say: '为什么', expect: step => step.relation === 'follow_up' && step.speakers.includes('阿哲') && step.speakers.length <= 2 || `应读成 follow_up 并由阿哲接着答，实际 ${step.relation} ${step.speakers.join()}` },
    { say: '@小雨 总结一下', expect: step => step.speakers.join() === '小雨' && step.intents[0] === 'summarize' || `应是小雨做总结，实际 ${step.speakers.join()} ${step.intents.join()}` }] },
  { name: 'stop-then-carry-on', steps: [
    { say: '@林舟 @阿哲 @小雨 各用两三句话介绍一下自己的分工', stopAfterFirstWords: true, expect: step => step.stopped || '应该被停止打断' },
    { say: '刚才说到哪了，你们接着来', expect: step => step.relation === 'resume' && step.speakers.length >= 2 || `应读成 resume 并把没说完的人接上，实际 ${step.relation} ${step.speakers.join()}` }] },
  { name: 'nothing-to-go-on', steps: [
    { say: '上周用户调研的结论是什么', expect: step => step.replies.every(text => /没有|没看到|不知道|没见过|不清楚|没提|哪份|哪个|未提供|没发/u.test(text) && !/\d+\s*%/u.test(text) && !/我(去|来|回头)(问|要|找|查|看|确认)/u.test(text)) || '没有依据的事应该说不知道，不能编数字，也不能说“我去要来看”' }] },
  { name: 'how-long', steps: [
    { say: '@阿哲 后端这块什么时候能给我', expect: step => step.replies.every(text => !promise.test(text)) || '不应该许诺时间或报工期' }] },
];

if (!paid || !roomId) {
  console.log(`群聊回归：${conversations.length} 段对话，共 ${conversations.reduce((sum, item) => sum + item.steps.length, 0)} 条主持人消息。会调用所选讨论组成员的真实模型并产生费用。`);
  for (const item of conversations) console.log(`- ${item.name}: ${item.steps.map(step => step.say).join(' → ')}`);
  console.log('确认后运行：electron scripts/trial/regress.cjs --room-id <讨论组 id> --paid-ok');
  process.exit(paid && !roomId ? 2 : 0);
}

// The trial bootstrap, unchanged: it isolates every path before the app is ready and refuses the real profile.
require('./main.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function page() {
  for (let tries = 0; tries < 120; tries++) {
    const window = BrowserWindow.getAllWindows()[0];
    if (window && !window.webContents.isLoading() && await window.webContents.executeJavaScript('typeof window.roundtable === "object"').catch(() => false)) return window.webContents;
    await sleep(250);
  }
  throw new Error('The trial window did not load.');
}
const call = (contents, path, input) => contents.executeJavaScript(`(async () => { const value = await window.roundtable.${path}(${JSON.stringify(input)}); return JSON.parse(JSON.stringify(value ?? null)); })()`);
const unwrap = value => value && typeof value === 'object' && 'ok' in value ? (value.ok ? value.data ?? value.value : Promise.reject(new Error(JSON.stringify(value.error)))) : value;

async function main() {
  const contents = await page();
  const snapshotOf = async runId => unwrap(await call(contents, 'run.getSnapshot', runId));
  const settled = async (runId, timeoutMs = 300000) => {
    const end = Date.now() + timeoutMs; let quiet = 0; let snapshot;
    while (Date.now() < end) {
      snapshot = await snapshotOf(runId);
      const round = snapshot.groupChat?.round;
      quiet = snapshot.status !== 'running' && !(round && (round.state === 'open' || round.scheduling)) ? quiet + 1 : 0;
      if (quiet >= 2) return snapshot;
      await sleep(400);
    }
    throw new Error('Timed out waiting for the chat to settle.');
  };
  const results = []; let counter = 0;
  for (const conversation of conversations.filter(item => !only.length || only.includes(item.name))) {
    let runId; let seenTurns = 0; let seenSchedules = 0;
    for (const step of conversation.steps) {
      const started = Date.now();
      try {
        if (!runId) runId = unwrap(await call(contents, 'run.start', { roomId, task: step.say, workflowSnapshot: { templateId: 'group-chat', version: 1 } })).runId;
        else unwrap(await call(contents, 'host.command', { kind: 'interject', runId, clientRequestId: `regress-${Date.now()}-${++counter}`, content: step.say }));
        let stopped = false;
        if (step.stopAfterFirstWords) {
          for (let tries = 0; tries < 300 && !stopped; tries++) {
            const now = await snapshotOf(runId);
            if (now.turns.slice(seenTurns).some(turn => (now.messages.find(message => message.id === turn.messageId)?.content ?? turn.outputText ?? '').length > 0)) {
              unwrap(await call(contents, 'host.command', { kind: 'interject', runId, clientRequestId: `regress-${Date.now()}-${++counter}`, content: '停止' })); stopped = true;
            } else await sleep(150);
          }
        }
        const snapshot = await settled(runId);
        const members = snapshot.execution?.membersSnapshot ?? [];
        const turns = snapshot.turns.slice(seenTurns); seenTurns = snapshot.turns.length;
        const name = agentId => members.find(member => member.agentId === agentId)?.displayName ?? '?';
        const replyOf = turn => snapshot.messages.find(message => message.id === turn.messageId)?.content ?? turn.outputText ?? '';
        const facts = { roster: members.map(member => member.displayName), speakers: turns.map(turn => name(turn.agentId)), statuses: turns.map(turn => turn.status), replies: turns.map(replyOf), stopped,
          failed: turns.filter(turn => turn.status === 'failed').length, seconds: Math.round((Date.now() - started) / 1000), runId, scheduleFrom: seenSchedules };
        seenSchedules = snapshot.groupChat?.scheduleRequestIds?.length ?? seenSchedules;
        results.push({ conversation: conversation.name, say: step.say, step, facts, scheduleTo: seenSchedules });
      } catch (error) {
        results.push({ conversation: conversation.name, say: step.say, step, error: error instanceof Error ? error.message : String(error) });
        break;
      }
    }
  }
  // What the reading said is in the database, not in the page's snapshot. Read only, after everything has settled.
  const Database = require('better-sqlite3');
  const db = new Database(join(app.getPath('userData'), 'ai-roundtable.db'), { readonly: true, fileMustExist: true });
  const lines = []; let failures = 0;
  for (const result of results) {
    if (result.error) { failures++; lines.push(`| ${result.conversation} | ${result.say} | 出错 | ${result.error.slice(0, 200)} |`); continue; }
    const rounds = db.prepare('SELECT r.id FROM group_chat_rounds r JOIN messages m ON m.id=r.message_id WHERE r.run_id=? AND m.content=? ORDER BY r.created_at DESC LIMIT 1').pluck().all(result.facts.runId, result.say);
    const first = db.prepare("SELECT id FROM group_chat_rounds WHERE run_id=? AND message_id IS NULL ORDER BY created_at ASC LIMIT 1").pluck().get(result.facts.runId);
    const roundId = rounds[0] ?? first;
    const output = roundId ? db.prepare("SELECT output_text FROM group_chat_schedule_requests WHERE round_id=? AND status='completed' ORDER BY created_at ASC LIMIT 1").pluck().get(roundId) : undefined;
    let reading = {}; try { reading = output ? JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1)) : {}; } catch { reading = {}; }
    const speakers = roundId ? db.prepare("SELECT s.intent,s.length,s.source FROM group_chat_speakers s WHERE s.round_id=? AND s.state='started' ORDER BY s.position").all(roundId) : [];
    const facts = { ...result.facts, relation: reading.relation, topic: reading.topic, read: output !== undefined, intents: speakers.map(item => item.intent), lengths: speakers.map(item => item.length) };
    let verdict; try { verdict = result.step.expect(facts); } catch (error) { verdict = `检查出错：${error.message}`; }
    const passed = verdict === true && facts.failed === 0;
    if (!passed) failures++;
    const said = facts.speakers.map((speaker, index) => `${speaker}(${facts.intents[index] ?? '?'}/${facts.lengths[index] ?? '?'}/${facts.replies[index].length}字)`).join('、') || '无人';
    lines.push(`| ${result.conversation} | ${result.say} | ${passed ? '通过' : '**不符**'} | 读解：${facts.read ? `${facts.relation ?? '无关系'}｜${facts.topic ?? '无话题'}` : '没有（走规则）'}；发言：${said}；${facts.seconds} 秒${facts.failed ? `；${facts.failed} 次失败` : ''}${passed ? '' : `；${verdict === true ? '有发言失败' : verdict}`} |`);
    for (const [index, text] of facts.replies.entries()) lines.push(`| | | | ${facts.speakers[index]}：${text.replace(/\s+/gu, ' ').replace(/\|/gu, '｜').slice(0, 160)} |`);
  }
  db.close();
  const report = ['| 对话 | 主持人说 | 结果 | 详情 |', '|---|---|---|---|', ...lines, '', `共 ${results.length} 条，${failures} 条不符。`].join('\n');
  const out = option('--out');
  if (out) fs.writeFileSync(out, report + '\n'); else console.log(report);
  console.log(`REGRESS_DONE ${JSON.stringify({ steps: results.length, failures })}`);
  return failures;
}

app.whenReady().then(() => main()).then(failures => app.exit(failures ? 1 : 0)).catch(error => { console.error(`REGRESS_FAILED ${error instanceof Error ? error.message : String(error)}`); app.exit(2); });
