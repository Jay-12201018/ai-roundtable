// Runs an unchanged probe while key status keeps moving to another window and back, as when other probes launch or a
// person switches windows during a run (docs/verification/2026-10-29-maint-ime-probes.md).
//   electron tests/probes/focus-steal.cjs tests/probes/<probe>.cjs [probe args]      STEAL_MS sets the period (default 300)
// A small frameless window in the probe's own process takes the focus for half of every period. It loads nothing from
// the network and prints how often it took the focus.
const { app, BrowserWindow } = require('electron');
const { resolve } = require('node:path');

const probe = resolve(process.argv[2]); process.argv.splice(2, 1);
const every = Number(process.env.STEAL_MS || 300);
let steals = 0;
app.once('browser-window-created', (_event, main) => {
  main.once('show', () => {
    const other = new BrowserWindow({ width: 80, height: 50, x: 0, y: 0, show: false, frame: false, webPreferences: { sandbox: true } });
    other.loadURL('data:text/html,<body style="background:%23c33"></body>');
    const timer = setInterval(() => {
      if (main.isDestroyed() || other.isDestroyed()) return clearInterval(timer);
      steals++; app.focus({ steal: true }); other.show(); other.focus();
      setTimeout(() => { if (!main.isDestroyed() && !other.isDestroyed()) { other.hide(); main.focus(); } }, every / 2);
    }, every);
    app.once('before-quit', () => { clearInterval(timer); console.log('FOCUS_STEALS ' + steals); if (!other.isDestroyed()) other.destroy(); });
  });
});
require(probe);
