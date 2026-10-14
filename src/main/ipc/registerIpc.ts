import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { ipcContracts, parseIpcOutput, type IpcChannel, type IpcInput } from '../../shared/contracts/ipc';
import { toPublicError } from '../../shared/contracts/errors';
import { resyncEvent } from '../../shared/contracts/events';
import { PROTOCOL_VERSION } from '../../shared/schemas/common';
import { inputError, publicError } from '../../shared/schemas/error';
import { runEventSchema } from '../../shared/schemas/run';
import { RunService } from '../services/RunService';
import { isTrustedIpcSender, isTrustedRenderer } from '../windows/createMainWindow';

let currentDisposer: (() => void) | undefined;

export function registerIpc(window: BrowserWindow, service: RunService): () => void {
  currentDisposer?.();
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  const registered: string[] = [];
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try { unsubscribe?.(); }
    finally {
      for (const channel of registered) ipcMain.removeHandler(channel);
      if (currentDisposer === dispose) currentDisposer = undefined;
    }
  };
  currentDisposer = dispose;
  const ensureSender = (event: IpcMainInvokeEvent) => {
    if (disposed || !isTrustedIpcSender(window, event)) throw new Error('Unauthorized IPC sender');
  };
  const handlers: { [C in IpcChannel]: (input: IpcInput<C>) => unknown } = {
    'room.createDemo': (objective) => ({ roomId: service.createDemoRoom(objective) }),
    'room.getMessages': (roomId) => service.getMessages(roomId),
    'run.getSnapshot': (runId) => service.getSnapshot(runId),
    'run.subscribe': ({ runId, cursor }) => service.subscribe(runId, cursor),
    'run.start': (input) => service.start(input),
    'run.pause': (runId) => service.pause(runId),
    'run.stop': (runId) => service.stop(runId),
    'run.step': (runId) => service.step(runId),
    'run.resumeRun': (runId) => service.resumeRun(runId),
    'run.retryTurn': ({ runId, turnId }) => service.retryTurn(runId, turnId),
    'run.continueMessage': ({ runId, messageId }) => service.continueMessage(runId, messageId),
    'run.recoverInterruptedRun': ({ runId, decision }) => service.recoverInterruptedRun(runId, decision),
  };
  const register = <C extends IpcChannel>(channel: C) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      ensureSender(event);
      const input = ipcContracts[channel].input.safeParse(args[0]);
      if (args.length !== 1) return { version: PROTOCOL_VERSION, ok: false, error: publicError('invalid_input', 'arguments') };
      if (!input.success) return { version: PROTOCOL_VERSION, ok: false, error: inputError(input.error) };
      const parameters = input.data as IpcInput<C>;
      return (async () => {
        try {
          const result = await handlers[channel](parameters);
          return { version: PROTOCOL_VERSION, ok: true, data: parseIpcOutput(channel, parameters, result) };
        } catch (error) {
          return { version: PROTOCOL_VERSION, ok: false, error: toPublicError(error) };
        }
      })();
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
