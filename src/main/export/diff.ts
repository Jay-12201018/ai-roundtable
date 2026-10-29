import { MAX_DIFF_LINE_CHARS, MAX_DIFF_LINES, type CodeExportDiff } from '../../shared/schemas/codeExport';

/**
 * R15 (D128): a line diff of an existing file against the candidate, for the host to read before overwriting.
 * Myers' O(ND) algorithm with hard limits: files over MAX_DIFF_INPUT_LINES lines or MAX_DIFF_INPUT_BYTES, or more than
 * MAX_EDIT_DISTANCE changed lines, get no line diff (the host is told why) instead of an unbounded computation.
 */
export const MAX_DIFF_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_DIFF_INPUT_LINES = 20_000;
export const MAX_EDIT_DISTANCE = 1_500;
const CONTEXT = 3;

type Op = { op: 'same' | 'add' | 'remove'; oldLine: number; newLine: number; text: string };

export const splitLines = (text: string) => {
  if (text === '') return [];
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  return lines;
};

/** Myers' shortest edit script, or undefined when it needs more than `limit` edits. */
function editScript(a: readonly string[], b: readonly string[], limit: number): Op[] | undefined {
  const n = a.length, m = b.length, max = Math.min(n + m, limit);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // Only diagonals -d-1..d+1 matter at step d, so each step keeps just that window (memory O(D²), not O(D·(N+M))).
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  if (found < 0) return undefined;
  const ops: Op[] = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const window = trace[d];
    const at = (diagonal: number) => window[diagonal + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK), prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; ops.push({ op: 'same', oldLine: x, newLine: y, text: a[x] }); }
    if (down) { y--; ops.push({ op: 'add', oldLine: x, newLine: y, text: b[y] }); }
    else { x--; ops.push({ op: 'remove', oldLine: x, newLine: y, text: a[x] }); }
  }
  while (x > 0 && y > 0) { x--; y--; ops.push({ op: 'same', oldLine: x, newLine: y, text: a[x] }); }
  return ops.reverse();
}

const clip = (text: string) => text.length > MAX_DIFF_LINE_CHARS ? text.slice(0, MAX_DIFF_LINE_CHARS) + '…' : text;

export function lineDiff(oldText: string, newText: string): CodeExportDiff {
  if (Buffer.byteLength(oldText) > MAX_DIFF_INPUT_BYTES || Buffer.byteLength(newText) > MAX_DIFF_INPUT_BYTES) return { kind: 'unavailable', reason: 'too_large' };
  const a = splitLines(oldText), b = splitLines(newText);
  if (a.length > MAX_DIFF_INPUT_LINES || b.length > MAX_DIFF_INPUT_LINES) return { kind: 'unavailable', reason: 'too_large' };
  const ops = editScript(a, b, MAX_EDIT_DISTANCE);
  if (!ops) return { kind: 'unavailable', reason: 'too_many_changes' };
  const added = ops.filter(op => op.op === 'add').length, removed = ops.filter(op => op.op === 'remove').length;
  // Hunks: each change with CONTEXT unchanged lines around it; nearby changes share one hunk.
  const changed = ops.map((op, index) => op.op !== 'same' ? index : -1).filter(index => index >= 0);
  const ranges: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - CONTEXT), end = Math.min(ops.length - 1, index + CONTEXT);
    const last = ranges.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end); else ranges.push([start, end]);
  }
  const hunks: Extract<CodeExportDiff, { kind: 'lines' }>['hunks'] = [];
  let budget = MAX_DIFF_LINES, truncated = false;
  for (const [start, end] of ranges) {
    if (budget <= 0) { truncated = true; break; }
    const slice = ops.slice(start, Math.min(end + 1, start + budget));
    if (slice.length < end - start + 1) truncated = true;
    budget -= slice.length;
    const first = slice[0];
    hunks.push({
      oldStart: first.oldLine + 1, oldCount: slice.filter(op => op.op !== 'add').length,
      newStart: first.newLine + 1, newCount: slice.filter(op => op.op !== 'remove').length,
      lines: slice.map(op => ({ op: op.op, text: clip(op.text) })),
    });
  }
  return { kind: 'lines', added, removed, hunks, truncated };
}

/** True when the bytes are not UTF-8 text a diff can show (a NUL byte, or invalid UTF-8). */
export function isBinary(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return false; } catch { return true; }
}
