import { z } from 'zod';
import { idSchema, sequenceSchema } from './common';

/**
 * D149: 群聊. A group-chat Run is marked by its workflow snapshot; it has no plan of steps. Each host message opens a round, and
 * the program decides who speaks: by rule where it can, by one small model request where it cannot.
 */
export const GROUP_CHAT_TEMPLATE_ID = 'group-chat';
export const groupChatWorkflowSnapshot = { templateId: GROUP_CHAT_TEMPLATE_ID, version: 1 } as const;
export const isGroupChatSnapshot = (value: unknown) => typeof value === 'object' && value !== null && (value as { templateId?: unknown }).templateId === GROUP_CHAT_TEMPLATE_ID;

/** D151: one host message gets at most this many member replies, however they came about. */
export const GROUP_CHAT_MAX_TURNS = 12;
/** D150: one host message gets at most this many scheduling requests. */
export const GROUP_CHAT_MAX_SCHEDULES = 3;
export const GROUP_CHAT_SCHEDULE_MAX_TOKENS = 400;
export const GROUP_CHAT_SCHEDULE_TIMEOUT_MS = 20_000;
export const GROUP_CHAT_SCHEDULE_MESSAGES = 6;
export const GROUP_CHAT_SCHEDULE_MESSAGE_CHARS = 400;

export const groupChatIntentValues = ['reply', 'claim', 'report', 'challenge', 'propose_merge', 'summarize'] as const;
export const groupChatLengthValues = ['short', 'medium', 'long'] as const;
export const groupChatClassificationValues = ['mention', 'gather', 'simple', 'open'] as const;
export const groupChatRoundStateValues = ['open', 'done', 'superseded', 'stopped', 'limit'] as const;
/** Where a place in the queue came from. Only `mention` and `gather` come from the host's own words; `hint` is a member's @, which is only a suggestion. */
export const groupChatSpeakerSourceValues = ['mention', 'gather', 'rule', 'schedule', 'hint'] as const;
export const groupChatSpeakerStateValues = ['queued', 'started', 'dropped'] as const;
export const groupChatScheduleStatusValues = ['generating', 'completed', 'invalid', 'failed', 'aborted', 'interrupted'] as const;

export const groupChatIntentSchema = z.enum(groupChatIntentValues);
export const groupChatLengthSchema = z.enum(groupChatLengthValues);
export type GroupChatIntent = z.infer<typeof groupChatIntentSchema>;
export type GroupChatLength = z.infer<typeof groupChatLengthSchema>;
export type GroupChatClassification = (typeof groupChatClassificationValues)[number];
export type GroupChatRoundState = (typeof groupChatRoundStateValues)[number];
export type GroupChatSpeakerSource = (typeof groupChatSpeakerSourceValues)[number];
export type GroupChatSpeakerState = (typeof groupChatSpeakerStateValues)[number];
export type GroupChatScheduleStatus = (typeof groupChatScheduleStatusValues)[number];

/** What the scheduling model may answer. Names are checked against the roster afterwards; anything else is thrown away whole. */
export const groupChatScheduleOutputSchema = z.object({
  speakers: z.array(z.object({ name: z.string().min(1).max(64), intent: groupChatIntentSchema, length: groupChatLengthSchema }).strict()).max(8),
  /** Whether someone may still want to speak after these; absent means no. */
  more: z.boolean().optional(),
}).strict();

/** The current round as the page shows it. Main decides; this only says what it decided. */
export const groupChatStateSchema = z.object({
  round: z.object({
    roundId: idSchema, classification: z.enum(groupChatClassificationValues), state: z.enum(groupChatRoundStateValues),
    turnsUsed: sequenceSchema, scheduleCalls: sequenceSchema, scheduling: z.boolean(),
    /** Who is still to speak, in order. */
    queue: z.array(z.object({ agentId: idSchema, intent: groupChatIntentSchema, length: groupChatLengthSchema, source: z.enum(groupChatSpeakerSourceValues) }).strict()).max(64),
  }).strict().optional(),
  /** Every scheduling request of this Run, so each usage row of kind `schedule` names a request. */
  scheduleRequestIds: z.array(idSchema).max(100000),
}).strict();
export type GroupChatState = z.infer<typeof groupChatStateSchema>;
