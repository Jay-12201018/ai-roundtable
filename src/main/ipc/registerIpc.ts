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
import type { UsageExportResult, UsageReport } from '../../shared/schemas/usage';

/** R13B: the usage report and the CSV export; the export writes only the file the user picks in Main's dialog. */
export type UsageIpcService = { getReport(): UsageReport; exportCsv(window: BrowserWindow): Promise<UsageExportResult> };
import { isTrustedIpcSender, isTrustedRenderer } from '../windows/createMainWindow';

export type IpcDisposer = (() => void) & { drain(): Promise<void> };
let currentDisposer: IpcDisposer | undefined;

export function registerIpc(window: BrowserWindow, services: { run: RunService; rooms: RoomManagementApiContract; settings: ProviderSettingsApiContract; host: HostApiContract; usage: UsageIpcService }): IpcDisposer {
  const { run: service, rooms, settings, host, usage } = services;
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
    'run.addBudget': (input) => service.addBudget(input),
    'run.resumeAfterBudget': (runId) => service.resumeAfterBudget(runId),
    'usage.getReport': () => usage.getReport(),
    'usage.writeOff': (input) => service.writeOffCharge(input),
    'usage.exportCsv': () => usage.exportCsv(window),
    'summary.preview': (input) => service.previewSummary(input),
    'summary.generate': (input) => service.generateSummary(input),
    'summary.confirm': (input) => service.confirmSummary(input),
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
    'settings.confirmTarget': (input) => settings.confirmTarget(input),
    'settings.setKey': (input) => settings.setKey(input),
    'settings.deleteKey': (input) => settings.deleteKey(input),
    'settings.getProviderKeyState': (input) => settings.getProviderKeyState(input),
    'settings.getKeyStorageStatus': () => settings.getKeyStorageStatus(),
    'settings.listModels': (input) => settings.listModels(input),
    'settings.testConnection': (input) => settings.testConnection(input),
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
      if (channel.startsWith('rooms.') || channel.startsWith('settings.') || channel === 'host.command' || channel === 'run.addBudget'
        || channel === 'usage.writeOff' || channel === 'usage.exportCsv' || channel === 'summary.generate' || channel === 'summary.confirm') {
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
