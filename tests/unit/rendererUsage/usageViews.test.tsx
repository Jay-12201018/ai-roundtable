import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { commandErrorMessage, runTokenTotals, UsagePage, usageOfMessage } from '../../../src/renderer/features/usage';
import { RequestDetails } from '../../../src/renderer/features/timeline/MessageItem';
import { usageDetail, usageLabel } from '../../../src/renderer/features/timeline/model';
import { requestUsageSchema, type RequestUsage, type UsageBucket, type UsageReport } from '../../../src/shared/schemas/usage';
import type { RunSnapshot } from '../../../src/shared/types/run';

afterEach(cleanup);
const time = '2026-10-22T00:00:00.000Z';
const usage = (overrides: Partial<RequestUsage> = {}): RequestUsage => requestUsageSchema.parse({
  requestId: 'r1', agentId: 'a', providerId: 'deepseek', modelId: 'deepseek-flash', kind: 'turn', state: 'reported', inputTokens: 300, outputTokens: 6, cacheHitTokens: null,
  createdAt: time, updatedAt: time, ...overrides,
});
const bucket = (overrides: Partial<UsageBucket> = {}): UsageBucket => ({ requests: 2, reportedRequests: 1, inputTokens: 300, cacheHitTokens: 40, outputTokens: 6, unknownRequests: 1, inFlightRequests: 0, notSentRequests: 0, ...overrides });
const report = (): UsageReport => ({ generatedAt: time, timeZone: 'Asia/Shanghai', totals: bucket(),
  byRun: [{ runId: 'run', roomId: 'room', roomName: '房间', task: '目标', createdAt: time, ...bucket() }],
  byModel: [{ providerId: 'p', providerName: 'DeepSeek', modelId: 'deepseek-flash', ...bucket() }, { providerId: 'q', providerName: 'OpenAI', modelId: 'gpt-6-astra', ...bucket() }],
  byDate: [{ date: '2026-10-22', ...bucket() }], byKind: [{ kind: 'turn', ...bucket() }],
  unknownRequests: [{ requestId: 'r2', runId: 'run', roomName: '房间', task: '目标', kind: 'turn', speaker: '审查者', providerName: 'DeepSeek', modelId: 'deepseek-flash', createdAt: time, observedInputTokens: null, observedOutputTokens: null }] });

it('labels a reported request with its tokens and never an amount', () => {
  expect(usageLabel(usage())).toEqual({ text: '306 tokens', tone: 'plain' });
  expect(usageDetail(usage({ cacheHitTokens: 40 }))).toBe('输入 300（缓存命中 40） / 输出 6 tokens');
});

it('says plainly when a request was sent without complete usage, never as zero', () => {
  const unknown = usage({ state: 'unknown', inputTokens: null, outputTokens: null });
  expect(usageLabel(unknown)).toEqual({ text: '用量未知', tone: 'warn' });
  expect(usageDetail(unknown)).toContain('请到服务商控制台查看');
  expect(usageDetail(usage({ state: 'unknown', inputTokens: 5, outputTokens: 1 }))).toContain('已观察 输入 5 / 输出 1 tokens');
  expect(usageLabel(usage({ state: 'not_sent', inputTokens: null, outputTokens: null })).text).toBe('未发出');
  expect(usageLabel(usage({ state: 'in_flight', inputTokens: null, outputTokens: null })).text).toBe('生成中');
});

it('shows the request details with the usage line', () => {
  render(<RequestDetails id="d" usage={usage()} lines={[['模型 ID', 'deepseek-flash']]} />);
  const region = screen.getByRole('region', { name: '请求详情' });
  expect(region.textContent).toContain('输入 300 / 输出 6 tokens');
  expect(region.textContent).not.toMatch(/¥|费用|金额/u);
});

it('refuses a usage row that contradicts its state', () => {
  expect(() => usage({ state: 'reported', inputTokens: null })).toThrow();
  expect(() => usage({ state: 'not_sent' })).toThrow();
  expect(() => usage({ cacheHitTokens: 301 })).toThrow();
});

it('finds a message usage through its Attempt or summary request, and totals only what was reported', () => {
  const rows = [usage(), usage({ requestId: 'r2', state: 'unknown', inputTokens: 9, outputTokens: 9 }), usage({ requestId: 'r3', state: 'not_sent', inputTokens: null, outputTokens: null })];
  const snapshot = { usage: rows, attempts: [{ requestId: 'r1', messageId: 'm1' }], summaries: [{ requests: [{ requestId: 'r2', messageId: 'm2' }] }] } as unknown as RunSnapshot;
  expect(usageOfMessage(snapshot, 'm1')?.requestId).toBe('r1');
  expect(usageOfMessage(snapshot, 'm2')?.requestId).toBe('r2');
  expect(usageOfMessage(snapshot, 'other')).toBeUndefined();
  expect(runTokenTotals(snapshot)).toEqual({ requests: 2, unknownRequests: 1, inputTokens: 300, outputTokens: 6 });
});

it('the usage page shows tokens per model, says the provider bills, and exports without any money', async () => {
  const api = { usage: { getReport: vi.fn(async () => report()), exportCsv: vi.fn(async () => ({ saved: true, fileName: 'a.csv', rows: 2 })) } };
  render(<UsagePage api={api as never} />);
  await screen.findByRole('region', { name: '合计' });
  expect(screen.getByText(/费用由服务商收取，请到服务商控制台查看账单；这里不估算/u)).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '按模型' }));
  const table = screen.getByRole('table');
  expect(within(table).getByText('gpt-6-astra')).toBeTruthy();
  expect(screen.getByRole('region', { name: '没拿到用量的请求' }).textContent).toContain('审查者');
  expect(document.body.textContent).not.toMatch(/¥|预算|花费|金额|核销|预留/u);
  fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));
  await screen.findByText('已导出 2 条记录到“a.csv”。');
});

it('keeps a refused command in words', () => {
  expect(commandErrorMessage({ code: 'invalid_state' })).toContain('当前状态不允许');
  expect(commandErrorMessage({})).toBe('操作没有完成，请刷新后重试。');
});
