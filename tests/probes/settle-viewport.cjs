// A window taller than the screen's work area is fitted by macOS when it is shown, so a requested size may never hold
// (docs/verification/2026-10-29-maint-ime-probes.md). The probes wait for what the window really settled on: visible, the
// page's viewport equal to the window's actual content size, unchanged for a moment. The returned size goes into the result.
async function settleViewport({ window, js, sleep, timeout = 15000, stableMs = 400 }) {
  const deadline = Date.now() + timeout;
  let settled, since;
  for (;;) {
    const [width, height] = window.getContentSize();
    const [innerWidth, innerHeight] = await js('[window.innerWidth, window.innerHeight]');
    const current = window.isVisible() && innerWidth === width && innerHeight === height ? `${width}x${height}` : undefined;
    if (current !== settled) { settled = current; since = Date.now(); }
    if (settled && Date.now() - since >= stableMs) return { width, height };
    if (Date.now() > deadline) throw new Error(`Timed out: window size applied (viewport ${innerWidth}x${innerHeight}, content ${width}x${height}, visible ${window.isVisible()})`);
    await sleep(50);
  }
}

module.exports = { settleViewport };
