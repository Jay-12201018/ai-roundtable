// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMainWindow } from '../../../src/main/windows/createMainWindow';
import { isTrustedIpcSender, isTrustedRenderer } from '../../../src/main/windows/createMainWindow';

const fixture = vi.hoisted(() => ({
  windows: [] as any[],
  load: vi.fn(),
  openExternal: vi.fn(),
  quit: vi.fn(),
  showErrorBox: vi.fn(),
  showMessageBoxSync: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: class {
    destroyed = false;
    hide = vi.fn();
    show = vi.fn();
    isDestroyed = () => this.destroyed;
    loadURL = fixture.load;
    loadFile = fixture.load;
    webContents = {
      mainFrame: { url: '' },
      isDestroyed: () => this.destroyed,
      listeners: new Map<string, (...args: any[]) => void>(),
      on: (name: string, listener: (...args: any[]) => void) => this.webContents.listeners.set(name, listener),
      setWindowOpenHandler: (handler: (...args: any[]) => unknown) => { this.openWindow = handler; },
    };
    openWindow!: (...args: any[]) => unknown;
    constructor(public options: Electron.BrowserWindowConstructorOptions) { fixture.windows.push(this); }
  },
  shell: { openExternal: fixture.openExternal },
  app: { quit: fixture.quit },
  dialog: { showErrorBox: fixture.showErrorBox, showMessageBoxSync: fixture.showMessageBoxSync },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  fixture.windows.length = 0;
  fixture.load.mockResolvedValue(undefined);
  fixture.openExternal.mockResolvedValue(undefined);
  fixture.showMessageBoxSync.mockReturnValue(0);
});

function navigate(window: any, url: string, eventName = 'will-navigate', isMainFrame = true) {
  const event = { url, isMainFrame, preventDefault: vi.fn() };
  window.webContents.listeners.get(eventName)?.(event, url, false, isMainFrame);
  return event.preventDefault;
}

describe('window navigation security', () => {
  it.each([
    'http://localhost.attacker.example:5173/',
    'http://localhost:5174/',
    'http://localhost:5173/other.html',
    'http://user@localhost:5173/',
    'https://localhost:5173/',
    'file:///tmp/attacker.html',
    'javascript:alert(1)',
    'not a URL',
  ])('blocks navigation outside the configured renderer: %s', (url) => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/');
    createMainWindow();
    expect(navigate(fixture.windows[0], url)).toHaveBeenCalledOnce();
  });

  it('allows the exact renderer document with a fragment', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/');
    createMainWindow();
    expect(navigate(fixture.windows[0], 'http://localhost:5173/#discussion')).not.toHaveBeenCalled();
  });

  it('keeps the trusted development address fixed for the lifetime of the window', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/');
    createMainWindow();
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5174/');
    expect(navigate(fixture.windows[0], 'http://localhost:5174/')).toHaveBeenCalledOnce();
  });

  it('allows only the packaged renderer file', () => {
    createMainWindow();
    const window = fixture.windows[0];
    const trusted = pathToFileURL(join(__dirname, '../../../src/main/renderer/index.html')).href;
    expect(navigate(window, trusted + '#discussion')).not.toHaveBeenCalled();
    for (const url of ['file:///tmp/attacker.html', trusted + '.evil', trusted + '?remote=1', trusted.replace('file:///', 'file://remote/')]) {
      expect(navigate(window, url)).toHaveBeenCalledOnce();
    }
  });

  it('blocks untrusted redirects and every child frame navigation', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/');
    createMainWindow();
    const window = fixture.windows[0];
    expect(navigate(window, 'https://attacker.example/', 'will-redirect')).toHaveBeenCalledOnce();
    expect(navigate(window, 'http://localhost:5173/', 'will-frame-navigate', false)).toHaveBeenCalledOnce();
    expect(navigate(window, 'http://localhost:5173/', 'will-frame-navigate')).not.toHaveBeenCalled();
  });
});

describe('external links', () => {
  function popup(url: string, answer = 0) {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/');
    createMainWindow();
    const window = fixture.windows[0];
    window.webContents.mainFrame.url = 'http://localhost:5173/';
    fixture.showMessageBoxSync.mockReturnValue(answer);
    expect(window.openWindow({ url })).toEqual({ action: 'deny' });
    return window;
  }

  it('requires a main-process user confirmation before opening HTTPS externally', () => {
    popup('https://example.com/docs');
    expect(fixture.openExternal).not.toHaveBeenCalled();
    expect(fixture.showMessageBoxSync).toHaveBeenCalledOnce();
  });

  it('opens a confirmed HTTPS link without creating a renderer window', () => {
    popup('https://example.com/docs', 1);
    expect(fixture.openExternal).toHaveBeenCalledWith('https://example.com/docs');
  });

  it.each(['http://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:password@example.com/', 'invalid'])('denies unsafe external URL %s', (url) => {
    popup(url, 1);
    expect(fixture.openExternal).not.toHaveBeenCalled();
    expect(fixture.showMessageBoxSync).not.toHaveBeenCalled();
  });

  it('denies popups from an untrusted document', () => {
    const window = popup('https://example.com/');
    fixture.showMessageBoxSync.mockClear();
    window.webContents.mainFrame.url = 'https://attacker.example/';
    window.openWindow({ url: 'https://example.com/' });
    expect(fixture.showMessageBoxSync).not.toHaveBeenCalled();
    expect(fixture.openExternal).not.toHaveBeenCalled();
  });

  it('handles an external browser rejection visibly', async () => {
    fixture.openExternal.mockRejectedValue(new Error('browser unavailable'));
    popup('https://example.com/', 1);
    await Promise.resolve();
    expect(fixture.showErrorBox).toHaveBeenCalledWith('无法打开外部链接', expect.any(String));
  });
});

describe('renderer loading', () => {
  it.each([undefined, 'http://localhost:5173/'])('hides the failed window and requests cleanup for %s', async (address) => {
    if (address) vi.stubEnv('ELECTRON_RENDERER_URL', address);
    fixture.load.mockRejectedValue(new Error('renderer failed'));
    createMainWindow();
    await Promise.resolve();
    const window = fixture.windows[0];
    expect(fixture.showErrorBox).toHaveBeenCalledWith('AI 圆桌启动失败', expect.stringContaining('加载'));
    expect(window.hide).toHaveBeenCalledOnce();
    expect(fixture.quit).toHaveBeenCalledOnce();
    expect(window.show).not.toHaveBeenCalled();
  });

  it('shows the window only after loading finishes', async () => {
    let loaded!: () => void;
    fixture.load.mockImplementation(() => new Promise<void>((resolve) => { loaded = resolve; }));
    createMainWindow();
    const window = fixture.windows[0];
    expect(window.options.show).toBe(false);
    expect(window.show).not.toHaveBeenCalled();
    loaded();
    await Promise.resolve();
    expect(window.show).toHaveBeenCalledOnce();
  });

  it('ignores a load cancellation after the window has been destroyed', async () => {
    let rejectLoad!: (error: Error) => void;
    fixture.load.mockImplementation(() => new Promise<void>((_, reject) => { rejectLoad = reject; }));
    createMainWindow();
    fixture.windows[0].destroyed = true;
    rejectLoad(new Error('ERR_ABORTED'));
    await Promise.resolve();
    expect(fixture.quit).not.toHaveBeenCalled();
    expect(fixture.showErrorBox).not.toHaveBeenCalled();
  });
});

describe('IPC source policy for controller integration', () => {
  it('accepts only the live main frame of the created window', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/');
    const window = createMainWindow();
    const contents = window.webContents;
    Object.assign(contents.mainFrame, { url: 'http://localhost:5173/#discussion' });
    const event = { sender: contents, senderFrame: contents.mainFrame } as Electron.IpcMainInvokeEvent;
    expect(isTrustedRenderer(window)).toBe(true);
    expect(isTrustedIpcSender(window, event)).toBe(true);
    for (const senderFrame of [null, { url: 'http://localhost:5173/' }]) {
      expect(isTrustedIpcSender(window, { ...event, senderFrame } as Electron.IpcMainInvokeEvent)).toBe(false);
    }
    expect(isTrustedIpcSender(window, { ...event, sender: {} } as Electron.IpcMainInvokeEvent)).toBe(false);
    Object.assign(contents.mainFrame, { url: 'http://localhost.attacker.example:5173/' });
    expect(isTrustedIpcSender(window, event)).toBe(false);
    expect(isTrustedRenderer(window)).toBe(false);
  });

  it('rejects IPC after window destruction or from an unregistered window', () => {
    const window = createMainWindow();
    Object.assign(window.webContents.mainFrame, { url: pathToFileURL(join(__dirname, '../../../src/main/renderer/index.html')).href });
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame } as Electron.IpcMainInvokeEvent;
    expect(isTrustedIpcSender(window, event)).toBe(true);
    fixture.windows[0].destroyed = true;
    expect(isTrustedIpcSender(window, event)).toBe(false);
    expect(isTrustedIpcSender({} as Electron.BrowserWindow, event)).toBe(false);
  });

  it.each(['not a URL', 'javascript:alert(1)', 'http://user@localhost:5173/'])('rejects invalid development configuration before opening a window: %s', (url) => {
    vi.stubEnv('ELECTRON_RENDERER_URL', url);
    expect(() => createMainWindow()).toThrow();
    expect(fixture.windows).toHaveLength(0);
  });
});
