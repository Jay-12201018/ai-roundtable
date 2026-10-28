import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, FilePen, RefreshCw, Square } from 'lucide-react';
import type { RunSnapshot } from '../../../shared/types/run';
import { artifactKindLabels, artifactStatusLabels, type ArtifactIssue, type ArtifactSummary, type ArtifactVersion, type ArtifactVersionDetail } from '../../../shared/schemas/artifact';
import { parseArtifact } from '../../../shared/schemas/artifactParse';
import { Button, Modal, Note, Tabs, cx } from '../../components/ui';
import type { HostCommands } from '../host/useHostCommands';
import { ArtifactContentView } from './ArtifactContent';
import type { ArtifactCommands } from './useArtifacts';

const originLabels: Record<ArtifactVersion['origin'], string> = { generate: '生成', regenerate: '重新生成', edit: '你修改的' };
const statusTone: Record<ArtifactVersion['status'], string> = { generating: 'is-live', failed: 'is-danger', invalid: 'is-danger', candidate: 'is-warn', valid: 'is-ok', exported: 'is-ok' };
const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
/** Unsaved edits survive closing the reader (per version, for this window), so closing is never destructive. */
const drafts = new Map<string, string>();

export function StatusPill({ version }: { version: ArtifactVersion }) {
  return <span className={cx('pill', statusTone[version.status])}>{version.status === 'generating' && <span className="dot" />}{artifactStatusLabels[version.status]}</span>;
}

function statusText(version: ArtifactVersion): string {
  switch (version.status) {
    case 'generating': return `正在生成：已收到 ${version.outputChars.toLocaleString('zh-CN')} 个字符。完成后会自动检查格式。`;
    case 'failed': return version.request?.status === 'interrupted' ? '应用退出时这次请求还没完成，已标为中断，没有自动重发。下面是已收到的部分。'
      : version.request?.status === 'aborted' ? '这次请求已中止，没有自动重试。下面是已收到的部分。' : '这次请求失败了，没有自动重试。下面是已收到的部分。';
    case 'invalid': return `格式检查没有通过：${version.issues.length} 处问题。原始输出完整保留，没有自动重试；可以修改后保存为新版本，或重新生成（会再发送 1 次请求）。`;
    case 'candidate': return '模型整理的候选版本，已通过格式检查。请核对内容，没问题就采用；采用之后才能复制和导出。';
    case 'valid': return version.origin === 'edit' ? '你修改的版本，已通过格式检查，可以复制和导出。' : `已采用（${when(version.adoptedAt!)}），可以复制和导出。`;
    case 'exported': return `有效，最近一次导出在 ${when(version.exportedAt!)}。`;
  }
}

function IssueList({ issues, onPick }: { issues: ArtifactIssue[]; onPick?: (issue: ArtifactIssue) => void }) {
  return <ol className="art-issues" aria-label="需要修改的地方">{issues.map((issue, index) => <li key={index}>
    {onPick && issue.line ? <button type="button" className="link-btn" onClick={() => onPick(issue)}>第 {issue.line} 行</button> : issue.line ? <span className="muted">第 {issue.line} 行</span> : null}
    <b>{issue.label}</b><span>{issue.message}</span></li>)}</ol>;
}

/** The numbers an edited version may cite: the messages (and a summary's range) the version is based on. */
const citable = (detail: ArtifactVersionDetail) => [...new Set(detail.sources.flatMap(source => source.summary
  ? Array.from({ length: source.summary.lastNumber }, (_, index) => index + 1) : source.number ? [source.number] : []))];

function Editor({ detail, commands, onSaved, onCancel }: { detail: ArtifactVersionDetail; commands: ArtifactCommands; onSaved: (versionId: string) => void; onCancel: () => void }) {
  const initial = detail.content ? JSON.stringify(detail.content.data, null, 2) : detail.rawOutput;
  const [text, setText] = useState(() => drafts.get(detail.version.versionId) ?? initial);
  const area = useRef<HTMLTextAreaElement>(null);
  const numbers = useMemo(() => citable(detail), [detail]);
  const result = useMemo(() => parseArtifact(detail.kind, text, { sourceNumbers: numbers }), [detail.kind, text, numbers]);
  useEffect(() => { if (text === initial) drafts.delete(detail.version.versionId); else drafts.set(detail.version.versionId, text); }, [text, initial, detail.version.versionId]);
  const pick = (issue: ArtifactIssue) => {
    const element = area.current; if (!element || !issue.line) return;
    const lines = text.split('\n'); const start = lines.slice(0, issue.line - 1).reduce((sum, line) => sum + line.length + 1, 0);
    element.focus(); element.setSelectionRange(start, start + (lines[issue.line - 1]?.length ?? 0));
    element.scrollTop = Math.max(0, (issue.line - 4) * 20);
  };
  const save = async () => {
    if (!result.ok) return;
    const saved = await commands.edit(detail.version.versionId, text);
    if (saved) { drafts.delete(detail.version.versionId); onSaved(saved.versionId); }
  };
  const busy = commands.pending === `edit:${detail.version.versionId}`;
  return <div className="art-editor">
    <p className="small muted">按 JSON 修改：字段名不要改，不知道的写 null。保存后成为新的一版，原来的版本保留。</p>
    <textarea ref={area} className="textarea art-json" aria-label="产物 JSON" spellCheck={false} value={text} onChange={event => setText(event.target.value)} rows={18}
      aria-invalid={!result.ok} />
    <div className="art-check" role="status">{result.ok ? <span className="ok-text"><Check aria-hidden size={14} />格式正确，可以保存。</span>
      : <span className="warn-text">还有 {result.issues.length} 处问题：</span>}</div>
    {!result.ok && <IssueList issues={result.issues} onPick={pick} />}
    {commands.error?.key === `edit:${detail.version.versionId}` && <p role="alert" className="field-error">{commands.error.message}</p>}
    <div className="art-editor-actions">
      <Button onClick={onCancel} disabled={busy}>取消修改</Button>
      {text !== initial && <Button variant="quiet" onClick={() => setText(initial)} disabled={busy}>恢复原文</Button>}
      <Button variant="primary" disabled={!result.ok || busy} onClick={() => void save()}>{busy ? '正在保存…' : '保存为新版本'}</Button>
    </div>
  </div>;
}

type View = 'content' | 'raw' | 'sources';

/**
 * R14: one artifact, every version. Reading, adopting, editing, regenerating and exporting all happen here; a cited
 * message number goes back to that message in the timeline.
 */
export function ArtifactReader({ snapshot, artifact, commands, host, initialVersionId, onClose, onRegenerate, onReveal }: { snapshot: RunSnapshot; artifact: ArtifactSummary;
  commands: ArtifactCommands; host: HostCommands; initialVersionId?: string; onClose: () => void; onRegenerate: () => void; onReveal: (number: number) => void }) {
  const latest = artifact.versions.at(-1)!;
  const [selected, setSelected] = useState(initialVersionId ?? latest.versionId);
  const [follow, setFollow] = useState(!initialVersionId || initialVersionId === latest.versionId);
  // A newer version (a regeneration or an edit) is shown as soon as it exists, unless the host chose an older one.
  useEffect(() => { if (follow) setSelected(latest.versionId); }, [follow, latest.versionId]);
  const version = artifact.versions.find(item => item.versionId === selected) ?? latest;
  const [detail, setDetail] = useState<ArtifactVersionDetail>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<View>('content');
  const [saveMenu, setSaveMenu] = useState(false);
  const { getVersion } = commands;
  useEffect(() => {
    let live = true;
    getVersion(version.versionId).then(value => { if (live) { setDetail(value); setLoadFailed(false); } }).catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, [getVersion, version.versionId, version.status, version.updatedAt, version.affectedNumbers.join(',')]);
  useEffect(() => { setEditing(false); setSaveMenu(false); setView(version.status === 'invalid' || version.status === 'failed' || version.status === 'generating' ? 'raw' : 'content'); }, [version.versionId, version.status]);
  const shown = detail?.version.versionId === version.versionId ? detail : undefined;
  const effective = version.status === 'valid' || version.status === 'exported';
  const label = artifactKindLabels[artifact.kind];
  const pendingKey = commands.pending;
  const busy = pendingKey !== undefined;
  const choose = (versionId: string) => { setSelected(versionId); setFollow(versionId === latest.versionId); };
  const notice = commands.notice; const error = commands.error && !commands.error.key.startsWith('edit:') && commands.error.key !== 'generate' ? commands.error : undefined;

  const footer = editing ? undefined : <>
    {version.status === 'generating' && <Button icon={Square} disabled={host.pending !== undefined}
      onClick={() => void host.send('abort', { kind: 'abortGeneration' }, '已中止生成，已收到的部分保留。')}>中止生成</Button>}
    {version.status !== 'generating' && <>
      <Button variant="quiet" icon={RefreshCw} disabled={busy} onClick={onRegenerate}>重新生成…</Button>
      <Button variant={version.status === 'invalid' || version.status === 'failed' ? 'primary' : 'secondary'} icon={FilePen} disabled={busy || !shown}
        onClick={() => { setEditing(true); setView('content'); }}>{version.status === 'invalid' || version.status === 'failed' ? '修改为有效版本…' : '修改…'}</Button>
    </>}
    {version.status === 'candidate' && <Button variant="primary" icon={Check} disabled={busy} onClick={() => void commands.adopt(version.versionId)}>
      {pendingKey === `adopt:${version.versionId}` ? '正在采用…' : '采用这一版'}</Button>}
    {effective && <>
      <Button icon={Copy} disabled={busy} onClick={() => void commands.copy(version.versionId, 'markdown')}>复制 Markdown</Button>
      <Button icon={Copy} disabled={busy} onClick={() => void commands.copy(version.versionId, 'json')}>复制 JSON</Button>
      {artifact.kind !== 'code' && <span className="art-save">
        <Button icon={Download} disabled={busy} aria-expanded={saveMenu} onClick={() => setSaveMenu(value => !value)}>另存为…</Button>
        {saveMenu && <span className="art-save-menu" role="group" aria-label="另存为">
          <Button size="sm" onClick={() => { setSaveMenu(false); void commands.save(version.versionId, 'markdown'); }}>Markdown 文件（.md）</Button>
          <Button size="sm" onClick={() => { setSaveMenu(false); void commands.save(version.versionId, 'json'); }}>JSON 文件（.json）</Button></span>}
      </span>}
    </>}
  </>;

  return <Modal title={`${label} · 第 ${version.number} 版`} onClose={onClose} className="artifact-reader" footer={footer}
    below={<div className="art-head">
      <label className="art-version"><span className="sr-only">版本</span>
        <select className="select" aria-label="版本" value={version.versionId} onChange={event => choose(event.target.value)}>
          {[...artifact.versions].reverse().map(item => <option key={item.versionId} value={item.versionId}>
            第 {item.number} 版 · {originLabels[item.origin]} · {artifactStatusLabels[item.status]}{item.affectedNumbers.length ? ' · 受影响' : ''}</option>)}
        </select></label>
      <StatusPill version={version} />
      {version.firstNumber !== undefined && <span className="small muted">依据第 {version.firstNumber}–{version.lastNumber} 条发言</span>}
    </div>}>
    <p className={cx('art-status-text', version.status === 'invalid' || version.status === 'failed' ? 'is-bad' : undefined)} role="status">{statusText(version)}</p>
    {version.affectedNumbers.length > 0 && version.status !== 'generating' && <Note icon={AlertTriangle}
      action={<Button size="sm" disabled={busy} onClick={onRegenerate}>重新生成…</Button>}>
      <b>受影响：</b>依据的第 {version.affectedNumbers.join('、')} 条发言在这一版写成后被修改或重新生成，内容可能已经过时。可以重新生成，或者自己修改。</Note>}
    {notice && <p role="status" className="ok-text small">{notice.message}</p>}
    {error && <p role="alert" className="field-error">{error.message}</p>}
    {artifact.kind === 'code' && effective && <p className="small muted">代码候选不能在这里存成文件：写入磁盘会在后续版本提供，并且逐个文件确认。现在可以复制。</p>}
    {loadFailed && !shown ? <p role="alert" className="field-error">读取这一版失败。<button type="button" className="link-btn" onClick={() => setLoadFailed(false)}>重试</button></p>
      : !shown ? <p role="status" className="muted">正在读取…</p>
      : editing ? <Editor key={shown.version.versionId} detail={shown} commands={commands} onCancel={() => setEditing(false)}
        onSaved={versionId => { setEditing(false); setSelected(versionId); setFollow(true); }} />
      : <>
        <Tabs idPrefix="art" label="查看方式" value={view} onChange={setView} tabs={[...(shown.content ? [{ id: 'content' as const, label: '内容' }] : []),
          { id: 'raw', label: version.origin === 'edit' ? 'JSON' : '原始输出' }, { id: 'sources', label: '依据', count: shown.sources.length }]} />
        <div className="art-body" role="tabpanel" id={`art-panel-${view}`} aria-labelledby={`art-tab-${view}`}>
          {view === 'content' && shown.content ? <ArtifactContentView content={shown.content} onReveal={onReveal} />
            : view === 'sources' ? <ul className="art-basis">{shown.sources.map(source => <li key={source.messageId} className={source.active ? undefined : 'is-stale'}>
              {source.summary ? <span>讨论摘要（第 {source.summary.firstNumber}–{source.summary.lastNumber} 条）</span>
                : source.number ? <button type="button" className="art-source" onClick={() => onReveal(source.number!)}>第 {source.number} 条</button> : null}
              <span>{source.speaker}</span>{!source.active && <span className="tag is-warn">之后被修改</span>}</li>)}</ul>
            : <>
              {version.issues.length > 0 && <IssueList issues={version.issues} />}
              {shown.rawOutput ? <pre className="art-raw" aria-label="原始输出">{shown.rawOutput.split('\n').map((line, index) =>
                <span key={index} className={version.issues.some(issue => issue.line === index + 1) ? 'is-bad' : undefined}><i aria-hidden>{index + 1}</i>{line}{'\n'}</span>)}</pre>
                : <p className="muted small">{version.status === 'generating' ? '还没有收到内容。' : '没有收到任何内容。'}</p>}
            </>}
        </div>
      </>}
  </Modal>;
}

