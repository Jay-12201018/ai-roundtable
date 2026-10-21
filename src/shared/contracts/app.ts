import type { z } from 'zod';
import type { createDemoResultSchema, roomMessageSchema } from '../schemas/app';
import type { RunApiContract } from './run';
import type { RoomManagementApiContract, ProviderSettingsApiContract } from './configuration';
import type { HostCommand, HostCommandResult } from '../schemas/host';

export type RoomMessage = z.infer<typeof roomMessageSchema>;
export type CreateDemoResult = z.infer<typeof createDemoResultSchema>;
export interface RoomApiContract {
  createDemo(objective: string): Promise<CreateDemoResult>;
  getMessages(roomId: string): Promise<RoomMessage[]>;
}
/** R12 trusted host commands; each is idempotent per (runId, clientRequestId). */
export interface HostApiContract {
  command(input: HostCommand): Promise<HostCommandResult>;
}
export interface RoundtableApiContract {
  room: RoomApiContract;
  host: HostApiContract;
  run: RunApiContract;
  rooms: RoomManagementApiContract;
  settings: ProviderSettingsApiContract;
}

export type RunSessionApiContract = Pick<RoundtableApiContract, 'room' | 'run'>;
