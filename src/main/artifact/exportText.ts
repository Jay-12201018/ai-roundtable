import { actionStatusLabels, artifactKindLabels, priorityLabels, sourceNumbersText, type ActionsContent, type ArtifactKind, type ArtifactContent, type CodeContent,
  type MinutesContent, type PrdContent } from '../../shared/schemas/artifact';

/**
 * D122: export text is rendered by Main from the validated document only — never from the raw model output, the
 * request, its context or anything private — so nothing but the document the host adopted leaves the app.
 */
export type ExportMeta = { kind: ArtifactKind; versionNumber: number; firstNumber?: number; lastNumber?: number; affected: boolean };

const unknown = (value: string | null, empty = '未知') => value ?? empty;
const cited = (sources: number[] | null) => sources ? `（来源：${sourceNumbersText(sources)}发言）` : '（来源：未知）';
const list = (items: readonly string[], empty = '无') => items.length ? items.map(item => `- ${item}`).join('\n') : empty;
/** A fence longer than any backtick run in the code, so the code cannot close it early. */
const fence = (content: string) => '`'.repeat(Math.max(3, ...[...content.matchAll(/`+/gu)].map(match => match[0].length + 1)));

function prd(content: PrdContent): string[] {
  return [
    `# ${content.title}`, '## 背景', unknown(content.background, '未知（讨论中没有交代）'), '## 目标', list(content.goals),
    '## 需求', ...content.requirements.map(item => [`### ${item.id} ${item.title}（${priorityLabels[item.priority]}）`, item.description,
      '验收标准：', list(item.acceptanceCriteria), cited(item.sources)].join('\n\n')),
    '## 不做的事', list(content.nonGoals), '## 待解决的问题', list(content.openQuestions),
  ];
}
function minutes(content: MinutesContent): string[] {
  return [
    `# ${content.title}`, '## 概要', content.summary, '## 参与者', content.participants.length ? content.participants.join('、') : '未记录',
    '## 结论', content.conclusions.map(item => `- ${item.text}${cited(item.sources)}`).join('\n'),
    '## 决策', content.decisions.length ? content.decisions.map(item => `- ${item.text}\n  - 理由：${unknown(item.rationale)}\n  - 决定人：${unknown(item.decidedBy)}\n  - ${cited(item.sources).slice(1, -1)}`).join('\n') : '无',
    '## 遗留问题', content.openIssues.length ? content.openIssues.map(item => `- ${item.text}${cited(item.sources)}`).join('\n') : '无',
  ];
}
function actions(content: ActionsContent): string[] {
  const cell = (value: string) => value.replace(/\|/gu, '\\|').replace(/\s*\n\s*/gu, ' ');
  return [`# ${content.title}`, ['| 编号 | 事项 | 负责人 | 截止时间 | 状态 | 来源 |', '| --- | --- | --- | --- | --- | --- |',
    ...content.items.map(item => `| ${item.id} | ${cell(item.task)} | ${cell(unknown(item.owner))} | ${cell(unknown(item.due))} | ${actionStatusLabels[item.status]} | ${item.sources ? sourceNumbersText(item.sources) : '未知'} |`)].join('\n')];
}
function code(content: CodeContent): string[] {
  return [`# ${content.title}`, content.summary, '> 代码候选：未经执行，也没有写入任何文件。使用前请自行审查。',
    ...content.files.map(file => { const marker = fence(file.content);
      return [`## ${file.path}`, ...(file.description ? [file.description] : []), `${marker}${file.language ?? ''}\n${file.content}\n${marker}`].join('\n\n'); }),
    ...(content.notes.length ? ['## 备注', list(content.notes)] : [])];
}

export function markdownExport(content: ArtifactContent, meta: ExportMeta): string {
  const body = meta.kind === 'prd' ? prd(content as PrdContent) : meta.kind === 'minutes' ? minutes(content as MinutesContent)
    : meta.kind === 'actions' ? actions(content as ActionsContent) : code(content as CodeContent);
  const range = meta.lastNumber ? `，依据讨论第 ${meta.firstNumber}–${meta.lastNumber} 条发言` : '';
  const footer = `---\n由 AI 圆桌整理的${artifactKindLabels[meta.kind]}，第 ${meta.versionNumber} 版${range}。${meta.affected ? '依据的部分发言后来被修改过，内容可能已经过时。' : ''}AI 整理的内容可能有误，使用前请核对。`;
  return [...body, footer].join('\n\n') + '\n';
}

export function jsonExport(content: ArtifactContent, meta: ExportMeta): string {
  return JSON.stringify({ format: 'ai-roundtable.artifact/v1', kind: meta.kind, version: meta.versionNumber,
    ...(meta.lastNumber ? { basedOnMessages: { first: meta.firstNumber, last: meta.lastNumber } } : {}), affected: meta.affected, content }, null, 2) + '\n';
}
