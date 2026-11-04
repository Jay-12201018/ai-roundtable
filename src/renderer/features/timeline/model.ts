import type { ProviderSummary } from '../../../shared/contracts/configuration';
import type { RequestUsage } from '../../../shared/schemas/usage';
import type { RunSnapshot } from '../../../shared/types/run';
import type { MemberSnapshot } from '../../../shared/schemas/persistence';
import { runIdle, type TimelineSlot } from '../host/model';

/** Provider names and model names known to the Renderer now; a frozen member snapshot keeps only stable ids. */
export type ProviderNames = { state: 'loading' | 'ready' | 'error'; names: ReadonlyMap<string, string>; models?: ReadonlyMap<string, string> };
export const providerNamesFrom = (providers: readonly ProviderSummary[], state: ProviderNames['state']): ProviderNames => ({
  state, names: new Map(providers.map(provider => [provider.id, provider.name])),
  models: new Map(providers.flatMap(provider => provider.customModels.map(model => [`${provider.id}:${model.id}`, model.name] as const))),
});

export const memberOf = (snapshot: RunSnapshot | undefined, agentId: string | undefined): MemberSnapshot | undefined =>
  snapshot?.execution?.membersSnapshot?.find(member => member.agentId === agentId);

/** The model's display name for the identity line, e.g. "DeepSeek Flash"; never a Provider UUID. */
export function modelLabel(member: Pick<MemberSnapshot, 'providerId' | 'modelId'> | undefined, providers: ProviderNames | undefined): string {
  if (!member?.modelId) return '模型未记录';
  if (!member.providerId) return member.modelId === 'mock' ? '内置演示（Mock）' : member.modelId;
  return providers?.models?.get(`${member.providerId}:${member.modelId}`) ?? member.modelId;
}
/** Where the request went, for 请求详情; explains a missing name instead of showing an id. */
export function providerLabel(member: Pick<MemberSnapshot, 'providerId' | 'modelId'> | undefined, providers: ProviderNames | undefined): string {
  if (!member?.providerId) return member?.modelId === 'mock' ? '内置 Mock（不联网、不计费）' : '服务未记录';
  const name = providers?.names.get(member.providerId);
  if (name) return name;
  return providers?.state === 'ready' ? '服务已删除' : providers?.state === 'error' ? '服务名称暂时无法读取' : '正在读取服务名称';
}

/** Names the upstream messages a version was based on, e.g. 「起草者」「主持人」的发言. */
export function upstream(snapshot: RunSnapshot, messageIds: string[]): string {
  const names = messageIds.map(id => {
    const version = snapshot.versions?.find(item => item.messageId === id);
    if (version?.author === 'host') return '主持人';
    const turn = snapshot.turns.find(item => item.turnId === version?.turnId);
    return memberOf(snapshot, turn?.agentId)?.displayName ?? snapshot.messages.find(item => item.id === id)?.senderName ?? '上游';
  });
  return [...new Set(names)].map(name => `「${name}」`).join('') + '的发言';
}

const directable = ['paused', 'completed', 'error', 'cancelled', 'interrupted'];
/** What the host may do with one slot right now; Main rechecks every condition when the command arrives. */
export function slotAbilities(snapshot: RunSnapshot, slot: TimelineSlot, shown: TimelineSlot['versions'][number]) {
  const turn = snapshot.turns.find(value => value.turnId === slot.turnId);
  const streaming = slot.versions.some(version => version.message.status === 'streaming');
  const settled = slot.author === 'host' || turn?.status === 'completed';
  const lastTurn = snapshot.turns.at(-1)?.turnId === slot.turnId;
  const idle = runIdle(snapshot);
  const regenerate = slot.author === 'agent' && idle && (settled ? directable.includes(snapshot.status)
    : lastTurn && ['failed', 'aborted', 'interrupted'].includes(turn?.status ?? '') && ['error', 'cancelled', 'interrupted'].includes(snapshot.status));
  // D102: a reply that hit the output limit is complete but unfinished; it can be continued as a new version.
  const truncated = shown.message.status === 'completed' && snapshot.attempts?.find(attempt => attempt.messageId === shown.messageId)?.finishReason === 'length';
  return {
    turn, streaming, settled, regenerate, truncated,
    edit: settled && !streaming && shown.message.status !== 'streaming',
    select: !shown.active && shown.message.status === 'completed' && settled && !streaming,
    continue: truncated && shown.active && slot.author === 'agent' && settled && idle && directable.includes(snapshot.status),
    generating: slot.versions.find(version => version.messageId === snapshot.host?.generation?.messageId),
  };
}

/** One short label for a request's token usage on a message footer. */
export function usageLabel(usage: RequestUsage): { text: string; tone: 'plain' | 'warn' } {
  if (usage.state === 'reported') return { text: `${((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)).toLocaleString('zh-CN')} tokens`, tone: 'plain' };
  if (usage.state === 'in_flight') return { text: '生成中', tone: 'plain' };
  if (usage.state === 'unknown') return { text: '用量未知', tone: 'warn' };
  return { text: '未发出', tone: 'plain' };
}
/** The full wording behind the label: the provider's usage, or why there is none. */
export function usageDetail(usage: RequestUsage): string {
  const hit = usage.cacheHitTokens;
  const tokens = usage.inputTokens !== null && usage.outputTokens !== null
    ? `输入 ${usage.inputTokens.toLocaleString('zh-CN')}${hit ? `（缓存命中 ${hit.toLocaleString('zh-CN')}）` : ''} / 输出 ${usage.outputTokens.toLocaleString('zh-CN')} tokens` : '';
  return usage.state === 'reported' ? tokens
    : usage.state === 'in_flight' ? '生成中，结束后显示服务商返回的用量'
    : usage.state === 'unknown' ? `没拿到完整用量${tokens ? `（已观察 ${tokens}）` : ''}：请求已发出，但中途停止、断网或服务商没有返回用量。服务商可能已经计入，请到服务商控制台查看。`
    : '请求没有发出。';
}

/** Says a part was kept only when one was. */
export function messageStatusText(message: { status: string; content: string }): string {
  switch (message.status) {
    case 'streaming': return '正在发言';
    case 'failed': return message.content ? '生成失败，已保留部分文字' : '生成失败';
    case 'aborted': return message.content ? '已中止 · 保留部分文字' : '已中止';
    default: return '';
  }
}
