import { DEFAULT_OUTPUT_TOKEN_LIMIT } from '../../../shared/schemas/run';

export type WorkflowTemplate = 'free-chat' | 'two-model-dialogue' | 'review-revision' | 'deep-debate';
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
  { id: 'review-revision', label: '审查修订链', description: '起草 → 审查 → 修订 → 复审 → 定稿。', steps: 5 },
  { id: 'deep-debate', label: '深度辩论', description: '各自立论 → 两轮交锋 → 总结。', steps: 4 },
];
export const templateLabel = (id: WorkflowTemplate) => templates.find(item => item.id === id)!.label;
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
  return { template, phases, turnLimit: '12', durationMinutes: '5', outputTokens: String(DEFAULT_OUTPUT_TOKEN_LIMIT), finishAt: '' };
}

const positive = (text: string, max: number) => /^\d+$/u.test(text) && Number(text) >= 1 && Number(text) <= max;
/** What is wrong with a draft for the current members, in words; empty when Main may check it. */
export function draftProblems(draft: WorkflowDraft, members: readonly WorkflowMember[]): string[] {
  const problems: string[] = [];
  const named = (id: string) => members.find(member => member.id === id);
  const missing = [...new Set(draft.phases.flatMap(phase => phase.participants))].filter(id => !named(id)?.enabled);
  if (draft.phases.some(phase => phase.participants.length === 0 || phase.participants.includes(''))) problems.push('每个阶段都要有成员发言。');
  for (const id of missing.filter(Boolean)) problems.push(named(id) ? `「${named(id)!.name}」已停用或归档，请换一位成员。` : '有一位成员已经不在这个房间里，请换一位成员。');
  if (draft.template === 'two-model-dialogue' && new Set(draft.phases[0]?.participants).size !== 2) problems.push('双人对话需要两位不同的成员。');
  if (!positive(draft.turnLimit, 256)) problems.push('最多回合是 1–256 之间的整数。');
  if (!positive(draft.durationMinutes, 1440)) problems.push('时长上限是 1–1440 之间的整数分钟。');
  if (!positive(draft.outputTokens, 65536)) problems.push('单次发言上限是 1–65536 之间的整数。');
  if (draft.phases.some(phase => !positive(phase.repeat, 32))) problems.push('轮数是 1–32 之间的整数。');
  return problems;
}
