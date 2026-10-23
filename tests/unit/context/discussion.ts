import type { ProviderMessage } from '../../../src/main/providers/types';

export interface ParsedEntry {
  role: 'user' | 'assistant';
  /** Display name for members (own included), '主持人' for host interjections. */
  speaker: string;
  own: boolean;
  publicText: string;
  editedByHost: boolean;
  basedOnRevisedHistory: boolean;
  truncated: boolean;
  /** R13B: a host-confirmed summary standing in for public messages first..last. */
  summary?: { first: number; last: number };
  /** D109: a covered message revised after the summary, sent itself right after it. */
  revisedAfterSummary?: boolean;
}

/**
 * Strict reader of the D095 discussion format used by tests: every history block must be one application label,
 * optional application notes and a fully quoted body. Anything else throws, so a format drift cannot pass silently.
 */
export function parseDiscussion(messages: readonly ProviderMessage[]): { task: string; entries: ParsedEntry[]; cue: string } {
  const chat = messages.filter(message => message.role !== 'system');
  if (chat[0]?.role !== 'user' || chat.at(-1)?.role !== 'user') throw new Error('discussion must start and end with user');
  chat.forEach((message, index) => { if (index && chat[index - 1].role === message.role) throw new Error('roles must alternate'); });
  let task: string | undefined; let cue: string | undefined;
  const entries: ParsedEntry[] = [];
  for (const message of chat) {
    if (message.role === 'assistant') {
      entries.push({ role: 'assistant', speaker: '', own: true, publicText: message.content, editedByHost: false, basedOnRevisedHistory: false, truncated: false });
      continue;
    }
    for (const block of message.content.split('\n\n')) {
      const [label, ...rest] = block.split('\n');
      if (label === '【轮到你发言】') { if (cue !== undefined) throw new Error('second cue'); cue = rest.join('\n'); continue; }
      const notes = rest.filter(line => line.startsWith('（'));
      const body = rest.slice(notes.length);
      if (rest.slice(0, notes.length).some(line => !line.startsWith('（')) || body.some(line => !line.startsWith('>'))) {
        throw new Error(`unquoted line in block ${label}`);
      }
      const text = body.map(line => line === '>' ? '' : line.replace(/^> /u, '')).join('\n');
      if (label === '【讨论任务 · 主持人设定】') { task = text; continue; }
      const member = /^【(你此前的发言 · )?成员「([^「」【】]+)」· [^【】]+】$/u.exec(label);
      const summary = /^【讨论摘要 · 覆盖第 (\d+)–(\d+) 条，由主持人确认】$/u.exec(label);
      if (label !== '【主持人插话】' && !member && !summary) throw new Error(`unknown label ${label}`);
      entries.push({
        role: 'user', speaker: member ? member[2] : summary ? '讨论摘要' : '主持人', own: !!member?.[1], publicText: text,
        editedByHost: notes.some(note => note.includes('已由主持人修改') || note.includes('由主持人修改后确认')),
        basedOnRevisedHistory: notes.some(note => note.includes('写于主持人修改前序发言之前') || note.includes('它覆盖的部分发言被主持人修改或重新生成')),
        truncated: notes.some(note => note.includes('因单次输出上限被截断')),
        ...(summary ? { summary: { first: Number(summary[1]), last: Number(summary[2]) } } : {}),
        ...(notes.some(note => note.includes('在上面的摘要生成后由主持人修改或重新生成')) ? { revisedAfterSummary: true } : {}),
      });
    }
  }
  if (task === undefined || cue === undefined) throw new Error('task and cue are required');
  const self = /现在由你（成员「([^「」]+)」·/u.exec(cue)?.[1];
  if (!self) throw new Error('cue must name the current member');
  for (const entry of entries) if (entry.role === 'assistant') entry.speaker = self;
  return { task, entries, cue };
}
