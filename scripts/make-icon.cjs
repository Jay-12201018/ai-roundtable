// Draws the app icon from the sidebar mark (src/renderer/features/shell/Logo.tsx) and writes build/icon.icns and
// build/icon.png. Electron renders the vector, the system's sips and iconutil make the sizes; no dependency is added.
// macOS only. Usage: ./node_modules/.bin/electron scripts/make-icon.cjs
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { app, BrowserWindow } = require('electron');

const SIZE = 1024;
const INK = '#F7F6F2';
const CANVAS = '#2D6A55';
const seats = [0, 60, 120, 180, 240, 300].map(angle => {
  const radians = angle * Math.PI / 180;
  return `<circle cx="${(12 + 8.6 * Math.cos(radians)).toFixed(2)}" cy="${(12 + 8.6 * Math.sin(radians)).toFixed(2)}" r="1.7" fill="${INK}" stroke="none"/>`;
}).join('');
// Apple's icon grid: an 824 px rounded square centred on the 1024 canvas; the mark sits inside it with room to breathe.
const page = `<!doctype html><html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" style="display:block">
<rect x="100" y="100" width="824" height="824" rx="185" fill="${CANVAS}"/>
<svg x="232" y="232" width="560" height="560" viewBox="0 0 24 24" fill="none" stroke="${INK}" stroke-width="1.6"><circle cx="12" cy="12" r="4.2"/>${seats}</svg>
</svg></body></html>`;

const work = fs.mkdtempSync(join(tmpdir(), 'roundtable-icon-'));
for (const name of ['userData', 'sessionData', 'logs']) app.setPath(name, join(work, name));
app.commandLine.appendSwitch('use-mock-keychain');

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: SIZE, height: SIZE, frame: false, transparent: true, useContentSize: true, enableLargerThanScreen: true, webPreferences: { offscreen: true, sandbox: true } });
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  await new Promise(done => setTimeout(done, 300));
  // On a Retina screen the capture comes at twice the size: downscale it rather than trust the display.
  const image = (await window.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })).resize({ width: SIZE, height: SIZE, quality: 'best' });
  const size = image.getSize();
  if (size.width !== SIZE || size.height !== SIZE) throw new Error(`Rendered ${size.width}x${size.height}, wanted ${SIZE}`);
  const build = resolve(__dirname, '../build');
  fs.mkdirSync(build, { recursive: true });
  const master = join(build, 'icon.png');
  fs.writeFileSync(master, image.toPNG());
  const iconset = join(work, 'icon.iconset');
  fs.mkdirSync(iconset);
  for (const points of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
    const pixels = String(points * scale);
    execFileSync('sips', ['-z', pixels, pixels, master, '--out', join(iconset, `icon_${points}x${points}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(build, 'icon.icns')]);
  console.log("Wrote build/icon.png and build/icon.icns");
  fs.rmSync(work, { recursive: true, force: true });
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
