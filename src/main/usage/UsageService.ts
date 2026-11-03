import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Database, UsageRow } from '../database/Database';
import { usageKindValues, usageReportInputSchema, usageReportSchema, type RequestUsage, type UsageBucket, type UsageExportResult, type UsageRange, type UsageReport } from '../../shared/schemas/usage';
import { ContractError } from '../../shared/contracts/errors';

const emptyBucket = (): UsageBucket => ({ requests: 0, reportedRequests: 0, inputTokens: 0, cacheHitTokens: 0, outputTokens: 0, unknownRequests: 0, inFlightRequests: 0, notSentRequests: 0 });

/** Adds one request to a bucket. Only provider-reported usage adds tokens; nothing is estimated (D133). */
function accumulate(bucket: UsageBucket, usage: RequestUsage): void {
  bucket.requests++;
  if (usage.state === 'reported') {
    bucket.reportedRequests++;
    bucket.inputTokens += usage.inputTokens ?? 0;
    bucket.cacheHitTokens += usage.cacheHitTokens ?? 0;
    bucket.outputTokens += usage.outputTokens ?? 0;
  } else if (usage.state === 'unknown') bucket.unknownRequests++;
  else if (usage.state === 'in_flight') bucket.inFlightRequests++;
  else bucket.notSentRequests++;
}

// A spreadsheet must never read a cell (a task, a room name) as a formula.
const cell = (value: string | number | null | undefined) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const kindLabels: Record<RequestUsage['kind'], string> = { turn: '发言', summary: '摘要', artifact: '产物' };
const stateLabels: Record<RequestUsage['state'], string> = { reported: '服务商已报告', unknown: '未拿到完整用量', in_flight: '进行中', not_sent: '未发出' };

/** D108, D133: the token usage report and its CSV. Costs are the provider's to bill; nothing here prices a request. */
export class UsageService {
  constructor(private readonly database: Database, private readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') {}

  private dateOf(iso: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: this.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
    const part = (type: string) => parts.find(item => item.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  private dateTimeOf(iso: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: this.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso));
    const part = (type: string) => parts.find(item => item.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
  }

  private load(range: UsageRange = {}) {
    const parsed = usageReportInputSchema.safeParse(range);
    if (!parsed.success) throw new ContractError('invalid_input');
    // D117: a request belongs to the range by when it was sent.
    const since = parsed.data.since ? Date.parse(parsed.data.since) : -Infinity; const until = parsed.data.until ? Date.parse(parsed.data.until) : Infinity;
    const rows = this.database.listAllUsage().filter(row => { const sent = Date.parse(row.usage.createdAt); return sent >= since && sent < until; });
    const labels = this.database.listUsageLabels();
    const runs = new Map(labels.runs.map(run => [run.runId, run]));
    const providers = new Map(labels.providers.map(provider => [provider.id, provider.name]));
    const speaker = (row: UsageRow) => runs.get(row.runId)?.members.find(member => member.agentId === row.usage.agentId)?.displayName ?? '成员已不在运行记录中';
    return { rows, runs, providers, speaker };
  }

  getReport(range?: UsageRange): UsageReport {
    const { rows, runs, providers, speaker } = this.load(range);
    const totals = emptyBucket();
    const byRun = new Map<string, UsageBucket>(); const byModel = new Map<string, UsageBucket>(); const byDate = new Map<string, UsageBucket>(); const byKind = new Map<string, UsageBucket>();
    const bucketOf = (map: Map<string, UsageBucket>, key: string) => { let bucket = map.get(key); if (!bucket) map.set(key, bucket = emptyBucket()); return bucket; };
    for (const row of rows) {
      const { usage } = row;
      for (const bucket of [totals, bucketOf(byRun, row.runId), bucketOf(byModel, JSON.stringify([usage.providerId, usage.modelId])), bucketOf(byDate, this.dateOf(usage.createdAt)), bucketOf(byKind, usage.kind)]) accumulate(bucket, usage);
    }
    const tokens = (bucket: UsageBucket) => bucket.inputTokens + bucket.outputTokens;
    return usageReportSchema.parse({
      generatedAt: new Date().toISOString(), timeZone: this.timeZone, totals,
      byRun: [...byRun].map(([runId, bucket]) => {
        const run = runs.get(runId)!;
        return { runId, roomId: run.roomId, roomName: run.roomName, task: run.task, createdAt: run.createdAt, ...bucket };
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      byModel: [...byModel].map(([key, bucket]) => {
        const [providerId, modelId] = JSON.parse(key) as [string, string];
        return { providerId, providerName: providers.get(providerId) ?? 'Provider 已删除', modelId, ...bucket };
      }).sort((a, b) => tokens(b) - tokens(a)),
      byDate: [...byDate].map(([date, bucket]) => ({ date, ...bucket })).sort((a, b) => b.date.localeCompare(a.date)),
      byKind: usageKindValues.filter(kind => byKind.has(kind)).map(kind => ({ kind, ...byKind.get(kind)! })),
      unknownRequests: rows.filter(row => row.usage.state === 'unknown').map(row => {
        const run = runs.get(row.runId)!;
        return { requestId: row.usage.requestId, runId: row.runId, roomName: run.roomName, task: run.task, kind: row.usage.kind, speaker: speaker(row),
          providerName: providers.get(row.usage.providerId) ?? 'Provider 已删除', modelId: row.usage.modelId, createdAt: row.usage.createdAt,
          observedInputTokens: row.usage.inputTokens, observedOutputTokens: row.usage.outputTokens };
      }).reverse(),
    });
  }

  /** One row per request, with the tokens the provider reported. */
  csv(range?: UsageRange): { text: string; rows: number } {
    const { rows, runs, providers, speaker } = this.load(range);
    const header = ['请求ID', '类型', '运行ID', '房间', '任务', '成员', 'Provider', '模型', `发出时间（${this.timeZone}）`, '状态', '输入tokens', '其中缓存命中tokens', '输出tokens'];
    const lines = rows.map(row => {
      const { usage } = row; const run = runs.get(row.runId);
      return [usage.requestId, kindLabels[usage.kind], row.runId, run?.roomName, run?.task, speaker(row), providers.get(usage.providerId) ?? 'Provider 已删除', usage.modelId,
        this.dateTimeOf(usage.createdAt), stateLabels[usage.state], usage.inputTokens, usage.cacheHitTokens, usage.outputTokens].map(cell).join(',');
    });
    return { text: [header.map(cell).join(','), ...lines].join('\r\n') + '\r\n', rows: rows.length };
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
