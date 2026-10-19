import { z } from 'zod';
import { ContractError } from '../../shared/contracts/errors';
import { executionMetadataSchema } from '../../shared/schemas/persistence';
import { idSchema, sequenceSchema } from '../../shared/schemas/common';
import { runStatusValues, turnStatusValues } from '../../shared/types/run';
import type { StoredRun } from '../../shared/schemas/persistence';
import type { TurnRecord } from '../database/Database';
import { readWorkflowSnapshot } from './compiler';
import type { WorkflowStep } from './definition';

export type WorkflowExecution = Pick<StoredRun, 'status' | 'nextTurnIndex' | 'elapsedExecutionMs' | 'maxTurns' | 'maxDurationMs' | 'outputTokenLimit'>;
export type WorkflowTurn = Pick<TurnRecord, 'turnIndex' | 'agentId' | 'status'>;
export type WorkflowDecision = { kind: 'next'; step: WorkflowStep; outputTokenLimit: number }
  | { kind: 'complete' } | { kind: 'limit'; reason: 'max_turns' | 'max_duration' }
  | { kind: 'blocked'; reason: 'run_state' | 'unsettled_turn' };

const executionSchema = executionMetadataSchema.pick({ nextTurnIndex: true, elapsedExecutionMs: true, maxTurns: true, maxDurationMs: true, outputTokenLimit: true })
  .extend({ status: z.enum(runStatusValues) });
const turnsSchema = z.array(z.object({ turnIndex: sequenceSchema, agentId: idSchema, status: z.enum(turnStatusValues) }));

/** A plan query, not permission to send: R04 retains commands, locks, aborts and atomic writes. */
export function nextWorkflowStep(input: unknown, execution: WorkflowExecution, evidence: readonly WorkflowTurn[]): WorkflowDecision {
  const snapshot = readWorkflowSnapshot(input);
  const { status: runStatus, nextTurnIndex, elapsedExecutionMs, maxTurns, maxDurationMs, outputTokenLimit } = execution;
  const parsed = executionSchema.safeParse({ status: runStatus, nextTurnIndex, elapsedExecutionMs, maxTurns, maxDurationMs, outputTokenLimit });
  const turns = turnsSchema.safeParse(evidence);
  if (!parsed.success || !turns.success) throw new ContractError('invalid_state');
  const { nextTurnIndex: cursor, elapsedExecutionMs: elapsed, status } = parsed.data;
  if (cursor === null || elapsed === null || cursor > snapshot.steps.length || cursor !== turns.data.length) throw new ContractError('invalid_state');
  const ordered = turns.data.sort((a, b) => a.turnIndex - b.turnIndex);
  if (ordered.some((turn, index) => turn.turnIndex !== index || turn.agentId !== snapshot.steps[index].agentId
    || index < cursor - 1 && turn.status !== 'completed')) throw new ContractError('invalid_state');
  if (status !== 'running' && status !== 'paused' && status !== 'idle') return { kind: 'blocked', reason: 'run_state' };
  if (ordered.some(turn => turn.status !== 'completed')) return { kind: 'blocked', reason: 'unsettled_turn' };
  if (cursor === snapshot.steps.length) return { kind: 'complete' };
  if (elapsed >= Math.min(snapshot.config.limits.maxDurationMs, execution.maxDurationMs)) return { kind: 'limit', reason: 'max_duration' };
  if (cursor >= Math.min(snapshot.config.limits.maxTurns, execution.maxTurns)) return { kind: 'limit', reason: 'max_turns' };
  return { kind: 'next', step: snapshot.steps[cursor], outputTokenLimit: Math.min(snapshot.config.limits.outputTokenLimit, execution.outputTokenLimit) };
}
