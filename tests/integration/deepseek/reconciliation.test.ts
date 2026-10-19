// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import type { TrialRecord } from '../../../src/main/providers/controlledTrial/record';
const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function reservation(id = 'one'): TrialRecord {
  return { id, requestId: `request-${id}`, providerId: 'provider', modelId: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', prompt: 'Reply OK.', keyRevision: 'key-revision', createdAt: '2026-10-18T12:23:24.647Z', priceReviewedAt: '2026-10-18T00:00:00.000Z', priceExpiresAt: '2026-10-19T00:00:00.000Z', inputMicroCnyPerToken: 2, outputMicroCnyPerToken: 8, priceEvidence: 'owned local fixture', estimatedInputTokens: 67, estimatedMicroCny: 1158, reservedMicroCny: 50000, maxOutputTokens: 128, state: 'reserved', outcome: 'running', actualInputTokens: null, actualOutputTokens: null, observedUsage: null, accountedMicroCny: null, text: 'retained partial', errorCode: null };
}
function fixture(createdAt = reservation().createdAt) {
  const db = new Database(':memory:'); db.initialize(); databases.push(db); db.reserveControlledTrial({ ...reservation(), createdAt });
  return db;
}
const input = { trialId: 'one', requestId: 'request-one', providerId: 'provider', keyRevision: 'key-revision', evidence: 'dashboard_no_displayed_usage' as const, decision: 'release_reservation' as const, acknowledgedUncertainty: true as const };
it('keeps unknown evidence byte-equivalent and records explicit manual release separately, without inventing usage', () => {
  const db = fixture(); db.recoverControlledTrials(); const original = db.listControlledTrials();
  expect(db.hasUnresolvedControlledTrials()).toBe(true);
  const result = db.reconcileControlledTrial(input);
  expect(result).toMatchObject({ ...input, reviewedAt: expect.any(String), id: expect.any(String), evidenceSummary: expect.stringContaining('不证明') });
  expect(db.listControlledTrials()).toEqual(original);
  expect(original[0]).toMatchObject({ state: 'unknown', outcome: 'interrupted', actualInputTokens: null, actualOutputTokens: null, accountedMicroCny: null, reservedMicroCny: 50000 });
  expect(db.listControlledTrialReconciliations('one')).toEqual([result]);
  expect(db.hasUnresolvedControlledTrials()).toBe(false);
  db.reserveControlledTrial(reservation('two'));
  expect(db.hasUnresolvedControlledTrials()).toBe(true);
  expect(() => db.reserveControlledTrial(reservation('three'))).toThrow();
});
it('records a retain decision but preserves the active reservation lock', () => {
  const db = fixture(); db.recoverControlledTrials();
  expect(db.reconcileControlledTrial({ ...input, decision: 'retain_reservation' }).decision).toBe('retain_reservation');
  expect(db.hasUnresolvedControlledTrials()).toBe(true);
  expect(() => db.reserveControlledTrial(reservation('two'))).toThrow();
  expect(db.listControlledTrialReconciliations()).toHaveLength(1);
});
it('does not treat startup recovery or listing as manual reconciliation', () => {
  const db = fixture(); db.recoverControlledTrials(); db.recoverControlledTrials();
  expect(db.listControlledTrialReconciliations()).toEqual([]);
  expect(db.hasUnresolvedControlledTrials()).toBe(true);
});
it.each([
  { requestId: 'stale-request' }, { providerId: 'different-provider' }, { keyRevision: 'stale-key' },
  { trialId: 'missing' }, { acknowledgedUncertainty: false }, { evidence: 'no_fee_proved' },
  { decision: 'settled' }, { evidenceSummary: 'untrusted arbitrary secret' },
])('refuses identity mismatch or unapproved evidence without changing records: %j', patch => {
  const db = fixture(); db.recoverControlledTrials(); const before = db.listControlledTrials();
  expect(() => db.reconcileControlledTrial({ ...input, ...patch } as typeof input)).toThrow();
  expect(db.listControlledTrials()).toEqual(before); expect(db.listControlledTrialReconciliations()).toEqual([]);
  expect(db.hasUnresolvedControlledTrials()).toBe(true);
});
it('rejects reserved and settled trials, and cannot release a reservation twice', () => {
  const db = fixture(); expect(() => db.reconcileControlledTrial(input)).toThrow();
  db.recoverControlledTrials(); db.reconcileControlledTrial(input);
  expect(() => db.reconcileControlledTrial(input)).toThrow();
  expect(db.listControlledTrialReconciliations()).toHaveLength(1);
  db.reserveControlledTrial(reservation('two'));
  db.updateControlledTrialProgress('two', { observedUsage: { inputTokens: 1, outputTokens: 1 } });
  db.finishControlledTrial('two', { state: 'settled', outcome: 'completed', actualInputTokens: 1, actualOutputTokens: 1, accountedMicroCny: 10, errorCode: null });
  expect(() => db.reconcileControlledTrial({ ...input, trialId: 'two', requestId: 'request-two' })).toThrow();
});

it.each([-31 * 86400000, 86400000])('refuses dashboard last-30-days evidence outside its covered interval (%d ms)', offset => {
  const db = fixture(new Date(Date.now() + offset).toISOString()); db.recoverControlledTrials();
  expect(() => db.reconcileControlledTrial(input)).toThrow();
  expect(db.hasUnresolvedControlledTrials()).toBe(true); expect(db.listControlledTrialReconciliations()).toEqual([]);
});
it('keeps both retain and release decisions without replacing earlier audit evidence', () => {
  const db = fixture(); db.recoverControlledTrials();
  const retained = db.reconcileControlledTrial({ ...input, decision: 'retain_reservation' });
  const released = db.reconcileControlledTrial(input);
  expect(db.listControlledTrialReconciliations()).toEqual([retained, released]);
  expect(db.listControlledTrials()[0].accountedMicroCny).toBeNull(); expect(db.hasUnresolvedControlledTrials()).toBe(false);
});
