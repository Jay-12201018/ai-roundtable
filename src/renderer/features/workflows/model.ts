import { DEFAULT_RUN_DURATION_MINUTES } from '../../../shared/schemas/workflow';
import { DEFAULT_OUTPUT_TOKEN_LIMIT } from '../../../shared/schemas/run';

export type WorkflowTemplate = 'free-chat' | 'two-model-dialogue' | 'review-revision' | 'deep-debate';
/** D149: 群聊 is how a room talks by default. It has no plan to edit, so it is a mode and not one of the templates. */
export type DiscussionMode = WorkflowTemplate | 'group-chat';
export const groupChatMode = { id: 'group-chat' as const, label: '群聊', description: '像同事群聊：你说一句，相关的人接话，有人说着也能插嘴。谁接由程序判断，拿不准时问一下快模型（用量很少，计入用量页）。' };
export type WorkflowMember = { id: string; name: string; enabled: boolean; role?: string };
/** The editable form of a discussion mode; ids are room members, numbers stay text while typed. */
export type WorkflowDraft = {
  template: WorkflowTemplate;
  phases: Array<{ key: string; title: string; participants: string[]; repeat: string }>;
  turnLimit: string; durationMinutes: string; outputTokens: string; finishAt: string;
};
export type WorkflowProgress = {
  runLabel: string; status: string; completedTurns: number; totalTurns: number; elapsedMs: number;
  currentStage: string; nextStep: string; limitReason?: string;
  stages: Array<{ id: string; label: string; status: string; completedTurns: number; totalTurns: number }>;
};

export const templates: Array<{ id: WorkflowTemplate; label: string; description: string; steps: number }> = [
  { id: 'free-chat', label: '自由讨论', description: '全员按顺序轮流发言，适合发散。', steps: 3 },
  { id: 'two-model-dialogue', label: '双人对话', description: '两位成员来回讨论一个问题。', steps: 2 },
  { id: 'review-revision', label: '审查修订链', description: '起草者写、审查者挑错，修订复审后定稿。', steps: 5 },
  { id: 'deep-debate', label: '深度辩论', description: '各自立论 → 两轮交锋 → 总结。', steps: 4 },
];
export const templateLabel = (id: DiscussionMode) => id === 'group-chat' ? groupChatMode.label : templates.find(item => item.id === id)!.label;
/** With no mode chosen every member speaks once, three turns at least; Main decides the same when the Run starts. */
export const defaultModeLabel = (members = 0) => `自由讨论 · ${Math.max(3, members)} 回合`;

const drafter = /起草|草稿|撰写|执笔|draft|writer|author/iu;
const reviewer = /审查|审阅|评审|审核|批评|质疑|review|critic/iu;
/** Finite defaults per template; the review chain picks the members whose role says 起草 / 审查 when there are any. */
export function createWorkflowDraft(template: WorkflowTemplate, members: readonly WorkflowMember[]): WorkflowDraft {
  const enabled = members.filter(m => m.enabled);
  const ids = enabled.map(m => m.id);
  const pick = (pattern: RegExp, fallback: number) => enabled.find(m => pattern.test(`${m.role ?? ''} ${m.name}`))?.id ?? ids[fallback] ?? '';
  const one = (key: string, title: string, participants: string[], repeat = '1') => ({ key, title, participants, repeat });
  const writer = pick(drafter, 0); const critic = enabled.find(m => m.id !== writer && reviewer.test(`${m.role ?? ''} ${m.name}`))?.id ?? ids.find(id => id !== writer) ?? '';
  const phases = template === 'review-revision' ? [
    one('draft', '起草', [writer]), one('review', '审查', [critic]),
    one('revise', '修订', [writer]), one('rereview', '复审', [critic]), one('finalize', '定稿', [writer]),
  ] : template === 'deep-debate' ? [one('opening', '立论', [...ids]), one('rebuttal', '交锋', [...ids], '2'), one('closing', '总结', [...ids])]
    : template === 'two-model-dialogue' ? [one('dialogue', '对话', [ids[0] ?? '', ids[1] ?? ''], '2')]
      : [one('discussion', '轮流发言', ids.length ? [...ids] : [''])];
  // A bigger room needs room to finish: the turn limit grows with the turns, so the default flow always fits.
  const turns = turnsOf(phases);
  return { template, phases, turnLimit: String(Math.max(12, turns)), durationMinutes: String(DEFAULT_RUN_DURATION_MINUTES), outputTokens: String(DEFAULT_OUTPUT_TOKEN_LIMIT), finishAt: '' };
}
export const turnsOf = (phases: WorkflowDraft['phases']) => phases.reduce((total, phase) => total + phase.participants.filter(Boolean).length * (Number(phase.repeat) || 1), 0);

export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 8;
/** 双人对话 and the review chain take exactly two: the chain's writer and reviewer are all createWorkflowDraft assigns. */
export const isFixedPair = (template: DiscussionMode) => template === 'two-model-dialogue' || template === 'review-revision';

/** Who speaks: the members a remembered flow names, or everyone taking part. By display order. */
export function speakersOf<T extends WorkflowMember | { id: string; enabled: boolean }>(draft: WorkflowDraft | undefined, members: readonly T[]): T[] {
  if (!draft) return members.filter(member => member.enabled);
  const end = draft.finishAt ? draft.phases.findIndex(phase => phase.key === draft.finishAt) : -1;
  const named = new Set(draft.phases.slice(0, end >= 0 ? end + 1 : undefined).flatMap(phase => phase.participants));
  return members.filter(member => named.has(member.id));
}
/** The review chain reads by who writes first, whatever the room's order is. */
export function speakingOrder<T extends { id: string }>(speakers: readonly T[], draft: WorkflowDraft | undefined): T[] {
  if (draft?.template !== 'review-revision') return [...speakers];
  const first = draft.phases[0]?.participants[0];
  return [...speakers].sort((a, b) => Number(b.id === first) - Number(a.id === first));
}

/** Which members a mode with this many takes: the first ones by display order, or the chain's writer and reviewer by their roles. */
export function participantsFor(template: DiscussionMode, members: readonly WorkflowMember[], count: number): string[] {
  if (template === 'review-revision') {
    const { phases } = createWorkflowDraft(template, members.map(member => ({ ...member, enabled: true })));
    return [phases[0]!.participants[0]!, phases[1]!.participants[0]!].filter(Boolean);
  }
  return members.slice(0, isFixedPair(template) ? 2 : count).map(member => member.id);
}

/** The sentence under the modes: what happens, how long, and in the chain who does what, named as they are. */
export function modeSummary(template: DiscussionMode, draft: WorkflowDraft | undefined, speakers: ReadonlyArray<WorkflowMember | { id: string; displayName: string }>): string {
  if (template === 'group-chat') return groupChatMode.description;
  const name = (id: string | undefined) => { const member = speakers.find(item => item.id === id) as { name?: string; displayName?: string } | undefined; return member?.displayName ?? member?.name; };
  const description = templates.find(item => item.id === template)!.description;
  const lead = template === 'review-revision' && name(draft?.phases[0]?.participants[0]) && name(draft?.phases[1]?.participants[0])
    ? `${name(draft!.phases[0]!.participants[0])}写、${name(draft!.phases[1]!.participants[0])}挑错，修订复审后定稿。` : description;
  const turns = draft ? turnsOf(draft.phases) : Math.max(3, speakers.length);
  return `${lead}共 ${turns} 回合。`;
}

/**
 * The flow that goes with a new mode or number of members. A default flow is simply made again. One the host has adjusted keeps
 * its stages and limits when the new members fit in it; when they cannot, it starts over and says so.
 */
export function nextDraft({ template, previous, previousMembers, members }: { template: DiscussionMode; previous: WorkflowDraft | undefined; previousMembers: readonly WorkflowMember[]; members: readonly WorkflowMember[] }): { draft: WorkflowDraft | null; notice?: string } {
  const fresh = template === 'free-chat' || template === 'group-chat' ? null : createWorkflowDraft(template, members);
  if (!previous || JSON.stringify(previous) === JSON.stringify(createWorkflowDraft(previous.template, previousMembers))) return { draft: fresh };
  if (previous.template !== template) return { draft: fresh, notice: `之前细调的流程不适用于「${templateLabel(template)}」，已换成它的默认流程。` };
  const before = speakersOf(previous, previousMembers).map(member => member.id);
  const enabled = members.filter(member => member.enabled).map(member => member.id);
  const added = enabled.filter(id => !before.includes(id));
  const phases = previous.phases.map(phase => ({ ...phase, participants: [...phase.participants.filter(id => enabled.includes(id)), ...(before.every(id => phase.participants.includes(id)) ? added : [])] }));
  const turns = turnsOf(phases);
  const kept: WorkflowDraft = { ...previous, phases, turnLimit: String(Math.max(Number(previous.turnLimit) || 0, turns)) };
  const everyoneSpeaks = enabled.every(id => speakersOf(kept, members).some(member => member.id === id));
  if (everyoneSpeaks && draftProblems(kept, members).length === 0) return { draft: kept };
  return { draft: fresh, notice: '之前细调的流程放不下现在的成员，已换回默认流程。' };
}

const positive = (text: string, max: number) => /^\d+$/u.test(text) && Number(text) >= 1 && Number(text) <= max;
/** What is wrong with a draft for the current members, in words; empty when Main may check it. */
export function draftProblems(draft: WorkflowDraft, members: readonly WorkflowMember[]): string[] {
  const problems: string[] = [];
  const named = (id: string) => members.find(member => member.id === id);
  const missing = [...new Set(draft.phases.flatMap(phase => phase.participants))].filter(id => !named(id)?.enabled);
  if (draft.phases.some(phase => phase.participants.length === 0 || phase.participants.includes(''))) problems.push('每个阶段都要有成员发言。');
  for (const id of missing.filter(Boolean)) problems.push(named(id) ? `「${named(id)!.name}」已停用或归档，请换一位成员。` : '有一位成员已经不在成员里，请换一位成员。');
  if (draft.template === 'two-model-dialogue' && new Set(draft.phases[0]?.participants).size !== 2) problems.push('双人对话需要两位不同的成员。');
  if (!positive(draft.turnLimit, 256)) problems.push('最多回合是 1–256 之间的整数。');
  if (!positive(draft.durationMinutes, 1440)) problems.push('时长上限是 1–1440 之间的整数分钟。');
  if (!positive(draft.outputTokens, 65536)) problems.push('单次发言上限是 1–65536 之间的整数。');
  if (draft.phases.some(phase => !positive(phase.repeat, 32))) problems.push('轮数是 1–32 之间的整数。');
  return problems;
}
