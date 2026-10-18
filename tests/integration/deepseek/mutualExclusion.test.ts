// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { ContractError } from '../../../src/shared/contracts/errors';
import { ControlledTrialService, type TrialQuote } from '../../../src/main/providers/controlledTrial/ControlledTrialService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { RunService } from '../../../src/main/services/RunService';

const cleanup: Array<() => void | Promise<void>> = [];
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-18T00:00:00Z')));
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.restoreAllMocks();
});

async function fixture(confirm: (quote: TrialQuote) => Promise<boolean> = async () => true, guardRun = true) {
  const db = new Database(':memory:'); db.initialize(); cleanup.push(() => db.close());
  db.createProvider({ id: 'deepseek', name: 'Owned fixture', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', customModels: [{ id: 'deepseek-flash', name: 'Flash' }] });
  const keys = new KeyService(db, createMemoryKeyBackend()); await keys.storeKey('deepseek', 'fake-mutual-exclusion-key');
  const transport = vi.fn<typeof fetch>(async () => new Response('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":71,"completion_tokens":8}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
  const registry = new ProviderRegistry(db, keys, { transportFactory: () => transport });
  registry.confirmTarget({ providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', confirmed: true });
  let trial!: ControlledTrialService;
  const run = new RunService(db, new MockProvider({ tokenDelayMs: 0 }), undefined, undefined, () => {
    if (guardRun && trial.isBusy()) throw new ContractError('invalid_state');
  });
  trial = new ControlledTrialService(db, registry, confirm, () => run.hasActiveRuns());
  cleanup.push(() => trial.shutdown(), () => run.shutdown());
  const keyState = vi.spyOn(keys, 'getProviderKeyState');
  const resolveKey = vi.spyOn(keys, 'resolveKey');
  const roomId = run.createDemoRoom('mutual exclusion fixture');
  return { db, run, trial, roomId, transport, keyState, resolveKey };
}

it('rejects a new Run while a real trial awaits authorization, without creating a Run or reading its Key', async () => {
  const f = await fixture(() => new Promise(() => {}));
  const operation = f.trial.execute(f.trial.prepare('deepseek').id).catch(error => error);
  const before = f.db.listRoomRuns({ roomId: f.roomId });
  try {
    await expect(f.run.start({ roomId: f.roomId, task: 'must not start', workflowSnapshot: {} })).rejects.toMatchObject({ code: 'invalid_state' });
    expect(f.db.listRoomRuns({ roomId: f.roomId })).toEqual(before);
    expect(f.run.hasActiveRuns()).toBe(false);
    expect(f.db.listControlledTrials()).toEqual([]);
    expect(f.keyState).not.toHaveBeenCalled(); expect(f.resolveKey).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
  } finally { await f.trial.shutdown(); await operation; }
});

it.each(['resumeRun', 'step'] as const)('rejects paused %s when the trial gate is busy, preserving all saved output and state', async command => {
  const db = new Database(':memory:'); db.initialize(); cleanup.push(() => db.close());
  let trialBusy = false;
  const run = new RunService(db, new MockProvider({ tokenDelayMs: 0 }), undefined, undefined, () => {
    if (trialBusy) throw new ContractError('invalid_state');
  });
  cleanup.push(() => run.shutdown());
  const roomId = run.createDemoRoom('paused mutual exclusion');
  const started = await run.start({ roomId, task: 'preserve this output', workflowSnapshot: {}, mode: 'step', maxTurns: 3 });
  await run.waitForIdle(started.runId);
  const before = db.readRunSnapshot(started.runId);
  expect(before.run.status).toBe('paused'); expect(before.messages[0]?.content.length).toBeGreaterThan(0);
  trialBusy = true;
  await expect(run[command](started.runId)).rejects.toMatchObject({ code: 'invalid_state' });
  expect(db.readRunSnapshot(started.runId)).toEqual(before);
});

it('refuses a trial preview when a Run is active, before confirmation, reservation or Key access', async () => {
  const confirm = vi.fn(async () => true);
  const f = await fixture(confirm, false);
  const started = await f.run.start({ roomId: f.roomId, task: 'existing Run', workflowSnapshot: {}, mode: 'step', maxTurns: 3 });
  await f.run.waitForIdle(started.runId);
  expect(() => f.trial.prepare('deepseek')).toThrowError(expect.objectContaining({ code: 'invalid_state' }));
  expect(confirm).not.toHaveBeenCalled(); expect(f.db.listControlledTrials()).toEqual([]);
  expect(f.keyState).not.toHaveBeenCalled(); expect(f.resolveKey).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
});

it.each(['before execution', 'during final confirmation'] as const)('rechecks a Run started %s after quotation, before reservation and Key access', async phase => {
  let approve!: (value: boolean) => void;
  const f = await fixture(() => new Promise(resolve => { approve = resolve; }), false);
  const quote = f.trial.prepare('deepseek');
  let operation: Promise<unknown> | undefined;
  if (phase === 'during final confirmation') operation = f.trial.execute(quote.id);
  const started = await f.run.start({ roomId: f.roomId, task: 'Run won the race', workflowSnapshot: {}, mode: 'step', maxTurns: 3 });
  await f.run.waitForIdle(started.runId);
  const before = f.db.readRunSnapshot(started.runId);
  operation ??= f.trial.execute(quote.id);
  const rejected = expect(operation).rejects.toMatchObject({ code: 'invalid_state' });
  approve?.(true);
  await rejected;
  expect(f.db.readRunSnapshot(started.runId)).toEqual(before);
  expect(f.db.listControlledTrials()).toEqual([]);
  expect(f.keyState).not.toHaveBeenCalled(); expect(f.resolveKey).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
});
