import type { ModelReadiness, ProviderReadiness, ProviderSettingsApiContract, ProviderSummary } from '../../../shared/contracts/configuration';
import { ContractError } from '../../../shared/contracts/errors';
import { apiErrorSchema, type ErrorCode } from '../../../shared/schemas/error';

const messages: Record<ErrorCode, string> = {
  invalid_input: '有一项填写不对，请检查后再试。', invalid_response: '返回结果无效，请重新打开设置。',
  forbidden: '服务商拒绝了这次访问。', unsupported: '这个服务不支持这样使用。', not_found: '这个服务已经不存在，请重新打开设置。',
  invalid_state: '现在不能这样操作：可能有讨论正在使用它，或还有成员、讨论记录引用它。', internal_error: '操作失败，请重试。',
  transport_error: '连接中断，请重试。', authentication_failed: 'Key 无效或已过期，请检查后重新填写。', rate_limited: '请求太频繁，请稍后再试。',
  timeout: '服务没有及时回应，请稍后再试。', cancelled: '已取消。', network_error: '连接不上，请检查网络。',
  target_rejected: '这个服务的地址解析到了内网或保留地址，请求没有发出。请检查网络后再试。',
  service_unsupported: '这个服务已不再支持，可以删除它。', model_unsupported: '这个模型已不再支持，请换一个。',
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

export type ServiceStatus = { tone: 'ok' | 'warn' | 'neutral' | 'danger'; label: string; detail: string };
/** One status per service card, the most useful next step first (README 功能对照「接入进度」). */
export function serviceStatus(summary: ProviderSummary, readiness: ProviderReadiness | undefined): ServiceStatus {
  if (!summary.configurationValid || summary.kind === null) return { tone: 'danger', label: '配置有问题', detail: '这条配置读不出来，可以在“高级与删除”里删除后重新添加。' };
  if (readiness?.supported === false) return { tone: 'neutral', label: '已停用', detail: '这个服务已不再支持，可以删除。' };
  if (!summary.enabled) return { tone: 'neutral', label: '已停用', detail: '停用时不会发送任何请求，成员也不能用它。' };
  if (summary.kind === 'mock') return { tone: 'neutral', label: '内置', detail: '不联网，回复是预先写好的示例，不代表真实模型的水平。' };
  if (!readiness) return { tone: 'neutral', label: '正在读取', detail: '正在读取这个服务的状态…' };
  if (readiness.keyState === 'missing') return { tone: 'warn', label: '还没填写 Key', detail: '保存了配置，但还不能使用。' };
  if (readiness.keyState === 'unavailable') return { tone: 'warn', label: 'Key 读不出来', detail: '保存的 Key 现在读不出来，请重新填写。' };
  if (readiness.models.some(model => model.usable)) return { tone: 'ok', label: '可以使用', detail: '' };
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
    case 'unsupported': return '这个模型已不再支持';
    default: return '状态未知';
  }
}

export type ServiceTest = { tone: 'ok' | 'warn'; text: string };
/** 测试连接: one very short message to the chosen model, since that is the only way to know. The page says it may cost a little. */
export async function testService(api: Pick<ProviderSettingsApiContract, 'testConnection'>, provider: { id: string; kind: ProviderSummary['kind'] }, modelId: string | null | undefined): Promise<ServiceTest> {
  if (provider.kind === 'mock') return { tone: 'ok', text: '演示服务可以使用' };
  if (!modelId) return { tone: 'warn', text: '请先选一个模型。' };
  const reply = (await api.testConnection({ providerId: provider.id, level: 'generation', modelId, allowGeneration: true })).result;
  return reply.ok ? { tone: 'ok', text: '已收到回复，连接正常' } : { tone: 'warn', text: errorMessage(reply.error) };
}

/** D143: such a model takes part with text; nothing on the page should suggest images can be sent. */
export const multimodalText = '标“多模态”的模型能看图，目前在圆桌里只用文字讨论。';
export const delistedText = '服务商列表里已经没有这个模型，可能已下线';

/** D143: where the model list on the page comes from, in one plain sentence. */
export function discoveryText(discovery: ProviderReadiness['discovery']): string {
  switch (discovery?.outcome) {
    case 'listed': return `已按服务商的列表更新（${new Date(discovery.checkedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}），新发现的模型排在后面。`;
    case 'unsupported': return '这家服务没有给出可用的模型列表，继续用内置列表。';
    case 'authentication_failed': return 'Key 没有通过，模型列表没有更新；内置列表照常可选。';
    case 'failed': return '这次没连上服务商，模型列表没有更新；内置列表照常可选。';
    default: return '还没向服务商查过模型列表，现在显示内置列表。';
  }
}

/** D143: on opening a page that shows models. Main looks at most once a day per service; nothing here waits for it. */
export function refreshStaleModels(api: Pick<ProviderSettingsApiContract, 'refreshModels'>, providers: readonly ProviderSummary[]) {
  for (const provider of providers) if (provider.enabled && provider.kind !== null && provider.kind !== 'mock') void api.refreshModels?.({ providerId: provider.id })?.catch(() => {});
}
