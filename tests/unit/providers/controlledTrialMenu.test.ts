// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { TrialRecord } from '../../../src/main/providers/controlledTrial/record';

const fixture = vi.hoisted(() => ({ showMessageBox: vi.fn(), setApplicationMenu: vi.fn(), menu: { append: vi.fn() } }));
vi.mock('electron', () => ({
  app: { isReady: () => true }, dialog: { showMessageBox: fixture.showMessageBox },
  Menu: { getApplicationMenu: () => fixture.menu, setApplicationMenu: fixture.setApplicationMenu },
  MenuItem: class { constructor(options: object) { Object.assign(this, options); } },
}));
import { confirmTrial, formatTrialDiagnostics, installTrialMenu } from '../../../src/main/providers/controlledTrial/menu';

const time = '2026-10-18T12:00:00.000Z';
function record(diagnostics?: TrialRecord['diagnostics']): TrialRecord {
  return { text: 'partial', errorCode: 'network_error', state: 'unknown', outcome: 'error',
    actualInputTokens: null, actualOutputTokens: null, accountedMicroCny: null, estimatedInputTokens: 67,
    ...(diagnostics ? { diagnostics } : {}),
  } as TrialRecord;
}
const diagnostic = (patch: Partial<NonNullable<TrialRecord['diagnostics']>> = {}): NonNullable<TrialRecord['diagnostics']> => ({
  version: 1 as const, stage: 'credential' as const, evidence: 'not_started' as const,
  category: 'credential_read_failed' as const, startedAt: time, updatedAt: time,
  ...(patch.evidence && patch.evidence !== 'not_started' ? { clientInvokedAt: time } : {}),
  ...(patch.evidence === 'http_response' ? { httpResponseAt: time, httpStatus: 200 } : {}), ...patch,
});
beforeEach(() => { vi.clearAllMocks(); fixture.showMessageBox.mockResolvedValue({ response: 0 }); });

it('keeps historical network_error records inconclusive without inventing new evidence', () => {
  expect(formatTrialDiagnostics(record())).toContain('当时未记录诊断');
  expect(formatTrialDiagnostics(record())).toContain('无法追溯');
  expect(formatTrialDiagnostics(record())).not.toContain('未开始网络调用');
});
it.each([
  ['not_started', '未开始网络调用'],
  ['client_invoked', '已调用网络客户端，无法确认服务商是否收到'],
  ['http_response', '已观察到 HTTP 响应'],
] as const)('renders evidence %s without equating it to delivery or billing', (evidence, label) => {
  const text = formatTrialDiagnostics(record(diagnostic({ evidence })));
  expect(text).toContain(label); expect(text).toContain('账单');
  expect(text).not.toContain('已确认 DeepSeek 收到');
});
it.each([
  ['credential_unavailable', '凭据不可用'], ['credential_read_failed', '凭据读取失败'],
  ['dns_failed', 'DNS 解析失败'], ['target_rejected', '请求目标被安全策略拒绝'],
  ['tcp_failed', 'TCP 连接失败'], ['tcp_timeout', 'TCP 连接超时'],
  ['tls_failed', 'TLS 握手或证书验证失败'], ['http_error', 'HTTP 状态错误'],
  ['request_timeout', '请求超时'], ['request_interrupted', '请求或响应中断'],
  ['response_invalid', '响应或 SSE 解析失败'], ['usage_missing', '服务商 usage 缺失'],
  ['accounting_failed', '费用核算或记录失败'], ['cancelled', '请求已取消'],
  ['policy_rejected', '安全检查未通过'], ['network_unknown', '网络异常，具体原因未知'],
] as const)('uses a fixed readable label for %s', (category, label) => {
  expect(formatTrialDiagnostics(record(diagnostic({ category })))).toContain(label);
});
it('shows only numerical HTTP status and recorded phase times', () => {
  const text = formatTrialDiagnostics(record(diagnostic({ stage: 'response', category: 'http_error', evidence: 'http_response',
    httpStatus: 429, clientInvokedAt: time, httpResponseAt: time })));
  expect(text).toContain('HTTP 429'); expect(text).toContain(time); expect(text).toContain('HTTP 响应');
});
it('recent-record action displays diagnostics and retained reservation without executing a request', async () => {
  const row = record(diagnostic({ stage: 'usage', category: 'usage_missing', evidence: 'http_response', httpStatus: 200 }));
  const database = { listControlledTrials: vi.fn(() => [row]) };
  const service = { execute: vi.fn(), prepare: vi.fn(), abort: vi.fn() };
  installTrialMenu(database as never, service as never, () => false);
  const menu = fixture.menu.append.mock.calls[0][0] as { submenu: { label: string; click: () => void }[] };
  menu.submenu.find(item => item.label === '查看最近测试记录…')!.click();
  expect(fixture.showMessageBox).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    detail: expect.stringContaining('服务商 usage 缺失'),
  }));
  const detail = fixture.showMessageBox.mock.calls[0][0].detail;
  expect(detail).toContain('仍保留 ¥0.05'); expect(detail).toContain('HTTP 200');
  expect(service.execute).not.toHaveBeenCalled(); expect(service.prepare).not.toHaveBeenCalled();
});

it('does not echo malformed diagnostic objects, unknown codes, headers or raw exceptions', () => {
  const row = record({ ...diagnostic(), category: 'fake-sensitive-value', authorization: 'fake-sensitive-value',
    error: { stack: 'fake-sensitive-value' }, httpStatus: 'fake-sensitive-value',
  } as never);
  row.errorCode = 'fake-sensitive-value' as never;
  const text = formatTrialDiagnostics(row);
  expect(text).toContain('当时未记录诊断'); expect(text).not.toContain('fake-sensitive-value');
  expect(text).not.toContain('authorization'); expect(text).not.toContain('stack');
});
it('retains native explicit send confirmation with cancel selected by default', async () => {
  const accepted = await confirmTrial({ providerId: 'p', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash',
    prompt: 'Reply OK.', estimatedInputTokens: 67, estimatedMicroCny: 1158, priceExpiresAt: time,
  } as never);
  expect(accepted).toBe(false);
  expect(fixture.showMessageBox).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    buttons: ['取消', '授权并发送这一次请求'], defaultId: 0, cancelId: 0,
  }));
});
it('post-request error dialog includes safe diagnosis while keeping unknown charges reserved', async () => {
  const row = record(diagnostic({ stage: 'response', category: 'http_error', evidence: 'http_response', httpStatus: 403 }));
  const database = { listProviderSummaries: () => [{ id: 'p', name: 'Fixture', enabled: true, kind: 'openai-compatible' }],
    getProviderConfiguration: () => ({ baseUrl: 'https://api.deepseek.com' }) };
  const service = { prepare: vi.fn(() => ({ id: 'trial' })), execute: vi.fn(async () => row), abort: vi.fn() };
  fixture.showMessageBox.mockResolvedValueOnce({ response: 1 });
  installTrialMenu(database as never, service as never, () => false);
  const menu = fixture.menu.append.mock.calls[0][0] as { submenu: { label: string; click: () => void }[] };
  menu.submenu.find(item => item.label === 'DeepSeek 单次测试…')!.click();
  await vi.waitFor(() => expect(fixture.showMessageBox).toHaveBeenCalledTimes(2));
  expect(fixture.showMessageBox.mock.calls[1][0]).toMatchObject({ message: '受控测试：error / unknown',
    detail: expect.stringContaining('HTTP 403') });
  expect(fixture.showMessageBox.mock.calls[1][0].detail).toContain('¥0.05 预留仍保留');
  expect(service.execute).toHaveBeenCalledExactlyOnceWith('trial');
});
