import type { AgentConfiguration, CreateAgentInput, ProviderReadiness, ProviderSummary, RoomConfiguration, RoomManagementApiContract } from '../../../shared/contracts/configuration';
import { errorCodeSchema } from '../../../shared/schemas/error';

/**
 * D5-A: role templates only pre-fill the member form (name, role, 设定). D153: each is a colleague with a name and a character. 起草 / 审查 / 总结
 * also match Main's built-in speaking guidance by role name in the stricter flows (D095); the others rely on the 设定 text alone.
 */
export type RoleTemplate = { id: string; label: string; summary: string; name: string; role: string; prompt: string };
export const roleTemplates: RoleTemplate[] = [
  { id: 'product', label: '产品', summary: '林舟，稳重，先想值不值得做。', name: '林舟', role: '产品',
    prompt: '你叫林舟，是团队里的产品经理，性格稳重。先想用户要什么、值不值得做，再谈怎么做；拿主意时说清取舍。' },
  { id: 'engineer', label: '工程', summary: '阿哲，爱挑刺，先找漏洞和代价。', name: '阿哲', role: '工程',
    prompt: '你叫阿哲，是工程师，爱挑刺。看到方案先找漏洞：做不做得出来、哪里会出问题、代价多大。挑刺时给理由，也给改法。' },
  { id: 'summarizer', label: '总结', summary: '小雨，爱总结，帮大家理清楚。', name: '小雨', role: '总结',
    prompt: '你叫小雨，是团队里爱总结的同事。大家说散了就帮忙理一理：定了什么、还差什么、下一步谁做。不抢话。' },
  { id: 'drafter', label: '起草', summary: '阿成，手快，先拿出一版完整方案。', name: '阿成', role: '起草',
    prompt: '你叫阿成，手快，负责起草。先拿出一版完整、可以直接讨论的方案，写明关键假设和依据；之后根据审查意见修订，逐条说明是否采纳、为什么。' },
  { id: 'reviewer', label: '审查', summary: '老陆，严谨，找最关键的问题，不重写。', name: '老陆', role: '审查',
    prompt: '你叫老陆，做事严谨，负责审查。指出方案里最关键的 3 个问题，每个给出依据和改法；不要重写全文，不要重复别人说过的内容。' },
  { id: 'opponent', label: '反方', summary: '老周，爱唱反调，压力测试方案。', name: '老周', role: '反方',
    prompt: '你叫老周，爱唱反调。专门找方案站不住的地方：反例、最坏情况、被忽略的代价。每条说清楚为什么，并说明什么证据能让你改变看法；不要为了反对而反对。' },
  { id: 'fact-checker', label: '事实核查', summary: '小唐，较真，核对数字、出处和前提。', name: '小唐', role: '事实核查',
    prompt: '你叫小唐，很较真，负责事实核查。逐条核对前面发言里的数字、出处和前提，标出哪些有依据、哪些是推测、哪些可能有误；拿不准就直接说不确定，不要编造来源。' },
  { id: 'designer', label: '体验', summary: '苏苏，站在用户那边，看好不好用。', name: '苏苏', role: '体验',
    prompt: '你叫苏苏，做用户体验。总站在第一次用的人那边：看不看得懂、顺不顺手、哪一步会卡住。说具体的场景，不说空话。' },
  { id: 'custom', label: '自定义', summary: '自己写角色和设定。', name: '', role: '', prompt: '' },
];
export const starterTemplates = roleTemplates.slice(0, 3);
/** The role tag is redundant when the name already says it (审查者 · 审查). */
export const roleShown = (agent: Pick<AgentConfiguration, 'displayName' | 'roleTemplateId'>) => {
  const role = agent.roleTemplateId.trim();
  return role && !agent.displayName.includes(role) ? role : undefined;
};

/**
 * The model a new member gets (D5-A): the default service's default model, only when Main says it can be used now.
 * Otherwise none, and the member says “还没选模型” — never a silent switch to Mock.
 */
export function defaultModelFor(providers: readonly ProviderSummary[], readiness: readonly ProviderReadiness[] | undefined): { providerId: string; modelId: string; label: string } | undefined {
  const provider = providers.find(item => item.isDefault && item.enabled && item.configurationValid);
  if (!provider?.defaultModelId) return undefined;
  const row = readiness?.find(item => item.providerId === provider.id)?.models.find(model => model.modelId === provider.defaultModelId);
  if (!row?.usable) return undefined;
  const name = provider.customModels.find(model => model.id === provider.defaultModelId)?.name ?? provider.defaultModelId;
  return { providerId: provider.id, modelId: provider.defaultModelId, label: provider.kind === 'mock' ? '演示（Mock）' : name };
}

/** A room with the three default colleagues. Members already in a room never change. Not atomic: a failure after the room exists is reported. */
export async function createStarterRoom(api: RoomManagementApiContract, input: { name: string; objective?: string },
  model: { providerId: string; modelId: string } | undefined): Promise<RoomConfiguration> {
  const room = await api.createRoom({ name: input.name, objective: input.objective ?? '' });
  for (const [index, template] of starterTemplates.entries()) {
    await api.createAgent({ roomId: room.id, displayName: template.name, roleTemplateId: template.role, systemPrompt: template.prompt,
      providerId: model?.providerId ?? null, modelId: model?.modelId ?? null, enabled: true, displayOrder: index });
  }
  return room;
}

/** Fixed Chinese text per error code, never the error message itself. */
/** The next member a room grows by: the next role template it lacks, then plain numbered members. Its model is the default one, or none; the host picks. */
export function nextMemberInput(roomId: string, members: readonly AgentConfiguration[], model: { providerId: string; modelId: string } | undefined): CreateAgentInput {
  const template = roleTemplates.filter(item => item.id !== 'custom').find(item => !members.some(member => member.roleTemplateId === item.role || member.displayName === item.name));
  let number = members.length + 1;
  while (members.some(member => member.displayName === `成员 ${number}`)) number++;
  return { roomId, displayName: template?.name ?? `成员 ${number}`, roleTemplateId: template?.role ?? '讨论', systemPrompt: template?.prompt ?? '',
    providerId: model?.providerId ?? null, modelId: model?.modelId ?? null, enabled: true, displayOrder: members.length ? Math.max(...members.map(member => member.displayOrder)) + 1 : 0 };
}

/** What updateAgent takes, from what the page holds. */
export const agentInput = (agent: AgentConfiguration) => { const { archivedAt: _a, createdAt: _c, updatedAt: _u, withheldModelId: _w, builtInDemo: _d, ...rest } = agent; return rest; };

export function roomErrorText(error: unknown): string {
  const value = error && typeof error === 'object' ? error as { code?: unknown; detail?: { code?: unknown } } : undefined;
  const parsed = errorCodeSchema.safeParse(value?.detail?.code ?? value?.code);
  switch (parsed.success ? parsed.data : 'internal_error') {
    case 'invalid_input': return '有一项填写不对，请检查后再试。';
    case 'not_found': return '这条记录已经不存在，请刷新后再试。';
    case 'invalid_state': return '现在不能这样做：可能有讨论正在进行，或已有讨论记录引用了它。有记录的可以归档。';
    case 'unsupported': return '这个服务或模型还不能这样使用。';
    case 'transport_error': return '连接失败，请重试。';
    default: return '操作失败，请重试。';
  }
}
