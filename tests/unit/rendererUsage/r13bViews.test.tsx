import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BudgetStopNotice, UsagePage, parseAmountYuan, rangeOf, type LedgerCommands } from '../../../src/renderer/features/usage';
import type { SummaryCommands } from '../../../src/renderer/features/host';
import { ContextHint, SummaryDialog } from '../../../src/renderer/features/timeline';
import { RequestDetails } from '../../../src/renderer/features/timeline/MessageItem';
import { BudgetCard } from '../../../src/renderer/features/runPanel/RunPanel';
import { requestChargeSchema, type RequestCharge, type RunBudget } from '../../../src/shared/schemas/budget';
import type { RunSnapshot } from '../../../src/shared/types/run';
import type { UsageReport } from '../../../src/shared/schemas/usage';
import type { SummaryPreview } from '../../../src/shared/schemas/summary';

afterEach(cleanup);
const time = '2026-10-23T13:00:00.000Z';
const charge = (overrides: Partial<RequestCharge> = {}): RequestCharge => requestChargeSchema.parse({
  requestId: 'r1', providerId: 'deepseek', modelId: 'deepseek-flash', currency: 'CNY', state: 'settled', inputTokenBound: 700, outputTokenLimit: 256,
  inputMicroPerToken: 2, outputMicroPerToken: 8, reservedMicro: 3448, inputTokens: 300, outputTokens: 6, accountedMicro: 648, chargedMicro: 648,
  priceReviewedAt: time, createdAt: time, updatedAt: time, ...overrides,
});
const unknown = (overrides: Partial<RequestCharge> = {}) => charge({ state: 'unknown', inputTokens: null, outputTokens: null, accountedMicro: null, chargedMicro: 3448, ...overrides });
const ledger = (overrides: Partial<LedgerCommands> = {}): LedgerCommands => ({
  addBudget: vi.fn(async () => ({ runId: 'run', topUpId: 't', duplicate: false, resumed: true })), resume: vi.fn(async () => undefined),
  writeOff: vi.fn(async () => ({ runId: 'run', requestId: 'r1', writeOffId: 'w', duplicate: false })), pending: undefined, error: undefined, notice: undefined, available: true, ...overrides,
}) as LedgerCommands;
const budget = (overrides: Partial<RunBudget> = {}): RunBudget => ({ currency: 'CNY', limitMicro: 1_000_000, settledMicro: 0, unknownMicro: 0, reservedMicro: 0, remainingMicro: 1_000_000, overrunMicro: 0, ...overrides });

describe('settlement and write-off display (D105/D106)', () => {
  it('says an off-peak, cache-hit settlement in the words of the console', () => {
    render(<RequestDetails id="d" runId="run" lines={[]} charge={charge({ chargedMicro: 128, settlement: { period: 'off_peak', startedAt: time, finishedAt: time, cacheHitTokens: 200,
      cacheHitMicroPerMillion: 20_000, cacheMissMicroPerMillion: 1_000_000, outputMicroPerMillion: 4_000_000, amountMicro: 128, evidence: 'e' } })} />);
    expect(document.body.textContent).toContain('输入 300（缓存命中 200） / 输出 6 tokens · 花费 ¥0.000128 · 按空闲价（高峰价的一半）');
  });

  it('writes off an unknown charge only with an amount within the cap, a clean basis and the console check', async () => {
    const commands = ledger();
    render(<RequestDetails id="d" lines={[]} charge={unknown()} runId="run" ledger={commands} />);
    fireEvent.click(screen.getByRole('button', { name: '核销' }));
    const save = screen.getByRole('button', { name: '保存核销' }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText('实际金额（元）'), { target: { value: '0.004' } });
    expect(screen.getByRole('alert').textContent).toContain('不能超过这次请求的预留上限');
    fireEvent.change(screen.getByLabelText('实际金额（元）'), { target: { value: '0.0012' } });
    fireEvent.change(screen.getByLabelText('依据说明'), { target: { value: 'sk-0123456789abcdefABCDEF' } });
    expect(screen.getByRole('alert').textContent).toContain('API Key');
    fireEvent.change(screen.getByLabelText('依据说明'), { target: { value: 'DeepSeek 控制台 10/23 明细' } });
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('我已在服务商控制台核对过这次请求的实际扣费'));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(commands.writeOff).toHaveBeenCalledWith({ runId: 'run', requestId: 'r1', amountMicroCny: 1200, basis: 'DeepSeek 控制台 10/23 明细' }));
  });

  it('shows a written-off amount next to the cap and the difference', () => {
    render(<RequestDetails id="d" lines={[]} charge={unknown({ chargedMicro: 1200, writeOffs: [{ writeOffId: 'w', amountMicro: 1200, basis: '控制台明细', createdAt: time }] })} runId="run" ledger={ledger()} />);
    expect(document.body.textContent).toContain('已核销 ¥0.001200（原按上限计 ¥0.003448，比原上限少 ¥0.002248） · 依据：控制台明细');
    expect(screen.getByRole('button', { name: '更正核销' })).toBeTruthy();
  });

  it.each([['0', 0], ['0.000001', 1], ['12.5', 12_500_000]] as const)('accepts write-off amount %s', (text, micro) => expect(parseAmountYuan(text)).toBe(micro));
});

describe('budget top-ups (D104)', () => {
  it('continues a budget-stopped Run from the notice, suggesting at least the shortfall', async () => {
    const commands = ledger();
    const snapshot = { status: 'error', budget: budget({ limitMicro: 1000, remainingMicro: 1000, blocked: { reason: 'insufficient', requiredMicro: 1_500_000, remainingMicro: 1000, at: time } }) } as RunSnapshot;
    render(<BudgetStopNotice snapshot={snapshot} ledger={commands} />);
    expect(screen.getByRole('alert', { name: '预算不足' }).textContent).toContain('下一次请求最高可能花费 ¥1.5000，剩余额度 ¥0.0010');
    expect((screen.getByLabelText('追加预算（元）') as HTMLInputElement).value).toBe('1.50');
    expect(screen.queryByRole('button', { name: '直接继续' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '追加并继续' }));
    await waitFor(() => expect(commands.addBudget).toHaveBeenCalledWith(1_500_000, true));
  });

  it('offers to continue without a top-up once what is left covers the next request', () => {
    const commands = ledger();
    render(<BudgetStopNotice snapshot={{ status: 'error', budget: budget({ remainingMicro: 5000, blocked: { reason: 'insufficient', requiredMicro: 4000, remainingMicro: 100, at: time } }) } as RunSnapshot} ledger={commands} />);
    fireEvent.click(screen.getByRole('button', { name: '直接继续' }));
    expect(commands.resume).toHaveBeenCalled();
  });

  it('shows the top-up total and history in the budget card, and adds from there', async () => {
    const commands = ledger();
    render(<BudgetCard snapshot={{ status: 'paused', budget: budget({ limitMicro: 2_000_000, initialLimitMicro: 1_000_000, remainingMicro: 2_000_000,
      topUps: [{ topUpId: 't', amountMicro: 1_000_000, createdAt: time }] }) } as RunSnapshot} ledger={commands} />);
    const bar = screen.getByRole('region', { name: '运行预算' });
    expect(bar.textContent).toContain('/ ¥2.00（含追加 ¥1.00）');
    expect(bar.textContent).toContain('开始时 ¥1.0000，之后共追加 ¥1.0000。');
    expect(bar.textContent).toContain('追加记录（1）');
    fireEvent.click(screen.getByRole('button', { name: '追加预算' }));
    fireEvent.change(screen.getByLabelText('追加预算（元）'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    await waitFor(() => expect(commands.addBudget).toHaveBeenCalledWith(500_000, false));
  });
});

const bucket = { requests: 3, settled: { count: 2, inputTokens: 600, cacheHitTokens: 200, outputTokens: 12, amountMicro: 904, peakMicro: 1296, offPeakCount: 1 },
  unknown: { count: 1, amountMicro: 3448 }, writtenOff: { count: 0, amountMicro: 0, capMicro: 0 }, reserved: { count: 0, amountMicro: 0 }, notSent: 0, totalMicro: 4352 };
const report: UsageReport = { generatedAt: time, timeZone: 'Asia/Shanghai', totals: bucket,
  byRun: [{ ...bucket, runId: 'run', roomId: 'room', roomName: '房间', task: '校园跑腿', createdAt: time }],
  byModel: [{ ...bucket, providerId: 'p', providerName: 'DeepSeek 直连', modelId: 'deepseek-flash' }],
  byDate: [{ ...bucket, date: '2026-10-23' }],
  unknownCharges: [{ requestId: 'r9', runId: 'run', roomName: '房间', task: '校园跑腿', kind: 'turn', speaker: '审查者', providerName: 'DeepSeek 直连', modelId: 'deepseek-flash',
    createdAt: time, reservedMicro: 3448, observedInputTokens: null, observedOutputTokens: null, writeOffs: [] }] };

describe('usage page (D108)', () => {
  it('keeps settled, unknown-at-cap and written-off amounts apart, groups three ways and exports through Main', async () => {
    const api = { run: {} as never, usage: { getReport: vi.fn(async () => report), writeOff: vi.fn(), exportCsv: vi.fn(async () => ({ saved: true, fileName: '用量.csv', rows: 3 })) } };
    render(<UsagePage api={api} />);
    await screen.findByText('用量与花费');
    const totals = screen.getByRole('region', { name: '合计' }).textContent!;
    expect(totals).toContain('已结算¥0.00092 次，其中 1 次按空闲价；全按高峰价为 ¥0.0013');
    expect(totals).toContain('未知（按上限计）¥0.00341 次，可到控制台核对后核销');
    expect(screen.getByRole('table').textContent).toContain('校园跑腿');
    fireEvent.click(screen.getByRole('tab', { name: '按模型' }));
    expect(screen.getByRole('table').textContent).toContain('DeepSeek 直连');
    fireEvent.click(screen.getByRole('tab', { name: '按日期' }));
    expect(screen.getByRole('table').textContent).toContain('2026-10-23');
    expect(screen.getByRole('region', { name: '待核对的未知费用' }).textContent).toContain('审查者');
    // D117: the page asks for this month by default and for everything on request.
    expect(api.usage.getReport).toHaveBeenLastCalledWith({ since: expect.any(String), until: expect.any(String) });
    fireEvent.change(screen.getByLabelText('时间范围'), { target: { value: 'all' } });
    await waitFor(() => expect(api.usage.getReport).toHaveBeenLastCalledWith({}));
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));
    expect(await screen.findByText('已导出 3 条记录到“用量.csv”。')).toBeTruthy();
    expect(api.usage.exportCsv).toHaveBeenLastCalledWith({});
  });
  it('turns 本月 and 上月 into calendar months in this computer’s time zone', () => {
    const now = new Date(2026, 0, 15, 12);
    expect(rangeOf('this-month', now)).toEqual({ since: new Date(2026, 0, 1).toISOString(), until: new Date(2026, 1, 1).toISOString() });
    expect(rangeOf('last-month', now)).toEqual({ since: new Date(2025, 11, 1).toISOString(), until: new Date(2026, 0, 1).toISOString() });
    expect(rangeOf('all', now)).toEqual({});
  });
});

const summaryCommands = (preview: SummaryPreview): SummaryCommands => ({ preview: vi.fn(async () => preview), generate: vi.fn(async () => true), confirm: vi.fn(async () => true),
  pending: undefined, error: undefined, available: true }) as unknown as SummaryCommands;
const previewOf = (overrides: Partial<SummaryPreview> = {}): SummaryPreview => ({ runId: 'run', available: true, candidates: [1, 2, 3, 4].map(number => ({ slotId: `s${number}`, number, speaker: `成员${number}`, excerpt: `内容${number}` })),
  throughSlotId: 's2', firstNumber: 1, lastNumber: 2, agents: [{ agentId: 'c', name: '综合者', providerId: 'p', modelId: 'deepseek-flash' }], agentId: 'c',
  cost: { kind: 'priced', maxMicro: 12_345, remainingMicro: 900_000 }, inputTokens: 900, inputBudgetTokens: 126_976, ...overrides });

describe('summary controls (D107)', () => {
  it('states coverage, writer and maximum cost before anything is sent, and generates on the host\'s click', async () => {
    const commands = summaryCommands(previewOf());
    render(<SummaryDialog snapshot={{ runId: 'run', sequence: 3, messages: [] } as unknown as RunSnapshot} summaries={commands} onClose={() => {}} />);
    const panel = await screen.findByRole('dialog', { name: '生成讨论摘要' });
    expect(panel.textContent).toContain('预计最多 ¥0.0123');
    expect(panel.textContent).toContain('预计最高 ¥0.0123：发送前按高峰价和输出上限预留');
    expect((screen.getByLabelText('摘要覆盖到第几条') as HTMLSelectElement).value).toBe('s2');
    expect(commands.generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '生成摘要（发送 1 次请求）' }));
    await waitFor(() => expect(commands.generate).toHaveBeenCalledWith({ agentId: 'c', throughSlotId: 's2' }));
  });

  it('explains why a summary cannot be generated now', async () => {
    render(<SummaryDialog snapshot={{ runId: 'run', sequence: 3, messages: [] } as unknown as RunSnapshot} onClose={() => {}}
      summaries={summaryCommands(previewOf({ available: false, reason: 'budget_insufficient', cost: { kind: 'priced', maxMicro: 50_000, remainingMicro: 10_000 } }))} />);
    expect((await screen.findByRole('alert')).textContent).toContain('这次摘要最高可能花费 ¥0.0500，剩余额度 ¥0.0100');
    expect((screen.getByRole('button', { name: '生成摘要（发送 1 次请求）' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('hints at the context limit only when it matters, and never generates by itself', () => {
    const onSummarize = vi.fn();
    const base = { runId: 'run', status: 'paused', messages: [], turns: [] };
    const { rerender, container } = render(<ContextHint snapshot={{ ...base, contextPressure: { agentId: 'a', usedTokens: 100, inputBudgetTokens: 1000, omittedMessages: 0, summarizedMessages: 0, level: 'ok' } } as unknown as RunSnapshot} onSummarize={onSummarize} />);
    expect(container.textContent).toBe('');
    rerender(<ContextHint snapshot={{ ...base, contextPressure: { agentId: 'a', usedTokens: 800, inputBudgetTokens: 1000, omittedMessages: 0, summarizedMessages: 0, level: 'near' } } as unknown as RunSnapshot} onSummarize={onSummarize} />);
    expect(container.textContent).toContain('约占可用输入的 80%');
    rerender(<ContextHint snapshot={{ ...base, contextPressure: { agentId: 'a', usedTokens: 990, inputBudgetTokens: 1000, omittedMessages: 3, summarizedMessages: 0, level: 'over' } } as unknown as RunSnapshot} onSummarize={onSummarize} />);
    expect(container.textContent).toContain('有 3 条较早的发言放不下');
    expect(onSummarize).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '生成摘要…' }));
    expect(onSummarize).toHaveBeenCalledTimes(1);
  });
});
