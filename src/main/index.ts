import { join } from 'node:path';
import { app, dialog, BrowserWindow } from 'electron';
import { Database } from './database/Database';
import { createElectronKeyBackend } from './security/electronSafeStorage';
import { KeyService } from './security/KeyService';
import { MockProvider } from './providers/mock/MockProvider';
import { RunService } from './services/RunService';
import { createMainWindow } from './windows/createMainWindow';
import { registerIpc } from './ipc/registerIpc';
import { createPublicMessagesBuilder } from './context/wirePublicContext';

let database: Database | undefined;
let window: BrowserWindow | undefined;
let unregisterIpc: (() => void) | undefined;
let runService: RunService | undefined;
let shutdownRequested = false;
let shutdownPromise: Promise<void> | undefined;
let shutdownExitCode = 0;
let initializationPromise: Promise<void> | undefined;

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (shutdownRequested) return;
    if (!window || window.isDestroyed()) {
      if (app.isReady() && runService) createAppWindow();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(async () => {
    if (shutdownRequested) return;
    try {
      database = new Database(join(app.getPath('userData'), 'ai-roundtable.db'));
      const pending = database.initialize();
      if (pending) {
        initializationPromise = pending;
        await pending;
      }
      if (shutdownRequested) return;
      database.markInFlightRunsInterrupted();
      const keyService = new KeyService(database, createElectronKeyBackend());
      void keyService.getStatus();
      runService = new RunService(database, new MockProvider({ tokenDelayMs: 60 }),createPublicMessagesBuilder());
      createAppWindow();
      app.on('activate', () => {
        if (!shutdownRequested && BrowserWindow.getAllWindows().length === 0) createAppWindow();
      });
    } catch (error) {
      handleStartupFailure(error);
    }
  }).catch(handleStartupFailure);
  app.on('before-quit', (event) => {
    event.preventDefault();
    requestShutdown();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

function createAppWindow(): void {
  if (shutdownRequested) return;
  try {
    if (!runService) throw new Error('Run service is not initialized');
    disposeCurrentIpc();
    const createdWindow = createMainWindow();
    window = createdWindow;
    const dispose = registerIpc(createdWindow, runService);
    unregisterIpc = dispose;
    createdWindow.on('close', (event) => {
      if (shutdownRequested || !runService || !runService.hasActiveRuns()) return;
      const result = dialog.showMessageBoxSync(createdWindow, { type: 'warning', buttons: ['取消', '退出并停止生成'], defaultId: 0, cancelId: 0, title: '正在生成', message: '仍有任务正在生成，确定退出吗？' });
      event.preventDefault();
      if (result !== 0) app.quit();
    });
    createdWindow.on('closed', () => {
      if (unregisterIpc === dispose) disposeCurrentIpc();
      if (window === createdWindow) window = undefined;
    });
  } catch (error) {
    handleStartupFailure(error);
  }
}

function disposeCurrentIpc(): void {
  const dispose = unregisterIpc;
  unregisterIpc = undefined;
  dispose?.();
}

function requestShutdown(exitCode = 0): void {
  shutdownRequested = true;
  shutdownExitCode = Math.max(shutdownExitCode, exitCode);
  if (shutdownPromise) return;
  // Assign the barrier before calling cleanup, which may synchronously trigger another quit.
  shutdownPromise = Promise.resolve().then(async () => {
    try {
      if (initializationPromise) await initializationPromise;
      await runService?.shutdown();
    } catch (error) {
      shutdownExitCode = 1;
      console.error('AI Roundtable shutdown failed', error);
    } finally {
      const closingDatabase = database;
      database = undefined;
      try {
        closingDatabase?.close();
      } catch (error) {
        shutdownExitCode = 1;
        console.error('AI Roundtable database close failed', error);
      }
      app.exit(shutdownExitCode);
    }
  });
  try {
    disposeCurrentIpc();
  } catch (error) {
    shutdownExitCode = 1;
    console.error('AI Roundtable IPC cleanup failed', error);
  }
  const closingWindow = window;
  window = undefined;
  try {
    if (closingWindow && !closingWindow.isDestroyed()) closingWindow.destroy();
  } catch (error) {
    shutdownExitCode = 1;
    console.error('AI Roundtable window cleanup failed', error);
  }
}

function handleStartupFailure(error: unknown): void {
  if (shutdownRequested) return;
  console.error('AI Roundtable startup failed', error);
  dialog.showErrorBox('AI 圆桌启动失败', error instanceof Error ? error.message : String(error));
  requestShutdown(1);
}
