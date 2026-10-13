import { z } from 'zod';
import {
  messageStatusValues,
  runEventTypeValues,
  runStatusValues,
  turnStatusValues,
} from '../types/run';

const timestampSchema = z.string().min(1);

export const turnSnapshotSchema = z.object({
  turnId: z.string().min(1),
  runId: z.string().min(1),
  agentId: z.string().min(1),
  status: z.enum(turnStatusValues),
  requestId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  outputText: z.string().optional(),
  startedAt: timestampSchema.optional(),
  completedAt: timestampSchema.optional(),
});

export const messageSnapshotSchema = z.object({
  id: z.string().min(1),
  senderName: z.string().min(1),
  content: z.string(),
  status: z.enum(messageStatusValues),
});

export const runSnapshotSchema = z.object({
  runId: z.string().min(1),
  roomId: z.string().min(1),
  status: z.enum(runStatusValues),
  sequence: z.number().int().nonnegative(),
  workflowSnapshot: z.record(z.string(), z.unknown()),
  currentTurnId: z.string().min(1).optional(),
  activeAgentId: z.string().min(1).optional(),
  turns: z.array(turnSnapshotSchema),
  messages: z.array(messageSnapshotSchema),
  startedAt: timestampSchema.optional(),
  updatedAt: timestampSchema,
});

export const runEventSchema = z.object({
  runId: z.string().min(1),
  turnId: z.string().min(1).optional(),
  sequence: z.number().int().positive(),
  type: z.enum(runEventTypeValues),
  payload: z.unknown(),
  timestamp: timestampSchema,
});

export const runSubscriptionSchema = z.object({
  snapshot: runSnapshotSchema,
  events: z.array(runEventSchema),
  nextCursor: z.number().int().nonnegative(),
  resyncRequired: z.boolean(),
});

export const runCommandSchema = z.discriminatedUnion('command', [
  z.object({
    command: z.literal('start'),
    roomId: z.string().min(1),
    task: z.string().min(1),
    workflowSnapshot: z.record(z.string(), z.unknown()),
    mode: z.enum(['automatic', 'step']).optional(),
    maxTurns: z.number().int().positive().optional(),
    maxDurationMs: z.number().int().positive().optional(),
    outputTokenLimit: z.number().int().positive().optional(),
  }).strict(),
  z.object({ command: z.literal('pause'), runId: z.string().min(1) }).strict(),
  z.object({ command: z.literal('stop'), runId: z.string().min(1) }).strict(),
  z.object({ command: z.literal('step'), runId: z.string().min(1) }).strict(),
  z.object({ command: z.literal('resumeRun'), runId: z.string().min(1) }).strict(),
  z.object({ command: z.literal('retryTurn'), runId: z.string().min(1), turnId: z.string().min(1) }).strict(),
  z.object({ command: z.literal('continueMessage'), runId: z.string().min(1), messageId: z.string().min(1) }).strict(),
  z.object({
    command: z.literal('recoverInterruptedRun'),
    runId: z.string().min(1),
    decision: z.enum(['inspect', 'resume', 'retry', 'discard']),
  }).strict(),
]);

export type RunSnapshotInput = z.input<typeof runSnapshotSchema>;
export type RunEventInput = z.input<typeof runEventSchema>;
