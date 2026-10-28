import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Database, LedgerRow } from '../database/Database';
import { usageReportInputSchema, usageReportSchema, type UsageBucket, type UsageExportResult, type UsageRange, type UsageReport } from '../../shared/schemas/usage';
import { ContractError } from '../../shared/contracts/errors';
import type { RequestCharge } from '../../shared/schemas/budget';

const emptyBucket = (): UsageBucket => ({
  requests: 0, settled: { count: 0, inputTokens: 0, cacheHitTokens: 0, outputTokens: 0, amountMicro: 0, peakMicro: 0, offPeakCount: 0 },
  unknown: { count: 0, amountMicro: 0 }, writtenOff: { count: 0, amountMicro: 0, capMicro: 0 }, reserved: { count: 0, amountMicro: 0 },
  notSent: 0, totalMicro: 0,
});

/** Adds one ledger entry to a bucket; the amounts are exactly what the Run budgets count (D108). */
function accumulate(bucket: UsageBucket, charge: RequestCharge): void {
  bucket.requests++;
  const amount = charge.currency === 'CNY' ? charge.chargedMicro : 0;
  if (charge.state === 'settled') {
    bucket.settled.count++;
    bucket.settled.inputTokens += charge.inputTokens ?? 0;
    bucket.settled.cacheHitTokens += charge.settlement?.cacheHitTokens ?? 0;
    bucket.settled.outputTokens += charge.outputTokens ?? 0;
    bucket.settled.amountMicro += amount;
    bucket.settled.peakMicro += charge.currency === 'CNY' ? charge.accountedMicro ?? 0 : 0;
    if (charge.settlement?.period === 'off_peak') bucket.settled.offPeakCount++;
  } else if (charge.state === 'unknown' && charge.writeOffs?.length) {
    bucket.writtenOff.count++;
    bucket.writtenOff.amountMicro += amount;
    bucket.writtenOff.capMicro += charge.currency === 'CNY' ? charge.reservedMicro : 0;
  } else if (charge.state === 'unknown') {
    bucket.unknown.count++;
    bucket.unknown.amountMicro += amount;
  } else if (charge.state === 'reserved') {
    bucket.reserved.count++;
    bucket.reserved.amountMicro += amount;
  } else bucket.notSent++;
  bucket.totalMicro = bucket.settled.amountMicro + bucket.unknown.amountMicro + bucket.writtenOff.amountMicro;
}

const yuan = (micro: number) => (micro / 1_000_000).toFixed(6);
const perMillion = (micro: number) => (micro / 1_000_000).toString();
// A spreadsheet must never read a cell (a task, a basis note) as a formula.
const cell = (value: string | number | null | undefined) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** R13B (D108): the usage report and its CSV, computed from the same ledger the budgets use. */
export class UsageService {
  constructor(private readonly database: Database, private readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') {}

  private dateOf(iso: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: this.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
    const part = (type: string) => parts.find(item => item.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  private dateTimeOf(iso: string, timeZone = this.timeZone): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso));
    const part = (type: string) => parts.find(item => item.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
  }

  private load(range: UsageRange = {}) {
    const parsed = usageReportInputSchema.safeParse(range);
    if (!parsed.success) throw new ContractError('invalid_input');
    // D117: a request belongs to the range by when it was sent.
    const since = parsed.data.since ? Date.parse(parsed.data.since) : -Infinity; const until = parsed.data.until ? Date.parse(parsed.data.until) : Infinity;
    const ledger = this.database.listLedger().filter(row => { const sent = Date.parse(row.charge.createdAt); return sent >= since && sent < until; });
    const labels = this.database.listLedgerLabels();
    const runs = new Map(labels.runs.map(run => [run.runId, run]));
    const providers = new Map(labels.providers.map(provider => [provider.id, provider.name]));
    const speaker = (row: LedgerRow) => runs.get(row.runId)?.members.find(member => member.agentId === row.agentId)?.displayName ?? '成员已不在运行记录中';
    return { ledger, runs, providers, speaker };
  }

  getReport(range?: UsageRange): UsageReport {
    const { ledger, runs, providers, speaker } = this.load(range);
    const totals = emptyBucket();
    const byRun = new Map<string, UsageBucket>(); const byModel = new Map<string, UsageBucket>(); const byDate = new Map<string, UsageBucket>(); const byKind = new Map<string, UsageBucket>();
    const bucketOf = (map: Map<string, UsageBucket>, key: string) => { let bucket = map.get(key); if (!bucket) map.set(key, bucket = emptyBucket()); return bucket; };
    for (const row of ledger) {
      const { charge } = row;
      for (const bucket of [totals, bucketOf(byRun, row.runId), bucketOf(byModel, JSON.stringify([charge.providerId, charge.modelId])), bucketOf(byDate, this.dateOf(charge.createdAt)), bucketOf(byKind, charge.kind ?? 'turn')]) accumulate(bucket, charge);
    }
    return usageReportSchema.parse({
      generatedAt: new Date().toISOString(), timeZone: this.timeZone, totals,
      byRun: [...byRun].map(([runId, bucket]) => {
        const run = runs.get(runId)!;
        return { runId, roomId: run.roomId, roomName: run.roomName, task: run.task, createdAt: run.createdAt, ...bucket };
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      byModel: [...byModel].map(([key, bucket]) => {
        const [providerId, modelId] = JSON.parse(key) as [string, string];
        return { providerId, providerName: providers.get(providerId) ?? 'Provider 已删除', modelId, ...bucket };
      }).sort((a, b) => b.totalMicro - a.totalMicro),
      byDate: [...byDate].map(([date, bucket]) => ({ date, ...bucket })).sort((a, b) => b.date.localeCompare(a.date)),
      byKind: (['turn', 'summary', 'artifact'] as const).filter(kind => byKind.has(kind)).map(kind => ({ kind, ...byKind.get(kind)! })),
      unknownCharges: ledger.filter(row => row.charge.state === 'unknown' && row.charge.currency === 'CNY').map(row => {
        const run = runs.get(row.runId)!;
        return { requestId: row.charge.requestId, runId: row.runId, roomName: run.roomName, task: run.task, kind: row.charge.kind ?? 'turn', speaker: speaker(row),
          providerName: providers.get(row.charge.providerId) ?? 'Provider 已删除', modelId: row.charge.modelId, createdAt: row.charge.createdAt,
          reservedMicro: row.charge.reservedMicro, observedInputTokens: row.charge.inputTokens, observedOutputTokens: row.charge.outputTokens,
          writeOffs: row.charge.writeOffs ?? [] };
      }).reverse(),
    });
  }

  /** One row per ledger entry; the amounts are the ones the budgets and the report count. */
  csv(range?: UsageRange): { text: string; rows: number } {
    const { ledger, runs, providers, speaker } = this.load(range);
    const header = ['请求ID', '类型', '运行ID', '房间', '任务', '成员', 'Provider', '模型', `发出时间（${this.timeZone}）`, '状态', '输入tokens', '其中缓存命中tokens', '输出tokens',
      '计价时段', '计价开始（北京时间）', '计价结束（北京时间）', '缓存命中单价（元/百万）', '缓存未命中单价（元/百万）', '输出单价（元/百万）', '预留上限（元）', '按高峰价计（元）',
      '计入金额（元）', '核销金额（元）', '核销依据', '核销时间'];
    const state = (charge: RequestCharge) => charge.state === 'settled' ? '已结算' : charge.state === 'reserved' ? '进行中（已预留）' : charge.state === 'not_sent' ? '未发出'
      : charge.writeOffs?.length ? '已核销' : '未知（按上限计）';
    const lines = ledger.map(row => {
      const { charge } = row; const run = runs.get(row.runId);
      const settlement = charge.settlement; const writeOff = charge.writeOffs?.at(-1);
      return [charge.requestId, charge.kind === 'summary' ? '摘要' : charge.kind === 'artifact' ? '产物' : '发言', row.runId, run?.roomName, run?.task, speaker(row), providers.get(charge.providerId) ?? 'Provider 已删除', charge.modelId,
        this.dateTimeOf(charge.createdAt), state(charge), charge.inputTokens, settlement ? settlement.cacheHitTokens ?? '未提供' : '', charge.outputTokens,
        settlement ? settlement.period === 'peak' ? '高峰价' : '空闲价' : charge.state === 'settled' ? '高峰价（未区分时段）' : '',
        settlement ? this.dateTimeOf(settlement.startedAt, 'Asia/Shanghai') : '', settlement ? this.dateTimeOf(settlement.finishedAt, 'Asia/Shanghai') : '',
        settlement ? perMillion(settlement.cacheHitMicroPerMillion) : '', settlement ? perMillion(settlement.cacheMissMicroPerMillion) : charge.state === 'settled' ? String(charge.inputMicroPerToken) : '',
        settlement ? perMillion(settlement.outputMicroPerMillion) : charge.state === 'settled' ? String(charge.outputMicroPerToken) : '',
        yuan(charge.reservedMicro), charge.accountedMicro === null ? '' : yuan(charge.accountedMicro), yuan(charge.currency === 'CNY' ? charge.chargedMicro : 0),
        writeOff ? yuan(writeOff.amountMicro) : '', writeOff?.basis, writeOff ? this.dateTimeOf(writeOff.createdAt) : ''].map(cell).join(',');
    });
    return { text: [header.map(cell).join(','), ...lines].join('\r\n') + '\r\n', rows: ledger.length };
  }

  /** Main writes the file the user chose in the native save dialog; the Renderer never gets file system access. */
  async exportCsv(choosePath: (defaultName: string) => Promise<string | undefined>, range?: UsageRange): Promise<UsageExportResult> {
    const { text, rows } = this.csv(range);
    const path = await choosePath(`AI圆桌用量-${this.dateOf(new Date().toISOString())}.csv`);
    if (!path) return { saved: false, rows };
    // A byte-order mark lets spreadsheet apps read the Chinese headers as UTF-8.
    await writeFile(path, '﻿' + text, { encoding: 'utf8', mode: 0o600 });
    return { saved: true, fileName: basename(path), rows };
  }
}
