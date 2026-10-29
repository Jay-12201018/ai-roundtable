// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkCandidatePath, collisionKey, findCollisions, isWithin } from '../../../src/main/export/paths';
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
