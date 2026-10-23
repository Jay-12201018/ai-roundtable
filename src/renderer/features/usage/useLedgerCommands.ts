import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoundtableApiContract } from '../../../shared/contracts/app';
import { formatYuan, type AddRunBudgetResult } from '../../../shared/schemas/budget';

let fallbackCounter = 0;
const newRequestId = () => globalThis.crypto?.randomUUID?.() ?? `ledger-${Date.now()}-${++fallbackCounter}`;

const fieldMessages: Record<string, string> = {
  amountMicroCny: '金额超出允许范围：单次追加最多 ¥1000，整次运行的预算合计也不能超过 ¥1000；核销金额不能超过这次请求的预留上限。',
  basis: '依据说明需要 1–200 个字，不能包含换行等控制字符；看起来像 API Key 的内容不会被保存，请删掉后再试。',
  acknowledgedUncertainty: '请先勾选“我已在服务商控制台核对过”。',
};
const codeMessages: Record<string, string> = {
  invalid_state: '当前状态不允许这个操作：请等正在进行的请求结束后再试。',
  not_found: '没有找到这笔记录，请刷新后重试。',
  budget_exceeded: '运行预算不足，请先追加预算。',
  transport_error: '与主进程的连接失败，请重试。',
  timeout: '本次运行已达到最长运行时间，不能继续。',
};
/** The Chinese reason for a refused ledger or summary command; the public error carries only code and field. */
export function ledgerErrorMessage(error: unknown): string {
  const detail = typeof error === 'object' && error !== null ? error as { code?: string; field?: string } : {};
  return (detail.field && fieldMessages[detail.field]) ?? (detail.code && codeMessages[detail.code]) ?? '操作没有完成，请刷新后重试。';
}

/**
 * Budget top-ups and write-offs of the selected Run. One command at a time; every click gets its own clientRequestId,
 * which Main uses so a repeated delivery is recorded once (D104/D105).
 */
export function useLedgerCommands(api: Pick<RoundtableApiContract, 'run' | 'usage'> | undefined, runId: string | undefined, onApplied: () => void) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<{ key: string; message: string }>();
  const [notice, setNotice] = useState<{ key: string; message: string }>();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setError(undefined); setNotice(undefined); }, [runId]);
  const run = useCallback(async <T,>(key: string, work: (clientRequestId: string) => Promise<T>, success: (result: T) => string): Promise<T | undefined> => {
    if (!api || inFlight.current) return;
    inFlight.current = true; setPending(key); setError(undefined); setNotice(undefined);
    try {
      const result = await work(newRequestId());
      if (alive.current) setNotice({ key, message: success(result) });
      onApplied();
      return result;
    } catch (failure) {
      if (alive.current) setError({ key, message: ledgerErrorMessage(failure) });
      return;
    } finally {
      inFlight.current = false;
      if (alive.current) setPending(undefined);
    }
  }, [api, onApplied]);
  const addBudget = useCallback((amountMicroCny: number, resume: boolean) => run<AddRunBudgetResult>('budget', clientRequestId => api!.run.addBudget({ runId: runId!, clientRequestId, amountMicroCny, resume }),
    result => result.duplicate ? '这次追加已经记录过，没有重复追加。'
      : resume && !result.resumed ? `已追加 ${formatYuan(amountMicroCny)}，但运行没能继续：${ledgerErrorMessage({ code: result.resumeError })}`
      : resume ? `已追加 ${formatYuan(amountMicroCny)}，运行继续。` : `已追加 ${formatYuan(amountMicroCny)}。`), [run, api, runId]);
  const resume = useCallback(() => run('budget', () => api!.run.resumeAfterBudget(runId!), () => '运行继续。'), [run, api, runId]);
  const writeOff = useCallback((input: { runId: string; requestId: string; amountMicroCny: number; basis: string }) =>
    run(`writeoff:${input.requestId}`, clientRequestId => api!.usage.writeOff({ ...input, clientRequestId, acknowledgedUncertainty: true }),
      result => result.duplicate ? '这次核销已经记录过。' : `已核销为 ${formatYuan(input.amountMicroCny, 6)}，剩余额度和累计花费已按核销金额重新计算。`), [run, api]);
  return { addBudget, resume, writeOff, pending, error, notice, available: Boolean(api && runId) };
}
export type LedgerCommands = ReturnType<typeof useLedgerCommands>;
