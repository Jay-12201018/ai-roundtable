import { contextBridge, ipcRenderer } from 'electron';
import type { RoundtableApiContract } from '../shared/contracts/app';
import { ipcContracts, ipcResponseSchema, parseIpcOutput, type IpcChannel, type IpcInput, type IpcOutput } from '../shared/contracts/ipc';
import { ContractError } from '../shared/contracts/errors';
import { resyncEvent } from '../shared/contracts/events';
import { PROTOCOL_VERSION } from '../shared/schemas/common';
import { inputError } from '../shared/schemas/error';
import { runEventSchema } from '../shared/schemas/run';
import type { RunSnapshot } from '../shared/types/run';

const knownRuns = new Map<string, number>();
async function invoke<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutput<C>> {
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
}

const api: RoundtableApiContract = {
  room: {
    createDemo: (objective) => invoke('room.createDemo', objective),
    getMessages: (roomId) => invoke('room.getMessages', roomId),
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
