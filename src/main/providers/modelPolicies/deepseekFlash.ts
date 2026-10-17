import type { ProviderConfiguration } from '../../../shared/contracts/configuration';
import type { ChatCompletionCapabilities } from '../openai/ChatCompletionProvider';

// Reviewed public documentation, not an approved full-request tokenizer or permission to make a paid request.
export const deepSeekFlashReview = {
  baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', modelVersion: 'DeepSeek-V4.1-Flash-1017',
  reviewedDate: '2026-10-17', documentedContext: '1M', documentedMaxOutputTokens: 393216,
  testMaxInputTokens: 1024, testMaxOutputTokens: 128, generationBlockedReason: 'full_request_token_bound_unverified',
  price: { currency: 'CNY', inputMicroCnyPerToken: 2, outputMicroCnyPerToken: 8, maxRequestMicroCny: 50000,
    reviewedAt: '2026-10-17T00:00:00.000Z', expiresAt: '2026-10-18T00:00:00.000Z',
    evidence: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/; peak/cache-miss input and total completion output; reviewed 2026-10-17' },
} as const;

export function deepSeekFlashCapabilities(configuration: ProviderConfiguration): ChatCompletionCapabilities | undefined {
  if (configuration.kind !== 'openai-compatible' || !configuration.baseUrl) return;
  if (new URL(configuration.baseUrl).toString().replace(/\/+$/u, '') !== deepSeekFlashReview.baseUrl) return;
  return { outputTokenParameter: 'max_tokens', streamUsage: true, thinkingDisabledForModel: 'deepseek-flash',
    listModels: false, authentication: 'unsupported' };
}
