import type { z } from 'zod';
import type { createDemoResultSchema, roomMessageSchema } from '../schemas/app';
import type { RunApiContract } from './run';
import type { RoomManagementApiContract, ProviderSettingsApiContract } from './configuration';
import type { HostCommand, HostCommandResult } from '../schemas/host';
import type { SummaryCommandResult, SummaryConfirmInput, SummaryGenerateInput, SummaryPreview, SummaryPreviewInput } from '../schemas/summary';
import type { ArtifactAdoptInput, ArtifactCommandResult, ArtifactEditInput, ArtifactExportInput, ArtifactExportResult, ArtifactGenerateInput, ArtifactList, ArtifactListInput,
  ArtifactPreview, ArtifactPreviewInput, ArtifactVersionDetail, ArtifactVersionInput, CodeCandidateList } from '../schemas/artifact';
import type { CodeExportChooseRootInput, CodeExportChooseRootResult, CodeExportPreview, CodeExportPreviewInput, CodeExportWriteInput, CodeExportWriteResult } from '../schemas/codeExport';
import type { UsageExportResult, UsageRange, UsageReport } from '../schemas/usage';
import type { NetworkSettings, ProxyEndpoint, ProxySettings, ProxyTestResult } from '../schemas/network';

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
/** D133: token usage: the report and a CSV export saved by Main. */
export interface UsageApiContract {
  /** D117: optional range over when requests were sent; omitted means all. */
  getReport(range?: UsageRange): Promise<UsageReport>;
  exportCsv(range?: UsageRange): Promise<UsageExportResult>;
}
/** R13B conversation summaries: generation is always an explicit host request (D107). */
export interface SummaryApiContract {
  preview(input: SummaryPreviewInput): Promise<SummaryPreview>;
  generate(input: SummaryGenerateInput): Promise<SummaryCommandResult>;
  confirm(input: SummaryConfirmInput): Promise<SummaryCommandResult>;
}
/** R14 structured artifacts: generation is an explicit request; a model's version needs the host's adoption. */
export interface ArtifactApiContract {
  preview(input: ArtifactPreviewInput): Promise<ArtifactPreview>;
  generate(input: ArtifactGenerateInput): Promise<ArtifactCommandResult>;
  list(input: ArtifactListInput): Promise<ArtifactList>;
  getVersion(input: ArtifactVersionInput): Promise<ArtifactVersionDetail>;
  adopt(input: ArtifactAdoptInput): Promise<ArtifactCommandResult>;
  edit(input: ArtifactEditInput): Promise<ArtifactCommandResult>;
  /** Clipboard returns the text to copy; a file is saved by Main to the path the host picks (never for code). */
  export(input: ArtifactExportInput): Promise<ArtifactExportResult>;
  /** D123: validated code candidates for R15; nothing has been written or run. */
  listCodeCandidates(input: ArtifactListInput): Promise<CodeCandidateList>;
}
/**
 * R15: writing an adopted code candidate into a folder. Only Main's dialog chooses the folder; the preview reads and
 * writes nothing; a write touches only the files the host ticked in that preview, each checked again first.
 */
export interface CodeExportApiContract {
  chooseRoot(input: CodeExportChooseRootInput): Promise<CodeExportChooseRootResult>;
  preview(input: CodeExportPreviewInput): Promise<CodeExportPreview>;
  write(input: CodeExportWriteInput): Promise<CodeExportWriteResult>;
}
/** D115: the local proxy settings; saved for the next launch, never applied to this one. */
export interface NetworkApiContract {
  getSettings(): Promise<NetworkSettings>;
  saveSettings(input: ProxySettings): Promise<NetworkSettings>;
  /** One CONNECT handshake to the fixed DeepSeek host through the given loopback proxy; no Key, no request body. */
  testProxy(input: ProxyEndpoint): Promise<ProxyTestResult>;
}
/** D115: restart the app so saved network settings apply; refused while a discussion is running. */
export interface AppLifecycleApiContract {
  relaunch(): Promise<void>;
}
export interface RoundtableApiContract {
  room: RoomApiContract;
  host: HostApiContract;
  summary: SummaryApiContract;
  /** Optional for pages built before R14; Preload always provides it. */
  artifact?: ArtifactApiContract;
  /** Optional for pages built before R15; Preload always provides it. */
  codeExport?: CodeExportApiContract;
  usage: UsageApiContract;
  run: RunApiContract;
  rooms: RoomManagementApiContract;
  settings: ProviderSettingsApiContract;
  /** Optional (D115): Preload always provides them; a page without them hides the network settings. */
  network?: NetworkApiContract;
  app?: AppLifecycleApiContract;
}

export type RunSessionApiContract = Pick<RoundtableApiContract, 'room' | 'run'>;
