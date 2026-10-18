// @vitest-environment node
import { expect, it } from 'vitest';
import { deepSeekTrialReview, estimateDeepSeekInput } from '../../../src/main/providers/controlledTrial/estimate';

it('labels short ASCII input as an uncalibrated local heuristic, never provider usage or a strict bound', () => {
  const estimate = estimateDeepSeekInput([{ role: 'user', content: 'Reply OK.' }]);
  expect(estimate).toMatchObject({ kind: 'estimated', inputTokens: 67,
    method: 'official_text_ratio', framingAllowanceTokens: 64, calibration: 'uncalibrated', strictUsable: false });
  expect(estimate.kind).not.toBe('provider_usage');
  expect(estimate).not.toHaveProperty('outputTokens');
  expect(estimate).toHaveProperty('evidence', 'https://api-docs.deepseek.com/zh-cn/quick_start/token_usage/');
});

it('accepts the 256-printable-ASCII boundary and rejects the next character as unknown', () => {
  expect(estimateDeepSeekInput([{ role: 'user', content: 'a'.repeat(256) }]))
    .toMatchObject({ kind: 'estimated', inputTokens: 141, strictUsable: false });
  expect(estimateDeepSeekInput([{ role: 'user', content: 'a'.repeat(257) }]))
    .toEqual({ kind: 'unknown', reason: 'input_too_long' });
});

it.each(['你好', 'café', '😀', 'line\nbreak', 'tab\ttext', '\u0000', '\u007f'])(
  'returns unknown for unsupported characters %j instead of pretending to tokenize them', content => {
    expect(estimateDeepSeekInput([{ role: 'user', content }])).toEqual({ kind: 'unknown', reason: 'unsupported_characters' });
  });

it.each([
  undefined, null, {}, [], [{ role: 'user', content: '' }],
  [{ role: 'assistant', content: 'Hello' }], [{ role: 'system', content: 'Hello' }],
  [{ role: 'user', content: 'Hi' }, { role: 'user', content: 'Again' }],
  [{ role: 'user', content: 12 }], [{ role: 'user', content: 'Hello', tools: [] }],
])('returns unknown for unsupported message shape %j', messages => {
  expect(estimateDeepSeekInput(messages)).toEqual({ kind: 'unknown', reason: 'unsupported_message_shape' });
});

it('preserves every printable ASCII character without normalizing the actual input', () => {
  const content = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join('');
  expect(estimateDeepSeekInput([{ role: 'user', content }])).toMatchObject({ kind: 'estimated', inputTokens: 93 });
});

it('pins a new reviewed CNY price window and small trial limits without inheriting an expired review', () => {
  expect(deepSeekTrialReview).toMatchObject({ baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash',
    modelVersion: 'DeepSeek-V4.1-Flash-1017', reviewedDate: '2026-10-18', maxInputCharacters: 256, maxOutputTokens: 128,
    price: { currency: 'CNY', inputMicroCnyPerToken: 2, outputMicroCnyPerToken: 8, maxRequestMicroCny: 50000,
      reviewedAt: '2026-10-17T16:00:00.000Z', expiresAt: '2026-10-18T16:00:00.000Z' } });
  expect(deepSeekTrialReview.price.evidence).toContain('https://api-docs.deepseek.com/zh-cn/quick_start/pricing/');
});
