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
      if (label !== '【主持人插话】' && !member) throw new Error(`unknown label ${label}`);
      entries.push({
        role: 'user', speaker: member ? member[2] : '主持人', own: !!member?.[1], publicText: text,
        editedByHost: notes.some(note => note.includes('已由主持人修改')),
        basedOnRevisedHistory: notes.some(note => note.includes('写于主持人修改前序发言之前')),
        truncated: notes.some(note => note.includes('因单次输出上限被截断')),
      });
    }
  }
  if (task === undefined || cue === undefined) throw new Error('task and cue are required');
  const self = /现在由你（成员「([^「」]+)」·/u.exec(cue)?.[1];
  if (!self) throw new Error('cue must name the current member');
  for (const entry of entries) if (entry.role === 'assistant') entry.speaker = self;
  return { task, entries, cue };
}
