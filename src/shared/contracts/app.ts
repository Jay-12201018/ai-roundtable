import type { z } from 'zod';
import type { createDemoResultSchema, roomMessageSchema } from '../schemas/app';
import type { RunApiContract } from './run';
import type { RoomManagementApiContract, ProviderSettingsApiContract } from './configuration';

export type RoomMessage = z.infer<typeof roomMessageSchema>;
export type CreateDemoResult = z.infer<typeof createDemoResultSchema>;
export interface RoomApiContract {
  createDemo(objective: string): Promise<CreateDemoResult>;
  getMessages(roomId: string): Promise<RoomMessage[]>;
}
export interface RoundtableApiContract {
  room: RoomApiContract;
  run: RunApiContract;
  rooms: RoomManagementApiContract;
  settings: ProviderSettingsApiContract;
}

export type RunSessionApiContract = Pick<RoundtableApiContract, 'room' | 'run'>;
