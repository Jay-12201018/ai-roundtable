import { formatYuan, type RequestCharge } from '../../../shared/schemas/budget';
import type { ErrorCode } from '../../../shared/schemas/error';

const causes: Partial<Record<ErrorCode, string>> = {
  network_error: '网络中断或连不上服务', timeout: '服务没有及时回应（超时）', rate_limited: '服务商限流（请求太频繁）',
  authentication_failed: 'Key 无效或已过期', invalid_response: '服务返回的内容不完整或格式不对', internal_error: '服务商或应用内部出错',
  budget_exceeded: '运行预算不足', unsupported: '这个模型现在不能发送请求', transport_error: '应用内部连接中断',
};
const nextSteps: Partial<Record<ErrorCode, string>> = {
  authentication_failed: '请到“设置”检查 Key，再重新生成。', rate_limited: '稍等一会儿再重新生成。', budget_exceeded: '追加预算后再重新生成。',
};

/**
 * D125: why a summary or artifact request ended without a result, what it cost, and what the host can do — in plain
 * words, from the public error code only. Nothing here is ever retried on its own.
 */
export function requestFailureText(input: { status: 'failed' | 'aborted' | 'interrupted'; errorCode?: ErrorCode; charge?: RequestCharge }): string {
  const { status, errorCode, charge } = input;
  const cause = status === 'interrupted' ? '应用退出时这次请求还没完成，已标为中断。'
    : status === 'aborted' ? errorCode === 'timeout' ? '这次请求超过了运行时长上限，已停止。' : '这次请求已中止。'
    : errorCode && causes[errorCode] ? `请求失败：${causes[errorCode]}。` : '请求失败（原因没有记录）。';
  const cost = !charge ? ''
    : charge.state === 'unknown' ? charge.writeOffs?.length ? `费用已按你核销的 ${formatYuan(charge.chargedMicro)} 计。`
      : `请求可能已经发出，费用暂记为未知（按上限 ${formatYuan(charge.reservedMicro)} 计）；可以到服务商控制台核对后，在用量页核销。`
    : charge.state === 'not_sent' ? '请求没有发出，不收费。'
    : charge.state === 'settled' ? `已按实际用量结算（${formatYuan(charge.chargedMicro)}）。` : '';
  const next = (errorCode && nextSteps[errorCode]) ?? '没有自动重试，可以重新生成。';
  return [cause, cost, next].filter(Boolean).join('');
}
