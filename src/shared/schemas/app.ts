import { z } from 'zod';
import { idSchema } from './common';
import { messageSnapshotSchema } from './run';

export const createDemoInputSchema = z.string().trim().min(1);
export const createDemoResultSchema = z.object({ roomId: idSchema }).strict();
export const roomMessageSchema = messageSnapshotSchema.extend({
  roomId: idSchema, runId: idSchema, turnId: idSchema.optional(),
  senderType: z.enum(['agent', 'user', 'system']),
}).strict();
export const roomMessagesSchema = z.array(roomMessageSchema);
