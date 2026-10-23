// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { overlapsPeak, pricePeriod, settlementPricing, type PeriodPricing } from '../../../src/main/usage/pricing';
import { deepSeekModelPolicy } from '../../../src/main/providers/modelPolicies/deepseek';
import { settlementAmountMicro } from '../../../src/shared/schemas/budget';

const configuration = { id: 'deepseek', name: 'DeepSeek', kind: 'openai-compatible' as const, baseUrl: 'https://api.deepseek.com', keyReference: null, enabled: true,
  isDefault: false, defaultModelId: null, customModels: [], keyRevision: 'r', createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z' };
const pricing = (deepSeekModelPolicy(configuration as never, 'deepseek-flash')!.price as { periodPricing: PeriodPricing }).periodPricing;
// Beijing local time → UTC instant (UTC+8, no daylight saving).
const bj = (local: string) => new Date(`${local}+08:00`);
const period = (start: string, end = start) => pricePeriod(bj(start), bj(end), pricing);

describe('DeepSeek time-of-day settlement (D106)', () => {
  it('uses the official Beijing peak windows on weekdays', () => {
    expect(period('2026-10-23T10:00:00')).toBe('peak'); // Friday morning
    expect(period('2026-10-23T15:30:00')).toBe('peak'); // Friday afternoon
    expect(period('2026-10-23T12:30:00')).toBe('off_peak'); // lunch gap
    expect(period('2026-10-23T08:59:59')).toBe('off_peak');
    expect(period('2026-10-23T18:00:01')).toBe('off_peak');
    expect(period('2026-10-23T23:00:00')).toBe('off_peak');
    expect(period('2026-10-26T03:00:00')).toBe('off_peak'); // Monday night
  });

  it('treats weekends as off-peak and both window edges as peak', () => {
    expect(period('2026-10-24T10:00:00')).toBe('off_peak'); // Saturday
    expect(period('2026-10-25T15:00:00')).toBe('off_peak'); // Sunday
    expect(period('2026-10-23T09:00:00')).toBe('peak');
    expect(period('2026-10-23T12:00:00')).toBe('peak');
    expect(period('2026-10-23T18:00:00')).toBe('peak');
  });

  it('bills a request at peak when either end, or any instant between them, is in a peak window', () => {
    expect(period('2026-10-23T08:59:30', '2026-10-23T09:00:10')).toBe('peak'); // finishes in peak
    expect(period('2026-10-23T11:59:50', '2026-10-23T12:00:30')).toBe('peak'); // starts in peak
    expect(period('2026-10-23T11:00:00', '2026-10-23T14:30:00')).toBe('peak');
    expect(period('2026-10-23T12:10:00', '2026-10-23T13:50:00')).toBe('off_peak');
    expect(period('2026-10-23T23:59:30', '2026-10-24T00:00:30')).toBe('off_peak'); // Friday night into Saturday
    expect(period('2026-10-25T23:59:30', '2026-10-26T09:00:00')).toBe('peak'); // Sunday night into Monday's window
  });

  it('never bills below the real price: public holidays count as working days, clock skew is peak', () => {
    // 2026-10-01 is a Chinese public holiday (a Thursday); without a reliable calendar it is billed at peak.
    expect(period('2026-10-01T10:00:00')).toBe('peak');
    expect(overlapsPeak(bj('2026-10-24T10:00:01'), bj('2026-10-24T10:00:00'), pricing)).toBe(true);
    expect(overlapsPeak(new Date(Number.NaN), bj('2026-10-24T10:00:00'), pricing)).toBe(true);
  });

  it('prices cache hits at the cache rate only with a consistent provider split', () => {
    const offPeak = { startedAt: bj('2026-10-23T21:00:00'), finishedAt: bj('2026-10-23T21:00:05') };
    const priced = settlementPricing(pricing, offPeak, { inputTokens: 1000, cacheHitInputTokens: 600 });
    expect(priced).toMatchObject({ period: 'off_peak', cacheHitTokens: 600, cacheHitMicroPerMillion: 20_000, cacheMissMicroPerMillion: 1_000_000, outputMicroPerMillion: 4_000_000 });
    // 600 × ¥0.02/M + 400 × ¥1/M + 50 × ¥4/M = 12 + 400 + 200 micro-CNY.
    expect(settlementAmountMicro({ inputTokens: 1000, outputTokens: 50, cacheHitTokens: 600 }, priced)).toBe(612);
    // 999 × 0.02 + 1 × 1 = 20.98 micro-CNY rounds up, never down.
    expect(settlementAmountMicro({ inputTokens: 1000, outputTokens: 0, cacheHitTokens: 999 }, priced)).toBe(21);
    expect(settlementPricing(pricing, offPeak, { inputTokens: 1000, cacheHitInputTokens: 1001 }).cacheHitTokens).toBeNull();
    expect(settlementPricing(pricing, offPeak, { inputTokens: 1000 }).cacheHitTokens).toBeNull();
    // Peak without a split equals the reserved R13A rate exactly.
    const peak = settlementPricing(pricing, { startedAt: bj('2026-10-23T10:00:00'), finishedAt: bj('2026-10-23T10:00:05') }, { inputTokens: 300 });
    expect(settlementAmountMicro({ inputTokens: 300, outputTokens: 6, cacheHitTokens: peak.cacheHitTokens }, peak)).toBe(300 * 2 + 6 * 8);
  });
});
