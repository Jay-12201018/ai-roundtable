import { z } from 'zod';
import { idSchema, sequenceSchema } from './common';

/**
 * D149: 群聊. A group-chat Run is marked by its workflow snapshot; it has no plan of steps. Each host message opens a round.
 * D160: a small model request reads the message first and says how it relates to the chat, who should answer and how; the program
 * keeps what must not go wrong (a stop, who was @-ed, everyone when everyone is asked, the limits) and falls back to its rules.
 */
export const GROUP_CHAT_TEMPLATE_ID = 'group-chat';
export const groupChatWorkflowSnapshot = { templateId: GROUP_CHAT_TEMPLATE_ID, version: 1 } as const;
export const isGroupChatSnapshot = (value: unknown) => typeof value === 'object' && value !== null && (value as { templateId?: unknown }).templateId === GROUP_CHAT_TEMPLATE_ID;

/** D151: one host message gets at most this many member replies, however they came about. */
export const GROUP_CHAT_MAX_TURNS = 12;
/** D150: one host message gets at most this many scheduling requests. */
export const GROUP_CHAT_MAX_SCHEDULES = 3;
export const GROUP_CHAT_SCHEDULE_MAX_TOKENS = 400;
/** D160: the reading answers in a second or two. When it cannot be reached, the rules take over after this long, and the host is not kept waiting. */
export const GROUP_CHAT_SCHEDULE_TIMEOUT_MS = 10_000;
export const GROUP_CHAT_SCHEDULE_MESSAGES = 6;
export const GROUP_CHAT_SCHEDULE_MESSAGE_CHARS = 400;

export const groupChatIntentValues = ['reply', 'claim', 'report', 'challenge', 'propose_merge', 'summarize'] as const;
export const groupChatLengthValues = ['short', 'medium', 'long'] as const;
export const groupChatClassificationValues = ['mention', 'gather', 'simple', 'open'] as const;
export const groupChatRoundStateValues = ['open', 'done', 'superseded', 'stopped', 'limit'] as const;
/** Where a place in the queue came from. Only `mention` and `gather` come from the host's own words; `hint` is a member's @, which is only a suggestion. */
export const groupChatSpeakerSourceValues = ['mention', 'gather', 'rule', 'schedule', 'hint'] as const;
/** D160: how the host's message relates to what came before, as the scheduling model read it. `resume` picks up what a stop cut off. */
export const groupChatRelationValues = ['new_topic', 'follow_up', 'correction', 'chitchat', 'resume'] as const;
export type GroupChatRelation = (typeof groupChatRelationValues)[number];
export const GROUP_CHAT_NOTE_CHARS = 80;
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

/**
 * What the scheduling model may answer. Names are checked against the roster afterwards; a wrong name, intent or length throws the answer
 * away whole. D160: the reading of the message (`relation`, `topic`) and a note for each speaker (`brief`) are extras: one that is malformed
 * is dropped by itself, and a key nobody asked for is ignored, so a model that says a little too much still gets its speakers heard.
 */
export const groupChatScheduleOutputSchema = z.object({
  relation: z.enum(groupChatRelationValues).optional().catch(undefined),
  topic: z.string().optional().catch(undefined),
  speakers: z.array(z.object({ name: z.string().min(1).max(64), intent: groupChatIntentSchema, length: groupChatLengthSchema, brief: z.string().optional().catch(undefined) })).max(8),
  /** Whether someone may still want to speak after these; absent means no. */
  more: z.boolean().optional().catch(undefined),
});

/** The current round as the page shows it. Main decides; this only says what it decided. */
export const groupChatStateSchema = z.object({
  round: z.object({
    roundId: idSchema, classification: z.enum(groupChatClassificationValues), state: z.enum(groupChatRoundStateValues),
    turnsUsed: sequenceSchema, scheduleCalls: sequenceSchema, scheduling: z.boolean(),
    /** D163: who has answered this message, in order, so the page can say whose turn it was not. */
    spoke: z.array(idSchema).max(64),
    /** D163: a model was asked to read this message and none could; the rules arranged the answers. */
    readFailed: z.boolean(),
    /** Who is still to speak, in order. */
    queue: z.array(z.object({ agentId: idSchema, intent: groupChatIntentSchema, length: groupChatLengthSchema, source: z.enum(groupChatSpeakerSourceValues) }).strict()).max(64),
  }).strict().optional(),
  /** Every scheduling request of this Run, so each usage row of kind `schedule` names a request. */
  scheduleRequestIds: z.array(idSchema).max(100000),
}).strict();
export type GroupChatState = z.infer<typeof groupChatStateSchema>;
