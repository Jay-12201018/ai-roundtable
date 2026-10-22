import { useState } from 'react';
import type { RunSnapshot } from '../../../shared/types/run';
import { statusLabels } from '../../locales/zhCN';
import { HostTextArea } from './HostTextArea';
import { originLabels, runIdle, timelineSlots, type TimelineSlot } from './model';
import type { HostCommands } from './useHostCommands';
import { MessageUsage, chargeOfMessage } from '../usage';

type Props = { snapshot: RunSnapshot | undefined; commands: HostCommands };

function identity(snapshot: RunSnapshot | undefined, agentId: string | undefined) {
  const member = snapshot?.execution?.membersSnapshot?.find(value => value.agentId === agentId);
  return { member, line: `${member?.roleTemplateId ?? '角色未记录'} · Provider：${member?.providerId ?? '未记录'} · Model：${member?.modelId ?? '未记录'}` };
}

/** The shared timeline: one entry per message slot, its effective version first, other versions on demand. */
export function HostTimeline({ snapshot, commands }: Props) {
  const slots = timelineSlots(snapshot);
  if (!slots) {
    // Builds without version data keep the original flat rendering.
    return <>{(snapshot?.messages ?? []).map(message => {
      const attempt = snapshot?.attempts?.find(value => value.messageId === message.id);
      const turn = snapshot?.turns.find(value => attempt ? value.turnId === attempt.turnId : value.messageId === message.id);
      const { member, line } = identity(snapshot, turn?.agentId);
      return <article className="message" key={message.id}><strong>{member?.displayName ?? message.senderName}</strong><div className="message-identity">{line}</div><p>{message.content}</p><small>{statusLabels[message.status] ?? '未知状态'}</small><MessageUsage charge={chargeOfMessage(snapshot, message.id)} /></article>;
    })}</>;
  }
  return <>{slots.map(slot => <SlotView key={slot.slotId} slot={slot} snapshot={snapshot!} commands={commands} />)}</>;
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

function SlotView({ slot, snapshot, commands }: { slot: TimelineSlot; snapshot: RunSnapshot; commands: HostCommands }) {
  const [viewing, setViewing] = useState<string>();
  const [draft, setDraft] = useState<string>();
  const index = Math.max(0, slot.versions.findIndex(version => version.messageId === (viewing ?? slot.active.messageId)));
  const shown = slot.versions[index] ?? slot.active;
  const turn = snapshot.turns.find(value => value.turnId === slot.turnId);
  const { member, line } = identity(snapshot, turn?.agentId);
  const generating = slot.versions.find(version => version.messageId === snapshot.host?.generation?.messageId);
  const streaming = slot.versions.some(version => version.message.status === 'streaming');
  const settled = slot.author === 'host' || turn?.status === 'completed';
  const lastTurn = snapshot.turns.at(-1)?.turnId === slot.turnId;
  const idle = runIdle(snapshot);
  const canRegenerate = slot.author === 'agent' && idle && (settled ? ['paused', 'completed', 'error', 'cancelled', 'interrupted'].includes(snapshot.status)
    : lastTurn && ['failed', 'aborted', 'interrupted'].includes(turn?.status ?? '') && ['error', 'cancelled', 'interrupted'].includes(snapshot.status));
  const canEdit = settled && !streaming && shown.message.status !== 'streaming';
  const canSelect = !shown.active && shown.message.status === 'completed' && settled && !streaming;
  const disabled = !commands.available || commands.pending !== undefined;
  const name = slot.author === 'host' ? '主持人' : member?.displayName ?? shown.message.senderName;
  const save = async () => {
    if (draft === undefined || !draft.trim() || draft === shown.message.content) return;
    if (await commands.send(`edit:${slot.slotId}`, { kind: 'editMessage', messageId: shown.messageId, content: draft }, '已保存为新版本。')) { setDraft(undefined); setViewing(undefined); }
  };
  return <article className={`message host-slot${slot.author === 'host' ? ' is-host' : ''}`} data-slot={slot.slotId}>
    <strong>{name}</strong>
    {turn?.overrideActionId && <span className="host-badge">主持人点名</span>}
    {slot.author === 'host' && <span className="host-badge">主持人插话</span>}
    {slot.author === 'agent' && <div className="message-identity">{line}</div>}
    <p>{shown.message.content}</p>
    <small>{statusLabels[shown.message.status] ?? '未知状态'} · {originLabels[shown.origin]}{shown.active ? (slot.versions.length > 1 ? (shown.message.status === 'completed' ? ' · 当前有效' : ' · 当前版本（未完成）') : '') : ' · 未生效的历史版本'}</small>
    {slot.author === 'agent' && <MessageUsage charge={chargeOfMessage(snapshot, shown.messageId)} />}
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
      {canRegenerate && <button type="button" disabled={disabled} onClick={() => void commands.send(`regenerate:${slot.slotId}`, { kind: 'regenerateMessage', messageId: shown.messageId }, '已发送重新生成请求。')}>重新生成</button>}
    </div>
    {draft !== undefined && <form className="host-edit" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>修改为新版本（原文保留）<HostTextArea aria-label="修改消息内容" autoFocus value={draft} rows={4} onChange={event => setDraft(event.target.value)} onSubmit={() => void save()} /></label>
      <button type="submit" disabled={disabled || !draft.trim() || draft === shown.message.content}>保存为新版本</button>
      <button type="button" onClick={() => setDraft(undefined)}>取消</button>
    </form>}
  </article>;
}
