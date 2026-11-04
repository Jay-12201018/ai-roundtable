import { useEffect, useId, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Ellipsis, Info, Pencil, RefreshCw, Scissors, Sparkles, Square, TriangleAlert } from 'lucide-react';
import type { RunSnapshot } from '../../../shared/types/run';
import type { RequestUsage } from '../../../shared/schemas/usage';
import { Avatar, Button, IconButton, Note, Tag, copyText, cx } from '../../components/ui';
import { HostTextArea } from '../host/HostTextArea';
import { isContinuationTurn, originLabels, type TimelineSlot } from '../host/model';
import type { HostCommands } from '../host/useHostCommands';
import { usageOfMessage } from '../usage';
import { Markdown } from './Markdown';
import { usageDetail, usageLabel, memberOf, messageStatusText, modelLabel, providerLabel, slotAbilities, upstream, type ProviderNames } from './model';
import { useTimelineHold } from './hold';
import { stageOfTurn } from '../workflows/productionAdapter';

export type SlotProps = {
  slot: TimelineSlot; snapshot: RunSnapshot; commands: HostCommands; providers?: ProviderNames;
  coveredBy?: { firstNumber: number; lastNumber: number }; revisedAfterSummary?: boolean;
};

/** Version stepping shared by members, the host and summaries; looking at an older version holds the scroll. */
export function useVersions(slot: TimelineSlot) {
  const [viewing, setViewing] = useState<string>();
  const index = Math.max(0, slot.versions.findIndex(version => version.messageId === (viewing ?? slot.active.messageId)));
  const shown = slot.versions[index] ?? slot.active;
  useTimelineHold(!shown.active);
  return { index, shown, viewing, setViewing };
}

export function VersionSwitch({ slot, index, onView }: { slot: TimelineSlot; index: number; onView: (messageId: string) => void }) {
  if (slot.versions.length < 2) return null;
  return <span className="ver">
    <IconButton size="sm" icon={ChevronLeft} label="查看上一个版本" disabled={index === 0} onClick={() => onView(slot.versions[index - 1].messageId)} />
    <span aria-live="polite">版本 {index + 1}/{slot.versions.length}</span>
    <IconButton size="sm" icon={ChevronRight} label="查看下一个版本" disabled={index === slot.versions.length - 1} onClick={() => onView(slot.versions[index + 1].messageId)} />
  </span>;
}

export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const timer = setTimeout(() => setDone(false), 1600); return () => clearTimeout(timer); }, [done]);
  return <IconButton size="sm" icon={done ? Check : Copy} label={done ? '已复制' : label} disabled={!text} onClick={() => void copyText(text).then(setDone)} />;
}

/** Inline editor: saves a new version and keeps the original. */
export function EditForm({ label, help, initial, disabled, onSave, onCancel }: { label: string; help: string; initial: string; disabled: boolean; onSave: (text: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const id = useId();
  const changed = draft.trim().length > 0 && draft !== initial;
  return <form className="msg-edit" onSubmit={event => { event.preventDefault(); if (changed) onSave(draft); }}>
    <label htmlFor={id} className="small muted">{help}</label>
    <HostTextArea id={id} className="textarea" aria-label={label} autoFocus value={draft} rows={5} onChange={event => setDraft(event.target.value)} onSubmit={() => { if (changed) onSave(draft); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }} />
    <div className="msg-edit-actions"><span className="meta">Enter 保存 · Shift+Enter 换行 · Esc 取消</span>
      <Button onClick={onCancel}>取消</Button><Button type="submit" variant="primary" disabled={disabled || !changed}>保存为新版本</Button></div>
  </form>;
}

/** The token count is a button, not a hover: it opens the request details. */
export function RequestDetails({ id, usage, lines }: { id: string; usage?: RequestUsage; lines: Array<[string, string]> }) {
  return <div id={id} className="msg-details" role="region" aria-label="请求详情">
    <dl>{lines.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}
      {usage && <div><dt>用量</dt><dd data-usage-state={usage.state}>{usageDetail(usage)}</dd></div>}</dl>
  </div>;
}

function UsageButton({ usage, open, onToggle, controls }: { usage: RequestUsage | undefined; open: boolean; onToggle: () => void; controls: string }) {
  if (!usage) return null;
  const { text, tone } = usageLabel(usage);
  return <button type="button" className={cx('usage-tag', tone === 'warn' && 'is-warn')} aria-expanded={open} aria-controls={controls} title="查看用量和请求详情" onClick={onToggle}>{text}</button>;
}

/** One member reply: identity line, notes only when something needs the host, then a light footer. */
export function AgentMessage({ slot, snapshot, commands, providers, coveredBy, revisedAfterSummary }: SlotProps) {
  const { index, shown, setViewing } = useVersions(slot);
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const can = slotAbilities(snapshot, slot, shown);
  const member = memberOf(snapshot, can.turn?.agentId);
  const name = member?.displayName ?? shown.message.senderName;
  const disabled = !commands.available || commands.pending !== undefined;
  const usage = usageOfMessage(snapshot, shown.messageId);
  // D109: a covered message revised after the summary is sent itself, so it is not shown as replaced.
  const replaced = coveredBy && !revisedAfterSummary;
  const streaming = shown.message.status === 'streaming';
  const regenerate = () => void commands.send(`regenerate:${slot.slotId}`, { kind: 'regenerateMessage', messageId: shown.messageId }, '已发送重新生成请求。');
  const save = (content: string) => void commands.send(`edit:${slot.slotId}`, { kind: 'editMessage', messageId: shown.messageId, content }, '已保存为新版本。')
    .then(ok => { if (ok) { setEditing(false); setViewing(undefined); } });
  const status = messageStatusText(shown.message);
  return <article className={cx('msg', replaced && 'is-covered')} data-slot={slot.slotId} aria-label={`第 ${slot.number} 条 · ${name}`}>
    <div className="msg-head">
      <Avatar name={name} /><span className="msg-name">{name}</span><span className="msg-meta">{modelLabel(member, providers)}</span>
      {stageOfTurn(snapshot, can.turn?.turnId) && <Tag title="讨论方式里的阶段">{stageOfTurn(snapshot, can.turn?.turnId)}</Tag>}
      {can.turn?.overrideActionId && (isContinuationTurn(snapshot, can.turn.overrideActionId)
        ? <Tag title="讨论结束后，主持人在这场讨论里继续；这一轮回应主持人的话">继续讨论</Tag>
        : <Tag tone="accent" title="主持人点名插入的一轮，不占用计划的回合">主持人点名</Tag>)}
      {replaced && <Tag title="原文保留；之后的请求用已确认的讨论摘要代替它">已由摘要代替</Tag>}
      {coveredBy && revisedAfterSummary && <Tag tone="accent" title="摘要生成后修改过，所以这条会照常发给之后的成员，紧跟在摘要后面">摘要后已修改 · 照常发送</Tag>}
      {slot.number !== undefined && <span className="msg-num" aria-hidden>#{slot.number}</span>}
    </div>
    {editing ? <EditForm label="修改消息内容" help="修改为新版本（原文保留；之后的发言会标出受影响）" initial={shown.message.content} disabled={disabled} onSave={save} onCancel={() => setEditing(false)} />
      : <div className="msg-body">{shown.message.content ? <Markdown text={shown.message.content} /> : <p className="muted small">{streaming ? '正在思考或生成，还没有输出文字…' : '（没有生成文字）'}</p>}</div>}
    {can.truncated && !shown.message.content.trim() && <Note icon={Scissors}
      action={shown.active && can.regenerate ? <Button size="sm" disabled={disabled} onClick={regenerate}>重新生成</Button> : undefined}>
      <b>这位成员的输出额度在思考阶段就用完了</b>，没有写出正文。可以到“设置 › 模型服务”调高这个模型的最大输出，再重新生成。</Note>}
    {can.truncated && shown.message.content.trim() && <Note icon={Scissors}
      action={shown.active && slot.author === 'agent' ? <Button size="sm" disabled={disabled || !can.continue} title={can.continue ? undefined : '运行暂停或结束后可以续写'}
        onClick={() => void commands.send(`continue:${slot.slotId}`, { kind: 'regenerateMessage', messageId: shown.messageId, mode: 'continue' }, '已发送续写请求：会生成一个新版本，这是一次新请求。')}>续写</Button> : undefined}>
      <b>写到单次上限停下了</b>{usage?.outputTokens ? ` · ${usage.outputTokens.toLocaleString('zh-CN')} tokens` : ''}，内容可能不完整。续写会生成一个新版本，按新请求计费。{shown.active && !can.continue ? '运行暂停或结束后可以续写。' : ''}
    </Note>}
    {shown.affectedBy.length > 0 && <Note icon={TriangleAlert}
      action={can.regenerate ? <Button size="sm" disabled={disabled} onClick={regenerate}>重新生成</Button> : undefined}>
      <b>受影响</b> · 写这条时依据的{upstream(snapshot, shown.affectedBy)}已被修改、重新生成或本身受影响，内容可能过时。{can.regenerate ? '' : '运行暂停或结束后可以重新生成。'}
    </Note>}
    {can.generating && <Note tone="info" icon={Sparkles} role="status">
      <b>正在重新生成版本 {can.generating.versionNumber}</b>{can.generating.message.content ? '：' : ' · 正在思考或生成，还没有输出文字…'}{can.generating.message.content && <span className="note-stream">{can.generating.message.content}</span>}
    </Note>}
    {status && !streaming && <Note tone={shown.message.status === 'failed' ? 'danger' : 'neutral'} icon={Info} role="note">{status}</Note>}
    <div className="msg-foot" role="group" aria-label={`${name} 的消息操作`}>
      {streaming ? <span className="typing"><Sparkles aria-hidden size={14} />正在发言</span> : <>
        <VersionSwitch slot={slot} index={index} onView={setViewing} />
        {slot.versions.length > 1 && <span>{originLabels[shown.origin]}{shown.active ? (shown.message.status === 'completed' || streaming ? '' : ' · 当前版本（未完成）') : ' · 未生效的历史版本'}</span>}
        <UsageButton usage={usage} open={details} onToggle={() => setDetails(value => !value)} controls={detailsId} />
      </>}
      <span className="grow" />
      {can.select && <Button size="sm" disabled={disabled} onClick={() => void commands.send(`select:${slot.slotId}`, { kind: 'selectVersion', messageId: shown.messageId }, '已切换当前有效版本。').then(ok => { if (ok) setViewing(undefined); })}>设为当前版本</Button>}
      {can.generating && <Button size="sm" variant="quiet" icon={Square} disabled={disabled} onClick={() => void commands.send('abort', { kind: 'abortGeneration' }, '已中止重新生成，部分输出已保留。')}>中止重新生成</Button>}
      {!streaming && <CopyButton text={shown.message.content} />}
      {can.edit && !editing && <IconButton size="sm" icon={Pencil} label="修改" disabled={disabled} onClick={() => setEditing(true)} />}
      {can.regenerate && shown.affectedBy.length === 0 && <IconButton size="sm" icon={RefreshCw} label="重新生成" disabled={disabled} onClick={regenerate} />}
      <IconButton size="sm" icon={Ellipsis} label="请求详情" aria-expanded={details} aria-controls={detailsId} onClick={() => setDetails(value => !value)} />
    </div>
    {details && <RequestDetails id={detailsId} usage={usage}
      lines={[['角色', member?.roleTemplateId || '未记录'], ['服务', providerLabel(member, providers)], ['模型 ID', member?.modelId ?? '未记录']]} />}
  </article>;
}

/** The host's own words sit on the right, so who is speaking is clear at a glance. */
export function HostMessage({ slot, snapshot, commands, coveredBy, revisedAfterSummary }: SlotProps) {
  const { index, shown, setViewing } = useVersions(slot);
  const [editing, setEditing] = useState(false);
  const can = slotAbilities(snapshot, slot, shown);
  const disabled = !commands.available || commands.pending !== undefined;
  const replaced = coveredBy && !revisedAfterSummary;
  const save = (content: string) => void commands.send(`edit:${slot.slotId}`, { kind: 'editMessage', messageId: shown.messageId, content }, '已保存为新版本。')
    .then(ok => { if (ok) { setEditing(false); setViewing(undefined); } });
  return <article className={cx('msg', 'is-host', replaced && 'is-covered')} data-slot={slot.slotId} aria-label={`第 ${slot.number} 条 · 主持人`}>
    <div className="host-label"><span>{snapshot.continuations?.some(item => item.messageId === slot.slotId) ? '主持人 · 继续讨论' : '主持人插话'}</span><span aria-hidden>·</span><span>#{slot.number}</span>
      {replaced && <Tag title="原文保留；之后的请求用已确认的讨论摘要代替它">已由摘要代替</Tag>}
      {coveredBy && revisedAfterSummary && <Tag tone="accent" title="摘要生成后修改过，所以这条会照常发给之后的成员">摘要后已修改 · 照常发送</Tag>}</div>
    {editing ? <EditForm label="修改消息内容" help="修改为新版本（原文保留）" initial={shown.message.content} disabled={disabled} onSave={save} onCancel={() => setEditing(false)} />
      : <div className="bubble">{shown.message.content}</div>}
    {shown.affectedBy.length > 0 && <Note icon={TriangleAlert}><b>受影响</b> · 依据的{upstream(snapshot, shown.affectedBy)}已变化。</Note>}
    <div className="msg-foot" role="group" aria-label="主持人 的消息操作">
      <VersionSwitch slot={slot} index={index} onView={setViewing} />
      {slot.versions.length > 1 && <span>{originLabels[shown.origin]}{shown.active ? '' : ' · 未生效的历史版本'}</span>}
      {slot.versions.length < 2 && <span>从下一回合起所有成员可见</span>}
      {can.select && <Button size="sm" disabled={disabled} onClick={() => void commands.send(`select:${slot.slotId}`, { kind: 'selectVersion', messageId: shown.messageId }, '已切换当前有效版本。').then(ok => { if (ok) setViewing(undefined); })}>设为当前版本</Button>}
      <CopyButton text={shown.message.content} />
      {can.edit && !editing && <IconButton size="sm" icon={Pencil} label="修改" disabled={disabled} onClick={() => setEditing(true)} />}
    </div>
  </article>;
}

export function SlotItem(props: SlotProps): ReactNode {
  return props.slot.author === 'host' ? <HostMessage {...props} /> : <AgentMessage {...props} />;
}
