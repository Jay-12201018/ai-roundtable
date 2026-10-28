import type { ProviderKind } from '../../../shared/contracts/configuration';

export type PresetId = 'deepseek' | 'openai' | 'anthropic' | 'gemini' | 'compatible' | 'mock';
export type ServicePreset = {
  id: PresetId; name: string; logo: string; kind: ProviderKind;
  /** The fixed address the Key goes to; null when the user types it (其他兼容服务) or there is none (Mock). */
  baseUrl: string | null;
  models: Array<{ id: string; name: string; hint?: string }>;
  description: string; keyHelp: string; recommended?: boolean;
  /** Static: no reviewed price exists in Main for this kind, so Main refuses its discussion requests (D114). */
  priceUnreviewed: boolean;
};

/**
 * Built-in services for the connect wizard (README「十个已知体验问题」1, PROVIDER_CATALOG_PLAN). Addresses are the
 * official ones Main also enforces; only DeepSeek Flash has a reviewed price, so the others say so before setup.
 */
export const presets: ServicePreset[] = [
  { id: 'deepseek', name: 'DeepSeek', logo: 'DS', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', recommended: true, priceUnreviewed: false,
    models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash', hint: '快、便宜，适合多数讨论' }],
    description: '中文好、价格低。DeepSeek Flash 已按官方价格核对，可以用于讨论。',
    keyHelp: '在 DeepSeek 开放平台的「API Keys」页面创建并复制。' },
  { id: 'openai', name: 'OpenAI', logo: 'AI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', priceUnreviewed: true,
    models: [{ id: 'gpt-4o-mini', name: 'GPT-4o mini' }],
    description: '官方接口。价格尚未审核，暂时不能用于讨论。',
    keyHelp: '在 OpenAI 控制台的「API keys」页面创建并复制。' },
  { id: 'anthropic', name: 'Anthropic Claude', logo: 'An', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', priceUnreviewed: true,
    models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }],
    description: '官方接口。价格尚未审核，暂时不能用于讨论。',
    keyHelp: '在 Anthropic Console 的「API Keys」页面创建并复制。' },
  { id: 'gemini', name: 'Google Gemini', logo: 'G', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', priceUnreviewed: true,
    models: [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }],
    description: '官方接口。价格尚未审核，暂时不能用于讨论。',
    keyHelp: '在 Google AI Studio 的「Get API key」页面创建并复制。' },
  { id: 'compatible', name: '其他兼容服务', logo: '⋯', kind: 'openai-compatible', baseUrl: null, priceUnreviewed: true,
    models: [],
    description: 'Kimi、通义千问、硅基流动等兼容 OpenAI 接口的服务，需要填写地址。价格尚未审核，暂时不能用于讨论。',
    keyHelp: '在这个服务的控制台创建并复制 API Key。' },
  { id: 'mock', name: '演示（Mock）', logo: '', kind: 'mock', baseUrl: null, priceUnreviewed: false,
    models: [{ id: 'mock', name: '演示' }],
    description: '不联网、不花钱，回复是预先写好的示例，不代表真实模型的水平。',
    keyHelp: '' },
];

const listed = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join('、')} 和${names.at(-1)}` : names[0] ?? '';
/**
 * What can be used for a discussion today, from the presets' review state (the same fact D114 reports per saved model),
 * so opening a new service changes this sentence without anyone rewriting it.
 */
export function availabilityText(): string {
  const real = presets.filter(preset => preset.kind !== 'mock');
  const ready = real.filter(preset => !preset.priceUnreviewed).map(preset => preset.name);
  const pending = real.filter(preset => preset.priceUnreviewed).map(preset => preset.name);
  if (!ready.length) return `${listed(pending)}可以先连接；价格审核前，暂时都不能用于讨论。`;
  if (!pending.length) return `可以用于讨论：${listed(ready)}。`;
  return `目前可以用于讨论的是 ${listed(ready)}；${listed(pending)}可以先连接，价格审核后开放讨论。`;
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
