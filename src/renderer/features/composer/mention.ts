import type { RunSnapshot } from '../../../shared/types/run';
import { overrideCandidates, scheduledNext } from '../host/model';

export type MentionOption = { agentId: string; name: string; available: boolean; reason: string };

/** Everyone in the frozen roster, with whether Main would accept them as the next speaker and why not. */
export function mentionOptions(snapshot: RunSnapshot | undefined): MentionOption[] {
  const members = snapshot?.execution?.membersSnapshot ?? [];
  const allowed = new Set(overrideCandidates(snapshot).map(member => member.agentId));
  const current = snapshot?.host?.override?.agentId;
  const planned = scheduledNext(snapshot);
  return members.map(member => ({
    agentId: member.agentId, name: member.displayName, available: allowed.has(member.agentId),
    reason: current === member.agentId ? '已点名，排在下一回合' : !allowed.has(member.agentId) ? '不在当前阶段，按讨论方式现在不能点名'
      : planned === member.agentId ? '按计划就是下一位：只发插话，不多插一轮' : '点名后插入下一回合发言',
  }));
}

/** The `@query` being typed right before the caret, if any (a mention starts the text or follows whitespace). */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | undefined {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,24})$/u.exec(before);
  return match ? { start: before.length - match[2].length - 1, query: match[2] } : undefined;
}

/** D149: in a group chat an `@` may follow any word that is not Latin (请@小林): that is how Chinese is typed. */
export function chatMentionQuery(text: string, caret: number): { start: number; query: string } | undefined {
  const before = text.slice(0, caret);
  const match = /(^|[^A-Za-z0-9_.@＠-])[@＠]([^\s@＠]{0,24})$/u.exec(before);
  return match ? { start: before.length - match[2].length - 1, query: match[2] } : undefined;
}

/**
 * D4: which members the text names with `@名字`. Longer names win, so `@审查者` is not read as `@审查`.
 * Only whole names count; model text is never parsed for this — only what the host typed.
 */
export function mentionedMembers(text: string, options: readonly MentionOption[]): MentionOption[] {
  const sorted = [...options].sort((a, b) => b.name.length - a.name.length);
  const found: MentionOption[] = [];
  let rest = text;
  for (const option of sorted) {
    const token = `@${option.name}`;
    if (rest.includes(token)) { found.push(option); rest = rest.split(token).join(' '); }
  }
  return found;
}
/** The interjection left once the mentions are taken out; empty means the host only wanted to name someone. */
export const withoutMentions = (text: string, mentioned: readonly MentionOption[]) =>
  mentioned.reduce((value, option) => value.split(`@${option.name}`).join(''), text).trim();
