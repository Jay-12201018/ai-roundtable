// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { closeR13bFixtures, deepSeekFixture } from '../usage/r13bFixture';
import { UsageService } from '../../../src/main/usage/UsageService';
import { ArtifactService } from '../../../src/main/artifact/ArtifactService';
import { runSnapshotSchema } from '../../../src/shared/schemas/run';
import { validDocuments, text } from '../../unit/artifacts/fixtures';

afterEach(closeR13bFixtures);
const isArtifact = (body: Record<string, unknown>) => JSON.stringify(body.messages).includes('【请输出 JSON】');
// Two messages in these Runs, so the list cites only 1 and 2.
const twoMessageActions = { ...validDocuments.actions, items: (validDocuments.actions.items as Array<Record<string, unknown>>).map(item => ({ ...item, sources: [1, 2] })) };

describe('artifact requests are budgeted and settled like Turns (D120)', () => {
  it('quotes, refuses beyond the budget, then reserves, settles and reports an artifact request as its own kind', async () => {
    const f = await deepSeekFixture({ reply: body => isArtifact(body) ? text(twoMessageActions) : undefined });
    const { runId } = await f.start({ maxTurns: 2, budgetMicroCny: 20_000 }); await f.run.waitForIdle(runId);
    const preview = f.run.previewArtifact({ runId, kind: 'actions' });
    // The synthesizer writes it; the reservation is the full input bound plus 4096 output tokens at the peak price.
    expect(preview).toMatchObject({ agentId: 'a2', outputTokenLimit: 4096, cost: { kind: 'priced' } });
    if (preview.cost.kind !== 'priced') throw new Error('priced');
    expect(preview.cost.maxMicro).toBeGreaterThan(4096 * 8);
    expect(preview).toMatchObject({ available: false, reason: 'budget_insufficient' });
    const calls = f.transport.mock.calls.length;
    expect(() => f.run.generateArtifact({ runId, clientRequestId: 'g1', kind: 'actions', agentId: 'a2' })).toThrowError(expect.objectContaining({ code: 'budget_exceeded' }));
    expect(f.transport.mock.calls.length).toBe(calls);
    f.run.addBudget({ runId, clientRequestId: 'top', amountMicroCny: 1_000_000, resume: false });
    const result = f.run.generateArtifact({ runId, clientRequestId: 'g1', kind: 'actions', agentId: 'a2' });
    await f.run.waitForIdle(runId);
    expect(f.bodies.at(-1)).toMatchObject({ model: 'deepseek-flash', max_tokens: 4096 });
    // No provider JSON mode is asked for: the prompt carries the format (D120).
    expect(f.bodies.at(-1)).not.toHaveProperty('response_format');
    const snapshot = f.run.getSnapshot(runId);
    expect(runSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.artifactRequestIds).toEqual([result.requestId]);
    expect(snapshot.charges!.find(charge => charge.requestId === result.requestId)).toMatchObject({ kind: 'artifact', state: 'settled', chargedMicro: 648, settlement: { period: 'peak' } });
    const artifacts = new ArtifactService(f.db, f.run);
    expect(artifacts.getVersion({ runId, versionId: result.versionId }).version.status).toBe('candidate');
    const usage = new UsageService(f.db, 'Asia/Shanghai');
    const report = usage.getReport();
    expect(report.byKind).toEqual([expect.objectContaining({ kind: 'turn', requests: 2 }), expect.objectContaining({ kind: 'artifact', requests: 1, settled: expect.objectContaining({ amountMicro: 648 }) })]);
    expect(report.totals.totalMicro).toBe(snapshot.budget!.settledMicro + snapshot.budget!.unknownMicro);
    expect(usage.csv().text.split('\r\n').find(line => line.startsWith(result.requestId!))).toContain(',产物,');
  });

  it('keeps a dropped connection as network_error with the charge unknown at its cap (D125)', async () => {
    const f = await deepSeekFixture({ modes: ['ok', 'ok', 'network'] });
    const { runId } = await f.start({ maxTurns: 2 }); await f.run.waitForIdle(runId);
    const result = f.run.generateArtifact({ runId, clientRequestId: 'g1', kind: 'prd', agentId: 'a2' });
    await f.run.waitForIdle(runId);
    const version = new ArtifactService(f.db, f.run).getVersion({ runId, versionId: result.versionId }).version;
    expect(version).toMatchObject({ status: 'failed', request: { status: 'failed', errorCode: 'network_error' }, outputChars: 0 });
    const charge = f.run.getSnapshot(runId).charges!.find(item => item.requestId === result.requestId)!;
    expect(charge).toMatchObject({ kind: 'artifact', state: 'unknown', chargedMicro: charge.reservedMicro });
    expect(f.transport.mock.calls.length).toBe(3);
  });

  it('counts a stopped artifact request as unknown at its cap; a write-off applies to it like any request', async () => {
    const f = await deepSeekFixture({ modes: ['ok', 'ok', 'hang'], reply: body => isArtifact(body) ? '{"title"' : undefined });
    const { runId } = await f.start({ maxTurns: 2 }); await f.run.waitForIdle(runId);
    const result = f.run.generateArtifact({ runId, clientRequestId: 'g1', kind: 'prd', agentId: 'a2' });
    await new Promise(resolve => setTimeout(resolve, 50));
    await f.command({ runId, kind: 'abortGeneration' });
    await f.run.waitForIdle(runId);
    const charge = f.run.getSnapshot(runId).charges!.find(item => item.requestId === result.requestId)!;
    expect(charge).toMatchObject({ kind: 'artifact', state: 'unknown', chargedMicro: charge.reservedMicro });
    f.run.writeOffCharge({ runId, requestId: result.requestId!, clientRequestId: 'w1', amountMicroCny: 100, basis: '控制台显示 0.0001 元', acknowledgedUncertainty: true });
    expect(f.run.getSnapshot(runId).charges!.find(item => item.requestId === result.requestId)).toMatchObject({ chargedMicro: 100, writeOffs: [expect.objectContaining({ amountMicro: 100 })] });
    expect(new ArtifactService(f.db, f.run).getVersion({ runId, versionId: result.versionId })).toMatchObject({ rawOutput: '{"title"', version: { status: 'failed' } });
  });
});
