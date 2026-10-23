import { z } from 'zod';
import { idSchema, sequenceSchema, timestampSchema } from './common';
import { streamChatInputSchema } from './provider';
import { turnStatusValues,runStatusValues } from '../types/run';

export const memberSnapshotSchema = z.object({
  agentId: idSchema, displayName: z.string().min(1), roleTemplateId: z.string(), systemPrompt: z.string(),
  providerId: idSchema.nullable(), modelId: idSchema.nullable(), displayOrder: sequenceSchema,
}).strict();
export const executionMetadataSchema = z.object({
  task: z.string().nullable(), membersSnapshot: z.array(memberSnapshotSchema).nullable(),
  nextTurnIndex: sequenceSchema.nullable(), elapsedExecutionMs: sequenceSchema.nullable(),
  mode: z.enum(['automatic', 'step']), maxTurns: sequenceSchema.refine(n => n > 0),
  maxDurationMs: sequenceSchema.refine(n => n > 0), outputTokenLimit: sequenceSchema.refine(n => n > 0),
  currentTurnId: idSchema.nullable(), currentAgentId: idSchema.nullable(),
  startedAt: timestampSchema.nullable(), finishedAt: timestampSchema.nullable(),
  createdAt: timestampSchema, updatedAt: timestampSchema,
}).strict();
// Main-only evidence: legacy JSON/errors are preserved; the public snapshot validates its safe projection separately.
export const storedRunSchema = executionMetadataSchema.extend({
  id:idSchema,roomId:idSchema,status:z.enum(runStatusValues),workflowSnapshot:z.record(z.string(),z.json()),lastError:z.string().nullable(),
}).strict();
const attemptRecordObject = z.object({
  requestId: idSchema, runId: idSchema, turnId: idSchema, messageId: idSchema, attemptIndex: sequenceSchema,
  status: z.enum(turnStatusValues), inputSnapshot: streamChatInputSchema.nullable(),
  providerRequestId: idSchema.nullable(), createdAt: timestampSchema.nullable(), startedAt: timestampSchema.nullable(),
  finishedAt: timestampSchema.nullable(), updatedAt: timestampSchema.nullable(),
  // D102: why a completed request ended; `length` keeps the reply as complete but truncated. Absent before migration 8.
  finishReason: z.enum(['stop', 'length']).nullable().optional(),
}).strict();
export const requestAttemptSchema = attemptRecordObject.refine(a => a.inputSnapshot === null || a.inputSnapshot.requestId === a.requestId, 'Inconsistent attempt identity');
export const createAttemptInputSchema = z.object({
  requestId: idSchema, runId: idSchema, turnId: idSchema, messageId: idSchema, attemptIndex: sequenceSchema,
  status: z.enum(turnStatusValues), inputSnapshot: streamChatInputSchema,
}).strict().refine(a => a.inputSnapshot.requestId === a.requestId, 'Inconsistent attempt identity');
export const attemptSnapshotSchema = attemptRecordObject.omit({ inputSnapshot: true,providerRequestId:true });
export const messageCursorSchema = z.object({ runId: idSchema, sequence: sequenceSchema }).strict();
export const messagePageInputSchema = z.object({ after: messageCursorSchema.optional(), limit: z.number().int().min(1).max(500) }).strict();
export const eventPageInputSchema = z.object({ cursor: sequenceSchema, throughSequence: sequenceSchema, limit: z.number().int().min(1).max(500) }).strict();

export type MemberSnapshot = z.infer<typeof memberSnapshotSchema>;
export type ExecutionMetadata = z.infer<typeof executionMetadataSchema>;
export type StoredRun = z.infer<typeof storedRunSchema>;
export type RequestAttempt = z.infer<typeof requestAttemptSchema>;
export type CreateAttemptInput = z.infer<typeof createAttemptInputSchema>;
export type MessageCursor = z.infer<typeof messageCursorSchema>;
