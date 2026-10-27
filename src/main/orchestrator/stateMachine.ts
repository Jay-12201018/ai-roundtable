import type { RunCommand, RunStatus, TurnStatus } from '../../shared/types/run';
import { ContractError } from '../../shared/contracts/errors';

export type { RunCommand, RunStatus, TurnStatus };

const runTransitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  idle: ['running'],
  running: ['pausing', 'paused', 'cancelling', 'completed', 'error', 'interrupted'],
  pausing: ['paused', 'completed', 'error', 'cancelling', 'interrupted'],
  paused: ['running', 'cancelling', 'interrupted'],
  cancelling: ['cancelled', 'interrupted'],
  cancelled: ['running'],
  // D111: a finished discussion continues in the same Run, only through the trusted continueDiscussion command.
  completed: ['running'],
  error: ['running'],
  interrupted: ['running', 'cancelled'],
};

const turnTransitions: Readonly<Record<TurnStatus, readonly TurnStatus[]>> = {
  queued: ['running', 'cancelled'],
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed', 'aborted', 'interrupted', 'cancelled'],
  completed: [],
  failed: ['running'],
  aborted: ['running'],
  interrupted: ['running'],
  cancelled: [],
};

export class InvalidStateTransitionError extends Error {
  constructor(entity: 'run' | 'turn', from: string, to: string) {
    super(`Invalid ${entity} transition: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return runTransitions[from]?.includes(to) ?? false;
}

export function transitionRun(from: RunStatus, to: RunStatus): RunStatus {
  if (!canTransitionRun(from, to)) {
    throw new InvalidStateTransitionError('run', from, to);
  }
  return to;
}

export function canTransitionTurn(from: TurnStatus, to: TurnStatus): boolean {
  return turnTransitions[from]?.includes(to) ?? false;
}

export function transitionTurn(from: TurnStatus, to: TurnStatus): TurnStatus {
  if (!canTransitionTurn(from, to)) {
    throw new InvalidStateTransitionError('turn', from, to);
  }
  return to;
}

/** Reopening an incomplete Turn requires an explicit retry/continue command; old Attempts stay terminal. */
export function canRunCommand(command: RunCommand, status: RunStatus): boolean {
  switch (command) {
    case 'start':
      return status === 'idle';
    case 'pause':
      return status === 'running' || status === 'pausing';
    case 'stop':
      return status === 'running' || status === 'pausing' || status === 'paused' || status === 'cancelling' || status === 'cancelled';
    case 'step':
    case 'resumeRun':
      return status === 'paused';
    case 'recoverInterruptedRun':
      return status === 'interrupted';
    case 'retryTurn':
    case 'continueMessage':
      return status === 'error' || status === 'cancelled' || status === 'interrupted';
  }
}

export function assertRunCommand(command: RunCommand, status: RunStatus): void {
  if (!canRunCommand(command, status)) {
    throw new ContractError('invalid_state');
  }
}

export function canRetryTurn(status: TurnStatus): boolean {
  return status === 'failed' || status === 'aborted' || status === 'interrupted';
}

export function canContinueMessage(status: TurnStatus): boolean {
  return canRetryTurn(status);
}

export function canRecoverInterruptedRun(status: RunStatus): boolean {
  return status === 'interrupted';
}
