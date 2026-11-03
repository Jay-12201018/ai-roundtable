import type { ChatCompletionCapabilities } from './openai/ChatCompletionProvider';

type Base = Pick<ChatCompletionCapabilities, 'outputTokenParameter' | 'streamUsage' | 'disableThinking' | 'extraBody'>;
const common: Base = { outputTokenParameter: 'max_tokens', streamUsage: true };

/**
 * D142: what each built-in service documents for its OpenAI-compatible endpoint, by exact address and never by model
 * name. Read from the official documentation on 2026-11-03; a parameter a service does not document is not sent.
 * - DeepSeek: thinking is on by default and spends the output limit; the switch is documented for every model.
 *   https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
 * - Kimi: `max_tokens` is deprecated for `max_completion_tokens`. https://platform.kimi.com/docs/api/chat
 * - 通义千问: `max_tokens`, usage on request. https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
 * - 智谱 GLM: `max_tokens`; `stream_options` is not in its request schema. https://docs.bigmodel.cn/api-reference/模型-api/对话补全
 * - 豆包: `max_tokens`; models that think by default turn it off with `thinking`. https://docs.volcengine.com/docs/82379/1494384
 * - MiniMax: `max_completion_tokens`; `reasoning_split` keeps thinking out of `content`. https://platform.minimax.cn/docs/api-reference/text-openai-api
 * - The official OpenAI endpoint, when typed as a compatible service: `max_tokens` is deprecated there too.
 */
const profiles: Record<string, Base> = {
  'https://api.deepseek.com': { ...common, disableThinking: true },
  'https://api.moonshot.cn/v1': { ...common, outputTokenParameter: 'max_completion_tokens' },
  'https://dashscope.aliyuncs.com/compatible-mode/v1': common,
  'https://open.bigmodel.cn/api/paas/v4': { ...common, streamUsage: false },
  'https://ark.cn-beijing.volces.com/api/v3': { ...common, disableThinking: true },
  'https://api.minimax.cn/v1': { ...common, outputTokenParameter: 'max_completion_tokens', extraBody: { reasoning_split: true } },
  'https://api.openai.com/v1': { ...common, outputTokenParameter: 'max_completion_tokens' },
};

/** Capabilities of a compatible service at this address; any other address gets the common Chat Completions parameter. */
export function compatibleCapabilities(baseUrl: string): ChatCompletionCapabilities {
  return { ...(profiles[baseUrl] ?? common), listModels: true, authentication: 'models' };
}
