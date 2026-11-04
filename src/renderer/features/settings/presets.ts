import type { ProviderKind } from '../../../shared/contracts/configuration';
import { catalogServiceAt, serviceCatalog, type CatalogModel } from '../../../shared/serviceCatalog';

/** How the wizard shows a service. The services, addresses and models themselves come from the built-in catalog. */
export type ServicePreset = {
  id: string; name: string; logo: string; kind: ProviderKind; baseUrl: string | null;
  models: readonly CatalogModel[]; description: string; keyHelp: string; recommended?: boolean;
};

const faces: Record<string, Pick<ServicePreset, 'logo' | 'description' | 'keyHelp' | 'recommended'>> = {
  deepseek: { logo: 'DS', recommended: true, description: '在 DeepSeek 开放平台创建 Key。', keyHelp: '在 DeepSeek 开放平台的「API Keys」页面创建并复制。' },
  doubao: { logo: '豆', description: '在火山方舟创建 Key。', keyHelp: '在火山方舟控制台的「API Key 管理」页面创建并复制，地域选华北 2（北京）。' },
  qwen: { logo: '通', description: '在阿里云百炼创建 Key。', keyHelp: '在阿里云百炼的「API Key」页面创建并复制，地域选华北 2（北京）。' },
  kimi: { logo: 'Ki', description: '在月之暗面开放平台创建 Key。', keyHelp: '在 Kimi 开放平台的「API Key」页面创建并复制。' },
  glm: { logo: 'GL', description: '在智谱开放平台创建 Key。', keyHelp: '在智谱开放平台的「API Keys」页面创建并复制。' },
  ernie: { logo: '文', description: '在百度智能云千帆创建 Key。', keyHelp: '在百度智能云千帆的「API Key」页面创建并复制。' },
  hunyuan: { logo: '混', description: '在腾讯云 TokenHub 创建 Key。', keyHelp: '在腾讯云 TokenHub 控制台创建并复制 API Key。' },
  minimax: { logo: 'MM', description: '在 MiniMax 开放平台创建 Key。', keyHelp: '在 MiniMax 开放平台的「接口密钥」页面创建并复制。' },
};

export const presets: ServicePreset[] = [
  ...serviceCatalog.map(service => ({ id: service.id, name: service.name, kind: 'compatible' as const, baseUrl: service.baseUrl, models: service.models, ...faces[service.id]! })),
  { id: 'mock', name: '演示（Mock）', logo: '', kind: 'mock', baseUrl: null, models: [{ id: 'mock', name: '演示' }],
    description: '不联网，回复是预先写好的示例，不代表真实模型的水平。', keyHelp: '' },
];

/** The sentence on the welcome page, from the same list the wizard offers. */
export function availabilityText(): string {
  return `支持国内主流大模型：${serviceCatalog.map(service => service.name).join('、')}。几位成员可以各用一家。`;
}

/** The built-in service a saved Provider matches, by its exact address; undefined when it is outside the catalog. */
export function presetOf(provider: { kind: ProviderKind | null; baseUrl?: string | null }): ServicePreset | undefined {
  if (provider.kind === 'mock') return presets.find(preset => preset.id === 'mock');
  const service = catalogServiceAt(serviceCatalog, provider.baseUrl);
  return service && presets.find(preset => preset.id === service.id);
}
/** Where Main sends this Provider's Key. */
export function targetOf(provider: { kind: ProviderKind | null; baseUrl?: string | null }): string | null {
  if (provider.kind === 'mock' || provider.kind === null) return null;
  return provider.baseUrl?.replace(/\/+$/u, '') ?? null;
}
