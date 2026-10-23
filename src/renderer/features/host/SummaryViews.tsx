import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunSnapshot } from '../../../shared/types/run';
import type { SummaryApiContract } from '../../../shared/contracts/app';
import type { SummaryPreview } from '../../../shared/schemas/summary';
import { formatYuan } from '../../../shared/schemas/budget';
import { statusLabels } from '../../locales/zhCN';
import { HostTextArea } from './HostTextArea';
import { originLabels, summaryWritable, timelineSlots, usedSummary, type TimelineSlot } from './model';
import type { HostCommands } from './useHostCommands';
import { MessageUsage, chargeOfMessage, ledgerErrorMessage, type LedgerCommands } from '../usage';

type SummaryApi = { summary: SummaryApiContract };
let fallbackCounter = 0;
const newRequestId = () => globalThis.crypto?.randomUUID?.() ?? `summary-${Date.now()}-${++fallbackCounter}`;

/** Summary generation and confirmation for the selected Run; each click gets its own clientRequestId (D107). */
export function useSummaryCommands(api: SummaryApi | undefined, runId: string | undefined, onApplied: () => void) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<{ key: string; message: string }>();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => setError(undefined), [runId]);
  const act = useCallback(async (key: string, work: (clientRequestId: string) => Promise<unknown>) => {
    if (!api || !runId || inFlight.current) return false;
    inFlight.current = true; setPending(key); setError(undefined);
    try { await work(newRequestId()); onApplied(); return true; }
    catch (failure) { if (alive.current) setError({ key, message: ledgerErrorMessage(failure) }); return false; }
    finally { inFlight.current = false; if (alive.current) setPending(undefined); }
  }, [api, runId, onApplied]);
  // Stable callbacks: the summary panel re-reads its preview only when its inputs or the Run change.
  const preview = useCallback((input: { agentId?: string; throughSlotId?: string; summaryId?: string }) => api!.summary.preview({ runId: runId!, ...input }), [api, runId]);
  const generate = useCallback((input: { agentId: string; throughSlotId: string; summaryId?: string }) =>
    act('generate', clientRequestId => api!.summary.generate({ runId: runId!, clientRequestId, ...input })), [act, api, runId]);
  const confirm = useCallback((messageId: string) => act(`confirm:${messageId}`, clientRequestId => api!.summary.confirm({ runId: runId!, clientRequestId, messageId })), [act, api, runId]);
  return { preview, generate, confirm, pending, error, available: Boolean(api && runId) };
}
export type SummaryCommands = ReturnType<typeof useSummaryCommands>;

const requestStatus: Record<string, string> = { generating: '正在生成', completed: '已生成', failed: '生成失败', aborted: '已中止', interrupted: '已中断（应用重启，未自动重发）' };

/** D107: a summary in the timeline — what it covers, whether later requests use it, and its versions. */
export function SummarySlotView({ slot, snapshot, commands, summaries, ledger, onRegenerate }: { slot: TimelineSlot; snapshot: RunSnapshot; commands: HostCommands;
  summaries: SummaryCommands; ledger?: LedgerCommands; onRegenerate: (summaryId: string) => void }) {
  const [viewing, setViewing] = useState<string>();
  const [draft, setDraft] = useState<string>();
  const summary = snapshot.summaries?.find(item => item.slotId === slot.slotId);
  const index = Math.max(0, slot.versions.findIndex(version => version.messageId === (viewing ?? slot.active.messageId)));
  const shown = slot.versions[index] ?? slot.active;
  if (!summary) return null;
  const request = summary.requests.find(item => item.messageId === shown.messageId);
  const generating = summary.requests.some(item => item.status === 'generating');
  const confirmed = shown.origin === 'edit' || summary.confirmedMessageIds.includes(shown.messageId);
  const used = usedSummary(snapshot)?.summaryId === summary.summaryId && shown.active;
  const complete = shown.message.status === 'completed' && shown.message.content.trim().length > 0;
  const writable = summaryWritable(snapshot);
  const disabled = !commands.available || commands.pending !== undefined || summaries.pending !== undefined;
  const range = `第 ${summary.firstNumber}–${summary.lastNumber} 条`;
  const author = snapshot.execution?.membersSnapshot?.find(member => member.agentId === summary.agentId)?.displayName;
  const state = request?.status === 'generating' ? '正在生成摘要…'
    : !complete ? requestStatus[request?.status ?? ''] ?? statusLabels[shown.message.status] ?? '未完成'
    : !shown.active ? '未生效的历史版本'
    : used ? '已确认 · 之后的发言用它代替原文' : confirmed ? '已确认 · 已被后面的摘要取代' : '待确认 · 确认前之后的发言仍使用原文';
  const save = async () => {
    if (draft === undefined || !draft.trim() || draft === shown.message.content) return;
    if (await commands.send(`edit:${slot.slotId}`, { kind: 'editMessage', messageId: shown.messageId, content: draft }, '已保存为新版本，并按你的修改确认使用。')) { setDraft(undefined); setViewing(undefined); }
  };
  return <article className={`message summary-slot${used ? ' is-used' : ''}`} data-slot={slot.slotId} aria-label={`讨论摘要（覆盖${range}）`}>
    <strong>讨论摘要</strong><span className="host-badge">覆盖{range}</span><span className={`host-badge summary-state${used ? ' is-used' : !confirmed && complete && shown.active ? ' is-pending' : ''}`}>{state}</span>
    <div className="message-identity">{author ? `由${author}生成` : '生成成员未记录'}{shown.origin !== 'original' ? ` · ${originLabels[shown.origin]}` : ''} · 原文保留在上方，摘要只替代发给模型的内容</div>
    {shown.message.content ? <p>{shown.message.content}</p> : <p className="summary-placeholder">{request?.status === 'generating' ? '等待输出…' : '（没有生成内容）'}</p>}
    <MessageUsage charge={chargeOfMessage(snapshot, shown.messageId)} runId={snapshot.runId} ledger={ledger} />
    {shown.affectedBy.length > 0 && <p className="host-affected" role="note">受影响：这份摘要生成后，它覆盖的原文被修改或重新生成，摘要可能已经过时。之后的发言仍会看到它，并被提示以后续发言为准；可以修改或重新生成摘要。</p>}
    {complete && shown.active && !confirmed && <p className="summary-confirm-hint">请先读一遍：确认后，之后的发言会用这份摘要代替{range}原文（原文不会删除）；也可以修改后再用。</p>}
    <div className="host-version-actions" role="group" aria-label="讨论摘要的操作">
      {slot.versions.length > 1 && <>
        <button type="button" aria-label="查看上一个版本" disabled={index === 0} onClick={() => setViewing(slot.versions[index - 1].messageId)}>‹</button>
        <span aria-live="polite">版本 {index + 1}/{slot.versions.length}</span>
        <button type="button" aria-label="查看下一个版本" disabled={index === slot.versions.length - 1} onClick={() => setViewing(slot.versions[index + 1].messageId)}>›</button>
      </>}
      {complete && shown.active && !confirmed && <button type="button" className="primary" disabled={disabled} onClick={() => void summaries.confirm(shown.messageId)}>确认使用</button>}
      {!shown.active && complete && !generating && <button type="button" disabled={disabled} onClick={() => void commands.send(`select:${slot.slotId}`, { kind: 'selectVersion', messageId: shown.messageId }, '已切换当前有效版本。').then(ok => { if (ok) setViewing(undefined); })}>设为当前版本</button>}
      {draft === undefined && !generating && shown.message.status !== 'streaming' && <button type="button" disabled={disabled} onClick={() => setDraft(shown.message.content)}>修改</button>}
      {!generating && <button type="button" disabled={disabled || !writable} title={writable ? undefined : '有请求正在进行，暂停或结束后可以重新生成'} onClick={() => onRegenerate(summary.summaryId)}>重新生成…</button>}
      {generating && <button type="button" disabled={disabled} onClick={() => void commands.send('abort', { kind: 'abortGeneration' }, '已中止生成，已输出的部分保留。')}>中止生成</button>}
    </div>
    {summaries.error?.key === `confirm:${shown.messageId}` && <p role="alert" className="error">{summaries.error.message}</p>}
    {draft !== undefined && <form className="host-edit" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>修改摘要（保存为新版本，并按修改后的内容确认使用；原版本保留）<HostTextArea aria-label="修改摘要内容" autoFocus value={draft} rows={6} onChange={event => setDraft(event.target.value)} onSubmit={() => void save()} /></label>
      <button type="submit" disabled={disabled || !draft.trim() || draft === shown.message.content}>保存为新版本</button>
      <button type="button" onClick={() => setDraft(undefined)}>取消</button>
    </form>}
  </article>;
}

const reasonText = (preview: SummaryPreview): string => {
  switch (preview.reason) {
    case 'busy': return '有请求正在进行。暂停运行，或等当前回合结束后再生成摘要。';
    case 'too_few': return preview.basedOn ? `第 ${preview.basedOn.lastNumber} 条之前已经有确认的摘要；之后至少要有 2 条新发言才值得再摘要。` : '至少要有 2 条完成的发言才能生成摘要。';
    case 'covered': return preview.basedOn ? `第 1–${preview.basedOn.lastNumber} 条已经被确认的摘要覆盖，请选择更靠后的发言作为结束位置。` : '请选择一条已完成的发言作为结束位置。';
    case 'context_exceeds': return `选择的范围太长：摘要请求约 ${preview.inputTokens} tokens，超过所选成员模型可用的 ${preview.inputBudgetTokens} tokens。请缩小范围，或先为较早的发言生成摘要。`;
    case 'budget_insufficient': return preview.cost.kind === 'priced' ? `运行预算不足：这次摘要最高可能花费 ${formatYuan(preview.cost.maxMicro)}，剩余额度 ${formatYuan(preview.cost.remainingMicro)}。追加预算后再生成。` : '运行预算不足。';
    case 'unsupported': return '所选成员的模型现在不能发送请求（例如本次会话还没确认请求目标，或价格审核已过期）。请到“模型设置”处理，或换一位成员。';
    default: return '';
  }
};

/**
 * D107: the host decides to summarize — which messages, who writes it and what it may cost — and nothing is sent
 * until they press the button. Regenerating keeps the summary's coverage.
 */
export function SummaryPanel({ snapshot, summaries, ledger, summaryId, onClose }: { snapshot: RunSnapshot; summaries: SummaryCommands; ledger?: LedgerCommands;
  summaryId?: string; onClose: () => void }) {
  const [agentId, setAgentId] = useState<string>();
  const [throughSlotId, setThroughSlotId] = useState<string>();
  const [preview, setPreview] = useState<SummaryPreview>();
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const panel = useRef<HTMLElement>(null);
  // Opened from the side panel or a summary: bring it into view next to the timeline it acts on.
  useEffect(() => { panel.current?.scrollIntoView?.({ block: 'nearest' }); }, [summaryId, Boolean(preview)]);
  const { preview: load } = summaries;
  useEffect(() => {
    const id = ++request.current;
    load({ ...(agentId ? { agentId } : {}), ...(throughSlotId && !summaryId ? { throughSlotId } : {}), ...(summaryId ? { summaryId } : {}) })
      .then(result => { if (id === request.current) { setPreview(result); setFailed(false); } })
      .catch(() => { if (id === request.current) setFailed(true); });
    // Re-read when the Run changes (a top-up, a finished request) so cost and availability stay current.
  }, [load, agentId, throughSlotId, summaryId, snapshot.sequence]);
  const heading = summaryId ? '重新生成讨论摘要' : '生成讨论摘要';
  if (failed && !preview) return <section className="summary-panel" aria-label={heading}><p role="alert" className="error">无法读取摘要预估，请重试。</p><button type="button" onClick={onClose}>关闭</button></section>;
  if (!preview) return <section className="summary-panel" aria-label={heading}><p role="status">正在计算覆盖范围和预计花费…</p></section>;
  const numbers = timelineSlots(snapshot)?.filter(slot => slot.number !== undefined) ?? [];
  const range = preview.lastNumber ? `第 1–${preview.lastNumber} 条` : '';
  const shortfall = preview.reason === 'budget_insufficient' && preview.cost.kind === 'priced' ? preview.cost.maxMicro - preview.cost.remainingMicro : 0;
  const generate = async () => {
    if (!preview.available || !preview.agentId || !preview.throughSlotId) return;
    if (await summaries.generate({ agentId: preview.agentId, throughSlotId: preview.throughSlotId, ...(summaryId ? { summaryId } : {}) })) onClose();
  };
  return <section className="summary-panel" aria-label={heading} ref={panel}>
    <h3>{heading}</h3>
    <p>摘要会作为一条消息加入时间线。你确认之后，后面的发言用“摘要 + 摘要之后的原文”代替{range || '被覆盖的'}原文；原文不会删除，随时可以查看和修改。</p>
    <div className="summary-fields">
      <label>覆盖范围
        <select aria-label="摘要覆盖到第几条" value={preview.throughSlotId ?? ''} disabled={Boolean(summaryId)} onChange={event => setThroughSlotId(event.target.value)}>
          {!preview.throughSlotId && <option value="">请选择</option>}
          {preview.candidates.map(candidate => <option key={candidate.slotId} value={candidate.slotId} disabled={preview.basedOn !== undefined && candidate.number <= preview.basedOn.lastNumber}>
            第 1 条 到 第 {candidate.number} 条（{candidate.speaker}：{candidate.excerpt || '无内容'}）</option>)}
        </select>
      </label>
      <label>由谁来写
        <select aria-label="生成摘要的成员" value={preview.agentId ?? ''} onChange={event => setAgentId(event.target.value)}>
          {preview.agents.map(agent => <option key={agent.agentId} value={agent.agentId}>{agent.name}（{agent.modelId ?? '模型未记录'}）</option>)}
        </select>
      </label>
    </div>
    <p className="summary-hint">默认由综合类角色来写，并保留最近 2 条发言原文；摘要请求使用该成员的模型和 Key。{preview.basedOn ? `会在第 1–${preview.basedOn.lastNumber} 条的已确认摘要基础上续写，不再重发这些原文。` : ''}</p>
    <p className="summary-cost">{preview.cost.kind === 'free' ? '使用内置 Mock 模型，不产生费用。'
      : preview.cost.kind === 'priced' ? `预计最高 ${formatYuan(preview.cost.maxMicro)}：发送前按高峰价和输出上限预留，结束后按实际用量和时段结算，通常更低。当前剩余额度 ${formatYuan(preview.cost.remainingMicro)}。`
      : '暂时算不出预计花费。'}</p>
    {preview.reason && <p role="alert" className="summary-reason">{reasonText(preview)}</p>}
    {shortfall > 0 && ledger?.available && <button type="button" disabled={ledger.pending !== undefined} onClick={() => void ledger.addBudget(Math.max(1_000_000, Math.ceil(shortfall / 10_000) * 10_000), false)}>
      追加 {formatYuan(Math.max(1_000_000, Math.ceil(shortfall / 10_000) * 10_000), 4).replace(/0+$/u, '').replace(/\.$/u, '')} 预算</button>}
    {summaries.error?.key === 'generate' && <p role="alert" className="error">{summaries.error.message}</p>}
    <div className="summary-actions">
      <button type="button" className="primary" disabled={!preview.available || summaries.pending !== undefined} onClick={() => void generate()}>
        {summaries.pending === 'generate' ? '正在发送…' : preview.cost.kind === 'priced' ? '生成摘要（发送 1 次请求）' : '生成摘要'}</button>
      <button type="button" onClick={onClose}>取消</button>
    </div>
    {numbers.length > 0 && !summaryId && <p className="summary-hint">时间线里每条发言左上角的编号，就是这里的“第几条”。</p>}
  </section>;
}

/** D107: the moment to summarize is the host's call; this only says how full the context is and what it costs to wait. */
export function ContextHint({ snapshot, onSummarize }: { snapshot: RunSnapshot; onSummarize: () => void }) {
  const pressure = snapshot.contextPressure;
  if (!pressure || pressure.level === 'ok') return null;
  const percent = Math.min(100, Math.round(pressure.usedTokens / Math.max(1, pressure.inputBudgetTokens) * 100));
  const writable = summaryWritable(snapshot);
  return <div className="context-hint" role="status">
    <p>{pressure.level === 'over'
      ? `讨论已超过上下文上限：下一次请求有 ${pressure.omittedMessages} 条较早的发言放不下，不会发给模型（原文仍保留）。生成摘要后，后续发言能看到它们的要点。`
      : `讨论已接近上下文上限：下一次请求约占可用输入的 ${percent}%。再继续下去，较早的发言会放不下。可以生成摘要，用摘要代替较早的发言。`}
      {writable ? '' : ' 暂停或等当前回合结束后可以生成摘要。'}</p>
    <button type="button" onClick={onSummarize} disabled={!writable}>生成摘要…</button>
  </div>;
}

