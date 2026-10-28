import type { z } from 'zod';
import { artifactContentSchemas, MAX_ARTIFACT_ISSUES, type ArtifactContent, type ArtifactIssue, type ArtifactKind } from './artifact';

/**
 * D119: one parser for model output and the host's own edits, used by Main (authoritative) and by the editor (live).
 * Accepts exactly one JSON object, optionally inside a single ```json fence; anything around it is an error, not
 * something to guess past. Every problem names its field and, where the text has one, its line.
 */
export type ArtifactParseResult =
  | { ok: true; content: ArtifactContent; json: string }
  | { ok: false; issues: ArtifactIssue[] };

type Path = Array<string | number>;
type Located = { value: unknown; offsets: Map<string, number> };
class SyntaxProblem extends Error { constructor(message: string, readonly offset: number) { super(message); } }

const pathKey = (path: readonly PropertyKey[]) => path.map(part => typeof part === 'number' ? `[${part}]` : `.${String(part)}`).join('');
export const formatIssuePath = (path: readonly PropertyKey[]) => pathKey(path).replace(/^\./u, '');

/** A strict RFC 8259 reader that also records where each value starts, so errors can point at a line. */
function readJson(text: string, base: number): Located {
  const offsets = new Map<string, number>();
  let index = 0;
  const fail = (message: string, at = index): never => { throw new SyntaxProblem(message, base + at); };
  const space = () => { while (index < text.length && ' \t\n\r'.includes(text[index])) index++; };
  const value = (path: Path): unknown => {
    space();
    offsets.set(pathKey(path), base + index);
    const char = text[index];
    if (char === '{') return object(path);
    if (char === '[') return array(path);
    if (char === '"') return string();
    if (char === '-' || (char >= '0' && char <= '9')) return number();
    for (const [word, result] of [['true', true], ['false', false], ['null', null]] as const) if (text.startsWith(word, index)) { index += word.length; return result; }
    return fail(index >= text.length ? 'JSON 不完整：内容在这里中断了（可能被输出上限截断）' : `这里应该是一个值，却是“${text[index]}”`);
  };
  const object = (path: Path) => {
    index++; const result: Record<string, unknown> = {}; space();
    if (text[index] === '}') { index++; return result; }
    for (;;) {
      space();
      if (text[index] !== '"') fail(index >= text.length ? 'JSON 不完整：对象没有结束（可能被输出上限截断）' : '字段名要用英文双引号括起来');
      const keyAt = index; const key = string();
      if (Object.hasOwn(result, key)) fail(`字段“${key}”重复出现`, keyAt);
      space(); if (text[index] !== ':') fail('字段名后面应该是英文冒号 :');
      index++; result[key] = value([...path, key]); space();
      if (text[index] === ',') { index++; continue; }
      if (text[index] === '}') { index++; return result; }
      fail(index >= text.length ? 'JSON 不完整：对象没有结束（可能被输出上限截断）' : '字段之间应该用英文逗号分隔，或者在这里用 } 结束');
    }
  };
  const array = (path: Path) => {
    index++; const result: unknown[] = []; space();
    if (text[index] === ']') { index++; return result; }
    for (;;) {
      result.push(value([...path, result.length])); space();
      if (text[index] === ',') { index++; continue; }
      if (text[index] === ']') { index++; return result; }
      fail(index >= text.length ? 'JSON 不完整：列表没有结束（可能被输出上限截断）' : '列表项之间应该用英文逗号分隔，或者在这里用 ] 结束');
    }
  };
  const string = () => {
    const start = index++;
    let result = '';
    for (;;) {
      if (index >= text.length) fail('JSON 不完整：文本没有结束引号（可能被输出上限截断）', start);
      const char = text[index];
      if (char === '"') { index++; return result; }
      if (char < ' ') fail('文本里的换行和控制字符要写成 \\n 这样的转义');
      if (char !== '\\') { result += char; index++; continue; }
      const escape = text[index + 1];
      const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (escape in simple) { result += simple[escape]; index += 2; continue; }
      if (escape === 'u' && /^[0-9a-fA-F]{4}$/u.test(text.slice(index + 2, index + 6))) { result += String.fromCharCode(parseInt(text.slice(index + 2, index + 6), 16)); index += 6; continue; }
      fail('无效的转义字符');
    }
  };
  const number = () => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(index));
    if (!match) fail('数字格式不对');
    index += match![0].length;
    return Number(match![0]);
  };
  const result = value([]);
  space();
  if (index < text.length) fail('JSON 后面还有多余的内容；只输出一个 JSON 对象');
  return { value: result, offsets };
}

/** Line and column (1-based) of an offset in the original text. */
function lineOf(raw: string, offset: number): { line: number; column: number } {
  const before = raw.slice(0, Math.max(0, Math.min(offset, raw.length)));
  const lines = before.split('\n');
  return { line: lines.length, column: lines.at(-1)!.length + 1 };
}

const fieldLabels: Record<string, string> = {
  title: '标题', background: '背景', goals: '目标', requirements: '需求', id: '编号', description: '说明', priority: '优先级',
  acceptanceCriteria: '验收标准', sources: '来源', nonGoals: '不做的事', openQuestions: '待解决的问题', summary: '概要', participants: '参与者',
  conclusions: '结论', decisions: '决策', text: '内容', rationale: '理由', decidedBy: '决定人', openIssues: '遗留问题', items: '事项',
  task: '事项', owner: '负责人', due: '截止时间', status: '状态', files: '文件', path: '路径', language: '语言', content: '代码', notes: '备注',
};
/** “需求 第 3 项 › 验收标准 第 1 条” for `requirements[2].acceptanceCriteria[0]`. */
export function issueLabel(path: readonly PropertyKey[]): string {
  if (!path.length) return '整个 JSON';
  const parts: string[] = [];
  for (const part of path) {
    if (typeof part === 'number') parts[parts.length - 1] = `${parts.at(-1) ?? ''} 第 ${part + 1} 项`.trim();
    else parts.push(fieldLabels[String(part)] ?? String(part));
  }
  return parts.join(' › ');
}

const typeNames: Record<string, string> = { string: '文本', number: '数字', array: '列表', object: '对象', boolean: '是或否' };
const valueAt = (value: unknown, path: readonly PropertyKey[]) => path.reduce<unknown>((current, part) => current !== null && typeof current === 'object' ? (current as Record<PropertyKey, unknown>)[part] : undefined, value);
const enumNames: Record<string, string> = { must: 'must（必须）', should: 'should（应该）', could: 'could（可以）', todo: 'todo（未开始）', doing: 'doing（进行中）', done: 'done（已完成）', blocked: 'blocked（受阻）' };

function zodMessage(issue: z.core.$ZodIssue, root: unknown): string {
  const parent = issue.path.length ? valueAt(root, issue.path.slice(0, -1)) : undefined;
  const key = issue.path.at(-1);
  switch (issue.code) {
    case 'invalid_type':
      if (parent !== null && typeof parent === 'object' && key !== undefined && !Object.hasOwn(parent, key)) return '缺少这个字段（不知道就写 null，不能省略）';
      if (valueAt(root, issue.path) === null) return `不能是 null，这里必须写${typeNames[issue.expected] ?? issue.expected}`;
      return `应该是${typeNames[issue.expected] ?? issue.expected}`;
    case 'too_small':
      if (issue.origin === 'string') return '不能为空';
      if (issue.origin === 'array') return `至少要有 ${String(issue.minimum)} 项`;
      return `不能小于 ${String(issue.minimum)}`;
    case 'too_big':
      if (issue.origin === 'string') return `太长了：最多 ${String(issue.maximum)} 个字符`;
      if (issue.origin === 'array') return `太多了：最多 ${String(issue.maximum)} 项`;
      return `不能大于 ${String(issue.maximum)}`;
    case 'invalid_value': return `只能是 ${issue.values.map(value => enumNames[String(value)] ?? JSON.stringify(value)).join('、')} 之一`;
    case 'unrecognized_keys': return `多出了不认识的字段：${issue.keys.join('、')}`;
    case 'invalid_format': return issue.message.startsWith('Invalid') ? '格式不对' : issue.message;
    default: return /^[A-Za-z]/u.test(issue.message) ? '内容不符合要求' : issue.message;
  }
}

/** Strips one surrounding ```json fence; returns where the JSON starts in the original text. */
function unwrap(raw: string): { body: string; base: number } {
  const fence = /^(\s*)```[ \t]*(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```\s*$/u.exec(raw);
  if (fence) return { body: fence[2], base: raw.indexOf('\n', fence[1].length) + 1 };
  return { body: raw, base: 0 };
}

export function parseArtifact(kind: ArtifactKind, raw: string, options: { sourceNumbers?: readonly number[] } = {}): ArtifactParseResult {
  const at = (offset: number | undefined) => offset === undefined ? {} : lineOf(raw, offset);
  if (!raw.trim()) return { ok: false, issues: [{ path: '', label: '整个 JSON', message: '没有输出任何内容' }] };
  const { body, base } = unwrap(raw);
  const start = body.search(/\S/u);
  if (body[start] !== '{') {
    const brace = body.indexOf('{');
    return { ok: false, issues: [{ path: '', label: '整个 JSON', message: brace > 0 ? 'JSON 前面有多余的文字；只输出一个 JSON 对象，不要写说明' : '输出不是 JSON 对象（应该以 { 开头）', ...at(base + start) }] };
  }
  let located: Located;
  try { located = readJson(body, base); }
  catch (error) {
    if (!(error instanceof SyntaxProblem)) throw error;
    return { ok: false, issues: [{ path: '', label: 'JSON 格式', message: error.message, ...at(error.offset) }] };
  }
  const parsed = artifactContentSchemas[kind].safeParse(located.value);
  const issues: ArtifactIssue[] = [];
  const locate = (path: readonly PropertyKey[]) => {
    for (let length = path.length; length >= 0; length--) {
      const offset = located.offsets.get(pathKey(path.slice(0, length)));
      if (offset !== undefined) return at(offset);
    }
    return {};
  };
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.code === 'unrecognized_keys' && issue.keys.length === 1 ? [...issue.path, issue.keys[0]] : issue.path;
      issues.push({ path: formatIssuePath(path), label: issueLabel(path), message: zodMessage(issue, located.value), ...locate(path) });
    }
  }
  if (options.sourceNumbers) {
    // D121: an item may only cite messages this version is based on. Checked on what was read even when other fields
    // are wrong, so every problem is listed at once; a sources list that already has a schema problem is left to it.
    const allowed = new Set(options.sourceNumbers);
    const range = options.sourceNumbers.length ? `第 ${Math.min(...options.sourceNumbers)}–${Math.max(...options.sourceNumbers)} 条` : '没有可引用的发言';
    const reported = issues.map(issue => issue.path);
    const covered = (path: string) => reported.some(item => item === path || item.startsWith(`${path}[`) || item.startsWith(`${path}.`) || path.startsWith(`${item}[`) || path.startsWith(`${item}.`));
    const visit = (value: unknown, path: Array<string | number>) => {
      if (Array.isArray(value)) value.forEach((item, index) => visit(item, [...path, index]));
      else if (value !== null && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
          if (key === 'sources' && Array.isArray(nested)) {
            if (covered(formatIssuePath([...path, key]))) continue;
            nested.forEach((number, index) => {
              if (!allowed.has(number as number)) issues.push({ path: formatIssuePath([...path, key, index]), label: issueLabel([...path, key, index]),
                message: `第 ${String(number)} 条不在这次依据的发言里（${range}）`, ...locate([...path, key, index]) });
            });
          } else if (key !== 'content') visit(nested, [...path, key]);
        }
      }
    };
    visit(parsed.success ? parsed.data : located.value, []);
  }
  // In reading order; problems of the whole document (no line) first.
  if (issues.length) return { ok: false, issues: issues.map((issue, index) => ({ issue, index })).sort((a, b) => (a.issue.line ?? 0) - (b.issue.line ?? 0) || a.index - b.index)
    .map(item => item.issue).slice(0, MAX_ARTIFACT_ISSUES) };
  if (!parsed.success) throw new Error('unreachable: a failed schema always has issues');
  const content = parsed.data as ArtifactContent;
  return { ok: true, content, json: JSON.stringify(content, null, 2) };
}
