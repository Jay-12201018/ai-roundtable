import { groupChatScheduleOutputSchema, type GroupChatClassification, type GroupChatIntent, type GroupChatLength, type GroupChatSpeakerSource } from './schemas/groupChat';

/**
 * D150: the rules that decide who speaks without asking any model. Pure, so Main decides with them and the page can show the
 * same reading of `@` before sending. Only the host's words reach `classifyHostMessage`; a member's text is only ever read by
 * `memberHints`, whose result is a suggestion and never a place of its own.
 */
export type RosterMember = { agentId: string; displayName: string };
export type PlannedSpeaker = { agentId: string; intent: GroupChatIntent; length: GroupChatLength; source: GroupChatSpeakerSource; assignment?: string };
export type HostMessagePlan = { classification: GroupChatClassification; speakers: PlannedSpeaker[] };

const everyoneWords = ['所有人', '全体成员', '全体', '大家', 'all', 'everyone'];
const asciiWord = /[A-Za-z0-9_]/u;
const isAt = (char: string | undefined) => char === '@' || char === '＠';
const MAX_ASSIGNMENT_CHARS = 2000;

export type Mention = { agentId: string; name: string; start: number; end: number };
/**
 * Who the text names with `@名字`, in order, each once. A name may run straight into the next word (`@小林写前端`), so the longest
 * name that fits wins, and a name in Latin letters must end at a word boundary. An `@` right after a Latin word is an address, not a
 * mention. A name not in the room is simply not a mention.
 */
export function parseMentions(text: string, roster: readonly RosterMember[]): { mentions: Mention[]; everyone: boolean } {
  const names = [...roster].sort((a, b) => b.displayName.length - a.displayName.length);
  const mentions: Mention[] = []; let everyone = false;
  for (let index = 0; index < text.length; index++) {
    if (!isAt(text[index]) || index > 0 && /[A-Za-z0-9_.-]/u.test(text[index - 1])) continue;
    const rest = text.slice(index + 1);
    const fits = (name: string) => {
      if (!name || rest.slice(0, name.length).toLowerCase() !== name.toLowerCase()) return false;
      return !(asciiWord.test(name.at(-1)!) && asciiWord.test(rest[name.length] ?? ''));
    };
    const member = names.find(item => fits(item.displayName));
    if (member) {
      if (!mentions.some(item => item.agentId === member.agentId)) mentions.push({ agentId: member.agentId, name: member.displayName, start: index, end: index + 1 + member.displayName.length });
      continue;
    }
    if (everyoneWords.some(fits)) everyone = true;
  }
  return { mentions, everyone };
}

/** What the host asked of each person: the words after their `@`, up to the next one. Words before the first `@` go to everyone named. */
function assignmentsOf(text: string, mentions: readonly Mention[]): Map<string, string> {
  const lead = text.slice(0, mentions[0]?.start ?? 0).trim();
  const clean = (value: string) => value.replace(/^[\s,，、:：;；。.!！]+|[\s,，、;；]+$/gu, '').slice(0, MAX_ASSIGNMENT_CHARS);
  const result = new Map<string, string>();
  mentions.forEach((mention, index) => {
    const own = clean(text.slice(mention.end, mentions[index + 1]?.start ?? text.length));
    result.set(mention.agentId, [clean(lead), own].filter(Boolean).join(' '));
  });
  return result;
}

/** A small stable number from a string, so an order that should not look fixed is still repeatable. */
export function seedOf(value: string): number {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return hash >>> 0;
}
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const result = [...items]; let state = seed || 1;
  for (let index = result.length - 1; index > 0; index--) {
    state = Math.imul(state ^ state >>> 15, 2654435761) >>> 0;
    const other = state % (index + 1);
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

const plainWords = (text: string) => text.replace(/[\s\p{P}\p{S}]+/gu, '');
const gatherPatterns = [
  /^(大家|各位|同事们|伙计们|朋友们|诸位|全体|所有人|都)?(来)?(集合|开会|报到|签到|点名|冒泡|上线|露个面|出来|到齐了吗|都在吗|在吗|在不在|人呢|有人吗|有人在吗)(了|啦|吧|呀|一下)*(开会|一下|了|啦|吧|呀)*$/u,
  // 好 alone is someone agreeing; 大家好 is a greeting.
  /^(大家|各位|同事们|诸位)(好|早|早啊|早上好|上午好|中午好|下午好|晚上好|午安|晚安)(呀|啊|哇|啦)?$/u,
  /^(早上好|上午好|中午好|下午好|晚上好|午安|晚安)(呀|啊|哇|啦)?$/u,
  /^(hi|hello|hey|嗨|哈喽|你们好)(大家|各位|all|everyone)?$/iu,
];
/** A short call for everyone: 集合开会！, 都在吗, 大家好. Words that merely contain 集合 (集合论的讲义) are not one. */
export const isGather = (text: string) => { const words = plainWords(text); return words.length > 0 && words.length <= 16 && gatherPatterns.some(pattern => pattern.test(words)); };

const stopPattern = /^(大家|各位|你们|都|先)*(停止|停下来?|停一下|停一停|停|别说了|别聊了|别讲了|不用说了|不要说了|打住|先这样|暂停|stop)(吧|了|啦|呀|啊|哈|一下)*$/iu;
/** D154: the host telling everyone to stop, as the whole message. Words that go on (停止这个方案，换一个) are something to talk about. */
export const isStopMessage = (text: string) => stopPattern.test(plainWords(text));

const everyoneAddressed = /大家|你们|各位|诸位|每个人|每位|都说说|都讲讲|都谈谈|都聊聊|都来说/u;
const askingViews = /怎么看|怎么想|怎么样|如何|有什么(看法|想法|意见|建议)|有(没有)?(看法|想法|意见|建议)|(看法|想法|意见|建议)[吗呢?？]|觉得(呢|行|可以|合适|好|对|怎)|说说|讲讲|谈谈|聊聊|议一议|讨论|说一下|说一句|同意吗|赞成吗|行吗|可以吗|好吗/u;
/** D155: 大家怎么看: a question put to everyone. 大家都用手机 says something about them, and is not one. */
export const asksEveryone = (text: string) => everyoneAddressed.test(text) && askingViews.test(text);

const workWords = /写|做|实现|设计|方案|规划|计划|分析|整理|总结|列出|列个|生成|翻译|对比|比较|评估|调研|起草|重构|优化|修改|改一下|帮我|给我|出一份|出个|报告|文档|代码|清单|提纲/u;
const openWords = /为什么|为啥|怎么看|怎么办|怎么样|怎样|如何|建议|评价|看法|觉得|你看|应该|选哪|哪个好/u;
const questionMark = /[?？]\s*$/u;
const questionWords = /[吗么嘛呢]\s*$|几点|几号|几个|多少|是谁|谁|哪里|哪儿|什么时候|是不是|有没有|能不能|要不要|可不可以|吃什么|叫什么|是什么/u;
/** Asks for work to be delivered, rather than for a word. */
export const isTaskLike = (text: string) => text.length > 120 || workWords.test(text);
/** D154: 1, 好, 嗯, ok, ？: one or two characters that ask nothing. 继续 asks for more, and goes the usual way. */
export const isVeryShort = (text: string) => { const words = plainWords(text); return text.trim().length > 0 && words.length <= 2 && !/^(继续|接着)$/u.test(words) && !isTaskLike(text) && !openWords.test(text); };
/** A short question with one plain answer: 今天几号？ Anything that asks for a judgement or for work is not one. */
export const isSimpleQuestion = (text: string) => text.trim().length > 0 && text.trim().length <= 30 && !isTaskLike(text) && !openWords.test(text) && (questionMark.test(text) || questionWords.test(text));

function mentionLength(assignment: string): { intent: GroupChatIntent; length: GroupChatLength } {
  if (!assignment || isGather(assignment) || isSimpleQuestion(assignment)) return { intent: 'reply', length: 'short' };
  return isTaskLike(assignment) ? { intent: 'claim', length: 'long' } : { intent: 'reply', length: 'medium' };
}

/** What happens to a message when no model is asked: one or two speak; a request for work gets its delivery and a short answer to it. */
export function ruleSpeakers(text: string, roster: readonly RosterMember[], seed: number): PlannedSpeaker[] {
  const [first, second] = shuffled(roster, seed);
  if (!first) return [];
  const task = isTaskLike(text);
  const lead: PlannedSpeaker = { agentId: first.agentId, intent: task ? 'report' : 'reply', length: task ? 'long' : 'medium', source: 'rule' };
  return second ? [lead, { agentId: second.agentId, intent: task ? 'challenge' : 'reply', length: task ? 'short' : 'medium', source: 'rule' }] : [lead];
}

/** D150: the program's reading of one host message. `open` is the one case that may ask a model; it still has `ruleSpeakers` to fall back on. */
export function classifyHostMessage(text: string, roster: readonly RosterMember[], seed: number, hasImages = false): HostMessagePlan {
  const order = shuffled(roster, seed);
  const { mentions, everyone } = parseMentions(text, roster);
  if (mentions.length) {
    const assignments = assignmentsOf(text, mentions);
    return { classification: 'mention', speakers: mentions.map(mention => {
      const assignment = assignments.get(mention.agentId) ?? '';
      return { agentId: mention.agentId, ...mentionLength(assignment), source: 'mention' as const, ...(assignment ? { assignment } : {}) };
    }) };
  }
  if (everyone) {
    const task = isTaskLike(text);
    return { classification: 'mention', speakers: order.map(member => ({ agentId: member.agentId, intent: 'reply' as const, length: task ? 'medium' as const : 'short' as const, source: 'mention' as const })) };
  }
  if (isGather(text)) return { classification: 'gather', speakers: order.map(member => ({ agentId: member.agentId, intent: 'reply' as const, length: 'short' as const, source: 'gather' as const })) };
  if (asksEveryone(text)) return { classification: 'gather', speakers: order.map(member => ({ agentId: member.agentId, intent: 'reply' as const, length: 'medium' as const, source: 'rule' as const })) };
  // D154: one answer is enough, and two the same is worse than none. An image is something to look at, however short the words with it.
  if (isSimpleQuestion(text) || !hasImages && isVeryShort(text)) return { classification: 'simple', speakers: order.slice(0, 1).map(member => ({ agentId: member.agentId, intent: 'reply' as const, length: 'short' as const, source: 'rule' as const })) };
  return { classification: 'open', speakers: [] };
}

/**
 * D152, widened by D156: talk skips thinking where the catalog knows how: a quick word, and a few sentences of plain reply, which waited
 * ten seconds each when they thought. Doubting something, delivering it or summing it up always thinks, and so does anything long.
 */
export const skipsThinking = (speaker: { intent: GroupChatIntent; length: GroupChatLength }) =>
  speaker.length === 'short' ? !['challenge', 'report', 'claim'].includes(speaker.intent) : speaker.length === 'medium' && speaker.intent === 'reply';

/** Who a member's reply names. Only a suggestion for the schedule: it gives no place in the queue, and it is never the host speaking. */
export function memberHints(text: string, roster: readonly RosterMember[], selfId: string): string[] {
  return parseMentions(text, roster).mentions.map(mention => mention.agentId).filter(agentId => agentId !== selfId);
}

export type ScheduleOutput = { speakers: Array<{ agentId: string; intent: GroupChatIntent; length: GroupChatLength }>; more: boolean };
/**
 * Reads the scheduling model's answer: one JSON object, in a code fence or not. Every name must be someone in this room, once. Anything
 * else makes the whole answer invalid, so nothing a model writes can name a stranger or reach further than a place in the queue.
 */
export function parseScheduleOutput(text: string, roster: readonly RosterMember[]): ScheduleOutput | undefined {
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  let value: unknown;
  try { value = JSON.parse(text.slice(start, end + 1)); } catch { return undefined; }
  const parsed = groupChatScheduleOutputSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const speakers: ScheduleOutput['speakers'] = [];
  for (const speaker of parsed.data.speakers) {
    const member = roster.find(item => item.displayName === speaker.name);
    if (!member || speakers.some(item => item.agentId === member.agentId)) return undefined;
    speakers.push({ agentId: member.agentId, intent: speaker.intent, length: speaker.length });
  }
  return { speakers, more: parsed.data.more === true };
}
