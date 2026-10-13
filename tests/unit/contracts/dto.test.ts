import { describe, expect, it } from 'vitest';
import { runCommandSchema, runEventSchema, runSnapshotSchema, runSubscriptionSchema } from '../../../src/shared/schemas/run';

const snapshot = {
  runId: 'run-1', roomId: 'room-1', status: 'running', sequence: 1,
  workflowSnapshot: {}, turns: [], messages: [], updatedAt: '2026-10-14T00:00:00.000Z',
};
const delta = {
  version: 1, runId: 'run-1', turnId: 'turn-1', requestId: 'request-1', sequence: 1,
  type: 'text_delta', timestamp: '2026-10-14T00:00:00.000Z',
  payload: { turnId: 'turn-1', messageId: 'message-1', senderName: '起草者', text: 'hello' },
};

describe('shared boundary DTOs', () => {
  it('accepts the current snapshot and discriminated text event', () => {
    expect(runSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(runEventSchema.parse(delta)).toEqual(delta);
  });
  it.each([
    { ...snapshot, extra: 'secret fixture' }, { ...snapshot, runId: ' ' },
    { ...snapshot, sequence: Number.MAX_SAFE_INTEGER + 1 }, { ...snapshot, status: 'other' },
    { ...snapshot, updatedAt: 'yesterday' }, { ...snapshot, workflowSnapshot: { fn: () => 1 } },
    { ...snapshot, turns: [{ turnId: 't', runId: 'other', agentId: 'a', status: 'running' }] },
  ])('rejects invalid snapshot %#', (value) => {
    expect(runSnapshotSchema.safeParse(value).success).toBe(false);
  });
  it.each([
    { ...delta, version: 2 }, { ...delta, type: 'future_event' }, { ...delta, requestId: '' },
    { ...delta, turnId: 'other' }, { ...delta, sequence: 0 }, { ...delta, apiKey: 'fixture-key' },
    { ...delta, payload: { ...delta.payload, text: 12 } },
    { ...delta, payload: { ...delta.payload, secret: 'fixture-key' } },
    { ...delta, type: 'usage_updated', payload: delta.payload },
  ])('rejects invalid event %#', (value) => {
    expect(runEventSchema.safeParse(value).success).toBe(false);
  });
  it('rejects cross-run or inconsistent subscription cursors', () => {
    expect(runSubscriptionSchema.safeParse({ snapshot, events: [{ ...delta, runId: 'other' }], nextCursor: 1, resyncRequired: false }).success).toBe(false);
    expect(runSubscriptionSchema.safeParse({ snapshot, events: [], nextCursor: 2, resyncRequired: false }).success).toBe(false);
  });
  it('verifies event turn, request and message identities against the authoritative snapshot', () => {
    const state = { ...snapshot, turns: [{ turnId: 'turn-1', runId: 'run-1', agentId: 'agent-1', requestId: 'request-1', messageId: 'message-1', status: 'running' }], messages: [{ id: 'message-1', senderName: '起草者', content: 'hello', status: 'streaming' }] };
    const subscription = { snapshot: state, events: [delta], nextCursor: 1, resyncRequired: false };
    expect(runSubscriptionSchema.safeParse(subscription).success).toBe(true);
    expect(runSubscriptionSchema.safeParse({ ...subscription, events: [{ ...delta, requestId: 'other' }] }).success).toBe(false);
    expect(runSubscriptionSchema.safeParse({ ...subscription, events: [{ ...delta, payload: { ...delta.payload, messageId: 'other' } }] }).success).toBe(false);
    expect(runSubscriptionSchema.safeParse({ ...subscription, snapshot }).success).toBe(false);
  });
  it.each(['inspect', 'resume', 'retry', 'discard'])('recognizes recovery %s in one schema', (decision) => {
    expect(runCommandSchema.safeParse({ command: 'recoverInterruptedRun', runId: 'run-1', decision }).success).toBe(true);
  });
  it.each([
    { command: 'retryTurn', runId: 'r', turnId: 't', source: 'model' },
    { command: 'continueMessage', runId: 'r', messageId: 'm', extra: 1 },
    { command: 'recoverInterruptedRun', runId: 'r', decision: 'auto' },
    { command: 'stop', runId: '' },
  ])('rejects unapproved commands and identities %#', (value) => {
    expect(runCommandSchema.safeParse(value).success).toBe(false);
  });
  it('accepts every documented RunEvent payload and rejects a mismatched start request', () => {
    const base = { version: 1, runId: 'r', sequence: 1, timestamp: '2026-10-14T00:00:00.000Z' };
    const turn = { ...base, turnId: 't', requestId: 'q' };
    const error = { code: 'cancelled', message: 'Request cancelled', retryable: false };
    const fixtures = [
      { ...base, type: 'run_state_changed', payload: { status: 'paused' } },
      { ...turn, type: 'turn_started', payload: { turnId: 't', messageId: 'm', agentId: 'a', requestId: 'q' } },
      { ...turn, type: 'text_delta', payload: { turnId: 't', messageId: 'm', senderName: 'Agent', text: 'a' } },
      { ...turn, type: 'reasoning_summary_delta', payload: { turnId: 't', messageId: 'm', senderName: 'Agent', text: 'public' } },
      { ...turn, type: 'usage_updated', payload: { turnId: 't', inputTokens: 0, outputTokens: 1 } },
      { ...turn, type: 'turn_completed', payload: { turnId: 't', messageId: 'm' } },
      { ...turn, type: 'turn_failed', payload: { turnId: 't', messageId: 'm', error } },
      { ...turn, type: 'turn_aborted', payload: { turnId: 't', messageId: 'm', error } },
      { ...base, type: 'snapshot_required', payload: { reason: 'sequence_gap' } },
    ];
    for (const fixture of fixtures) expect(runEventSchema.safeParse(fixture).success).toBe(true);
    expect(runEventSchema.safeParse({ ...fixtures[1], requestId: 'wrong' }).success).toBe(false);
  });
});
