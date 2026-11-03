import type { ProviderKind } from '../../../shared/contracts/configuration';

export type PresetId = 'deepseek' | 'openai' | 'anthropic' | 'gemini' | 'compatible' | 'mock';
export type ServicePreset = {
  id: PresetId; name: string; logo: string; kind: ProviderKind;
  /** The fixed address the Key goes to; null when the user types it (其他兼容服务) or there is none (Mock). */
  baseUrl: string | null;
  models: Array<{ id: string; name: string; hint?: string }>;
  description: string; keyHelp: string; recommended?: boolean;
};

/**
 * Built-in services for the connect wizard. Addresses are the official ones Main also enforces. Model IDs were read from
 * the official documentation on 2026-11-03 (D134); any other model can be typed in or picked from the service's list.
 * - DeepSeek: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * - OpenAI: https://developers.openai.com/api/docs/models
 * - Anthropic: https://platform.claude.com/docs/en/about-claude/models/overview
 * - Gemini: https://aistudio.google.com/docs/models
 */
export const presets: ServicePreset[] = [
  { id: 'deepseek', name: 'DeepSeek', logo: 'DS', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', recommended: true,
    models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash', hint: '快，适合多数讨论' }, { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }],
    description: '中文好，官方接口。',
    keyHelp: '在 DeepSeek 开放平台的「API Keys」页面创建并复制。' },
  { id: 'openai', name: 'OpenAI', logo: 'AI', kind: 'openai', baseUrl: 'https://api.openai.com/v1',
    models: [{ id: 'gpt-6-astra', name: 'GPT-6 Astra', hint: '官方推荐的起点' }, { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }, { id: 'gpt-6-luna', name: 'GPT-6 Luna', hint: '高效，适合大量请求' }],
    description: '官方接口。',
    keyHelp: '在 OpenAI 控制台的「API keys」页面创建并复制。' },
  { id: 'anthropic', name: 'Anthropic Claude', logo: 'An', kind: 'anthropic', baseUrl: 'https://api.anthropic.com',
    models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', hint: '官方推荐的起点' }, { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', hint: '速度和能力均衡' }, { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', hint: '最快' }],
    description: '官方接口。',
    keyHelp: '在 Anthropic Console 的「API Keys」页面创建并复制。' },
  { id: 'gemini', name: 'Google Gemini', logo: 'G', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }, { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', hint: '最快' }],
    description: '官方接口。',
    keyHelp: '在 Google AI Studio 的「Get API key」页面创建并复制。' },
  { id: 'compatible', name: '其他兼容服务', logo: '⋯', kind: 'openai-compatible', baseUrl: null,
    models: [],
    description: 'Kimi、通义千问、智谱、硅基流动等兼容 OpenAI 接口的服务，需要填写地址和模型名。',
    keyHelp: '在这个服务的控制台创建并复制 API Key。' },
  { id: 'mock', name: '演示（Mock）', logo: '', kind: 'mock', baseUrl: null,
    models: [{ id: 'mock', name: '演示' }],
    description: '不联网，回复是预先写好的示例，不代表真实模型的水平。',
    keyHelp: '' },
];

/** What can be used for a discussion, from the same list the wizard offers. */
export function availabilityText(): string {
  const names = presets.filter(preset => preset.kind !== 'mock' && preset.id !== 'compatible').map(preset => preset.name);
  return `支持 ${names.join('、')}，以及其他兼容 OpenAI 接口的服务。三位成员可以各用一家。`;
}

const normalize = (url: string | null | undefined) => url ? url.replace(/\/+$/u, '') : url;
/** The built-in service a saved Provider matches, by kind and address; anything else is a user-entered service. */
export function presetOf(provider: { kind: ProviderKind | null; baseUrl?: string | null }): ServicePreset | undefined {
  if (provider.kind === 'mock') return presets.find(preset => preset.id === 'mock');
  if (provider.kind === 'openai-compatible') return normalize(provider.baseUrl) === 'https://api.deepseek.com' ? presets[0] : undefined;
  return presets.find(preset => preset.kind === provider.kind && preset.id !== 'compatible');
}
/** Where Main sends this Provider's Key: its saved address, or the fixed official one. */
export function targetOf(provider: { kind: ProviderKind | null; baseUrl?: string | null }): string | null {
  if (provider.kind === 'mock' || provider.kind === null) return null;
  return normalize(provider.baseUrl) ?? normalize(presets.find(preset => preset.kind === provider.kind && preset.id !== 'compatible')?.baseUrl) ?? null;
}
/** A user-typed address (not a built-in service): the discussion says once where its content goes (D113, R16 D1-B). */
export const isUserAddress = (provider: { kind: ProviderKind | null; baseUrl?: string | null }) => provider.kind === 'openai-compatible' && !presetOf(provider);
