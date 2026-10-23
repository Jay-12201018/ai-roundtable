import { z } from 'zod';
import { idSchema, timestampSchema } from './common';

// Host text is kept verbatim (no trimming); whitespace-only input is rejected.
const hostText = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0, 'Host text cannot be blank');
export const hostMessageContentSchema = hostText(20000);
export const hostInstructionContentSchema = hostText(4000);

export const hostCommandKindValues = ['interject', 'setOverride', 'cancelOverride', 'setInstruction', 'clearInstruction',
  'editMessage', 'regenerateMessage', 'selectVersion', 'abortGeneration'] as const;
export const hostCommandKindSchema = z.enum(hostCommandKindValues);
export const hostActionStatusSchema = z.enum(['applied', 'pending', 'consumed', 'superseded', 'cancelled', 'expired']);

const command = { runId: idSchema, clientRequestId: idSchema };
/** Trusted host commands come only from the typed UI/IPC; model text is never parsed into one. */
export const hostCommandSchema = z.discriminatedUnion('kind', [
  z.object({ ...command, kind: z.literal('interject'), content: hostMessageContentSchema }).strict(),
  z.object({ ...command, kind: z.literal('setOverride'), agentId: idSchema }).strict(),
  z.object({ ...command, kind: z.literal('cancelOverride') }).strict(),
  z.object({ ...command, kind: z.literal('setInstruction'), instructionId: idSchema.optional(), content: hostInstructionContentSchema }).strict(),
  z.object({ ...command, kind: z.literal('clearInstruction'), instructionId: idSchema }).strict(),
  z.object({ ...command, kind: z.literal('editMessage'), messageId: idSchema, content: hostMessageContentSchema }).strict(),
  // D102: `continue` extends a reply cut off by the output limit as a new version instead of starting over.
  z.object({ ...command, kind: z.literal('regenerateMessage'), messageId: idSchema, mode: z.literal('continue').optional() }).strict(),
  z.object({ ...command, kind: z.literal('selectVersion'), messageId: idSchema }).strict(),
  z.object({ ...command, kind: z.literal('abortGeneration') }).strict(),
]);
export const hostCommandResultSchema = z.object({
  runId: idSchema, actionId: idSchema, kind: hostCommandKindSchema, duplicate: z.boolean(),
}).strict();

export const messageVersionOriginSchema = z.enum(['original', 'retry', 'continue', 'regenerate', 'edit']);
export const messageVersionSchema = z.object({
  messageId: idSchema, slotId: idSchema, turnId: idSchema.optional(), author: z.enum(['agent', 'host']),
  parentMessageId: idSchema.optional(), versionNumber: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  origin: messageVersionOriginSchema, active: z.boolean(), requestId: idSchema.optional(), actionId: idSchema.optional(),
  // Basis entries that are no longer active, or are themselves affected; empty means not affected.
  affectedBy: z.array(idSchema).max(4096),
}).strict();
export const hostOverrideSchema = z.object({
  actionId: idSchema, agentId: idSchema, status: hostActionStatusSchema, turnId: idSchema.optional(), createdAt: timestampSchema,
}).strict();
export const hostInstructionSchema = z.object({
  instructionId: idSchema, revisionId: idSchema, revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  content: z.string(), status: z.enum(['active', 'cleared']), updatedAt: timestampSchema,
}).strict();
export const hostActionSchema = z.object({
  actionId: idSchema, kind: hostCommandKindSchema, status: hostActionStatusSchema, createdAt: timestampSchema,
  agentId: idSchema.optional(), messageId: idSchema.optional(), resultMessageId: idSchema.optional(),
  instructionId: idSchema.optional(), turnId: idSchema.optional(),
}).strict();
export const hostStateSchema = z.object({
  override: hostOverrideSchema.optional(),
  instructions: z.array(hostInstructionSchema).max(64),
  actions: z.array(hostActionSchema).max(200),
  generation: z.object({ requestId: idSchema, messageId: idSchema, turnId: idSchema }).strict().optional(),
}).strict().superRefine((state, ctx) => {
  if (state.override && state.override.status !== 'pending'
    || new Set(state.instructions.map(item => item.instructionId)).size !== state.instructions.length
    || new Set(state.actions.map(item => item.actionId)).size !== state.actions.length) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent host state' });
  }
});
export const hostUpdatedPayloadSchema = z.object({ actionId: idSchema, kind: hostCommandKindSchema }).strict();

export type HostCommand = z.infer<typeof hostCommandSchema>;
export type HostCommandKind = z.infer<typeof hostCommandKindSchema>;
export type HostCommandResult = z.infer<typeof hostCommandResultSchema>;
export type HostActionStatus = z.infer<typeof hostActionStatusSchema>;
export type MessageVersion = z.infer<typeof messageVersionSchema>;
export type MessageVersionOrigin = z.infer<typeof messageVersionOriginSchema>;
export type HostState = z.infer<typeof hostStateSchema>;
export type HostInstruction = z.infer<typeof hostInstructionSchema>;
export type HostAction = z.infer<typeof hostActionSchema>;
