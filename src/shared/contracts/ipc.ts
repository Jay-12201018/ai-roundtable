import { z } from 'zod';
import { workflowPreviewInputSchema, workflowPreviewSchema } from '../schemas/workflow';
import { createDemoInputSchema, createDemoResultSchema, roomMessagesSchema } from '../schemas/app';
import { idSchema, PROTOCOL_VERSION } from '../schemas/common';
import { apiErrorSchema } from '../schemas/error';
import { continueMessageInputSchema, recoveryInputSchema, retryTurnInputSchema, runCursorSchema, runSnapshotSchema, runSubscriptionSchema, startRunInputSchema } from '../schemas/run';
import { ContractError } from './errors';
import { roomManagementContracts, providerSettingsContracts } from './configuration';
import { compareRunPositions } from '../schemas/configuration';
import { hostCommandResultSchema, hostCommandSchema } from '../schemas/host';
import { summaryCommandResultSchema, summaryConfirmInputSchema, summaryGenerateInputSchema, summaryPreviewInputSchema, summaryPreviewSchema } from '../schemas/summary';
import { usageExportResultSchema, usageReportInputSchema, usageReportSchema } from '../schemas/usage';
import { networkSettingsSchema, proxySettingsSchema, proxyTestResultSchema } from '../schemas/network';
import { artifactCommandResultSchema, artifactEditInputSchema, artifactExportInputSchema, artifactExportResultSchema, artifactGenerateInputSchema,
  artifactListInputSchema, artifactListSchema, artifactPreviewInputSchema, artifactPreviewSchema, artifactVersionDetailSchema, artifactVersionInputSchema, codeCandidateListSchema } from '../schemas/artifact';
import { codeExportChooseRootInputSchema, codeExportChooseRootResultSchema, codeExportPreviewInputSchema, codeExportPreviewSchema, codeExportWriteInputSchema,
  codeExportWriteResultSchema } from '../schemas/codeExport';
import { continuationPreviewInputSchema, continuationPreviewSchema, continueDiscussionInputSchema, continueDiscussionResultSchema } from '../schemas/continuation';

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
  'run.previewWorkflow': { input: workflowPreviewInputSchema, output: workflowPreviewSchema },
  'run.start': { input: startRunInputSchema, output: runSnapshotSchema },
  'run.pause': { input: idSchema, output: z.undefined() },
  'run.stop': { input: idSchema, output: z.undefined() },
  'run.step': { input: idSchema, output: z.undefined() },
  'run.resumeRun': { input: idSchema, output: z.undefined() },
  'run.retryTurn': { input: retryTurnInputSchema, output: z.undefined() },
  'run.continueMessage': { input: continueMessageInputSchema, output: z.undefined() },
  'run.recoverInterruptedRun': { input: recoveryInputSchema, output: z.undefined() },
  'host.command': { input: hostCommandSchema, output: hostCommandResultSchema },
  // D111: continue a finished discussion in the same Run; the preview sends and records nothing.
  'run.previewContinuation': { input: continuationPreviewInputSchema, output: continuationPreviewSchema },
  'run.continueDiscussion': { input: continueDiscussionInputSchema, output: continueDiscussionResultSchema },
  'usage.getReport': { input: usageReportInputSchema, output: usageReportSchema },
  'usage.exportCsv': { input: usageReportInputSchema, output: usageExportResultSchema },
  'summary.preview': { input: summaryPreviewInputSchema, output: summaryPreviewSchema },
  'summary.generate': { input: summaryGenerateInputSchema, output: summaryCommandResultSchema },
  'summary.revoke': { input: summaryConfirmInputSchema, output: summaryCommandResultSchema },
  'summary.confirm': { input: summaryConfirmInputSchema, output: summaryCommandResultSchema },
  // R14: structured artifacts. Generation is an explicit request the host clicks; edit/export are trusted host writes.
  'artifact.preview': { input: artifactPreviewInputSchema, output: artifactPreviewSchema },
  'artifact.generate': { input: artifactGenerateInputSchema, output: artifactCommandResultSchema },
  'artifact.list': { input: artifactListInputSchema, output: artifactListSchema },
  'artifact.getVersion': { input: artifactVersionInputSchema, output: artifactVersionDetailSchema },
  'artifact.edit': { input: artifactEditInputSchema, output: artifactCommandResultSchema },
  'artifact.export': { input: artifactExportInputSchema, output: artifactExportResultSchema },
  // D123: the validated code candidates R15 may consume; read-only.
  'artifact.listCodeCandidates': { input: artifactListInputSchema, output: codeCandidateListSchema },
  // R15: writing a code candidate. Main owns the folder dialog; the page holds only a folder reference, asks
  // for a read-only preview against it, then for a write of the files the host ticked in that preview.
  'codeExport.chooseRoot': { input: codeExportChooseRootInputSchema, output: codeExportChooseRootResultSchema },
  'codeExport.preview': { input: codeExportPreviewInputSchema, output: codeExportPreviewSchema },
  'codeExport.write': { input: codeExportWriteInputSchema, output: codeExportWriteResultSchema },
  'rooms.createRoom': roomManagementContracts.createRoom,
  'rooms.updateRoom': roomManagementContracts.updateRoom,
  'rooms.getRoomConfiguration': roomManagementContracts.getRoomConfiguration,
  'rooms.listRooms': roomManagementContracts.listRooms,
  'rooms.archiveRoom': roomManagementContracts.archiveRoom,
  'rooms.deleteRoom': roomManagementContracts.deleteRoom,
  'rooms.createAgent': roomManagementContracts.createAgent,
  'rooms.updateAgent': roomManagementContracts.updateAgent,
  'rooms.getAgentConfiguration': roomManagementContracts.getAgentConfiguration,
  'rooms.listAgentConfigurations': roomManagementContracts.listAgentConfigurations,
  'rooms.reorderAgents': roomManagementContracts.reorderAgents,
  'rooms.archiveAgent': roomManagementContracts.archiveAgent,
  'rooms.deleteAgent': roomManagementContracts.deleteAgent,
  'rooms.listRoomMessages': roomManagementContracts.listRoomMessages,
  'rooms.listRoomRuns': roomManagementContracts.listRoomRuns,
  'settings.createProvider': providerSettingsContracts.createProvider,
  'settings.updateProvider': providerSettingsContracts.updateProvider,
  'settings.getProviderConfiguration': providerSettingsContracts.getProviderConfiguration,
  'settings.listProviderSummaries': providerSettingsContracts.listProviderSummaries,
  'settings.deleteProvider': providerSettingsContracts.deleteProvider,
  'settings.setKey': providerSettingsContracts.setKey,
  'settings.deleteKey': providerSettingsContracts.deleteKey,
  'settings.getProviderKeyState': providerSettingsContracts.getProviderKeyState,
  'settings.getKeyStorageStatus': providerSettingsContracts.getKeyStorageStatus,
  'settings.listModels': providerSettingsContracts.listModels,
  'settings.testConnection': providerSettingsContracts.testConnection,
  // D114: per-model readiness as Main decides it; D115: saved proxy settings, a keyless proxy check and a restart.
  'settings.listModelReadiness': providerSettingsContracts.listModelReadiness,
  'network.getSettings': { input: z.undefined(), output: networkSettingsSchema },
  'network.saveSettings': { input: proxySettingsSchema, output: networkSettingsSchema },
  'network.testProxy': { input: proxySettingsSchema, output: proxyTestResultSchema },
} as const;
export type IpcChannel = keyof typeof ipcContracts;
export type IpcInput<C extends IpcChannel> = z.input<(typeof ipcContracts)[C]['input']>;
export type IpcOutput<C extends IpcChannel> = z.infer<(typeof ipcContracts)[C]['output']>;

export function parseIpcOutput<C extends IpcChannel>(channel: C, input: IpcInput<C>, value: unknown): IpcOutput<C> {
  const parsed = ipcContracts[channel].output.safeParse(value);
  if (!parsed.success) throw new ContractError('invalid_response');
  const data = parsed.data;
  let matches = true;
  if (channel === 'run.getSnapshot') matches = (data as IpcOutput<'run.getSnapshot'>).runId === input;
  if (channel === 'run.previewWorkflow') {
    const preview = data as IpcOutput<'run.previewWorkflow'>;
    const request = input as IpcInput<'run.previewWorkflow'>;
    matches = preview.snapshot.roomId === request.roomId && JSON.stringify(preview.snapshot.config) === JSON.stringify(request.config);
  }
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
  if (channel === 'host.command') {
    const result = data as IpcOutput<'host.command'>;
    const request = input as IpcInput<'host.command'>;
    matches = result.runId === request.runId && result.kind === request.kind;
  }
  if (channel === 'run.continueDiscussion') {
    const result = data as IpcOutput<'run.continueDiscussion'>;
    const request = input as IpcInput<'run.continueDiscussion'>;
    matches = result.runId === request.runId && (request.agentId === undefined || result.agentIds.length === 1 && result.agentIds[0] === request.agentId);
  }
  if (channel === 'run.previewContinuation' || channel === 'summary.preview' || channel === 'summary.generate' || channel === 'summary.confirm' || channel === 'summary.revoke') {
    matches = (data as { runId: string }).runId === (input as { runId: string }).runId;
  }
  if (channel.startsWith('artifact.')) {
    const request = input as { runId: string; versionId?: string; kind?: string; artifactId?: string };
    const result = data as { runId: string; versionId?: string; kind?: string; artifactId?: string; version?: { versionId: string };
      artifacts?: Array<{ runId: string }>; candidates?: Array<{ runId: string }> };
    matches = result.runId === request.runId
      && (channel !== 'artifact.getVersion' || result.version?.versionId === request.versionId)
      && (channel !== 'artifact.export' || result.versionId === request.versionId)
      && (channel !== 'artifact.preview' || result.kind === request.kind)
      && (channel !== 'artifact.generate' || request.artifactId === undefined || result.artifactId === request.artifactId)
      && (result.artifacts ?? result.candidates ?? []).every(item => item.runId === request.runId);
  }
  if (channel.startsWith('codeExport.')) {
    const request = input as { runId: string; versionId?: string; rootId?: string; previewId?: string; files?: Array<{ path: string }> };
    const result = data as { runId: string; versionId: string; root?: { rootId?: string }; previewId?: string; files?: Array<{ path: string }> };
    matches = result.runId === request.runId
      && (request.versionId === undefined || result.versionId === request.versionId)
      && (channel !== 'codeExport.preview' || result.root?.rootId === request.rootId)
      && (channel !== 'codeExport.write' || result.previewId === request.previewId
        && request.files!.every(file => result.files!.some(item => item.path === file.path)));
  }
  if (channel.startsWith('rooms.') || channel.startsWith('settings.')) matches = configurationMatches(channel, input, data);
  if (!matches) throw new ContractError('invalid_response');
  return data as IpcOutput<C>;
}

function configurationMatches(channel: IpcChannel, input: unknown, data: unknown): boolean {
  const request = input as { id?: string; roomId?: string; providerId?: string; level?: string; agentIds?: string[] };
  const entity = data as { id?: string; roomId?: string; providerId?: string; result?: { level: string } };
  if (['rooms.updateRoom','rooms.getRoomConfiguration','rooms.archiveRoom','rooms.updateAgent','rooms.getAgentConfiguration','rooms.archiveAgent','settings.updateProvider','settings.getProviderConfiguration'].includes(channel)
    && entity.id !== request.id) return false;
  if ((channel === 'rooms.createAgent' || channel === 'rooms.updateAgent') && entity.roomId !== request.roomId) return false;
  if (channel === 'rooms.listAgentConfigurations' || channel === 'rooms.reorderAgents') {
    const agents = data as Array<{id:string;roomId:string}>;
    return agents.every(agent => agent.roomId === request.roomId)
      && (channel !== 'rooms.reorderAgents' || agents.length === request.agentIds!.length && agents.every((agent,index) => agent.id === request.agentIds![index]));
  }
  if (['settings.setKey','settings.getProviderKeyState','settings.listModels','settings.testConnection'].includes(channel)
    && entity.providerId !== request.providerId) return false;
  if (channel === 'settings.testConnection' && entity.result?.level !== request.level) return false;
  if (channel === 'rooms.listRoomMessages') {
    const request = input as IpcInput<'rooms.listRoomMessages'>;
    const page = data as IpcOutput<'rooms.listRoomMessages'>;
    return page.items.length <= (request.limit ?? 100) && page.items.every(item => item.roomId === request.roomId
      && (!request.cursor || item.sortKey > request.cursor.afterKey && item.sortKey <= request.cursor.throughKey))
      && (!page.nextCursor || page.nextCursor.roomId === request.roomId && (!request.cursor || page.nextCursor.throughKey === request.cursor.throughKey));
  }
  if (channel === 'rooms.listRoomRuns') {
    const request = input as IpcInput<'rooms.listRoomRuns'>;
    const page = data as IpcOutput<'rooms.listRoomRuns'>;
    return page.items.length <= (request.limit ?? 100) && page.items.every(item => item.roomId === request.roomId
      && (!request.cursor || compareRunPositions(item,request.cursor.after) > 0 && compareRunPositions(item,request.cursor.through) <= 0))
      && (!page.nextCursor || page.nextCursor.roomId === request.roomId && (!request.cursor
        || page.nextCursor.throughRowId === request.cursor.throughRowId && compareRunPositions(page.nextCursor.through,request.cursor.through) === 0));
  }
  return true;
}
