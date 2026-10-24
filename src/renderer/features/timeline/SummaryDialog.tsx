import { useEffect, useRef, useState } from 'react';
import type { RunSnapshot } from '../../../shared/types/run';
import type { SummaryPreview } from '../../../shared/schemas/summary';
import { formatYuan } from '../../../shared/schemas/budget';
import { Button, Modal } from '../../components/ui';
import { timelineSlots } from '../host/model';
import type { SummaryCommands } from '../host/useSummaryCommands';
import type { LedgerCommands } from '../usage';

const reasonText = (preview: SummaryPreview): string => {
  switch (preview.reason) {
    case 'busy': return '有请求正在进行。暂停运行，或等当前回合结束后再生成摘要。';
    case 'too_few': return preview.basedOn ? `第 ${preview.basedOn.lastNumber} 条之前已经有确认的摘要；之后至少要有 2 条新发言才值得再摘要。` : '至少要有 2 条完成的发言才能生成摘要。';
    case 'covered': return preview.basedOn ? `第 1–${preview.basedOn.lastNumber} 条已经被确认的摘要覆盖，请选择更靠后的发言作为结束位置。` : '请选择一条已完成的发言作为结束位置。';
    case 'context_exceeds': return `选择的范围太长：摘要请求约 ${preview.inputTokens} tokens，超过所选成员模型可用的 ${preview.inputBudgetTokens} tokens。请缩小范围，或先为较早的发言生成摘要。`;
    case 'budget_insufficient': return preview.cost.kind === 'priced' ? `运行预算不足：这次摘要最高可能花费 ${formatYuan(preview.cost.maxMicro)}，剩余额度 ${formatYuan(preview.cost.remainingMicro)}。追加预算后再生成。` : '运行预算不足。';
    case 'unsupported': return '所选成员的模型现在不能发送请求（例如本次会话还没确认请求目标，或价格审核已过期）。请到“设置”处理，或换一位成员。';
    default: return '';
  }
};
const yuanText = (micro: number) => formatYuan(micro, 4).replace(/0+$/u, '').replace(/\.$/u, '');

/**
 * D107: the host decides to summarize — which messages, who writes it and what it may cost — and nothing is sent
 * until they press the button. Regenerating keeps the summary's coverage.
 */
export function SummaryDialog({ snapshot, summaries, ledger, summaryId, onClose }: { snapshot: RunSnapshot; summaries: SummaryCommands; ledger?: LedgerCommands;
  summaryId?: string; onClose: () => void }) {
  const [agentId, setAgentId] = useState<string>();
  const [throughSlotId, setThroughSlotId] = useState<string>();
  const [preview, setPreview] = useState<SummaryPreview>();
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const { preview: load } = summaries;
  useEffect(() => {
    const id = ++request.current;
    load({ ...(agentId ? { agentId } : {}), ...(throughSlotId && !summaryId ? { throughSlotId } : {}), ...(summaryId ? { summaryId } : {}) })
      .then(result => { if (id === request.current) { setPreview(result); setFailed(false); } })
      .catch(() => { if (id === request.current) setFailed(true); });
    // Re-read when the Run changes (a top-up, a finished request) so cost and availability stay current.
  }, [load, agentId, throughSlotId, summaryId, snapshot.sequence]);
  const heading = summaryId ? '重新生成讨论摘要' : '生成讨论摘要';
  const busy = summaries.pending !== undefined;
  if (failed && !preview) return <Modal title={heading} onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}><p role="alert" className="field-error">无法读取摘要预估，请重试。</p></Modal>;
  if (!preview) return <Modal title={heading} onClose={onClose}><p role="status">正在计算覆盖范围和预计花费…</p></Modal>;
  const numbered = timelineSlots(snapshot)?.filter(slot => slot.number !== undefined) ?? [];
  const range = preview.lastNumber ? `第 1–${preview.lastNumber} 条` : '';
  const shortfall = preview.reason === 'budget_insufficient' && preview.cost.kind === 'priced' ? preview.cost.maxMicro - preview.cost.remainingMicro : 0;
  const topUp = Math.max(1_000_000, Math.ceil(shortfall / 10_000) * 10_000);
  const generate = async () => {
    if (!preview.available || !preview.agentId || !preview.throughSlotId) return;
    if (await summaries.generate({ agentId: preview.agentId, throughSlotId: preview.throughSlotId, ...(summaryId ? { summaryId } : {}) })) onClose();
  };
  return <Modal title={heading} onClose={onClose} busy={busy}
    description={`摘要会作为一条消息加入时间线。你确认之后，后面的发言用“摘要 + 摘要之后的原文”代替${range || '被覆盖的'}原文；原文不会删除，随时可以查看和修改。`}
    footer={<>
      <span className="is-left tabular">{preview.cost.kind === 'free' ? '内置 Mock，不花钱' : preview.cost.kind === 'priced' ? `预计最多 ${formatYuan(preview.cost.maxMicro)}` : '暂时算不出预计花费'}</span>
      <Button onClick={onClose} disabled={busy}>取消</Button>
      <Button variant="primary" disabled={!preview.available || busy} onClick={() => void generate()}>
        {summaries.pending === 'generate' ? '正在发送…' : preview.cost.kind === 'priced' ? '生成摘要（发送 1 次请求）' : '生成摘要'}</Button>
    </>}>
    <div className="summary-fields">
      <label className="field"><span>覆盖范围</span>
        <select className="select" aria-label="摘要覆盖到第几条" value={preview.throughSlotId ?? ''} disabled={Boolean(summaryId)} onChange={event => setThroughSlotId(event.target.value)}>
          {!preview.throughSlotId && <option value="">请选择</option>}
          {preview.candidates.map(candidate => <option key={candidate.slotId} value={candidate.slotId} disabled={preview.basedOn !== undefined && candidate.number <= preview.basedOn.lastNumber}>
            第 1 条 到 第 {candidate.number} 条（{candidate.speaker}：{candidate.excerpt || '无内容'}）</option>)}
        </select>
        {numbered.length > 0 && !summaryId && <p className="field-help">时间线里每条发言右上角的编号，就是这里的“第几条”。</p>}
      </label>
      <label className="field"><span>由谁来写</span>
        <select className="select" aria-label="生成摘要的成员" value={preview.agentId ?? ''} onChange={event => setAgentId(event.target.value)}>
          {preview.agents.map(agent => <option key={agent.agentId} value={agent.agentId}>{agent.name}（{agent.modelId ?? '模型未记录'}）</option>)}
        </select>
        <p className="field-help">默认由综合类角色来写，并保留最近 2 条发言原文；摘要请求使用该成员的模型和 Key。{preview.basedOn ? `会在第 1–${preview.basedOn.lastNumber} 条的已确认摘要基础上续写，不再重发这些原文。` : ''}</p>
      </label>
    </div>
    <p className="summary-cost">{preview.cost.kind === 'free' ? '使用内置 Mock 模型，不产生费用。'
      : preview.cost.kind === 'priced' ? `预计最高 ${formatYuan(preview.cost.maxMicro)}：发送前按高峰价和输出上限预留，结束后按实际用量和时段结算，通常更低。当前剩余额度 ${formatYuan(preview.cost.remainingMicro)}。`
      : '暂时算不出预计花费。'}</p>
    {preview.reason && <p role="alert" className="summary-reason">{reasonText(preview)}</p>}
    {shortfall > 0 && ledger?.available && <Button disabled={ledger.pending !== undefined} onClick={() => void ledger.addBudget(topUp, false)}>追加 {yuanText(topUp)} 预算</Button>}
    {summaries.error?.key === 'generate' && <p role="alert" className="field-error">{summaries.error.message}</p>}
  </Modal>;
}
