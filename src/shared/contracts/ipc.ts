import { z } from 'zod';
import { createDemoInputSchema, createDemoResultSchema, roomMessagesSchema } from '../schemas/app';
import { idSchema, PROTOCOL_VERSION } from '../schemas/common';
import { apiErrorSchema } from '../schemas/error';
import { continueMessageInputSchema, recoveryInputSchema, retryTurnInputSchema, runCursorSchema, runSnapshotSchema, runSubscriptionSchema, startRunInputSchema } from '../schemas/run';
import { ContractError } from './errors';

export function ipcResponseSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('ok', [
    z.object({ version: z.literal(PROTOCOL_VERSION), ok: z.literal(true), data }).strict(),
    z.object({ version: z.literal(PROTOCOL_VERSION), ok: z.literal(false), error: apiErrorSchema }).strict(),
  ]);
}
export const ipcContracts = {
  'room.createDemo': { input: createDemoInputSchema, output: createDemoResultSchema },
  'room.getMessages': { input: idSchema, output: roomMessagesSchema },
  'run.getSnapshot': { input: idSchema, output: runSnapshotSchema },
  'run.subscribe': { input: runCursorSchema, output: runSubscriptionSchema },
  'run.start': { input: startRunInputSchema, output: runSnapshotSchema },
  'run.pause': { input: idSchema, output: z.undefined() },
  'run.stop': { input: idSchema, output: z.undefined() },
  'run.step': { input: idSchema, output: z.undefined() },
  'run.resumeRun': { input: idSchema, output: z.undefined() },
  'run.retryTurn': { input: retryTurnInputSchema, output: z.undefined() },
  'run.continueMessage': { input: continueMessageInputSchema, output: z.undefined() },
  'run.recoverInterruptedRun': { input: recoveryInputSchema, output: z.undefined() },
} as const;
export type IpcChannel = keyof typeof ipcContracts;
export type IpcInput<C extends IpcChannel> = z.infer<(typeof ipcContracts)[C]['input']>;
export type IpcOutput<C extends IpcChannel> = z.infer<(typeof ipcContracts)[C]['output']>;

export function parseIpcOutput<C extends IpcChannel>(channel: C, input: IpcInput<C>, value: unknown): IpcOutput<C> {
  const parsed = ipcContracts[channel].output.safeParse(value);
  if (!parsed.success) throw new ContractError('invalid_response');
  const data = parsed.data;
  let matches = true;
  if (channel === 'run.getSnapshot') matches = (data as IpcOutput<'run.getSnapshot'>).runId === input;
  if (channel === 'run.start') matches = (data as IpcOutput<'run.start'>).roomId === (input as IpcInput<'run.start'>).roomId;
  if (channel === 'room.getMessages') matches = (data as IpcOutput<'room.getMessages'>).every((message) => message.roomId === input);
  if (channel === 'run.subscribe') {
    const subscription = data as IpcOutput<'run.subscribe'>;
    const request = input as IpcInput<'run.subscribe'>;
    const events = subscription.events;
    matches = subscription.snapshot.runId === request.runId && (subscription.resyncRequired
      || request.cursor <= subscription.nextCursor && (request.cursor === subscription.nextCursor ? events.length === 0
        : events[0]?.sequence === request.cursor + 1 && events.at(-1)?.sequence === subscription.nextCursor));
  }
  if (!matches) throw new ContractError('invalid_response');
  return data as IpcOutput<C>;
}
