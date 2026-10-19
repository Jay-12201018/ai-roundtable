import { describe, expect, it } from 'vitest';
import { compileWorkflow, nextWorkflowStep } from '../../../src/main/workflow';
import type { WorkflowExecution, WorkflowTurn } from '../../../src/main/workflow';
import { config, members, roomId, limits } from './fixtures';

const snapshot = () => compileWorkflow(config(), roomId, members);
const execution = (patch: Partial<WorkflowExecution> = {}): WorkflowExecution => ({ status: 'paused', nextTurnIndex: 0, elapsedExecutionMs: 0, ...limits, ...patch });
const turn = (index: number, status = 'completed'): WorkflowTurn => ({ turnIndex: index, agentId: ['a', 'b', 'a', 'b', 'c'][index], status });

describe('Main-only next-step evidence', () => {
  it('returns the first configured step without dispatching or changing state', () => {
    const state = execution();
    expect(nextWorkflowStep(snapshot(), state, [])).toMatchObject({ kind: 'next', step: { index: 0, agentId: 'a', kind: 'draft' }, outputTokenLimit: 1024 });
    expect(state.nextTurnIndex).toBe(0);
  });
  it('resumes from the persisted completed prefix, never room configuration', () => {
    const original = snapshot();
    const restored = JSON.parse(JSON.stringify(original));
    expect(nextWorkflowStep(restored, execution({ nextTurnIndex: 2, elapsedExecutionMs: 2345 }), [turn(1), turn(0)])).toMatchObject({ kind: 'next', step: { index: 2, kind: 'revise', agentId: 'a' } });
  });
  it.each(['running', 'pending', 'queued', 'failed', 'aborted', 'interrupted', 'cancelled'])(
    'does not skip or resend a last %s request when allocation advanced', status => {
      expect(nextWorkflowStep(snapshot(), execution({ nextTurnIndex: 2 }), [turn(0), turn(1, status)])).toEqual({ kind: 'blocked', reason: 'unsettled_turn' });
    });
  it.each(['interrupted', 'error', 'cancelled', 'cancelling', 'completed', 'pausing'] as const)(
    'does not authorize a request in Run state %s', status => {
      expect(nextWorkflowStep(snapshot(), execution({ status }), [])).toEqual({ kind: 'blocked', reason: 'run_state' });
    });
  it('completes only after the last planned turn has settled', () => {
    const turns = [0, 1, 2, 3, 4].map(index => turn(index));
    const state = execution({ nextTurnIndex: 5 });
    expect(nextWorkflowStep(snapshot(), state, turns)).toEqual({ kind: 'complete' });
    expect(nextWorkflowStep(snapshot(), state, [...turns.slice(0, 4), turn(4, 'failed')])).toEqual({ kind: 'blocked', reason: 'unsettled_turn' });
  });
  it('enforces cumulative time and turn ceilings including tighter runtime limits', () => {
    expect(nextWorkflowStep(snapshot(), execution({ elapsedExecutionMs: 300000 }), [])).toEqual({ kind: 'limit', reason: 'max_duration' });
    expect(nextWorkflowStep(snapshot(), execution({ maxDurationMs: 100, elapsedExecutionMs: 100 }), [])).toEqual({ kind: 'limit', reason: 'max_duration' });
    expect(nextWorkflowStep(snapshot(), execution({ maxTurns: 1, nextTurnIndex: 1 }), [turn(0)])).toEqual({ kind: 'limit', reason: 'max_turns' });
    expect(nextWorkflowStep(snapshot(), execution({ outputTokenLimit: 128 }), [])).toMatchObject({ kind: 'next', outputTokenLimit: 128 });
    expect(nextWorkflowStep(snapshot(), execution({ outputTokenLimit: 4000 }), [])).toMatchObject({ kind: 'next', outputTokenLimit: 1024 });
  });
  it.each([
    [execution({ nextTurnIndex: null }), []],
    [execution({ elapsedExecutionMs: null }), []],
    [execution({ elapsedExecutionMs: -1 }), []],
    [execution({ maxTurns: 0 }), []],
    [execution({ nextTurnIndex: 2 }), [turn(1)]],
    [execution({ nextTurnIndex: 1 }), [turn(0), turn(0)]],
    [execution({ nextTurnIndex: 2 }), [turn(0, 'running'), turn(1)]],
    [execution({ nextTurnIndex: 1 }), [{ ...turn(0), agentId: 'b' }]],
    [execution({ nextTurnIndex: 0 }), [turn(0)]],
    [execution({ nextTurnIndex: 6 }), [0, 1, 2, 3, 4].map(index => turn(index))],
  ] as const)('rejects inconsistent or unknown execution evidence %#', (state, turns) => {
    expect(() => nextWorkflowStep(snapshot(), state, turns)).toThrow(expect.objectContaining({ code: 'invalid_state' }));
  });
});
