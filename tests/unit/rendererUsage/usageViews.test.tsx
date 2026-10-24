import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { chargeOfMessage, parseBudgetYuan } from '../../../src/renderer/features/usage';
import { BudgetCard } from '../../../src/renderer/features/runPanel/RunPanel';
import { RequestDetails } from '../../../src/renderer/features/timeline/MessageItem';
import { chargeDetail, chargeLabel } from '../../../src/renderer/features/timeline/model';
import type { RequestCharge, RunBudget } from '../../../src/shared/schemas/budget';
import { requestChargeSchema } from '../../../src/shared/schemas/budget';
import type { RunSnapshot } from '../../../src/shared/types/run';

afterEach(cleanup);
const time = '2026-10-22T00:00:00.000Z';
const charge = (overrides: Partial<RequestCharge> = {}): RequestCharge => requestChargeSchema.parse({
  requestId: 'r1', providerId: 'deepseek', modelId: 'deepseek-flash', currency: 'CNY', state: 'settled', inputTokenBound: 700, outputTokenLimit: 256,
  inputMicroPerToken: 2, outputMicroPerToken: 8, reservedMicro: 3448, inputTokens: 300, outputTokens: 6, accountedMicro: 648, chargedMicro: 648,
  priceReviewedAt: time, createdAt: time, updatedAt: time, ...overrides,
});
const budget = (overrides: Partial<RunBudget> = {}): RunBudget => ({ currency: 'CNY', limitMicro: 1_000_000, settledMicro: 648, unknownMicro: 0, reservedMicro: 0, remainingMicro: 999_352, overrunMicro: 0, ...overrides });

it('shows provider usage and exact cost for a settled request', () => {
  // R13B (D106): every settled amount says which price applied; rows without settlement detail were billed at peak.
  expect(chargeDetail(charge())).toBe('输入 300 / 输出 6 tokens · 花费 ¥0.000648 · 按高峰价');
  // R16: the footer shows the short amount; it is a button that opens these details.
  expect(chargeLabel(charge())).toEqual({ text: '¥0.0006', tone: 'plain' });
  render(<RequestDetails id="d" charge={charge()} runId="run" lines={[]} />);
  expect(screen.getByRole('region', { name: '请求详情' }).textContent).toContain('输入 300 / 输出 6 tokens · 花费 ¥0.000648 · 按高峰价');
});

it('shows unknown cost at the reserved cap, never as zero', () => {
  const unknown = charge({ state: 'unknown', inputTokens: null, outputTokens: null, accountedMicro: null, chargedMicro: 3448 });
  expect(chargeDetail(unknown)).toBe('费用未知（按上限计 ¥0.003448） · 服务商未返回用量。可以到服务商控制台核对后核销。');
  expect(chargeLabel(unknown)).toEqual({ text: '费用未知 · 按上限 ¥0.0034', tone: 'warn' });
  const reserved = charge({ state: 'reserved', inputTokens: null, outputTokens: null, accountedMicro: null, chargedMicro: 3448 });
  expect(chargeDetail(reserved)).toBe('生成中 · 已预留最高 ¥0.003448，结束后按实际用量结算');
  expect(chargeLabel(reserved).text).toBe('已预留最高 ¥0.0034');
  const notSent = charge({ state: 'not_sent', inputTokens: null, outputTokens: null, accountedMicro: null, chargedMicro: 0 });
  expect(chargeDetail(notSent)).toBe('请求未发出，未计费');
  expect(chargeLabel(notSent).text).toBe('未发出，未计费');
});

it('shows no cost line for a Mock message without a ledger entry', () => {
  render(<RequestDetails id="d" charge={undefined} runId="run" lines={[['模型 ID', 'mock']]} />);
  expect(screen.getByRole('region', { name: '请求详情' }).textContent).not.toContain('费用');
});

it('summarises the Run budget with unknown spend, in-flight reservation and remaining amount', () => {
  render(<BudgetCard snapshot={{ status: 'running', budget: budget({ unknownMicro: 3448, reservedMicro: 3448, remainingMicro: 992_456 }) } as RunSnapshot} />);
  const card = screen.getByRole('region', { name: '运行预算' });
  expect(card.textContent).toContain('¥0.0041 / ¥1.00');
  expect(card.textContent).toContain('剩余额度¥0.9925');
  expect(card.textContent).toContain('进行中预留¥0.0034');
  expect(card.textContent).toContain('未知费用（按上限计）¥0.0034');
});

it('marks a budget stop in the budget card', () => {
  render(<BudgetCard snapshot={{ status: 'error', budget: budget({ limitMicro: 1000, settledMicro: 0, remainingMicro: 1000, blocked: { reason: 'insufficient', requiredMicro: 3448, remainingMicro: 1000, at: time } }) } as RunSnapshot} />);
  expect(screen.getByText('已因预算不足停止发送，可以在讨论末尾追加并继续。')).toBeTruthy();
});

it('finds a message charge through its Attempt', () => {
  const snapshot = { attempts: [{ requestId: 'r1', messageId: 'm1' }], charges: [charge()] } as unknown as RunSnapshot;
  expect(chargeOfMessage(snapshot, 'm1')?.requestId).toBe('r1');
  expect(chargeOfMessage(snapshot, 'other')).toBeUndefined();
});

it.each([['1', 1_000_000], ['0.01', 10_000], ['0.000001', 1], ['1000', 1_000_000_000], [' 2.5 ', 2_500_000]] as const)('parses budget %s yuan', (text, micro) => {
  expect(parseBudgetYuan(text)).toBe(micro);
});
it.each(['', '0', '-1', '1000.000001', '0.0000001', '1e3', 'abc', '1,5'])('rejects budget text %j', text => {
  expect(parseBudgetYuan(text)).toBeUndefined();
});
