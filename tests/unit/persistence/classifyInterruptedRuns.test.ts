import { describe, expect, it } from 'vitest';
import { classifyInterruptedRuns } from '../../../src/main/database/recovery/classifyInterruptedRuns';

describe('classifyInterruptedRuns', () => {
  it('selects active and paused runs in input order', () => {
    expect(classifyInterruptedRuns([
      { id: 'run-completed', status: 'completed' },
      { id: 'run-paused', status: 'paused' },
      { id: 'run-error', status: 'error' },
      { id: 'run-running', status: 'running' },
      { id: 'run-cancelled', status: 'cancelled' },
      { id: 'run-cancelling', status: 'cancelling' },
      { id: 'run-idle', status: 'idle' },
      { id: 'run-pausing', status: 'pausing' },
      { id: 'run-interrupted', status: 'interrupted' },
    ])).toEqual(['run-paused', 'run-running', 'run-cancelling', 'run-pausing']);
  });

  it('returns an empty list for no runs', () => {
    expect(classifyInterruptedRuns([])).toEqual([]);
  });

  it('accepts frozen input without changing its records', () => {
    const runs = Object.freeze([
      Object.freeze({ id: 'run-1', status: 'paused' }),
      Object.freeze({ id: 'run-2', status: 'completed' }),
    ]);
    expect(classifyInterruptedRuns(runs)).toEqual(['run-1']);
    expect(runs).toEqual([
      { id: 'run-1', status: 'paused' },
      { id: 'run-2', status: 'completed' },
    ]);
  });

  it.each(['unknown', 'RUNNING', 'constructor', ''])('rejects the unknown persisted status %j', (status) => {
    expect(() => classifyInterruptedRuns([
      { id: 'run-1', status: 'running' },
      { id: 'run-2', status },
    ])).toThrow();
  });

  it.each([
    ['running', 'paused'],
    ['completed', 'cancelled'],
    ['running', 'completed'],
  ])('rejects duplicate IDs across %s and %s runs', (first, second) => {
    expect(() => classifyInterruptedRuns([
      { id: 'run-1', status: first },
      { id: 'run-1', status: second },
    ])).toThrow(/duplicate/i);
  });

  it.each(['', 'run 1', ' run-1', 'run\n1', 'a'.repeat(257)])('rejects the malformed ID %j', (id) => {
    expect(() => classifyInterruptedRuns([{ id, status: 'running' }])).toThrow();
  });

  it('validates IDs even for runs that do not need interruption', () => {
    expect(() => classifyInterruptedRuns([{ id: '', status: 'completed' }])).toThrow();
  });

  it('accepts existing non-UUID IDs at both allowed length boundaries', () => {
    const longId = 'a'.repeat(256);
    expect(classifyInterruptedRuns([
      { id: 'x', status: 'running' },
      { id: longId, status: 'paused' },
    ])).toEqual(['x', longId]);
  });
});
