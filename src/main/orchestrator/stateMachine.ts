import type { RunCommand, RunStatus, TurnStatus } from '../../shared/types/run';

export type { RunCommand, RunStatus, TurnStatus };

const runTransitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  idle: ['running'],
  running: ['pausing', 'cancelling', 'completed', 'error', 'interrupted'],
  pausing: ['paused', 'cancelling', 'interrupted'],
  paused: ['running', 'cancelling', 'interrupted'],
  cancelling: ['cancelled', 'interrupted'],
  cancelled: ['running'],
  completed: [],
  error: ['running'],
  interrupted: ['running'],
};

const turnTransitions: Readonly<Record<TurnStatus, readonly TurnStatus[]>> = {
  queued: ['running', 'cancelled'],
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed', 'aborted', 'interrupted', 'cancelled'],
  completed: [],
  failed: [],
  aborted: [],
  interrupted: [],
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

/** Command guards are kept beside transitions so UI and services share one policy. */
export function canRunCommand(command: RunCommand, status: RunStatus): boolean {
  switch (command) {
    case 'start':
      return status === 'idle';
    case 'pause':
      return status === 'running';
    case 'stop':
      return status === 'running' || status === 'pausing' || status === 'paused';
    case 'step':
    case 'resumeRun':
      return status === 'paused';
    case 'recoverInterruptedRun':
      return status === 'interrupted';
    case 'retryTurn':
    case 'continueMessage':
      return status === 'error' || status === 'cancelled';
  }
}

export function assertRunCommand(command: RunCommand, status: RunStatus): void {
  if (!canRunCommand(command, status)) {
    throw new Error(`Command ${command} is not allowed while run is ${status}`);
  }
}

export function canRetryTurn(status: TurnStatus): boolean {
  return status === 'failed' || status === 'aborted';
}

export function canContinueMessage(status: TurnStatus): boolean {
  return status === 'aborted' || status === 'failed';
}

export function canRecoverInterruptedRun(status: RunStatus): boolean {
  return status === 'interrupted';
}
