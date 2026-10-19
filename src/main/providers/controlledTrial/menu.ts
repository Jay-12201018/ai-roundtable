import { app, dialog, Menu, MenuItem } from 'electron';
import type { Database } from '../../database/Database';
import { ControlledTrialService, type TrialQuote } from './ControlledTrialService';
import { toPublicError } from '../../../shared/contracts/errors';
import { errorCodeSchema } from '../../../shared/schemas/error';
import { trialDiagnosticsSchema } from '../diagnostics';
import type { TrialRecord } from './record';
import { reconciliationEvidenceSummary } from './reconciliation';

export const trialWarning = (quote: TrialQuote) => [
  `Provider：${quote.providerId}；目标：${quote.baseUrl} · ${quote.modelId}`,
  `单 Agent、仅本次请求；提示词：${quote.prompt}`,
  `输入估算 ${quote.estimatedInputTokens} tokens（未校准启发式，并非精确计数），max_tokens=128，关闭思考。`,
  `预计费用 ¥${(quote.estimatedMicroCny / 1000000).toFixed(6)}；客户端预留 ¥0.05。`,
  '估算和客户端预算不是服务商账单的绝对硬上限。可能付费；不自动重试、恢复或继续。',
  '缺失 usage 或中断将保留未知费用及全部预留，阻止后续测试。',
  `价格有效至 ${quote.priceExpiresAt}；确认只授权该 Provider、该提示词和本次请求。`,
].join('\n');

export function formatTrialDiagnostics(record: TrialRecord): string {
  const code = errorCodeSchema.safeParse(record.errorCode);
  const header = `错误代码：${record.errorCode === null ? '无' : code.success ? code.data : '未知'}`;
  const parsed = trialDiagnosticsSchema.safeParse(record.diagnostics);
  if (!parsed.success) return `${header}\n当时未记录诊断，无法追溯发送阶段或 HTTP 状态。请求是否到达及费用须人工核对账单。`;
  const value = parsed.data;
  const stages = {
    validation: '发送前安全检查', credential: '凭据读取', network_client: '网络客户端调用', dns: 'DNS 解析',
    tcp: 'TCP 连接', proxy: '本机代理 CONNECT 隧道', tls: 'TLS 握手', request: '请求发送', response: 'HTTP 响应', stream: 'SSE 响应解析',
    usage: 'usage 检查', accounting: '费用核算与持久化', complete: '完成',
  };
  const categories = {
    credential_unavailable: '凭据不可用', credential_read_failed: '凭据读取失败', dns_failed: 'DNS 解析失败',
    target_rejected: '请求目标被安全策略拒绝', tcp_failed: 'TCP 连接失败', tcp_timeout: 'TCP 连接超时',
    proxy_failed: '代理连接或 CONNECT 握手失败', proxy_rejected: '代理响应或目标被拒绝',
    tls_failed: 'TLS 握手或证书验证失败', http_error: 'HTTP 状态错误', request_timeout: '请求超时',
    request_interrupted: '请求或响应中断', response_invalid: '响应或 SSE 解析失败', usage_missing: '服务商 usage 缺失',
    accounting_failed: '费用核算或记录失败', cancelled: '请求已取消', policy_rejected: '安全检查未通过',
    network_unknown: '网络异常，具体原因未知',
  };
  const evidence = {
    not_started: '未开始网络调用',
    client_invoked: '已调用网络客户端，无法确认服务商是否收到',
    http_response: '已观察到 HTTP 响应；不证明生成完成或计费结果',
  };
  return [header, `阶段：${stages[value.stage]}`, `类别：${value.category === null ? '未观察到错误' : categories[value.category]}`,
    `证据：${evidence[value.evidence]}`, `开始：${value.startedAt}`, `更新：${value.updatedAt}`,
    ...(value.clientInvokedAt ? [`客户端调用：${value.clientInvokedAt}`] : []),
    ...(value.httpResponseAt ? [`HTTP 响应：${value.httpResponseAt}`] : []),
    ...(value.httpStatus === undefined ? [] : [`HTTP ${value.httpStatus}`]),
    '诊断不替代服务商账单；unknown 历史须保留；客户端预留是否人工释放须另查人工对账记录。',
  ].join('\n');
}

export async function confirmTrial(quote: TrialQuote): Promise<boolean> {
  const choice = await dialog.showMessageBox({ type: 'warning', title: '授权一次 DeepSeek 受控测试',
    message: '此操作可能产生真实费用', detail: trialWarning(quote),
    buttons: ['取消', '授权并发送这一次请求'], defaultId: 0, cancelId: 0, noLink: true });
  return choice.response === 1;
}

export function installTrialMenu(database: Database, service: ControlledTrialService, hasActiveRuns: () => boolean): void {
  const menu = Menu.getApplicationMenu() ?? Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]);
  let busy = false;
  menu.append(new MenuItem({ label: '受控测试', submenu: [
    { label: 'DeepSeek 单次测试…', click: () => { void start(); } },
    { label: '人工对账与预留处理…', click: () => { void reconcile(); } },
    { label: '查看人工对账记录…', click: () => {
      const rows = database.listControlledTrialReconciliations();
      void dialog.showMessageBox({ type: 'info', message: '人工对账记录',
        detail: rows.length ? rows.map(row => `请求 ${row.requestId} · ${row.reviewedAt}\n${row.decision === 'release_reservation' ? '用户明确释放客户端预留' : '记录核对并保留预留'}\n${row.evidenceSummary}`).join('\n\n') : '尚无人工对账；不会自动核销或发送请求。' });
    } },
    { label: '停止本次测试', click: () => service.abort() },
    { label: '查看最近测试记录…', click: () => {
      const row = database.listControlledTrials()[0];
      const released = row && database.listControlledTrialReconciliations(row.id).some(audit => audit.decision === 'release_reservation');
      const reservation = released ? '未知（原 ¥0.05 客户端预留已按人工决定释放，不代表账单为零）' : '未知（仍保留 ¥0.05）';
      void dialog.showMessageBox({ type: 'info', message: row ? `测试状态：${row.outcome} / ${row.state}` : '尚无受控测试',
        detail: row ? `${row.text}\n服务商 usage：${row.actualInputTokens ?? '未知'} 输入 / ${row.actualOutputTokens ?? '未知'} 输出\n输入估算偏差：${row.actualInputTokens === null ? '未知' : row.actualInputTokens - row.estimatedInputTokens} tokens\n按核验费率核算：${row.accountedMicroCny === null ? reservation : '¥' + (row.accountedMicroCny / 1000000).toFixed(6)}\n这是 usage 核算，不是账单证明。\n${formatTrialDiagnostics(row)}` : '查看记录不会发送请求。' });
    } },
  ] }));
  Menu.setApplicationMenu(menu);
  async function reconcile() {
    if (busy || service.isBusy() || hasActiveRuns()) return;
    busy = true;
    try {
      const rows = database.listControlledTrials().filter(row => row.state === 'unknown'
        && !database.listControlledTrialReconciliations(row.id).some(audit => audit.decision === 'release_reservation'));
      if (!rows.length) {
        await dialog.showMessageBox({ type: 'info', message: '没有待人工处理的 unknown 预留',
          detail: '原始历史始终保留；此操作不会发送请求。', buttons: ['关闭'], defaultId: 0, cancelId: 0 });
        return;
      }
      const selected = await dialog.showMessageBox({ type: 'question', message: '选择人工核对的请求',
        detail: '选择不修改记录。仅处理当前 unknown，不代替服务商账单。',
        buttons: ['取消', ...rows.map(row => `${row.createdAt} · ${row.requestId}`)], defaultId: 0, cancelId: 0, noLink: true });
      const row = rows[selected.response - 1];
      if (!row) return;
      const identity = `Provider：${row.providerId}\n请求：${row.requestId}\n创建时间：${row.createdAt}\n客户端预留：¥0.05；原 usage、费用及错误保持 unknown。`;
      const reviewed = await dialog.showMessageBox({ type: 'warning', title: '人工核对服务商控制台',
        message: '官方页面未显示消费，不证明绝对没有费用', detail: `${identity}\n\n${reconciliationEvidenceSummary}\n\n若账号、API Key、时间范围或页面数据延迟不能核实，请取消并继续保留预留。`,
        checkboxLabel: '我已亲自核对同一账号、同一 API Key 和覆盖本次请求的最近30天页面', checkboxChecked: false,
        buttons: ['取消', '记录核对并保留预留', '继续申请释放本笔预留…'], defaultId: 0, cancelId: 0, noLink: true });
      if (!reviewed.checkboxChecked || ![1, 2].includes(reviewed.response)) return;
      const decision = reviewed.response === 1 ? 'retain_reservation' : 'release_reservation';
      if (decision === 'release_reservation') {
        const approved = await dialog.showMessageBox({ type: 'warning', title: '明确批准处理此笔客户端预留',
          message: '仅释放本笔 ¥0.05 客户端预留', detail: `${identity}\n\n这不是确认实际费用为零，也不证明服务商未收到请求。原 unknown、usage 未知及错误不变；会永久登记本次人工决定，不授权任何新请求。`,
          checkboxLabel: '我理解上述不确定性，并明确批准仅处理这笔预留', checkboxChecked: false,
          buttons: ['取消', '仅释放此笔客户端预留'], defaultId: 0, cancelId: 0, noLink: true });
        if (approved.response !== 1 || !approved.checkboxChecked) return;
      }
      if (!app.isReady() || service.isBusy() || hasActiveRuns()) return;
      database.reconcileControlledTrial({ trialId: row.id, requestId: row.requestId, providerId: row.providerId,
        keyRevision: row.keyRevision, evidence: 'dashboard_no_displayed_usage', decision, acknowledgedUncertainty: true });
      await dialog.showMessageBox({ type: 'info', message: '人工决定已记录',
        detail: decision === 'release_reservation' ? '仅客户端预留已按你的决定释放；原 unknown 历史不变。新请求仍需独立许可和最后确认。' : '¥0.05 预留继续保留；原 unknown 历史不变。',
        buttons: ['关闭'], defaultId: 0, cancelId: 0 });
    } catch (error) {
      if (app.isReady()) await dialog.showMessageBox({ type: 'warning', message: '人工对账未完成',
        detail: `安全错误：${toPublicError(error).code}。未确认成功前请继续视为预留未释放。`, buttons: ['关闭'], defaultId: 0, cancelId: 0 });
    } finally { busy = false; }
  }
  async function start() {
    if (busy) return;
    busy = true;
    try {
      if (hasActiveRuns()) throw new Error('active');
      const providers = database.listProviderSummaries().filter(value => value.enabled && value.kind === 'openai-compatible'
        && database.getProviderConfiguration(value.id)?.baseUrl?.replace(/\/+$/u, '') === 'https://api.deepseek.com');
      if (!providers.length || providers.length > 8) throw new Error('selection');
      const choice = await dialog.showMessageBox({ type: 'question', message: '选择本次测试的 Provider',
        detail: '请先在设置中保存配置、Key 并确认精确请求目标；此选择不发送请求。',
        buttons: ['取消', ...providers.map(value => `${value.name} (${value.id})`)], defaultId: 0, cancelId: 0, noLink: true });
      if (choice.response === 0) return;
      const quote = service.prepare(providers[choice.response - 1].id);
      const record = await service.execute(quote.id);
      await dialog.showMessageBox({ type: record.state === 'settled' ? 'info' : 'warning',
        message: `受控测试：${record.outcome} / ${record.state}`, detail: (record.state === 'settled'
          ? `${record.text}\n服务商实际 usage：${record.actualInputTokens} 输入 / ${record.actualOutputTokens} 输出。\n按核验费率核算 ¥${(record.accountedMicroCny! / 1000000).toFixed(6)}，账单以服务商为准。`
          : `${record.text}\n费用未知，¥0.05 预留仍保留；禁止自动重试。`) + `\n${formatTrialDiagnostics(record)}` });
    } catch (error) {
      if (!app.isReady()) return;
      const code = toPublicError(error).code;
      await dialog.showMessageBox({ type: 'warning', message: '没有发起新的自动重试',
        detail: `测试未完成（${code}）。请检查目标确认、配置、价格有效期或未结预留；取消不会授权下次请求。` });
    } finally { busy = false; }
  }
}
