import { useId, useState } from 'react';
import type { RunSnapshot } from '../../../shared/types/run';
import { formatYuan, writeOffBasisSchema, type RequestCharge } from '../../../shared/schemas/budget';
import type { LedgerCommands } from './useLedgerCommands';
import './usage.css';

/** The ledger entry of the request that produced a message: a Turn Attempt or a summary request. */
export function chargeOfMessage(snapshot: RunSnapshot | undefined, messageId: string): RequestCharge | undefined {
  const requestId = snapshot?.attempts?.find(value => value.messageId === messageId)?.requestId
    ?? snapshot?.summaries?.flatMap(summary => summary.requests).find(request => request.messageId === messageId)?.requestId;
  return requestId ? snapshot?.charges?.find(charge => charge.requestId === requestId) : undefined;
}

const clock = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
/** D106: how a settled amount was priced, in the words the provider console uses. */
export function pricingLabel(charge: RequestCharge): string {
  if (charge.state !== 'settled') return '';
  return charge.settlement?.period === 'off_peak' ? '按空闲价（高峰价的一半）' : '按高峰价';
}

/** One line per message: provider usage and its cost, or why the cost is unknown, held or written off. */
export function MessageUsage({ charge, runId, ledger }: { charge: RequestCharge | undefined; runId?: string; ledger?: LedgerCommands }) {
  const [writing, setWriting] = useState(false);
  if (!charge) return null;
  const hit = charge.settlement?.cacheHitTokens;
  const tokens = charge.inputTokens !== null && charge.outputTokens !== null
    ? `输入 ${charge.inputTokens}${hit ? `（缓存命中 ${hit}）` : ''} / 输出 ${charge.outputTokens} tokens` : undefined;
  const writeOff = charge.writeOffs?.at(-1);
  const text = charge.state === 'settled' ? `${tokens} · 花费 ${formatYuan(charge.chargedMicro, 6)} · ${pricingLabel(charge)}`
    : charge.state === 'reserved' ? `生成中 · 已预留最高 ${formatYuan(charge.reservedMicro, 6)}`
    : charge.state === 'unknown' && writeOff ? `已核销 ${formatYuan(writeOff.amountMicro, 6)}（原按上限计 ${formatYuan(charge.reservedMicro, 6)}，少计 ${formatYuan(charge.reservedMicro - writeOff.amountMicro, 6)}）· 依据：${writeOff.basis}`
    : charge.state === 'unknown' ? `费用未知（按上限计 ${formatYuan(charge.reservedMicro, 6)}）${tokens ? ` · 已观察 ${tokens}` : ' · 服务商未返回用量'}`
    : '请求未发出，未计费';
  const canWriteOff = charge.state === 'unknown' && charge.currency === 'CNY' && runId !== undefined && ledger !== undefined;
  return <div className={`message-usage is-${writeOff ? 'written-off' : charge.state}`} data-charge-state={writeOff ? 'written_off' : charge.state}>
    <span>{text}</span>
    {canWriteOff && !writing && <button type="button" className="link-button" onClick={() => setWriting(true)}>{writeOff ? '更正核销' : '核销'}</button>}
    {canWriteOff && writing && <WriteOffForm charge={charge} runId={runId!} ledger={ledger!} onDone={() => setWriting(false)} />}
  </div>;
}

/** Yuan text to micro-CNY: 0–1000 with up to six decimals; undefined when it is not such an amount. */
export function parseAmountYuan(text: string, minimum = 0): number | undefined {
  if (!/^\d{1,4}(?:\.\d{1,6})?$/u.test(text.trim())) return undefined;
  const [whole, fraction = ''] = text.trim().split('.');
  const micro = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0'));
  return Number.isSafeInteger(micro) && micro >= minimum && micro <= 1_000_000_000 ? micro : undefined;
}
/** Start-time Run budget in yuan; returns micro-CNY, or undefined when the text is not a valid amount. */
export const parseBudgetYuan = (text: string) => parseAmountYuan(text, 1);

/**
 * D105: the host enters what the provider console shows for this request. The unknown record stays; the write-off
 * is a separate entry that can be corrected later, and only the host's own reading is recorded.
 */
export function WriteOffForm({ charge, runId, ledger, onDone }: { charge: RequestCharge; runId: string; ledger: LedgerCommands; onDone: () => void }) {
  const id = useId();
  const [amount, setAmount] = useState(charge.writeOffs?.at(-1) ? (charge.writeOffs.at(-1)!.amountMicro / 1_000_000).toFixed(6) : '');
  const [basis, setBasis] = useState('');
  const [checked, setChecked] = useState(false);
  const micro = parseAmountYuan(amount);
  const amountError = amount.trim() !== '' && (micro === undefined || micro > charge.reservedMicro);
  const basisCheck = writeOffBasisSchema.safeParse(basis);
  const basisError = basis.trim() !== '' && !basisCheck.success;
  const key = `writeoff:${charge.requestId}`;
  const ready = micro !== undefined && micro <= charge.reservedMicro && basisCheck.success && checked && ledger.pending === undefined;
  const save = async () => {
    if (!ready) return;
    if (await ledger.writeOff({ runId, requestId: charge.requestId, amountMicroCny: micro!, basis: basisCheck.data! })) onDone();
  };
  return <form className="writeoff-form" aria-label="核销这笔未知费用" onSubmit={event => { event.preventDefault(); void save(); }}>
    <p>到服务商控制台的用量明细里找到这次请求，把实际扣费填在这里。原来的“未知”记录会保留，之后也可以再次更正。</p>
    <label htmlFor={`${id}-amount`}>实际金额（元）</label>
    <input id={`${id}-amount`} inputMode="decimal" value={amount} placeholder="例如 0.0012，没有扣费填 0" aria-invalid={amountError} onChange={event => setAmount(event.target.value)} />
    {amountError && <p className="writeoff-error" role="alert">请输入 0 到 {formatYuan(charge.reservedMicro, 6).slice(1)} 之间的金额（不能超过这次请求的预留上限），最多 6 位小数。</p>}
    <label htmlFor={`${id}-basis`}>依据说明</label>
    <input id={`${id}-basis`} value={basis} maxLength={200} placeholder="例如：DeepSeek 控制台 10/23 用量明细" aria-invalid={basisError} onChange={event => setBasis(event.target.value)} />
    {basisError && <p className="writeoff-error" role="alert">依据说明最多 200 字；看起来像 API Key 的内容不会被保存，请删掉。</p>}
    <label className="writeoff-check"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />我已在服务商控制台核对过这次请求的实际扣费</label>
    <div className="writeoff-actions">
      <button type="submit" className="primary" disabled={!ready}>{ledger.pending === key ? '正在保存…' : '保存核销'}</button>
      <button type="button" onClick={onDone}>取消</button>
    </div>
    {ledger.error?.key === key && <p className="writeoff-error" role="alert">{ledger.error.message}</p>}
  </form>;
}

/** Run-level spend: limit (with top-ups), what is spent and how, what is left; a top-up is one click away. */
export function RunBudgetBar({ snapshot, ledger }: { snapshot: RunSnapshot | undefined; ledger?: LedgerCommands }) {
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState('1');
  const budget = snapshot?.budget;
  if (!budget) return null;
  const spent = budget.settledMicro + budget.unknownMicro + (budget.writtenOffMicro ?? 0);
  const topUps = budget.topUps ?? [];
  const added = topUps.reduce((total, topUp) => total + topUp.amountMicro, 0);
  const micro = parseBudgetYuan(amount);
  const parts = [budget.unknownMicro > 0 ? `未知费用按上限计 ${formatYuan(budget.unknownMicro)}` : '', (budget.writtenOffMicro ?? 0) > 0 || (snapshot?.charges ?? []).some(charge => charge.writeOffs?.length) ? `已核销 ${formatYuan(budget.writtenOffMicro ?? 0)}` : ''].filter(Boolean);
  const blockedHere = budget.blocked?.reason === 'insufficient' && snapshot?.status === 'error';
  return <section className="run-budget" aria-label="运行预算">
    <span>预算 {formatYuan(budget.limitMicro)}{added > 0 ? `（含追加 ${formatYuan(added)}）` : ''}</span>
    <span>累计花费 {formatYuan(spent)}{parts.length ? `（含${parts.join('，')}）` : ''}</span>
    {budget.reservedMicro > 0 && <span>进行中预留 {formatYuan(budget.reservedMicro)}</span>}
    <span className="run-budget-remaining">剩余额度 {formatYuan(budget.remainingMicro)}</span>
    {budget.overrunMicro > 0 && <span className="run-budget-over">超出 {formatYuan(budget.overrunMicro)}</span>}
    {/* The full reason and the way to continue sit next to the last message (BudgetStopNotice). */}
    {budget.blocked && <span className="run-budget-over">{budget.blocked.reason === 'insufficient' ? '已因预算不足停止发送' : '已因用量超出上限停止'}</span>}
    {ledger?.available && !blockedHere && !adding && <button type="button" className="link-button" onClick={() => setAdding(true)}>追加预算</button>}
    {ledger?.available && !blockedHere && adding && <form className="run-budget-add" onSubmit={event => { event.preventDefault(); if (micro !== undefined) void ledger.addBudget(micro, false).then(result => { if (result) setAdding(false); }); }}>
      <label>追加（元）<input aria-label="追加预算（元）" inputMode="decimal" value={amount} aria-invalid={micro === undefined} onChange={event => setAmount(event.target.value)} /></label>
      <button type="submit" disabled={micro === undefined || ledger.pending !== undefined}>追加</button>
      <button type="button" onClick={() => setAdding(false)}>取消</button>
      <small>只能追加、不能减少；每次追加单独记录。</small>
    </form>}
    {topUps.length > 0 && <details className="run-budget-history">
      <summary>追加记录（{topUps.length}）</summary>
      <ol>{topUps.map(topUp => <li key={topUp.topUpId}>+{formatYuan(topUp.amountMicro)} · {clock(topUp.createdAt)}</li>)}</ol>
      <p>开始时 {formatYuan(budget.initialLimitMicro ?? budget.limitMicro - added)}，之后共追加 {formatYuan(added)}。</p>
    </details>}
    {ledger?.notice?.key === 'budget' && !blockedHere && <span role="status" className="run-budget-notice">{ledger.notice.message}</span>}
    {ledger?.error?.key === 'budget' && !blockedHere && <span role="alert" className="run-budget-over">{ledger.error.message}</span>}
  </section>;
}

/** D104: why the budget stopped the Run, and — right there — the top-up that lets it continue. */
export function BudgetStopNotice({ snapshot, ledger }: { snapshot: RunSnapshot | undefined; ledger: LedgerCommands }) {
  const blocked = snapshot?.budget?.blocked;
  const remaining = snapshot?.budget?.remainingMicro ?? 0;
  const shortfall = blocked?.reason === 'insufficient' ? Math.max(0, blocked.requiredMicro - remaining) : 0;
  // Suggest at least the shortfall, rounded up to ¥0.01, and never less than ¥1 so a few more turns fit.
  const [amount, setAmount] = useState(() => (Math.max(1_000_000, Math.ceil(shortfall / 10_000) * 10_000) / 1_000_000).toFixed(2));
  if (!blocked || snapshot?.status !== 'error') return null;
  if (blocked.reason === 'overrun') return <div className="budget-stop" role="alert">
    <p><strong>已停止：实际用量超出了发送前预留的上限。</strong>预留 {formatYuan(blocked.reservedMicro)}，实际 {formatYuan(blocked.accountedMicro)}。这说明预估方法对这次请求不成立，为避免继续多花钱，本次运行不再发送请求；可以开始新的运行。</p>
  </div>;
  const micro = parseBudgetYuan(amount);
  const enough = remaining >= blocked.requiredMicro;
  return <div className="budget-stop" role="alert" aria-label="预算不足">
    <p><strong>预算不足，已暂停发送。</strong>下一次请求最高可能花费 {formatYuan(blocked.requiredMicro)}，剩余额度 {formatYuan(remaining)}。追加预算后从这里继续，已有的发言都保留。</p>
    <form className="budget-stop-actions" onSubmit={event => { event.preventDefault(); if (micro !== undefined) void ledger.addBudget(micro, true); }}>
      <label>追加（元）<input aria-label="追加预算（元）" inputMode="decimal" value={amount} aria-invalid={micro === undefined} onChange={event => setAmount(event.target.value)} /></label>
      <button type="submit" className="primary" disabled={micro === undefined || ledger.pending !== undefined}>{ledger.pending === 'budget' ? '正在追加…' : '追加并继续'}</button>
      {enough && <button type="button" disabled={ledger.pending !== undefined} onClick={() => void ledger.resume()}>直接继续</button>}
    </form>
    <p className="budget-stop-hint">{micro === undefined ? '请输入 0.000001 到 1000 之间的金额，最多 6 位小数。'
      : enough ? '剩余额度已经够下一次请求（例如刚核销了未知费用），也可以不追加直接继续。'
      : `至少还差 ${formatYuan(shortfall)}。预算只能追加、不能减少，每次追加都会单独记录。`}</p>
    {ledger.error?.key === 'budget' && <p className="writeoff-error" role="alert">{ledger.error.message}</p>}
  </div>;
}
