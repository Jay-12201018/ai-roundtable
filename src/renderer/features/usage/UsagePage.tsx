import { useCallback, useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { RoundtableApiContract } from '../../../shared/contracts/app';
import type { UsageBucket, UsageRange, UsageReport } from '../../../shared/schemas/usage';
import { Avatar, Button, cx } from '../../components/ui';
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
    <td>{count(bucket.inputTokens)}{bucket.cacheHitTokens ? <small>缓存命中 {count(bucket.cacheHitTokens)}</small> : null}</td>
    <td>{count(bucket.outputTokens)}</td>
    <td className={bucket.unknownRequests ? 'is-unknown' : undefined}>{bucket.unknownRequests ? `${bucket.unknownRequests} 次` : '—'}</td>
  </>;
}

/** 用量 (D108, D117, D133): tokens per discussion, model, date and purpose, a time range and a CSV export. No prices. */
export function UsagePage({ api, onOpenRun }: { api: Pick<RoundtableApiContract, 'usage'>; onOpenRun?: (runId: string) => void }) {
  const [period, setPeriod] = useState<UsagePeriod>('this-month');
  const [report, setReport] = useState<{ period: UsagePeriod; value: UsageReport }>();
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<View>('run');
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<{ ok: boolean; text: string }>();
  const request = useRef(0);
  const load = useCallback(async () => {
    const token = ++request.current;
    try { const value = await api.usage.getReport(rangeOf(period)); if (token === request.current) { setReport({ period, value }); setLoadError(false); } }
    catch { if (token === request.current) setLoadError(true); }
  }, [api, period]);
  useEffect(() => { void load(); }, [load]);
  const exportCsv = async () => {
    setExporting(true); setExportNote(undefined);
    try {
      const result = await api.usage.exportCsv(rangeOf(period));
      setExportNote(result.saved ? { ok: true, text: `已导出 ${result.rows} 条记录到“${result.fileName}”。` } : { ok: true, text: '已取消导出。' });
    } catch { setExportNote({ ok: false, text: '导出失败，请重试。' }); }
    finally { setExporting(false); }
  };
  const current = report?.value; const label = periods.find(item => item.id === period)!.label;
  const head = <div className="page-head"><div className="grow"><h1>用量</h1>
    <p>每次请求用了多少 token，数字来自服务商返回的用量。费用由服务商收取，请到服务商控制台查看账单；这里不估算。</p></div>
    <div className="actions">
      <select className="select input usage-period" aria-label="时间范围" value={period} onChange={event => { setPeriod(event.target.value as UsagePeriod); setExportNote(undefined); }}>
        {periods.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <Button icon={Download} onClick={() => void exportCsv()} disabled={exporting || !current || current.totals.requests === 0}>{exporting ? '正在导出…' : '导出 CSV'}</Button></div></div>;
  if (loadError && !current) return <div className="page usage-page"><div className="page-inner">{head}<p role="alert" className="field-error">用量数据读取失败。<button type="button" className="link-btn" onClick={() => void load()}>重试</button></p></div></div>;
  if (!current) return <div className="page usage-page"><div className="page-inner">{head}<p role="status" className="muted">正在读取用量…</p></div></div>;
  const { totals } = current;
  const rows = view === 'run' ? current.byRun.map(row => ({ key: row.runId, title: <>{row.task || '（目标未记录）'}<small>{row.roomName} · {when(row.createdAt)}</small></>, bucket: row, runId: row.runId }))
    : view === 'model' ? current.byModel.map(row => ({ key: `${row.providerId}:${row.modelId}`, title: <>{row.modelId}<small>{row.providerName}</small></>, bucket: row, runId: undefined }))
      : view === 'date' ? current.byDate.map(row => ({ key: row.date, title: <>{row.date}</>, bucket: row, runId: undefined }))
        : current.byKind.map(row => ({ key: row.kind, title: <>{kindLabels[row.kind]}</>, bucket: row, runId: undefined }));
  return <div className="page usage-page" aria-busy={report?.period !== period}><div className="page-inner">
    {head}
    {exportNote && <p role={exportNote.ok ? 'status' : 'alert'} className={exportNote.ok ? 'ok-text small usage-note' : 'field-error usage-note'}>{exportNote.text}</p>}
    {totals.requests === 0 ? <div className="card"><div className="card-row"><span className="grow"><b>{period === 'all' ? '还没有使用真实模型的请求' : `${label}没有使用真实模型的请求`}</b>
      <small>{period === 'all' ? '演示（Mock）不联网，不会出现在这里。' : '可以换成“全部”看看更早的记录。演示（Mock）不会出现在这里。'}</small></span></div></div> : <>
      <section className="stats" aria-label="合计">
        <div className="stat"><span>请求</span><strong>{count(totals.requests)}</strong><small>{totals.reportedRequests} 次拿到了服务商的用量</small></div>
        <div className="stat"><span>输入 tokens</span><strong>{count(totals.inputTokens)}</strong><small>{totals.cacheHitTokens ? `其中缓存命中 ${count(totals.cacheHitTokens)}` : '包括讨论历史和指令'}</small></div>
        <div className="stat"><span>输出 tokens</span><strong>{count(totals.outputTokens)}</strong><small>包括模型的思考（如果服务商计入）</small></div>
        <div className={cx('stat', totals.unknownRequests > 0 && 'is-warn')}><span>没拿到用量</span><strong>{count(totals.unknownRequests)}</strong>
          <small>{totals.unknownRequests ? '次请求，见下方；不计入上面的 tokens' : '没有'}</small></div>
      </section>
      {totals.inFlightRequests > 0 && <p className="small muted usage-note">另有 {totals.inFlightRequests} 次请求正在进行，结束后计入。</p>}
      <div className="seg usage-views" role="tablist" aria-label="汇总方式">
        {views.map(item => <button type="button" role="tab" key={item.id} aria-selected={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}
      </div>
      <div className="card table-card">
        <table className="data">
          <thead><tr><th scope="col">{views.find(item => item.id === view)!.column}</th><th scope="col">请求</th><th scope="col">输入 tokens</th><th scope="col">输出 tokens</th>
            <th scope="col">没拿到用量</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.key}>
            <th scope="row">{row.runId && onOpenRun ? <button type="button" className="row-link" onClick={() => onOpenRun(row.runId!)}>{row.title}</button> : row.title}</th>
            <BucketCells bucket={row.bucket} />
          </tr>)}</tbody>
        </table>
      </div>
      <p className="small muted usage-note">按请求发出的时间归入{period === 'all' ? '日期' : label}，以本机时区（{current.timeZone}）计；跨月的讨论只算这段时间里发出的请求。</p>
      {current.unknownRequests.length > 0 && <section className="section usage-unknown" aria-label="没拿到用量的请求">
        <h2>没拿到用量的请求</h2>
        <p className="lead">这些请求已经发出，但没收到服务商的完整用量（例如中途停止、断网，或这个服务不返回用量）。服务商可能已经计入，请到控制台查看。</p>
        <ul className="card">{current.unknownRequests.map(row => <li key={row.requestId} className="card-row usage-unknown-row">
          <Avatar name={row.speaker} />
          <div className="grow"><b>{row.speaker}{row.kind === 'summary' ? '（讨论摘要）' : row.kind === 'artifact' ? '（产物）' : ''} · {row.task || row.roomName}</b>
            <small>{row.providerName} {row.modelId} · {when(row.createdAt)}{row.observedInputTokens !== null || row.observedOutputTokens !== null ? ` · 已观察输入 ${count(row.observedInputTokens ?? 0)} / 输出 ${count(row.observedOutputTokens ?? 0)}` : ''}</small></div>
        </li>)}</ul>
      </section>}
    </>}
  </div></div>;
}
