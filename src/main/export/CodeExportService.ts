import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, parse as parsePath, sep } from 'node:path';
import type { Database, CodeExportFileRecord } from '../database/Database';
import { ContractError } from '../../shared/contracts/errors';
import type { CodeCandidateList, ValidatedCodeCandidate } from '../../shared/schemas/artifact';
import {
  codeExportChooseRootInputSchema, codeExportPreviewInputSchema, codeExportWriteInputSchema,
  type CodeExportChooseRootInput, type CodeExportChooseRootResult, type CodeExportFileResult, type CodeExportPreview, type CodeExportPreviewFile,
  type CodeExportPreviewInput, type CodeExportReason, type CodeExportRoot, type CodeExportWriteInput, type CodeExportWriteResult,
} from '../../shared/schemas/codeExport';
import { checkCandidatePath, collisionKey, findCollisions, insideGitDir, isWithin } from './paths';
import { isBinary, lineDiff, MAX_DIFF_INPUT_BYTES, splitLines } from './diff';
import { folderDisplay } from '../artifact/view';

/** The file-system calls this service makes; tests replace single calls to inject failures. */
export type ExportFs = {
  lstat(path: string): Promise<BigIntStats>;
  realpath(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  access(path: string, mode: number): Promise<void>;
  open(path: string, flags: number, mode?: number): Promise<fsp.FileHandle>;
  mkdir(path: string, mode: number): Promise<void>;
  link(existing: string, target: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
};
const nodeFs: ExportFs = {
  lstat: path => fsp.lstat(path, { bigint: true }), realpath: path => fsp.realpath(path), readdir: path => fsp.readdir(path), access: (path, mode) => fsp.access(path, mode),
  open: (path, flags, mode) => fsp.open(path, flags, mode), mkdir: async (path, mode) => { await fsp.mkdir(path, { mode }); }, link: (a, b) => fsp.link(a, b),
  rename: (a, b) => fsp.rename(a, b), unlink: path => fsp.unlink(path),
};
export type ExportHooks = {
  /** Called after a file's checks, right before its temporary copy is created (tests race here). */
  beforeTemporary?(path: string): Promise<void> | void;
  /** Called after a file's checks and temporary copy, right before it is put in place (tests race here). */
  beforeCommit?(path: string): Promise<void> | void;
};
type Notifier = { notifyArtifact(runId: string, payload: { artifactId: string; versionId: string; status: 'exported' }): void };
/** Main's folder dialog; resolves to the folder the host picked, or undefined when cancelled. */
export type ChooseFolder = () => Promise<string | undefined>;

type Root = { rootId: string; real: string; dev: bigint; ino: bigint; displayPath: string; name: string };
/** What a target was at preview time; a write goes ahead only while it still is. */
type TargetState = { kind: 'missing' } | { kind: 'file'; dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; mode: number; sha256: string };
type Binding = { path: string; segments: string[]; status: CodeExportPreviewFile['status']; reason?: CodeExportReason; content: Buffer; sha256: string; target: TargetState };
type PreviewRecord = { previewId: string; runId: string; versionId: string; artifactId: string; rootId: string; files: Binding[] };

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const MAX_KEPT = 16;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const errno = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;
const failureReason = (error: unknown): CodeExportReason => {
  switch (errno(error)) {
    case 'EACCES': case 'EPERM': return 'permission_denied';
    case 'ENOSPC': case 'EDQUOT': return 'no_space';
    case 'EROFS': return 'read_only';
    default: return 'io_error';
  }
};
const parse = <T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ContractError('invalid_input');
  return result.data;
};
/** A bounded map: the oldest entry goes first. */
const keep = <K, V>(map: Map<K, V>, key: K, value: V) => { map.set(key, value); while (map.size > MAX_KEPT) map.delete(map.keys().next().value as K); };

/**
 * R15 (D126–D131): writing the files of an adopted code candidate into a folder the host chose in Main's dialog.
 *
 * - The folder is a session-only reference (its real path, device and inode); the page never sends a path.
 * - A preview reads only: every candidate path is checked as text, then segment by segment on disk (no symbolic link,
 *   nothing that is not a folder, nothing that differs only by case), and each file gets a status — create,
 *   overwrite (with a diff), same, conflict or invalid. It records what each target was at that moment.
 * - A write handles only the files the host ticked in that preview; an overwrite needs its own confirmation. Each file
 *   is checked again (folder, path chain, target state, candidate content) right before it is written; a change makes
 *   that file fail instead of overwriting something the host has not seen. Files are written to a temporary file in
 *   the same folder, flushed, and then put in place: a new file by an exclusive link (never over an existing file),
 *   an overwrite by rename (the old file stays intact until then).
 * - Nothing is executed. The record keeps the version, folder and per-file outcome, never the contents.
 */
export class CodeExportService {
  private readonly roots = new Map<string, Root>();
  private readonly previews = new Map<string, PreviewRecord>();
  private readonly inFlight = new Map<string, Promise<CodeExportWriteResult>>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly fs: ExportFs;
  private readonly caseInsensitive: boolean;

  constructor(private readonly database: Database, private readonly candidates: (runId: string) => CodeCandidateList, private readonly runs: Notifier,
    private readonly options: { protectedDirs: readonly string[]; platform?: NodeJS.Platform; fs?: Partial<ExportFs>; hooks?: ExportHooks; home?: string }) {
    this.fs = { ...nodeFs, ...options.fs };
    const platform = options.platform ?? process.platform;
    this.caseInsensitive = platform === 'darwin' || platform === 'win32';
  }

  /** Main's dialog picks the folder; only a reference and a display path go back to the page. */
  async chooseRoot(input: CodeExportChooseRootInput, choose: ChooseFolder): Promise<CodeExportChooseRootResult> {
    const { runId, versionId } = parse(codeExportChooseRootInputSchema, input);
    this.candidate(runId, versionId);
    const picked = await choose();
    const result = { runId, versionId };
    if (!picked) return result;
    let real: string, info: BigIntStats;
    try { real = await this.fs.realpath(picked); info = await this.fs.lstat(real); }
    catch { return { ...result, refused: 'not_directory' }; }
    if (!info.isDirectory()) return { ...result, refused: 'not_directory' };
    if (parsePath(real).root === real) return { ...result, refused: 'filesystem_root' };
    // A folder that contains the app's data is allowed (its data folder is refused file by file); one inside it is not.
    if (this.options.protectedDirs.some(dir => isWithin(dir, real, sep, this.caseInsensitive))) return { ...result, refused: 'app_data' };
    if (insideGitDir(real, sep)) return { ...result, refused: 'git_dir' };
    const root: Root = { rootId: randomUUID(), real, dev: info.dev, ino: info.ino, ...this.displayOf(real) };
    keep(this.roots, root.rootId, root);
    return { ...result, root: this.rootView(root) };
  }

  /** Read-only: what writing this version into that folder would do, file by file. */
  async preview(input: CodeExportPreviewInput): Promise<CodeExportPreview> {
    const { runId, versionId, rootId } = parse(codeExportPreviewInputSchema, input);
    const candidate = this.candidate(runId, versionId);
    const root = await this.liveRoot(rootId);
    let writable = true;
    try { await this.fs.access(root.real, constants.W_OK); } catch { writable = false; }
    const collisions = findCollisions(candidate.files.map(file => file.path));
    const files: Binding[] = [];
    const views: CodeExportPreviewFile[] = [];
    for (const file of candidate.files) {
      const { binding, view } = await this.inspect(root, file.path, file.content, collisions);
      files.push(binding); views.push(view);
    }
    const previewId = randomUUID();
    keep(this.previews, previewId, { previewId, runId, versionId, artifactId: candidate.artifactId, rootId, files });
    return { previewId, runId, versionId, versionNumber: candidate.versionNumber, root: this.rootView(root), writable, files: views, createdAt: new Date().toISOString() };
  }

  /** Writes the ticked files of one preview, each re-checked first; the same clientRequestId never writes twice. */
  write(input: CodeExportWriteInput): Promise<CodeExportWriteResult> {
    let request: CodeExportWriteInput;
    try { request = parse(codeExportWriteInputSchema, input); } catch (error) { return Promise.reject(error); }
    const key = `${request.runId}\u0000${request.clientRequestId}`;
    const running = this.inFlight.get(key);
    if (running) return running;
    const work = this.queue.then(() => this.writeNow(request));
    this.queue = work.catch(() => undefined);
    this.inFlight.set(key, work);
    void work.finally(() => this.inFlight.delete(key)).catch(() => undefined);
    return work;
  }

  private async writeNow({ runId, clientRequestId, previewId, files: selected }: CodeExportWriteInput): Promise<CodeExportWriteResult> {
    const recorded = this.database.findCodeExport(runId, clientRequestId);
    if (recorded) {
      const root = this.displayOf(recorded.rootPath);
      return this.resultOf({ runId, versionId: recorded.versionId, previewId, exportId: recorded.id, duplicate: true, root, createdAt: recorded.createdAt,
        files: recorded.files.map(({ path, action, outcome, reason }) => ({ path, action, outcome, ...(reason ? { reason: reason as CodeExportReason } : {}) })) });
    }
    const preview = this.previews.get(previewId);
    if (!preview || preview.runId !== runId) throw new ContractError('not_found');
    if (selected.some(file => !preview.files.some(binding => binding.path === file.path))) throw new ContractError('invalid_input', 'files');
    const root = this.roots.get(preview.rootId);
    if (!root) throw new ContractError('not_found');
    // A preview is used once: what it showed is no longer true after a write.
    this.previews.delete(previewId);

    const planned = preview.files.map(binding => {
      const choice = selected.find(file => file.path === binding.path);
      const action: CodeExportFileResult['action'] = binding.status === 'create' || binding.status === 'overwrite' ? binding.status : 'none';
      const skip = (outcome: 'skipped' | 'failed', reason: CodeExportReason) => ({ binding, action, outcome, reason } as const);
      // A file that could not be ticked is skipped for its own reason, not as "not selected".
      if (binding.status === 'same') return skip('skipped', 'unchanged');
      if (binding.status === 'conflict' || binding.status === 'invalid') return choice ? skip('failed', 'not_writable') : skip('skipped', binding.reason!);
      if (!choice) return skip('skipped', 'not_selected');
      if (binding.status === 'overwrite' && !choice.overwrite) return skip('failed', 'not_confirmed');
      return { binding, action, outcome: 'write' as const };
    });
    // Everything the preview was based on, checked once more before the first byte: the candidate and the folder.
    let blocked: CodeExportReason | undefined;
    try {
      const current = this.candidate(runId, preview.versionId);
      const same = current.files.length === preview.files.length && current.files.every(file => {
        const binding = preview.files.find(item => item.path === file.path);
        return binding !== undefined && sha256(Buffer.from(file.content, 'utf8')) === binding.sha256;
      });
      if (!same) blocked = 'candidate_changed';
    } catch { blocked = 'candidate_changed'; }
    if (!blocked && !(await this.rootIntact(root))) blocked = 'root_changed';

    const results: Array<CodeExportFileResult & { record: CodeExportFileRecord }> = [];
    for (const item of planned) {
      let outcome: CodeExportFileResult['outcome'], reason: CodeExportReason | undefined;
      if (item.outcome !== 'write') ({ outcome, reason } = item);
      else if (blocked) { outcome = 'failed'; reason = blocked; }
      else {
        reason = await this.writeOne(root, item.binding);
        outcome = reason ? 'failed' : 'written';
      }
      const entry = { path: item.binding.path, action: item.action, outcome, ...(reason ? { reason } : {}) };
      results.push({ ...entry, record: { ...entry, contentSha256: item.binding.sha256, bytes: item.binding.content.length } });
    }
    const exportId = randomUUID();
    const createdAt = this.database.insertCodeExport({ id: exportId, versionId: preview.versionId, runId, clientRequestId, rootPath: root.real, files: results.map(item => item.record) });
    this.runs.notifyArtifact(runId, { artifactId: preview.artifactId, versionId: preview.versionId, status: 'exported' });
    return this.resultOf({ runId, versionId: preview.versionId, previewId, exportId, duplicate: false, root: { displayPath: root.displayPath, name: root.name }, createdAt,
      files: results.map(({ record: _record, ...file }) => file) });
  }

  private resultOf(base: Omit<CodeExportWriteResult, 'written' | 'skipped' | 'failed'>): CodeExportWriteResult {
    const count = (outcome: CodeExportFileResult['outcome']) => base.files.filter(file => file.outcome === outcome).length;
    return { ...base, written: count('written'), skipped: count('skipped'), failed: count('failed') };
  }

  /** The latest effective version of a code artifact, exactly as R14 hands it over (D123); anything else is refused. */
  private candidate(runId: string, versionId: string): ValidatedCodeCandidate {
    const candidate = this.candidates(runId).candidates.find(item => item.versionId === versionId);
    if (!candidate) throw new ContractError('invalid_state');
    return candidate;
  }

  private rootView(root: Root): CodeExportRoot {
    return { rootId: root.rootId, displayPath: root.displayPath, name: root.name };
  }

  /** How a recorded folder is shown: its path with the home folder as ~. */
  private displayOf(real: string): { displayPath: string; name: string } {
    return { displayPath: folderDisplay(real, this.options.home ?? homedir()), name: basename(real) || real };
  }

  private async liveRoot(rootId: string): Promise<Root> {
    const root = this.roots.get(rootId);
    if (!root) throw new ContractError('not_found');
    if (!(await this.rootIntact(root))) { this.roots.delete(rootId); throw new ContractError('not_found'); }
    return root;
  }

  /** The chosen folder is still the same directory at the same real path (not moved, replaced or turned into a link). */
  private async rootIntact(root: Root): Promise<boolean> {
    try {
      const info = await this.fs.lstat(root.real);
      return info.isDirectory() && !info.isSymbolicLink() && info.dev === root.dev && info.ino === root.ino && await this.fs.realpath(root.real) === root.real;
    } catch { return false; }
  }

  /**
   * Whether `dir` lists `name` exactly, only under a name that differs by case (or Unicode normalization), or not at
   * all; 'unknown' when the folder cannot be listed. lstat alone cannot tell: APFS and NTFS find src for Src.
   */
  private async nameIn(dir: string, name: string): Promise<'exact' | 'case' | 'none' | 'unknown'> {
    let entries: string[];
    try { entries = await this.fs.readdir(dir); } catch { return 'unknown'; }
    if (entries.includes(name)) return 'exact';
    const key = collisionKey(name);
    return entries.some(entry => collisionKey(entry) === key) ? 'case' : 'none';
  }

  private async inspect(root: Root, path: string, text: string, collisions: Set<string>): Promise<{ binding: Binding; view: CodeExportPreviewFile }> {
    const content = Buffer.from(text, 'utf8');
    const base = { path, bytes: content.length, lines: splitLines(text).length, createsDirectories: [] as string[] };
    const binding: Binding = { path, segments: [], status: 'invalid', content, sha256: sha256(content), target: { kind: 'missing' } };
    const refuse = (status: 'invalid' | 'conflict', reason: CodeExportReason) => {
      Object.assign(binding, { status, reason });
      return { binding, view: { ...base, status, reason } };
    };
    const checked = checkCandidatePath(path);
    if (!checked.ok) return refuse('invalid', checked.reason);
    binding.segments = checked.segments;
    if (collisions.has(path)) return refuse('invalid', 'case_collision');
    const target = join(root.real, ...checked.segments);
    if (this.options.protectedDirs.some(dir => isWithin(dir, target, sep, this.caseInsensitive))) return refuse('invalid', 'app_data');

    let current = root.real, missing = false;
    for (const [index, segment] of checked.segments.entries()) {
      const last = index === checked.segments.length - 1;
      const next = join(current, segment);
      if (missing) { if (!last) base.createsDirectories.push(checked.segments.slice(0, index + 1).join('/')); current = next; continue; }
      const named = await this.nameIn(current, segment);
      if (named === 'case') return refuse('conflict', 'case_mismatch');
      let info: BigIntStats | undefined;
      try { info = await this.fs.lstat(next); }
      catch (error) { if (errno(error) !== 'ENOENT') return refuse('conflict', failureReason(error)); }
      if (!info) {
        missing = true;
        if (!last) base.createsDirectories.push(checked.segments.slice(0, index + 1).join('/'));
        current = next; continue;
      }
      if (info.isSymbolicLink()) return refuse('conflict', last ? 'target_symlink' : 'symlink_parent');
      if (!last) {
        if (!info.isDirectory()) return refuse('conflict', 'parent_not_directory');
        current = next; continue;
      }
      if (info.isDirectory()) return refuse('conflict', 'target_directory');
      if (!info.isFile()) return refuse('conflict', 'target_special');
      // A file the host made read-only stays as it is.
      try { await this.fs.access(next, constants.W_OK); } catch { return refuse('conflict', 'permission_denied'); }
      let existing: Buffer;
      try { existing = await this.readExact(next, info); }
      catch (error) { return refuse('conflict', errno(error) === 'ECHANGED' ? 'target_changed' : failureReason(error)); }
      const state: TargetState = { kind: 'file', dev: info.dev, ino: info.ino, size: info.size, mtimeNs: info.mtimeNs, mode: Number(info.mode & 0o777n), sha256: sha256(existing) };
      binding.target = state;
      const existingView = { bytes: existing.length, modifiedAt: new Date(Number(info.mtimeMs)).toISOString() };
      if (state.sha256 === binding.sha256) { binding.status = 'same'; return { binding, view: { ...base, status: 'same', existing: existingView } }; }
      binding.status = 'overwrite';
      const diff = existing.length > MAX_DIFF_INPUT_BYTES ? { kind: 'unavailable' as const, reason: 'too_large' as const }
        : isBinary(existing) ? { kind: 'unavailable' as const, reason: 'binary' as const } : lineDiff(existing.toString('utf8'), text);
      return { binding, view: { ...base, status: 'overwrite', existing: existingView, diff } };
    }
    binding.status = 'create';
    return { binding, view: { ...base, status: 'create' } };
  }

  /** Reads a regular file without following a link, and only if it is still the file `expected` describes. */
  private async readExact(path: string, expected: BigIntStats): Promise<Buffer> {
    const handle = await this.fs.open(path, constants.O_RDONLY | NOFOLLOW);
    try {
      const info = await handle.stat({ bigint: true });
      if (!info.isFile() || info.ino !== expected.ino || info.dev !== expected.dev) throw Object.assign(new Error('Target changed'), { code: 'ECHANGED' });
      return await handle.readFile();
    } finally { await handle.close(); }
  }

  /** Whether the target is still exactly what the preview saw (missing, or the same file with the same content). */
  private async unchanged(path: string, state: TargetState, readContent: boolean): Promise<boolean> {
    let info: BigIntStats;
    try { info = await this.fs.lstat(path); }
    catch (error) { return state.kind === 'missing' && errno(error) === 'ENOENT'; }
    if (state.kind === 'missing' || !info.isFile() || info.isSymbolicLink()) return false;
    if (info.dev !== state.dev || info.ino !== state.ino || info.size !== state.size || info.mtimeNs !== state.mtimeNs) return false;
    if (!readContent) return true;
    try { return sha256(await this.readExact(path, info)) === state.sha256; } catch { return false; }
  }

  /** One file, checked again and put in place; undefined when written, otherwise why not. */
  private async writeOne(root: Root, binding: Binding): Promise<CodeExportReason | undefined> {
    try { return await this.checkAndPlace(root, binding); } catch (error) { return failureReason(error); }
  }

  private async checkAndPlace(root: Root, binding: Binding): Promise<CodeExportReason | undefined> {
    // The folder chain again: each existing part a real folder, each missing part created here, one level at a time.
    let parent = root.real;
    for (const segment of binding.segments.slice(0, -1)) {
      const next = join(parent, segment);
      if (await this.nameIn(parent, segment) === 'case') return 'case_mismatch';
      let info: BigIntStats | undefined;
      try { info = await this.fs.lstat(next); }
      catch (error) { if (errno(error) !== 'ENOENT') return failureReason(error); }
      if (!info) {
        try { await this.fs.mkdir(next, 0o755); }
        catch (error) { if (errno(error) !== 'EEXIST') return failureReason(error); }
        try { info = await this.fs.lstat(next); } catch (error) { return failureReason(error); }
      }
      if (info.isSymbolicLink()) return 'symlink_parent';
      if (!info.isDirectory()) return 'parent_not_directory';
      parent = next;
    }
    if (await this.fs.realpath(parent) !== parent || !isWithin(root.real, parent, sep, false)) return 'outside_root';
    const target = join(parent, binding.segments.at(-1)!);
    if (!(await this.unchanged(target, binding.target, true))) return 'target_changed';

    const temporary = join(parent, `.${randomBytes(8).toString('hex')}.roundtable-tmp`);
    let placed = false;
    try {
      await this.options.hooks?.beforeTemporary?.(binding.path);
      const handle = await this.fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o644);
      try {
        if (binding.target.kind === 'file') await handle.chmod(binding.target.mode);
        await handle.writeFile(binding.content);
        await handle.sync();
      } finally { await handle.close(); }
      await this.options.hooks?.beforeCommit?.(binding.path);
      // The folder chain may have been swapped while the copy was written. After this check a swapped folder no longer
      // holds the temporary file, so putting it in place fails instead of landing elsewhere (D129).
      if (await this.fs.realpath(parent) !== parent) return 'outside_root';
      if (binding.target.kind === 'missing') {
        try { await this.fs.link(temporary, target); }
        catch (error) {
          if (errno(error) === 'EEXIST') return 'target_changed';
          if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(errno(error) ?? '')) throw error;
          // A file system without hard links: create the target exclusively and write it directly.
          const direct = await this.fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o644).catch((reason: unknown) => {
            if (errno(reason) === 'EEXIST') return undefined; throw reason; });
          if (!direct) return 'target_changed';
          try { await direct.writeFile(binding.content); await direct.sync(); }
          catch (reason) { await this.fs.unlink(target).catch(() => undefined); throw reason; }
          finally { await direct.close(); }
        }
      } else {
        // The last look right before the swap; what changes after this instant is the residual window (D129).
        if (!(await this.unchanged(target, binding.target, false))) return 'target_changed';
        await this.fs.rename(temporary, target);
        placed = true;
      }
    } catch (error) {
      return failureReason(error);
    } finally {
      if (!placed) await this.fs.unlink(temporary).catch(() => undefined);
    }
    await this.syncDirectory(parent);
    return undefined;
  }

  private async syncDirectory(path: string): Promise<void> {
    try { const handle = await this.fs.open(path, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } }
    catch { /* not every platform can flush a folder; the file itself was flushed */ }
  }
}
