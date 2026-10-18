const tokenEvidence = 'https://api-docs.deepseek.com/zh-cn/quick_start/token_usage/';

export type LocalTokenEstimate = {
  kind: 'estimated'; inputTokens: number; method: 'official_text_ratio'; evidence: string;
  framingAllowanceTokens: 64; calibration: 'uncalibrated'; strictUsable: false;
} | { kind: 'unknown'; reason: 'unsupported_message_shape' | 'unsupported_characters' | 'input_too_long' };

export type TokenMeasurement = LocalTokenEstimate | {
  kind: 'provider_usage'; inputTokens: number; outputTokens: number;
};

// A separately reviewed price snapshot, never a strict-model policy or permission to make a request.
export const deepSeekTrialReview = {
  baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', modelVersion: 'DeepSeek-V4.1-Flash-1017',
  reviewedDate: '2026-10-18', maxInputCharacters: 256, maxOutputTokens: 128,
  price: { currency: 'CNY', inputMicroCnyPerToken: 2, outputMicroCnyPerToken: 8, maxRequestMicroCny: 50000,
    reviewedAt: '2026-10-17T16:00:00.000Z', expiresAt: '2026-10-18T16:00:00.000Z',
    evidence: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/; reviewed 2026-10-18; peak/cache-miss input and total completion output' },
} as const;

export function estimateDeepSeekInput(messages: unknown): LocalTokenEstimate {
  if (!Array.isArray(messages) || messages.length !== 1) return { kind: 'unknown', reason: 'unsupported_message_shape' };
  const message: unknown = messages[0];
  if (!message || typeof message !== 'object' || Object.keys(message).length !== 2
    || !Object.hasOwn(message, 'role') || !Object.hasOwn(message, 'content')
    || !('role' in message) || message.role !== 'user'
    || !('content' in message) || typeof message.content !== 'string' || message.content.length === 0) {
    return { kind: 'unknown', reason: 'unsupported_message_shape' };
  }
  if (message.content.length > deepSeekTrialReview.maxInputCharacters) return { kind: 'unknown', reason: 'input_too_long' };
  if (!/^[\x20-\x7e]+$/u.test(message.content)) return { kind: 'unknown', reason: 'unsupported_characters' };
  // shortcut: the 64-token framing allowance is uncalibrated, not a bound; use only for the explicit tiny trial until a versioned tokenizer/API mapping is reviewed.
  return { kind: 'estimated', inputTokens: Math.ceil(message.content.length * 0.3) + 64,
    method: 'official_text_ratio', evidence: tokenEvidence, framingAllowanceTokens: 64,
    calibration: 'uncalibrated', strictUsable: false };
}
