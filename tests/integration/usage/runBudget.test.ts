// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry, type ApprovedModelPolicy } from '../../../src/main/providers/ProviderRegistry';
import { RunService } from '../../../src/main/services/RunService';
import { HostService } from '../../../src/main/host/HostService';
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import { migration8 } from '../../../src/main/database/migrations/v8';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { countDeepSeekInputUpperBound, deepSeekModelPolicy } from '../../../src/main/providers/modelPolicies/deepseek';
import type { ProviderMessage } from '../../../src/main/providers/types';
import { parseDiscussion } from '../../unit/context/discussion';
import { DEFAULT_RUN_BUDGET_MICRO_CNY, requestChargeSchema } from '../../../src/shared/schemas/budget';
import { runSnapshotSchema } from '../../../src/shared/schemas/run';

type Mode = 'ok' | 'no-usage' | 'broken' | 'overrun' | 'hang' | 'length';
const cleanup: Array<() => unknown> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of cleanup.splice(0).reverse()) await f(); });

function sse(events: unknown[], done = true) {
  return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : ''), { headers: { 'content-type': 'text/event-stream' } });
}
async function fixture(options: { modes?: Mode[]; key?: boolean; members?: number; policy?: typeof deepSeekModelPolicy } = {}) {
  const db = new Database(':memory:'); db.initialize(); cleanup.push(() => db.close());
  db.createRoom({ id: 'room', name: 'Room' });
  db.createProvider({ id: 'deepseek', name: 'DeepSeek direct', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', customModels: [{ id: 'deepseek-flash', name: 'deepseek-flash' }] });
  const keys = new KeyService(db, createMemoryKeyBackend());
  if (options.key !== false) await keys.storeKey('deepseek', 'owned-fake-deepseek-key');
  const modes = [...(options.modes ?? [])];
  const bodies: Array<Record<string, unknown>> = [];
  let release!: () => void; const hanging = new Promise<void>(resolve => { release = resolve; });
  const transport = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    bodies.push(JSON.parse(String(init!.body)));
    const mode = modes.shift() ?? 'ok';
    const text = { choices: [{ index: 0, delta: { content: `公开回复-${bodies.length}` }, finish_reason: null }] };
    const stop = { choices: [{ index: 0, delta: {}, finish_reason: mode === 'length' ? 'length' : 'stop' }] };
    const usage = (prompt: number) => ({ choices: [], usage: { prompt_tokens: prompt, completion_tokens: 6 } });
    if (mode === 'hang') {
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(text)}\n\n`)); void hanging; } }), { headers: { 'content-type': 'text/event-stream' } });
    }
    if (mode === 'broken') return sse([text], false);
    if (mode === 'no-usage') return sse([text, stop]);
    return sse([text, stop, usage(mode === 'overrun' ? 10_000_000 : 300)]);
  });
  const registry = new ProviderRegistry(db, keys, { policyResolver: options.policy ?? deepSeekModelPolicy, transportFactory: guard => async (url, init) => { guard(); return transport(url, init); } });
  registry.confirmTarget({ providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', confirmed: true });
  for (let i = 0; i < (options.members ?? 2); i++) db.createAgent({ id: `a${i}`, roomId: 'room', displayName: `成员${i}`, roleTemplateId: 'Drafter', systemPrompt: '', providerId: 'deepseek', modelId: 'deepseek-flash', displayOrder: i });
  const run = new RunService(db, new MockProvider(), createPublicMessagesBuilder((model, member) => member.providerId ? registry.budget(member.providerId, model!) : undefined), registry);
  cleanup.push(() => { release(); return run.shutdown(); });
  return { db, keys, registry, run, transport, bodies, release };
}
const start = (f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) =>
  f.run.start({ roomId: 'room', task: '设计一个校园跑腿平台', workflowSnapshot: {}, maxTurns: 2, outputTokenLimit: 256, ...extra });

it('reserves each request before sending and settles it from provider usage at the approved rates', async () => {
  const f = await fixture();
  const { runId } = await start(f); await f.run.waitForIdle(runId);
  const snapshot = f.run.getSnapshot(runId);
  expect(snapshot.status).toBe('completed'); expect(f.transport).toHaveBeenCalledTimes(2);
  expect(snapshot.charges).toHaveLength(2);
  for (const charge of snapshot.charges!) {
    expect(charge).toMatchObject({ state: 'settled', currency: 'CNY', inputTokens: 300, outputTokens: 6, inputMicroPerToken: 2, outputMicroPerToken: 8,
      accountedMicro: 300 * 2 + 6 * 8, chargedMicro: 648, outputTokenLimit: 256 });
    expect(charge.reservedMicro).toBe(charge.inputTokenBound * 2 + 256 * 8);
    expect(snapshot.attempts!.find(attempt => attempt.requestId === charge.requestId)?.status).toBe('completed');
  }
  expect(snapshot.budget).toEqual({ currency: 'CNY', limitMicro: DEFAULT_RUN_BUDGET_MICRO_CNY, settledMicro: 1296, unknownMicro: 0, reservedMicro: 0,
    remainingMicro: DEFAULT_RUN_BUDGET_MICRO_CNY - 1296, overrunMicro: 0 });
  expect(runSnapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(f.bodies[0]).toMatchObject({ model: 'deepseek-flash', max_tokens: 256, thinking: { type: 'disabled' } });
});

it('reserves from the exact wire messages: D095 discussion format, bound counted on what DeepSeek receives', async () => {
  const f = await fixture({ members: 3 });
  const { runId } = await start(f, { maxTurns: 4 }); await f.run.waitForIdle(runId);
  const snapshot = f.run.getSnapshot(runId);
  expect(snapshot.status).toBe('completed'); expect(f.bodies).toHaveLength(4);
  for (const body of f.bodies) {
    const messages = body.messages as ProviderMessage[];
    const sent = snapshot.charges!.filter(c => JSON.stringify(f.db.getAttempt(c.requestId)?.inputSnapshot?.messages) === JSON.stringify(messages));
    expect(sent).toHaveLength(1);
    const charge = sent[0];
    expect(charge.inputTokenBound).toBe(countDeepSeekInputUpperBound(messages));
    expect(charge.inputTokenBound).toBeGreaterThanOrEqual(messages.reduce((total, m) => total + Buffer.byteLength(m.content, 'utf8'), 0));
  }
  // Member 0 speaks again on the fourth Turn: only its own first reply is assistant; the others are quoted user text.
  const fourth = f.bodies[3].messages as ProviderMessage[];
  expect(fourth.filter(m => m.role !== 'system').map(m => m.role)).toEqual(['user', 'assistant', 'user']);
  expect(parseDiscussion(fourth).entries.map(e => [e.role, e.speaker, e.publicText])).toEqual([
    ['assistant', '成员0', '公开回复-1'], ['user', '成员1', '公开回复-2'], ['user', '成员2', '公开回复-3']]);
});

it('refuses to send when the next maximum cost exceeds the remaining budget, with a Chinese reason and zero requests', async () => {
  const f = await fixture();
  const { runId } = await start(f, { budgetMicroCny: 1000 }); await f.run.waitForIdle(runId);
  const snapshot = f.run.getSnapshot(runId);
  expect(f.transport).not.toHaveBeenCalled();
  expect(snapshot.status).toBe('error'); expect(snapshot.turns).toEqual([]); expect(snapshot.charges).toEqual([]);
  expect(snapshot.budget).toMatchObject({ limitMicro: 1000, remainingMicro: 1000, blocked: { reason: 'insufficient', remainingMicro: 1000 } });
  expect(snapshot.budget!.blocked!.reason === 'insufficient' && snapshot.budget!.blocked!.requiredMicro).toBeGreaterThan(1000);
  expect(f.db.getRun(runId)!.lastError).toMatch(/^运行预算不足：下一次请求最高可能花费 ¥0\.\d{4}，剩余额度 ¥0\.0010，已拒绝发送。$/u);
});

it('treats equal remaining budget as enough and one micro-CNY less as insufficient', async () => {
  const probe = await fixture({ members: 1 });
  const first = await start(probe, { maxTurns: 1 }); await probe.run.waitForIdle(first.runId);
  const reserved = probe.run.getSnapshot(first.runId).charges![0].reservedMicro;
  for (const [budget, sent] of [[reserved, 1], [reserved - 1, 0]] as const) {
    const f = await fixture({ members: 1 });
    const { runId } = await start(f, { maxTurns: 1, budgetMicroCny: budget }); await f.run.waitForIdle(runId);
    expect(f.transport).toHaveBeenCalledTimes(sent);
    expect(f.run.getSnapshot(runId).status).toBe(sent ? 'completed' : 'error');
  }
});

it('stops before a later request once settled spend leaves too little for its maximum cost', async () => {
  const probe = await fixture({ members: 1 });
  const first = await start(probe, { maxTurns: 1 }); await probe.run.waitForIdle(first.runId);
  const reserved = probe.run.getSnapshot(first.runId).charges![0].reservedMicro;
  // Enough for the first reservation but not for a second one after the first settles at 648.
  const f = await fixture();
  const { runId } = await start(f, { budgetMicroCny: reserved + 100 }); await f.run.waitForIdle(runId);
  const snapshot = f.run.getSnapshot(runId);
  expect(f.transport).toHaveBeenCalledTimes(1); expect(snapshot.status).toBe('error');
  expect(snapshot.turns).toHaveLength(1); expect(snapshot.turns[0].status).toBe('completed');
  expect(snapshot.budget).toMatchObject({ settledMicro: 648, blocked: { reason: 'insufficient', remainingMicro: reserved + 100 - 648 } });
});

it('charges the full reservation as unknown when a sent request fails without usage', async () => {
  const f = await fixture({ modes: ['broken'] });
  const { runId } = await start(f); await f.run.waitForIdle(runId);
  const snapshot = f.run.getSnapshot(runId); const [charge] = snapshot.charges!;
  expect(f.transport).toHaveBeenCalledTimes(1); expect(snapshot.status).toBe('error');
  expect(charge).toMatchObject({ state: 'unknown', accountedMicro: null, chargedMicro: charge.reservedMicro });
  expect(charge.chargedMicro).toBeGreaterThan(0);
  expect(snapshot.budget).toMatchObject({ settledMicro: 0, unknownMicro: charge.reservedMicro, remainingMicro: DEFAULT_RUN_BUDGET_MICRO_CNY - charge.reservedMicro });
});

it('charges a completed reply that carried no usage at its full reservation, never zero', async () => {
  const f = await fixture({ modes: ['no-usage'] });
  const { runId } = await start(f); await f.run.waitForIdle(runId);
  const snapshot = f.run.getSnapshot(runId); const [first, second] = snapshot.charges!;
  expect(snapshot.turns[0].status).toBe('completed');
  expect(first).toMatchObject({ state: 'unknown', inputTokens: null, chargedMicro: first.reservedMicro });
  expect(second).toMatchObject({ state: 'settled' });
  expect(snapshot.budget).toMatchObject({ unknownMicro: first.reservedMicro, settledMicro: 648 });
});

it('settles a reply that ended for length from usage, completes it as truncated and keeps scheduling (D102)', async () => {
  const f = await fixture({ modes: ['length'] });
  const { runId } = await start(f); await f.run.waitForIdle(runId);
  const snapshot = f.run.getSnapshot(runId);
  expect(snapshot.status).toBe('completed'); expect(f.transport).toHaveBeenCalledTimes(2);
  expect(snapshot.turns.map(turn => turn.status)).toEqual(['completed', 'completed']);
  expect(snapshot.turns.map(turn => snapshot.attempts!.find(attempt => attempt.turnId === turn.turnId)!.finishReason)).toEqual(['length', 'stop']);
  expect(snapshot.charges!.map(charge => [charge.state, charge.accountedMicro])).toEqual([['settled', 648], ['settled', 648]]);
  // The second member's request carries the truncation note for the first reply.
  const second = (f.bodies[1].messages as ProviderMessage[]).at(-1)!.content;
  expect(second).toContain('【成员「成员0」· Drafter】\n（此发言因单次输出上限被截断，后面的内容没有写完，可能不完整。）\n> 公开回复-1');
});

it('continues a truncated reply as a new effective version with its own request and settled charge (D102)', async () => {
  const f = await fixture({ modes: ['length', 'ok', 'ok'] });
  const { runId } = await start(f); await f.run.waitForIdle(runId);
  const host = new HostService(f.db, f.run);
  const before = f.run.getSnapshot(runId);
  const truncated = before.turns[0].messageId!;
  await host.command({ runId, clientRequestId: 'continue-1', kind: 'regenerateMessage', messageId: truncated, mode: 'continue' });
  await vi.waitFor(() => expect(f.run.isExecuting(runId)).toBe(false));
  const after = f.run.getSnapshot(runId);
  expect(after.status).toBe('completed');
  const slot = after.versions!.filter(version => version.slotId === before.turns[0].turnId);
  expect(slot.map(version => [version.origin, version.active])).toEqual([['original', false], ['continue', true]]);
  const continued = after.messages.find(message => message.id === slot[1].messageId)!;
  expect(continued).toMatchObject({ status: 'completed', content: '公开回复-1公开回复-3' });
  // The continuation replays the frozen input plus the partial reply and a continue request; it is reserved and settled on its own.
  const original = f.db.getAttempt(after.attempts!.find(attempt => attempt.messageId === truncated)!.requestId)!.inputSnapshot!.messages;
  expect(f.bodies[2].messages).toEqual([...original, { role: 'assistant', content: '公开回复-1' }, { role: 'user', content: 'Continue the previous response from where it stopped.' }]);
  expect(after.charges).toHaveLength(3);
  const continuation = after.attempts!.find(attempt => attempt.messageId === continued.id)!;
  expect(continuation).toMatchObject({ status: 'completed', finishReason: 'stop' });
  expect(after.charges!.find(charge => charge.requestId === continuation.requestId)).toMatchObject({ state: 'settled', accountedMicro: 648 });
  expect(after.versions!.find(version => version.messageId === before.turns[1].messageId)!.affectedBy).toEqual([truncated]);
  // A fully written reply has nothing to continue.
  await expect(host.command({ runId, clientRequestId: 'continue-2', kind: 'regenerateMessage', messageId: before.turns[1].messageId!, mode: 'continue' }))
    .rejects.toMatchObject({ code: 'invalid_state' });
});

it('keeps an aborted in-flight request charged as unknown after Stop, never zero', async () => {
  const f = await fixture({ modes: ['hang'] });
  const { runId } = await start(f);
  await vi.waitFor(() => expect(f.transport).toHaveBeenCalledTimes(1));
  expect(f.run.getSnapshot(runId).budget).toMatchObject({ reservedMicro: expect.any(Number) });
  expect(f.run.getSnapshot(runId).budget!.reservedMicro).toBeGreaterThan(0);
  await f.run.stop(runId);
  const snapshot = f.run.getSnapshot(runId);
  expect(snapshot.status).toBe('cancelled');
  expect(snapshot.charges![0]).toMatchObject({ state: 'unknown', chargedMicro: snapshot.charges![0].reservedMicro });
  expect(snapshot.budget).toMatchObject({ reservedMicro: 0, unknownMicro: snapshot.charges![0].reservedMicro });
});

it('releases the reservation only when the request provably never reached the network', async () => {
  const f = await fixture({ key: false });
  const { runId } = await start(f); await f.run.waitForIdle(runId);
  const snapshot = f.run.getSnapshot(runId);
  expect(f.transport).not.toHaveBeenCalled();
  expect(snapshot.charges![0]).toMatchObject({ state: 'not_sent', chargedMicro: 0, inputTokens: null });
  expect(snapshot.budget).toMatchObject({ settledMicro: 0, unknownMicro: 0, reservedMicro: 0, remainingMicro: DEFAULT_RUN_BUDGET_MICRO_CNY });
});

it('stops scheduling and reports the gap when provider usage exceeds the reserved bound', async () => {
  const f = await fixture({ modes: ['overrun'] });
  const { runId } = await start(f, { budgetMicroCny: 100_000_000 }); await f.run.waitForIdle(runId);
  const snapshot = f.run.getSnapshot(runId); const [charge] = snapshot.charges!;
  expect(f.transport).toHaveBeenCalledTimes(1); expect(snapshot.status).toBe('error');
  expect(charge).toMatchObject({ state: 'settled', inputTokens: 10_000_000, accountedMicro: 20_000_048 });
  expect(snapshot.budget!.blocked).toMatchObject({ reason: 'overrun', requestId: charge.requestId, reservedMicro: charge.reservedMicro, accountedMicro: 20_000_048 });
  expect(f.db.getRun(runId)!.lastError).toMatch(/^实际用量超出发送前预留的上限/u);
});

it('marks an open reservation unknown at startup recovery and keeps it charged', async () => {
  const f = await fixture({ members: 1 });
  // The state a crash leaves behind: a running Turn whose request was reserved and possibly sent.
  f.db.insertRun({ id: 'crashed', roomId: 'room', status: 'running', workflowSnapshot: {}, task: 't', membersSnapshot: [], nextTurnIndex: 0, elapsedExecutionMs: 0 });
  f.db.insertTurn({ id: 'turn', runId: 'crashed', agentId: 'a0', status: 'running', requestId: 'request', turnIndex: 0 });
  f.db.insertMessage({ id: 'message', roomId: 'room', runId: 'crashed', turnId: 'turn', senderType: 'agent', senderName: '成员0', content: '部分', status: 'streaming' });
  f.db.createAttempt({ requestId: 'request', runId: 'crashed', turnId: 'turn', messageId: 'message', attemptIndex: 0, status: 'running',
    inputSnapshot: { requestId: 'request', modelId: 'deepseek-flash', outputTokenLimit: 256, messages: [{ role: 'user', content: 't' }] } });
  f.db.reserveCharge({ requestId: 'request', runId: 'crashed', providerId: 'deepseek', modelId: 'deepseek-flash', currency: 'CNY', inputTokenBound: 545,
    outputTokenLimit: 256, inputMicroPerToken: 2, outputMicroPerToken: 8, reservedMicro: 545 * 2 + 256 * 8, priceEvidence: 'owned fixture', priceReviewedAt: null });
  expect(f.db.getRunBudget('crashed')).toMatchObject({ reservedMicro: 3138, remainingMicro: DEFAULT_RUN_BUDGET_MICRO_CNY - 3138 });
  f.db.markInFlightRunsInterrupted();
  expect(f.db.getCharge('request')).toMatchObject({ state: 'unknown', chargedMicro: 3138 });
  expect(f.db.getRunBudget('crashed')).toMatchObject({ reservedMicro: 0, unknownMicro: 3138, remainingMicro: DEFAULT_RUN_BUDGET_MICRO_CNY - 3138 });
  // A late settlement cannot rewrite the unknown charge; the reservation is a separate audit decision.
  expect(f.db.settleCharge('request', { state: 'settled', inputTokens: 1, outputTokens: 1 })).toMatchObject({ state: 'unknown' });
  expect(() => f.db.reserveCharge({ requestId: 'request', runId: 'crashed', providerId: 'deepseek', modelId: 'deepseek-flash', currency: 'CNY', inputTokenBound: 1,
    outputTokenLimit: 1, inputMicroPerToken: 2, outputMicroPerToken: 8, reservedMicro: 10, priceEvidence: 'x', priceReviewedAt: null })).toThrow();
});

it('never converts a non-zero USD price into the CNY budget', async () => {
  const usd: typeof deepSeekModelPolicy = (configuration, modelId) => {
    const policy = deepSeekModelPolicy(configuration, modelId);
    return policy && { ...policy, price: { inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.2, maxRequestUsd: 1, evidence: 'owned fixture USD price', reviewedAt: policy.price.reviewedAt, expiresAt: policy.price.expiresAt } } as ApprovedModelPolicy;
  };
  const f = await fixture({ policy: usd });
  const { runId } = await start(f); await f.run.waitForIdle(runId);
  expect(f.transport).not.toHaveBeenCalled(); expect(f.run.getSnapshot(runId).status).toBe('error');
});

it('keeps the ledger append-only and immutable once settled', async () => {
  const f = await fixture({ members: 1 });
  const { runId } = await start(f, { maxTurns: 1 }); await f.run.waitForIdle(runId);
  const [charge] = f.db.listCharges(runId);
  expect(requestChargeSchema.safeParse(charge).success).toBe(true);
  const raw = (f.db as unknown as { db: import('better-sqlite3').Database }).db;
  expect(() => raw.prepare('DELETE FROM request_charges').run()).toThrow(/append-only/u);
  expect(() => raw.prepare("UPDATE request_charges SET state='reserved'").run()).toThrow(/transition/u);
  expect(() => raw.prepare('UPDATE request_charges SET input_tokens=1').run()).toThrow(/immutable/u);
  expect(() => raw.prepare('UPDATE request_charges SET input_micro_per_token=0').run()).toThrow(/immutable/u);
  expect(() => raw.prepare('UPDATE run_budgets SET limit_micro=5').run()).toThrow(/immutable/u);
});

it('rejects an out-of-range budget at the start boundary', async () => {
  const f = await fixture();
  for (const budgetMicroCny of [0, -1, 1.5, 1_000_000_001]) await expect(start(f, { budgetMicroCny })).rejects.toMatchObject({ code: 'invalid_input' });
});

it('validation rejects a finish reason on a request that did not complete, and the reason cannot be rewritten (D102)', async () => {
  const f = await fixture({ modes: ['length'] });
  const { runId } = await start(f, { maxTurns: 1 }); await f.run.waitForIdle(runId);
  const raw = (f.db as unknown as { db: import('better-sqlite3').Database }).db;
  expect(() => raw.prepare("UPDATE request_attempts SET finish_reason='stop'").run()).toThrow(/immutable/u);
  // Outside the value domain is refused by the column CHECK (here on a request without a recorded reason).
  raw.exec('DROP TRIGGER request_attempt_finish_once');
  expect(() => raw.prepare("UPDATE request_attempts SET finish_reason='truncated'").run()).toThrow(/CHECK/u);
  raw.exec(migration8.slice(migration8.indexOf('CREATE TRIGGER')));
  expect(validateDatabase(raw).schemaVersion).toBe(8);
  raw.prepare("UPDATE request_attempts SET status='failed'").run();
  expect(() => validateDatabase(raw)).toThrow(/finish reason/u);
});

it('defaults to a 4096-token output limit, reserves for it, and refuses a limit above the model policy before any Run exists (D103)', async () => {
  const f = await fixture({ members: 1 });
  const { runId } = await f.run.start({ roomId: 'room', task: '设计一个校园跑腿平台', workflowSnapshot: {}, maxTurns: 1 }); await f.run.waitForIdle(runId);
  const charge = f.run.getSnapshot(runId).charges![0];
  expect(f.db.getRun(runId)!.outputTokenLimit).toBe(4096);
  expect(f.bodies[0]).toMatchObject({ max_tokens: 4096 });
  expect(charge).toMatchObject({ outputTokenLimit: 4096, reservedMicro: charge.inputTokenBound * 2 + 4096 * 8 });
  expect(f.db.listRoomRuns({ roomId: 'room' }).items).toHaveLength(1);
  await expect(f.run.start({ roomId: 'room', task: 'x', workflowSnapshot: {}, outputTokenLimit: 32769 })).rejects.toMatchObject({ detail: { code: 'invalid_input', field: 'outputTokenLimit' } });
  expect(f.db.listRoomRuns({ roomId: 'room' }).items).toHaveLength(1);
  const { runId: largest } = await f.run.start({ roomId: 'room', task: 'x', workflowSnapshot: {}, maxTurns: 1, outputTokenLimit: 32768 });
  await f.run.waitForIdle(largest);
  expect(f.bodies.at(-1)).toMatchObject({ max_tokens: 32768 });
});
