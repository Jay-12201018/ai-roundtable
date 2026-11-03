import type {
  InterruptedRunDecision,
  RunEvent,
  RunSnapshot,
  RunSubscription,
} from '../types/run';

export type StartRunInput = import('zod').infer<typeof import('../schemas/run').startRunInputSchema>;

export interface RunApiContract {
  previewWorkflow(input: import('../schemas/workflow').WorkflowPreviewInput): Promise<import('../schemas/workflow').WorkflowPreview>;
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
  /** D111: who would answer a continuation of a finished discussion; sends nothing. */
  previewContinuation(input: import('../schemas/continuation').ContinuationPreviewInput): Promise<import('../schemas/continuation').ContinuationPreview>;
  /** D111: continue a finished discussion in the same Run; idempotent per clientRequestId. */
  continueDiscussion(input: import('../schemas/continuation').ContinueDiscussionInput): Promise<import('../schemas/continuation').ContinueDiscussionResult>;
  onEvent(listener: (event: RunEvent) => void): () => void;
}
