// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { TrialDiagnostics, trialDiagnosticsSchema } from '../../../src/main/providers/diagnostics';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Sqlite from 'better-sqlite3';
import { createVerifiedBackup } from '../../../src/main/database/backup/createVerifiedBackup';
import { prepareRestore } from '../../../src/main/database/recovery/prepareRestore';
import { Database } from '../../../src/main/database/Database';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ControlledTrialService } from '../../../src/main/providers/controlledTrial/ControlledTrialService';
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); });

it('keeps monotonic evidence, first failure and only whitelisted diagnostic data', () => {
  const history: unknown[] = []; const d = new TrialDiagnostics(value => history.push(value));
  d.observe({ stage: 'credential' });
  d.observe({ stage: 'dns', evidence: 'client_invoked' });
  d.observe({ category: 'dns_failed' });
  d.observe({ category: 'network_unknown' });
  expect(d.snapshot()).toMatchObject({ stage: 'dns', evidence: 'client_invoked', category: 'dns_failed' });
  expect(d.snapshot().clientInvokedAt).toBeDefined();
  expect(() => d.observe({ category: 'ENOTFOUND secret', stack: 'secret' } as never)).toThrow();
  expect(JSON.stringify(history)).not.toContain('secret');
  expect(() => trialDiagnosticsSchema.parse({ ...d.snapshot(), httpStatus: 401 })).toThrow();
});
it('records HTTP evidence only with a valid numeric status and never downgrades it', () => {
  const d = new TrialDiagnostics(() => {});
  expect(() => d.observe({ evidence: 'http_response' })).toThrow();
  d.observe({ stage: 'response', evidence: 'http_response', httpStatus: 429 });
  d.observe({ evidence: 'client_invoked', stage: 'response', category: 'http_error' });
  expect(d.snapshot()).toMatchObject({ evidence: 'http_response', httpStatus: 429, category: 'http_error' });
  expect(d.snapshot().httpResponseAt).toBeDefined();
});

async function fixture(mode: 'ok' | 'missing' | 'bad-json' | 'credentials' | 'credential-empty' | 'accounting' | 'network' | number) {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T12:00:00Z'));
  const db = new Database(':memory:'); db.initialize(); cleanup.push(() => db.close());
  db.createProvider({ id: 'p', name: 'Diagnostic fixture', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', customModels: [{ id: 'deepseek-flash', name: 'Flash' }] });
  const keys = new KeyService(db, createMemoryKeyBackend()); await keys.storeKey('p', 'diagnostics-fake-secret');
  let calls = 0;
  const registry = new ProviderRegistry(db, keys, { transportFactory: () => (async () => {
    calls++;
    if (mode === 'network') throw Object.assign(new Error('diagnostics-fake-secret raw stack'), { code: 'EUNKNOWN' });
    if (typeof mode === 'number') return new Response('diagnostics-fake-secret raw response', { status: mode });
    const body = mode === 'bad-json' ? 'data: {invalid diagnostics-fake-secret}\n\n' : 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }], ...(mode === 'missing' ? {} : { usage: { prompt_tokens: 71, completion_tokens: 8 } }) }) + '\n\ndata: [DONE]\n\n';
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch });
  registry.confirmTarget({ providerId: 'p', baseUrl: 'https://api.deepseek.com', confirmed: true });
  if (mode === 'credentials') vi.spyOn(keys, 'resolveKey').mockRejectedValue(Object.assign(new Error('diagnostics-fake-secret'), { code: 'Keychain raw error' }));
  if (mode === 'credential-empty') vi.spyOn(keys, 'resolveKey').mockResolvedValue(undefined);
  if (mode === 'accounting') vi.spyOn(db, 'finishControlledTrial').mockImplementationOnce(() => { throw new Error('diagnostics-fake-secret SQL path'); });
  const service = new ControlledTrialService(db, registry, async () => true); cleanup.push(() => service.shutdown());
  return { db, registry, keys, service, count: () => calls };
}
it.each(['credentials', 'credential-empty'] as const)('persists %s failure before any client call, preserving the full reservation', async mode => {
  const f = await fixture(mode); const row = await f.service.execute(f.service.prepare('p').id);
  expect(f.count()).toBe(0);
  expect(row).toMatchObject({ state: 'unknown', reservedMicroCny: 50000, accountedMicroCny: null, diagnostics: { stage: 'credential', evidence: 'not_started', category: mode === 'credentials' ? 'credential_read_failed' : 'credential_unavailable' } });
  expect(JSON.stringify(row)).not.toContain('diagnostics-fake-secret');
  expect(() => f.service.prepare('p')).toThrow();
});
it.each([401, 403, 429, 500])('retains observed HTTP %s without storing the untrusted body or retrying', async status => {
  const f = await fixture(status); const row = await f.service.execute(f.service.prepare('p').id);
  expect(row).toMatchObject({ state: 'unknown', diagnostics: { stage: 'response', evidence: 'http_response', httpStatus: status, category: 'http_error' } });
  expect(f.count()).toBe(1); expect(JSON.stringify(row)).not.toContain('diagnostics-fake-secret');
});
it.each([['missing', 'usage_missing', 'usage'], ['bad-json', 'response_invalid', 'stream'], ['network', 'network_unknown', 'network_client']] as const)('persists %s with conservative evidence and no invented charges', async (mode, category, stage) => {
  const f = await fixture(mode); const row = await f.service.execute(f.service.prepare('p').id);
  expect(row).toMatchObject({ state: 'unknown', accountedMicroCny: null, diagnostics: { stage, category, evidence: mode === 'network' ? 'client_invoked' : 'http_response' } });
  expect(f.count()).toBe(1); expect(JSON.stringify(row)).not.toContain('diagnostics-fake-secret');
});
it('settles valid usage and preserves complete HTTP evidence', async () => {
  const f = await fixture('ok'); const row = await f.service.execute(f.service.prepare('p').id);
  expect(row).toMatchObject({ state: 'settled', accountedMicroCny: 206, diagnostics: { stage: 'complete', category: null, evidence: 'http_response', httpStatus: 200 } });
});
it('retains an unknown reservation and diagnostic when the settlement transaction fails', async () => {
  const f = await fixture('accounting'); const row = await f.service.execute(f.service.prepare('p').id);
  expect(row).toMatchObject({ state: 'unknown', accountedMicroCny: null, observedUsage: { inputTokens: 71, outputTokens: 8 }, diagnostics: { stage: 'accounting', category: 'accounting_failed', evidence: 'http_response' } });
  expect(f.count()).toBe(1); expect(() => f.service.prepare('p')).toThrow();
});
it('does not fabricate diagnostics for legacy unknown rows during recovery', async () => {
  const f = await fixture('ok'); const { estimate: _estimate, expiresAt: _expires, ...row } = f.service.prepare('p');
  delete row.diagnostics;
  f.db.reserveControlledTrial(row); f.db.recoverControlledTrials(); f.db.recoverControlledTrials();
  expect(f.db.listControlledTrials()[0]).toMatchObject({ state: 'unknown', outcome: 'interrupted', reservedMicroCny: 50000, accountedMicroCny: null });
  expect(f.db.listControlledTrials()[0].diagnostics).toBeUndefined();
  expect(() => f.service.prepare('p')).toThrow();
});

it.each(['diagnostic', 'usage', 'complete'] as const)('keeps the budget unknown if %s persistence fails', async step => {
  const f = await fixture('ok');
  const update = f.db.updateControlledTrialProgress.bind(f.db); let failed = false;
  vi.spyOn(f.db, 'updateControlledTrialProgress').mockImplementation((id, patch) => {
    if (!failed && (step === 'diagnostic' && patch.diagnostics?.stage === 'credential' || step === 'usage' && patch.observedUsage || step === 'complete' && patch.diagnostics?.stage === 'complete')) {
      failed = true; throw new Error('diagnostics-fake-secret');
    }
    return update(id, patch);
  });
  const row = await f.service.execute(f.service.prepare('p').id);
  expect(failed).toBe(true);
  expect(row).toMatchObject({ state: 'unknown', accountedMicroCny: null, diagnostics: { category: 'accounting_failed', stage: 'accounting' } });
  expect(() => f.service.prepare('p')).toThrow();
  expect(f.count()).toBe(step === 'diagnostic' ? 0 : 1);
});
it('classifies a revoked target during credential resolution as policy rejection, not Keychain failure', async () => {
  const f = await fixture('ok'); const original = f.keys.resolveKey.bind(f.keys); let changed = false;
  vi.spyOn(f.keys, 'resolveKey').mockImplementation(async (...args) => {
    if (!changed) { changed = true; await f.keys.storeKey('p', 'replacement-fake'); }
    return original(...args);
  });
  const row = await f.service.execute(f.service.prepare('p').id);
  expect(row).toMatchObject({ state: 'unknown', diagnostics: { category: 'policy_rejected', evidence: 'not_started' } });
  expect(f.count()).toBe(0);
});
it('ignores late transport callbacks after the result has been finalized', async () => {
  const f = await fixture('ok'); const transport = f.registry.createTransport.bind(f.registry);
  let observe: import('../../../src/main/providers/diagnostics').DiagnosticObserver | undefined;
  vi.spyOn(f.registry, 'createTransport').mockImplementation((guard, observer) => { observe = observer; return transport(guard, observer); });
  const row = await f.service.execute(f.service.prepare('p').id);
  observe!({ stage: 'response', evidence: 'http_response', httpStatus: 500, category: 'http_error' });
  expect(f.db.listControlledTrials()[0]).toEqual(row);
  expect(row.state).toBe('settled');
});

it('preserves new diagnostics and unknown charges through a validated current-schema backup and restore', async () => {
  const f = await fixture(429); const record = await f.service.execute(f.service.prepare('p').id);
  const directory = mkdtempSync(join(tmpdir(), 'roundtable-diagnostic-backup-')); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'owned.db'); const database = new Database(path); database.initialize(); cleanup.push(() => database.close());
  database.reserveControlledTrial({ ...record, state: 'reserved', outcome: 'running' }); database.recoverControlledTrials();
  const expected = database.listControlledTrials(); const raw = new Sqlite(path); cleanup.push(() => { raw.close(); });
  const backups = join(directory, 'backups'); mkdirSync(backups, { mode: 0o700 });
  const backup = await createVerifiedBackup(raw, backups); expect(backup.validation.schemaVersion).toBe(11);
  const restored = await prepareRestore(backup, backups); const candidate = new Database(restored.path); cleanup.push(() => candidate.close()); candidate.initialize(); candidate.recoverControlledTrials();
  expect(candidate.listControlledTrials()).toEqual(expected);
  expect(candidate.listControlledTrials()[0]).toMatchObject({ state: 'unknown', reservedMicroCny: 50000, diagnostics: { httpStatus: 429, category: 'http_error' } });
});
it('leaves a durable reservation for startup recovery when both settlement writes fail', async () => {
  const f = await fixture('ok');
  vi.spyOn(f.db, 'finishControlledTrial').mockImplementation(() => { throw new Error('persistent diagnostics-fake-secret'); });
  await expect(f.service.execute(f.service.prepare('p').id)).rejects.toBeDefined();
  expect(f.db.listControlledTrials()[0]).toMatchObject({ state: 'reserved', accountedMicroCny: null, reservedMicroCny: 50000, diagnostics: { category: 'accounting_failed' } });
  f.db.recoverControlledTrials();
  expect(f.db.listControlledTrials()[0]).toMatchObject({ state: 'unknown', outcome: 'interrupted', reservedMicroCny: 50000, accountedMicroCny: null });
  expect(f.count()).toBe(1); expect(() => f.service.prepare('p')).toThrow();
});
