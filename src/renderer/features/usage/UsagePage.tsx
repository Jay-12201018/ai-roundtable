import { useCallback, useEffect, useState } from 'react';
import type { RoundtableApiContract } from '../../../shared/contracts/app';
import { formatYuan, type RequestCharge } from '../../../shared/schemas/budget';
import type { UsageBucket, UsageReport, UsageUnknownRow } from '../../../shared/schemas/usage';
import { WriteOffForm, writeOffSummary } from './UsageViews';
import { useLedgerCommands } from './useLedgerCommands';
import './usage.css';

type View = 'run' | 'model' | 'date';
const views: Array<{ id: View; label: string }> = [{ id: 'run', label: '按运行' }, { id: 'model', label: '按模型' }, { id: 'date', label: '按日期' }];
const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

function BucketCells({ bucket }: { bucket: UsageBucket }) {
  return <>
    <td>{bucket.requests}</td>
    <td>{bucket.settled.inputTokens.toLocaleString('zh-CN')}{bucket.settled.cacheHitTokens ? <small>（缓存命中 {bucket.settled.cacheHitTokens.toLocaleString('zh-CN')}）</small> : null}</td>
    <td>{bucket.settled.outputTokens.toLocaleString('zh-CN')}</td>
    <td>{bucket.settled.count ? <>{formatYuan(bucket.settled.amountMicro)}{bucket.settled.offPeakCount ? <small>（空闲价 {bucket.settled.offPeakCount} 次）</small> : null}</> : '—'}</td>
    <td className={bucket.unknown.count ? 'is-unknown' : undefined}>{bucket.unknown.count ? `${formatYuan(bucket.unknown.amountMicro)}（${bucket.unknown.count} 次）` : '—'}</td>
    <td>{bucket.writtenOff.count ? `${formatYuan(bucket.writtenOff.amountMicro)}（${bucket.writtenOff.count} 次）` : '—'}</td>
    <td className="usage-total">{formatYuan(bucket.totalMicro)}</td>
  </>;
}

/** The unknown ledger rows as charges, so the same write-off form serves the timeline and this page. */
const asCharge = (row: UsageUnknownRow): RequestCharge => ({ requestId: row.requestId, providerId: 'p', modelId: row.modelId, currency: 'CNY', state: 'unknown',
  inputTokenBound: 0, outputTokenLimit: 0, inputMicroPerToken: 0, outputMicroPerToken: 0, reservedMicro: row.reservedMicro, inputTokens: row.observedInputTokens,
  outputTokens: row.observedOutputTokens, accountedMicro: null, chargedMicro: row.writeOffs.at(-1)?.amountMicro ?? row.reservedMicro, priceReviewedAt: null,
  createdAt: row.createdAt, updatedAt: row.createdAt, ...(row.writeOffs.length ? { writeOffs: row.writeOffs } : {}) });

/** D108: usage by Run, by Provider/model and by date, with the three cost categories kept apart, and a CSV export. */
export function UsagePage({ api, onOpenRun }: { api: Pick<RoundtableApiContract, 'run' | 'usage'>; onOpenRun?: (runId: string) => void }) {
  const [report, setReport] = useState<UsageReport>();
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<View>('run');
  const [writing, setWriting] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<{ ok: boolean; text: string }>();
  const load = useCallback(async () => {
    try { setReport(await api.usage.getReport()); setLoadError(false); } catch { setLoadError(true); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const ledger = useLedgerCommands(api, undefined, () => { void load(); });
  const exportCsv = async () => {
    setExporting(true); setExportNote(undefined);
    try {
      const result = await api.usage.exportCsv();
      setExportNote(result.saved ? { ok: true, text: `已导出 ${result.rows} 条记录到“${result.fileName}”。` } : { ok: true, text: '已取消导出。' });
    } catch { setExportNote({ ok: false, text: '导出失败，请重试。' }); }
    finally { setExporting(false); }
  };
  if (loadError && !report) return <main className="usage-page"><p role="alert" className="error">用量数据读取失败。</p><button type="button" onClick={() => void load()}>重试</button></main>;
  if (!report) return <main className="usage-page"><p role="status">正在读取用量…</p></main>;
  const { totals } = report;
  const rows = view === 'run' ? report.byRun.map(row => ({ key: row.runId, title: <>{row.task || '（无任务）'}<small>{row.roomName} · {when(row.createdAt)}</small></>, bucket: row, runId: row.runId }))
    : view === 'model' ? report.byModel.map(row => ({ key: `${row.providerId}:${row.modelId}`, title: <>{row.modelId}<small>{row.providerName}</small></>, bucket: row, runId: undefined }))
      : report.byDate.map(row => ({ key: row.date, title: <>{row.date}</>, bucket: row, runId: undefined }));
  return <main className="usage-page" aria-label="用量">
    <header className="usage-header">
      <div><h1>用量与花费</h1>
        <p>金额按本应用记录的用量和官方单价计算（空闲时段按半价、缓存命中按缓存价），只用于预算和核对；实际扣费以服务商控制台为准。</p></div>
      <button type="button" onClick={() => void exportCsv()} disabled={exporting || totals.requests === 0}>{exporting ? '正在导出…' : '导出 CSV'}</button>
    </header>
    {exportNote && <p role={exportNote.ok ? 'status' : 'alert'} className={exportNote.ok ? 'usage-note' : 'error'}>{exportNote.text}</p>}
    {totals.requests === 0 ? <p className="usage-empty">还没有使用真实模型的请求。内置 Mock 不产生费用，不会出现在这里。</p> : <>
      <section className="usage-totals" aria-label="合计">
        <div><span>合计</span><strong>{formatYuan(totals.totalMicro)}</strong><small>{totals.requests} 次请求</small></div>
        <div><span>已结算</span><strong>{formatYuan(totals.settled.amountMicro)}</strong>
          <small>{totals.settled.count} 次{totals.settled.offPeakCount ? `，其中 ${totals.settled.offPeakCount} 次按空闲价` : ''}；全按高峰价为 {formatYuan(totals.settled.peakMicro)}</small></div>
        <div className={totals.unknown.count ? 'is-unknown' : undefined}><span>未知（按上限计）</span><strong>{formatYuan(totals.unknown.amountMicro)}</strong>
          <small>{totals.unknown.count ? `${totals.unknown.count} 次，可到控制台核对后核销` : '没有'}</small></div>
        <div><span>已核销</span><strong>{formatYuan(totals.writtenOff.amountMicro)}</strong>
          <small>{totals.writtenOff.count ? `${totals.writtenOff.count} 次，原按上限计 ${formatYuan(totals.writtenOff.capMicro)}` : '没有'}</small></div>
        {totals.reserved.count > 0 && <div><span>进行中预留</span><strong>{formatYuan(totals.reserved.amountMicro)}</strong><small>{totals.reserved.count} 次，结束后按用量结算</small></div>}
      </section>

      <div className="usage-tabs" role="tablist" aria-label="汇总方式">
        {views.map(item => <button type="button" role="tab" key={item.id} aria-selected={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}
      </div>
      <div className="usage-table-wrap">
        <table className="usage-table">
          <thead><tr><th scope="col">{views.find(item => item.id === view)!.label.slice(1)}</th><th scope="col">请求</th><th scope="col">输入 tokens</th><th scope="col">输出 tokens</th>
            <th scope="col">已结算</th><th scope="col">未知（按上限）</th><th scope="col">已核销</th><th scope="col">合计</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.key}>
            <th scope="row">{row.runId && onOpenRun ? <button type="button" className="link-button" onClick={() => onOpenRun(row.runId!)}>{row.title}</button> : row.title}</th>
            <BucketCells bucket={row.bucket} />
          </tr>)}</tbody>
        </table>
      </div>
      <p className="usage-note">按日期按请求发出的时间、以本机时区（{report.timeZone}）汇总。输入、输出 tokens 只统计已结算的请求；未知费用是服务商没有返回用量、按发送前预留的上限计入的金额。</p>

      <section className="usage-unknown" aria-label="未知费用">
        <h2>未知费用</h2>
        {report.unknownCharges.length === 0 ? <p className="usage-note">没有未知费用。</p> : <>
          <p className="usage-note">这些请求已经发出，但没有拿到服务商的用量（例如中途停止或断网），所以按预留上限计入。到服务商控制台核对后，可以录入实际金额；已核销的也留在这里，方便更正。</p>
          <ul>{report.unknownCharges.map(row => {
            const writeOff = row.writeOffs.at(-1);
            return <li key={row.requestId}>
              <div className="usage-unknown-row">
                <span><strong>{row.speaker}</strong>{row.kind === 'summary' ? '（讨论摘要）' : ''} · {row.task || row.roomName} · {row.providerName} {row.modelId} · {when(row.createdAt)}</span>
                <span>{writeOff ? `已核销 ${writeOffSummary(writeOff.amountMicro, row.reservedMicro)} · 依据：${writeOff.basis}` : `按上限计 ${formatYuan(row.reservedMicro, 6)}`}</span>
                {writing !== row.requestId && <button type="button" className="link-button" onClick={() => setWriting(row.requestId)}>{writeOff ? '更正核销' : '核销'}</button>}
              </div>
              {writing === row.requestId && <WriteOffForm charge={asCharge(row)} runId={row.runId} ledger={ledger} onDone={() => setWriting(undefined)} />}
            </li>;
          })}</ul>
        </>}
        {ledger.notice && <p role="status" className="usage-note">{ledger.notice.message}</p>}
      </section>
    </>}
  </main>;
}
