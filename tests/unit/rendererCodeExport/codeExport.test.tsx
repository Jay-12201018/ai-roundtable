import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactReader, ArtifactsPanel, type ArtifactCommands } from '../../../src/renderer/features/artifacts';
import { CodeExportDialog, forgetLastRoot } from '../../../src/renderer/features/codeExport';
import type { HostCommands } from '../../../src/renderer/features/host/useHostCommands';
import type { CodeExportApiContract } from '../../../src/shared/contracts/app';
import type { ArtifactSummary, ArtifactVersion, ArtifactVersionDetail, CodeContent } from '../../../src/shared/schemas/artifact';
import type { CodeExportPreview, CodeExportWriteResult } from '../../../src/shared/schemas/codeExport';
import type { RunSnapshot } from '../../../src/shared/types/run';
import { time } from '../rendererSubscriptions/fixtures';

afterEach(() => { cleanup(); vi.restoreAllMocks(); forgetLastRoot(); });
const snapshot: RunSnapshot = { runId: 'run', roomId: 'room', status: 'completed', sequence: 3, workflowSnapshot: {}, updatedAt: time, turns: [], messages: [] };
const code: CodeContent = { title: '费用计算', summary: '算费用。', notes: [], files: [
  { path: 'src/fee.ts', language: 'typescript', description: null, content: 'export const RATE = 0.08;\n' },
  { path: 'src/new.ts', language: 'typescript', description: null, content: 'export const x = 1;\nexport const y = 2;\n' },
  { path: 'README.md', language: null, description: null, content: '# 说明\n' },
  { path: 'CON', language: null, description: null, content: 'x\n' },
] };
const version = (overrides: Partial<ArtifactVersion> = {}): ArtifactVersion => ({ versionId: 'v1', artifactId: 'art', number: 1, origin: 'generate', status: 'valid', adoptedAt: time,
  agentId: 'a', issues: [], outputChars: 10, affectedNumbers: [], createdAt: time, updatedAt: time, ...overrides });
const summary = (versions: ArtifactVersion[]): ArtifactSummary => ({ artifactId: 'art', runId: 'run', roomId: 'room', kind: 'code', createdAt: time, versions });
const detail = (v: ArtifactVersion): ArtifactVersionDetail => ({ runId: 'run', artifactId: 'art', kind: 'code', version: v, rawOutput: JSON.stringify(code), content: { kind: 'code', data: code }, sources: [] });
const root = { rootId: 'root-1', displayPath: '~/projects/pilot', name: 'pilot' };
const preview: CodeExportPreview = { previewId: 'p1', runId: 'run', versionId: 'v1', versionNumber: 1, root, writable: true, createdAt: time, files: [
  { path: 'src/fee.ts', status: 'overwrite', bytes: 26, lines: 1, createsDirectories: [], existing: { bytes: 26, modifiedAt: time },
    diff: { kind: 'lines', added: 1, removed: 1, truncated: false, hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: [{ op: 'remove', text: 'export const RATE = 0.15;' }, { op: 'add', text: 'export const RATE = 0.08;' }] }] } },
  { path: 'src/new.ts', status: 'create', bytes: 40, lines: 2, createsDirectories: [] },
  { path: 'README.md', status: 'same', bytes: 9, lines: 1, createsDirectories: [], existing: { bytes: 9, modifiedAt: time } },
  { path: 'CON', status: 'invalid', reason: 'reserved_name', bytes: 2, lines: 1, createsDirectories: [] },
] };
const written = (files: CodeExportWriteResult['files']): CodeExportWriteResult => ({ runId: 'run', versionId: 'v1', previewId: 'p1', exportId: 'e1', duplicate: false,
  root: { displayPath: root.displayPath, name: root.name }, files, createdAt: time,
  written: files.filter(file => file.outcome === 'written').length, skipped: files.filter(file => file.outcome === 'skipped').length, failed: files.filter(file => file.outcome === 'failed').length });
function exportApi(overrides: Partial<CodeExportApiContract> = {}): CodeExportApiContract {
  return { chooseRoot: vi.fn(async () => ({ runId: 'run', versionId: 'v1', root })), preview: vi.fn(async () => preview),
    write: vi.fn(async () => written([{ path: 'src/fee.ts', action: 'overwrite', outcome: 'written' }, { path: 'src/new.ts', action: 'create', outcome: 'written' },
      { path: 'README.md', action: 'none', outcome: 'skipped', reason: 'unchanged' }, { path: 'CON', action: 'none', outcome: 'skipped', reason: 'not_selected' }])), ...overrides };
}
function commands(details: Record<string, ArtifactVersionDetail>, codeExport?: CodeExportApiContract): ArtifactCommands {
  return { available: true, artifacts: [], loadFailed: false, reload: vi.fn(), preview: vi.fn(), generate: vi.fn(), adopt: vi.fn(), edit: vi.fn(), getVersion: vi.fn(async (id: string) => details[id]),
    copy: vi.fn(), save: vi.fn(), pending: undefined, error: undefined, notice: undefined, codeExport } as unknown as ArtifactCommands;
}
const host = { send: vi.fn(), pending: undefined } as unknown as HostCommands;
const open = (api: CodeExportApiContract, extra: { affected?: boolean } = {}) => render(<CodeExportDialog api={api} runId="run" versionId="v1" versionNumber={1} files={code.files}
  affected={extra.affected ?? false} onClose={vi.fn()} />);
const dialog = () => screen.getByRole('dialog', { name: /写入文件夹/u });

describe('the reader’s 写入文件夹… (R15)', () => {
  it('is a danger-styled entry on the latest effective code version only, with the write history beside it', async () => {
    const older = version();
    const latest = version({ versionId: 'v2', number: 2, origin: 'edit', status: 'exported', exportedAt: '2026-10-29T07:00:00.000Z',
      codeWrites: [{ exportId: 'e1', folder: '~/projects/pilot', written: 2, skipped: 1, failed: 1, at: '2026-10-29T07:00:00.000Z' }] });
    const c = commands({ v1: detail(older), v2: detail(latest) }, exportApi());
    const view = render(<ArtifactReader snapshot={snapshot} artifact={summary([older, latest])} commands={c} host={host} onClose={() => {}} onRegenerate={() => {}} onReveal={() => {}} />);
    await screen.findByText('src/fee.ts');
    const button = screen.getByRole('button', { name: '写入文件夹…' });
    expect(button.className).toContain('is-danger');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/最近一次在 .+ 写入了 2 个文件。/u)).toBeTruthy();
    expect(within(screen.getByRole('list', { name: '写入记录' })).getByText(/~\/projects\/pilot/u).closest('li')!.textContent).toMatch(/写入 2 个，1 个没有写入，跳过 1 个/u);
    view.unmount();
    // An older effective version cannot be written: R14 hands over only the latest one.
    render(<ArtifactReader snapshot={snapshot} artifact={summary([older, latest])} initialVersionId="v1" commands={c} host={host} onClose={() => {}} onRegenerate={() => {}} onReveal={() => {}} />);
    await screen.findByText('只能写入最新的有效版本（第 2 版）。');
    expect((screen.getByRole('button', { name: '写入文件夹…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('the panel shows how many files were written and when', () => {
    const v = version({ status: 'exported', exportedAt: time, codeWrites: [{ exportId: 'e1', folder: '~/x', written: 3, skipped: 0, failed: 0, at: time }] });
    render(<ArtifactsPanel snapshot={snapshot} commands={{ ...commands({}), artifacts: [summary([v])] } as ArtifactCommands} onGenerate={() => {}} onOpen={() => {}} />);
    expect(screen.getByText(/^已写入 3 个文件 · /u)).toBeTruthy();
  });
});

describe('the write dialog', () => {
  it('chooses a folder in Main, previews read-only, ticks nothing by default, and writes exactly the ticked files', async () => {
    const api = exportApi();
    open(api);
    expect(within(dialog()).getByText('不会运行其中任何代码或命令，文件只作为文本写入。')).toBeTruthy();
    expect(api.preview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹…' }));
    await screen.findByText('src/new.ts');
    expect(api.chooseRoot).toHaveBeenCalledWith({ runId: 'run', versionId: 'v1' });
    expect(api.preview).toHaveBeenCalledWith({ runId: 'run', versionId: 'v1', rootId: 'root-1' });
    expect(screen.getByText('~/projects/pilot')).toBeTruthy();
    expect(screen.getByText('新建 1 · 覆盖 1 · 内容相同 1 · 不能写入 1。没有勾选的文件不会写入，现在还什么都没写。')).toBeTruthy();
    // Nothing is ticked; the write button says why it is unavailable.
    const writeButton = () => screen.getByRole('button', { name: /^写入( \d+ 个)?文件/u }) as HTMLButtonElement;
    expect(writeButton().disabled).toBe(true);
    expect(screen.getByText('先勾选要写入的文件')).toBeTruthy();
    // Only create and overwrite rows can be ticked; the overwrite is its own, red tick, and its diff is open.
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    const overwrite = screen.getByRole('checkbox', { name: '覆盖 src/fee.ts' });
    expect(overwrite.closest('label')!.className).toContain('is-danger');
    expect(overwrite.closest('label')!.textContent).toBe('覆盖');
    expect(screen.getByRole('checkbox', { name: '新建 src/new.ts' }).closest('label')!.textContent).toBe('新建');
    expect(screen.getByRole('group', { name: '与现有文件的差异' }).textContent).toContain('export const RATE = 0.15;');
    expect(screen.getByText(/系统保留的名字/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: '新建 src/new.ts' }));
    expect(writeButton().textContent).toBe('写入 1 个文件');
    expect(writeButton().className).toContain('is-primary');
    fireEvent.click(overwrite);
    expect(writeButton().textContent).toBe('写入 2 个文件（含覆盖 1 个）');
    expect(writeButton().className).toContain('is-danger');
    // A new file's content is one click away.
    fireEvent.click(within(screen.getByText('src/new.ts').closest('li')!).getByRole('button', { name: '查看内容' }));
    expect(screen.getByLabelText('文件内容').textContent).toContain('export const y = 2;');
    fireEvent.click(writeButton());
    await screen.findByText('已写入 2 个文件');
    expect(api.write).toHaveBeenCalledWith({ runId: 'run', clientRequestId: expect.any(String), previewId: 'p1',
      files: [{ path: 'src/fee.ts', overwrite: true }, { path: 'src/new.ts', overwrite: false }] });
    const results = within(screen.getByRole('list', { name: '写入结果' }));
    expect(results.getByText('src/fee.ts').closest('li')!.textContent).toContain('已覆盖');
    expect(results.getByText('README.md').closest('li')!.textContent).toContain('内容相同，不需要写入');
  });

  it('“勾选全部新建文件” never ticks an overwrite', async () => {
    const api = exportApi({ preview: vi.fn(async () => ({ ...preview, files: [...preview.files, { path: 'b.ts', status: 'create' as const, bytes: 1, lines: 1, createsDirectories: ['lib'] }] })) });
    open(api);
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹…' }));
    fireEvent.click(await screen.findByRole('button', { name: '勾选全部新建文件（2 个）' }));
    expect((screen.getByRole('checkbox', { name: '新建 b.ts' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: '新建 src/new.ts' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: '覆盖 src/fee.ts' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/会新建文件夹 lib/u)).toBeTruthy();
    expect(screen.queryByText(/隐藏文件或文件夹/u)).toBeNull();
  });

  it('closing, cancelling the folder dialog or a refused folder writes nothing', async () => {
    const onClose = vi.fn();
    const api = exportApi({ chooseRoot: vi.fn(async () => ({ runId: 'run', versionId: 'v1' })) });
    render(<CodeExportDialog api={api} runId="run" versionId="v1" versionNumber={1} files={code.files} affected onClose={onClose} />);
    expect(screen.getByText(/依据的发言后来被修改过/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹…' }));
    await waitFor(() => expect(api.chooseRoot).toHaveBeenCalled());
    await screen.findByRole('button', { name: '选择文件夹…' });
    expect(api.preview).not.toHaveBeenCalled();
    vi.mocked(api.chooseRoot).mockResolvedValueOnce({ runId: 'run', versionId: 'v1', refused: 'app_data' });
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹…' }));
    await screen.findByText('这是本应用自己的数据文件夹，不能写入。请另选一个文件夹。');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.write).not.toHaveBeenCalled();
  });

  it('says honestly what happened when some files were not written, and offers to check again', async () => {
    const api = exportApi({ write: vi.fn(async () => written([{ path: 'src/fee.ts', action: 'overwrite', outcome: 'failed', reason: 'target_changed' },
      { path: 'src/new.ts', action: 'create', outcome: 'written' }, { path: 'README.md', action: 'none', outcome: 'skipped', reason: 'unchanged' }, { path: 'CON', action: 'none', outcome: 'skipped', reason: 'not_selected' }])) });
    open(api);
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹…' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '覆盖 src/fee.ts' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '新建 src/new.ts' }));
    fireEvent.click(screen.getByRole('button', { name: '写入 2 个文件（含覆盖 1 个）' }));
    await screen.findByText('写入了 1 个文件，1 个没有写入');
    expect(screen.getByText(/目标在检查之后有变化，没有覆盖/u)).toBeTruthy();
    // What did not get written comes first, and 重新检查 appears once, right beside the explanation.
    expect(within(screen.getByRole('list', { name: '写入结果' })).getAllByRole('listitem')[0].textContent).toContain('src/fee.ts');
    expect(screen.getAllByRole('button', { name: '重新检查' })).toHaveLength(1);
    expect(screen.getByText(/为了不覆盖你没看过的内容/u)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('note')).getByRole('button', { name: '重新检查' }));
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(2));
    await screen.findByText('先勾选要写入的文件');
  });

  it('remembers the folder for this window and checks it again at once; a lost folder sends the host back to choosing', async () => {
    const api = exportApi();
    const first = open(api);
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹…' }));
    await screen.findByText('src/new.ts');
    first.unmount();
    const lost = exportApi({ preview: vi.fn(async () => { throw { code: 'not_found' }; }) });
    open(lost);
    await screen.findByText('这个文件夹已被移动或替换，或者应用重启过。请重新选择文件夹。');
    expect(lost.preview).toHaveBeenCalledWith({ runId: 'run', versionId: 'v1', rootId: 'root-1' });
    expect(lost.chooseRoot).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '选择文件夹…' })).toBeTruthy();
  });

  it('warns about hidden paths that other tools may read or run on their own', async () => {
    const api = exportApi({ preview: vi.fn(async () => ({ ...preview, files: [{ path: '.github/workflows/ci.yml', status: 'create' as const, bytes: 1, lines: 1, createsDirectories: ['.github', '.github/workflows'] }] })) });
    open(api);
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹…' }));
    await screen.findByText('隐藏文件或文件夹：有些工具会自动读取或运行这里的内容，请先确认。');
  });

  it('a folder the app cannot write to is said up front', async () => {
    const api = exportApi({ preview: vi.fn(async () => ({ ...preview, writable: false })) });
    open(api);
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹…' }));
    await screen.findByText(/这个文件夹不允许本应用写入/u);
  });
});
