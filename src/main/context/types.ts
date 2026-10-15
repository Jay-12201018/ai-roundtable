import { z } from 'zod';
import { idSchema, sequenceSchema } from '../../shared/schemas/common';
import { storedRunSchema, requestAttemptSchema } from '../../shared/schemas/persistence';
import type { ProviderMessage } from '../providers/types';

const instructionSchema = z.object({ id: idSchema, content: z.string().min(1) }).strict();
const runSchema = storedRunSchema.pick({
  id: true, roomId: true, task: true, membersSnapshot: true, nextTurnIndex: true,
  elapsedExecutionMs: true, maxTurns: true, maxDurationMs: true, outputTokenLimit: true,
});
const turnSchema = z.object({
  id: idSchema, runId: idSchema, agentId: idSchema, status: z.string(), requestId: idSchema, turnIndex: sequenceSchema,
}).strict();
const messageSchema = z.object({
  id: idSchema, roomId: idSchema, runId: idSchema, turnId: idSchema.optional(),
  senderType: z.string(), senderName: z.string(), content: z.string(), status: z.string().optional(),
}).strict();
const attemptSchema = z.object({
  requestId: requestAttemptSchema.shape.requestId, runId: requestAttemptSchema.shape.runId,
  turnId: requestAttemptSchema.shape.turnId, messageId: requestAttemptSchema.shape.messageId,
  attemptIndex: requestAttemptSchema.shape.attemptIndex, status: requestAttemptSchema.shape.status,
}).strict();
export const contextInputSchema = z.object({
  run: runSchema,
  current: z.object({ agentId: idSchema, turnId: idSchema, requestId: idSchema, turnIndex: sequenceSchema }).strict(),
  snapshot: z.object({ messages: z.array(messageSchema), turns: z.array(turnSchema), attempts: z.array(attemptSchema) }).strict(),
  visibleMessageIds: z.array(idSchema), applicationInstructions: z.array(instructionSchema),
  hostInstructions: z.array(instructionSchema.extend({ roomId: idSchema, runId: idSchema }).strict()),
  contextWindowTokens: sequenceSchema.refine(n => n > 0),
}).strict();
export type ContextInput = z.infer<typeof contextInputSchema>;

/** Main supplies a model-specific count of the entire formatted request, including provider framing. */
export interface ModelTokenCounter {
  modelId: string;
  method: string;
  kind: 'exact' | 'upper_bound';
  countMessages(messages: readonly Readonly<ProviderMessage>[]): number | undefined;
}
export interface ContextSource {
  kind: 'boundary' | 'application' | 'host' | 'agent' | 'task' | 'history';
  runId: string;
  roomId: string;
  sourceId: string;
  providerMessageIndex?: number;
  messageId?: string;
  turnId?: string;
  requestId?: string;
  agentId?: string;
  snapshotIndex?: number;
}
export type HistoryReason = 'selected' | 'duplicate' | 'other_room' | 'other_run' | 'not_visible'
  | 'current_or_future_turn' | 'non_public_sender' | 'message_not_completed' | 'missing_turn'
  | 'turn_not_completed' | 'missing_attempt' | 'attempt_not_completed' | 'superseded_attempt' | 'input_budget' | 'context_rejected';
export interface HistoryDecision {
  messageId: string;
  snapshotIndex: number;
  reason: HistoryReason;
  range: { start: number; end: number; unit: 'utf16_code_units' };
}
export interface ContextReport {
  runId: string;
  roomId: string;
  turnId: string;
  requestId: string;
  limits: { outputTokenLimit: number; maxTurns: number; turnIndex: number; elapsedExecutionMs: number; maxDurationMs: number };
  budget: {
    contextWindowTokens: number;
    reservedOutputTokens: number;
    inputBudgetTokens: number;
    inputTokens: number | null;
    remainingInputTokens: number | null;
    estimatedInputBytes: number;
    measurement: { unit: 'tokens' | 'utf8_bytes'; kind: 'exact' | 'upper_bound' | 'estimate'; method: string; modelId: string };
  };
  sources: ContextSource[];
  history: HistoryDecision[];
}
export type ContextRejection = 'invalid_input' | 'unknown_execution_metadata' | 'invalid_identity'
  | 'token_count_unavailable' | 'invalid_token_count' | 'output_exceeds_window' | 'required_context_exceeds_window';
export type ContextResult = {
  ok: true; messages: ProviderMessage[]; outputTokenLimit: number; selectedHistory: ContextSource[]; report: ContextReport;
} | { ok: false; reason: ContextRejection; report?: ContextReport };
