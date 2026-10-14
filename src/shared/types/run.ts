import type { z } from 'zod';
import type * as schemas from '../schemas/run';

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

export const messageStatusValues = ['streaming', 'completed', 'failed', 'aborted'] as const;
export type TurnSnapshot = z.infer<typeof schemas.turnSnapshotSchema>;
export type MessageSnapshot = z.infer<typeof schemas.messageSnapshotSchema>;
export type RunSnapshot = z.infer<typeof schemas.runSnapshotSchema>;
export type RunEvent = z.infer<typeof schemas.runEventSchema>;
export type RunSubscription = z.infer<typeof schemas.runSubscriptionSchema>;

export type RunEventType = RunEvent['type'];
export type RunCommand = z.infer<typeof schemas.runCommandSchema>['command'];
export type InterruptedRunDecision = z.infer<typeof schemas.interruptedRunDecisionSchema>;
