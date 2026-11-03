import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArtifactApiContract, CodeExportApiContract } from '../../../shared/contracts/app';
import type { ArtifactKind, ArtifactList, ArtifactPreview } from '../../../shared/schemas/artifact';
import { copyText } from '../../components/ui';
import { commandErrorMessage } from '../usage';

let fallbackCounter = 0;
const newRequestId = () => globalThis.crypto?.randomUUID?.() ?? `artifact-${Date.now()}-${++fallbackCounter}`;

/**
 * R14: the selected Run's artifacts and the host's artifact commands. The list is re-read whenever the Run's event
 * sequence moves (an `artifact_updated` event moves it) and, while a version is generating, about once a second so
 * the received length stays current. Each click gets its own clientRequestId. `codeExport` (R15) is passed through for
 * the reader's 写入文件夹; a page without it offers copying only.
 */
export function useArtifacts(api: ArtifactApiContract | undefined, runId: string | undefined, sequence: number | undefined, codeExport?: CodeExportApiContract) {
  const [list, setList] = useState<ArtifactList>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<{ key: string; message: string }>();
  const [notice, setNotice] = useState<{ key: string; message: string }>();
  const inFlight = useRef(false);
  const token = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setError(undefined); setNotice(undefined); }, [runId]);

  const load = useCallback(async () => {
    if (!api || !runId) return;
    const id = ++token.current;
    try { const value = await api.list({ runId }); if (alive.current && id === token.current) { setList(value); setLoadFailed(false); } }
    catch { if (alive.current && id === token.current) setLoadFailed(true); }
  }, [api, runId]);
  useEffect(() => { void load(); }, [load, sequence]);
  const current = list && list.runId === runId ? list.artifacts : undefined;
  const generating = current?.some(artifact => artifact.versions.some(version => version.status === 'generating')) ?? false;
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => void load(), 1000);
    return () => clearInterval(timer);
  }, [generating, load]);

  const act = useCallback(async <T,>(key: string, work: (clientRequestId: string) => Promise<T>): Promise<T | undefined> => {
    if (!api || !runId || inFlight.current) return;
    inFlight.current = true; setPending(key); setError(undefined); setNotice(undefined);
    try { const result = await work(newRequestId()); void load(); return result; }
    catch (failure) { if (alive.current) setError({ key, message: commandErrorMessage(failure) }); return undefined; }
    finally { inFlight.current = false; if (alive.current) setPending(undefined); }
  }, [api, runId, load]);

  const preview = useCallback((input: { kind: ArtifactKind; agentId?: string; artifactId?: string }): Promise<ArtifactPreview> =>
    api!.preview({ runId: runId!, ...input }), [api, runId]);
  const generate = useCallback((input: { kind: ArtifactKind; agentId: string; artifactId?: string }) =>
    act('generate', clientRequestId => api!.generate({ runId: runId!, clientRequestId, ...input })), [act, api, runId]);
  const edit = useCallback((versionId: string, text: string) => act(`edit:${versionId}`, clientRequestId => api!.edit({ runId: runId!, clientRequestId, versionId, text })), [act, api, runId]);
  const getVersion = useCallback((versionId: string) => api!.getVersion({ runId: runId!, versionId }), [api, runId]);
  /** Copies the Markdown or JSON Main renders from the document. */
  const copy = useCallback(async (versionId: string, format: 'markdown' | 'json') => {
    const key = `copy:${format}`;
    const result = await act(key, clientRequestId => api!.export({ runId: runId!, clientRequestId, versionId, format, target: 'clipboard' }));
    if (!result?.text) return;
    if (await copyText(result.text)) setNotice({ key, message: format === 'markdown' ? '已复制为 Markdown。' : '已复制 JSON。' });
    else setError({ key, message: '没能写入剪贴板，请重试。' });
  }, [act, api, runId]);
  const save = useCallback(async (versionId: string, format: 'markdown' | 'json') => {
    const result = await act('save', clientRequestId => api!.export({ runId: runId!, clientRequestId, versionId, format, target: 'file' }));
    if (result) setNotice({ key: 'save', message: result.saved ? `已保存为“${result.fileName}”。` : '已取消保存。' });
  }, [act, api, runId]);

  return { available: Boolean(api && runId), artifacts: current, loadFailed, reload: load, preview, generate, edit, getVersion, copy, save, pending, error, notice, codeExport };
}
export type ArtifactCommands = ReturnType<typeof useArtifacts>;
