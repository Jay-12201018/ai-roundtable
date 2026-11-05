// Runs an unchanged probe with its window in a given state, to see what the state does to it.
//   electron tests/probes/window-condition.cjs <blur|cover|minimize> tests/probes/<probe>.cjs [probe args]
// blur: another small window holds the focus. cover: an opaque window over the whole display; the probe's window keeps
// the key status it had. minimize: minimized as soon as it is shown.
// At the end it prints what really held, sampled once a second, so a run cannot pass for covered without having been:
// the page's frames in 200 ms and visibility, the window's own flags, and for cover a witness: a small window under the
// cover that keeps Chromium's default throttling, so its page turns hidden only if macOS reports it occluded.
const { app, BrowserWindow, screen } = require('electron');
const { resolve } = require('node:path');

const condition = process.argv[2];
if (!['blur', 'cover', 'minimize'].includes(condition)) throw new Error('Usage: window-condition.cjs <blur|cover|minimize> <probe> [args]');
const probe = resolve(process.argv[3]); process.argv.splice(2, 2);
const samples = { total: 0, windowVisible: 0, minimized: 0, focused: 0, pageVisible: 0, pageFrames: [], witness: {} };
const blank = color => 'data:text/html,<body style="background:%23' + color + '"></body>';
const sampleFrames = '(async () => { let frames = 0, going = true; const count = () => { frames++; if (going) requestAnimationFrame(count); }; requestAnimationFrame(count); await new Promise(done => setTimeout(done, 200)); going = false; return [frames, document.visibilityState]; })()';
app.once('browser-window-created', (_event, main) => {
  main.once('show', async () => {
    const others = [];
    let witness;
    const add = async (options, color) => { const window = new BrowserWindow({ show: false, frame: false, backgroundColor: '#' + color, webPreferences: { sandbox: true }, ...options }); others.push(window); await window.loadURL(blank(color)); return window; };
    if (condition === 'minimize') main.minimize();
    else if (condition === 'blur') { const other = await add({ width: 80, height: 50, x: 0, y: 0 }, 'c33'); app.focus({ steal: true }); other.show(); other.focus(); }
    else {
      const { bounds } = screen.getPrimaryDisplay();
      witness = await add({ width: 80, height: 50, x: bounds.x + 200, y: bounds.y + 200 }, '3c3'); witness.showInactive();
      const cover = await add({ ...bounds, enableLargerThanScreen: true }, '333'); cover.setAlwaysOnTop(true, 'screen-saver'); cover.showInactive();
    }
    const timer = setInterval(async () => {
      if (main.isDestroyed()) return clearInterval(timer);
      samples.total++; samples.windowVisible += main.isVisible() ? 1 : 0; samples.minimized += main.isMinimized() ? 1 : 0; samples.focused += main.isFocused() ? 1 : 0;
      const [page, hidden] = await Promise.all([
        main.webContents.executeJavaScript(sampleFrames).catch(() => undefined),
        witness && !witness.isDestroyed() ? witness.webContents.executeJavaScript('document.visibilityState').catch(error => 'error: ' + error.message) : undefined,
      ]);
      if (page) { samples.pageFrames.push(page[0]); samples.pageVisible += page[1] === 'visible' ? 1 : 0; }
      if (hidden) samples.witness[hidden] = (samples.witness[hidden] ?? 0) + 1;
    }, 1000);
    process.once('exit', () => console.log('WINDOW_CONDITION ' + JSON.stringify({ condition, ...samples })));
    app.once('before-quit', () => { clearInterval(timer); for (const window of others) if (!window.isDestroyed()) window.destroy(); });
  });
});
require(probe);
