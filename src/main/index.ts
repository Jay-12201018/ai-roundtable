import { join } from 'node:path';
import { app, dialog, BrowserWindow } from 'electron';
import { Database } from './database/Database';
import { createElectronKeyBackend } from './security/electronSafeStorage';
import { KeyService } from './security/KeyService';
import { MockProvider } from './providers/mock/MockProvider';
import { RunService } from './services/RunService';
import { createMainWindow } from './windows/createMainWindow';
import { registerIpc } from './ipc/registerIpc';

let database: Database | undefined;
let window: BrowserWindow | undefined;
let unregisterIpc: (() => void) | undefined;
let runService: RunService | undefined;
let shutdownRequested = false;
let shutdownStarted = false;

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) {
      if (app.isReady() && runService) createAppWindow();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.whenReady().then(() => {
    try {
      database = new Database(join(app.getPath('userData'), 'ai-roundtable.db'));
      database.initialize();
      database.markInFlightRunsInterrupted();
      const keyService = new KeyService(database, createElectronKeyBackend());
      void keyService.getStatus();
      runService = new RunService(database, new MockProvider({ tokenDelayMs: 60 }));
      createAppWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createAppWindow();
      });
    } catch (error) {
      handleStartupFailure(error);
    }
  }).catch(handleStartupFailure);
  app.on('before-quit', (event) => {
    if (shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    shutdownRequested = true;
    unregisterIpc?.();
    Promise.resolve(runService?.shutdown()).finally(() => {
      database?.close();
      app.exit(0);
    });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

function createAppWindow(): void {
  if (!runService) throw new Error('Run service is not initialized');
  unregisterIpc?.();
  window = createMainWindow();
  unregisterIpc = registerIpc(window, runService);
  window.on('close', (event) => {
    if (shutdownRequested || !runService || !runService.hasActiveRuns()) return;
    const result = dialog.showMessageBoxSync(window!, { type: 'warning', buttons: ['取消', '退出并停止生成'], defaultId: 0, cancelId: 0, title: '正在生成', message: '仍有任务正在生成，确定退出吗？' });
    event.preventDefault();
    if (result !== 0) app.quit();
  });
  window.on('closed', () => {
    unregisterIpc?.();
    unregisterIpc = undefined;
    window = undefined;
  });
}

function handleStartupFailure(error: unknown): void {
  console.error('AI Roundtable startup failed', error);
  dialog.showErrorBox('AI 圆桌启动失败', error instanceof Error ? error.message : String(error));
  database?.close();
  app.quit();
}
