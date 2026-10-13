import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, shell, type IpcMainInvokeEvent } from 'electron';

const trustedRenderers = new WeakMap<BrowserWindow, URL>();

function isTrustedUrl(value: string, trusted: URL): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    url.hash = '';
    return url.href === trusted.href;
  } catch { return false; }
}

export function isTrustedRenderer(window: BrowserWindow): boolean {
  const trusted = trustedRenderers.get(window);
  if (!trusted || window.isDestroyed() || window.webContents.isDestroyed()) return false;
  try { return isTrustedUrl(window.webContents.mainFrame.url, trusted); }
  catch { return false; }
}

// The controller must use this for every registered invoke handler.
export function isTrustedIpcSender(window: BrowserWindow, event: IpcMainInvokeEvent): boolean {
  return isTrustedRenderer(window) && event.sender === window.webContents
    && event.senderFrame !== null && event.senderFrame === window.webContents.mainFrame;
}

export function createMainWindow(): BrowserWindow {
  const rendererFile = join(__dirname, '../renderer/index.html');
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  let trusted: URL;
  try {
    trusted = new URL(rendererUrl ?? pathToFileURL(rendererFile).href);
    if (trusted.username || trusted.password || (rendererUrl && !['http:', 'https:'].includes(trusted.protocol))) throw new Error();
    trusted.hash = '';
  } catch { throw new Error('开发页面地址无效，请检查 ELECTRON_RENDERER_URL 配置。'); }

  const window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // electron-vite emits an ESM preload; Electron sandboxed preloads cannot import ESM.
      sandbox: false,
      webSecurity: true,
    },
  });
  trustedRenderers.set(window, trusted);

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isTrustedRenderer(window)) return { action: 'deny' };
    let target: URL;
    try { target = new URL(url); }
    catch { return { action: 'deny' }; }
    if (target.protocol !== 'https:' || target.username || target.password) return { action: 'deny' };
    // Popup metadata cannot prove a user gesture; require a native confirmation.
    const answer = dialog.showMessageBoxSync(window, {
      type: 'question', buttons: ['取消', '打开浏览器'], defaultId: 0, cancelId: 0,
      title: '打开外部链接', message: '是否在系统浏览器中打开此链接？', detail: target.href,
    });
    if (answer === 1) void shell.openExternal(target.href).catch(() => {
      dialog.showErrorBox('无法打开外部链接', '请检查系统默认浏览器后重试。');
    });
    return { action: 'deny' };
  });
  const guardNavigation = (event: Electron.Event<{ url: string; isMainFrame: boolean }>) => {
    if (!event.isMainFrame || !isTrustedUrl(event.url, trusted)) event.preventDefault();
  };
  window.webContents.on('will-navigate', guardNavigation);
  window.webContents.on('will-frame-navigate', guardNavigation);
  window.webContents.on('will-redirect', guardNavigation);

  const loading = rendererUrl ? window.loadURL(rendererUrl) : window.loadFile(rendererFile);
  void loading.then(() => {
    if (!window.isDestroyed()) window.show();
  }, () => {
    if (window.isDestroyed()) return;
    window.hide();
    dialog.showErrorBox('AI 圆桌启动失败', '无法加载应用页面，请检查安装文件或开发服务后重试。');
    app.quit();
  });
  return window;
}
