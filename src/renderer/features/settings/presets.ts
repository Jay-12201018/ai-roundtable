import type { ProviderKind } from '../../../shared/contracts/configuration';

export type PresetId = 'deepseek' | 'kimi' | 'qwen' | 'glm' | 'doubao' | 'minimax' | 'custom' | 'mock';
export type ServicePreset = {
  id: PresetId; name: string; logo: string; kind: ProviderKind;
  /** The fixed address the Key goes to; null when the user types it (自定义服务) or there is none (Mock). */
  baseUrl: string | null;
  models: Array<{ id: string; name: string; hint?: string }>;
  description: string; keyHelp: string; recommended?: boolean;
};

/**
 * Built-in services for the connect wizard, all reached through their OpenAI-compatible endpoints. Addresses and model IDs
 * were read from each service's official documentation on 2026-11-03 (D142); any other model can be typed in or picked from
 * the service's list.
 * - DeepSeek: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * - Kimi: https://platform.kimi.com/docs/guide/start-using-kimi-api
 * - 通义千问: https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope , https://help.aliyun.com/zh/model-studio/models
 * - 智谱 GLM: https://docs.bigmodel.cn/cn/guide/develop/openai/introduction , https://docs.bigmodel.cn/cn/guide/start/model-overview
 * - 豆包: https://docs.volcengine.com/docs/82379/1330626 , https://docs.volcengine.com/docs/82379/1330310
 * - MiniMax: https://platform.minimax.cn/docs/api-reference/text-openai-api , https://platform.minimax.cn/docs/guides/models-intro
 */
export const presets: ServicePreset[] = [
  { id: 'deepseek', name: 'DeepSeek', logo: 'DS', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', recommended: true,
    models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash', hint: '快，适合多数讨论' }, { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }],
    description: '在 DeepSeek 开放平台创建 Key。', keyHelp: '在 DeepSeek 开放平台的「API Keys」页面创建并复制。' },
  { id: 'kimi', name: 'Kimi', logo: 'Ki', kind: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1',
    models: [{ id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro' }, { id: 'kimi-k3.1-pro-highspeed', name: 'Kimi K3.1 Pro 高速版' }],
    description: '在月之暗面开放平台创建 Key。', keyHelp: '在 Kimi 开放平台的「API Key」页面创建并复制。' },
  { id: 'qwen', name: '通义千问', logo: '通', kind: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [{ id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', hint: '性能和速度均衡' }, { id: 'qwen3.8-max', name: 'Qwen3.8 Max', hint: '复杂推理' }, { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', hint: '快' }],
    description: '在阿里云百炼创建 Key。', keyHelp: '在阿里云百炼的「API Key」页面创建并复制，地域选“华北 2（北京）”。' },
  { id: 'glm', name: '智谱 GLM', logo: 'GL', kind: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [{ id: 'glm-5.3', name: 'GLM-5.3' }, { id: 'glm-5.2', name: 'GLM-5.2' }, { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash' }],
    description: '在智谱开放平台创建 Key。', keyHelp: '在智谱开放平台的「API Keys」页面创建并复制。' },
  { id: 'doubao', name: '豆包', logo: '豆', kind: 'openai-compatible', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [{ id: 'doubao-seed-2-1-pro-260915', name: 'Doubao Seed 2.1 Pro' }, { id: 'doubao-seed-2-1-lite-260915', name: 'Doubao Seed 2.1 Lite' }, { id: 'doubao-seed-2-1-turbo-260628', name: 'Doubao Seed 2.1 Turbo' }],
    description: '在火山方舟创建 Key。', keyHelp: '在火山方舟控制台的「API Key 管理」页面创建并复制。' },
  { id: 'minimax', name: 'MiniMax', logo: 'MM', kind: 'openai-compatible', baseUrl: 'https://api.minimax.cn/v1',
    models: [{ id: 'MiniMax-M3', name: 'MiniMax M3' }, { id: 'MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash' }],
    description: '在 MiniMax 开放平台创建 Key。', keyHelp: '在 MiniMax 开放平台的「接口密钥」页面创建并复制。' },
  { id: 'custom', name: '自定义服务', logo: '⋯', kind: 'openai-compatible', baseUrl: null, models: [],
    description: '其他 OpenAI 兼容或自定义接口，填写地址、Key 和模型名。', keyHelp: '在这个服务的控制台创建并复制 API Key。' },
  { id: 'mock', name: '演示（Mock）', logo: '', kind: 'mock', baseUrl: null, models: [{ id: 'mock', name: '演示' }],
    description: '不联网，回复是预先写好的示例，不代表真实模型的水平。', keyHelp: '' },
];

/** D142: the interface a user-added service speaks; the adapters behind these are the same ones built-in services use. */
export const interfaceTypes: Array<{ kind: ProviderKind; label: string; addressRequired: boolean }> = [
  { kind: 'openai-compatible', label: 'OpenAI 兼容', addressRequired: true },
  { kind: 'anthropic', label: 'Anthropic', addressRequired: false },
  { kind: 'gemini', label: 'Gemini', addressRequired: false },
];

/** The sentence on the welcome page, from the same list the wizard offers. */
export function availabilityText(): string {
  return `支持 ${presets.filter(preset => preset.baseUrl).map(preset => preset.name).join('、')}，也可以添加其他 OpenAI 兼容或自定义接口。几位成员可以各用一家。`;
}

const normalize = (url: string | null | undefined) => url ? url.replace(/\/+$/u, '') : url;
/** The built-in service a saved Provider matches, by kind and address; anything else is a user-entered service. */
export function presetOf(provider: { kind: ProviderKind | null; baseUrl?: string | null }): ServicePreset | undefined {
  if (provider.kind === 'mock') return presets.find(preset => preset.id === 'mock');
  return provider.kind === 'openai-compatible' ? presets.find(preset => preset.baseUrl && normalize(provider.baseUrl) === preset.baseUrl) : undefined;
}
// What a kind uses when no address was saved; Main applies the same default.
const defaultAddress: Partial<Record<ProviderKind, string>> = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com/v1beta' };
/** Where Main sends this Provider's Key: its saved address, or its kind's default. */
export function targetOf(provider: { kind: ProviderKind | null; baseUrl?: string | null }): string | null {
  if (provider.kind === 'mock' || provider.kind === null) return null;
  return normalize(provider.baseUrl) ?? defaultAddress[provider.kind] ?? null;
}
/** A user-typed address (not a built-in service): the discussion says once where its content goes. */
export const isUserAddress = (provider: { kind: ProviderKind | null; baseUrl?: string | null }) => provider.kind !== 'mock' && provider.kind !== null && !presetOf(provider);
