// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../../src/main/database/Database';
import { UsageService } from '../../../src/main/usage/UsageService';
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import { runSnapshotSchema } from '../../../src/shared/schemas/run';
import { requestChargeSchema } from '../../../src/shared/schemas/budget';
import { closeR13bFixtures, deepSeekFixture, OFF_PEAK, PEAK, summaryDone, type R13bFixture } from './r13bFixture';

afterEach(closeR13bFixtures);
/** A ContractError with its code and, when given, its public field. */
const refused = (code: string, field?: string) => expect.objectContaining({ code, ...(field ? { detail: expect.objectContaining({ field }) } : {}) });
const raw = (f: R13bFixture) => (f.db as unknown as { db: import('better-sqlite3').Database }).db;

describe('actual-time and cache settlement (D106)', () => {
  it('settles at the off-peak rate while reserving at peak, and records the period and rates', async () => {
    const f = await deepSeekFixture({ clock: OFF_PEAK });
    const { runId } = await f.start(); await f.run.waitForIdle(runId);
    const snapshot = f.run.getSnapshot(runId);
    expect(snapshot.status).toBe('completed');
    for (const charge of snapshot.charges!) {
      // Reservation stays at the peak cache-miss bound; the R13A peak amount stays as evidence.
      expect(charge.reservedMicro).toBe(charge.inputTokenBound * 2 + 256 * 8);
      expect(charge).toMatchObject({ state: 'settled', accountedMicro: 648, chargedMicro: 324,
        settlement: { period: 'off_peak', cacheHitTokens: null, cacheMissMicroPerMillion: 1_000_000, outputMicroPerMillion: 4_000_000, amountMicro: 324 } });
    }
    expect(snapshot.budget).toMatchObject({ settledMicro: 648, remainingMicro: 1_000_000 - 648 });
    expect(runSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('prices the provider-reported cache hits at the cache rate, at peak', async () => {
    const f = await deepSeekFixture({ clock: PEAK, cacheHit: 200 });
    const { runId } = await f.start({ maxTurns: 1 }); await f.run.waitForIdle(runId);
    const [charge] = f.run.getSnapshot(runId).charges!;
    // 200 × ¥0.04/M + 100 × ¥2/M + 6 × ¥8/M = 8 + 200 + 48 micro-CNY.
    expect(charge).toMatchObject({ accountedMicro: 648, chargedMicro: 256, settlement: { period: 'peak', cacheHitTokens: 200, cacheHitMicroPerMillion: 40_000, amountMicro: 256 } });
  });

  it('refuses pricing that would raise a charge or does not match its usage', async () => {
    const f = await deepSeekFixture({ clock: PEAK });
    const { runId } = await f.start({ maxTurns: 1 }); await f.run.waitForIdle(runId);
    const [charge] = f.run.getSnapshot(runId).charges!;
    const insert = (amount: number) => raw(f).prepare(`INSERT INTO charge_pricing(request_id,run_id,period,started_at,finished_at,cache_hit_tokens,cache_hit_micro_per_million,
      cache_miss_micro_per_million,output_micro_per_million,amount_micro,evidence,created_at) VALUES(?,?,'peak','x','x',NULL,0,2000000,8000000,?,'e','x')`).run(charge.requestId, runId, amount);
    expect(() => insert(648)).toThrow(/UNIQUE|PRIMARY/u); // already priced once
    expect(() => raw(f).prepare('UPDATE charge_pricing SET amount_micro=0').run()).toThrow(/immutable/u);
    expect(() => raw(f).prepare('DELETE FROM charge_pricing').run()).toThrow(/append-only/u);
  });
});

describe('budget top-ups (D104)', () => {
  it('stops a Run whose next request does not fit, then continues it once the host adds budget', async () => {
    const f = await deepSeekFixture();
    const { runId } = await f.start({ budgetMicroCny: 1000 }); await f.run.waitForIdle(runId);
    let snapshot = f.run.getSnapshot(runId);
    expect(snapshot.status).toBe('error'); expect(snapshot.budget?.blocked?.reason).toBe('insufficient'); expect(f.transport).not.toHaveBeenCalled();
    const result = f.run.addBudget({ runId, clientRequestId: 'top-1', amountMicroCny: 1_000_000, resume: true });
    expect(result).toMatchObject({ runId, duplicate: false, resumed: true });
    await f.run.waitForIdle(runId);
    snapshot = f.run.getSnapshot(runId);
    expect(snapshot.status).toBe('completed'); expect(f.transport).toHaveBeenCalledTimes(2);
    expect(snapshot.budget).toMatchObject({ limitMicro: 1_001_000, initialLimitMicro: 1000, topUps: [{ topUpId: result.topUpId, amountMicro: 1_000_000 }] });
    expect(snapshot.budget?.blocked).toBeUndefined();
    // The same delivery is the same top-up; reusing its identity for another amount is refused.
    expect(f.run.addBudget({ runId, clientRequestId: 'top-1', amountMicroCny: 1_000_000, resume: true })).toMatchObject({ duplicate: true, resumed: false, topUpId: result.topUpId });
    expect(() => f.run.addBudget({ runId, clientRequestId: 'top-1', amountMicroCny: 2, resume: false })).toThrowError(refused('invalid_input', 'clientRequestId'));
    expect(f.run.getSnapshot(runId).budget?.topUps).toHaveLength(1);
  });

  it('keeps top-ups append-only, never lowers a limit and caps a Run at ¥1000', async () => {
    const f = await deepSeekFixture();
    const { runId } = await f.start({ budgetMicroCny: 999_000_000 }); await f.run.waitForIdle(runId);
    expect(() => f.run.addBudget({ runId, clientRequestId: 'too-much', amountMicroCny: 1_000_001, resume: false })).toThrowError(refused('invalid_input', 'amountMicroCny'));
    for (const amountMicroCny of [0, -1, 1.5]) expect(() => f.run.addBudget({ runId, clientRequestId: `bad-${amountMicroCny}`, amountMicroCny, resume: false })).toThrowError(expect.objectContaining({ code: 'invalid_input' }));
    // A Run that is not stopped by its budget is not "continued" by a top-up; the top-up itself is kept.
    expect(() => f.run.resumeAfterBudget(runId)).toThrowError(refused('invalid_state'));
    expect(f.run.addBudget({ runId, clientRequestId: 'resume-done', amountMicroCny: 1, resume: true })).toMatchObject({ resumed: false, resumeError: 'invalid_state' });
    f.run.addBudget({ runId, clientRequestId: 'ok', amountMicroCny: 999_999, resume: false });
    expect(f.run.getSnapshot(runId).budget?.limitMicro).toBe(1_000_000_000);
    expect(() => raw(f).prepare('UPDATE run_budget_topups SET amount_micro=1').run()).toThrow(/append-only/u);
    expect(() => raw(f).prepare('DELETE FROM run_budget_topups').run()).toThrow(/append-only/u);
    expect(() => raw(f).prepare("INSERT INTO run_budget_topups VALUES('x',?, 'c', 1, 'now')").run(runId)).toThrow(/Invalid budget top-up/u);
    expect(() => raw(f).prepare('UPDATE run_budgets SET limit_micro=1').run()).toThrow(/immutable/u);
    expect(validateDatabase(raw(f)).schemaVersion).toBe(10);
  });
});

describe('write-offs of unknown charges (D105)', () => {
  it('counts the host console amount instead of the cap, keeps the unknown row and every entry', async () => {
    const f = await deepSeekFixture({ modes: ['no-usage'] });
    const { runId } = await f.start({ maxTurns: 1 }); await f.run.waitForIdle(runId);
    const [unknown] = f.run.getSnapshot(runId).charges!;
    expect(unknown.state).toBe('unknown'); expect(f.run.getSnapshot(runId).budget).toMatchObject({ unknownMicro: unknown.reservedMicro, writtenOffMicro: 0 });
    const first = f.run.writeOffCharge({ runId, requestId: unknown.requestId, clientRequestId: 'w1', amountMicroCny: 0, basis: '控制台 10/23 用量明细显示 0 元', acknowledgedUncertainty: true });
    let snapshot = f.run.getSnapshot(runId);
    expect(snapshot.budget).toMatchObject({ unknownMicro: 0, writtenOffMicro: 0, remainingMicro: 1_000_000 });
    expect(snapshot.charges![0]).toMatchObject({ state: 'unknown', chargedMicro: 0, writeOffs: [{ writeOffId: first.writeOffId, amountMicro: 0 }] });
    f.run.writeOffCharge({ runId, requestId: unknown.requestId, clientRequestId: 'w2', amountMicroCny: 1234, basis: '按控制台明细更正为 ¥0.001234', acknowledgedUncertainty: true });
    snapshot = f.run.getSnapshot(runId);
    expect(snapshot.charges![0].writeOffs).toHaveLength(2); expect(snapshot.charges![0].chargedMicro).toBe(1234);
    expect(snapshot.budget).toMatchObject({ writtenOffMicro: 1234, remainingMicro: 1_000_000 - 1234 });
    expect(raw(f).prepare('SELECT state,input_tokens,accounted_micro FROM request_charges').get()).toEqual({ state: 'unknown', input_tokens: null, accounted_micro: null });
    // Idempotent per delivery; a changed reuse, a key-like note, an amount above the cap and missing acknowledgement are refused.
    expect(f.run.writeOffCharge({ runId, requestId: unknown.requestId, clientRequestId: 'w1', amountMicroCny: 0, basis: '控制台 10/23 用量明细显示 0 元', acknowledgedUncertainty: true })).toMatchObject({ duplicate: true });
    const refuse = (input: Record<string, unknown>, field?: string) => expect(() => f.run.writeOffCharge({ runId, requestId: unknown.requestId, clientRequestId: `x-${Math.random()}`,
      amountMicroCny: 0, basis: '依据', acknowledgedUncertainty: true, ...input } as never)).toThrowError(refused('invalid_input', field));
    refuse({ clientRequestId: 'w1', amountMicroCny: 5 }, 'clientRequestId');
    refuse({ basis: '我的 key 是 sk-0123456789abcdefABCDEF' }, 'basis');
    refuse({ basis: '   ' }, 'basis');
    refuse({ amountMicroCny: unknown.reservedMicro + 1 }, 'amountMicroCny');
    refuse({ acknowledgedUncertainty: false }, 'acknowledgedUncertainty');
    expect(() => raw(f).prepare('DELETE FROM charge_writeoffs').run()).toThrow(/append-only/u);
    expect(() => raw(f).prepare('UPDATE charge_writeoffs SET amount_micro=0').run()).toThrow(/append-only/u);
    expect(requestChargeSchema.safeParse(snapshot.charges![0]).success).toBe(true);
  });

  it('refuses a write-off of a settled charge or of another Run', async () => {
    const f = await deepSeekFixture();
    const { runId } = await f.start({ maxTurns: 1 }); await f.run.waitForIdle(runId);
    const [settled] = f.run.getSnapshot(runId).charges!;
    expect(() => f.run.writeOffCharge({ runId, requestId: settled.requestId, clientRequestId: 'w', amountMicroCny: 0, basis: '误操作', acknowledgedUncertainty: true }))
      .toThrowError(expect.objectContaining({ code: 'invalid_state' }));
    const other = await f.start({ maxTurns: 1 }); await f.run.waitForIdle(other.runId);
    expect(() => f.run.writeOffCharge({ runId: other.runId, requestId: settled.requestId, clientRequestId: 'w', amountMicroCny: 0, basis: '误操作', acknowledgedUncertainty: true }))
      .toThrowError(expect.objectContaining({ code: 'not_found' }));
  });
});

describe('summary requests are budgeted and settled like Turns (D107)', () => {
  it('refuses a summary that does not fit, then reserves, settles and reports it after a top-up', async () => {
    const f = await deepSeekFixture({ modes: ['no-usage', 'no-usage'] });
    // A first Run measures the first reservation; the second gets exactly that, so the unknown first reply uses it all.
    const probe = await f.start({ maxTurns: 1 }); await f.run.waitForIdle(probe.runId);
    const reserved = f.run.getSnapshot(probe.runId).charges![0].reservedMicro;
    f.transport.mockClear();
    const { runId } = await f.start({ maxTurns: 2, budgetMicroCny: reserved }); await f.run.waitForIdle(runId);
    expect(f.run.getSnapshot(runId).budget?.blocked?.reason).toBe('insufficient');
    await f.command({ runId, kind: 'interject', content: '请把成本控制放在第一位。' });
    await f.command({ runId, kind: 'interject', content: '另外考虑夜间配送。' });
    const preview = f.run.previewSummary({ runId });
    expect(preview).toMatchObject({ available: false, reason: 'budget_insufficient', firstNumber: 1, lastNumber: 3, agentId: 'a2', cost: { kind: 'priced', remainingMicro: 0 } });
    expect(() => f.run.generateSummary({ runId, clientRequestId: 's1', agentId: 'a2', throughSlotId: preview.throughSlotId! })).toThrowError(expect.objectContaining({ code: 'budget_exceeded' }));
    expect(f.run.getSnapshot(runId).summaries).toBeUndefined();
    f.run.addBudget({ runId, clientRequestId: 'top', amountMicroCny: 1_000_000, resume: false });
    const result = f.run.generateSummary({ runId, clientRequestId: 's1', agentId: 'a2', throughSlotId: preview.throughSlotId! });
    await summaryDone(f, runId);
    const snapshot = f.run.getSnapshot(runId);
    const charge = snapshot.charges!.find(item => item.requestId === result.requestId)!;
    expect(charge).toMatchObject({ kind: 'summary', state: 'settled', chargedMicro: 648, settlement: { period: 'peak' } });
    expect(snapshot.summaries).toEqual([expect.objectContaining({ summaryId: result.summaryId, agentId: 'a2', firstNumber: 1, lastNumber: 3, confirmedMessageIds: [],
      requests: [expect.objectContaining({ requestId: result.requestId, status: 'completed', finishReason: 'stop' })] })]);
    expect(snapshot.messages.find(message => message.id === result.messageId)).toMatchObject({ senderName: '讨论摘要', status: 'completed', content: expect.stringContaining('摘要正文') });
    expect(runSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const body = f.bodies.at(-1)!;
    expect(body).toMatchObject({ model: 'deepseek-flash', max_tokens: 256 });
    expect(JSON.stringify(body.messages)).toContain('【请写摘要】');

    // The report counts the summary with the Turns, and every category matches the budgets.
    const report = new UsageService(f.db, 'Asia/Shanghai').getReport();
    const budgets = [probe.runId, runId].map(id => f.run.getSnapshot(id).budget!);
    expect(report.totals.totalMicro).toBe(budgets.reduce((sum, budget) => sum + budget.settledMicro + budget.unknownMicro + budget.writtenOffMicro!, 0));
    expect(report.totals).toMatchObject({ requests: 3, settled: { count: 1, amountMicro: 648, peakMicro: 648 }, unknown: { count: 2 } });
    expect(report.byRun.find(row => row.runId === runId)).toMatchObject({ roomName: '用量房间', settled: { count: 1 }, unknown: { count: 1 } });
    expect(report.byModel).toEqual([expect.objectContaining({ providerName: 'DeepSeek 直连', modelId: 'deepseek-flash', requests: 3 })]);
    expect(report.unknownCharges).toHaveLength(2);
  });

  it('leaves an interrupted summary request unknown and never resends it after a restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'r13b-summary-restart-'));
    try {
      const filename = join(directory, 'db.sqlite');
      const f = await deepSeekFixture({ filename, modes: ['ok', 'ok', 'ok', 'hang'] });
      const { runId } = await f.start({ maxTurns: 3 }); await f.run.waitForIdle(runId);
      const preview = f.run.previewSummary({ runId });
      expect(preview).toMatchObject({ available: true, lastNumber: 3 });
      const started = f.run.generateSummary({ runId, clientRequestId: 'hang', agentId: preview.agentId!, throughSlotId: preview.throughSlotId! });
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(f.run.getSnapshot(runId).summaries![0].requests[0].status).toBe('generating');
      // A second process opens the same file after an unclean exit.
      const reopened = new Database(filename); await reopened.initialize();
      reopened.markInFlightRunsInterrupted();
      const summary = reopened.listSummaries(runId)[0];
      expect(summary.requests[0]).toMatchObject({ requestId: started.requestId, status: 'interrupted' });
      expect(reopened.getCharge(started.requestId!)).toMatchObject({ kind: 'summary', state: 'unknown', chargedMicro: expect.any(Number) });
      expect(reopened.getMessage(started.messageId!)).toMatchObject({ status: 'aborted' });
      const calls = f.transport.mock.calls.length;
      reopened.close();
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(f.transport.mock.calls.length).toBe(calls);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('usage CSV (D108)', () => {
  it('exports one row per ledger entry and neutralises spreadsheet formulas', async () => {
    const f = await deepSeekFixture({ clock: OFF_PEAK, cacheHit: 100 });
    const { runId } = await f.start({ maxTurns: 1, task: '=HYPERLINK("http://example.invalid","x")' }); await f.run.waitForIdle(runId);
    const { text, rows } = new UsageService(f.db, 'Asia/Shanghai').csv();
    const lines = text.trim().split('\r\n');
    expect(rows).toBe(1); expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('计入金额（元）');
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://example.invalid"",""x"")"`);
    expect(lines[1]).toContain('空闲价');
    // 100 × ¥0.02/M + 200 × ¥1/M + 6 × ¥4/M = 2 + 200 + 24 micro-CNY.
    expect(lines[1]).toContain('0.000226');
  });
});
