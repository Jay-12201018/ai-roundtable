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
/**
 * Code points that show as nothing or change how a name reads (txt.exe shown as exe.txt), and that a file system may
 * drop when it compares names. A Unicode property rather than a hand-kept list: Default_Ignorable_Code_Point is
 * Unicode's own definition of "renderers show nothing" and contains everything HFS+ ignores (U+200C–200F, U+202A–202E,
 * U+206A–206F, U+FEFF, the list Git keeps since CVE-2014-9390) as well as U+00AD, U+034F, U+061C, U+180E, variation
 * selectors and tag characters. Cf adds the remaining format controls, Zl/Zp the line separators, Cs a lone surrogate
 * (it would be written as U+FFFD, a different name from the one shown). The price is that a few real names are refused
 * (emoji joined with ZWJ, Persian with ZWNJ); the host can rename them after writing.
 */
const invisible = /[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;
const control = /[\u0000-\u001f\u007f-\u009f]/u;

/** `.git`, or one of its NTFS short names (git~1), compared as a case-insensitive file system would. */
const isDotGit = (name: string) => name.toLowerCase() === '.git' || name.toUpperCase() === '.GIT' || /^git~\d+$/iu.test(name);

/** What a plain name would really address, once the trailing dots and spaces Windows drops are gone. */
function nameIssue(form: string): CodeExportReason | undefined {
  const name = form.replace(/[. ]+$/u, '');
  if (name === '') return 'traversal';
  if (isDotGit(name)) return 'git_dir';
  return reservedName.test(name) ? 'reserved_name' : undefined;
}

/**
 * The same questions asked of the NFKC form (which also covers NFC): full-width dots and letters, one-dot leaders and
 * the like must not read as `.git`, `..` or a reserved name, and must not hide a separator. Only these outcomes are
 * refused: full-width `：` and `？` are ordinary in Chinese file names and no file system treats them as `:` and `?`.
 */
function compatibilityIssue(segment: string): CodeExportReason | undefined {
  const parts = segment.normalize('NFKC').split(/[\\/]/u);
  for (const part of parts) {
    const issue = part === '' ? undefined : nameIssue(part);
    if (issue) return issue;
  }
  return parts.length > 1 ? 'reserved_char' : undefined;
}

/** True when a folder's own path runs through a `.git` folder (a host choosing `.git/hooks` would run what is written). */
export const insideGitDir = (path: string, separator: string) => path.split(separator).some(part => part !== '' && isDotGit(part.normalize('NFKC').replace(/[. ]+$/u, '')));

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
    // Git runs hooks from .git; writing there is running code later.
    const issue = nameIssue(segment) ?? compatibilityIssue(segment);
    if (issue) return { ok: false, reason: issue };
    if (Buffer.byteLength(segment, 'utf8') > 255) return { ok: false, reason: 'segment_too_long' };
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
