/**
 * D143: the services and models this app works with, and the only source for them. The wizard offers these; Main refuses
 * anything else before a Key is read or a request is sent. Read from each service's official documentation in November 2026:
 * - DeepSeek: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * - 豆包: https://www.volcengine.com/docs/82379/1330310
 * - 通义千问: https://help.aliyun.com/zh/model-studio/models (the address is the documented one that still works; the newer one holds each user's own workspace ID)
 * - Kimi: https://platform.kimi.com/docs/guide/start-using-kimi-api
 * - 智谱 GLM: https://docs.bigmodel.cn/cn/guide/start/model-overview
 * - 百度文心: https://cloud.baidu.com/doc/qianfan-docs/s/7m95lyy43 , https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb
 * - 腾讯混元: https://cloud.tencent.com/document/product/1729/104753
 * - MiniMax: https://platform.minimax.cn/docs/guides/models-intro
 */
export type CatalogModel = { id: string; name: string; note?: string };
export type CatalogService = { id: string; name: string; baseUrl: string; models: readonly CatalogModel[] };

export const serviceCatalog: readonly CatalogService[] = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: [
    { id: 'deepseek-flash', name: 'DeepSeek Flash', note: '快，适合多数讨论' }, { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', note: '复杂推理' }] },
  { id: 'doubao', name: '豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: [
    { id: 'doubao-seed-2-1-pro-260915', name: 'Doubao Seed 2.1 Pro', note: '能力最强' }, { id: 'doubao-seed-2-1-lite-260915', name: 'Doubao Seed 2.1 Lite', note: '均衡' },
    { id: 'doubao-seed-2-1-turbo-260628', name: 'Doubao Seed 2.1 Turbo', note: '更快' }] },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: [
    { id: 'qwen3.8-max', name: 'Qwen3.8 Max', note: '复杂推理' }, { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', note: '性能和速度均衡' }, { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', note: '更快' }] },
  { id: 'kimi', name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: [
    { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro' }, { id: 'kimi-k3.1-pro-highspeed', name: 'Kimi K3.1 Pro 高速版', note: '更快' }, { id: 'kimi-k3', name: 'Kimi K3' }] },
  { id: 'glm', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: [
    { id: 'glm-5.3', name: 'GLM-5.3' }, { id: 'glm-5.2', name: 'GLM-5.2' }, { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', note: '更快' }] },
  { id: 'ernie', name: '百度文心', baseUrl: 'https://qianfan.baidubce.com/v2', models: [{ id: 'ernie-5.1', name: 'ERNIE 5.1' }] },
  { id: 'hunyuan', name: '腾讯混元', baseUrl: 'https://tokenhub.tencentmaas.com/v1', models: [{ id: 'hy4-preview', name: 'HY4 Preview' }, { id: 'hy3', name: 'HY3' }] },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.cn/v1', models: [{ id: 'MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash', note: '更快' }, { id: 'MiniMax-M3', name: 'MiniMax M3' }] },
];

const normalized = (address: string) => address.replace(/\/+$/u, '');
/** The catalog's service at exactly this address, if any. */
export const catalogServiceAt = (catalog: readonly CatalogService[], address: string | null | undefined): CatalogService | undefined =>
  address ? catalog.find(service => service.baseUrl === normalized(address)) : undefined;
export const catalogHas = (service: CatalogService, modelId: string) => service.models.some(model => model.id === modelId);
export const catalogHosts = (catalog: readonly CatalogService[]) => new Set(catalog.map(service => new URL(service.baseUrl).host));
