import { join } from 'node:path';
import { app, dialog, BrowserWindow } from 'electron';
import { Database } from './database/Database';
import { createElectronKeyBackend } from './security/electronSafeStorage';
import { KeyService } from './security/KeyService';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { NetworkSettingsService } from './settings/NetworkSettings';
import { deepSeekModelPolicy } from './providers/modelPolicies/deepseek';
export { ProviderRegistry };
import { mockModelBudget } from './providers/mock/tokenBudget';
import { MockProvider } from './providers/mock/MockProvider';
import { RunService } from './services/RunService';
import { HostService } from './host/HostService';
import { createMainWindow } from './windows/createMainWindow';
import { RoomService } from './room/RoomService';
import { ProviderSettingsService } from './settings/ProviderSettingsService';
import { registerIpc, type IpcDisposer } from './ipc/registerIpc';
import { createPublicMessagesBuilder } from './context/wirePublicContext';
import { ControlledTrialService } from './providers/controlledTrial/ControlledTrialService';
export { ControlledTrialService };
export { deepSeekTrialReview } from './providers/controlledTrial/estimate';
import { confirmTrial, installTrialMenu } from './providers/controlledTrial/menu';
import { ContractError } from '../shared/contracts/errors';
import { UsageService } from './usage/UsageService';
// D106: replaceable only by a probe that names itself as a fixture clock before Main starts.
export { settlementClock } from './usage/pricing';

let database: Database | undefined;
let window: BrowserWindow | undefined;
let unregisterIpc: IpcDisposer | undefined;
let ipcCleanup = Promise.resolve();
let roomService: RoomService | undefined;
let settingsService: ProviderSettingsService | undefined;
let runService: RunService | undefined;
let hostService: HostService | undefined;
let usageService: UsageService | undefined;
let networkSettings: NetworkSettingsService | undefined;
let controlledTrial: ControlledTrialService | undefined;
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
      // D096: a key pasted into a model field earlier is cleared before any window or IPC can read it.
      const purged = database.purgeKeyLikeModelIds();
      if (purged) console.info(`已清除 ${purged} 处疑似 API Key 的模型 ID`);
      database.markInFlightRunsInterrupted();
      database.recoverControlledTrials();
      const keyService = new KeyService(database, createElectronKeyBackend());
      void keyService.getStatus();
      roomService = new RoomService(database);
      // D115: the launch-time proxy comes from the environment or, when that is unset, the settings page.
      networkSettings = new NetworkSettingsService(app.getPath('userData'), process.env);
      // R13A: the reviewed DeepSeek direct policy is the only approved real-model policy (D089).
      const providers = new ProviderRegistry(database, keyService, { proxy: networkSettings.proxy, policyResolver: deepSeekModelPolicy });
      settingsService = new ProviderSettingsService(database, keyService, providers);
      const modelBudget = (modelId: string | null, member: { providerId: string | null }) =>
        member.providerId ? providers.budget(member.providerId, modelId!) : modelId === 'mock' ? mockModelBudget : undefined;
      runService = new RunService(database, new MockProvider({ tokenDelayMs: 60 }), createPublicMessagesBuilder(modelBudget), providers,
        () => { if (controlledTrial?.isBusy()) throw new ContractError('invalid_state'); },
        member => { try { return modelBudget(member.modelId, member); } catch { return undefined; } });
      usageService = new UsageService(database);
      hostService = new HostService(database, runService);
      controlledTrial = new ControlledTrialService(database, providers, confirmTrial, () => runService?.hasActiveRuns() ?? true);
      installTrialMenu(database, controlledTrial, () => runService?.hasActiveRuns() ?? true);
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
    if (!runService || !roomService || !settingsService || !hostService || !usageService) throw new Error('Run service is not initialized');
    const usage = usageService;
    disposeCurrentIpc();
    const createdWindow = createMainWindow();
    window = createdWindow;
    const dispose = registerIpc(createdWindow, { run: runService, rooms: roomService, settings: settingsService, host: hostService, usage: {
      getReport: () => usage.getReport(),
      exportCsv: owner => usage.exportCsv(async defaultName => {
        const result = await dialog.showSaveDialog(owner, { title: '导出用量明细', defaultPath: join(app.getPath('documents'), defaultName), filters: [{ name: 'CSV', extensions: ['csv'] }] });
        return result.canceled || !result.filePath ? undefined : result.filePath;
      }),
    }, network: networkSettings, lifecycle: { relaunch: () => {
      // A restart stops nothing silently: refuse while a discussion or the controlled trial is still running.
      if (runService?.hasActiveRuns() || controlledTrial?.isBusy()) throw new ContractError('invalid_state');
      app.relaunch(); app.quit();
    } } });
    unregisterIpc = dispose;
    createdWindow.on('close', (event) => {
      if (shutdownRequested || (!runService?.hasActiveRuns() && !controlledTrial?.isBusy())) return;
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
  if (dispose) {
    try { dispose(); }
    finally {
      // Revoked pages cannot receive results, but their accepted writes must finish before close.
      ipcCleanup = Promise.all([ipcCleanup, dispose.drain()]).then(() => undefined);
    }
  }
}

function requestShutdown(exitCode = 0): void {
  shutdownRequested = true;
  shutdownExitCode = Math.max(shutdownExitCode, exitCode);
  if (shutdownPromise) return;
  // Assign the barrier before calling cleanup, which may synchronously trigger another quit.
  shutdownPromise = Promise.resolve().then(async () => {
    try {
      if (initializationPromise) await initializationPromise;
      try {
        const results = await Promise.allSettled([
          Promise.resolve().then(() => runService?.shutdown()),
          Promise.resolve().then(() => controlledTrial?.shutdown()),
        ]);
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }
      finally { await ipcCleanup; }
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
