/**
 * D143: the services and models this app works with, and the only source for them. The wizard offers these; Main refuses
 * anything else before a Key is read or a request is sent. Each service lists the models usable for a discussion, newest first,
 * as its official documentation had them on 2026-11-04. Models that can also read images are marked `multimodal`, and only
 * those are sent the host's images (D147). Left out: what is being retired, closed to new users, built for one task (translation, role play,
 * long documents) or only for generating speech, images or video, and other brands' models hosted there.
 * - DeepSeek: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * - 豆包: https://www.volcengine.com/docs/82379/1330310
 * - 通义千问: https://help.aliyun.com/zh/model-studio/text-generation-model , https://help.aliyun.com/zh/model-studio/vision , https://help.aliyun.com/zh/model-studio/qwen-omni (the address is the documented one that still works; the newer one holds each user's own workspace ID)
 * - Kimi: https://platform.kimi.com/docs/models
 * - 智谱 GLM: https://docs.bigmodel.cn/cn/guide/start/model-overview , https://docs.bigmodel.cn/api-reference/模型-api/对话补全
 * - 百度文心: https://cloud.baidu.com/doc/qianfan-docs/s/7m95lyy43 , https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb
 * - 腾讯混元: https://cloud.tencent.com/document/product/1823/130051 , https://cloud.tencent.com/document/product/1823/132252 , https://cloud.tencent.com/document/product/1823/136956
 * - MiniMax: https://platform.minimax.cn/docs/guides/models-intro
 */
export type CatalogModel = { id: string; name: string; note?: string; contextWindowTokens?: number; multimodal?: true };
/** `modelPattern` is what this service's own models are called; what its model list says beyond that is left out. */
export type CatalogService = { id: string; name: string; baseUrl: string; modelPattern: RegExp; models: readonly CatalogModel[] };

export const serviceCatalog: readonly CatalogService[] = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', modelPattern: /^deepseek-/iu, models: [
    { id: 'deepseek-flash', name: 'DeepSeek Flash', note: '快，适合多数讨论', multimodal: true },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', note: '推理更强，适合复杂问题' }] },
  { id: 'doubao', name: '豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', modelPattern: /^doubao-seed-/iu, models: [
    { id: 'doubao-seed-2-1-pro-260915', name: 'Doubao Seed 2.1 Pro', note: '能力最强', multimodal: true },
    { id: 'doubao-seed-2-1-lite-260915', name: 'Doubao Seed 2.1 Lite', note: '均衡，响应更快', multimodal: true },
    { id: 'doubao-seed-evolving', name: 'Doubao Seed Evolving', note: '每周更新，长于编程和复杂任务', multimodal: true },
    { id: 'doubao-seed-2-1-turbo-260628', name: 'Doubao Seed 2.1 Turbo', note: '更快', multimodal: true },
    { id: 'doubao-seed-2-1-pro-260628', name: 'Doubao Seed 2.1 Pro（6 月版）', note: '上一版 2.1 Pro', multimodal: true },
    { id: 'doubao-seed-2-0-lite-260428', name: 'Doubao Seed 2.0 Lite', note: '上一代，均衡', multimodal: true },
    { id: 'doubao-seed-2-0-mini-260428', name: 'Doubao Seed 2.0 Mini', note: '上一代，最轻快', multimodal: true }] },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelPattern: /^qwen/iu, models: [
    { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', note: '官方默认，能力和速度均衡', multimodal: true },
    { id: 'qwen3.8-max', name: 'Qwen3.8 Max', note: '能力最强，适合复杂推理', multimodal: true },
    { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', note: '快，适合简单任务', multimodal: true },
    { id: 'qwen3.8-omni-flash', name: 'Qwen3.8 Omni Flash', note: '长于音视频理解', multimodal: true },
    { id: 'qwen3.7-max', name: 'Qwen3.7 Max', note: '上一代，长于复杂推理' },
    { id: 'qwen3.7-flash', name: 'Qwen3.7 Flash', note: '上一代，快', multimodal: true },
    { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus', note: '旧版，均衡', multimodal: true },
    { id: 'qwen3.6-flash', name: 'Qwen3.6 Flash', note: '旧版，快', multimodal: true },
    { id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', note: '旧版，均衡', multimodal: true },
    { id: 'qwen3.5-flash', name: 'Qwen3.5 Flash', note: '旧版，快', multimodal: true },
    { id: 'qwen3-vl-plus', name: 'Qwen3 VL Plus', note: '旧版，长于图像和文档理解', multimodal: true },
    { id: 'qwen-plus', name: 'Qwen Plus', note: '旧版，均衡' },
    { id: 'qwen-max', name: 'Qwen Max', note: '旧版，上下文只有 32k，讨论长了要先生成摘要', contextWindowTokens: 32000 },
    { id: 'qwen-flash', name: 'Qwen Flash', note: '旧版，快' }] },
  { id: 'kimi', name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', modelPattern: /^kimi-/iu, models: [
    { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro', note: '能力最强的旗舰', multimodal: true },
    { id: 'kimi-k3.1-pro-highspeed', name: 'Kimi K3.1 Pro 高速版', note: '能力相同，速度约 2～3 倍', multimodal: true },
    { id: 'kimi-k3', name: 'Kimi K3', note: '上一代旗舰', multimodal: true }] },
  { id: 'glm', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelPattern: /^glm-/iu, models: [
    { id: 'glm-5.3', name: 'GLM-5.3', note: '旗舰，长于复杂和长程任务' },
    { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', note: '快，能力接近上一代旗舰', multimodal: true },
    { id: 'glm-5.3-flashx', name: 'GLM-5.3 FlashX', note: '比 Flash 更快更流畅', multimodal: true },
    { id: 'glm-5v-turbo', name: 'GLM-5V Turbo', note: '长于看图和视觉编程', multimodal: true },
    { id: 'glm-5.2', name: 'GLM-5.2', note: '上一代旗舰' },
    { id: 'glm-5.1', name: 'GLM-5.1', note: '较早的旗舰' },
    { id: 'glm-5-turbo', name: 'GLM-5 Turbo', note: 'GLM-5 的快速版' },
    { id: 'glm-5', name: 'GLM-5', note: '较早的旗舰' },
    { id: 'glm-4.7', name: 'GLM-4.7', note: '旧版旗舰' },
    { id: 'glm-4.7-flashx', name: 'GLM-4.7 FlashX', note: '旧版，比 Flash 更快' },
    { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', note: '旧版，轻量' },
    { id: 'glm-4.6', name: 'GLM-4.6', note: '旧版' },
    { id: 'glm-4.6v', name: 'GLM-4.6V', note: '旧版，长于看图', multimodal: true },
    { id: 'glm-4.6v-flashx', name: 'GLM-4.6V FlashX', note: '旧版，轻量且快', multimodal: true },
    { id: 'glm-4.6v-flash', name: 'GLM-4.6V Flash', note: '旧版，轻量', multimodal: true },
    { id: 'glm-4.5-air', name: 'GLM-4.5 Air', note: '旧版，轻量' },
    { id: 'glm-4.5-airx', name: 'GLM-4.5 AirX', note: '旧版，轻量且响应快' },
    { id: 'glm-4-flashx-250414', name: 'GLM-4 FlashX', note: '旧版，推理很快' },
    { id: 'glm-4-flash-250414', name: 'GLM-4 Flash', note: '旧版，轻量' },
    { id: 'glm-4.1v-thinking-flashx', name: 'GLM-4.1V Thinking FlashX', note: '旧版，带思考的视觉模型', multimodal: true, contextWindowTokens: 64000 },
    { id: 'glm-4.1v-thinking-flash', name: 'GLM-4.1V Thinking Flash', note: '旧版，带思考的视觉模型，轻量', multimodal: true, contextWindowTokens: 64000 }] },
  { id: 'ernie', name: '百度文心', baseUrl: 'https://qianfan.baidubce.com/v2', modelPattern: /^ernie-/iu, models: [
    { id: 'ernie-5.1', name: 'ERNIE 5.1', note: '旗舰' }] },
  { id: 'hunyuan', name: '腾讯混元', baseUrl: 'https://tokenhub.tencentmaas.com/v1', modelPattern: /^(hy[0-9-]|hunyuan-)/iu, models: [
    { id: 'hy4', name: 'HY4', note: '正式版，长于长程和复杂任务', multimodal: true },
    { id: 'hy4-preview', name: 'HY4 Preview', note: '预览版' },
    { id: 'hy3', name: 'HY3', note: '上一代，长于编程、长文和推理' },
    { id: 'hy-vision-2.0-instruct', name: 'HY Vision 2.0', note: '长于图文理解，输入较短', multimodal: true, contextWindowTokens: 32000 },
    { id: 'hunyuan-t1-vision-20250916', name: 'HY Vision 1.5 Thinking', note: '上一代，带思考，输入较短', multimodal: true, contextWindowTokens: 24000 }] },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.cn/v1', modelPattern: /^minimax-m/iu, models: [
    { id: 'MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash', note: '新一代，思考深度可调', multimodal: true },
    { id: 'MiniMax-M3', name: 'MiniMax M3', note: '上一版', multimodal: true }] },
];

/** The note a person reads: what a model can do is said first, so nobody has to guess. */
export const modelNote = (model: CatalogModel) => model.multimodal ? `多模态${model.note ? `，${model.note}` : ''}` : model.note;

/**
 * D147: whether a model reads images: the catalog says for its own models. A model the service's list added (D143) is not
 * something the catalog knows, so it is `unknown`: images are sent, and a refusal is shown as any other failure.
 */
export type ImageSupport = 'yes' | 'no' | 'unknown';
export function imageSupportOf(service: CatalogService | undefined, modelId: string): ImageSupport {
  if (!service) return 'no';
  const model = service.models.find(item => item.id === modelId);
  return !model ? 'unknown' : model.multimodal ? 'yes' : 'no';
}

const normalized = (address: string) => address.replace(/\/+$/u, '');
/** The catalog's service at exactly this address, if any. */
export const catalogServiceAt = (catalog: readonly CatalogService[], address: string | null | undefined): CatalogService | undefined =>
  address ? catalog.find(service => service.baseUrl === normalized(address)) : undefined;
export const catalogHas = (service: CatalogService, modelId: string) => service.models.some(model => model.id === modelId);

/** Words in a model's ID that mean it was built for one task, or is not for text. Matched as whole words of the ID. */
const specialWords = new Set(['translation', 'translate', 'character', 'role', 'roleplay', 'tts', 'asr', 'audio', 'speech', 'voice', 'realtime', 'music',
  'image', 'video', 'ocr', 'embedding', 'rerank', '3d', 'long', 'doc', 'legal', 'research']);
const specialWord = (word: string) => specialWords.has(word) || /^mt\d*$/u.test(word);
/** D143: a model a service's own list may add: named as that service names its models, for general text, and not a dated copy. */
export const discoverable = (service: CatalogService, modelId: string) => service.modelPattern.test(modelId) && !/-\d{4}-\d{2}-\d{2}$/u.test(modelId)
  && !modelId.toLowerCase().split(/[^a-z0-9]+/u).some(specialWord);
/** D143: the catalog's models, and what the service's own list added. What was stored is checked against the rule again. */
export const modelAllowed = (service: CatalogService, modelId: string, listed: readonly string[]) =>
  catalogHas(service, modelId) || listed.includes(modelId) && discoverable(service, modelId);
export const catalogHosts = (catalog: readonly CatalogService[]) => new Set(catalog.map(service => new URL(service.baseUrl).host));
