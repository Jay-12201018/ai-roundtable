import { describe, expect, it } from 'vitest';
import {
  canRetryTurn,
  canRunCommand,
  canTransitionTurn,
  canTransitionRun,
  transitionRun,
  transitionTurn,
  type RunStatus,
} from '../../src/main/orchestrator/stateMachine';
import {
  runCommandSchema,
  runEventSchema,
  runSnapshotSchema,
  runSubscriptionSchema,
} from '../../src/shared/schemas/run';

describe('run state machine', () => {
  const cases: Array<[RunStatus, RunStatus]> = [
    ['idle', 'running'],
    ['running', 'pausing'],
    ['pausing', 'paused'],
    ['running', 'cancelling'],
    ['cancelling', 'cancelled'],
    ['running', 'completed'],
    ['running', 'error'],
    ['running', 'interrupted'],
    ['paused', 'running'],
    ['error', 'running'],
    ['interrupted', 'running'],
  ];

  it.each(cases)('allows %s -> %s', (from, to) => {
    expect(canTransitionRun(from, to)).toBe(true);
    expect(transitionRun(from, to)).toBe(to);
  });

  it.each([
    ['idle', 'paused'],
    ['cancelled', 'completed'],
    ['completed', 'running'],
    ['error', 'completed'],
    ['interrupted', 'completed'],
  ] as Array<[RunStatus, RunStatus]>)('rejects %s -> %s', (from, to) => {
    expect(canTransitionRun(from, to)).toBe(false);
    expect(() => transitionRun(from, to)).toThrow(/invalid run transition/i);
  });

  it('fails closed for an unknown persisted status', () => {
    expect(canTransitionRun('unknown' as RunStatus, 'running')).toBe(false);
  });

  it('only permits a single turn for step and pause does not continue', () => {
    expect(canTransitionRun('paused', 'running')).toBe(true);
    expect(canTransitionRun('pausing', 'running')).toBe(false);
    expect(canTransitionRun('cancelling', 'running')).toBe(false);
  });

  it('enforces command preconditions', () => {
    expect(canRunCommand('pause', 'running')).toBe(true);
    expect(canRunCommand('pause', 'paused')).toBe(false);
    expect(canRunCommand('stop', 'running')).toBe(true);
    expect(canRunCommand('stop', 'paused')).toBe(true);
    expect(canRunCommand('step', 'paused')).toBe(true);
    expect(canRunCommand('step', 'running')).toBe(false);
    expect(canRunCommand('resumeRun', 'paused')).toBe(true);
    expect(canRunCommand('resumeRun', 'interrupted')).toBe(false);
    expect(canRunCommand('recoverInterruptedRun', 'interrupted')).toBe(true);
    expect(canRunCommand('continueMessage', 'completed')).toBe(false);
  });
});

describe('turn state machine', () => {
  it('allows a pending turn to complete or fail exactly once', () => {
    expect(canTransitionTurn('pending', 'running')).toBe(true);
    expect(transitionTurn('running', 'completed')).toBe('completed');
    expect(canTransitionTurn('completed', 'running')).toBe(false);
    expect(canTransitionTurn('running', 'failed')).toBe(true);
    expect(canRetryTurn('failed')).toBe(true);
    expect(canRetryTurn('aborted')).toBe(true);
    expect(canRetryTurn('completed')).toBe(false);
  });
});

describe('run synchronization schemas', () => {
  const timestamp = '2026-10-13T00:00:00.000Z';
  const snapshot = {
    runId: 'run-1',
    roomId: 'room-1',
    status: 'running',
    sequence: 4,
    workflowSnapshot: { name: 'draft-review-finalize', version: 1 },
    currentTurnId: 'turn-1',
    activeAgentId: 'agent-a',
    turns: [],
    messages: [{ id: 'message-1', senderName: '起草者', content: 'draft', status: 'streaming' }],
    startedAt: timestamp,
    updatedAt: timestamp,
  };

  it('validates snapshots and subscriptions', () => {
    expect(runSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      runSubscriptionSchema.parse({
        snapshot,
        events: [],
        nextCursor: 4,
        resyncRequired: false,
      }),
    ).toMatchObject({ nextCursor: 4, resyncRequired: false });
  });

  it('requires current message content and a valid message status in snapshots', () => {
    expect(() => runSnapshotSchema.parse({ ...snapshot, messages: undefined })).toThrow();
    expect(() => runSnapshotSchema.parse({
      ...snapshot,
      messages: [{ id: 'message-1', senderName: '起草者', content: 'draft', status: 'unknown' }],
    })).toThrow();
  });

  it('requires an integer sequence and rejects malformed events', () => {
    const event = {
      runId: 'run-1',
      turnId: 'turn-1',
      sequence: 5,
      type: 'text_delta',
      payload: { text: 'draft' },
      timestamp,
    };
    expect(runEventSchema.parse(event)).toEqual(event);
    expect(() => runEventSchema.parse({ ...event, sequence: 5.5 })).toThrow();
    expect(() => runEventSchema.parse({ ...event, type: 'unknown' })).toThrow();
  });

  it('rejects commands with unexpected fields at the IPC boundary', () => {
    expect(() => runCommandSchema.parse({ command: 'pause', runId: 'run-1', source: 'model' })).toThrow();
    expect(
      runCommandSchema.parse({
        command: 'start',
        roomId: 'room-1',
        task: 'Draft a plan',
        workflowSnapshot: { name: 'draft-review-finalize' },
      }),
    ).toMatchObject({ command: 'start', roomId: 'room-1' });
  });
});
