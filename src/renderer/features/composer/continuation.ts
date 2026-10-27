import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunApiContract } from '../../../shared/contracts/run';
import type { ContinuationPreview } from '../../../shared/schemas/continuation';
import { formatYuan } from '../../../shared/schemas/budget';
import { hostErrorMessage } from '../host/model';

let fallbackCounter = 0;
const newRequestId = () => globalThis.crypto?.randomUUID?.() ?? `continue-${Date.now()}-${++fallbackCounter}`;

export type ContinuationOutcome = { ok: true; agentIds: string[] } | { ok: false; message: string };
const continueErrors: Record<string, string> = {
  budget_exceeded: '剩余预算不够第一次发言，先在「本场信息 › 进度」追加预算。',
  invalid_state: '这场讨论现在不能继续：请等当前请求结束，或刷新后再试。',
  unsupported: '有成员的模型现在不能使用（例如价格未审核或服务商已删除），没有发送。',
};

/**
 * D111: continue a finished discussion in the same Run. The preview (who answers, maximum cost) follows what the
 * host types, a moment after typing stops; sending is one trusted command with its own clientRequestId.
 */
export function useContinuation(api: Pick<RunApiContract, 'previewContinuation' | 'continueDiscussion'> | undefined, runId: string | undefined,
  enabled: boolean, request: { content: string; agentId?: string }, onApplied: () => void) {
  const [preview, setPreview] = useState<ContinuationPreview>();
  const [previewFailed, setPreviewFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const { content, agentId } = request;
  useEffect(() => {
    if (!api || !runId || !enabled) { setPreview(undefined); return; }
    let current = true;
    const timer = setTimeout(() => {
      api.previewContinuation({ runId, content, ...(agentId ? { agentId } : {}) })
        .then(result => { if (current) { setPreview(result); setPreviewFailed(false); } })
        .catch(() => { if (current) { setPreview(undefined); setPreviewFailed(true); } });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [api, runId, enabled, content, agentId]);
  const send = useCallback(async (input: { content: string; agentId?: string }): Promise<ContinuationOutcome> => {
    if (!api || !runId) return { ok: false, message: '这场讨论还没有开始，暂时不能继续。' };
    if (inFlight.current) return { ok: false, message: '上一个操作还在等待主进程确认，请稍后再试。' };
    inFlight.current = true; setSending(true);
    try {
      const result = await api.continueDiscussion({ runId, clientRequestId: newRequestId(), content: input.content, ...(input.agentId ? { agentId: input.agentId } : {}) });
      onApplied();
      return { ok: true, agentIds: result.agentIds };
    } catch (failure) {
      const code = typeof failure === 'object' && failure !== null && 'code' in failure ? String((failure as { code: unknown }).code) : '';
      return { ok: false, message: continueErrors[code] ?? hostErrorMessage(failure) };
    } finally { inFlight.current = false; setSending(false); }
  }, [api, runId, onApplied]);
  return { preview, previewFailed, send, sending };
}

/** One line on who will answer and what it may cost, said before sending. */
export function continuationSummary(preview: ContinuationPreview | undefined, names: (agentId: string) => string): { text: string; warn?: string } | undefined {
  if (!preview) return undefined;
  const who = preview.agentIds.length === 1 ? `只由${names(preview.agentIds[0])}回应一次` : `${preview.agentIds.map(names).join(' → ')} 各发言一次`;
  if (preview.reason === 'member_unavailable') return { text: '没有可以回应的成员。', warn: '点名的成员（或全部成员）已在房间里停用或归档，不能回应。改点其他成员，或去「管理房间与成员」重新启用。' };
  if (preview.reason === 'context_exceeds') return { text: `发送后：${who}`, warn: '讨论已经太长，放不进成员模型的上下文：先在「本场信息 › 进度」生成讨论摘要，再继续。' };
  if (preview.reason === 'unsupported') return { text: `发送后：${who}`, warn: '有成员的模型现在不能使用（例如价格未审核或服务商已删除），暂时不能继续。' };
  if (preview.reason === 'busy' || preview.reason === 'not_finished') return { text: '等当前请求结束后，可以在这场讨论里继续。' };
  const cost = preview.cost;
  if (cost.kind === 'free') return { text: `发送后：${who} · 不产生费用` };
  if (cost.kind === 'unavailable') return { text: `发送后：${who}` };
  const money = `预计最高约 ${formatYuan(cost.maxMicro)}（按写满单次上限、高峰价预留，实际按用量结算，通常低得多），剩余预算 ${formatYuan(cost.remainingMicro)}`;
  if (preview.reason === 'budget_insufficient') return { text: `发送后：${who} · ${money}`, warn: `剩余预算不够第一次发言（最多约 ${formatYuan(cost.firstMicro)}）：先追加预算，再继续。` };
  return { text: `发送后：${who} · ${money}`,
    ...(cost.maxMicro > cost.remainingMicro ? { warn: '剩余预算可能不够这一整轮：花到上限就会停下，已有发言都保留，可以追加后继续。' } : {}) };
}
