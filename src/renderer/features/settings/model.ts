import type { ModelReadiness, ProviderReadiness, ProviderSettingsApiContract, ProviderSummary } from '../../../shared/contracts/configuration';
import { ContractError } from '../../../shared/contracts/errors';
import { looksLikeApiKey } from '../../../shared/schemas/common';
import { apiErrorSchema, type ErrorCode } from '../../../shared/schemas/error';

const messages: Record<ErrorCode, string> = {
  invalid_input: '有一项填写不对，请检查名称、模型和地址。', invalid_response: '返回结果无效，请重新打开设置。',
  forbidden: '服务商拒绝了这次访问。', unsupported: '这个服务不支持这样使用（例如没有模型列表接口）。', not_found: '这个服务已经不存在，请重新打开设置。',
  invalid_state: '现在不能这样操作：可能有讨论正在使用它，或还有成员、讨论记录引用它。', internal_error: '操作失败，请重试。',
  transport_error: '连接中断，请重试。', authentication_failed: 'Key 无效或已过期，请检查后重新填写。', rate_limited: '请求太频繁，请稍后再试。',
  timeout: '服务没有及时回应，请稍后再试。', cancelled: '已取消。', network_error: '连接不上，请检查网络和地址。',
  target_rejected: '这个地址解析到了内网或保留地址，不会直接连接。请检查地址。',
  budget_exceeded: '这是旧版本因预算限制留下的记录。',
};
/** A fixed Chinese message per error code; never the error text itself, which could carry an echoed secret. */
export function errorMessage(error: unknown): string {
  const parsed = apiErrorSchema.safeParse(error instanceof ContractError ? error.detail : error);
  return messages[parsed.success ? parsed.data.code : 'internal_error'];
}
export function errorCode(error: unknown): ErrorCode {
  const parsed = apiErrorSchema.safeParse(error instanceof ContractError ? error.detail : error);
  return parsed.success ? parsed.data.code : 'internal_error';
}

// D096: a pasted API Key never becomes a model ID.
export const keyInModelFieldMessage = '这看起来是 API Key，不是模型名。Key 请填在「API Key」一栏；这里只填模型名，例如 deepseek-flash。';
export const modelIdProblem = (id: string) => looksLikeApiKey(id) ? keyInModelFieldMessage : undefined;

export type ServiceStatus = { tone: 'ok' | 'warn' | 'neutral' | 'danger'; label: string; detail: string };
/** One status per service card, the most useful next step first (README 功能对照「接入进度」). */
export function serviceStatus(summary: ProviderSummary, readiness: ProviderReadiness | undefined): ServiceStatus {
  if (!summary.configurationValid || summary.kind === null) return { tone: 'danger', label: '配置有问题', detail: '这条配置读不出来，可以在“高级与删除”里删除后重新添加。' };
  if (!summary.enabled) return { tone: 'neutral', label: '已停用', detail: '停用时不会发送任何请求，成员也不能用它。' };
  if (summary.kind === 'mock') return { tone: 'neutral', label: '内置', detail: '不联网，回复是预先写好的示例，不代表真实模型的水平。' };
  if (!readiness) return { tone: 'neutral', label: '正在读取', detail: '正在读取这个服务的状态…' };
  if (readiness.keyState === 'missing') return { tone: 'warn', label: '还没填写 Key', detail: '保存了配置，但还不能使用。' };
  if (readiness.keyState === 'unavailable') return { tone: 'warn', label: 'Key 读不出来', detail: '保存的 Key 现在读不出来，请重新填写。' };
  if (readiness.models.some(model => model.usable)) return { tone: 'ok', label: '可以使用', detail: '' };
  if (readiness.models.length === 0) return { tone: 'warn', label: '还没添加模型', detail: '添加一个模型后，成员才能选用它。' };
  return { tone: 'warn', label: '暂时不能使用', detail: '检查这个服务是否已启用。' };
}

/** Why a model cannot take part in a discussion now, in one short clause; empty when it can. */
export function modelBlockText(model: Pick<ModelReadiness, 'blockedBy'> | undefined): string {
  if (!model) return '';
  switch (model.blockedBy) {
    case null: return '';
    case 'disabled': return '服务已停用';
    case 'invalid': return '服务配置有问题';
    case 'key': return '还没填写 Key';
    default: return '状态未知';
  }
}

export type ServiceTest = { tone: 'ok' | 'warn'; text: string };
/**
 * 测试连接 (D136): the service's model list when it has one, which generates nothing; otherwise one very short message,
 * since that is the only way left to know. The page says the second may cost a little.
 */
export async function testService(api: Pick<ProviderSettingsApiContract, 'testConnection'>, provider: { id: string; kind: ProviderSummary['kind'] }, modelId: string | null | undefined): Promise<ServiceTest> {
  if (provider.kind === 'mock') return { tone: 'ok', text: '演示服务可以使用' };
  const auth = (await api.testConnection({ providerId: provider.id, level: 'authentication' })).result;
  if (auth.ok) return { tone: 'ok', text: 'Key 有效，连接正常' };
  if (!['unsupported', 'invalid_response'].includes(auth.error.code) || !modelId) return { tone: 'warn', text: errorMessage(auth.error) };
  const reply = (await api.testConnection({ providerId: provider.id, level: 'generation', modelId, allowGeneration: true })).result;
  return reply.ok ? { tone: 'ok', text: '已收到回复，连接正常' } : { tone: 'warn', text: errorMessage(reply.error) };
}
