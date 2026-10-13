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
    isMinimized = vi.fn(() => false);
    isDestroyed = () => this.destroyed;
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
    registerIpc: vi.fn(),
    unregister: [] as ReturnType<typeof vi.fn>[],
  };
});

vi.mock('electron', () => ({ app: fixture.app, dialog: fixture.dialog, BrowserWindow: { getAllWindows: () => fixture.windows.filter((window) => !window.destroyed) } }));
vi.mock('../../src/main/database/Database', () => ({ Database: vi.fn(function () { return fixture.database; }) }));
vi.mock('../../src/main/security/electronSafeStorage', () => ({ createElectronKeyBackend: vi.fn() }));
vi.mock('../../src/main/security/KeyService', () => ({ KeyService: vi.fn(function () { return { getStatus: async () => ({}) }; }) }));
vi.mock('../../src/main/providers/mock/MockProvider', () => ({ MockProvider: vi.fn() }));
vi.mock('../../src/main/services/RunService', () => ({ RunService: vi.fn(function () { return fixture.service; }) }));
vi.mock('../../src/main/windows/createMainWindow', () => ({ createMainWindow: fixture.createWindow }));
vi.mock('../../src/main/ipc/registerIpc', () => ({ registerIpc: fixture.registerIpc }));

function emit(name: string) {
  fixture.listeners.get(name)?.forEach((listener) => listener({ preventDefault: vi.fn() }));
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
});
