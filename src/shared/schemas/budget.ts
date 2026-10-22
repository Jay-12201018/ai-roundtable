import { z } from 'zod';
import { idSchema, timestampSchema } from './common';

const micro = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const tokens = micro;

/** Default Run budget: ¥1, in micro-CNY (1 CNY = 1,000,000). */
export const DEFAULT_RUN_BUDGET_MICRO_CNY = 1_000_000;
/** Largest Run budget a host may set at start: ¥1000. */
export const MAX_RUN_BUDGET_MICRO_CNY = 1_000_000_000;
export const runBudgetInputSchema = z.number().int().positive().max(MAX_RUN_BUDGET_MICRO_CNY);

/**
 * One request's ledger entry. `reserved` is the maximum cost held before sending; `settled` records provider usage
 * at the approved rates; `unknown` (interrupted / no usage after sending) is charged at the full reservation and is
 * never recorded as zero; `not_sent` is only used when the request provably never reached the network.
 */
export const chargeStateValues = ['reserved', 'settled', 'unknown', 'not_sent'] as const;
export const requestChargeSchema = z.object({
  requestId: idSchema, providerId: idSchema, modelId: idSchema, currency: z.enum(['CNY', 'USD']),
  state: z.enum(chargeStateValues),
  inputTokenBound: tokens, outputTokenLimit: tokens,
  inputMicroPerToken: micro, outputMicroPerToken: micro, reservedMicro: micro,
  inputTokens: tokens.nullable(), outputTokens: tokens.nullable(), accountedMicro: micro.nullable(),
  /** What this request counts against the budget now: reservation while open or unknown, accounted when settled. */
  chargedMicro: micro,
  priceReviewedAt: timestampSchema.nullable(), createdAt: timestampSchema, updatedAt: timestampSchema,
}).strict().superRefine((charge, ctx) => {
  const settled = charge.state === 'settled';
  const expected = settled && charge.inputTokens !== null && charge.outputTokens !== null
    ? charge.inputTokens * charge.inputMicroPerToken + charge.outputTokens * charge.outputMicroPerToken : null;
  if (settled !== (charge.accountedMicro !== null) || settled && charge.accountedMicro !== expected
    || charge.chargedMicro !== (settled ? charge.accountedMicro : charge.state === 'not_sent' ? 0 : charge.reservedMicro)
    || charge.state === 'not_sent' && (charge.inputTokens !== null || charge.outputTokens !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Unknown charges cannot be recorded as zero or mismatch usage' });
  }
});

export const budgetBlockSchema = z.discriminatedUnion('reason', [
  // The next request's maximum cost does not fit in what is left.
  z.object({ reason: z.literal('insufficient'), requiredMicro: micro, remainingMicro: micro, at: timestampSchema }).strict(),
  // Provider usage exceeded the reserved upper bound (tokens or cost); scheduling stopped.
  z.object({ reason: z.literal('overrun'), requestId: idSchema, reservedMicro: micro, accountedMicro: micro, at: timestampSchema }).strict(),
]);

export const runBudgetSchema = z.object({
  currency: z.literal('CNY'), limitMicro: micro,
  settledMicro: micro, unknownMicro: micro, reservedMicro: micro,
  /** limit − (settled + unknown + reserved); negative after an overrun is clamped to 0 with `overrunMicro`. */
  remainingMicro: micro, overrunMicro: micro,
  blocked: budgetBlockSchema.optional(),
}).strict();

export type RequestCharge = z.infer<typeof requestChargeSchema>;
export type RunBudget = z.infer<typeof runBudgetSchema>;
export type BudgetBlock = z.infer<typeof budgetBlockSchema>;

/** Micro-CNY as yuan, four decimals by default (1296 → ¥0.0013); six show a single request exactly. */
export const formatYuan = (micro: number, digits: 4 | 6 = 4) => `¥${(micro / 1_000_000).toFixed(digits)}`;
/** The Chinese stop reason for a budget block; Main records it as the Run's last error and the UI shows it. */
export function budgetBlockMessage(block: BudgetBlock): string {
  return block.reason === 'insufficient'
    ? `运行预算不足：下一次请求最高可能花费 ${formatYuan(block.requiredMicro)}，剩余额度 ${formatYuan(block.remainingMicro)}，已拒绝发送。`
    : `实际用量超出发送前预留的上限（预留 ${formatYuan(block.reservedMicro)}，实际 ${formatYuan(block.accountedMicro)}），已停止后续请求。`;
}
