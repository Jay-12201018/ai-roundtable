// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isBinary, lineDiff, MAX_DIFF_INPUT_BYTES, MAX_DIFF_INPUT_LINES, MAX_EDIT_DISTANCE } from '../../../src/main/export/diff';
import { codeExportDiffSchema, MAX_DIFF_LINES } from '../../../src/shared/schemas/codeExport';

type Lines = Extract<ReturnType<typeof lineDiff>, { kind: 'lines' }>;
const lines = (diff: ReturnType<typeof lineDiff>) => { expect(diff.kind).toBe('lines'); return diff as Lines; };
/** Applying the diff's hunks to the old text gives the new text: the diff is complete and in order. */
function apply(oldText: string, diff: Lines): string[] {
  const old = oldText === '' ? [] : oldText.replace(/\n$/u, '').split('\n');
  const out: string[] = []; let cursor = 0;
  for (const hunk of diff.hunks) {
    while (cursor < hunk.oldStart - 1) out.push(old[cursor++]);
    for (const line of hunk.lines) {
      if (line.op === 'add') out.push(line.text);
      else { expect(old[cursor]).toBe(line.text); cursor++; if (line.op === 'same') out.push(line.text); }
    }
  }
  while (cursor < old.length) out.push(old[cursor++]);
  return out;
}

describe('line diff (D128)', () => {
  it('finds the shortest change with three lines of context, in hunks that apply back to the new text', () => {
    const oldText = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const next = oldText.replace('line 5\n', 'line five\n').replace('line 25\n', '').concat('line 31\n');
    const diff = lines(lineDiff(oldText, next));
    expect(codeExportDiffSchema.safeParse(diff).success).toBe(true);
    expect({ added: diff.added, removed: diff.removed, truncated: diff.truncated }).toEqual({ added: 2, removed: 2, truncated: false });
    expect(diff.hunks.map(h => [h.oldStart, h.oldCount, h.newStart, h.newCount])).toEqual([[2, 7, 2, 7], [22, 9, 22, 9]]);
    expect(diff.hunks[0].lines.filter(l => l.op !== 'same').map(l => `${l.op} ${l.text}`)).toEqual(['remove line 5', 'add line five']);
    expect(apply(oldText, diff)).toEqual(next.replace(/\n$/u, '').split('\n'));
  });

  it('handles empty files, identical files and CRLF line ends', () => {
    expect(lines(lineDiff('', 'a\nb\n'))).toMatchObject({ added: 2, removed: 0, hunks: [{ oldStart: 1, oldCount: 0, newStart: 1, newCount: 2 }] });
    expect(lines(lineDiff('a\nb\n', ''))).toMatchObject({ added: 0, removed: 2 });
    expect(lines(lineDiff('same\n', 'same\n'))).toMatchObject({ added: 0, removed: 0, hunks: [] });
    expect(lines(lineDiff('a\r\nb\r\n', 'a\nb\n'))).toMatchObject({ added: 0, removed: 0 });
  });

  it('random edits always apply back exactly', () => {
    let seed = 7; const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let round = 0; round < 40; round++) {
      const a = Array.from({ length: Math.floor(random() * 60) }, () => `x${Math.floor(random() * 8)}`);
      const b = a.flatMap(line => random() < 0.15 ? [] : random() < 0.15 ? [line, `y${Math.floor(random() * 8)}`] : [line]);
      const diff = lines(lineDiff(a.join('\n'), b.join('\n')));
      expect(apply(a.join('\n'), diff)).toEqual(b);
    }
  });

  it('degrades instead of running unbounded: too large, too many changes, binary', () => {
    expect(lineDiff('x'.repeat(MAX_DIFF_INPUT_BYTES + 1), 'y')).toEqual({ kind: 'unavailable', reason: 'too_large' });
    expect(lineDiff(Array.from({ length: MAX_DIFF_INPUT_LINES + 1 }, (_, i) => String(i)).join('\n'), 'y')).toEqual({ kind: 'unavailable', reason: 'too_large' });
    const many = (prefix: string) => Array.from({ length: MAX_EDIT_DISTANCE }, (_, i) => `${prefix}${i}`).join('\n');
    const started = Date.now();
    expect(lineDiff(many('a'), many('b'))).toEqual({ kind: 'unavailable', reason: 'too_many_changes' });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(isBinary(Buffer.from([0x41, 0x00, 0x42]))).toBe(true);
    expect(isBinary(Buffer.from([0xff, 0xfe, 0x41]))).toBe(true);
    expect(isBinary(Buffer.from('普通文本\n', 'utf8'))).toBe(false);
  });

  it('cuts the shown lines at the display limit and says so; very long lines are clipped', () => {
    const oldText = Array.from({ length: 4000 }, (_, i) => `a${i}`).join('\n');
    const next = Array.from({ length: 4000 }, (_, i) => i % 8 ? `a${i}` : `b${i}`).join('\n');
    const diff = lines(lineDiff(oldText, next));
    expect(diff.truncated).toBe(true);
    expect(diff.hunks.reduce((total, hunk) => total + hunk.lines.length, 0)).toBe(MAX_DIFF_LINES);
    expect({ added: diff.added, removed: diff.removed }).toEqual({ added: 500, removed: 500 });
    const long = lines(lineDiff('x\n', 'y'.repeat(5000) + '\n'));
    expect(long.hunks[0].lines.at(-1)!.text).toHaveLength(2001);
    expect(codeExportDiffSchema.safeParse(diff).success && codeExportDiffSchema.safeParse(long).success).toBe(true);
  });
});
