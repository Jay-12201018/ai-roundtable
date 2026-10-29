import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, FolderOpen, Minus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { CodeExportApiContract } from '../../../shared/contracts/app';
import type { CodeContent } from '../../../shared/schemas/artifact';
import {
  codeExportReasonLabels, codeExportRootRefusalLabels, codeExportStatusLabels,
  type CodeExportDiff, type CodeExportPreview, type CodeExportPreviewFile, type CodeExportRoot, type CodeExportWriteResult,
} from '../../../shared/schemas/codeExport';
import { Button, Modal, Note, cx } from '../../components/ui';

let fallbackCounter = 0;
const newRequestId = () => globalThis.crypto?.randomUUID?.() ?? `code-export-${Date.now()}-${++fallbackCounter}`;
/** The folder chosen last in this window. Main forgets it on restart, so it is never written down anywhere. */
let lastRoot: CodeExportRoot | undefined;
export const forgetLastRoot = () => { lastRoot = undefined; };

const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const size = (bytes: number) => bytes < 1024 ? `${bytes} 字节` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const errorText = (failure: unknown, step: 'choose' | 'preview' | 'write') => {
  const code = typeof failure === 'object' && failure !== null ? (failure as { code?: string }).code : undefined;
  if (code === 'invalid_state') return '这一版已经不是最新的有效版本（可能刚保存或采用了新版本）。请关闭后打开最新的一版再写入。';
  if (code === 'not_found') return step === 'write' ? '这次检查的结果已经失效，请重新检查。' : '这个文件夹已被移动或替换，或者应用重启过。请重新选择文件夹。';
  if (code === 'transport_error') return '与主进程的连接失败，请重试。';
  return step === 'write' ? '写入没有完成，请重新检查后再试。' : '操作没有完成，请重试。';
};
const statusTone: Record<CodeExportPreviewFile['status'], string> = { create: 'is-ok', overwrite: 'is-danger', same: '', conflict: 'is-warn', invalid: 'is-warn' };

function Lines({ content }: { content: string }) {
  const lines = content.replace(/\n$/u, '').split('\n');
  return <pre className="cx-code" aria-label="文件内容">{lines.map((line, index) => <span key={index}><i aria-hidden>{index + 1}</i>{line}{'\n'}</span>)}</pre>;
}

const unavailable: Record<Extract<CodeExportDiff, { kind: 'unavailable' }>['reason'], string> = {
  binary: '现有文件不是文本，无法逐行对比。覆盖后，原来的内容会整份被替换。',
  too_large: '文件太大，不显示逐行差异。覆盖后，原来的内容会整份被替换。',
  too_many_changes: '改动太多，不显示逐行差异；基本相当于整份替换。',
};
function Diff({ diff }: { diff: CodeExportDiff }) {
  if (diff.kind === 'unavailable') return <p className="cx-note small">{unavailable[diff.reason]}</p>;
  return <div className="cx-diff" role="group" aria-label="与现有文件的差异">
    {diff.hunks.map((hunk, index) => {
      let oldLine = hunk.oldStart, newLine = hunk.newStart;
      return <pre key={index} className="cx-hunk">
        <span className="cx-hunk-head">现有第 {hunk.oldStart}–{hunk.oldStart + Math.max(0, hunk.oldCount - 1)} 行 → 新第 {hunk.newStart}–{hunk.newStart + Math.max(0, hunk.newCount - 1)} 行{'\n'}</span>
        {hunk.lines.map((line, at) => {
          const numbers = line.op === 'add' ? ['', newLine++] : line.op === 'remove' ? [oldLine++, ''] : [oldLine++, newLine++];
          return <span key={at} className={cx('cx-line', line.op === 'add' && 'is-add', line.op === 'remove' && 'is-remove')}>
            <i aria-hidden>{numbers[0]}</i><i aria-hidden>{numbers[1]}</i><b aria-label={line.op === 'add' ? '新增' : line.op === 'remove' ? '删除' : undefined}>{line.op === 'add' ? '+' : line.op === 'remove' ? '−' : ' '}</b>{line.text}{'\n'}</span>;
        })}
      </pre>;
    })}
    {diff.truncated && <p className="cx-note small">差异太长，只显示了前面一部分。</p>}
  </div>;
}

function FileRow({ file, content, picked, disabled, onPick }: { file: CodeExportPreviewFile; content?: string; picked: boolean; disabled: boolean; onPick: (value: boolean) => void }) {
  const [open, setOpen] = useState(file.status === 'overwrite');
  const pickable = file.status === 'create' || file.status === 'overwrite';
  const meta = file.status === 'create' ? `${file.lines} 行${file.createsDirectories.length ? ` · 会新建文件夹 ${file.createsDirectories.join('、')}` : ''}`
    : file.status === 'overwrite' ? `现有文件 ${size(file.existing!.bytes)}，修改于 ${when(file.existing!.modifiedAt)}${file.diff!.kind === 'lines' ? ` · +${file.diff!.added} −${file.diff!.removed} 行` : ''}`
      : file.status === 'same' ? '和现有文件完全一样，不需要写入' : codeExportReasonLabels[file.reason!];
  const canOpen = file.status === 'overwrite' || (file.status === 'create' && content !== undefined);
  return <li className={cx('cx-file', `is-${file.status}`, picked && 'is-picked')}>
    <div className="cx-file-head">
      {pickable ? <label className={cx('cx-pick', file.status === 'overwrite' && 'is-danger')}>
        <input type="checkbox" checked={picked} disabled={disabled} onChange={event => onPick(event.target.checked)}
          aria-label={file.status === 'overwrite' ? `覆盖 ${file.path}` : `新建 ${file.path}`} />
        <span aria-hidden>{file.status === 'overwrite' ? '覆盖' : '写入'}</span>
      </label> : <span className="cx-pick is-none" aria-hidden><Minus size={14} /></span>}
      <div className="cx-file-main">
        <div className="cx-file-title"><code className="cx-path">{file.path}</code><span className={cx('pill', statusTone[file.status])}>{codeExportStatusLabels[file.status]}</span></div>
        <p className={cx('cx-meta small', (file.status === 'conflict' || file.status === 'invalid') && 'is-warn')}>{meta}</p>
      </div>
      {canOpen && <Button size="sm" variant="quiet" icon={open ? ChevronDown : ChevronRight} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {open ? '收起' : file.status === 'overwrite' ? '查看差异' : '查看内容'}</Button>}
    </div>
    {open && file.status === 'overwrite' && <Diff diff={file.diff!} />}
    {open && file.status === 'create' && content !== undefined && <Lines content={content} />}
  </li>;
}

type Phase = { kind: 'start' } | { kind: 'busy'; label: string } | { kind: 'preview'; preview: CodeExportPreview } | { kind: 'result'; preview: CodeExportPreview; result: CodeExportWriteResult };

/**
 * R15 (D126–D131): write an adopted code version into a folder. The host picks the folder in Main's dialog; a
 * read-only check lists what would happen to each file; only the files the host ticks are written, and an overwrite
 * is its own, red tick. Closing at any point before 写入 writes nothing.
 */
export function CodeExportDialog({ api, runId, versionId, versionNumber, files, affected, onClose }: { api: CodeExportApiContract; runId: string; versionId: string;
  versionNumber: number; files: CodeContent['files']; affected: boolean; onClose: () => void }) {
  const [root, setRoot] = useState<CodeExportRoot | undefined>(lastRoot);
  const [phase, setPhase] = useState<Phase>(() => lastRoot ? { kind: 'busy', label: '正在检查…' } : { kind: 'start' });
  const [picks, setPicks] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const contents = useMemo(() => new Map(files.map(file => [file.path, file.content])), [files]);

  const check = useCallback(async (target: CodeExportRoot) => {
    setError(undefined); setPhase({ kind: 'busy', label: '正在检查…' });
    try {
      const preview = await api.preview({ runId, versionId, rootId: target.rootId });
      if (!alive.current) return;
      setPicks({}); setPhase({ kind: 'preview', preview });
    } catch (failure) {
      if (!alive.current) return;
      const code = (failure as { code?: string } | undefined)?.code;
      if (code === 'not_found') { lastRoot = undefined; setRoot(undefined); }
      setError(errorText(failure, 'preview')); setPhase({ kind: 'start' });
    }
  }, [api, runId, versionId]);
  // A folder chosen earlier in this window is checked again at once: checking reads only.
  const first = useRef(root);
  useEffect(() => { if (first.current) void check(first.current); }, [check]);

  const choose = async () => {
    const previous = phase;
    setError(undefined); setPhase({ kind: 'busy', label: '请在弹出的窗口里选择文件夹…' });
    try {
      const chosen = await api.chooseRoot({ runId, versionId });
      if (!alive.current) return;
      if (chosen.root) { lastRoot = chosen.root; setRoot(chosen.root); await check(chosen.root); return; }
      if (chosen.refused) setError(codeExportRootRefusalLabels[chosen.refused]);
      setPhase(previous.kind === 'busy' ? { kind: 'start' } : previous);
    } catch (failure) { if (alive.current) { setError(errorText(failure, 'choose')); setPhase({ kind: 'start' }); } }
  };

  const write = async (preview: CodeExportPreview) => {
    const selected = preview.files.filter(file => picks[file.path] && (file.status === 'create' || file.status === 'overwrite'));
    if (!selected.length) return;
    setError(undefined); setPhase({ kind: 'busy', label: `正在写入 ${selected.length} 个文件…` });
    try {
      const result = await api.write({ runId, clientRequestId: newRequestId(), previewId: preview.previewId,
        files: selected.map(file => ({ path: file.path, overwrite: file.status === 'overwrite' })) });
      if (alive.current) setPhase({ kind: 'result', preview, result });
    } catch (failure) { if (alive.current) { setError(errorText(failure, 'write')); setPhase({ kind: 'preview', preview }); } }
  };

  const busy = phase.kind === 'busy';
  const folderBar = root && <div className="cx-folder">
    <FolderOpen aria-hidden size={16} /><span className="cx-folder-path" title={root.displayPath}>{root.displayPath}</span>
    <span className="cx-folder-actions">
      <Button size="sm" variant="quiet" disabled={busy} onClick={() => void choose()}>换一个文件夹…</Button>
      {phase.kind !== 'start' && <Button size="sm" variant="quiet" icon={RefreshCw} disabled={busy} onClick={() => void check(root)}>重新检查</Button>}
    </span>
  </div>;

  let body: ReactNode, footer: ReactNode;
  if (phase.kind === 'start' || phase.kind === 'busy') {
    body = <>
      <p>把这一版的 {files.length} 个文件写进你选的文件夹，只会写在这个文件夹里面。</p>
      <ol className="cx-steps">
        <li>选一个文件夹。</li>
        <li>逐个文件查看会怎样：新建、覆盖（附和现有文件的差异）、内容相同，或者不能写入及原因。</li>
        <li>只写入你勾选的文件；覆盖现有文件要单独勾选。</li>
      </ol>
      <p className="art-safe"><ShieldCheck aria-hidden size={16} />不会运行其中任何代码或命令，文件只作为文本写入。</p>
      {affected && <Note icon={AlertTriangle}>这一版依据的发言后来被修改过，代码可能已经过时。可以先重新生成，或确认后照常写入。</Note>}
      {folderBar}
      {busy && <p role="status" className="muted">{phase.label}</p>}
    </>;
    footer = <>
      <Button onClick={onClose} disabled={busy}>取消</Button>
      <Button variant="primary" icon={FolderOpen} disabled={busy} onClick={() => void choose()}>{root ? '换一个文件夹…' : '选择文件夹…'}</Button>
    </>;
  } else if (phase.kind === 'preview') {
    const { preview } = phase;
    const counts = Object.fromEntries((['create', 'overwrite', 'same', 'conflict', 'invalid'] as const).map(status => [status, preview.files.filter(file => file.status === status).length]));
    const selected = preview.files.filter(file => picks[file.path] && (file.status === 'create' || file.status === 'overwrite'));
    const overwriting = selected.filter(file => file.status === 'overwrite').length;
    const creates = preview.files.filter(file => file.status === 'create');
    body = <>
      {folderBar}
      <p className="cx-summary" role="status">{(['create', 'overwrite', 'same'] as const).filter(status => counts[status]).map(status => `${codeExportStatusLabels[status]} ${counts[status]}`)
        .concat(counts.conflict + counts.invalid ? [`不能写入 ${counts.conflict + counts.invalid}`] : []).join(' · ')}。没有勾选的文件不会写入，现在还什么都没写。</p>
      {!preview.writable && <Note tone="danger" icon={AlertTriangle}>这个文件夹不允许本应用写入，写入会失败。可以换一个文件夹，或者在访达里修改权限后重新检查。</Note>}
      {counts.overwrite > 0 && <p className="small cx-warn-line">“覆盖”会用新内容替换现有文件，原来的内容不会另外保存。请先看差异。</p>}
      {creates.length > 1 && <button type="button" className="link-btn small" onClick={() => setPicks(value => ({ ...value, ...Object.fromEntries(creates.map(file => [file.path, true])) }))}>
        勾选全部新建文件（{creates.length} 个）</button>}
      <ul className="cx-files" aria-label="文件">{preview.files.map(file => <FileRow key={file.path} file={file} content={contents.get(file.path)} picked={Boolean(picks[file.path])}
        disabled={busy} onPick={value => setPicks(previous => ({ ...previous, [file.path]: value }))} />)}</ul>
      {error && <p role="alert" className="field-error">{error}</p>}
    </>;
    footer = <>
      {!selected.length && <span className="is-left small muted">先勾选要写入的文件</span>}
      <Button onClick={onClose}>取消</Button>
      <Button variant={overwriting ? 'danger' : 'primary'} solid={overwriting > 0} disabled={!selected.length} onClick={() => void write(preview)}>
        {selected.length ? `写入 ${selected.length} 个文件${overwriting ? `（含覆盖 ${overwriting} 个）` : ''}` : '写入文件'}</Button>
    </>;
  } else {
    const { result } = phase;
    const stale = result.files.some(file => file.reason === 'target_changed' || file.reason === 'candidate_changed' || file.reason === 'root_changed');
    const title = result.failed === 0 ? `已写入 ${result.written} 个文件` : result.written ? `写入了 ${result.written} 个文件，${result.failed} 个没有写入` : '没有写入任何文件';
    body = <>
      <div className={cx('cx-result-head', result.failed ? 'is-partial' : 'is-done')} role="status">
        {result.failed ? <AlertTriangle aria-hidden size={18} /> : <Check aria-hidden size={18} />}
        <div><b>{title}</b><p className="small muted">位置：{result.root.displayPath} · {when(result.createdAt)}</p></div>
      </div>
      {stale && <Note icon={AlertTriangle} action={root && <Button size="sm" onClick={() => void check(root)}>重新检查</Button>}>
        有文件在检查之后发生了变化，为了不覆盖你没看过的内容，这些文件没有写入。重新检查后再确认。</Note>}
      <ul className="cx-files is-result" aria-label="写入结果">{result.files.map(file => <li key={file.path} className={cx('cx-file', `is-${file.outcome}`)}>
        <div className="cx-file-head">
          <span className={cx('cx-outcome', `is-${file.outcome}`)} aria-hidden>{file.outcome === 'written' ? <Check size={14} /> : file.outcome === 'failed' ? <X size={14} /> : <Minus size={14} />}</span>
          <div className="cx-file-main">
            <div className="cx-file-title"><code className="cx-path">{file.path}</code>
              <span className={cx('pill', file.outcome === 'written' ? 'is-ok' : file.outcome === 'failed' ? 'is-danger' : '')}>
                {file.outcome === 'written' ? (file.action === 'overwrite' ? '已覆盖' : '已新建') : file.outcome === 'failed' ? '没有写入' : '跳过'}</span></div>
            {file.reason && <p className={cx('cx-meta small', file.outcome === 'failed' && 'is-warn')}>{codeExportReasonLabels[file.reason]}</p>}
          </div>
        </div></li>)}</ul>
      <p className="small muted">只有标“已新建”“已覆盖”的文件写到了磁盘上。本应用不会运行它们，之后也不会再改动它们。</p>
    </>;
    footer = <>
      {root && <Button icon={RefreshCw} onClick={() => void check(root)}>重新检查</Button>}
      <Button variant="primary" onClick={onClose} data-autofocus>完成</Button>
    </>;
  }

  return <Modal title={`写入文件夹 · 代码候选第 ${versionNumber} 版`} onClose={onClose} busy={busy} className="code-export" footer={footer}>
    {phase.kind !== 'preview' && error && <p role="alert" className="field-error">{error}</p>}
    {body}
  </Modal>;
}
