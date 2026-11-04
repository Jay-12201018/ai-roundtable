import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { ipcContracts, parseIpcOutput, type IpcChannel, type IpcInput } from '../../shared/contracts/ipc';
import { toPublicError } from '../../shared/contracts/errors';
import { resyncEvent } from '../../shared/contracts/events';
import { PROTOCOL_VERSION } from '../../shared/schemas/common';
import { inputError, publicError } from '../../shared/schemas/error';
import { runEventSchema } from '../../shared/schemas/run';
import type { RoomManagementApiContract, ProviderSettingsApiContract } from '../../shared/contracts/configuration';
import type { RunService } from '../services/RunService';
import type { HostApiContract } from '../../shared/contracts/app';
import type { UsageExportResult, UsageRange, UsageReport } from '../../shared/schemas/usage';
import { ContractError } from '../../shared/contracts/errors';


/** R13B: the usage report and the CSV export; the export writes only the file the user picks in Main's dialog. */
export type UsageIpcService = { getReport(range?: UsageRange): UsageReport; exportCsv(window: BrowserWindow, range?: UsageRange): Promise<UsageExportResult> };
import type { ArtifactService } from '../artifact/ArtifactService';
import type { ArtifactExportInput, ArtifactExportResult } from '../../shared/schemas/artifact';
import type { CodeExportService } from '../export/CodeExportService';
import type { CodeExportChooseRootInput, CodeExportChooseRootResult } from '../../shared/schemas/codeExport';
import { isTrustedIpcSender, isTrustedRenderer } from '../windows/createMainWindow';

/** R14: artifact reads and host writes; a file export asks Main's save dialog, owned by this window. */
export type ArtifactIpcService = Pick<ArtifactService, 'list' | 'getVersion' | 'edit' | 'listCodeCandidates'> & {
  export(window: BrowserWindow, input: ArtifactExportInput): Promise<ArtifactExportResult> };

/** R15: the folder dialog belongs to this window; preview and write are the service's two narrow file operations. */
export type CodeExportIpcService = Pick<CodeExportService, 'preview' | 'write'> & {
  chooseRoot(window: BrowserWindow, input: CodeExportChooseRootInput): Promise<CodeExportChooseRootResult> };

export type IpcDisposer = (() => void) & { drain(): Promise<void> };
let currentDisposer: IpcDisposer | undefined;

export function registerIpc(window: BrowserWindow, services: { run: RunService; rooms: RoomManagementApiContract; settings: ProviderSettingsApiContract; host: HostApiContract; usage: UsageIpcService;
  artifacts?: ArtifactIpcService; codeExport?: CodeExportIpcService }): IpcDisposer {
  const { run: service, rooms, settings, host, usage, artifacts, codeExport } = services;
  const unsupported = (): never => { throw new ContractError('unsupported'); };
  currentDisposer?.();
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  const registered: string[] = [];
  const pendingConfiguration = new Set<Promise<unknown>>();
  const dispose: IpcDisposer = Object.assign(() => {
    if (disposed) return;
    disposed = true;
    try { unsubscribe?.(); }
    finally {
      for (const channel of registered) ipcMain.removeHandler(channel);
      if (currentDisposer === dispose) currentDisposer = undefined;
    }
  }, { drain: async () => { await Promise.allSettled([...pendingConfiguration]); } });
  currentDisposer = dispose;
  const ensureSender = (event: IpcMainInvokeEvent) => {
    if (disposed || !isTrustedIpcSender(window, event)) throw new Error('Unauthorized IPC sender');
  };
  const handlers: { [C in IpcChannel]: (input: IpcInput<C>) => unknown } = {
    'room.createDemo': (objective) => ({ roomId: service.createDemoRoom(objective) }),
    'room.getMessages': (roomId) => service.getMessages(roomId),
    'run.getSnapshot': (runId) => service.getSnapshot(runId),
    'run.subscribe': ({ runId, cursor }) => service.subscribe(runId, cursor),
    'run.previewWorkflow': (input) => service.previewWorkflow(input),
    'run.start': (input) => service.start(input),
    'run.pause': (runId) => service.pause(runId),
    'run.stop': (runId) => service.stop(runId),
    'run.step': (runId) => service.step(runId),
    'run.resumeRun': (runId) => service.resumeRun(runId),
    'run.retryTurn': ({ runId, turnId }) => service.retryTurn(runId, turnId),
    'run.continueMessage': ({ runId, messageId }) => service.continueMessage(runId, messageId),
    'run.recoverInterruptedRun': ({ runId, decision }) => service.recoverInterruptedRun(runId, decision),
    'host.command': (input) => host.command(input),
    'run.previewContinuation': (input) => service.previewContinuation(input),
    'run.continueDiscussion': (input) => service.continueDiscussion(input),
    'usage.getReport': (range) => usage.getReport(range),
    'usage.exportCsv': (range) => usage.exportCsv(window, range),
    'summary.preview': (input) => service.previewSummary(input),
    'summary.generate': (input) => service.generateSummary(input),
    'summary.confirm': (input) => service.confirmSummary(input),
    'summary.revoke': (input) => service.revokeSummary(input),
    'artifact.preview': (input) => service.previewArtifact(input),
    'artifact.generate': (input) => service.generateArtifact(input),
    'artifact.list': (input) => artifacts ? artifacts.list(input) : unsupported(),
    'artifact.getVersion': (input) => artifacts ? artifacts.getVersion(input) : unsupported(),
    'artifact.edit': (input) => artifacts ? artifacts.edit(input) : unsupported(),
    'artifact.export': (input) => artifacts ? artifacts.export(window, input) : unsupported(),
    'artifact.listCodeCandidates': (input) => artifacts ? artifacts.listCodeCandidates(input) : unsupported(),
    'codeExport.chooseRoot': (input) => codeExport ? codeExport.chooseRoot(window, input) : unsupported(),
    'codeExport.preview': (input) => codeExport ? codeExport.preview(input) : unsupported(),
    'codeExport.write': (input) => codeExport ? codeExport.write(input) : unsupported(),
    'rooms.createRoom': (input) => rooms.createRoom(input),
    'rooms.updateRoom': (input) => rooms.updateRoom(input),
    'rooms.getRoomConfiguration': (input) => rooms.getRoomConfiguration(input),
    'rooms.listRooms': (input) => rooms.listRooms(input),
    'rooms.archiveRoom': (input) => rooms.archiveRoom(input),
    'rooms.deleteRoom': (input) => rooms.deleteRoom(input),
    'rooms.createAgent': (input) => rooms.createAgent(input),
    'rooms.updateAgent': (input) => rooms.updateAgent(input),
    'rooms.getAgentConfiguration': (input) => rooms.getAgentConfiguration(input),
    'rooms.listAgentConfigurations': (input) => rooms.listAgentConfigurations(input),
    'rooms.reorderAgents': (input) => rooms.reorderAgents(input),
    'rooms.archiveAgent': (input) => rooms.archiveAgent(input),
    'rooms.deleteAgent': (input) => rooms.deleteAgent(input),
    'rooms.listRoomMessages': (input) => rooms.listRoomMessages(input),
    'rooms.listRoomRuns': (input) => rooms.listRoomRuns(input),
    'settings.createProvider': (input) => settings.createProvider(input),
    'settings.updateProvider': (input) => settings.updateProvider(input),
    'settings.getProviderConfiguration': (input) => settings.getProviderConfiguration(input),
    'settings.listProviderSummaries': () => settings.listProviderSummaries(),
    'settings.deleteProvider': (input) => settings.deleteProvider(input),
    'settings.setKey': (input) => settings.setKey(input),
    'settings.deleteKey': (input) => settings.deleteKey(input),
    'settings.getProviderKeyState': (input) => settings.getProviderKeyState(input),
    'settings.getKeyStorageStatus': () => settings.getKeyStorageStatus(),
    'settings.listModels': (input) => settings.listModels(input),
    'settings.testConnection': (input) => settings.testConnection(input),
    'settings.listModelReadiness': () => settings.listModelReadiness ? settings.listModelReadiness() : unsupported(),
  };
  const register = <C extends IpcChannel>(channel: C) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      ensureSender(event);
      const input = ipcContracts[channel].input.safeParse(args[0]);
      if (args.length !== 1) return { version: PROTOCOL_VERSION, ok: false, error: publicError('invalid_input', 'arguments') };
      if (!input.success) return { version: PROTOCOL_VERSION, ok: false, error: inputError(input.error) };
      const parameters = input.data as IpcInput<C>;
      const operation = (async () => {
        let response;
        try {
          const result = await handlers[channel](parameters);
          response = { version: PROTOCOL_VERSION, ok: true, data: parseIpcOutput(channel, parameters, result) };
        } catch (error) {
          response = { version: PROTOCOL_VERSION, ok: false, error: toPublicError(error) };
        }
        ensureSender(event);
        return response;
      })();
      if (channel.startsWith('rooms.') || channel.startsWith('settings.') || channel === 'host.command' || channel === 'run.continueDiscussion'
        || channel === 'usage.exportCsv' || channel === 'summary.generate' || channel === 'summary.confirm' || channel === 'summary.revoke'
        || channel === 'artifact.generate' || channel === 'artifact.edit' || channel === 'artifact.export' || channel === 'codeExport.write') {
        pendingConfiguration.add(operation);
        void operation.then(() => pendingConfiguration.delete(operation), () => pendingConfiguration.delete(operation));
      }
      return operation;
    });
    registered.push(channel);
  };
  try {
    for (const channel of Object.keys(ipcContracts) as IpcChannel[]) register(channel);
    unsubscribe = service.onEvent((event) => {
      if (disposed || !isTrustedRenderer(window)) return;
      const parsed = runEventSchema.safeParse(event);
      const safeEvent = parsed.success ? parsed.data : resyncEvent(event, 'invalid_event');
      if (safeEvent) window.webContents.send('run.event', safeEvent);
    });
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
