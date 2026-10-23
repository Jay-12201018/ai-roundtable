import type { PricePeriod } from '../../shared/schemas/budget';
import type { ChargePricingInput } from '../database/Database';

/** Rates in micro-CNY per million tokens (¥1 per million = 1,000,000), so ¥0.02/M stays an integer. */
export type SettlementRates = { cacheHitMicroPerMillion: number; cacheMissMicroPerMillion: number; outputMicroPerMillion: number };
/**
 * D106: a reviewed time-of-day price. Peak windows are local minutes on the listed weekdays in a fixed UTC offset
 * (DeepSeek: Beijing time, no daylight saving). Public holidays are not modelled: without a reliable calendar a
 * weekday is always treated as a working day, so a holiday is billed at peak here and never below the real price.
 */
export type PeriodPricing = {
  utcOffsetMinutes: number;
  peakWeekdays: readonly number[];
  peakWindows: ReadonlyArray<{ startMinute: number; endMinute: number }>;
  peak: SettlementRates;
  offPeak: SettlementRates;
  evidence: string;
};

const minuteMs = 60_000;
const dayMs = 86_400_000;

/**
 * True when any instant of [startedAt, finishedAt] falls in a peak window. This is stricter than "either end is in
 * peak": a request that spans a whole window is peak too. Clock skew or invalid times are peak.
 */
export function overlapsPeak(startedAt: Date, finishedAt: Date, pricing: PeriodPricing): boolean {
  const start = startedAt.getTime(); const end = finishedAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 7 * dayMs) return true;
  const offset = pricing.utcOffsetMinutes * minuteMs;
  // Walk local calendar days from the one containing the start to the one containing the end.
  const firstDay = Math.floor((start + offset) / dayMs);
  const lastDay = Math.floor((end + offset) / dayMs);
  for (let day = firstDay; day <= lastDay; day++) {
    const weekday = (day + 4) % 7; // 1970-01-01 was a Thursday (4).
    if (!pricing.peakWeekdays.includes(weekday)) continue;
    for (const window of pricing.peakWindows) {
      const windowStart = day * dayMs + window.startMinute * minuteMs - offset;
      const windowEnd = day * dayMs + window.endMinute * minuteMs - offset;
      // Both window edges count as peak: 12:00:00 sharp is billed at peak, never below the real price.
      if (start <= windowEnd && end >= windowStart) return true;
    }
  }
  return false;
}

export function pricePeriod(startedAt: Date, finishedAt: Date, pricing: PeriodPricing): PricePeriod {
  return overlapsPeak(startedAt, finishedAt, pricing) ? 'peak' : 'off_peak';
}

/**
 * The actual price of a settled request. The provider's cache split is used only when it is complete and consistent
 * with the reported input; otherwise every input token is priced as a cache miss.
 */
export function settlementPricing(pricing: PeriodPricing, times: { startedAt: Date; finishedAt: Date },
  usage: { inputTokens: number; cacheHitInputTokens?: number }): ChargePricingInput {
  const period = pricePeriod(times.startedAt, times.finishedAt, pricing);
  const rates = period === 'peak' ? pricing.peak : pricing.offPeak;
  const hit = usage.cacheHitInputTokens;
  const cacheHitTokens = hit !== undefined && Number.isSafeInteger(hit) && hit >= 0 && hit <= usage.inputTokens ? hit : null;
  return { period, startedAt: times.startedAt.toISOString(), finishedAt: times.finishedAt.toISOString(), cacheHitTokens, ...rates, evidence: pricing.evidence };
}

/** Replaceable only by a probe or test that names itself; production reads the system clock (D106). */
export const settlementClock = { now: () => new Date() };
