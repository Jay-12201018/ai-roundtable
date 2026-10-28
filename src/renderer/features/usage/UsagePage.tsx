import { useCallback, useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { RoundtableApiContract } from '../../../shared/contracts/app';
import { formatYuan, type RequestCharge } from '../../../shared/schemas/budget';
import type { UsageBucket, UsageRange, UsageReport, UsageUnknownRow } from '../../../shared/schemas/usage';
import { Avatar, Button, cx } from '../../components/ui';
import { WriteOffForm, writeOffSummary } from './UsageViews';
import { useLedgerCommands } from './useLedgerCommands';
import './usage.css';

type View = 'run' | 'model' | 'date' | 'kind';
const views: Array<{ id: View; label: string; column: string }> = [{ id: 'run', label: '按讨论', column: '讨论' }, { id: 'model', label: '按模型', column: '模型' },
  { id: 'date', label: '按日期', column: '日期' }, { id: 'kind', label: '按用途', column: '用途' }];
/** D120: what each request was for. */
const kindLabels = { turn: '讨论发言', summary: '讨论摘要', artifact: '产物（文档、清单、代码候选）' } as const;
export type UsagePeriod = 'this-month' | 'last-month' | 'all';
const periods: Array<{ id: UsagePeriod; label: string }> = [{ id: 'this-month', label: '本月' }, { id: 'last-month', label: '上月' }, { id: 'all', label: '全部' }];
/** D117: a calendar month in this computer's time zone, as the half-open range the report filters by. */
export function rangeOf(period: UsagePeriod, now = new Date()): UsageRange {
  if (period === 'all') return {};
  const start = new Date(now.getFullYear(), now.getMonth() - (period === 'last-month' ? 1 : 0), 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return { since: start.toISOString(), until: end.toISOString() };
}
const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const count = (value: number) => value.toLocaleString('zh-CN');

function BucketCells({ bucket }: { bucket: UsageBucket }) {
  return <>
    <td>{bucket.requests}</td>
    <td>{count(bucket.settled.inputTokens)}{bucket.settled.cacheHitTokens ? <small>缓存命中 {count(bucket.settled.cacheHitTokens)}</small> : null}</td>
    <td>{count(bucket.settled.outputTokens)}</td>
    <td>{bucket.settled.count ? <>{formatYuan(bucket.settled.amountMicro)}{bucket.settled.offPeakCount ? <small>空闲价 {bucket.settled.offPeakCount} 次</small> : null}</> : '—'}</td>
    <td className={bucket.unknown.count ? 'is-unknown' : undefined}>{bucket.unknown.count ? <>{formatYuan(bucket.unknown.amountMicro)}<small>{bucket.unknown.count} 次</small></> : '—'}</td>
    <td>{bucket.writtenOff.count ? <>{formatYuan(bucket.writtenOff.amountMicro)}<small>{bucket.writtenOff.count} 次</small></> : '—'}</td>
    <td className="total">{formatYuan(bucket.totalMicro)}</td>
  </>;
}

/** The unknown ledger rows as charges, so the same write-off form serves the timeline and this page. */
const asCharge = (row: UsageUnknownRow): RequestCharge => ({ requestId: row.requestId, providerId: 'p', modelId: row.modelId, currency: 'CNY', state: 'unknown',
  inputTokenBound: 0, outputTokenLimit: 0, inputMicroPerToken: 0, outputMicroPerToken: 0, reservedMicro: row.reservedMicro, inputTokens: row.observedInputTokens,
  outputTokens: row.observedOutputTokens, accountedMicro: null, chargedMicro: row.writeOffs.at(-1)?.amountMicro ?? row.reservedMicro, priceReviewedAt: null,
  createdAt: row.createdAt, updatedAt: row.createdAt, ...(row.writeOffs.length ? { writeOffs: row.writeOffs } : {}) });

/** 用量与花费 (D108, D117): settled, unknown-at-cap and written-off kept apart, three groupings, a time range and a CSV export. */
export function UsagePage({ api, onOpenRun }: { api: Pick<RoundtableApiContract, 'run' | 'usage'>; onOpenRun?: (runId: string) => void }) {
  const [period, setPeriod] = useState<UsagePeriod>('this-month');
  const [report, setReport] = useState<{ period: UsagePeriod; value: UsageReport }>();
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<View>('run');
  const [writing, setWriting] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<{ ok: boolean; text: string }>();
  const request = useRef(0);
  const load = useCallback(async () => {
    const token = ++request.current;
    try { const value = await api.usage.getReport(rangeOf(period)); if (token === request.current) { setReport({ period, value }); setLoadError(false); } }
    catch { if (token === request.current) setLoadError(true); }
  }, [api, period]);
  useEffect(() => { void load(); }, [load]);
  const ledger = useLedgerCommands(api, undefined, () => { void load(); });
  const exportCsv = async () => {
    setExporting(true); setExportNote(undefined);
    try {
      const result = await api.usage.exportCsv(rangeOf(period));
      setExportNote(result.saved ? { ok: true, text: `已导出 ${result.rows} 条记录到“${result.fileName}”。` } : { ok: true, text: '已取消导出。' });
    } catch { setExportNote({ ok: false, text: '导出失败，请重试。' }); }
    finally { setExporting(false); }
  };
  const current = report?.value; const label = periods.find(item => item.id === period)!.label;
  const head = <div className="page-head"><div className="grow"><h1>用量与花费</h1>
    <p>按本机记录的用量和官方单价估算（空闲时段半价、缓存命中按缓存价），用于预算和核对。实际扣费以服务商控制台为准。</p></div>
    <div className="actions">
      <select className="select input usage-period" aria-label="时间范围" value={period} onChange={event => { setPeriod(event.target.value as UsagePeriod); setExportNote(undefined); setWriting(undefined); }}>
        {periods.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <Button icon={Download} onClick={() => void exportCsv()} disabled={exporting || !current || current.totals.requests === 0}>{exporting ? '正在导出…' : '导出 CSV'}</Button></div></div>;
  if (loadError && !current) return <div className="page usage-page"><div className="page-inner">{head}<p role="alert" className="field-error">用量数据读取失败。<button type="button" className="link-btn" onClick={() => void load()}>重试</button></p></div></div>;
  if (!current) return <div className="page usage-page"><div className="page-inner">{head}<p role="status" className="muted">正在读取用量…</p></div></div>;
  const { totals } = current;
  const rows = view === 'run' ? current.byRun.map(row => ({ key: row.runId, title: <>{row.task || '（目标未记录）'}<small>{row.roomName} · {when(row.createdAt)}</small></>, bucket: row, runId: row.runId }))
    : view === 'model' ? current.byModel.map(row => ({ key: `${row.providerId}:${row.modelId}`, title: <>{row.modelId}<small>{row.providerName}</small></>, bucket: row, runId: undefined }))
      : view === 'date' ? current.byDate.map(row => ({ key: row.date, title: <>{row.date}</>, bucket: row, runId: undefined }))
        : (current.byKind ?? []).map(row => ({ key: row.kind, title: <>{kindLabels[row.kind]}</>, bucket: row, runId: undefined }));
  return <div className="page usage-page" aria-busy={report?.period !== period}><div className="page-inner">
    {head}
    {exportNote && <p role={exportNote.ok ? 'status' : 'alert'} className={exportNote.ok ? 'ok-text small usage-note' : 'field-error usage-note'}>{exportNote.text}</p>}
    {totals.requests === 0 ? <div className="card"><div className="card-row"><span className="grow"><b>{period === 'all' ? '还没有使用真实模型的请求' : `${label}没有使用真实模型的请求`}</b>
      <small>{period === 'all' ? '演示（Mock）不联网、不花钱，不会出现在这里。' : '可以换成“全部”看看更早的记录。演示（Mock）不会出现在这里。'}</small></span></div></div> : <>
      <section className="stats" aria-label="合计">
        <div className="stat"><span>合计</span><strong>{formatYuan(totals.totalMicro)}</strong><small>{totals.requests} 次请求</small></div>
        <div className="stat"><span>已结算</span><strong>{formatYuan(totals.settled.amountMicro)}</strong>
          <small>{totals.settled.count} 次{totals.settled.offPeakCount ? `，其中 ${totals.settled.offPeakCount} 次按空闲价` : ''}；全按高峰价为 {formatYuan(totals.settled.peakMicro)}</small></div>
        <div className={cx('stat', totals.unknown.count > 0 && 'is-warn')}><span>未知（按上限计）</span><strong>{formatYuan(totals.unknown.amountMicro)}</strong>
          <small>{totals.unknown.count ? `${totals.unknown.count} 次，可到控制台核对后核销` : '没有'}</small></div>
        <div className="stat"><span>已核销</span><strong>{formatYuan(totals.writtenOff.amountMicro)}</strong>
          <small>{totals.writtenOff.count ? `${totals.writtenOff.count} 次，原按上限计 ${formatYuan(totals.writtenOff.capMicro)}` : '没有'}</small></div>
      </section>
      {totals.reserved.count > 0 && <p className="small muted usage-note">另有 {totals.reserved.count} 次请求正在进行，已预留 {formatYuan(totals.reserved.amountMicro)}，结束后按实际用量结算。</p>}
      <div className="seg usage-views" role="tablist" aria-label="汇总方式">
        {views.map(item => <button type="button" role="tab" key={item.id} aria-selected={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}
      </div>
      <div className="card table-card">
        <table className="data">
          <thead><tr><th scope="col">{views.find(item => item.id === view)!.column}</th><th scope="col">请求</th><th scope="col">输入 tokens</th><th scope="col">输出 tokens</th>
            <th scope="col">已结算</th><th scope="col">未知</th><th scope="col">已核销</th><th scope="col">合计</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.key}>
            <th scope="row">{row.runId && onOpenRun ? <button type="button" className="row-link" onClick={() => onOpenRun(row.runId!)}>{row.title}</button> : row.title}</th>
            <BucketCells bucket={row.bucket} />
          </tr>)}</tbody>
        </table>
      </div>
      <p className="small muted usage-note">按请求发出的时间归入{period === 'all' ? '日期' : label}，以本机时区（{current.timeZone}）计；跨月的讨论只算这段时间里发出的请求。输入、输出 tokens 只统计已结算的请求。</p>

      <section className="section usage-unknown" aria-label="待核对的未知费用">
        <h2>待核对的未知费用</h2>
        {current.unknownCharges.length === 0 ? <p className="small muted">没有。</p> : <>
          <p className="lead">这些请求已经发出，但没拿到服务商的用量（例如中途停止或断网），所以先按预留上限计入。到控制台查到实际扣费后，可以填进来；原记录会保留。</p>
          <ul className="card">{current.unknownCharges.map(row => {
            const writeOff = row.writeOffs.at(-1);
            return <li key={row.requestId} className="card-row usage-unknown-row">
              <Avatar name={row.speaker} />
              <div className="grow"><b>{row.speaker}{row.kind === 'summary' ? '（讨论摘要）' : row.kind === 'artifact' ? '（产物）' : ''} · {row.task || row.roomName}</b>
                <small>{row.providerName} {row.modelId} · {when(row.createdAt)} · {writeOff ? `已核销 ${writeOffSummary(writeOff.amountMicro, row.reservedMicro)} · 依据：${writeOff.basis}` : `按上限计 ${formatYuan(row.reservedMicro, 6)}`}</small></div>
              {writing !== row.requestId && <Button size="sm" onClick={() => setWriting(row.requestId)}>{writeOff ? '更正核销' : '核销'}</Button>}
              {writing === row.requestId && <WriteOffForm charge={asCharge(row)} runId={row.runId} ledger={ledger} onDone={() => setWriting(undefined)} />}
            </li>;
          })}</ul>
        </>}
        {ledger.notice && <p role="status" className="small muted">{ledger.notice.message}</p>}
      </section>
    </>}
  </div></div>;
}
