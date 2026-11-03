import { Code, FileText, ListChecks, NotebookPen, type LucideIcon } from 'lucide-react';
import type { RunSnapshot } from '../../../shared/types/run';
import { artifactKindLabels, artifactKindValues, type ArtifactKind, type ArtifactSummary } from '../../../shared/schemas/artifact';
import { Button } from '../../components/ui';
import { kindDescriptions } from './GenerateDialog';
import { StatusPill } from './ArtifactReader';
import type { ArtifactCommands } from './useArtifacts';

const icons: Record<ArtifactKind, LucideIcon> = { prd: FileText, minutes: NotebookPen, actions: ListChecks, code: Code };
const settled = ['paused', 'completed', 'error', 'cancelled', 'interrupted'];

const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
/** R15: the latest write of any version that put at least one file on disk. */
const lastWrite = (artifact: ArtifactSummary) => artifact.versions.flatMap(version => version.codeWrites ?? []).filter(entry => entry.written > 0)
  .reduce<NonNullable<ArtifactSummary['versions'][number]['codeWrites']>[number] | undefined>((latest, entry) => !latest || entry.at > latest.at ? entry : latest, undefined);

/** Why nothing can be generated right now, in the host's words; undefined when it can. */
export function generationBlocked(snapshot: RunSnapshot, commands: ArtifactCommands): string | undefined {
  if (!commands.available) return '这个版本的应用没有产物功能。';
  if (!settled.includes(snapshot.status)) return '讨论进行中。暂停或等讨论结束后，就可以把它整理成下面这些东西。';
  if (snapshot.messages.some(message => message.status === 'streaming') || snapshot.host?.generation) return '有请求正在生成，结束后再生成产物。';
  if (commands.artifacts?.some(artifact => artifact.versions.some(version => version.status === 'generating'))) return '正在生成一份产物，完成后再生成下一份。';
  return undefined;
}

/** 本场信息 › 产物: what the discussion can become, and what it already became. */
export function ArtifactsPanel({ snapshot, commands, onGenerate, onChoose, onOpen }: { snapshot: RunSnapshot; commands: ArtifactCommands;
  onGenerate: (kind: ArtifactKind) => void; onChoose?: (kind: ArtifactKind) => void; onOpen: (artifactId: string) => void }) {
  const blocked = generationBlocked(snapshot, commands);
  return <section className="ctx-sec art-panel"><h3>整理成…</h3>
    <p className="small muted ctx-lead">把这场讨论整理成可以直接用的东西。点一下就生成，默认由综合类角色来写。每次生成发送 1 次请求。</p>
    {blocked && <p className="small art-blocked" role="note">{blocked}</p>}
    {commands.loadFailed && !commands.artifacts && <p role="alert" className="field-error small">产物读取失败。<button type="button" className="link-btn" onClick={() => void commands.reload()}>重试</button></p>}
    {artifactKindValues.map(kind => {
      const Icon = icons[kind];
      const existing = commands.artifacts?.filter(artifact => artifact.kind === kind) ?? [];
      return <div key={kind} className="artifact">
        <Icon aria-hidden size={16} />
        <div className="grow"><b>{artifactKindLabels[kind]}</b><small>{kindDescriptions[kind]}</small>
          {existing.map(artifact => { const latest = artifact.versions.at(-1)!;
            return <button key={artifact.artifactId} type="button" className="art-entry" onClick={() => onOpen(artifact.artifactId)}
              aria-label={`打开${artifactKindLabels[kind]}：第 ${latest.number} 版`}>
              <span className="art-entry-title">{latest.title ?? [...artifact.versions].reverse().find(version => version.title)?.title ?? `第 ${latest.number} 版`}</span>
              <span className="art-entry-meta"><StatusPill version={latest} />{latest.affectedNumbers.length > 0 && <span className="tag is-warn">受影响</span>}
                <span className="small muted">共 {artifact.versions.length} 版</span>
                {(() => { const write = lastWrite(artifact); return write && <span className="small muted">已写入 {write.written} 个文件 · {when(write.at)}</span>; })()}</span>
            </button>; })}
        </div>
        {existing.length === 0 && <div className="art-actions"><Button size="sm" disabled={blocked !== undefined || commands.pending !== undefined} onClick={() => onGenerate(kind)}>生成</Button>
          {onChoose && <button type="button" className="link-btn small" disabled={blocked !== undefined || commands.pending !== undefined} onClick={() => onChoose(kind)}>换人…</button>}</div>}
      </div>;
    })}
  </section>;
}
