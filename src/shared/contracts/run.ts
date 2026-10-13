import type {
  InterruptedRunDecision,
  RunEvent,
  RunSnapshot,
  RunSubscription,
} from '../types/run';

export interface StartRunInput {
  roomId: string;
  task: string;
  workflowSnapshot: Record<string, unknown>;
  mode?: 'automatic' | 'step';
  maxTurns?: number;
  maxDurationMs?: number;
  outputTokenLimit?: number;
}

export interface RunApiContract {
  getSnapshot(runId: string): Promise<RunSnapshot>;
  subscribe(runId: string, cursor: number): Promise<RunSubscription>;
  start(input: StartRunInput): Promise<RunSnapshot>;
  pause(runId: string): Promise<void>;
  stop(runId: string): Promise<void>;
  step(runId: string): Promise<void>;
  resumeRun(runId: string): Promise<void>;
  retryTurn(runId: string, turnId: string): Promise<void>;
  continueMessage(runId: string, messageId: string): Promise<void>;
  recoverInterruptedRun(runId: string, decision: InterruptedRunDecision): Promise<void>;
  onEvent(listener: (event: RunEvent) => void): () => void;
}
