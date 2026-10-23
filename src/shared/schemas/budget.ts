import { z } from 'zod';
import { idSchema, looksLikeApiKey, timestampSchema } from './common';
import { errorCodeSchema } from './error';

const micro = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const tokens = micro;

/** Default Run budget: ¥1, in micro-CNY (1 CNY = 1,000,000). */
export const DEFAULT_RUN_BUDGET_MICRO_CNY = 1_000_000;
/** Largest Run budget a host may set at start: ¥1000. Top-ups never raise a Run's total above it either (D104). */
export const MAX_RUN_BUDGET_MICRO_CNY = 1_000_000_000;
export const runBudgetInputSchema = z.number().int().positive().max(MAX_RUN_BUDGET_MICRO_CNY);

/** D106: the price period a settled request was billed in. Peak is the conservative default. */
export const pricePeriodValues = ['peak', 'off_peak'] as const;
export const pricePeriodSchema = z.enum(pricePeriodValues);
/**
 * D106: how a settled request was actually priced: the period from its start and finish times, the provider's cache
 * split (null when the provider did not report one, so every input token is priced as a cache miss) and the rates in
 * micro-CNY per million tokens. `amountMicro` rounds up to the next micro-CNY.
 */
export const chargeSettlementSchema = z.object({
  period: pricePeriodSchema, startedAt: timestampSchema, finishedAt: timestampSchema,
  cacheHitTokens: tokens.nullable(),
  cacheHitMicroPerMillion: micro, cacheMissMicroPerMillion: micro, outputMicroPerMillion: micro,
  amountMicro: micro, evidence: z.string().min(1).max(2000),
}).strict();
/** D105: a host's own reading of the provider console for one unknown charge; the latest entry is effective. */
export const chargeWriteOffSchema = z.object({
  writeOffId: idSchema, amountMicro: micro, basis: z.string().min(1).max(200), createdAt: timestampSchema,
}).strict();

/** Settlement arithmetic shared by Main, the database check and the UI: round the exact amount up to a micro-CNY. */
export function settlementAmountMicro(usage: { inputTokens: number; outputTokens: number; cacheHitTokens: number | null },
  rates: { cacheHitMicroPerMillion: number; cacheMissMicroPerMillion: number; outputMicroPerMillion: number }): number {
  const hit = usage.cacheHitTokens ?? 0;
  const numerator = hit * rates.cacheHitMicroPerMillion + (usage.inputTokens - hit) * rates.cacheMissMicroPerMillion
    + usage.outputTokens * rates.outputMicroPerMillion;
  if (!Number.isSafeInteger(numerator) || hit > usage.inputTokens || numerator < 0) throw new Error('Settlement arithmetic out of range');
  const whole = Math.floor(numerator / 1_000_000);
  return numerator - whole * 1_000_000 > 0 ? whole + 1 : whole;
}

/**
 * One request's ledger entry. `reserved` is the maximum cost held before sending; `settled` records provider usage
 * at the approved rates; `unknown` (interrupted / no usage after sending) is charged at the full reservation and is
 * never recorded as zero; `not_sent` is only used when the request provably never reached the network.
 * R13B: a settled charge may carry its actual period/cache pricing; an unknown charge may carry host write-offs.
 */
export const chargeStateValues = ['reserved', 'settled', 'unknown', 'not_sent'] as const;
export const requestChargeSchema = z.object({
  requestId: idSchema, providerId: idSchema, modelId: idSchema, currency: z.enum(['CNY', 'USD']),
  state: z.enum(chargeStateValues),
  inputTokenBound: tokens, outputTokenLimit: tokens,
  inputMicroPerToken: micro, outputMicroPerToken: micro, reservedMicro: micro,
  inputTokens: tokens.nullable(), outputTokens: tokens.nullable(), accountedMicro: micro.nullable(),
  /** What this request counts against the budget now (see `effectiveChargeMicro`). */
  chargedMicro: micro,
  priceReviewedAt: timestampSchema.nullable(), createdAt: timestampSchema, updatedAt: timestampSchema,
  /** R13B: a summary request is ledgered like a Turn request but has no Turn (D107). Absent means a Turn request. */
  kind: z.enum(['turn', 'summary']).optional(),
  settlement: chargeSettlementSchema.optional(),
  writeOffs: z.array(chargeWriteOffSchema).max(64).optional(),
}).strict().superRefine((charge, ctx) => {
  const settled = charge.state === 'settled';
  const expected = settled && charge.inputTokens !== null && charge.outputTokens !== null
    ? charge.inputTokens * charge.inputMicroPerToken + charge.outputTokens * charge.outputMicroPerToken : null;
  const settlement = charge.settlement;
  if (settled !== (charge.accountedMicro !== null) || settled && charge.accountedMicro !== expected
    || charge.chargedMicro !== effectiveChargeMicro(charge)
    || charge.state === 'not_sent' && (charge.inputTokens !== null || charge.outputTokens !== null)
    || settlement && (!settled || charge.inputTokens === null || charge.outputTokens === null
      || (settlement.cacheHitTokens ?? 0) > charge.inputTokens || settlement.amountMicro > charge.accountedMicro!
      || settlement.amountMicro !== settlementAmountMicro({ inputTokens: charge.inputTokens, outputTokens: charge.outputTokens, cacheHitTokens: settlement.cacheHitTokens }, settlement))
    || charge.writeOffs?.length && (charge.state !== 'unknown' || charge.writeOffs.some(entry => entry.amountMicro > charge.reservedMicro))) {
    ctx.addIssue({ code: 'custom', message: 'Unknown charges cannot be recorded as zero or mismatch usage' });
  }
});

/**
 * The amount a charge counts now: the open reservation; the settled amount at its actual period/cache price (or the
 * frozen peak price when no settlement detail exists); an unknown charge at its full reservation until the host
 * writes it off with the console amount (D105); nothing for a request that provably never left.
 */
export function effectiveChargeMicro(charge: Pick<RequestCharge, 'state' | 'reservedMicro' | 'accountedMicro' | 'settlement' | 'writeOffs'>): number {
  if (charge.state === 'settled') return charge.settlement?.amountMicro ?? charge.accountedMicro!;
  if (charge.state === 'not_sent') return 0;
  if (charge.state === 'unknown') return charge.writeOffs?.at(-1)?.amountMicro ?? charge.reservedMicro;
  return charge.reservedMicro;
}

export const budgetBlockSchema = z.discriminatedUnion('reason', [
  // The next request's maximum cost does not fit in what is left.
  z.object({ reason: z.literal('insufficient'), requiredMicro: micro, remainingMicro: micro, at: timestampSchema }).strict(),
  // Provider usage exceeded the reserved upper bound (tokens or cost); scheduling stopped.
  z.object({ reason: z.literal('overrun'), requestId: idSchema, reservedMicro: micro, accountedMicro: micro, at: timestampSchema }).strict(),
]);

/** D104: one append-only top-up of a Run's budget. */
export const budgetTopUpSchema = z.object({ topUpId: idSchema, amountMicro: micro, createdAt: timestampSchema }).strict();
export const runBudgetSchema = z.object({
  currency: z.literal('CNY'),
  /** The Run's total limit: the amount set at start plus every top-up. */
  limitMicro: micro,
  /** Settled requests at their actual price. */
  settledMicro: micro,
  /** Unknown requests not yet written off, each at its full reservation. */
  unknownMicro: micro,
  reservedMicro: micro,
  /** limit − (settled + unknown + written off + reserved); negative after an overrun is clamped to 0 with `overrunMicro`. */
  remainingMicro: micro, overrunMicro: micro,
  blocked: budgetBlockSchema.optional(),
  /** R13B (D104/D105): the start amount, top-up history and unknown requests counted at their written-off amount. */
  initialLimitMicro: micro.optional(),
  topUps: z.array(budgetTopUpSchema).max(500).optional(),
  writtenOffMicro: micro.optional(),
}).strict();

/** D104: a trusted top-up; `resume` continues a Run the budget stopped once the top-up is recorded. */
export const addRunBudgetInputSchema = z.object({
  runId: idSchema, clientRequestId: idSchema, amountMicroCny: runBudgetInputSchema, resume: z.boolean(),
}).strict();
export const addRunBudgetResultSchema = z.object({
  runId: idSchema, topUpId: idSchema, duplicate: z.boolean(), resumed: z.boolean(),
  /** Why the Run did not continue although the top-up was recorded. */
  resumeError: errorCodeSchema.optional(),
}).strict();

const controlCharacters = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/u;
/** True when any word of free text looks like an API key (D096 rule); such a note is refused, never stored. */
export const containsApiKeyLike = (text: string) => text.split(/\s+/u).some(word => word.length > 0 && looksLikeApiKey(word)) || looksLikeApiKey(text);
/** D105: the host's own basis for a write-off, e.g. which console page and date they read. */
export const writeOffBasisSchema = z.string().trim().min(1).max(200)
  .refine(text => !controlCharacters.test(text), 'Basis cannot contain control characters')
  .refine(text => !containsApiKeyLike(text), 'Basis looks like it contains an API key');
export const writeOffChargeInputSchema = z.object({
  runId: idSchema, requestId: idSchema, clientRequestId: idSchema,
  amountMicroCny: micro.max(MAX_RUN_BUDGET_MICRO_CNY), basis: writeOffBasisSchema,
  acknowledgedUncertainty: z.literal(true),
}).strict();
export const writeOffChargeResultSchema = z.object({ runId: idSchema, requestId: idSchema, writeOffId: idSchema, duplicate: z.boolean() }).strict();

export type RequestCharge = z.infer<typeof requestChargeSchema>;
export type ChargeSettlement = z.infer<typeof chargeSettlementSchema>;
export type ChargeWriteOff = z.infer<typeof chargeWriteOffSchema>;
export type PricePeriod = z.infer<typeof pricePeriodSchema>;
export type RunBudget = z.infer<typeof runBudgetSchema>;
export type BudgetBlock = z.infer<typeof budgetBlockSchema>;
export type BudgetTopUp = z.infer<typeof budgetTopUpSchema>;
export type AddRunBudgetInput = z.infer<typeof addRunBudgetInputSchema>;
export type AddRunBudgetResult = z.infer<typeof addRunBudgetResultSchema>;
export type WriteOffChargeInput = z.infer<typeof writeOffChargeInputSchema>;
export type WriteOffChargeResult = z.infer<typeof writeOffChargeResultSchema>;

/** Micro-CNY as yuan, four decimals by default (1296 → ¥0.0013); six show a single request exactly. */
export const formatYuan = (micro: number, digits: 4 | 6 = 4) => `¥${(micro / 1_000_000).toFixed(digits)}`;
/** The Chinese stop reason for a budget block; Main records it as the Run's last error and the UI shows it. */
export function budgetBlockMessage(block: BudgetBlock): string {
  return block.reason === 'insufficient'
    ? `运行预算不足：下一次请求最高可能花费 ${formatYuan(block.requiredMicro)}，剩余额度 ${formatYuan(block.remainingMicro)}，已拒绝发送。`
    : `实际用量超出发送前预留的上限（预留 ${formatYuan(block.reservedMicro)}，实际 ${formatYuan(block.accountedMicro)}），已停止后续请求。`;
}
