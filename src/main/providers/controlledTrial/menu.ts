import { app, dialog, Menu, MenuItem } from 'electron';
import type { Database } from '../../database/Database';
import { ControlledTrialService, type TrialQuote } from './ControlledTrialService';
import { toPublicError } from '../../../shared/contracts/errors';

export const trialWarning = (quote: TrialQuote) => [
  `Provider：${quote.providerId}；目标：${quote.baseUrl} · ${quote.modelId}`,
  `单 Agent、仅本次请求；提示词：${quote.prompt}`,
  `输入估算 ${quote.estimatedInputTokens} tokens（未校准启发式，并非精确计数），max_tokens=128，关闭思考。`,
  `预计费用 ¥${(quote.estimatedMicroCny / 1000000).toFixed(6)}；客户端预留 ¥0.05。`,
  '估算和客户端预算不是服务商账单的绝对硬上限。可能付费；不自动重试、恢复或继续。',
  '缺失 usage 或中断将保留未知费用及全部预留，阻止后续测试。',
  `价格有效至 ${quote.priceExpiresAt}；确认只授权该 Provider、该提示词和本次请求。`,
].join('\n');

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
    { label: '停止本次测试', click: () => service.abort() },
    { label: '查看最近测试记录…', click: () => {
      const row = database.listControlledTrials()[0];
      void dialog.showMessageBox({ type: 'info', message: row ? `测试状态：${row.outcome} / ${row.state}` : '尚无受控测试',
        detail: row ? `${row.text}\n服务商 usage：${row.actualInputTokens ?? '未知'} 输入 / ${row.actualOutputTokens ?? '未知'} 输出\n输入估算偏差：${row.actualInputTokens === null ? '未知' : row.actualInputTokens - row.estimatedInputTokens} tokens\n按核验费率核算：${row.accountedMicroCny === null ? '未知（仍保留 ¥0.05）' : '¥' + (row.accountedMicroCny / 1000000).toFixed(6)}\n这是 usage 核算，不是账单证明。` : '查看记录不会发送请求。' });
    } },
  ] }));
  Menu.setApplicationMenu(menu);
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
        message: `受控测试：${record.outcome} / ${record.state}`, detail: record.state === 'settled'
          ? `${record.text}\n服务商实际 usage：${record.actualInputTokens} 输入 / ${record.actualOutputTokens} 输出。\n按核验费率核算 ¥${(record.accountedMicroCny! / 1000000).toFixed(6)}，账单以服务商为准。`
          : `${record.text}\n费用未知，¥0.05 预留仍保留；禁止自动重试。` });
    } catch (error) {
      if (!app.isReady()) return;
      const code = toPublicError(error).code;
      await dialog.showMessageBox({ type: 'warning', message: '没有发起新的自动重试',
        detail: `测试未完成（${code}）。请检查目标确认、配置、价格有效期或未结预留；取消不会授权下次请求。` });
    } finally { busy = false; }
  }
}
