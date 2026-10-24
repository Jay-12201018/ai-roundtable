import { useId, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { RunSnapshot } from '../../../shared/types/run';
import { formatYuan, writeOffBasisSchema, type RequestCharge } from '../../../shared/schemas/budget';
import { Button, NoticeCard } from '../../components/ui';
import type { LedgerCommands } from './useLedgerCommands';
import './usage.css';

/** The ledger entry of the request that produced a message: a Turn Attempt or a summary request. */
export function chargeOfMessage(snapshot: RunSnapshot | undefined, messageId: string): RequestCharge | undefined {
  const requestId = snapshot?.attempts?.find(value => value.messageId === messageId)?.requestId
    ?? snapshot?.summaries?.flatMap(summary => summary.requests).find(request => request.messageId === messageId)?.requestId;
  return requestId ? snapshot?.charges?.find(charge => charge.requestId === requestId) : undefined;
}

/** One wording for a write-off everywhere: the console amount, the cap it replaced and how much lower it is. */
export const writeOffSummary = (amountMicro: number, capMicro: number) =>
  `${formatYuan(amountMicro, 6)}（原按上限计 ${formatYuan(capMicro, 6)}，比原上限少 ${formatYuan(capMicro - amountMicro, 6)}）`;
/** A limit or a round amount: ¥1.00 rather than ¥1.0000; anything finer keeps four decimals. */
export const yuanShort = (micro: number) => micro % 10_000 === 0 ? `¥${(micro / 1_000_000).toFixed(2)}` : formatYuan(micro);
/** D106: how a settled amount was priced, in the words the provider console uses. */
export function pricingLabel(charge: RequestCharge): string {
  if (charge.state !== 'settled') return '';
  return charge.settlement?.period === 'off_peak' ? '按空闲价（高峰价的一半）' : '按高峰价';
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
    <input id={`${id}-amount`} className="input" aria-label="实际金额（元）" inputMode="decimal" value={amount} placeholder="例如 0.0012，没有扣费填 0" aria-invalid={amountError} onChange={event => setAmount(event.target.value)} />
    {amountError && <p className="writeoff-error" role="alert">请输入 0 到 {formatYuan(charge.reservedMicro, 6).slice(1)} 之间的金额（不能超过这次请求的预留上限），最多 6 位小数。</p>}
    <label htmlFor={`${id}-basis`}>依据说明</label>
    <input id={`${id}-basis`} className="input" aria-label="依据说明" value={basis} maxLength={200} placeholder="例如：DeepSeek 控制台 10/23 用量明细" aria-invalid={basisError} onChange={event => setBasis(event.target.value)} />
    {basisError && <p className="writeoff-error" role="alert">依据说明最多 200 字；看起来像 API Key 的内容不会被保存，请删掉。</p>}
    <label className="writeoff-check check-label"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />我已在服务商控制台核对过这次请求的实际扣费</label>
    <div className="writeoff-actions">
      <Button type="submit" variant="primary" size="sm" disabled={!ready}>{ledger.pending === key ? '正在保存…' : '保存核销'}</Button>
      <Button size="sm" onClick={onDone}>取消</Button>
    </div>
    {ledger.error?.key === key && <p className="writeoff-error" role="alert">{ledger.error.message}</p>}
  </form>;
}

/** Suggest at least the shortfall, rounded up to ¥0.01, and never less than ¥1 so a few more turns fit. */
export const suggestedTopUp = (shortfallMicro: number) => Math.max(1_000_000, Math.ceil(shortfallMicro / 10_000) * 10_000);

/** D104: why the budget stopped the Run, and — right there — the top-up that lets it continue. */
export function BudgetStopNotice({ snapshot, ledger }: { snapshot: RunSnapshot | undefined; ledger: LedgerCommands }) {
  const blocked = snapshot?.budget?.blocked;
  const remaining = snapshot?.budget?.remainingMicro ?? 0;
  const shortfall = blocked?.reason === 'insufficient' ? Math.max(0, blocked.requiredMicro - remaining) : 0;
  const [amount, setAmount] = useState(() => (suggestedTopUp(shortfall) / 1_000_000).toFixed(2));
  if (!blocked || snapshot?.status !== 'error') return null;
  if (blocked.reason === 'overrun') return <NoticeCard tone="danger" icon={TriangleAlert} title="已停止：实际用量超出了发送前预留的上限">
    <p>预留 {formatYuan(blocked.reservedMicro)}，实际 {formatYuan(blocked.accountedMicro)}。这说明预估方法对这次请求不成立，为避免继续多花钱，本次运行不再发送请求；可以开始新的讨论。</p>
  </NoticeCard>;
  const micro = parseBudgetYuan(amount);
  const enough = remaining >= blocked.requiredMicro;
  return <NoticeCard icon={TriangleAlert} label="预算不足" title="预算不足，已暂停发送">
    <p>下一次请求最高可能花费 {formatYuan(blocked.requiredMicro)}，剩余额度 {formatYuan(remaining)}。追加预算后从这里继续，已有的发言都保留。</p>
    <form className="notice-row" onSubmit={event => { event.preventDefault(); if (micro !== undefined) void ledger.addBudget(micro, true); }}>
      <span className="money-input" data-invalid={micro === undefined || undefined}><span aria-hidden>¥</span>
        <input aria-label="追加预算（元）" inputMode="decimal" value={amount} aria-invalid={micro === undefined} onChange={event => setAmount(event.target.value)} /></span>
      <Button type="submit" variant="primary" disabled={micro === undefined || ledger.pending !== undefined}>{ledger.pending === 'budget' ? '正在追加…' : '追加并继续'}</Button>
      {enough && <Button disabled={ledger.pending !== undefined} onClick={() => void ledger.resume()}>直接继续</Button>}
    </form>
    <p className="notice-hint">{micro === undefined ? '请输入 0.000001 到 1000 之间的金额，最多 6 位小数。'
      : enough ? '剩余额度已经够下一次请求（例如刚核销了未知费用），也可以不追加直接继续。'
      : `至少还差 ${formatYuan(shortfall)}。预算只能追加、不能减少，每次追加都会单独记录。`}</p>
    {ledger.error?.key === 'budget' && <p className="field-error" role="alert">{ledger.error.message}</p>}
  </NoticeCard>;
}
