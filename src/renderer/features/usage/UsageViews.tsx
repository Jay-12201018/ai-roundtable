import type { RunSnapshot } from '../../../shared/types/run';
import { formatYuan, type RequestCharge } from '../../../shared/schemas/budget';
import './usage.css';

/** The ledger entry of the request that produced a message, if it was a priced (real Provider) request. */
export function chargeOfMessage(snapshot: RunSnapshot | undefined, messageId: string): RequestCharge | undefined {
  const attempt = snapshot?.attempts?.find(value => value.messageId === messageId);
  return attempt ? snapshot?.charges?.find(charge => charge.requestId === attempt.requestId) : undefined;
}

/** One line per message: provider usage and its cost, or why the cost is unknown or held. */
export function MessageUsage({ charge }: { charge: RequestCharge | undefined }) {
  if (!charge) return null;
  const tokens = charge.inputTokens !== null && charge.outputTokens !== null ? `输入 ${charge.inputTokens} / 输出 ${charge.outputTokens} tokens` : undefined;
  const text = charge.state === 'settled' ? `${tokens} · 花费 ${formatYuan(charge.accountedMicro!, 6)}`
    : charge.state === 'reserved' ? `生成中 · 已预留最高 ${formatYuan(charge.reservedMicro, 6)}`
    : charge.state === 'unknown' ? `费用未知（按上限计 ${formatYuan(charge.reservedMicro, 6)}）${tokens ? ` · 已观察 ${tokens}` : ' · 服务商未返回用量'}`
    : '请求未发出，未计费';
  return <div className={`message-usage is-${charge.state}`} data-charge-state={charge.state}>{text}</div>;
}

/** Run-level spend: limit, settled, unknown-at-cap, in-flight reservation and what is left; a block is an alert. */
export function RunBudgetBar({ snapshot }: { snapshot: RunSnapshot | undefined }) {
  const budget = snapshot?.budget;
  if (!budget) return null;
  const spent = budget.settledMicro + budget.unknownMicro;
  return <section className="run-budget" aria-label="运行预算">
    <span>预算 {formatYuan(budget.limitMicro)}</span>
    <span>累计花费 {formatYuan(spent)}{budget.unknownMicro > 0 ? `（含未知费用按上限计 ${formatYuan(budget.unknownMicro)}）` : ''}</span>
    {budget.reservedMicro > 0 && <span>进行中预留 {formatYuan(budget.reservedMicro)}</span>}
    <span className="run-budget-remaining">剩余额度 {formatYuan(budget.remainingMicro)}</span>
    {budget.overrunMicro > 0 && <span className="run-budget-over">超出 {formatYuan(budget.overrunMicro)}</span>}
    {/* The full reason is the run's error beside the timeline (rendererSession). */}
    {budget.blocked && <span className="run-budget-over">{budget.blocked.reason === 'insufficient' ? '已因预算不足停止发送' : '已因用量超出上限停止'}</span>}
  </section>;
}

/** Start-time Run budget in yuan; returns micro-CNY, or undefined when the text is not a valid amount. */
export function parseBudgetYuan(text: string): number | undefined {
  if (!/^\d{1,4}(?:\.\d{1,6})?$/u.test(text.trim())) return undefined;
  const [whole, fraction = ''] = text.trim().split('.');
  const micro = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0'));
  return Number.isSafeInteger(micro) && micro >= 1 && micro <= 1_000_000_000 ? micro : undefined;
}
