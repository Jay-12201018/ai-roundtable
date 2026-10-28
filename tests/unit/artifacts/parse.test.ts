// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseArtifact } from '../../../src/shared/schemas/artifactParse';
import { artifactKindValues, type ArtifactKind } from '../../../src/shared/schemas/artifact';
import { clone, text, validDocuments } from './fixtures';

const fails = (kind: ArtifactKind, raw: string, options?: Parameters<typeof parseArtifact>[2]) => {
  const result = parseArtifact(kind, raw, options);
  if (result.ok) throw new Error('expected a failure');
  return result.issues;
};

describe('artifact schemas and parser (D119)', () => {
  it.each(artifactKindValues)('accepts a valid %s document and normalizes it', kind => {
    const result = parseArtifact(kind, text(validDocuments[kind]), { sourceNumbers: [1, 2, 3] });
    expect(result).toMatchObject({ ok: true, content: validDocuments[kind] });
    if (result.ok) expect(JSON.parse(result.json)).toEqual(validDocuments[kind]);
  });

  it('accepts one surrounding ```json fence but nothing around it', () => {
    expect(parseArtifact('actions', '```json\n' + text(validDocuments.actions) + '\n```').ok).toBe(true);
    expect(fails('actions', '以下是清单：\n' + text(validDocuments.actions))[0]).toMatchObject({ path: '', message: expect.stringContaining('前面有多余的文字'), line: 1 });
    expect(fails('actions', text(validDocuments.actions) + '\n希望有帮助')[0]).toMatchObject({ label: 'JSON 格式', message: expect.stringContaining('后面还有多余的内容') });
  });

  it.each(artifactKindValues)('names the missing, mistyped, oversized and extra fields of a %s document, with lines', kind => {
    const document = clone(validDocuments[kind]);
    delete document.title;
    const list = Object.entries(document).find(([, value]) => Array.isArray(value))!;
    (document as Record<string, unknown>)[list[0]] = 'not a list';
    document.extra = 1;
    const issues = fails(kind, text(document));
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'title', label: '标题', message: expect.stringContaining('缺少这个字段') }),
      expect.objectContaining({ path: list[0], message: '应该是列表', line: expect.any(Number) }),
      expect.objectContaining({ path: 'extra', message: expect.stringContaining('多出了不认识的字段：extra'), line: expect.any(Number) }),
    ]));
    const long = clone(validDocuments[kind]); long.title = '长'.repeat(81);
    expect(fails(kind, text(long))[0]).toMatchObject({ path: 'title', message: '太长了：最多 80 个字符', line: 2 });
  });

  it('enforces enums, counts, identifiers and nested positions', () => {
    const prd = clone(validDocuments.prd) as { requirements: Array<Record<string, unknown>> };
    prd.requirements[1].priority = 'urgent';
    prd.requirements[1].acceptanceCriteria = [];
    prd.requirements[1].id = 'R1';
    const issues = fails('prd', text(prd));
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'requirements[1].priority', label: '需求 第 2 项 › 优先级', message: expect.stringContaining('must（必须）') }),
      expect.objectContaining({ path: 'requirements[1].acceptanceCriteria', message: '至少要有 1 项' }),
    ]));
    prd.requirements[1].priority = 'should'; prd.requirements[1].acceptanceCriteria = ['ok'];
    expect(fails('prd', text(prd))[0]).toMatchObject({ path: 'requirements[1]', message: expect.stringContaining('需求编号重复') });
    const many = clone(validDocuments.actions) as { items: unknown[] };
    many.items = Array.from({ length: 101 }, (_, index) => ({ id: `A${index + 1}`, task: 't', owner: null, due: null, status: 'todo', sources: null }));
    expect(fails('actions', text(many))[0]).toMatchObject({ path: 'items', message: '太多了：最多 100 项' });
  });

  it('keeps unknown facts explicit: null or an unknown word is null, a missing key is an error', () => {
    const actions = clone(validDocuments.actions) as { items: Array<Record<string, unknown>> };
    actions.items[0].owner = '待定'; actions.items[0].due = 'TBD';
    const result = parseArtifact('actions', text(actions));
    expect(result.ok && (result.content as typeof actions).items[0]).toMatchObject({ owner: null, due: null });
    delete actions.items[1].owner;
    expect(fails('actions', text(actions))[0]).toMatchObject({ path: 'items[1].owner', label: '事项 第 2 项 › 负责人', message: '缺少这个字段（不知道就写 null，不能省略）' });
    const prd = clone(validDocuments.prd); prd.title = null;
    expect(fails('prd', text(prd))[0]).toMatchObject({ path: 'title', message: '不能是 null，这里必须写文本' });
  });

  it('locates JSON syntax errors by line and column and says when output was cut off', () => {
    expect(fails('minutes', '{\n  "title": "a",\n  "summary": }')[0]).toMatchObject({ label: 'JSON 格式', line: 3, column: 14 });
    expect(fails('minutes', '{\n  "title": "a" "summary": 1}')[0]).toMatchObject({ message: expect.stringContaining('英文逗号'), line: 2 });
    const cut = text(validDocuments.minutes).slice(0, 120);
    expect(fails('minutes', cut)[0].message).toContain('可能被输出上限截断');
    expect(fails('minutes', '{"title": "a", "title": "b"}')[0].message).toContain('重复出现');
    expect(fails('minutes', '')[0].message).toBe('没有输出任何内容');
    expect(fails('minutes', '[]')[0].message).toContain('应该以 { 开头');
  });

  it('only allows sources among the messages the version is based on', () => {
    const issues = fails('actions', text(validDocuments.actions), { sourceNumbers: [1, 2] });
    expect(issues).toEqual([expect.objectContaining({ path: 'items[1].sources[1]', message: '第 3 条不在这次依据的发言里（第 1–2 条）', line: expect.any(Number) })]);
    const zero = clone(validDocuments.minutes) as { conclusions: Array<{ sources: unknown }> }; zero.conclusions[0].sources = [0];
    expect(fails('minutes', text(zero))[0]).toMatchObject({ path: 'conclusions[0].sources[0]' });
  });

  it('accepts only relative candidate paths and bounded code', () => {
    for (const path of ['/etc/passwd', '../escape.ts', 'a//b.ts', 'C:\\x.ts', '~/x', 'a/./b']) {
      const code = clone(validDocuments.code) as { files: Array<Record<string, unknown>> }; code.files[0].path = path;
      expect(fails('code', text(code))[0]).toMatchObject({ path: 'files[0].path' });
    }
    const twice = clone(validDocuments.code) as { files: Array<Record<string, unknown>> }; twice.files.push({ ...twice.files[0], path: 'SRC/order/validate.ts' });
    expect(fails('code', text(twice))[0].message).toContain('文件路径重复');
    const huge = clone(validDocuments.code) as { files: Array<Record<string, unknown>> }; huge.files[0].content = 'x'.repeat(200_001);
    expect(fails('code', text(huge))[0]).toMatchObject({ path: 'files[0].content', message: '太长了：最多 200000 个字符' });
  });

  it('treats Markdown, HTML and script as plain text: valid content, nothing interpreted', () => {
    const minutes = clone(validDocuments.minutes); minutes.summary = '<script>alert(1)</script> **粗体** <img src=x onerror=alert(2)>';
    const result = parseArtifact('minutes', text(minutes));
    expect(result.ok && (result.content as { summary: string }).summary).toBe('<script>alert(1)</script> **粗体** <img src=x onerror=alert(2)>');
  });
});
