// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  type Listener = (...args: any[]) => void;
  class Window {
    listeners = new Map<string, Listener[]>();
    destroyed = false;
    show = vi.fn();
    focus = vi.fn();
    restore = vi.fn();
    hide = vi.fn();
    loadFile = () => fixture.windowLoad();
    loadURL = () => fixture.windowLoad();
    webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn(), isDestroyed: () => this.destroyed, mainFrame: { url: '' } };
    isMinimized = vi.fn(() => false);
    isDestroyed = () => this.destroyed;
    static getAllWindows() { return fixture.windows.filter((window) => !window.destroyed); }
    on(name: string, listener: Listener) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
    }
    close() {
      let prevented = false;
      this.listeners.get('close')?.forEach((listener) => listener({ preventDefault: () => { prevented = true; } }));
      if (!prevented) this.destroy();
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.listeners.get('closed')?.forEach((listener) => listener());
      if (Window.getAllWindows().length === 0) fixture.listeners.get('window-all-closed')?.forEach((listener) => listener());
    }
  }
  return {
    Window,
    listeners: new Map<string, Listener[]>(),
    windows: [] as Window[],
    ready: false,
    resolveReady: () => {},
    app: { requestSingleInstanceLock: vi.fn(), on: vi.fn(), whenReady: vi.fn(), isReady: vi.fn(), isPackaged: true, getName: vi.fn(() => 'ai-roundtable'), setPath: vi.fn(), getPath: vi.fn(), quit: vi.fn(), exit: vi.fn(), relaunch: vi.fn() },
    dialog: { showErrorBox: vi.fn(), showMessageBoxSync: vi.fn() },
    database: { initialize: vi.fn(), purgeKeyLikeModelIds: vi.fn(() => 0), markInFlightRunsInterrupted: vi.fn(), close: vi.fn() },
    service: { shutdown: vi.fn(), hasActiveRuns: vi.fn() },
    rooms: {}, settings: {}, host: {}, keys: { getStatus: async () => ({}) },
    createWindow: vi.fn(),
    windowLoad: vi.fn(),
    registerIpc: vi.fn(),
    unregister: [] as ReturnType<typeof vi.fn>[],
  };
});

vi.mock('electron', () => ({ app: fixture.app, dialog: fixture.dialog, BrowserWindow: fixture.Window, shell: { openExternal: vi.fn() }, nativeTheme: { shouldUseDarkColors: false }, protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() } }));
vi.mock('../../src/main/attachments/AttachmentStore', () => ({ AttachmentStore: vi.fn(function () { return { sweep: vi.fn(), read: vi.fn(), addImage: vi.fn() }; }) }));
vi.mock('../../src/main/database/Database', () => ({ Database: vi.fn(function () { return fixture.database; }) }));
vi.mock('../../src/main/security/electronSafeStorage', () => ({ createElectronKeyBackend: vi.fn() }));
vi.mock('../../src/main/security/KeyService', () => ({ KeyService: vi.fn(function () { return fixture.keys; }) }));
vi.mock('../../src/main/room/RoomService', () => ({ RoomService: vi.fn(function () { return fixture.rooms; }) }));
vi.mock('../../src/main/settings/ProviderSettingsService', () => ({ ProviderSettingsService: vi.fn(function () { return fixture.settings; }) }));
vi.mock('../../src/main/providers/mock/MockProvider', () => ({ MockProvider: vi.fn() }));
vi.mock('../../src/main/services/RunService', () => ({ RunService: vi.fn(function () { return fixture.service; }) }));
vi.mock('../../src/main/host/HostService', () => ({ HostService: vi.fn(function () { return fixture.host; }) }));
vi.mock('../../src/main/windows/createMainWindow', () => ({ createMainWindow: fixture.createWindow }));
vi.mock('../../src/main/ipc/registerIpc', () => ({ registerIpc: fixture.registerIpc }));

function emit(name: string) {
  const event = { preventDefault: vi.fn() };
  fixture.listeners.get(name)?.forEach((listener) => listener(event));
  return event;
}

async function startApp() {
  await import('../../src/main/index');
  fixture.resolveReady();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  fixture.listeners.clear();
  fixture.windows.length = 0;
  fixture.unregister.length = 0;
  fixture.ready = false;
  fixture.app.requestSingleInstanceLock.mockReturnValue(true);
  fixture.app.on.mockImplementation((name, listener) => {
    fixture.listeners.set(name, [...(fixture.listeners.get(name) ?? []), listener]);
  });
  fixture.app.whenReady.mockImplementation(() => new Promise<void>((resolve) => {
    fixture.resolveReady = () => { fixture.ready = true; resolve(); };
  }));
  fixture.app.isReady.mockImplementation(() => fixture.ready);
  fixture.app.getPath.mockReturnValue('/test/userData');
  fixture.app.quit.mockImplementation(() => emit('before-quit'));
  fixture.service.shutdown.mockResolvedValue(undefined);
  fixture.service.hasActiveRuns.mockReturnValue(false);
  fixture.windowLoad.mockResolvedValue(undefined);
  fixture.createWindow.mockImplementation(() => {
    const window = new fixture.Window();
    fixture.windows.push(window);
    return window;
  });
  fixture.registerIpc.mockImplementation(() => {
    const unsubscribe = Object.assign(vi.fn(), { drain: vi.fn(async () => {}) });
    fixture.unregister.push(unsubscribe);
    return unsubscribe;
  });
});

describe('application lifecycle', () => {
  describe('D148: an unpackaged app and the official data folder', () => {
    afterEach(() => { fixture.app.isPackaged = true; fixture.app.getName.mockReturnValue('ai-roundtable'); vi.restoreAllMocks(); });
    const paths = (userData: string) => (name: string) => name === 'appData' ? '/test/appData' : name === 'userData' || name === 'sessionData' ? userData : '/test/other';

    it('refuses before any database, lock or window, and says why', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      fixture.app.isPackaged = false; fixture.app.getName.mockReturnValue('Electron');
      fixture.app.getPath.mockImplementation(paths('/test/appData/ai-roundtable'));
      vi.resetModules(); await import('../../src/main/index');
      expect(fixture.app.exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(error.mock.calls[0][0]).toContain('未打包的应用不能使用正式数据目录（/test/appData/ai-roundtable）');
      const { Database } = await import('../../src/main/database/Database');
      expect(Database).not.toHaveBeenCalled();
      expect(fixture.app.requestSingleInstanceLock).not.toHaveBeenCalled();
      expect(fixture.app.setPath).not.toHaveBeenCalled();
      expect(fixture.createWindow).not.toHaveBeenCalled();
    });

    it('moves a folder nobody set to the development folder before anything opens', async () => {
      fixture.app.isPackaged = false; fixture.app.requestSingleInstanceLock.mockReturnValue(true);
      let userData = '/test/appData/ai-roundtable';
      fixture.app.getPath.mockImplementation((name: string) => paths(userData)(name));
      fixture.app.setPath.mockImplementation((_name: string, value: string) => { userData = value; });
      vi.resetModules(); await import('../../src/main/index');
      expect(fixture.app.setPath).toHaveBeenCalledExactlyOnceWith('userData', '/test/appData/ai-roundtable-dev');
      expect(fixture.app.requestSingleInstanceLock.mock.invocationCallOrder[0]).toBeGreaterThan(fixture.app.setPath.mock.invocationCallOrder[0]);
      expect(fixture.app.exit).not.toHaveBeenCalled();
    });

    it('stops if the app does not really move, rather than carrying on in the official folder', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      fixture.app.isPackaged = false; fixture.app.getPath.mockImplementation(paths('/test/appData/ai-roundtable'));
      vi.resetModules(); await import('../../src/main/index');
      expect(fixture.app.exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(fixture.app.requestSingleInstanceLock).not.toHaveBeenCalled();
    });

    it('a packaged app keeps its folder and is not asked anything else', async () => {
      fixture.app.requestSingleInstanceLock.mockReturnValue(true); fixture.app.getPath.mockImplementation(paths('/test/appData/ai-roundtable'));
      vi.resetModules(); await import('../../src/main/index');
      expect(fixture.app.setPath).not.toHaveBeenCalled(); expect(fixture.app.exit).not.toHaveBeenCalled();
    });
  });

  it('assembles room and settings services with the same database and protected key service', async () => {
    await startApp();
    const { RoomService } = await import('../../src/main/room/RoomService');
    const { ProviderSettingsService } = await import('../../src/main/settings/ProviderSettingsService');
    expect(RoomService).toHaveBeenCalledExactlyOnceWith(fixture.database);
    const { ProviderRegistry } = await import('../../src/main/providers/ProviderRegistry');
    const { RunService } = await import('../../src/main/services/RunService');
    const registry = vi.mocked(ProviderSettingsService).mock.calls[0][2];
    expect(registry).toBeInstanceOf(ProviderRegistry);
    expect(ProviderSettingsService).toHaveBeenCalledExactlyOnceWith(fixture.database, fixture.keys, registry);
    expect(vi.mocked(RunService).mock.calls[0][3]).toBe(registry);
    expect(fixture.registerIpc).toHaveBeenCalledWith(fixture.windows[0], { run: fixture.service, rooms: fixture.rooms, settings: fixture.settings, host: fixture.host, attachments: expect.any(Object),
      usage: { getReport: expect.any(Function), exportCsv: expect.any(Function) },
      artifacts: { list: expect.any(Function), getVersion: expect.any(Function), edit: expect.any(Function), listCodeCandidates: expect.any(Function), export: expect.any(Function) },
      codeExport: { preview: expect.any(Function), write: expect.any(Function), chooseRoot: expect.any(Function) } });
  });

  it('clears key-like model IDs after initialization and before any window or IPC, logging only the count', async () => {
    fixture.database.purgeKeyLikeModelIds.mockReturnValueOnce(3);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await startApp();
    expect(fixture.database.purgeKeyLikeModelIds).toHaveBeenCalledOnce();
    const purged = fixture.database.purgeKeyLikeModelIds.mock.invocationCallOrder[0];
    expect(purged).toBeGreaterThan(fixture.database.initialize.mock.invocationCallOrder[0]);
    expect(purged).toBeLessThan(fixture.createWindow.mock.invocationCallOrder[0]);
    expect(purged).toBeLessThan(fixture.registerIpc.mock.invocationCallOrder[0]);
    expect(info).toHaveBeenCalledExactlyOnceWith('已清除 3 处疑似 API Key 的模型 ID');
  });

  it('waits for current and already closed window configuration writes before closing SQLite', async () => {
    const pending: (() => void)[] = [];
    fixture.registerIpc.mockImplementation(() => {
      const wait = new Promise<void>(resolve => pending.push(resolve));
      const dispose = Object.assign(vi.fn(), { drain: vi.fn(() => wait) });
      fixture.unregister.push(dispose);
      return dispose;
    });
    await startApp();
    fixture.windows[0]!.close(); emit('activate');
    emit('before-quit'); emit('before-quit');
    await vi.waitFor(() => expect(fixture.service.shutdown).toHaveBeenCalledOnce());
    expect(fixture.database.close).not.toHaveBeenCalled();
    pending[1]!();
    await Promise.resolve(); await Promise.resolve();
    expect(fixture.database.close).not.toHaveBeenCalled();
    pending[0]!();
    await vi.waitFor(() => expect(fixture.app.exit).toHaveBeenCalledExactlyOnceWith(0));
    await vi.waitFor(() => expect(fixture.database.close).toHaveBeenCalledOnce());
    fixture.unregister.forEach(dispose => expect(dispose).toHaveBeenCalledOnce());
  });

  it('waits for disk initialization before closing and never opens a window after quit', async () => {
    let finish!: () => void;
    fixture.database.initialize.mockImplementation(() => new Promise<void>(resolve => {finish=resolve;}));
    await startApp();
    emit('before-quit'); emit('before-quit');
    await Promise.resolve();
    expect(fixture.database.close).not.toHaveBeenCalled();
    expect(fixture.createWindow).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(()=>expect(fixture.app.exit).toHaveBeenCalledWith(0));
    await vi.waitFor(() => expect(fixture.database.close).toHaveBeenCalledOnce());
    expect(fixture.database.markInFlightRunsInterrupted).not.toHaveBeenCalled();
    expect(fixture.database.purgeKeyLikeModelIds).not.toHaveBeenCalled();
    expect(fixture.createWindow).not.toHaveBeenCalled();
  });

  it('exits with failure when initialization rejects during shutdown', async () => {
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((_resolve,reject)=>{fail=reject;});
    void pending.catch(()=>{});
    fixture.database.initialize.mockReturnValue(pending);
    const log = vi.spyOn(console,'error').mockImplementation(()=>{});
    try {
      await startApp(); emit('before-quit'); fail(new Error('Backup validation failed'));
      await vi.waitFor(()=>expect(fixture.app.exit).toHaveBeenCalledWith(1));
      await vi.waitFor(() => expect(fixture.database.close).toHaveBeenCalledOnce());
      expect(fixture.createWindow).not.toHaveBeenCalled();
    } finally {log.mockRestore();}
  });

  it('reports database initialization failures and exits instead of leaving a windowless process', async () => {
    fixture.database.initialize.mockImplementation(() => { throw new Error('Migration failed'); });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await startApp();

    expect(fixture.dialog.showErrorBox).toHaveBeenCalledWith('AI 圆桌启动失败', 'Migration failed');
    await vi.waitFor(() => expect(fixture.database.close).toHaveBeenCalled());
    expect(fixture.app.exit).toHaveBeenCalledWith(1);
    expect(fixture.createWindow).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it.each([undefined, 'http://localhost:5173/'])('cleans up after the real window module rejects loading: %s', async (url) => {
    if (url) vi.stubEnv('ELECTRON_RENDERER_URL', url);
    const { createMainWindow } = await vi.importActual<typeof import('../../src/main/windows/createMainWindow')>('../../src/main/windows/createMainWindow');
    fixture.createWindow.mockImplementation(() => {
      const window = createMainWindow();
      fixture.windows.push(window as unknown as InstanceType<typeof fixture.Window>);
      return window;
    });
    fixture.windowLoad.mockRejectedValue(new Error('load failed'));
    await startApp();
    await Promise.resolve();
    expect(fixture.dialog.showErrorBox).toHaveBeenCalledWith('AI 圆桌启动失败', expect.stringContaining('加载'));
    expect(fixture.windows[0]?.hide).toHaveBeenCalledOnce();
    expect(fixture.service.shutdown).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(fixture.database.close).toHaveBeenCalledOnce());
    expect(fixture.unregister[0]).toHaveBeenCalledOnce();
    expect(fixture.app.exit).toHaveBeenCalledWith(0);
  });

  it('finishes quitting even before RunService has initialized', async () => {
    await import('../../src/main/index');

    emit('before-quit');
    await vi.waitFor(() => expect(fixture.app.exit).toHaveBeenCalledWith(0));

    expect(fixture.app.exit).toHaveBeenCalledWith(0);
    expect(fixture.service.shutdown).not.toHaveBeenCalled();
  });

  it('releases IPC when the window closes and binds the reopened window', async () => {
    await startApp();
    const firstWindow = fixture.windows[0]!;

    firstWindow.close();
    emit('activate');

    expect(fixture.unregister[0]).toHaveBeenCalledTimes(1);
    expect(fixture.registerIpc).toHaveBeenLastCalledWith(fixture.windows[1], { run: fixture.service, rooms: fixture.rooms, settings: fixture.settings, host: fixture.host, attachments: expect.any(Object),
      usage: { getReport: expect.any(Function), exportCsv: expect.any(Function) },
      artifacts: { list: expect.any(Function), getVersion: expect.any(Function), edit: expect.any(Function), listCodeCandidates: expect.any(Function), export: expect.any(Function) },
      codeExport: { preview: expect.any(Function), write: expect.any(Function), chooseRoot: expect.any(Function) } });
    expect(fixture.windows[1]?.destroyed).toBe(false);
  });

  it('focuses the existing window on a second instance without creating another window', async () => {
    await startApp();

    emit('second-instance');

    expect(fixture.createWindow).toHaveBeenCalledTimes(1);
    expect(fixture.windows[0]?.restore).not.toHaveBeenCalled();
    expect(fixture.windows[0]?.focus).toHaveBeenCalled();
  });

  it('uses application shutdown when the user confirms closing during generation', async () => {
    await startApp();
    fixture.service.hasActiveRuns.mockReturnValue(true);
    fixture.dialog.showMessageBoxSync.mockReturnValue(1);

    fixture.windows[0]!.close();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.service.shutdown).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(fixture.database.close).toHaveBeenCalledTimes(1));
    expect(fixture.app.exit).toHaveBeenCalledWith(0);
  });

  it('does not show a still-loading window on a second instance', async () => {
    const { createMainWindow } = await vi.importActual<typeof import('../../src/main/windows/createMainWindow')>('../../src/main/windows/createMainWindow');
    fixture.createWindow.mockImplementation(() => {
      const window = createMainWindow();
      fixture.windows.push(window as unknown as InstanceType<typeof fixture.Window>);
      return window;
    });
    let finishLoading!: () => void;
    fixture.windowLoad.mockImplementation(() => new Promise<void>((resolve) => { finishLoading = resolve; }));
    await startApp();
    emit('second-instance');
    expect(fixture.windows[0]?.show).not.toHaveBeenCalled();
    expect(fixture.createWindow).toHaveBeenCalledOnce();
    finishLoading();
    await Promise.resolve();
    expect(fixture.windows[0]?.show).toHaveBeenCalledOnce();
  });

  it('keeps a late successful page load hidden while shutdown is waiting', async () => {
    const { createMainWindow } = await vi.importActual<typeof import('../../src/main/windows/createMainWindow')>('../../src/main/windows/createMainWindow');
    fixture.createWindow.mockImplementation(() => {
      const window = createMainWindow();
      fixture.windows.push(window as unknown as InstanceType<typeof fixture.Window>);
      return window;
    });
    let finishLoading!: () => void;
    let finishShutdown!: () => void;
    fixture.windowLoad.mockImplementation(() => new Promise<void>((resolve) => { finishLoading = resolve; }));
    fixture.service.shutdown.mockImplementation(() => new Promise<void>((resolve) => { finishShutdown = resolve; }));
    await startApp();
    emit('before-quit');
    await vi.waitFor(() => expect(fixture.service.shutdown).toHaveBeenCalledOnce());
    try {
      finishLoading();
      await Promise.resolve();
      expect(fixture.windows[0]?.destroyed).toBe(true);
      expect(fixture.windows[0]?.show).not.toHaveBeenCalled();
      expect(fixture.database.close).not.toHaveBeenCalled();
      expect(fixture.app.exit).not.toHaveBeenCalled();
      expect(fixture.unregister[0]).toHaveBeenCalledOnce();
    } finally {
      finishShutdown();
      await vi.waitFor(() => expect(fixture.app.exit).toHaveBeenCalledWith(0));
    }
  });

  it('restores and focuses a minimized window on a second instance', async () => {
    await startApp();
    fixture.windows[0]!.isMinimized.mockReturnValue(true);
    emit('second-instance');
    expect(fixture.windows[0]?.restore).toHaveBeenCalledOnce();
    expect(fixture.windows[0]?.focus).toHaveBeenCalledOnce();
    expect(fixture.createWindow).toHaveBeenCalledOnce();
  });

  it('keeps the new window and IPC when an old closed callback is delivered again', async () => {
    await startApp();
    const firstWindow = fixture.windows[0]!;
    firstWindow.close();
    emit('activate');
    firstWindow.listeners.get('closed')?.forEach((listener) => listener());
    emit('second-instance');
    expect(fixture.unregister[0]).toHaveBeenCalledOnce();
    expect(fixture.unregister[1]).not.toHaveBeenCalled();
    expect(fixture.windows[1]?.focus).toHaveBeenCalledOnce();
    expect(fixture.createWindow).toHaveBeenCalledTimes(2);
  });

  it.each(['synchronous', 'asynchronous'])('finishes cleanup after a %s shutdown failure', async (failure) => {
    await startApp();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    fixture.service.shutdown.mockImplementation(() => {
      if (failure === 'synchronous') throw new Error('Shutdown failed');
      return Promise.reject(new Error('Shutdown failed'));
    });
    try {
      const first = emit('before-quit');
      const second = emit('before-quit');
      await vi.waitFor(() => expect(fixture.app.exit).toHaveBeenCalledWith(1));
      expect(first.preventDefault).toHaveBeenCalledOnce();
      expect(second.preventDefault).toHaveBeenCalledOnce();
      expect(fixture.service.shutdown).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(fixture.database.close).toHaveBeenCalledOnce());
      expect(fixture.app.exit).toHaveBeenCalledOnce();
      expect(errorLog).toHaveBeenCalled();
    } finally { errorLog.mockRestore(); }
  });

  it.each(['synchronous', 'asynchronous'])('closes SQLite once and exits 1 after a %s Run shutdown failure', async failure => {
    await startApp();
    fixture.service.shutdown.mockImplementation(() => {
      if (failure === 'synchronous') throw new Error('Run cleanup failed');
      return Promise.reject(new Error('Run cleanup failed'));
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const first = emit('before-quit');
      const repeated = emit('before-quit');
      await vi.waitFor(() => expect(fixture.app.exit).toHaveBeenCalledWith(1));
      expect(first.preventDefault).toHaveBeenCalledOnce();
      expect(repeated.preventDefault).toHaveBeenCalledOnce();
    } finally { errorLog.mockRestore(); }
    expect(fixture.service.shutdown).toHaveBeenCalledOnce();
    expect(fixture.database.close).toHaveBeenCalledOnce();
    expect(fixture.app.exit).toHaveBeenCalledOnce();
  });

  it('records a database close failure and still exits once', async () => {
    await startApp();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    fixture.database.close.mockImplementation(() => { throw new Error('Close failed'); });
    try {
      emit('before-quit');
      await vi.waitFor(() => expect(fixture.app.exit).toHaveBeenCalledWith(1));
      emit('before-quit');
      await vi.waitFor(() => expect(fixture.database.close).toHaveBeenCalledOnce());
      expect(fixture.app.exit).toHaveBeenCalledOnce();
      expect(errorLog).toHaveBeenCalled();
    } finally { errorLog.mockRestore(); }
  });

  it('continues cleanup when releasing IPC throws', async () => {
    await startApp();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    fixture.unregister[0]!.mockImplementation(() => { throw new Error('Dispose failed'); });
    try {
      emit('before-quit');
      await vi.waitFor(() => expect(fixture.app.exit).toHaveBeenCalledWith(1));
      expect(fixture.unregister[0]).toHaveBeenCalledOnce();
      expect(fixture.service.shutdown).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(fixture.database.close).toHaveBeenCalledOnce());
      expect(errorLog).toHaveBeenCalled();
    } finally { errorLog.mockRestore(); }
  });

  it('uses the same shutdown barrier when cleanup itself triggers another quit', async () => {
    await startApp();
    fixture.unregister[0]!.mockImplementation(() => emit('before-quit'));
    fixture.service.shutdown.mockImplementation(() => {
      emit('before-quit');
      return Promise.resolve();
    });
    emit('before-quit');
    await vi.waitFor(() => expect(fixture.app.exit).toHaveBeenCalledWith(0));
    expect(fixture.unregister[0]).toHaveBeenCalledOnce();
    expect(fixture.service.shutdown).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(fixture.database.close).toHaveBeenCalledOnce());
    expect(fixture.app.exit).toHaveBeenCalledOnce();
  });

  it('exits safely when creating the initial window fails synchronously', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    fixture.createWindow.mockImplementation(() => { throw new Error('Window failed'); });
    try {
      await startApp();
      await vi.waitFor(() => expect(fixture.app.exit).toHaveBeenCalledWith(1));
      expect(fixture.dialog.showErrorBox).toHaveBeenCalledWith('AI 圆桌启动失败', 'Window failed');
      expect(fixture.service.shutdown).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(fixture.database.close).toHaveBeenCalledOnce());
    } finally { errorLog.mockRestore(); }
  });

  // Shared Main/RunService integration gates: remain ordinary regression tests.
  it('prevents every quit attempt until the same cleanup barrier finishes', async () => {
    await startApp();
    let finish!: () => void;
    fixture.service.shutdown.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = emit('before-quit');
    const second = emit('before-quit');
    await vi.waitFor(() => expect(fixture.service.shutdown).toHaveBeenCalledOnce());
    try {
      expect(first.preventDefault).toHaveBeenCalledOnce();
      expect(second.preventDefault).toHaveBeenCalledOnce();
      expect(fixture.database.close).not.toHaveBeenCalled();
      expect(fixture.app.exit).not.toHaveBeenCalled();
    } finally {
      finish();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(fixture.service.shutdown).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(fixture.database.close).toHaveBeenCalledOnce());
    expect(fixture.app.exit).toHaveBeenCalledOnce();
  });

  it('closes the database only once after an initialization failure', async () => {
    fixture.database.initialize.mockImplementation(() => { throw new Error('Migration failed'); });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await startApp();
      await vi.waitFor(() => expect(fixture.database.close).toHaveBeenCalledOnce());
    } finally { errorLog.mockRestore(); }
  });

  it('does not initialize services when readiness arrives after quit', async () => {
    await import('../../src/main/index');
    emit('before-quit');
    fixture.resolveReady();
    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.database.initialize).not.toHaveBeenCalled();
    expect(fixture.createWindow).not.toHaveBeenCalled();
  });

  it.each(['activate', 'second-instance'])('does not reopen a window during shutdown: %s', async (eventName) => {
    await startApp();
    fixture.windows[0]!.close();
    let finish!: () => void;
    fixture.service.shutdown.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    emit('before-quit');
    emit(eventName);
    await vi.waitFor(() => expect(fixture.service.shutdown).toHaveBeenCalledOnce());
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.createWindow).toHaveBeenCalledOnce();
  });

  it('keeps generation active when the user cancels window close', async () => {
    await startApp();
    fixture.service.hasActiveRuns.mockReturnValue(true);
    fixture.dialog.showMessageBoxSync.mockReturnValue(0);
    fixture.windows[0]!.close();
    expect(fixture.windows[0]!.destroyed).toBe(false);
    expect(fixture.service.shutdown).not.toHaveBeenCalled();
    expect(fixture.database.close).not.toHaveBeenCalled();
  });

  it('reopens and rebinds IPC on a second instance after macOS window close', async () => {
    await startApp();
    fixture.windows[0]!.close();
    emit('second-instance');
    expect(fixture.unregister[0]).toHaveBeenCalledOnce();
    expect(fixture.registerIpc).toHaveBeenLastCalledWith(fixture.windows[1], { run: fixture.service, rooms: fixture.rooms, settings: fixture.settings, host: fixture.host, attachments: expect.any(Object),
      usage: { getReport: expect.any(Function), exportCsv: expect.any(Function) },
      artifacts: { list: expect.any(Function), getVersion: expect.any(Function), edit: expect.any(Function), listCodeCandidates: expect.any(Function), export: expect.any(Function) },
      codeExport: { preview: expect.any(Function), write: expect.any(Function), chooseRoot: expect.any(Function) } });
    expect(fixture.windows.filter((window) => !window.destroyed)).toHaveLength(1);
  });
});

describe('shutdown with real SQLite and MockProvider', () => {
  it('terminates a paused run without changing its saved text', async () => {
    const { Database } = await vi.importActual<typeof import('../../src/main/database/Database')>('../../src/main/database/Database');
    const { RunService } = await vi.importActual<typeof import('../../src/main/services/RunService')>('../../src/main/services/RunService');
    const { MockProvider } = await vi.importActual<typeof import('../../src/main/providers/mock/MockProvider')>('../../src/main/providers/mock/MockProvider');
    const database = new Database(':memory:');
    database.initialize();
    const service = new RunService(database, new MockProvider({ tokenDelayMs: 0 }));
    try {
      const roomId = service.createDemoRoom('shutdown fixture');
      const run = await service.start({ roomId, task: 'fixture task', workflowSnapshot: {}, mode: 'step', maxTurns: 3 });
      await service.waitForIdle(run.runId);
      const before = service.getSnapshot(run.runId);
      expect(before.status).toBe('paused');
      expect(before.messages[0]?.content.length).toBeGreaterThan(0);
      await service.shutdown();
      const after = service.getSnapshot(run.runId);
      expect(after.messages).toEqual(before.messages);
      expect(after.status).toBe('cancelled');
      expect(service.hasActiveRuns()).toBe(false);
    } finally { await service.shutdown(); database.close(); }
  });
});
