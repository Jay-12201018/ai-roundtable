import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MessageUsage, RunBudgetBar, chargeOfMessage, parseBudgetYuan } from '../../../src/renderer/features/usage';
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
  render(<MessageUsage charge={charge()} />);
  expect(screen.getByText('输入 300 / 输出 6 tokens · 花费 ¥0.000648')).toBeTruthy();
});

it('shows unknown cost at the reserved cap, never as zero', () => {
  render(<MessageUsage charge={charge({ state: 'unknown', inputTokens: null, outputTokens: null, accountedMicro: null, chargedMicro: 3448 })} />);
  expect(screen.getByText('费用未知（按上限计 ¥0.003448） · 服务商未返回用量')).toBeTruthy();
  cleanup();
  render(<MessageUsage charge={charge({ state: 'reserved', inputTokens: null, outputTokens: null, accountedMicro: null, chargedMicro: 3448 })} />);
  expect(screen.getByText('生成中 · 已预留最高 ¥0.003448')).toBeTruthy();
  cleanup();
  render(<MessageUsage charge={charge({ state: 'not_sent', inputTokens: null, outputTokens: null, accountedMicro: null, chargedMicro: 0 })} />);
  expect(screen.getByText('请求未发出，未计费')).toBeTruthy();
});

it('renders nothing for a Mock message without a ledger entry', () => {
  const { container } = render(<MessageUsage charge={undefined} />);
  expect(container.textContent).toBe('');
});

it('summarises the Run budget with unknown spend, in-flight reservation and remaining amount', () => {
  render(<RunBudgetBar snapshot={{ budget: budget({ unknownMicro: 3448, reservedMicro: 3448, remainingMicro: 992_456 }) } as RunSnapshot} />);
  const bar = screen.getByRole('region', { name: '运行预算' });
  expect(bar.textContent).toBe('预算 ¥1.0000累计花费 ¥0.0041（含未知费用按上限计 ¥0.0034）进行中预留 ¥0.0034剩余额度 ¥0.9925');
});

it('marks a budget stop in the bar', () => {
  render(<RunBudgetBar snapshot={{ budget: budget({ limitMicro: 1000, settledMicro: 0, remainingMicro: 1000, blocked: { reason: 'insufficient', requiredMicro: 3448, remainingMicro: 1000, at: time } }) } as RunSnapshot} />);
  expect(screen.getByText('已因预算不足停止发送')).toBeTruthy();
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
