// 用 Electron 把 R16 原型逐个画面截成 PNG（浅色、深色、窄窗口）。
// 用法（仓库根目录）：./node_modules/.bin/electron docs/design/r16/capture.cjs [只截名称包含此串的画面]
// 只加载本地 file:// 原型，不访问网络、不读任何用户数据；使用临时 userData。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'r16-capture-')));
app.disableHardwareAcceleration();

const page = path.join(__dirname, 'prototype', 'index.html');
const out = path.join(__dirname, 'screens');
const desktop = [1440, 900];
const scenes = ['welcome', 'setup1', 'setup2', 'setup3', 'new', 'run', 'stop', 'paused', 'detail', 'summary', 'budget', 'workflow', 'room', 'member', 'settings', 'network', 'usage'];
const shots = [];
scenes.forEach((scene, index) => {
  for (const theme of ['light', 'dark']) shots.push({ name: `${String(index + 1).padStart(2, '0')}-${scene}-${theme}`, scene, theme, size: desktop });
});
// 四档窗口：1280 三栏、1024 面板成抽屉、800 讨论优先。
shots.push(
  { name: '30-w1280-run-light', scene: 'run', theme: 'light', size: [1280, 800] },
  { name: '31-w1024-run-light', scene: 'run', theme: 'light', size: [1024, 768] },
  { name: '32-w1024-ctx-drawer-dark', scene: 'run', theme: 'dark', size: [1024, 768], extra: 'ctx=open' },
  { name: '33-w800-run-light', scene: 'run', theme: 'light', size: [800, 600] },
  { name: '34-w800-run-dark', scene: 'run', theme: 'dark', size: [800, 600] },
  { name: '35-w800-paused-light', scene: 'paused', theme: 'light', size: [800, 600] },
  { name: '36-w800-nav-drawer-light', scene: 'run', theme: 'light', size: [800, 600], extra: 'nav=open' },
  { name: '37-w800-ctx-drawer-light', scene: 'budget', theme: 'light', size: [800, 600], extra: 'ctx=open' },
  { name: '38-w1600-detail-light', scene: 'detail', theme: 'light', size: [1600, 1000] },
);

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const filter = process.argv.slice(2).find(arg => !arg.startsWith('-') && !arg.endsWith('.cjs'));
  // 一个窗口反复使用；只放行本地文件请求。
  const win = new BrowserWindow({ width: desktop[0], height: desktop[1], show: false, useContentSize: true, paintWhenInitiallyHidden: true, webPreferences: { sandbox: true, contextIsolation: true } });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file:|about:)/u.test(details.url) }));
  for (const shot of shots.filter(item => !filter || item.name.includes(filter))) {
    const [width, height] = shot.size;
    win.setContentSize(width, height);
    const hash = `scene=${shot.scene}&theme=${shot.theme}&w=${width}&h=${height}&capture=1${shot.extra ? `&${shot.extra}` : ''}`;
    await win.loadURL('about:blank');
    await win.loadFile(page, { hash });
    await new Promise(resolve => setTimeout(resolve, 300));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
    fs.writeFileSync(path.join(out, `${shot.name}.png`), image.toPNG());
    console.log(`${shot.name}.png ${image.getSize().width}x${image.getSize().height}`);
  }
  app.quit();
});
