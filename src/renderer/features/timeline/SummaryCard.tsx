import { useEffect, useId, useState } from 'react';
import { Check, Ellipsis, Layers, Pencil, Square, TriangleAlert } from 'lucide-react';
import type { RunSnapshot } from '../../../shared/types/run';
import { formatYuan } from '../../../shared/schemas/budget';
import { statusLabels } from '../../locales/zhCN';
import { Button, IconButton, Note, Tag, cx } from '../../components/ui';
import { originLabels, summaryWritable, timelineSlots, usedSummary, type TimelineSlot } from '../host/model';
import type { HostCommands } from '../host/useHostCommands';
import type { SummaryCommands } from '../host/useSummaryCommands';
import { chargeOfMessage, type LedgerCommands } from '../usage';
import { Markdown } from './Markdown';
import { CopyButton, EditForm, RequestDetails, VersionSwitch, useVersions } from './MessageItem';
import { chargeLabel, memberOf } from './model';

const requestStatus: Record<string, string> = { generating: '正在生成', completed: '已生成', failed: '生成失败', aborted: '已中止', interrupted: '已中断（应用重启，未自动重发）' };

/** D107: a summary in the timeline — what it covers, whether later requests use it, and its versions. */
export function SummaryCard({ slot, snapshot, commands, summaries, ledger, onRegenerate }: { slot: TimelineSlot; snapshot: RunSnapshot; commands: HostCommands;
  summaries: SummaryCommands; ledger?: LedgerCommands; onRegenerate: (summaryId: string) => void }) {
  const { index, shown, setViewing } = useVersions(slot);
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const summary = snapshot.summaries?.find(item => item.slotId === slot.slotId);
  const writable = summaryWritable(snapshot);
  const revisedNumbers = (timelineSlots(snapshot) ?? []).filter(item => summary?.revisedSlotIds?.includes(item.slotId)).map(item => item.number!);
  const affected = shown.affectedBy.length > 0 && shown.active;
  // D109: the cost of bringing an affected summary up to date is shown before the host opens the dialog.
  const [regenerateCost, setRegenerateCost] = useState<string>();
  const { preview } = summaries;
  useEffect(() => {
    if (!affected || !writable || !summary) { setRegenerateCost(undefined); return; }
    let current = true;
    preview({ summaryId: summary.summaryId }).then(result => {
      if (current) setRegenerateCost(result.cost.kind === 'priced' ? `最多 ${formatYuan(result.cost.maxMicro)}` : result.cost.kind === 'free' ? '内置 Mock，不花钱' : undefined);
    }).catch(() => { if (current) setRegenerateCost(undefined); });
    return () => { current = false; };
  }, [affected, writable, summary?.summaryId, snapshot.sequence, preview]);
  if (!summary) return null;
  const request = summary.requests.find(item => item.messageId === shown.messageId);
  const generating = summary.requests.some(item => item.status === 'generating');
  const confirmed = shown.origin === 'edit' || summary.confirmedMessageIds.includes(shown.messageId);
  const used = usedSummary(snapshot)?.summaryId === summary.summaryId && shown.active;
  const complete = shown.message.status === 'completed' && shown.message.content.trim().length > 0;
  const disabled = !commands.available || commands.pending !== undefined || summaries.pending !== undefined;
  const range = `第 ${summary.firstNumber}–${summary.lastNumber} 条`;
  const member = memberOf(snapshot, summary.agentId);
  const charge = chargeOfMessage(snapshot, shown.messageId);
  const pendingConfirm = complete && shown.active && !confirmed;
  const state = request?.status === 'generating' ? '正在生成摘要…'
    : !complete ? requestStatus[request?.status ?? ''] ?? statusLabels[shown.message.status] ?? '未完成'
    : !shown.active ? '未生效的历史版本'
    : used ? '已确认 · 之后的发言用它代替原文' : confirmed ? '已确认 · 已被后面的摘要取代' : '待确认 · 确认前之后的发言仍使用原文';
  const save = (content: string) => void commands.send(`edit:${slot.slotId}`, { kind: 'editMessage', messageId: shown.messageId, content }, '已保存为新版本，并按你的修改确认使用。')
    .then(ok => { if (ok) { setEditing(false); setViewing(undefined); } });
  return <section className={cx('summary-card', used && 'is-used', pendingConfirm && 'is-pending')} data-slot={slot.slotId} aria-label={`讨论摘要（覆盖${range}）`}>
    <div className="summary-head"><Layers aria-hidden size={16} /><b>讨论摘要</b><Tag>覆盖{range}</Tag>
      <Tag tone={used ? 'accent' : pendingConfirm ? 'warn' : 'neutral'}>{used && <Check aria-hidden />}{state}</Tag></div>
    {editing ? <div className="summary-body"><EditForm label="修改摘要内容" help="修改摘要（保存为新版本，并按修改后的内容确认使用；原版本保留）" initial={shown.message.content} disabled={disabled} onSave={save} onCancel={() => setEditing(false)} /></div>
      : <div className="summary-body">{shown.message.content ? <Markdown text={shown.message.content} /> : <p className="muted">{request?.status === 'generating' ? '等待输出…' : '（没有生成内容）'}</p>}</div>}
    {pendingConfirm && <Note tone="info" icon={Check} action={<Button size="sm" variant="primary" disabled={disabled} onClick={() => void summaries.confirm(shown.messageId)}>确认使用</Button>}>
      请先读一遍：确认后，之后的发言会用这份摘要代替{range}原文（原文不会删除）；也可以修改后再用。
    </Note>}
    {shown.affectedBy.length > 0 && <Note icon={TriangleAlert} cost={!generating && affected ? regenerateCost : undefined}
      action={!generating && affected ? <Button size="sm" variant="primary" disabled={disabled || !writable} title={writable ? undefined : '有请求正在进行，暂停或结束后可以重新生成'} onClick={() => onRegenerate(summary.summaryId)}>重新生成摘要…</Button> : undefined}>
      <b>受影响</b> · 这份摘要生成后，{revisedNumbers.length ? `第 ${revisedNumbers.join('、')} 条` : '它覆盖的发言'}被修改或重新生成。修改后的发言会照常发给之后的成员，紧跟在摘要后面，摘要里与之冲突的内容不再采用。建议重新生成摘要，把这些修改也整理进去。
    </Note>}
    {summaries.error?.key === `confirm:${shown.messageId}` && <p role="alert" className="field-error summary-error">{summaries.error.message}</p>}
    <div className="msg-foot" role="group" aria-label="讨论摘要的操作">
      <VersionSwitch slot={slot} index={index} onView={setViewing} />
      <span>{member ? `由${member.displayName}生成` : '生成成员未记录'}{shown.origin !== 'original' ? ` · ${originLabels[shown.origin]}` : ''} · 原文保留在上方</span>
      {charge && <button type="button" className={cx('cost', chargeLabel(charge).tone === 'warn' && 'is-warn')} aria-expanded={details} aria-controls={detailsId} onClick={() => setDetails(value => !value)}>{chargeLabel(charge).text}</button>}
      <span className="grow" />
      {!shown.active && complete && !generating && <Button size="sm" disabled={disabled} onClick={() => void commands.send(`select:${slot.slotId}`, { kind: 'selectVersion', messageId: shown.messageId }, '已切换当前有效版本。').then(ok => { if (ok) setViewing(undefined); })}>设为当前版本</Button>}
      {generating && <Button size="sm" variant="quiet" icon={Square} disabled={disabled} onClick={() => void commands.send('abort', { kind: 'abortGeneration' }, '已中止生成，已输出的部分保留。')}>中止生成</Button>}
      {!generating && !affected && <Button size="sm" variant="quiet" disabled={disabled || !writable} title={writable ? undefined : '有请求正在进行，暂停或结束后可以重新生成'} onClick={() => onRegenerate(summary.summaryId)}>重新生成摘要…</Button>}
      <CopyButton text={shown.message.content} />
      {!editing && !generating && shown.message.status !== 'streaming' && <IconButton size="sm" icon={Pencil} label="修改" disabled={disabled} onClick={() => setEditing(true)} />}
      <IconButton size="sm" icon={Ellipsis} label="请求详情" aria-expanded={details} aria-controls={detailsId} onClick={() => setDetails(value => !value)} />
    </div>
    {details && <RequestDetails id={detailsId} charge={charge} runId={snapshot.runId} ledger={ledger} lines={[['生成成员', member?.displayName ?? '未记录'], ['模型 ID', member?.modelId ?? '未记录']]} />}
  </section>;
}
