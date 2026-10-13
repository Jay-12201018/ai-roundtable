// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      if (!prevented) {
        this.destroyed = true;
        this.listeners.get('closed')?.forEach((listener) => listener());
      }
    }
  }
  return {
    Window,
    listeners: new Map<string, Listener[]>(),
    windows: [] as Window[],
    ready: false,
    resolveReady: () => {},
    app: { requestSingleInstanceLock: vi.fn(), on: vi.fn(), whenReady: vi.fn(), isReady: vi.fn(), getPath: vi.fn(), quit: vi.fn(), exit: vi.fn() },
    dialog: { showErrorBox: vi.fn(), showMessageBoxSync: vi.fn() },
    database: { initialize: vi.fn(), markInFlightRunsInterrupted: vi.fn(), close: vi.fn() },
    service: { shutdown: vi.fn(), hasActiveRuns: vi.fn() },
    createWindow: vi.fn(),
    windowLoad: vi.fn(),
    registerIpc: vi.fn(),
    unregister: [] as ReturnType<typeof vi.fn>[],
  };
});

vi.mock('electron', () => ({ app: fixture.app, dialog: fixture.dialog, BrowserWindow: fixture.Window, shell: { openExternal: vi.fn() } }));
vi.mock('../../src/main/database/Database', () => ({ Database: vi.fn(function () { return fixture.database; }) }));
vi.mock('../../src/main/security/electronSafeStorage', () => ({ createElectronKeyBackend: vi.fn() }));
vi.mock('../../src/main/security/KeyService', () => ({ KeyService: vi.fn(function () { return { getStatus: async () => ({}) }; }) }));
vi.mock('../../src/main/providers/mock/MockProvider', () => ({ MockProvider: vi.fn() }));
vi.mock('../../src/main/services/RunService', () => ({ RunService: vi.fn(function () { return fixture.service; }) }));
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
    const unsubscribe = vi.fn();
    fixture.unregister.push(unsubscribe);
    return unsubscribe;
  });
});

describe('application lifecycle', () => {
  it('reports database initialization failures and exits instead of leaving a windowless process', async () => {
    fixture.database.initialize.mockImplementation(() => { throw new Error('Migration failed'); });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await startApp();

    expect(fixture.dialog.showErrorBox).toHaveBeenCalledWith('AI 圆桌启动失败', 'Migration failed');
    expect(fixture.database.close).toHaveBeenCalled();
    expect(fixture.app.exit).toHaveBeenCalledWith(0);
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
    expect(fixture.database.close).toHaveBeenCalledOnce();
    expect(fixture.unregister[0]).toHaveBeenCalledOnce();
    expect(fixture.app.exit).toHaveBeenCalledWith(0);
  });

  it('finishes quitting even before RunService has initialized', async () => {
    await import('../../src/main/index');

    emit('before-quit');
    await Promise.resolve();

    expect(fixture.app.exit).toHaveBeenCalledWith(0);
    expect(fixture.service.shutdown).not.toHaveBeenCalled();
  });

  it('releases IPC when the window closes and binds the reopened window', async () => {
    await startApp();
    const firstWindow = fixture.windows[0]!;

    firstWindow.close();
    emit('activate');

    expect(fixture.unregister[0]).toHaveBeenCalledTimes(1);
    expect(fixture.registerIpc).toHaveBeenLastCalledWith(fixture.windows[1], fixture.service);
    expect(fixture.windows[1]?.destroyed).toBe(false);
  });

  it('focuses the existing window on a second instance without creating another window', async () => {
    await startApp();

    emit('second-instance');

    expect(fixture.createWindow).toHaveBeenCalledTimes(1);
    expect(fixture.windows[0]?.show).toHaveBeenCalled();
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
    expect(fixture.database.close).toHaveBeenCalledTimes(1);
    expect(fixture.app.exit).toHaveBeenCalledWith(0);
  });

  // Shared Main/RunService integration gates: keep failing until the controller fixes them.
  it('prevents every quit attempt until the same cleanup barrier finishes', async () => {
    await startApp();
    let finish!: () => void;
    fixture.service.shutdown.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = emit('before-quit');
    const second = emit('before-quit');
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
    expect(fixture.database.close).toHaveBeenCalledOnce();
    expect(fixture.app.exit).toHaveBeenCalledOnce();
  });

  it('closes the database only once after an initialization failure', async () => {
    fixture.database.initialize.mockImplementation(() => { throw new Error('Migration failed'); });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await startApp();
      expect(fixture.database.close).toHaveBeenCalledOnce();
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
    expect(fixture.registerIpc).toHaveBeenLastCalledWith(fixture.windows[1], fixture.service);
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
