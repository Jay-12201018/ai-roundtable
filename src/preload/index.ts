import { contextBridge, ipcRenderer } from 'electron';
import type { RoundtableApiContract } from '../shared/contracts/app';
import { ipcContracts, ipcResponseSchema, parseIpcOutput, type IpcChannel, type IpcInput, type IpcOutput } from '../shared/contracts/ipc';
import { ContractError, toPublicError } from '../shared/contracts/errors';
import { resyncEvent } from '../shared/contracts/events';
import { PROTOCOL_VERSION } from '../shared/schemas/common';
import { inputError } from '../shared/schemas/error';
import { runEventSchema } from '../shared/schemas/run';
import type { RunSnapshot } from '../shared/types/run';

const knownRuns = new Map<string, number>();
async function invoke<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutput<C>> {
  try {
    const parameters = ipcContracts[channel].input.safeParse(input);
    if (!parameters.success) throw new ContractError('invalid_input', inputError(parameters.error).field);
    let value: unknown;
    try { value = await ipcRenderer.invoke(channel, parameters.data); }
    catch { throw new ContractError('transport_error'); }
    const response = ipcResponseSchema(ipcContracts[channel].output).safeParse(value);
    if (!response.success) throw new ContractError('invalid_response');
    if (!response.data.ok) throw new ContractError(response.data.error.code, response.data.error.field);
    const data = parseIpcOutput(channel, parameters.data as IpcInput<C>, response.data.data);
    if (channel === 'run.start' || channel === 'run.getSnapshot' || channel === 'run.subscribe') {
      const snapshot = channel === 'run.subscribe' ? (data as IpcOutput<'run.subscribe'>).snapshot : data as RunSnapshot;
      knownRuns.set(snapshot.runId, Math.max(snapshot.sequence, knownRuns.get(snapshot.runId) ?? 0));
    }
    return data;
  } catch (error) {
    // Error properties are stripped by contextBridge; plain public DTOs retain the error contract.
    throw toPublicError(error);
  }
}

const api: RoundtableApiContract = {
  room: {
    createDemo: (objective) => invoke('room.createDemo', objective),
    getMessages: (roomId) => invoke('room.getMessages', roomId),
  },
  rooms: {
    createRoom: (input) => invoke('rooms.createRoom', input),
    updateRoom: (input) => invoke('rooms.updateRoom', input),
    getRoomConfiguration: (input) => invoke('rooms.getRoomConfiguration', input),
    listRooms: (input) => invoke('rooms.listRooms', input),
    archiveRoom: (input) => invoke('rooms.archiveRoom', input),
    deleteRoom: (input) => invoke('rooms.deleteRoom', input),
    createAgent: (input) => invoke('rooms.createAgent', input),
    updateAgent: (input) => invoke('rooms.updateAgent', input),
    getAgentConfiguration: (input) => invoke('rooms.getAgentConfiguration', input),
    listAgentConfigurations: (input) => invoke('rooms.listAgentConfigurations', input),
    reorderAgents: (input) => invoke('rooms.reorderAgents', input),
    archiveAgent: (input) => invoke('rooms.archiveAgent', input),
    deleteAgent: (input) => invoke('rooms.deleteAgent', input),
    listRoomMessages: (input) => invoke('rooms.listRoomMessages', input),
    listRoomRuns: (input) => invoke('rooms.listRoomRuns', input),
  },
  settings: {
    createProvider: (input) => invoke('settings.createProvider', input),
    updateProvider: (input) => invoke('settings.updateProvider', input),
    getProviderConfiguration: (input) => invoke('settings.getProviderConfiguration', input),
    listProviderSummaries: () => invoke('settings.listProviderSummaries', undefined),
    deleteProvider: (input) => invoke('settings.deleteProvider', input),
    confirmTarget: (input) => invoke('settings.confirmTarget', input),
    setKey: (input) => invoke('settings.setKey', input),
    deleteKey: (input) => invoke('settings.deleteKey', input),
    getProviderKeyState: (input) => invoke('settings.getProviderKeyState', input),
    getKeyStorageStatus: () => invoke('settings.getKeyStorageStatus', undefined),
    listModels: (input) => invoke('settings.listModels', input),
    testConnection: (input) => invoke('settings.testConnection', input),
  },
  run: {
    getSnapshot: (runId) => invoke('run.getSnapshot', runId),
    subscribe: (runId, cursor) => invoke('run.subscribe', { runId, cursor }),
    start: (input) => invoke('run.start', input),
    pause: (runId) => invoke('run.pause', runId),
    stop: (runId) => invoke('run.stop', runId),
    step: (runId) => invoke('run.step', runId),
    resumeRun: (runId) => invoke('run.resumeRun', runId),
    retryTurn: (runId, turnId) => invoke('run.retryTurn', { runId, turnId }),
    continueMessage: (runId, messageId) => invoke('run.continueMessage', { runId, messageId }),
    recoverInterruptedRun: (runId, decision) => invoke('run.recoverInterruptedRun', { runId, decision }),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const parsed = runEventSchema.safeParse(value);
        if (parsed.success) {
          knownRuns.set(parsed.data.runId, Math.max(parsed.data.sequence, knownRuns.get(parsed.data.runId) ?? 0));
          listener(parsed.data);
          return;
        }
        const version = typeof value === 'object' && value !== null && 'version' in value ? value.version : undefined;
        const reason = version === PROTOCOL_VERSION ? 'invalid_event' : 'incompatible_version';
        // Only known runs can request a refresh; no unvalidated payload reaches the page.
        for (const [runId, sequence] of knownRuns) {
          const event = resyncEvent({ runId, sequence: sequence + 1 }, reason);
          if (event) listener(event);
        }
      };
      ipcRenderer.on('run.event', handler);
      return () => ipcRenderer.removeListener('run.event', handler);
    },
  },
};
contextBridge.exposeInMainWorld('roundtable', api);
export type RoundtableApi = RoundtableApiContract;
