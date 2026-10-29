import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { actionStatusLabels, priorityLabels, type ActionsContent, type CodeContent, type MinutesContent, type PrdContent, type TypedArtifactContent } from '../../../shared/schemas/artifact';
import { Markdown } from '../timeline';

/**
 * R14: the structured, read-only view of a valid document. Everything a model wrote is untrusted text: long fields go
 * through the sanitized Markdown renderer, short ones are plain React text, and code is shown, never run or saved.
 */
type Reveal = (number: number) => void;

function Unknown({ what }: { what: string }) {
  return <span className="art-unknown" title={`讨论里没有明确${what}，模型按要求留作未知`}>未知</span>;
}
function Sources({ numbers, onReveal }: { numbers: number[] | null; onReveal?: Reveal }) {
  if (!numbers) return <span className="art-sources"><span className="muted">来源</span><Unknown what="出处" /></span>;
  return <span className="art-sources"><span className="muted">来源</span>
    {numbers.map(number => onReveal
      ? <button key={number} type="button" className="art-source" title={`回到时间线里的第 ${number} 条发言`} onClick={() => onReveal(number)}>第 {number} 条</button>
      : <span key={number} className="art-source">第 {number} 条</span>)}</span>;
}
function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return <section className="art-sec"><h3>{title}{count !== undefined && <span className="muted"> {count}</span>}</h3>{children}</section>;
}
const Bullets = ({ items, empty = '无' }: { items: string[]; empty?: string }) =>
  items.length ? <ul className="art-list">{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="muted small">{empty}</p>;

function Prd({ data, onReveal }: { data: PrdContent; onReveal?: Reveal }) {
  return <>
    <Section title="背景">{data.background ? <Markdown text={data.background} /> : <p><Unknown what="背景" /></p>}</Section>
    <Section title="目标"><Bullets items={data.goals} /></Section>
    <Section title="需求" count={data.requirements.length}>
      {data.requirements.map(item => <article key={item.id} className="art-card">
        <header><span className="art-id">{item.id}</span><b>{item.title}</b><span className={`tag${item.priority === 'must' ? ' is-accent' : ''}`}>{priorityLabels[item.priority]}</span></header>
        <Markdown text={item.description} />
        <p className="art-label">验收标准</p>
        <ul className="art-checks">{item.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>
        <Sources numbers={item.sources} onReveal={onReveal} />
      </article>)}
    </Section>
    <Section title="不做的事"><Bullets items={data.nonGoals} /></Section>
    <Section title="待解决的问题"><Bullets items={data.openQuestions} /></Section>
  </>;
}

function Minutes({ data, onReveal }: { data: MinutesContent; onReveal?: Reveal }) {
  return <>
    <Section title="概要"><Markdown text={data.summary} /></Section>
    <Section title="参与者">{data.participants.length ? <p>{data.participants.join('、')}</p> : <p className="muted small">未记录</p>}</Section>
    <Section title="结论" count={data.conclusions.length}>
      <ul className="art-points">{data.conclusions.map((item, index) => <li key={index}><span>{item.text}</span><Sources numbers={item.sources} onReveal={onReveal} /></li>)}</ul></Section>
    <Section title="决策" count={data.decisions.length}>
      {data.decisions.length ? data.decisions.map((item, index) => <article key={index} className="art-card">
        <p className="art-strong">{item.text}</p>
        <dl className="art-facts"><dt>理由</dt><dd>{item.rationale ?? <Unknown what="理由" />}</dd><dt>决定人</dt><dd>{item.decidedBy ?? <Unknown what="是谁决定的" />}</dd></dl>
        <Sources numbers={item.sources} onReveal={onReveal} />
      </article>) : <p className="muted small">讨论里没有明确做出的决定。</p>}</Section>
    <Section title="遗留问题" count={data.openIssues.length}>
      {data.openIssues.length ? <ul className="art-points">{data.openIssues.map((item, index) => <li key={index}><span>{item.text}</span><Sources numbers={item.sources} onReveal={onReveal} /></li>)}</ul>
        : <p className="muted small">无</p>}</Section>
  </>;
}

function Actions({ data, onReveal }: { data: ActionsContent; onReveal?: Reveal }) {
  const unknownOwners = data.items.filter(item => item.owner === null).length;
  return <Section title="事项" count={data.items.length}>
    {unknownOwners > 0 && <p className="small muted">{unknownOwners} 项没有明确负责人，标为“未知”；需要的话请自己指派。</p>}
    <ol className="art-actions">{data.items.map(item => <li key={item.id} className="art-card">
      <header><span className="art-id">{item.id}</span><b>{item.task}</b><span className={`tag art-status is-${item.status}`}>{actionStatusLabels[item.status]}</span></header>
      <dl className="art-facts"><dt>负责人</dt><dd>{item.owner ?? <Unknown what="负责人" />}</dd><dt>截止时间</dt><dd>{item.due ?? <Unknown what="截止时间" />}</dd></dl>
      <Sources numbers={item.sources} onReveal={onReveal} />
    </li>)}</ol>
  </Section>;
}

/** A fence longer than any backtick run in the code, so model code can never close it and escape into Markdown. */
const fenced = (language: string | null, content: string) => {
  const marker = '`'.repeat(Math.max(3, ...[...content.matchAll(/`+/gu)].map(match => match[0].length + 1)));
  return `${marker}${language ?? ''}\n${content}\n${marker}`;
};
function Code({ data }: { data: CodeContent }) {
  return <>
    <p className="art-safe"><ShieldCheck aria-hidden size={16} />这些代码不会被执行。采用之后可以写入你选的文件夹，写之前会逐个文件列出差异，由你勾选。</p>
    <Section title="说明"><Markdown text={data.summary} /></Section>
    <Section title="文件" count={data.files.length}>
      {data.files.map(file => <article key={file.path} className="art-file">
        <header><code className="art-path">{file.path}</code><span className="muted small">{file.language ?? '语言未知'} · {file.content.split('\n').length} 行</span></header>
        {file.description && <p className="small">{file.description}</p>}
        <Markdown text={fenced(file.language, file.content)} />
      </article>)}
    </Section>
    {data.notes.length > 0 && <Section title="备注"><Bullets items={data.notes} /></Section>}
  </>;
}

export function ArtifactContentView({ content, onReveal }: { content: TypedArtifactContent; onReveal?: Reveal }) {
  return <div className="art-doc">
    <h2 className="art-title">{content.data.title}</h2>
    {content.kind === 'prd' ? <Prd data={content.data} onReveal={onReveal} />
      : content.kind === 'minutes' ? <Minutes data={content.data} onReveal={onReveal} />
        : content.kind === 'actions' ? <Actions data={content.data} onReveal={onReveal} /> : <Code data={content.data} />}
  </div>;
}
