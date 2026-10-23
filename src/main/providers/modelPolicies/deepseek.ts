import type { ProviderConfiguration } from '../../../shared/contracts/configuration';
import type { ProviderMessage } from '../types';
import type { ApprovedModelPolicy } from '../ProviderRegistry';
import type { PeriodPricing } from '../../usage/pricing';

/**
 * R13A production review of the DeepSeek direct API (OpenAI format). Every number below was read from the official
 * documentation on 2026-10-22; nothing is inferred from model names. The review expires after 30 days and must be
 * re-checked against the pricing page before it is extended.
 */
export const deepSeekModelReview = {
  baseUrl: 'https://api.deepseek.com',
  reviewedAt: '2026-10-22T01:00:00.000Z',
  expiresAt: '2026-11-21T01:00:00.000Z',
  sources: [
    'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
    'https://api-docs.deepseek.com/quick_start/pricing',
    'https://api-docs.deepseek.com/zh-cn/guides/thinking_mode',
    'https://api-docs.deepseek.com/zh-cn/quick_start/token_usage/',
    'https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash/blob/main/tokenizer.json',
  ],
  // Byte-level BPE (tokenizer.json: ByteLevel pre_tokenizer/decoder, model.type BPE, byte_fallback false, empty
  // normalizer): every token decodes to at least one byte, so a message's text tokens never exceed its UTF-8 bytes.
  // Chat-template markers (<｜begin▁of▁sentence｜>, <｜User｜>, <｜Assistant｜>, </think>, EOS) carry no message bytes and
  // are bounded by deliberately generous allowances. Any server-side framing beyond that is caught after the fact:
  // provider usage above this bound stops the Run (D090).
  framing: { perRequestTokens: 512, perMessageTokens: 32 },
  models: {
    'deepseek-flash': {
      modelVersion: 'DeepSeek-V4.1-Flash-1017', documentedContext: '1M', documentedMaxOutput: '384K',
      // CNY per million tokens, peak (no off-peak discount assumed) and cache miss (no cache hit assumed).
      inputMicroCnyPerToken: 2, outputMicroCnyPerToken: 8, cacheHitMicroCnyPerMillionPeak: 40000,
    },
  },
  // Price verified but not approved: the thinking-disabled request is wired only for deepseek-flash (see D089).
  notApproved: {
    'deepseek-v4-pro': { modelVersion: 'DeepSeek-V4-Pro-0813', inputMicroCnyPerToken: 9, outputMicroCnyPerToken: 27,
      reason: 'thinking_disabled_path_not_wired' },
  },
  /**
   * R13B (D106), re-read 2026-10-23 from the Chinese and English pricing pages and the chat-completion API reference.
   * Footnote (2): off-peak is half of peak; peak is Beijing time Monday–Friday (excluding Chinese public holidays)
   * 09:00–12:00 and 14:00–18:00 (English page: 01:00–04:00 and 06:00–10:00 UTC); every other hour, weekends and public
   * holidays included, is off-peak. The page does not say whether a request's start or finish decides its period.
   * Usage reports `prompt_cache_hit_tokens` + `prompt_cache_miss_tokens` = `prompt_tokens`, in the final stream chunk.
   * Reservation still uses the peak cache-miss rates above; these rates only settle.
   */
  settlement: {
    reviewedAt: '2026-10-23T01:00:00.000Z',
    sources: [
      'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
      'https://api-docs.deepseek.com/quick_start/pricing',
      'https://api-docs.deepseek.com/zh-cn/api/create-chat-completion',
      'https://api-docs.deepseek.com/zh-cn/guides/kv_cache',
    ],
    utcOffsetMinutes: 480,
    peakWeekdays: [1, 2, 3, 4, 5],
    peakWindows: [{ startMinute: 9 * 60, endMinute: 12 * 60 }, { startMinute: 14 * 60, endMinute: 18 * 60 }],
    // CNY per million tokens as micro-CNY per million: ¥0.04 = 40,000.
    models: {
      'deepseek-flash': {
        peak: { cacheHitMicroPerMillion: 40_000, cacheMissMicroPerMillion: 2_000_000, outputMicroPerMillion: 8_000_000 },
        offPeak: { cacheHitMicroPerMillion: 20_000, cacheMissMicroPerMillion: 1_000_000, outputMicroPerMillion: 4_000_000 },
      },
    },
  },
  // App-side caps, far below the documented 1M context / 384K output, so one request stays small and reviewable.
  contextWindowTokens: 131072, maxOutputTokens: 32768, maxRequestMicroCny: 5_000_000,
} as const;

type ApprovedModelId = keyof typeof deepSeekModelReview.models;
const approved = (modelId: string): modelId is ApprovedModelId => Object.hasOwn(deepSeekModelReview.models, modelId);
const normalized = (url: string) => new URL(url).toString().replace(/\/+$/u, '');

/** Provable upper bound of the formatted request's input tokens for the byte-level BPE tokenizer. */
export function countDeepSeekInputUpperBound(messages: readonly Readonly<ProviderMessage>[]): number | undefined {
  const { perRequestTokens, perMessageTokens } = deepSeekModelReview.framing;
  let total = perRequestTokens;
  for (const message of messages) {
    if (typeof message.content !== 'string') return undefined;
    total += perMessageTokens + Buffer.byteLength(message.content, 'utf8');
  }
  return Number.isSafeInteger(total) ? total : undefined;
}

/** Production policy for the exact DeepSeek direct origin; any other origin, kind or model stays unsupported. */
export function deepSeekModelPolicy(configuration: ProviderConfiguration, modelId: string): ApprovedModelPolicy | undefined {
  if (configuration.kind !== 'openai-compatible' || !configuration.baseUrl) return;
  if (normalized(configuration.baseUrl) !== deepSeekModelReview.baseUrl || !approved(modelId)) return;
  const review = deepSeekModelReview;
  const model = review.models[modelId];
  const { settlement } = review;
  const rates = settlement.models[modelId];
  // Public holidays are billed as working days here: never below the real price (D106).
  const periodPricing: PeriodPricing = { utcOffsetMinutes: settlement.utcOffsetMinutes, peakWeekdays: settlement.peakWeekdays, peakWindows: settlement.peakWindows,
    peak: rates.peak, offPeak: rates.offPeak,
    evidence: `${settlement.sources.join(' ; ')}; ${model.modelVersion}; peak Beijing Mon–Fri 09:00–12:00/14:00–18:00, holidays treated as working days; `
      + `peak hit ¥0.04/miss ¥2/out ¥8 per M, off-peak hit ¥0.02/miss ¥1/out ¥4 per M; reviewed ${settlement.reviewedAt}` };
  return {
    evidence: `${review.sources.join(' ; ')} ; ${model.modelVersion} context ${model.documentedContext}, max output ${model.documentedMaxOutput}; reviewed ${review.reviewedAt}`,
    outputTokenParameter: 'max_tokens',
    contextWindowTokens: review.contextWindowTokens,
    maxOutputTokens: review.maxOutputTokens,
    counter: { modelId, kind: 'upper_bound', countMessages: countDeepSeekInputUpperBound,
      method: `byte-level BPE bound: UTF-8 bytes + ${review.framing.perMessageTokens}/message + ${review.framing.perRequestTokens}/request` },
    price: { currency: 'CNY', inputMicroCnyPerToken: model.inputMicroCnyPerToken, outputMicroCnyPerToken: model.outputMicroCnyPerToken,
      maxRequestMicroCny: review.maxRequestMicroCny, reviewedAt: review.reviewedAt, expiresAt: review.expiresAt,
      evidence: `${review.sources[0]}; ${model.modelVersion}; peak cache-miss input ¥${model.inputMicroCnyPerToken}/M, output ¥${model.outputMicroCnyPerToken}/M; reserved without cache-hit or off-peak discounts; reviewed ${review.reviewedAt}`,
      periodPricing },
  };
}
