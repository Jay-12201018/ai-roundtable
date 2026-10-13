export const runStatusValues = [
  'idle',
  'running',
  'pausing',
  'paused',
  'cancelling',
  'cancelled',
  'completed',
  'error',
  'interrupted',
] as const;

export type RunStatus = (typeof runStatusValues)[number];

export const turnStatusValues = [
  'queued',
  'pending',
  'running',
  'completed',
  'failed',
  'aborted',
  'interrupted',
  'cancelled',
] as const;

export type TurnStatus = (typeof turnStatusValues)[number];

export const runEventTypeValues = [
  'run_state_changed',
  'turn_started',
  'text_delta',
  'reasoning_summary_delta',
  'usage_updated',
  'turn_completed',
  'turn_aborted',
  'turn_failed',
  'snapshot_required',
] as const;

export type RunEventType = (typeof runEventTypeValues)[number];

export interface TurnSnapshot {
  turnId: string;
  runId: string;
  agentId: string;
  status: TurnStatus;
  requestId?: string;
  messageId?: string;
  outputText?: string;
  startedAt?: string;
  completedAt?: string;
}

export const messageStatusValues = ['streaming', 'completed', 'failed', 'aborted'] as const;

export interface MessageSnapshot {
  id: string;
  senderName: string;
  content: string;
  status: (typeof messageStatusValues)[number];
}

export interface RunSnapshot {
  runId: string;
  roomId: string;
  status: RunStatus;
  sequence: number;
  workflowSnapshot: Record<string, unknown>;
  currentTurnId?: string;
  activeAgentId?: string;
  turns: TurnSnapshot[];
  messages: MessageSnapshot[];
  startedAt?: string;
  updatedAt: string;
}

export interface RunEvent {
  runId: string;
  turnId?: string;
  sequence: number;
  type: RunEventType;
  payload: unknown;
  timestamp: string;
}

export interface RunSubscription {
  snapshot: RunSnapshot;
  events: RunEvent[];
  nextCursor: number;
  resyncRequired: boolean;
}

export type RunCommand =
  | 'start'
  | 'pause'
  | 'stop'
  | 'step'
  | 'resumeRun'
  | 'retryTurn'
  | 'continueMessage'
  | 'recoverInterruptedRun';

export type InterruptedRunDecision = 'inspect' | 'resume' | 'retry' | 'discard';
