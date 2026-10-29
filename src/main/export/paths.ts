import type { CodeExportReason } from '../../shared/schemas/codeExport';

/**
 * R15 (D127): what a candidate path may be, decided from the text alone and the same on every platform. A path that
 * passes is a list of plain names to be joined under the chosen folder; nothing here touches the file system. The
 * rules are stricter than any one file system needs, so that a path accepted on macOS is also safe on Windows and the
 * other way round.
 */
export type PathCheck = { ok: true; segments: string[] } | { ok: false; reason: CodeExportReason };

/** Windows device names, with or without an extension (CON, con.txt, COM1.tar.gz, COM¹). */
const reservedName = /^(con|prn|aux|nul|conin\$|conout\$|clock\$|(com|lpt)[0-9¹²³])(\..*)?$/iu;
// Zero-width characters and bidi controls make a shown name differ from the real one (txt.exe shown as exe.txt).
const invisible = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/u;
const control = /[\u0000-\u001f\u007f-\u009f]/u;

export function checkCandidatePath(path: string): PathCheck {
  if (path.length === 0) return { ok: false, reason: 'empty_segment' };
  if (control.test(path)) return { ok: false, reason: 'control_char' };
  // UNC and device paths first: \\server\share, //server/share, \\?\C:\, \\.\pipe.
  if (/^[\\/]{2}/u.test(path)) return { ok: false, reason: 'unc' };
  if (/^[A-Za-z]:/u.test(path)) return { ok: false, reason: 'drive' };
  if (path.startsWith('/') || path.startsWith('~')) return { ok: false, reason: 'absolute' };
  if (path.includes('\\')) return { ok: false, reason: path.split(/[\\/]/u).some(segment => segment === '..' || segment === '.') ? 'traversal' : 'backslash' };
  if (invisible.test(path)) return { ok: false, reason: 'invisible_char' };
  const segments = path.split('/');
  for (const segment of segments) {
    if (segment === '') return { ok: false, reason: 'empty_segment' };
    if (segment === '.' || segment === '..') return { ok: false, reason: 'traversal' };
  }
  for (const segment of segments) {
    if (/[:*?"<>|]/u.test(segment)) return { ok: false, reason: 'reserved_char' };
    if (/[. ]$/u.test(segment)) return { ok: false, reason: 'trailing_dot_space' };
    if (reservedName.test(segment.trimEnd())) return { ok: false, reason: 'reserved_name' };
    if (Buffer.byteLength(segment, 'utf8') > 255) return { ok: false, reason: 'segment_too_long' };
    // Git runs hooks from .git; writing there is running code later.
    if (segment.toLowerCase() === '.git') return { ok: false, reason: 'git_dir' };
  }
  return { ok: true, segments };
}

/** Names that one case-insensitive, normalization-insensitive file system (APFS, NTFS) would treat as the same. */
export const collisionKey = (name: string) => name.normalize('NFC').toLowerCase();

/** Paths of one candidate that would land on the same file (or one inside the other's file) on such a file system. */
export function findCollisions(paths: readonly string[]): Set<string> {
  const keys = paths.map(path => collisionKey(path));
  const colliding = new Set<string>();
  paths.forEach((path, index) => {
    for (let other = 0; other < paths.length; other++) {
      if (other === index) continue;
      // The same file, or a file used as a folder by another path (a and a/b).
      if (keys[other] === keys[index] || keys[other].startsWith(keys[index] + '/')) { colliding.add(path); colliding.add(paths[other]); }
    }
  });
  return colliding;
}

/** True when `inner` is `outer` or inside it, compared as this platform's file system compares names. */
export function isWithin(outer: string, inner: string, separator: string, caseInsensitive: boolean): boolean {
  const fold = (value: string) => caseInsensitive ? collisionKey(value) : value;
  const base = fold(outer.endsWith(separator) ? outer.slice(0, -separator.length) : outer);
  const target = fold(inner);
  return target === base || target.startsWith(base + separator);
}
