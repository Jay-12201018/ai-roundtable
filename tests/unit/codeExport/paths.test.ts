// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkCandidatePath, collisionKey, findCollisions, insideGitDir, isWithin } from '../../../src/main/export/paths';
import { candidatePathSchema } from '../../../src/shared/schemas/artifact';
import { codeExportReasonLabels } from '../../../src/shared/schemas/codeExport';

const reason = (path: string) => { const result = checkCandidatePath(path); return result.ok ? 'ok' : result.reason; };

describe('candidate paths, as text (D127)', () => {
  it('accepts plain relative POSIX paths and splits them into names', () => {
    expect(checkCandidatePath('src/pilot/fee.ts')).toEqual({ ok: true, segments: ['src', 'pilot', 'fee.ts'] });
    for (const path of ['README.md', 'a/b/c/d.txt', '.github/dependabot.yml', '中文/文件.md', 'with space/x y.ts', 'v1.2/notes', '.env.example', 'console.ts', 'conf/aux-tools.js', 'com10.txt'])
      expect(reason(path)).toBe('ok');
  });

  it.each([
    ['../a', 'traversal'], ['a/../b', 'traversal'], ['a/./b', 'traversal'], ['./a', 'traversal'], ['a/..', 'traversal'],
    ['/etc/passwd', 'absolute'], ['~/.zshrc', 'absolute'], ['~user/x', 'absolute'],
    ['C:\\Windows\\x', 'drive'], ['c:/x', 'drive'], ['C:x', 'drive'], ['D:', 'drive'],
    ['\\\\server\\share\\x', 'unc'], ['//server/share/x', 'unc'], ['\\\\?\\C:\\x', 'unc'], ['\\\\.\\pipe\\x', 'unc'],
    ['a\\b', 'backslash'], ['src/a\\b.ts', 'backslash'], ['a\\..\\b', 'traversal'], ['src\\..\\..\\x', 'traversal'],
    ['a//b', 'empty_segment'], ['a/', 'empty_segment'], ['', 'empty_segment'],
    ['a\u0000b', 'control_char'], ['a\nb', 'control_char'], ['a\u0085b', 'control_char'],
    ['evil\u202etxt.exe', 'invisible_char'], ['a\u200bb', 'invisible_char'], ['\ufeffa', 'invisible_char'],
    ['file.txt:stream', 'reserved_char'], ['a*b', 'reserved_char'], ['a?b', 'reserved_char'], ['a"b', 'reserved_char'], ['a<b>', 'reserved_char'], ['a|b', 'reserved_char'],
    ['CON', 'reserved_name'], ['con.txt', 'reserved_name'], ['src/NUL.tar.gz', 'reserved_name'], ['Com1', 'reserved_name'], ['lpt9.log', 'reserved_name'], ['COM¹', 'reserved_name'],
    ['aux/x.ts', 'reserved_name'], ['CONIN$', 'reserved_name'],
    ['name.', 'trailing_dot_space'], ['dir. /x', 'trailing_dot_space'], ['name ', 'trailing_dot_space'], ['a/b ./c', 'trailing_dot_space'],
    [`${'a'.repeat(256)}`, 'segment_too_long'], [`${'文'.repeat(86)}`, 'segment_too_long'],
    ['.git/hooks/pre-commit', 'git_dir'], ['sub/.GIT/config', 'git_dir'],
  ])('%j → %s', (path, expected) => {
    expect(reason(path)).toBe(expected);
    expect(codeExportReasonLabels[expected as keyof typeof codeExportReasonLabels]).toBeTruthy();
  });

  it('is stricter than the R14 schema: every path R14 accepts is still checked, nothing R14 refuses gets through', () => {
    for (const path of ['../a', '/x', '~/x', 'a\\b', 'C:x', 'a//b', 'a\u0000']) {
      expect(candidatePathSchema.safeParse(path).success).toBe(false);
      expect(reason(path)).not.toBe('ok');
    }
    // R14 lets these through as text; R15 refuses them before anything touches the disk.
    for (const path of ['CON', 'a.', 'a ', '.git/x', 'a\u202eb', `${'a'.repeat(256)}`]) {
      expect(candidatePathSchema.safeParse(path).success).toBe(true);
      expect(reason(path)).not.toBe('ok');
    }
  });
});

describe('names a file system or a reader would take for something else (D127, as Git after CVE-2014-9390)', () => {
  it.each([
    // NTFS short names of .git.
    ['git~1', 'git_dir'], ['GIT~1', 'git_dir'], ['Git~2/hooks/pre-commit', 'git_dir'], ['sub/git~10/config', 'git_dir'],
    // Full-width and other compatibility forms that normalize to .git.
    ['\uff0egit', 'git_dir'], ['.\uff47\uff49\uff54/config', 'git_dir'], ['\uff0e\uff27\uff29\uff34', 'git_dir'], ['\ufe52git/hooks/x', 'git_dir'], ['\uff47\uff49\uff54~\uff11', 'git_dir'],
    // Characters that normalize to a trailing dot or space after .git, and dotless i that upper-cases to I.
    ['.\uff47it\uff0e', 'git_dir'], ['.git\u00a0', 'git_dir'], ['.git\u3000', 'git_dir'], ['.g\u0131t', 'git_dir'],
    // Forms that normalize to . or ..
    ['\uff0e', 'traversal'], ['\uff0e\uff0e', 'traversal'], ['a/\uff0e\uff0e/b', 'traversal'], ['\u2024', 'traversal'], ['\u2025', 'traversal'], ['\ufe52\ufe52/x', 'traversal'], ['\u2026', 'traversal'],
    // Separators hidden in a compatibility form, with and without a traversal behind them.
    ['\uff0e\uff0e\uff0fetc', 'traversal'], ['a\uff3c\uff0e\uff0e\uff3cb', 'traversal'], ['a\uff0fb', 'reserved_char'], ['a\uff3cb', 'reserved_char'], ['\uff0e\uff47it\uff0fhooks', 'git_dir'],
    // Compatibility forms of reserved names.
    ['\uff23\uff2f\uff2e', 'reserved_name'], ['\uff4e\uff55\uff4c.txt', 'reserved_name'], ['\uff23\uff2f\uff2d\uff11', 'reserved_name'], ['src/\uff41\uff55\uff58.ts', 'reserved_name'], ['\uff2c\uff30\uff34\uff19.log', 'reserved_name'],
  ])('%j → %s', (path, expected) => {
    expect(reason(path)).toBe(expected);
  });

  // Every code point a file system may ignore or a renderer shows as nothing: the HFS+ list Git keeps
  // (U+200C–200F, U+202A–202E, U+206A–206F, U+FEFF) and the rest of Default_Ignorable_Code_Point and Cf.
  it.each(['\u00ad', '\u034f', '\u061c', '\u115f', '\u1160', '\u17b4', '\u180b', '\u180e', '\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u202a', '\u202e', '\u2060', '\u2064', '\u2065',
    '\u206a', '\u206b', '\u206c', '\u206d', '\u206e', '\u206f', '\u3164', '\ufe00', '\ufe0f', '\ufeff', '\uffa0', '\ufff0', '\u0600', '\u06dd', '\u2028', '\u2029', '\ud83d', '\udc00',
    '\u{e0001}', '\u{e0100}', '\u{1d173}'])('%j is refused anywhere in a name, also inside .git', character => {
    expect(reason(`.g${character}it/hooks/x`)).toBe('invisible_char');
    expect(reason(`src/a${character}b.ts`)).toBe('invisible_char');
    expect(reason(`${character}.git`)).toBe('invisible_char');
  });

  it('finds a .git folder anywhere in a chosen folder\'s path', () => {
    for (const path of ['/Users/u/proj/.git', '/Users/u/proj/.GIT/hooks', '/Users/u/\uff0egit/x']) expect(insideGitDir(path, '/')).toBe(true);
    expect(insideGitDir('C:\\proj\\git~1\\hooks', '\\')).toBe(true);
    for (const path of ['/Users/u/proj', '/Users/u/.github', '/Users/u/git~/x', '/Users/u/proj.git']) expect(insideGitDir(path, '/')).toBe(false);
  });

  it('keeps names that only look unusual: real Chinese file names and names that merely resemble the refused ones', () => {
    for (const path of ['说明：第一版.md', '问题？.md', '笔记（草稿）/第１章.md', '１.txt', 'ｓｒｃ/ａ.ts', '．hidden', '…md', 'git', 'git~', 'git~a', 'mygit~1', 'git~1x', '.gitignore', '.github/x.yml', '.gitmodules',
      '.git-blame-ignore-revs', 'sub.git/config', 'caf\u00e9.ts', 'cafe\u0301.ts', '日本語/ファイル.ts', 'حساب.ts', 'emoji\u{1f600}.md'])
      expect(reason(path)).toBe('ok');
  });
});

describe('collisions and containment', () => {
  it('treats names that differ only by case or Unicode normalization as the same file', () => {
    expect(collisionKey('README.md')).toBe(collisionKey('readme.MD'));
    expect(collisionKey('caf\u00e9.ts')).toBe(collisionKey('cafe\u0301.ts'));
    expect([...findCollisions(['src/A.ts', 'src/a.ts', 'src/b.ts'])].sort()).toEqual(['src/A.ts', 'src/a.ts']);
    expect([...findCollisions(['caf\u00e9.ts', 'cafe\u0301.ts'])]).toHaveLength(2);
    // A file used as a folder by another path collides too.
    expect([...findCollisions(['lib', 'LIB/x.ts', 'other.ts'])].sort()).toEqual(['LIB/x.ts', 'lib']);
    expect(findCollisions(['a/b.ts', 'a/c.ts', 'ab.ts']).size).toBe(0);
  });

  it('compares containment by whole names, with the platform case rule', () => {
    expect(isWithin('/Users/u/proj', '/Users/u/proj/src/a.ts', '/', false)).toBe(true);
    expect(isWithin('/Users/u/proj', '/Users/u/proj', '/', false)).toBe(true);
    expect(isWithin('/Users/u/proj', '/Users/u/project/x', '/', false)).toBe(false);
    expect(isWithin('/Users/u/Proj', '/Users/u/proj/x', '/', false)).toBe(false);
    expect(isWithin('/Users/u/Proj', '/Users/u/proj/x', '/', true)).toBe(true);
    expect(isWithin('C:\\Users\\u\\AppData', 'c:\\users\\u\\appdata\\roaming\\x', '\\', true)).toBe(true);
    expect(isWithin('C:\\Users\\u\\App', 'C:\\Users\\u\\AppData', '\\', true)).toBe(false);
  });
});
