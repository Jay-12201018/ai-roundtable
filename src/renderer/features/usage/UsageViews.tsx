import type { RunSnapshot } from '../../../shared/types/run';
import type { RequestUsage } from '../../../shared/schemas/usage';

/** The usage row of the request that produced a message: a Turn Attempt or a summary request. */
export function usageOfMessage(snapshot: RunSnapshot | undefined, messageId: string): RequestUsage | undefined {
  const requestId = snapshot?.attempts?.find(value => value.messageId === messageId)?.requestId
    ?? snapshot?.summaries?.flatMap(summary => summary.requests).find(request => request.messageId === messageId)?.requestId;
  return requestId ? snapshot?.usage?.find(usage => usage.requestId === requestId) : undefined;
}

/** This Run's token totals; only provider-reported usage adds tokens (D133). */
export function runTokenTotals(snapshot: RunSnapshot) {
  const rows = snapshot.usage ?? [];
  const reported = rows.filter(usage => usage.state === 'reported');
  return { requests: rows.filter(usage => usage.state !== 'not_sent').length, unknownRequests: rows.filter(usage => usage.state === 'unknown').length,
    inputTokens: reported.reduce((total, usage) => total + (usage.inputTokens ?? 0), 0), outputTokens: reported.reduce((total, usage) => total + (usage.outputTokens ?? 0), 0) };
}

const fieldMessages: Record<string, string> = {};
const codeMessages: Record<string, string> = {
  invalid_state: '当前状态不允许这个操作：请等正在进行的请求结束后再试。',
  not_found: '没有找到这条记录，请刷新后重试。',
  transport_error: '与主进程的连接失败，请重试。',
  timeout: '本次运行已达到最长运行时间，不能继续。',
};
/** The Chinese reason for a refused summary or artifact command; the public error carries only code and field. */
export function commandErrorMessage(error: unknown): string {
  const detail = typeof error === 'object' && error !== null ? error as { code?: string; field?: string } : {};
  return (detail.field && fieldMessages[detail.field]) ?? (detail.code && codeMessages[detail.code]) ?? '操作没有完成，请刷新后重试。';
}
