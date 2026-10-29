// Chinese IME input for hands-on probes, shared by r16-harness.cjs and the standalone acceptance probes.
// When another window or app takes key status while a composition is open, Chromium ends the composition and keeps the
// pinyin as typed text, so 校园跑腿讨论 lands as "xiaoyuan校园跑腿讨论" (docs/verification/2026-10-29-maint-ime-probes.md).
// The probe window therefore never takes key status and its page emulates focus; each IME step waits for what the
// focused field reports, with a name and a deadline, instead of a fixed pause.

/**
 * Call once the window has its size: setting it non-focusable from creation changes when macOS fits a window that is
 * taller than the work area, and some probes wait for the requested size first. A window that already is key gives the
 * key status up here, while no composition is open.
 */
const holdFocus = window => { window.setFocusable(false); if (window.isFocused()) window.blur(); };

/** Once the DevTools debugger is attached: the page behaves as focused (focus events, :focus-visible, document.hasFocus()). */
const emulateFocus = send => send('Emulation.setFocusEmulationEnabled', { enabled: true });

/** selectAll and ime bound to a probe's DevTools `send`, page `js`, named bounded `until` and `key` (Cmd = modifier 4). */
function imeInput({ send, js, until, key, timeout = 5000 }) {
  const selectAll = async () => {
    await key('a', 4);
    await until(`(() => { const e = document.activeElement; return typeof e?.selectionStart === 'number' && e.selectionStart === 0 && e.selectionEnd === e.value.length; })()`, 'select all', timeout);
  };
  // A pinyin composition, optionally an Enter that only confirms, then the commit. The expected value keeps the text
  // around the selection the composition replaces.
  const ime = async (pinyin, committed, { enterWhileComposing = false } = {}) => {
    const before = await js(`(() => { const e = document.activeElement; if (typeof e?.selectionStart !== 'number') return null;
      if (!e.__ime) { const n = e.__ime = { start: 0, end: 0, keys: 0 }; e.addEventListener('compositionstart', () => n.start++); e.addEventListener('compositionend', () => n.end++); e.addEventListener('keydown', () => n.keys++); }
      window.__imeField = e; return { prefix: e.value.slice(0, e.selectionStart), suffix: e.value.slice(e.selectionEnd), ...e.__ime }; })()`);
    if (!before) throw new Error('IME input needs a focused text field: ' + committed);
    const reports = (value, start, end, keys = 0) => `(() => { const e = window.__imeField, n = e.__ime; return document.activeElement === e && e.value === ${JSON.stringify(before.prefix + value + before.suffix)}
      && n.start === ${before.start + start} && n.end === ${before.end + end} && n.keys >= ${before.keys + keys}; })()`;
    await send('Input.imeSetComposition', { text: pinyin, selectionStart: pinyin.length, selectionEnd: pinyin.length });
    await until(reports(pinyin, 1, 0), 'composition shown: ' + pinyin, timeout);
    if (enterWhileComposing) {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 });
      await until(reports(pinyin, 1, 0, 1), 'composition still open after the IME Enter: ' + pinyin, timeout);
    }
    await send('Input.insertText', { text: committed });
    await until(reports(committed, 1, 1), 'composition committed: ' + committed, timeout);
  };
  return { selectAll, ime };
}

module.exports = { holdFocus, emulateFocus, imeInput };
