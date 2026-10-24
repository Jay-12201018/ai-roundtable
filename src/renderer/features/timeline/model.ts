import type { ProviderSummary } from '../../../shared/contracts/configuration';
import { formatYuan, type RequestCharge } from '../../../shared/schemas/budget';
import type { RunSnapshot } from '../../../shared/types/run';
import type { MemberSnapshot } from '../../../shared/schemas/persistence';
import { chargeOfMessage, pricingLabel, writeOffSummary } from '../usage';
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

/** The most a repeat of this message's request may cost: its last reservation, which a new request reserves again. */
export function repeatCost(snapshot: RunSnapshot, messageId: string, member?: Pick<MemberSnapshot, 'providerId' | 'modelId'>): string | undefined {
  if (member && !member.providerId && member.modelId === 'mock') return '内置 Mock，不花钱';
  const charge = chargeOfMessage(snapshot, messageId);
  return charge && charge.currency === 'CNY' ? `最多约 ${formatYuan(charge.reservedMicro)}` : undefined;
}

/** The short amount in a message footer, and whether it needs the host's attention. */
export function chargeLabel(charge: RequestCharge): { text: string; tone: 'plain' | 'warn' } {
  const writeOff = charge.writeOffs?.at(-1);
  if (charge.state === 'settled') return { text: formatYuan(charge.chargedMicro), tone: 'plain' };
  if (charge.state === 'reserved') return { text: `已预留最高 ${formatYuan(charge.reservedMicro)}`, tone: 'plain' };
  if (charge.state === 'unknown' && writeOff) return { text: `已核销 ${formatYuan(writeOff.amountMicro)}`, tone: 'plain' };
  if (charge.state === 'unknown') return { text: `费用未知 · 按上限 ${formatYuan(charge.reservedMicro)}`, tone: 'warn' };
  return { text: '未发出，未计费', tone: 'plain' };
}
/** The full wording behind the amount: usage and its price, or why the cost is unknown, held or written off. */
export function chargeDetail(charge: RequestCharge): string {
  const hit = charge.settlement?.cacheHitTokens;
  const tokens = charge.inputTokens !== null && charge.outputTokens !== null
    ? `输入 ${charge.inputTokens.toLocaleString('zh-CN')}${hit ? `（缓存命中 ${hit.toLocaleString('zh-CN')}）` : ''} / 输出 ${charge.outputTokens.toLocaleString('zh-CN')} tokens` : undefined;
  const writeOff = charge.writeOffs?.at(-1);
  return charge.state === 'settled' ? `${tokens} · 花费 ${formatYuan(charge.chargedMicro, 6)} · ${pricingLabel(charge)}`
    : charge.state === 'reserved' ? `生成中 · 已预留最高 ${formatYuan(charge.reservedMicro, 6)}，结束后按实际用量结算`
    : charge.state === 'unknown' && writeOff ? `已核销 ${writeOffSummary(writeOff.amountMicro, charge.reservedMicro)} · 依据：${writeOff.basis}`
    : charge.state === 'unknown' ? `费用未知（按上限计 ${formatYuan(charge.reservedMicro, 6)}）${tokens ? ` · 已观察 ${tokens}` : ' · 服务商未返回用量'}。可以到服务商控制台核对后核销。`
    : '请求未发出，未计费';
}

export const messageStatusText: Record<string, string> = { streaming: '正在发言', failed: '生成失败，已保留部分文字', aborted: '已中止 · 保留部分文字' };
