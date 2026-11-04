import { z } from 'zod';
import { idSchema, sequenceSchema } from '../../shared/schemas/common';
import { storedRunSchema, requestAttemptSchema } from '../../shared/schemas/persistence';
import type { ProviderMessage } from '../providers/types';
import { imageAttachmentsSchema } from '../../shared/schemas/attachment';

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
  senderType: z.string(), senderName: z.string(), content: z.string(), status: z.string().optional(), attachments: imageAttachmentsSchema.optional(),
}).strict();
const attemptSchema = z.object({
  requestId: requestAttemptSchema.shape.requestId, runId: requestAttemptSchema.shape.runId,
  turnId: requestAttemptSchema.shape.turnId, messageId: requestAttemptSchema.shape.messageId,
  attemptIndex: requestAttemptSchema.shape.attemptIndex, status: requestAttemptSchema.shape.status,
  finishReason: z.enum(['stop', 'length']).nullable().optional(),
}).strict();
// R12: when present, exactly one version per slot is effective; absent means the R05 latest-Attempt rule.
const versionSchema = z.object({
  messageId: idSchema, slotId: idSchema, versionNumber: z.number().int().min(1), active: z.boolean(),
  origin: z.enum(['original', 'retry', 'continue', 'regenerate', 'edit']), affected: z.boolean(),
}).strict();
export const contextInputSchema = z.object({
  run: runSchema,
  // `regenerate` rebuilds the input of an existing earlier Turn from history that preceded it.
  current: z.object({ agentId: idSchema, turnId: idSchema, requestId: idSchema, turnIndex: sequenceSchema, mode: z.enum(['new', 'regenerate']).optional() }).strict(),
  snapshot: z.object({ messages: z.array(messageSchema), turns: z.array(turnSchema), attempts: z.array(attemptSchema), versions: z.array(versionSchema).optional() }).strict(),
  visibleMessageIds: z.array(idSchema), applicationInstructions: z.array(instructionSchema),
  hostInstructions: z.array(instructionSchema.extend({ roomId: idSchema, runId: idSchema }).strict()),
  contextWindowTokens: sequenceSchema.refine(n => n > 0),
  // D147: the goal's images, and whether this member's model gets images at all. Without a word on it, it does not.
  taskImages: imageAttachmentsSchema.optional(), imagesVisible: z.boolean().optional(),
  // R13B (D107): a host-confirmed summary that stands in for every version of the slots it covers.
  summary: z.object({
    messageId: idSchema, content: z.string().min(1), firstNumber: z.number().int().min(1), lastNumber: z.number().int().min(1),
    coveredMessageIds: z.array(idSchema).max(65536), editedByHost: z.boolean(), affected: z.boolean(),
    // D109: covered messages revised after the summary; they are sent themselves, as required context, with a note.
    revisedMessageIds: z.array(idSchema).max(4096).optional(),
  }).strict().optional(),
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
  kind: 'boundary' | 'application' | 'host' | 'agent' | 'task' | 'history' | 'summary';
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
  | 'turn_not_completed' | 'missing_attempt' | 'attempt_not_completed' | 'superseded_attempt' | 'inactive_version' | 'input_budget' | 'context_rejected'
  | 'summarized';
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
