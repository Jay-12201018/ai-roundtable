import { contextBridge, ipcRenderer } from 'electron';
import type { RunEvent, RunSnapshot, RunSubscription } from '../shared/types/run';
import type { StartRunInput } from '../shared/contracts/run';

const api = {
  room: {
    createDemo: (objective: string): Promise<{ roomId: string }> => ipcRenderer.invoke('room.createDemo', objective),
    getMessages: (roomId: string) => ipcRenderer.invoke('room.getMessages', roomId),
  },
  run: {
    getSnapshot: (runId: string): Promise<RunSnapshot> => ipcRenderer.invoke('run.getSnapshot', runId),
    subscribe: (runId: string, cursor: number): Promise<RunSubscription> => ipcRenderer.invoke('run.subscribe', { runId, cursor }),
    start: (input: StartRunInput): Promise<RunSnapshot> => ipcRenderer.invoke('run.start', input),
    pause: (runId: string): Promise<void> => ipcRenderer.invoke('run.pause', runId),
    stop: (runId: string): Promise<void> => ipcRenderer.invoke('run.stop', runId),
    step: (runId: string): Promise<void> => ipcRenderer.invoke('run.step', runId),
    resumeRun: (runId: string): Promise<void> => ipcRenderer.invoke('run.resumeRun', runId),
    retryTurn: (runId: string, turnId: string): Promise<void> => ipcRenderer.invoke('run.retryTurn', { runId, turnId }),
    continueMessage: (runId: string, messageId: string): Promise<void> => ipcRenderer.invoke('run.continueMessage', { runId, messageId }),
    recoverInterruptedRun: (runId: string, decision: 'inspect' | 'retry' | 'discard'): Promise<void> => ipcRenderer.invoke('run.recoverInterruptedRun', { runId, decision }),
    onEvent: (listener: (event: RunEvent) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: RunEvent) => listener(payload);
      ipcRenderer.on('run.event', handler);
      return () => ipcRenderer.removeListener('run.event', handler);
    },
  },
};

contextBridge.exposeInMainWorld('roundtable', api);

export type RoundtableApi = typeof api;
