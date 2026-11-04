import type { RequestUsage } from '../../../shared/schemas/usage';
import type { ErrorCode } from '../../../shared/schemas/error';

const causes: Partial<Record<ErrorCode, string>> = {
  network_error: '网络中断或连不上服务', timeout: '服务没有及时回应（超时）', rate_limited: '服务商限流（请求太频繁）',
  authentication_failed: 'Key 无效或已过期', invalid_input: '服务商拒绝了这次请求，可能是模型名或参数不对，或账户余额不足', not_found: '服务商找不到这个模型，或者它还没在服务商那里开通，请到服务商控制台检查', forbidden: '服务商拒绝了这次访问', invalid_response: '服务返回的内容不完整或格式不对', internal_error: '服务商或应用内部出错',
  budget_exceeded: '旧版本的预算限制', target_rejected: '这个服务的地址解析到了内网或保留地址', service_unsupported: '这个服务已不再支持', model_unsupported: '这个模型已不再支持', unsupported: '这个模型现在不能发送请求', transport_error: '应用内部连接中断',
};
const nextSteps: Partial<Record<ErrorCode, string>> = {
  authentication_failed: '请到“设置”检查 Key，再重新生成。', rate_limited: '稍等一会儿再重新生成。',
};

/**
 * D125: why a summary or artifact request ended without a result and what the host can do — in plain
 * words, from the public error code only. Nothing here is ever retried on its own.
 */
export function requestFailureText(input: { status: 'failed' | 'aborted' | 'interrupted'; errorCode?: ErrorCode; usage?: RequestUsage }): string {
  const { status, errorCode, usage } = input;
  const cause = status === 'interrupted' ? '应用退出时这次请求还没完成，已标为中断。'
    : status === 'aborted' ? errorCode === 'timeout' ? '这次请求超过了运行时长上限，已停止。' : '这次请求已中止。'
    : errorCode && causes[errorCode] ? `请求失败：${causes[errorCode]}。` : '请求失败（原因没有记录）。';
  const sent = !usage ? '' : usage.state === 'unknown' ? '请求可能已经发出，服务商可能已经计入用量。' : usage.state === 'not_sent' ? '请求没有发出。' : '';
  const next = (errorCode && nextSteps[errorCode]) ?? '没有自动重试，可以重新生成。';
  return [cause, sent, next].filter(Boolean).join('');
}
