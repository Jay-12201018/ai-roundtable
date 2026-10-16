import { z } from 'zod';
import * as schemas from '../schemas/configuration';

export type ProviderKind = z.infer<typeof schemas.providerKindSchema>;
export type ProviderBaseUrl = z.infer<typeof schemas.providerBaseUrlSchema>;
export type KeyReference = z.infer<typeof schemas.keyReferenceSchema>;
export type KeyStorageStatus = z.infer<typeof schemas.keyStorageStatusSchema>;
export type ProviderInput = z.input<typeof schemas.providerInputSchema>;
export type CreateProviderInput = z.input<typeof schemas.createProviderInputSchema>;
export type ProviderConfiguration = z.infer<typeof schemas.providerConfigurationSchema>;
export type ProviderSummary = z.infer<typeof schemas.providerSummarySchema>;
export type RoomInput = z.input<typeof schemas.roomInputSchema>;
export type CreateRoomInput = z.input<typeof schemas.createRoomInputSchema>;
export type RoomConfiguration = z.infer<typeof schemas.roomConfigurationSchema>;
export type AgentInput = z.input<typeof schemas.agentInputSchema>;
export type CreateAgentInput = z.input<typeof schemas.createAgentInputSchema>;
export type AgentConfiguration = z.infer<typeof schemas.agentConfigurationSchema>;
export type ConfigurationIdInput = z.input<typeof schemas.configurationIdInputSchema>;
export type ListRoomsInput = z.input<typeof schemas.listRoomsInputSchema>;
export type ListAgentConfigurationsInput = z.input<typeof schemas.listAgentConfigurationsInputSchema>;
export type ArchiveConfigurationInput = z.input<typeof schemas.archiveConfigurationInputSchema>;
export type ReorderAgentsInput = z.input<typeof schemas.reorderAgentsInputSchema>;
export type RoomConfigurations = z.infer<typeof schemas.roomConfigurationsSchema>;
export type AgentConfigurations = z.infer<typeof schemas.agentConfigurationsSchema>;
export type ProviderSummaries = z.infer<typeof schemas.providerSummariesSchema>;
export type ProviderKeyState = z.infer<typeof schemas.providerKeyStateSchema>;
export type ProviderIdInput = z.input<typeof schemas.providerIdInputSchema>;
export type SetProviderKeyInput = z.input<typeof schemas.setProviderKeyInputSchema>;
export type ProviderModelsInput = z.input<typeof schemas.providerModelsInputSchema>;
export type ProviderModelsResult = z.infer<typeof schemas.providerModelsResultSchema>;
export type ProviderConnectionTestInput = z.input<typeof schemas.providerConnectionTestInputSchema>;
export type ProviderConnectionTestResult = z.infer<typeof schemas.providerConnectionTestResultSchema>;
export type RoomMessageCursor = z.infer<typeof schemas.roomMessageCursorSchema>;
export type RoomMessagePageInput = z.input<typeof schemas.roomMessagePageInputSchema>;
export type HistoryMessage = z.infer<typeof schemas.historyMessageSchema>;
export type RoomMessagePage = z.infer<typeof schemas.roomMessagePageSchema>;
export type RoomRunPosition = z.infer<typeof schemas.roomRunPositionSchema>;
export type RoomRunCursor = z.infer<typeof schemas.roomRunCursorSchema>;
export type RoomRunPageInput = z.input<typeof schemas.roomRunPageInputSchema>;
export type RunSummary = z.infer<typeof schemas.runSummarySchema>;
export type RoomRunPage = z.infer<typeof schemas.roomRunPageSchema>;

export interface RoomManagementApiContract {
  createRoom(input: CreateRoomInput): Promise<RoomConfiguration>;
  updateRoom(input: RoomInput): Promise<RoomConfiguration>;
  getRoomConfiguration(input: ConfigurationIdInput): Promise<RoomConfiguration>;
  listRooms(input?: ListRoomsInput): Promise<RoomConfigurations>;
  archiveRoom(input: ArchiveConfigurationInput): Promise<RoomConfiguration>;
  deleteRoom(input: ConfigurationIdInput): Promise<void>;
  createAgent(input: CreateAgentInput): Promise<AgentConfiguration>;
  updateAgent(input: AgentInput): Promise<AgentConfiguration>;
  getAgentConfiguration(input: ConfigurationIdInput): Promise<AgentConfiguration>;
  listAgentConfigurations(input: ListAgentConfigurationsInput): Promise<AgentConfigurations>;
  reorderAgents(input: ReorderAgentsInput): Promise<AgentConfigurations>;
  archiveAgent(input: ArchiveConfigurationInput): Promise<AgentConfiguration>;
  deleteAgent(input: ConfigurationIdInput): Promise<void>;
  listRoomMessages(input: RoomMessagePageInput): Promise<RoomMessagePage>;
  listRoomRuns(input: RoomRunPageInput): Promise<RoomRunPage>;
}

export interface ProviderSettingsApiContract {
  createProvider(input: CreateProviderInput): Promise<ProviderConfiguration>;
  updateProvider(input: ProviderInput): Promise<ProviderConfiguration>;
  getProviderConfiguration(input: ConfigurationIdInput): Promise<ProviderConfiguration>;
  listProviderSummaries(): Promise<ProviderSummaries>;
  deleteProvider(input: ConfigurationIdInput): Promise<void>;
  setKey(input: SetProviderKeyInput): Promise<ProviderKeyState>;
  deleteKey(input: ProviderIdInput): Promise<void>;
  getProviderKeyState(input: ProviderIdInput): Promise<ProviderKeyState>;
  getKeyStorageStatus(): Promise<KeyStorageStatus>;
  listModels(input: ProviderModelsInput): Promise<ProviderModelsResult>;
  testConnection(input: ProviderConnectionTestInput): Promise<ProviderConnectionTestResult>;
}

export interface RoomsFeatureProps {
  api: RoomManagementApiContract;
  providers: readonly ProviderSummary[];
  providerLoadState: 'loading' | 'ready' | 'error';
  onReloadProviders: () => void;
  onSelectRoom: (roomId: string) => void;
  onClearRoom?: () => void;
  initialRoomId?: string;
  onSelectRun: (runId: string) => void;
  onOpenSettings: () => void;
}

export interface SettingsFeatureProps {
  api: ProviderSettingsApiContract;
  onClose: () => void;
}

// Canonical configuration schemas are shared by services, IPC and Preload.
export const roomManagementContracts = {
  createRoom: { input: schemas.createRoomInputSchema, output: schemas.roomConfigurationSchema },
  updateRoom: { input: schemas.roomInputSchema, output: schemas.roomConfigurationSchema },
  getRoomConfiguration: { input: schemas.configurationIdInputSchema, output: schemas.roomConfigurationSchema },
  listRooms: { input: schemas.listRoomsInputSchema.default({ includeArchived: false }), output: schemas.roomConfigurationsSchema },
  archiveRoom: { input: schemas.archiveConfigurationInputSchema, output: schemas.roomConfigurationSchema },
  deleteRoom: { input: schemas.configurationIdInputSchema, output: z.undefined() },
  createAgent: { input: schemas.createAgentInputSchema, output: schemas.agentConfigurationSchema },
  updateAgent: { input: schemas.agentInputSchema, output: schemas.agentConfigurationSchema },
  getAgentConfiguration: { input: schemas.configurationIdInputSchema, output: schemas.agentConfigurationSchema },
  listAgentConfigurations: { input: schemas.listAgentConfigurationsInputSchema, output: schemas.agentConfigurationsSchema },
  reorderAgents: { input: schemas.reorderAgentsInputSchema, output: schemas.agentConfigurationsSchema },
  archiveAgent: { input: schemas.archiveConfigurationInputSchema, output: schemas.agentConfigurationSchema },
  deleteAgent: { input: schemas.configurationIdInputSchema, output: z.undefined() },
  listRoomMessages: { input: schemas.roomMessagePageInputSchema, output: schemas.roomMessagePageSchema },
  listRoomRuns: { input: schemas.roomRunPageInputSchema, output: schemas.roomRunPageSchema },
} as const;
export const providerSettingsContracts = {
  createProvider: { input: schemas.createProviderInputSchema, output: schemas.providerConfigurationSchema },
  updateProvider: { input: schemas.providerInputSchema, output: schemas.providerConfigurationSchema },
  getProviderConfiguration: { input: schemas.configurationIdInputSchema, output: schemas.providerConfigurationSchema },
  listProviderSummaries: { input: z.undefined(), output: schemas.providerSummariesSchema },
  deleteProvider: { input: schemas.configurationIdInputSchema, output: z.undefined() },
  setKey: { input: schemas.setProviderKeyInputSchema, output: schemas.providerKeyStateSchema },
  deleteKey: { input: schemas.providerIdInputSchema, output: z.undefined() },
  getProviderKeyState: { input: schemas.providerIdInputSchema, output: schemas.providerKeyStateSchema },
  getKeyStorageStatus: { input: z.undefined(), output: schemas.keyStorageStatusSchema },
  listModels: { input: schemas.providerModelsInputSchema, output: schemas.providerModelsResultSchema },
  testConnection: { input: schemas.providerConnectionTestInputSchema, output: schemas.providerConnectionTestResultSchema },
} as const;
