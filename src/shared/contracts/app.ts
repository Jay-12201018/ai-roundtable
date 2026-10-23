import type { z } from 'zod';
import type { createDemoResultSchema, roomMessageSchema } from '../schemas/app';
import type { RunApiContract } from './run';
import type { RoomManagementApiContract, ProviderSettingsApiContract } from './configuration';
import type { HostCommand, HostCommandResult } from '../schemas/host';
import type { WriteOffChargeInput, WriteOffChargeResult } from '../schemas/budget';
import type { SummaryCommandResult, SummaryConfirmInput, SummaryGenerateInput, SummaryPreview, SummaryPreviewInput } from '../schemas/summary';
import type { UsageExportResult, UsageReport } from '../schemas/usage';

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
/** R13B usage ledger: the report, a host write-off of an unknown charge and a CSV export saved by Main. */
export interface UsageApiContract {
  getReport(): Promise<UsageReport>;
  writeOff(input: WriteOffChargeInput): Promise<WriteOffChargeResult>;
  exportCsv(): Promise<UsageExportResult>;
}
/** R13B conversation summaries: generation is always an explicit, budgeted host request (D107). */
export interface SummaryApiContract {
  preview(input: SummaryPreviewInput): Promise<SummaryPreview>;
  generate(input: SummaryGenerateInput): Promise<SummaryCommandResult>;
  confirm(input: SummaryConfirmInput): Promise<SummaryCommandResult>;
}
export interface RoundtableApiContract {
  room: RoomApiContract;
  host: HostApiContract;
  summary: SummaryApiContract;
  usage: UsageApiContract;
  run: RunApiContract;
  rooms: RoomManagementApiContract;
  settings: ProviderSettingsApiContract;
}

export type RunSessionApiContract = Pick<RoundtableApiContract, 'room' | 'run'>;
