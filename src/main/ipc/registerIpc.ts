import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { StartRunInput } from '../../shared/contracts/run';
import { RunService } from '../services/RunService';
import { isTrustedIpcSender, isTrustedRenderer } from '../windows/createMainWindow';

const idSchema = z.string().min(1);
const cursorSchema = z.object({ runId: idSchema, cursor: z.number().int().nonnegative() }).strict();
const startSchema = z.object({ roomId: idSchema, task: z.string().min(1), workflowSnapshot: z.record(z.string(), z.unknown()), mode: z.enum(['automatic', 'step']).optional(), maxTurns: z.number().int().positive().optional(), maxDurationMs: z.number().int().positive().optional(), outputTokenLimit: z.number().int().positive().optional() }).strict();
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
  const handlers: Array<[string, (...args: any[]) => unknown]> = [
    ['room.createDemo', (event, objective: unknown) => { ensureSender(event); const value = z.string().trim().min(1).parse(objective); return { roomId: service.createDemoRoom(value) }; }],
    ['room.getMessages', (event, roomId: unknown) => { ensureSender(event); return service.getMessages(idSchema.parse(roomId)); }],
    ['run.getSnapshot', (event, runId: unknown) => { ensureSender(event); return service.getSnapshot(idSchema.parse(runId)); }],
    ['run.subscribe', (event, input: unknown) => { ensureSender(event); const parsed = cursorSchema.parse(input); return service.subscribe(parsed.runId, parsed.cursor); }],
    ['run.start', (event, input: unknown) => { ensureSender(event); return service.start(startSchema.parse(input) as StartRunInput); }],
    ['run.pause', (event, runId: unknown) => { ensureSender(event); service.pause(idSchema.parse(runId)); }],
    ['run.stop', async (event, runId: unknown) => { ensureSender(event); await service.stop(idSchema.parse(runId)); }],
    ['run.step', async (event, runId: unknown) => { ensureSender(event); await service.step(idSchema.parse(runId)); }],
    ['run.resumeRun', async (event, runId: unknown) => { ensureSender(event); await service.resumeRun(idSchema.parse(runId)); }],
    ['run.retryTurn', async (event, input: unknown) => { ensureSender(event); const parsed = z.object({ runId: idSchema, turnId: idSchema }).parse(input); await service.retryTurn(parsed.runId, parsed.turnId); }],
    ['run.continueMessage', async (event, input: unknown) => { ensureSender(event); const parsed = z.object({ runId: idSchema, messageId: idSchema }).parse(input); await service.continueMessage(parsed.runId, parsed.messageId); }],
    ['run.recoverInterruptedRun', async (event, input: unknown) => { ensureSender(event); const parsed = z.object({ runId: idSchema, decision: z.enum(['inspect', 'retry', 'discard']) }).parse(input); await service.recoverInterruptedRun(parsed.runId, parsed.decision); }],
  ];
  try {
    for (const [channel, handler] of handlers) {
      ipcMain.handle(channel, handler);
      registered.push(channel);
    }
    unsubscribe = service.onEvent((event) => {
      if (!disposed && isTrustedRenderer(window)) window.webContents.send('run.event', event);
    });
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
