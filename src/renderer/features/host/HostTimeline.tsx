import { useState } from 'react';
import type { RunSnapshot } from '../../../shared/types/run';
import { statusLabels } from '../../locales/zhCN';
import { HostTextArea } from './HostTextArea';
import { originLabels, runIdle, timelineSlots, usedSummary, type TimelineSlot } from './model';
import type { HostCommands } from './useHostCommands';
import { MessageUsage, chargeOfMessage, type LedgerCommands } from '../usage';
import { SummarySlotView, type SummaryCommands } from './SummaryViews';

/** Provider names known to the Renderer now; a frozen member snapshot keeps only the stable Provider id. */
export type ProviderNames = { state: 'loading' | 'ready' | 'error'; names: ReadonlyMap<string, string> };
type Props = { snapshot: RunSnapshot | undefined; commands: HostCommands; providers?: ProviderNames;
  /** R13B: ledger write-offs, summary commands and opening the summary panel to regenerate one. */
  ledger?: LedgerCommands; summaries?: SummaryCommands; onRegenerateSummary?: (summaryId: string) => void };

// Never shows a Provider UUID: a name, or a plain explanation when the name cannot be found.
function providerLabel(providerId: string | null | undefined, modelId: string | null | undefined, providers: ProviderNames | undefined): string {
  if (!providerId) return modelId === 'mock' ? 'Provider：内置 Mock' : 'Provider 未记录';
  const name = providers?.names.get(providerId);
  if (name) return `Provider：${name}`;
  return providers?.state === 'ready' ? 'Provider 已删除' : providers?.state === 'error' ? 'Provider 名称暂时无法读取' : 'Provider 读取中';
}
function identity(snapshot: RunSnapshot | undefined, agentId: string | undefined, providers?: ProviderNames) {
  const member = snapshot?.execution?.membersSnapshot?.find(value => value.agentId === agentId);
  return { member, line: `${member?.roleTemplateId ?? '角色未记录'} · ${providerLabel(member?.providerId, member?.modelId, providers)} · Model：${member?.modelId ?? '未记录'}` };
}

/** The shared timeline: one entry per message slot, its effective version first, other versions on demand. */
export function HostTimeline({ snapshot, commands, providers, ledger, summaries, onRegenerateSummary }: Props) {
  const slots = timelineSlots(snapshot);
  if (!slots) {
    // Builds without version data keep the original flat rendering.
    return <>{(snapshot?.messages ?? []).map(message => {
      const attempt = snapshot?.attempts?.find(value => value.messageId === message.id);
      const turn = snapshot?.turns.find(value => attempt ? value.turnId === attempt.turnId : value.messageId === message.id);
      const { member, line } = identity(snapshot, turn?.agentId, providers);
      return <article className="message" key={message.id}><strong>{member?.displayName ?? message.senderName}</strong><div className="message-identity">{line}</div><p>{message.content}</p><small>{statusLabels[message.status] ?? '未知状态'}</small><MessageUsage charge={chargeOfMessage(snapshot, message.id)} /></article>;
    })}</>;
  }
  const used = usedSummary(snapshot);
  return <>{slots.map(slot => slot.author === 'summary'
    ? summaries && <SummarySlotView key={slot.slotId} slot={slot} snapshot={snapshot!} commands={commands} summaries={summaries} ledger={ledger} onRegenerate={onRegenerateSummary ?? (() => {})} />
    : <SlotView key={slot.slotId} slot={slot} snapshot={snapshot!} commands={commands} providers={providers} ledger={ledger} coveredBy={used?.coveredSlotIds.includes(slot.slotId) ? used : undefined} />)}</>;
}

/** Names the upstream messages a version was based on, e.g. 「起草者」「主持人」的发言. */
function upstream(snapshot: RunSnapshot, messageIds: string[]): string {
  const names = messageIds.map(id => {
    const version = snapshot.versions?.find(item => item.messageId === id);
    if (version?.author === 'host') return '主持人';
    const turn = snapshot.turns.find(item => item.turnId === version?.turnId);
    return identity(snapshot, turn?.agentId).member?.displayName ?? snapshot.messages.find(item => item.id === id)?.senderName ?? '上游';
  });
  return [...new Set(names)].map(name => `「${name}」`).join('') + '的发言';
}

function SlotView({ slot, snapshot, commands, providers, ledger, coveredBy }: { slot: TimelineSlot; snapshot: RunSnapshot; commands: HostCommands; providers?: ProviderNames;
  ledger?: LedgerCommands; coveredBy?: { firstNumber: number; lastNumber: number } }) {
  const [viewing, setViewing] = useState<string>();
  const [draft, setDraft] = useState<string>();
  const index = Math.max(0, slot.versions.findIndex(version => version.messageId === (viewing ?? slot.active.messageId)));
  const shown = slot.versions[index] ?? slot.active;
  const turn = snapshot.turns.find(value => value.turnId === slot.turnId);
  const { member, line } = identity(snapshot, turn?.agentId, providers);
  const generating = slot.versions.find(version => version.messageId === snapshot.host?.generation?.messageId);
  const streaming = slot.versions.some(version => version.message.status === 'streaming');
  const settled = slot.author === 'host' || turn?.status === 'completed';
  const lastTurn = snapshot.turns.at(-1)?.turnId === slot.turnId;
  const idle = runIdle(snapshot);
  const canRegenerate = slot.author === 'agent' && idle && (settled ? ['paused', 'completed', 'error', 'cancelled', 'interrupted'].includes(snapshot.status)
    : lastTurn && ['failed', 'aborted', 'interrupted'].includes(turn?.status ?? '') && ['error', 'cancelled', 'interrupted'].includes(snapshot.status));
  const canEdit = settled && !streaming && shown.message.status !== 'streaming';
  const canSelect = !shown.active && shown.message.status === 'completed' && settled && !streaming;
  // D102: a reply that hit the output limit is complete but unfinished; it can be continued as a new version.
  const truncated = shown.message.status === 'completed' && snapshot.attempts?.find(attempt => attempt.messageId === shown.messageId)?.finishReason === 'length';
  const canContinue = truncated && shown.active && slot.author === 'agent' && settled && idle && ['paused', 'completed', 'error', 'cancelled', 'interrupted'].includes(snapshot.status);
  const disabled = !commands.available || commands.pending !== undefined;
  const name = slot.author === 'host' ? '主持人' : member?.displayName ?? shown.message.senderName;
  const save = async () => {
    if (draft === undefined || !draft.trim() || draft === shown.message.content) return;
    if (await commands.send(`edit:${slot.slotId}`, { kind: 'editMessage', messageId: shown.messageId, content: draft }, '已保存为新版本。')) { setDraft(undefined); setViewing(undefined); }
  };
  return <article className={`message host-slot${slot.author === 'host' ? ' is-host' : ''}${coveredBy ? ' is-summarized' : ''}`} data-slot={slot.slotId}>
    {slot.number !== undefined && <span className="slot-number" aria-label={`第 ${slot.number} 条`}>#{slot.number}</span>}
    <strong>{name}</strong>
    {coveredBy && <span className="host-badge" title="原文保留；之后的请求用已确认的讨论摘要代替它">已由摘要代替（第 {coveredBy.firstNumber}–{coveredBy.lastNumber} 条）</span>}
    {turn?.overrideActionId && <span className="host-badge">主持人点名</span>}
    {slot.author === 'host' && <span className="host-badge">主持人插话</span>}
    {slot.author === 'agent' && <div className="message-identity">{line}</div>}
    <p>{shown.message.content}</p>
    <small>{statusLabels[shown.message.status] ?? '未知状态'} · {originLabels[shown.origin]}{shown.active ? (slot.versions.length > 1 ? (shown.message.status === 'completed' ? ' · 当前有效' : ' · 当前版本（未完成）') : '') : ' · 未生效的历史版本'}</small>
    {slot.author === 'agent' && <MessageUsage charge={chargeOfMessage(snapshot, shown.messageId)} runId={snapshot.runId} ledger={ledger} />}
    {truncated && <p className="host-truncated" role="note">已达单次输出上限，内容可能不完整。{shown.active && !canContinue ? '运行暂停或结束后可以续写。' : ''}</p>}
    {shown.affectedBy.length > 0 && <p className="host-affected" role="note">受影响：生成时依据的{upstream(snapshot, shown.affectedBy)}已被修改、重新生成或本身受影响，此内容仍基于旧版本，可点“重新生成”更新。</p>}
    {generating && <p className="host-generation" role="status">正在重新生成版本 {generating.versionNumber}：{generating.message.content || '等待输出…'}</p>}
    <div className="host-version-actions" role="group" aria-label={`${name} 的消息操作`}>
      {slot.versions.length > 1 && <>
        <button type="button" aria-label="查看上一个版本" disabled={index === 0} onClick={() => setViewing(slot.versions[index - 1].messageId)}>‹</button>
        <span aria-live="polite">版本 {index + 1}/{slot.versions.length}</span>
        <button type="button" aria-label="查看下一个版本" disabled={index === slot.versions.length - 1} onClick={() => setViewing(slot.versions[index + 1].messageId)}>›</button>
      </>}
      {canSelect && <button type="button" disabled={disabled} onClick={() => void commands.send(`select:${slot.slotId}`, { kind: 'selectVersion', messageId: shown.messageId }, '已切换当前有效版本。').then(ok => { if (ok) setViewing(undefined); })}>设为当前版本</button>}
      {canEdit && draft === undefined && <button type="button" disabled={disabled} onClick={() => setDraft(shown.message.content)}>修改</button>}
      {truncated && shown.active && slot.author === 'agent' && <button type="button" disabled={disabled || !canContinue}
        onClick={() => void commands.send(`continue:${slot.slotId}`, { kind: 'regenerateMessage', messageId: shown.messageId, mode: 'continue' }, '已发送续写请求：会生成一个新版本，并按新请求预留和结算费用。')}>续写</button>}
      {canRegenerate && <button type="button" disabled={disabled} onClick={() => void commands.send(`regenerate:${slot.slotId}`, { kind: 'regenerateMessage', messageId: shown.messageId }, '已发送重新生成请求。')}>重新生成</button>}
    </div>
    {draft !== undefined && <form className="host-edit" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>修改为新版本（原文保留）<HostTextArea aria-label="修改消息内容" autoFocus value={draft} rows={4} onChange={event => setDraft(event.target.value)} onSubmit={() => void save()} /></label>
      <button type="submit" disabled={disabled || !draft.trim() || draft === shown.message.content}>保存为新版本</button>
      <button type="button" onClick={() => setDraft(undefined)}>取消</button>
    </form>}
  </article>;
}
