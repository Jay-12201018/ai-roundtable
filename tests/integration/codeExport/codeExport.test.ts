// @vitest-environment node
// R15 (D126–D131): every disk write here goes into a temporary directory this test owns; a sentinel file and folder
// outside the chosen folder prove nothing outside it changes.
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, closeSync, constants as fsConstants, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import Sqlite from 'better-sqlite3';
import { closeFixtures, hostFixture, startFree } from '../host/fixtures';
import { MAX_DIFF_INPUT_BYTES } from '../../../src/main/export/diff';
import { ArtifactService } from '../../../src/main/artifact/ArtifactService';
import { CodeExportService, type ExportFs, type ExportHooks } from '../../../src/main/export/CodeExportService';
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import { codeExportPreviewSchema, codeExportWriteResultSchema, type CodeExportPreview, type CodeExportWriteInput } from '../../../src/shared/schemas/codeExport';
import { artifactListSchema } from '../../../src/shared/schemas/artifact';
import { text } from '../../unit/artifacts/fixtures';

const owned: string[] = [];
afterEach(async () => {
  await closeFixtures();
  for (const dir of owned.splice(0)) { chmodTree(dir); rmSync(dir, { recursive: true, force: true }); }
});
function chmodTree(dir: string) {
  try { chmodSync(dir, 0o755); for (const name of readdirSync(dir)) { const path = join(dir, name); if (lstatSync(path).isDirectory()) chmodTree(path); } } catch { /* best effort */ }
}

type File = { path: string; content: string };
const doc = (files: File[]) => text({ title: '写入测试', summary: '用于检查写入。', files: files.map(file => ({ ...file, language: null, description: null })), notes: [] });
const tree = (dir: string): string[] => readdirSync(dir).sort().flatMap(name => {
  const path = join(dir, name); const info = lstatSync(path);
  const entry = `${relative(owned[0] ?? dir, path)} ${info.isSymbolicLink() ? `-> ${readlinkSync(path)}` : info.isDirectory() ? 'dir' : `${info.size} ${info.mtimeMs} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`}`;
  return info.isDirectory() && !info.isSymbolicLink() ? [entry, ...tree(path)] : [entry];
});

/** A finished discussion with one code candidate, a temp folder to write into and sentinels outside it. */
async function setup(files: File[], options: { fs?: Partial<ExportFs>; hooks?: ExportHooks; filename?: string } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'r15-export-')));
  owned.push(base);
  const root = join(base, 'project'); mkdirSync(root);
  const outside = join(base, 'outside'); mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'outside sentinel\n');
  writeFileSync(join(base, 'sentinel.txt'), 'sentinel\n');
  const appData = join(base, 'app-data'); mkdirSync(appData);
  writeFileSync(join(appData, 'ai-roundtable.db'), 'not really a database');
  const sentinels = () => ({ outside: tree(outside), sentinel: readFileSync(join(base, 'sentinel.txt'), 'utf8'), appData: tree(appData) });
  const before = sentinels();
  const f = hostFixture(undefined, options.filename ?? ':memory:');
  const artifacts = new ArtifactService(f.db, f.run);
  const { runId } = await startFree(f, { mode: 'automatic', maxTurns: 3 });
  await f.run.waitForIdle(runId);
  f.provider.answers.set(f.provider.inputs.length, doc(files));
  const preview = f.run.previewArtifact({ runId, kind: 'code' });
  const generated = f.run.generateArtifact({ runId, clientRequestId: 'g-code', kind: 'code', agentId: preview.agentId! });
  await f.run.waitForIdle(runId);
  const exportService = (extra: { fs?: Partial<ExportFs>; hooks?: ExportHooks } = {}) => new CodeExportService(f.db, id => artifacts.listCodeCandidates({ runId: id }), f.run,
    { protectedDirs: [appData], fs: { ...options.fs, ...extra.fs }, hooks: { ...options.hooks, ...extra.hooks }, home: base });
  const service = exportService();
  let counter = 0;
  const choose = async (folder: string | null = root, versionId = generated.versionId) => service.chooseRoot({ runId, versionId }, async () => folder ?? undefined);
  const previewOf = async (rootId: string, versionId = generated.versionId) => {
    const value = await service.preview({ runId, versionId, rootId });
    expect(codeExportPreviewSchema.safeParse(value).success).toBe(true);
    return value;
  };
  const write = async (value: CodeExportPreview, files: CodeExportWriteInput['files'], clientRequestId = `w-${++counter}`) => {
    const result = await service.write({ runId, clientRequestId, previewId: value.previewId, files });
    expect(codeExportWriteResultSchema.safeParse(result).success).toBe(true);
    return result;
  };
  const outcome = (result: Awaited<ReturnType<typeof write>>) => Object.fromEntries(result.files.map(file => [file.path, file.reason ? `${file.outcome}:${file.reason}` : file.outcome]));
  const status = (value: CodeExportPreview) => Object.fromEntries(value.files.map(file => [file.path, file.reason ? `${file.status}:${file.reason}` : file.status]));
  return { f, artifacts, runId, versionId: generated.versionId, base, root, outside, appData, before, sentinels, service, exportService, choose, previewOf, write, outcome, status };
}

describe('choosing the folder', () => {
  it('a code version that passed validation can be written at once (D139); the folder comes from Main\'s dialog as a reference', async () => {
    const t = await setup([{ path: 'a.ts', content: 'a\n' }]);
    expect(await t.choose(null)).toEqual({ runId: t.runId, versionId: t.versionId });
    const chosen = await t.choose();
    expect(chosen.root).toEqual({ rootId: expect.any(String), displayPath: '~/project', name: 'project' });
    expect(chosen.root).not.toHaveProperty('real');
    // A preview needs a reference Main issued; anything else is not found.
    await expect(t.service.preview({ runId: t.runId, versionId: t.versionId, rootId: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ detail: { code: 'not_found' } });
    expect(readdirSync(t.root)).toEqual([]);
  });

  it('refuses the disk root, the app\'s data folder and anything that is not a folder', async () => {
    const t = await setup([{ path: 'a.ts', content: 'a\n' }]); 
    expect((await t.choose('/')).refused).toBe('filesystem_root');
    expect((await t.choose(t.appData)).refused).toBe('app_data');
    mkdirSync(join(t.appData, 'inner'));
    expect((await t.choose(join(t.appData, 'inner'))).refused).toBe('app_data');
    expect((await t.choose(join(t.base, 'sentinel.txt'))).refused).toBe('not_directory');
    expect((await t.choose(join(t.base, 'missing'))).refused).toBe('not_directory');
    // Choosing a folder inside .git would make whatever is written there run with Git.
    mkdirSync(join(t.root, '.GIT/hooks'), { recursive: true });
    expect((await t.choose(join(t.root, '.GIT/hooks'))).refused).toBe('git_dir');
    expect((await t.choose(join(t.root, '.GIT'))).refused).toBe('git_dir');
    // A link to a folder resolves to the folder itself; the reference keeps the real path.
    symlinkSync(t.root, join(t.base, 'link-to-project'));
    expect((await t.choose(join(t.base, 'link-to-project'))).root).toMatchObject({ displayPath: '~/project' });
  });

  it('a folder that contains the app\'s data is allowed, but the data folder inside it is refused file by file', async () => {
    const t = await setup([{ path: 'app-data/ai-roundtable.db', content: 'overwrite me\n' }, { path: 'APP-DATA/new.txt', content: 'x\n' }, { path: 'ok.txt', content: 'ok\n' }]); 
    const chosen = await t.choose(t.base);
    const preview = await t.previewOf(chosen.root!.rootId);
    expect(t.status(preview)).toEqual({ 'app-data/ai-roundtable.db': 'invalid:app_data', 'APP-DATA/new.txt': 'invalid:app_data', 'ok.txt': 'create' });
    const result = await t.write(preview, preview.files.map(file => ({ path: file.path, overwrite: true })));
    expect(t.outcome(result)).toEqual({ 'app-data/ai-roundtable.db': 'failed:not_writable', 'APP-DATA/new.txt': 'failed:not_writable', 'ok.txt': 'written' });
    expect(t.sentinels().appData).toEqual(t.before.appData);
  });
});

describe('preview is read-only', () => {
  it('reports create, overwrite with a diff, same, invalid and conflict — and changes nothing on disk', async () => {
    const t = await setup([
      { path: 'src/new/deep/file.ts', content: 'export const x = 1;\n' },
      { path: 'src/fee.ts', content: 'export const BASE = 2;\nexport const RATE = 0.08;\n' },
      { path: 'README.md', content: '# 项目\n' },
      { path: 'CON', content: 'reserved\n' },
      { path: '.git/hooks/pre-commit', content: '#!/bin/sh\n' },
      { path: 'lib', content: 'collides with lib/x\n' },
      { path: 'LIB/x.ts', content: 'x\n' },
      { path: 'dir-target', content: 'x\n' },
      { path: 'note.txt/inner.ts', content: 'x\n' },
      { path: 'name.', content: 'x\n' },
    ]);
    
    mkdirSync(join(t.root, 'src'));
    writeFileSync(join(t.root, 'src/fee.ts'), 'export const BASE = 2;\nexport const RATE = 0.15;\n');
    writeFileSync(join(t.root, 'README.md'), '# 项目\n');
    mkdirSync(join(t.root, 'dir-target'));
    writeFileSync(join(t.root, 'note.txt'), 'a file, not a folder\n');
    const disk = tree(t.base);
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    expect(t.status(preview)).toEqual({
      'src/new/deep/file.ts': 'create', 'src/fee.ts': 'overwrite', 'README.md': 'same', CON: 'invalid:reserved_name', '.git/hooks/pre-commit': 'invalid:git_dir',
      lib: 'invalid:case_collision', 'LIB/x.ts': 'invalid:case_collision', 'dir-target': 'conflict:target_directory', 'note.txt/inner.ts': 'conflict:parent_not_directory',
      'name.': 'invalid:trailing_dot_space',
    });
    const created = preview.files.find(file => file.path === 'src/new/deep/file.ts')!;
    expect(created).toMatchObject({ createsDirectories: ['src/new', 'src/new/deep'], bytes: 20, lines: 1 });
    const fee = preview.files.find(file => file.path === 'src/fee.ts')!;
    expect(fee.existing).toMatchObject({ bytes: Buffer.byteLength('export const BASE = 2;\nexport const RATE = 0.15;\n') });
    expect(fee.diff).toMatchObject({ kind: 'lines', added: 1, removed: 1, truncated: false });
    expect(fee.diff!.kind === 'lines' && fee.diff!.hunks[0].lines.map(line => `${line.op}:${line.text}`)).toEqual(['same:export const BASE = 2;', 'remove:export const RATE = 0.15;', 'add:export const RATE = 0.08;']);
    expect(preview).toMatchObject({ versionNumber: 1, writable: true, root: { displayPath: '~/project' } });
    expect(tree(t.base)).toEqual(disk);
    // Previewing again, and not writing at all, is still zero writes and zero records.
    await t.previewOf(root!.rootId);
    expect(tree(t.base)).toEqual(disk);
    expect(t.f.db.findCodeExport(t.runId, 'none')).toBeUndefined();
    expect(t.artifacts.list({ runId: t.runId }).artifacts[0].versions[0]).not.toHaveProperty('codeWrites');
  });

  it('says when the folder cannot be written, and shows no line diff for a binary or huge file', async () => {
    const t = await setup([{ path: 'bin.dat', content: 'text now\n' }, { path: 'big.txt', content: 'small\n' }, { path: 'locked.txt', content: 'new\n' }]); 
    writeFileSync(join(t.root, 'bin.dat'), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(t.root, 'big.txt'), 'x'.repeat(3 * 1024 * 1024));
    writeFileSync(join(t.root, 'locked.txt'), 'read only\n'); chmodSync(join(t.root, 'locked.txt'), 0o444);
    const { root } = await t.choose();
    let preview = await t.previewOf(root!.rootId);
    expect(preview.files.map(file => file.diff)).toEqual([{ kind: 'unavailable', reason: 'binary' }, { kind: 'unavailable', reason: 'too_large' }, undefined]);
    expect(t.status(preview)['locked.txt']).toBe('conflict:permission_denied');
    chmodSync(t.root, 0o555);
    preview = await t.previewOf(root!.rootId);
    expect(preview.writable).toBe(false);
    chmodSync(t.root, 0o755);
  });
});

describe('writing only what the host ticked', () => {
  it('writes the selected files, skips the rest, records each outcome and marks the version exported', async () => {
    const t = await setup([{ path: 'src/a.ts', content: 'a\n' }, { path: 'src/b.ts', content: 'b\n' }, { path: 'docs/c.md', content: 'c\n' }, { path: 'same.txt', content: 's\n' }]);
    
    writeFileSync(join(t.root, 'same.txt'), 's\n');
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    const result = await t.write(preview, [{ path: 'src/a.ts', overwrite: false }]);
    expect(t.outcome(result)).toEqual({ 'src/a.ts': 'written', 'src/b.ts': 'skipped:not_selected', 'docs/c.md': 'skipped:not_selected', 'same.txt': 'skipped:unchanged' });
    expect(result).toMatchObject({ written: 1, skipped: 3, failed: 0, duplicate: false, root: { displayPath: '~/project', name: 'project' } });
    expect(readdirSync(t.root).sort()).toEqual(['same.txt', 'src']);
    expect(readdirSync(join(t.root, 'src'))).toEqual(['a.ts']);
    expect(readFileSync(join(t.root, 'src/a.ts'), 'utf8')).toBe('a\n');
    // Only text: a new file is never executable, whatever it contains.
    expect(statSync(join(t.root, 'src/a.ts')).mode & 0o111).toBe(0);
    const version = t.artifacts.list({ runId: t.runId }).artifacts[0].versions[0];
    expect(version).toMatchObject({ status: 'exported', exportedAt: result.createdAt, codeWrites: [{ exportId: result.exportId, folder: t.root, written: 1, skipped: 3, failed: 0, at: result.createdAt }] });
    expect(t.artifacts.listCodeCandidates({ runId: t.runId }).candidates[0].status).toBe('exported');
    const record = t.f.db.findCodeExport(t.runId, 'w-1')!;
    expect(record).toMatchObject({ versionId: t.versionId, rootPath: t.root, files: [
      { path: 'src/a.ts', action: 'create', outcome: 'written', bytes: 2, contentSha256: createHash('sha256').update('a\n').digest('hex') },
      { path: 'src/b.ts', outcome: 'skipped', reason: 'not_selected' }, { path: 'docs/c.md', outcome: 'skipped' }, { path: 'same.txt', action: 'none', reason: 'unchanged' }] });
    // The record holds no file contents.
    const raw = t.f.db['db'] as Sqlite.Database;
    expect(JSON.stringify(raw.prepare('SELECT * FROM code_export_files').all())).not.toContain('a\\n');
    expect(t.sentinels()).toEqual(t.before);
  });

  it('a write with nothing written still records the attempt but does not count as exported; empty selections are refused', async () => {
    const t = await setup([{ path: 'a.ts', content: 'a\n' }]); 
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    await expect(t.service.write({ runId: t.runId, clientRequestId: 'empty', previewId: preview.previewId, files: [] })).rejects.toMatchObject({ detail: { code: 'invalid_input' } });
    await expect(t.service.write({ runId: t.runId, clientRequestId: 'other', previewId: preview.previewId, files: [{ path: 'b.ts', overwrite: false }] })).rejects.toMatchObject({ detail: { code: 'invalid_input', field: 'files' } });
    expect(readdirSync(t.root)).toEqual([]);
    writeFileSync(join(t.root, 'a.ts'), 'someone else\n');
    const result = await t.write(preview, [{ path: 'a.ts', overwrite: false }]);
    expect(t.outcome(result)).toEqual({ 'a.ts': 'failed:target_changed' });
    expect(readFileSync(join(t.root, 'a.ts'), 'utf8')).toBe('someone else\n');
    expect(t.artifacts.list({ runId: t.runId }).artifacts[0].versions[0]).toMatchObject({ status: 'valid', codeWrites: [{ written: 0, failed: 1 }] });
    expect(t.artifacts.list({ runId: t.runId }).artifacts[0].versions[0]).not.toHaveProperty('exportedAt');
  });

  it('an overwrite needs its own confirmation; with it the old file is replaced in one step and keeps its permissions', async () => {
    const t = await setup([{ path: 'conf.json', content: '{"rate":0.08}\n' }]); 
    writeFileSync(join(t.root, 'conf.json'), '{"rate":0.15}\n'); chmodSync(join(t.root, 'conf.json'), 0o640);
    const { root } = await t.choose();
    let preview = await t.previewOf(root!.rootId);
    expect(t.outcome(await t.write(preview, [{ path: 'conf.json', overwrite: false }]))).toEqual({ 'conf.json': 'failed:not_confirmed' });
    expect(readFileSync(join(t.root, 'conf.json'), 'utf8')).toBe('{"rate":0.15}\n');
    // A preview is used once.
    await expect(t.write(preview, [{ path: 'conf.json', overwrite: true }])).rejects.toMatchObject({ detail: { code: 'not_found' } });
    preview = await t.previewOf(root!.rootId);
    expect(t.outcome(await t.write(preview, [{ path: 'conf.json', overwrite: true }]))).toEqual({ 'conf.json': 'written' });
    expect(readFileSync(join(t.root, 'conf.json'), 'utf8')).toBe('{"rate":0.08}\n');
    expect(statSync(join(t.root, 'conf.json')).mode & 0o777).toBe(0o640);
    expect(readdirSync(t.root)).toEqual(['conf.json']);
  });

  it('the same clientRequestId never writes twice', async () => {
    const t = await setup([{ path: 'a.ts', content: 'a\n' }]); 
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    const input = { runId: t.runId, clientRequestId: 'once', previewId: preview.previewId, files: [{ path: 'a.ts', overwrite: false }] };
    const [first, concurrent] = await Promise.all([t.service.write(input), t.service.write(input)]);
    expect(concurrent).toBe(first);
    writeFileSync(join(t.root, 'a.ts'), 'edited after the write\n');
    const again = await t.service.write(input);
    expect(again).toMatchObject({ duplicate: true, exportId: first.exportId, written: 1 });
    expect(readFileSync(join(t.root, 'a.ts'), 'utf8')).toBe('edited after the write\n');
  });
});

describe('links and races (情景：链接越界、覆盖竞态)', () => {
  it('never writes through a symbolic link, in the path or as the target', async () => {
    const t = await setup([{ path: 'link/x.ts', content: 'escape\n' }, { path: 'evil.ts', content: 'escape\n' }, { path: 'inner/link2/y.ts', content: 'escape\n' }]); 
    symlinkSync(t.outside, join(t.root, 'link'));
    symlinkSync(join(t.outside, 'secret.txt'), join(t.root, 'evil.ts'));
    mkdirSync(join(t.root, 'inner')); symlinkSync('../../outside', join(t.root, 'inner/link2'));
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    expect(t.status(preview)).toEqual({ 'link/x.ts': 'conflict:symlink_parent', 'evil.ts': 'conflict:target_symlink', 'inner/link2/y.ts': 'conflict:symlink_parent' });
    const result = await t.write(preview, preview.files.map(file => ({ path: file.path, overwrite: true })));
    expect(result).toMatchObject({ written: 0, failed: 3 });
    expect(t.sentinels()).toEqual(t.before);
  });

  it('a folder swapped for a link after the preview is refused', async () => {
    const t = await setup([{ path: 'src/x.ts', content: 'escape\n' }, { path: 'ok.ts', content: 'ok\n' }]); 
    mkdirSync(join(t.root, 'src'));
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    expect(t.status(preview)).toEqual({ 'src/x.ts': 'create', 'ok.ts': 'create' });
    renameSync(join(t.root, 'src'), join(t.base, 'src-moved'));
    symlinkSync(t.outside, join(t.root, 'src'));
    const result = await t.write(preview, [{ path: 'src/x.ts', overwrite: false }, { path: 'ok.ts', overwrite: false }]);
    expect(t.outcome(result)).toEqual({ 'src/x.ts': 'failed:symlink_parent', 'ok.ts': 'written' });
    expect(t.sentinels()).toEqual(t.before);
  });

  it('a target replaced by a link, created, or edited after the preview is not overwritten', async () => {
    const t = await setup([{ path: 'a.ts', content: 'new a\n' }, { path: 'b.ts', content: 'new b\n' }, { path: 'c.ts', content: 'new c\n' }]); 
    writeFileSync(join(t.root, 'a.ts'), 'old a\n'); writeFileSync(join(t.root, 'c.ts'), 'old c\n');
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    expect(t.status(preview)).toEqual({ 'a.ts': 'overwrite', 'b.ts': 'create', 'c.ts': 'overwrite' });
    rmSync(join(t.root, 'a.ts')); symlinkSync(join(t.outside, 'secret.txt'), join(t.root, 'a.ts'));
    writeFileSync(join(t.root, 'b.ts'), 'created by someone else\n');
    // Same size, so only the content (and time) tells.
    writeFileSync(join(t.root, 'c.ts'), 'NEW C\n');
    const result = await t.write(preview, [{ path: 'a.ts', overwrite: true }, { path: 'b.ts', overwrite: false }, { path: 'c.ts', overwrite: true }]);
    expect(t.outcome(result)).toEqual({ 'a.ts': 'failed:target_changed', 'b.ts': 'failed:target_changed', 'c.ts': 'failed:target_changed' });
    expect(readFileSync(join(t.root, 'b.ts'), 'utf8')).toBe('created by someone else\n');
    expect(readFileSync(join(t.root, 'c.ts'), 'utf8')).toBe('NEW C\n');
    expect(t.sentinels()).toEqual(t.before);
    expect(readdirSync(t.root).filter(name => name.includes('roundtable-tmp'))).toEqual([]);
  });

  it('a change in the last moment before the swap is still caught; a target created there is never overwritten', async () => {
    let race: (path: string) => void = () => undefined;
    const t = await setup([{ path: 'a.ts', content: 'new a\n' }, { path: 'b.ts', content: 'new b\n' }], { hooks: { beforeCommit: path => race(path) } }); 
    writeFileSync(join(t.root, 'a.ts'), 'old a\n');
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    race = path => { if (path === 'a.ts') writeFileSync(join(t.root, 'a.ts'), 'edited during the write, longer\n'); else writeFileSync(join(t.root, 'b.ts'), 'raced in\n'); };
    const result = await t.write(preview, [{ path: 'a.ts', overwrite: true }, { path: 'b.ts', overwrite: false }]);
    expect(t.outcome(result)).toEqual({ 'a.ts': 'failed:target_changed', 'b.ts': 'failed:target_changed' });
    expect(readFileSync(join(t.root, 'a.ts'), 'utf8')).toBe('edited during the write, longer\n');
    expect(readFileSync(join(t.root, 'b.ts'), 'utf8')).toBe('raced in\n');
    expect(readdirSync(t.root).sort()).toEqual(['a.ts', 'b.ts']);
  });

  it.each(['beforeTemporary', 'beforeCommit'] as const)('a folder swapped for a link at the last moment (%s) never receives the file', async moment => {
    let race: () => void = () => undefined;
    const t = await setup([{ path: 'src/x.ts', content: 'escape\n' }], { hooks: { [moment]: () => race() } }); 
    mkdirSync(join(t.root, 'src'));
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    race = () => { renameSync(join(t.root, 'src'), join(t.base, 'src-moved')); symlinkSync(t.outside, join(t.root, 'src')); };
    expect(t.outcome(await t.write(preview, [{ path: 'src/x.ts', overwrite: false }]))).toEqual({ 'src/x.ts': 'failed:outside_root' });
    expect(t.sentinels()).toEqual(t.before);
  });

  it('a new version of the candidate, or a replaced folder, makes the whole preview stale', async () => {
    const t = await setup([{ path: 'a.ts', content: 'a\n' }]); 
    const { root } = await t.choose();
    let preview = await t.previewOf(root!.rootId);
    // The host writes a new version after the preview: the old preview may not write the old content.
    const edited = t.artifacts.edit({ runId: t.runId, clientRequestId: 'edit', versionId: t.versionId, text: doc([{ path: 'a.ts', content: 'a v2\n' }]) });
    expect(t.outcome(await t.write(preview, [{ path: 'a.ts', overwrite: false }]))).toEqual({ 'a.ts': 'failed:candidate_changed' });
    // Only the latest effective version can be previewed at all.
    await expect(t.service.preview({ runId: t.runId, versionId: t.versionId, rootId: root!.rootId })).rejects.toMatchObject({ detail: { code: 'invalid_state' } });
    preview = await t.previewOf(root!.rootId, edited.versionId);
    renameSync(t.root, join(t.base, 'project-moved')); mkdirSync(t.root);
    expect(t.outcome(await t.write(preview, [{ path: 'a.ts', overwrite: false }]))).toEqual({ 'a.ts': 'failed:root_changed' });
    await expect(t.service.preview({ runId: t.runId, versionId: edited.versionId, rootId: root!.rootId })).rejects.toMatchObject({ detail: { code: 'not_found' } });
    expect(readdirSync(t.root)).toEqual([]);
    expect(readdirSync(join(t.base, 'project-moved'))).toEqual([]);
  });

  it('a file that could not be ticked is reported with its own reason, not as unselected', async () => {
    const t = await setup([{ path: 'CON', content: 'x\n' }, { path: 'link/x.ts', content: 'x\n' }, { path: 'ok.ts', content: 'ok\n' }]); 
    symlinkSync(t.outside, join(t.root, 'link'));
    const { root } = await t.choose();
    const result = await t.write(await t.previewOf(root!.rootId), [{ path: 'ok.ts', overwrite: false }]);
    expect(t.outcome(result)).toEqual({ CON: 'skipped:reserved_name', 'link/x.ts': 'skipped:symlink_parent', 'ok.ts': 'written' });
  });

  it('a name that differs only by case from what is on disk is a conflict, not a silent merge', async () => {
    const t = await setup([{ path: 'src/a.ts', content: 'a\n' }, { path: 'Readme.md', content: 'r\n' }]); 
    mkdirSync(join(t.root, 'Src')); writeFileSync(join(t.root, 'README.md'), 'existing\n');
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    expect(t.status(preview)).toEqual({ 'src/a.ts': 'conflict:case_mismatch', 'Readme.md': 'conflict:case_mismatch' });
    expect(readFileSync(join(t.root, 'README.md'), 'utf8')).toBe('existing\n');
  });
});

describe('write failures (情景：写入失败)', () => {
  it('a folder without permission fails that file only; the others are written and the result says so', async () => {
    const t = await setup([{ path: 'locked/a.ts', content: 'a\n' }, { path: 'free/b.ts', content: 'b\n' }]); 
    mkdirSync(join(t.root, 'locked'));
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    chmodSync(join(t.root, 'locked'), 0o555);
    const result = await t.write(preview, [{ path: 'locked/a.ts', overwrite: false }, { path: 'free/b.ts', overwrite: false }]);
    expect(t.outcome(result)).toEqual({ 'locked/a.ts': 'failed:permission_denied', 'free/b.ts': 'written' });
    expect(result).toMatchObject({ written: 1, failed: 1 });
    chmodSync(join(t.root, 'locked'), 0o755);
    expect(readdirSync(join(t.root, 'locked'))).toEqual([]);
  });

  it('a full disk while writing the second file keeps the old file intact and leaves no temporary file', async () => {
    let opens = 0;
    const t = await setup([{ path: 'one.ts', content: 'one v2\n' }, { path: 'two.ts', content: 'two v2\n' }, { path: 'three.ts', content: 'three\n' }], { fs: {
      open: async (path, flags, mode) => {
        const fs = await import('node:fs/promises');
        const handle = await fs.open(path, flags, mode);
        if (path.endsWith('.roundtable-tmp') && ++opens === 2) {
          return new Proxy(handle, { get: (target, key) => key === 'writeFile' ? async () => { throw Object.assign(new Error('No space left'), { code: 'ENOSPC' }); }
            : typeof target[key as keyof typeof target] === 'function' ? (target[key as keyof typeof target] as (...args: unknown[]) => unknown).bind(target) : target[key as keyof typeof target] });
        }
        return handle;
      },
    } }); 
    writeFileSync(join(t.root, 'one.ts'), 'one v1\n'); writeFileSync(join(t.root, 'two.ts'), 'two v1\n');
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    const result = await t.write(preview, preview.files.map(file => ({ path: file.path, overwrite: true })));
    expect(t.outcome(result)).toEqual({ 'one.ts': 'written', 'two.ts': 'failed:no_space', 'three.ts': 'written' });
    expect(readFileSync(join(t.root, 'two.ts'), 'utf8')).toBe('two v1\n');
    expect(readFileSync(join(t.root, 'one.ts'), 'utf8')).toBe('one v2\n');
    expect(readdirSync(t.root).sort()).toEqual(['one.ts', 'three.ts', 'two.ts']);
    expect(t.f.db.findCodeExport(t.runId, 'w-1')!.files.map(file => file.outcome)).toEqual(['written', 'failed', 'written']);
  });

  it('a file system without hard links still creates new files exclusively', async () => {
    const t = await setup([{ path: 'a.ts', content: 'a\n' }], { fs: { link: async () => { throw Object.assign(new Error('Not supported'), { code: 'ENOTSUP' }); } } }); 
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    expect(t.outcome(await t.write(preview, [{ path: 'a.ts', overwrite: false }]))).toEqual({ 'a.ts': 'written' });
    expect(readdirSync(t.root)).toEqual(['a.ts']);
    expect(readFileSync(join(t.root, 'a.ts'), 'utf8')).toBe('a\n');
  });
});

describe('a direct write on a file system without hard links', () => {
  it('leaves no partial file behind when it fails', async () => {
    const t = await setup([{ path: 'a.ts', content: 'a\n' }], { fs: {
      link: async () => { throw Object.assign(new Error('Not supported'), { code: 'ENOTSUP' }); },
      open: async (path, flags, mode) => {
        const fs = await import('node:fs/promises');
        const handle = await fs.open(path, flags, mode);
        if (!path.endsWith('a.ts')) return handle;
        return new Proxy(handle, { get: (target, key) => key === 'writeFile' ? async () => { throw Object.assign(new Error('No space left'), { code: 'ENOSPC' }); }
          : typeof target[key as keyof typeof target] === 'function' ? (target[key as keyof typeof target] as (...args: unknown[]) => unknown).bind(target) : target[key as keyof typeof target] });
      },
    } }); 
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    expect(t.outcome(await t.write(preview, [{ path: 'a.ts', overwrite: false }]))).toEqual({ 'a.ts': 'failed:no_space' });
    expect(readdirSync(t.root)).toEqual([]);
  });
});

/** A file handle whose calls can be watched or replaced, with everything else passed through. */
function wrapHandle(handle: fsp.FileHandle, overrides: Record<string, (target: fsp.FileHandle, ...args: never[]) => unknown>) {
  return new Proxy(handle, { get: (target, key) => {
    if (typeof key === 'string' && overrides[key]) return (...args: never[]) => overrides[key](target, ...args);
    const value = target[key as keyof typeof target];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  } });
}
const noSpace = (matches: (path: string) => boolean): Partial<ExportFs> => ({ open: async (path, flags, mode) => {
  const handle = await fsp.open(path, flags, mode);
  return matches(path) ? wrapHandle(handle, { writeFile: async () => { throw Object.assign(new Error('No space left'), { code: 'ENOSPC' }); } }) : handle;
} });

describe('existing files are never read whole unless they are small (D128)', () => {
  /** A file system that records how every target file is read. */
  const watched = () => {
    const record = { readFile: 0, reads: [] as number[] };
    const fs: Partial<ExportFs> = { open: async (path, flags, mode) => wrapHandle(await fsp.open(path, flags, mode), {
      readFile: (target) => { record.readFile++; return target.readFile(); },
      read: (target, ...args) => { record.reads.push((args as unknown as [Buffer, number, number])[2]); return (target.read as (...values: unknown[]) => unknown)(...args); },
    }) };
    return { record, fs };
  };
  const big = (size: number) => 'x'.repeat(99).concat('\n').repeat(Math.ceil(size / 100)).slice(0, size);

  it('a file over the diff limit is hashed in small pieces: its status and diff are right, in preview and in the check before writing', async () => {
    const { record, fs } = watched();
    const t = await setup([{ path: 'big.log', content: 'small now\n' }], { fs }); 
    const size = 5 * 1024 * 1024;
    writeFileSync(join(t.root, 'big.log'), big(size));
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    expect(preview.files[0]).toMatchObject({ status: 'overwrite', existing: { bytes: size }, diff: { kind: 'unavailable', reason: 'too_large' } });
    const previewReads = record.reads.length;
    expect(previewReads).toBeGreaterThan(50);
    expect(t.outcome(await t.write(preview, [{ path: 'big.log', overwrite: true }]))).toEqual({ 'big.log': 'written' });
    expect(record.reads.length).toBeGreaterThanOrEqual(previewReads * 2);
    expect(record.readFile).toBe(0);
    expect(Math.max(...record.reads)).toBeLessThanOrEqual(64 * 1024);
    expect(readFileSync(join(t.root, 'big.log'), 'utf8')).toBe('small now\n');
  });

  it('the limit itself: up to it there is a line diff, one byte over there is none', async () => {
    const t = await setup([{ path: 'at.txt', content: 'new\n' }, { path: 'over.txt', content: 'new\n' }]); 
    writeFileSync(join(t.root, 'at.txt'), 'y'.repeat(MAX_DIFF_INPUT_BYTES));
    writeFileSync(join(t.root, 'over.txt'), 'y'.repeat(MAX_DIFF_INPUT_BYTES + 1));
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    expect(preview.files.map(file => file.diff?.kind)).toEqual(['lines', 'unavailable']);
  });

  it.each([['big', 3 * 1024 * 1024], ['small', 1024]] as const)('a %s file edited after the preview is found by its content, even with the same size and time', async (_label, size) => {
    const t = await setup([{ path: 'data.txt', content: 'replacement\n' }]); 
    const path = join(t.root, 'data.txt');
    const original = big(size);
    writeFileSync(path, original); utimesSync(path, 1_700_000_000, 1_700_000_000);
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    expect(preview.files[0].status).toBe('overwrite');
    const edited = `Z${original.slice(1)}`;
    writeFileSync(path, edited); utimesSync(path, 1_700_000_000, 1_700_000_000);
    expect(lstatSync(path, { bigint: true }).mtimeNs).toBe(1_700_000_000_000_000_000n);
    expect(t.outcome(await t.write(preview, [{ path: 'data.txt', overwrite: true }]))).toEqual({ 'data.txt': 'failed:target_changed' });
    expect(readFileSync(path, 'utf8')).toBe(edited);
  });

  it('a file that grows while it is being read counts as changed, and reading stops at its size', async () => {
    let appended = false;
    const reads: number[] = [];
    const t = await setup([{ path: 'grow.log', content: 'new\n' }], { fs: { open: async (path, flags, mode) => wrapHandle(await fsp.open(path, flags, mode), {
      read: async (target, ...args) => {
        reads.push((args as unknown as [Buffer, number, number])[2]);
        if (!appended) { appended = true; appendFileSync(path, 'x'.repeat(1024 * 1024)); }
        return (target.read as (...values: unknown[]) => unknown)(...args);
      },
    }) } }); 
    writeFileSync(join(t.root, 'grow.log'), 'old\n');
    const { root } = await t.choose();
    expect(t.status(await t.previewOf(root!.rootId))).toEqual({ 'grow.log': 'conflict:target_changed' });
    expect(reads.length).toBeLessThanOrEqual(2);
  });

  it('a path swapped for a FIFO after the check does not hang: opening does not wait for a writer', async () => {
    const decoy = { path: '' };
    const t = await setup([{ path: 'pipe.txt', content: 'new\n' }], { fs: {
      // lstat still sees the regular file it saw before the swap.
      lstat: path => path.endsWith('pipe.txt') ? fsp.lstat(decoy.path, { bigint: true }) : fsp.lstat(path, { bigint: true }),
    } }); 
    decoy.path = join(t.base, 'decoy.txt'); writeFileSync(decoy.path, 'old\n');
    const pipe = join(t.root, 'pipe.txt');
    execFileSync('mkfifo', [pipe]);
    const { root } = await t.choose();
    // If opening ever blocks, this valve frees the file-system thread so the failure is an assertion, not a stuck test run.
    let blocked = false;
    const valve = setTimeout(() => { blocked = true; closeSync(openSync(pipe, fsConstants.O_RDWR | fsConstants.O_NONBLOCK)); }, 3000);
    try { expect(t.status(await t.previewOf(root!.rootId))).toEqual({ 'pipe.txt': 'conflict:target_changed' }); }
    finally { clearTimeout(valve); }
    expect(blocked).toBe(false);
  });
});

describe('folders created for a write that did not happen', () => {
  it('removes the folders this write created when they stayed empty, deepest first', async () => {
    const t = await setup([{ path: 'a/b/c/x.ts', content: 'x\n' }], { fs: noSpace(path => path.endsWith('.roundtable-tmp')) }); 
    const { root } = await t.choose();
    expect(t.outcome(await t.write(await t.previewOf(root!.rootId), [{ path: 'a/b/c/x.ts', overwrite: false }]))).toEqual({ 'a/b/c/x.ts': 'failed:no_space' });
    expect(readdirSync(t.root)).toEqual([]);
  });

  it('keeps a created folder another written file now lives in, and every folder that was already there', async () => {
    let opens = 0;
    const t = await setup([{ path: 'new/x.ts', content: 'x\n' }, { path: 'new/y.ts', content: 'y\n' }, { path: 'old/made/z.ts', content: 'z\n' }, { path: 'old/kept/w.ts', content: 'w\n' }],
      { fs: noSpace(path => path.endsWith('.roundtable-tmp') && (++opens === 1 || opens === 3 || opens === 4)) }); 
    mkdirSync(join(t.root, 'old/kept'), { recursive: true });
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    expect(t.outcome(await t.write(preview, preview.files.map(file => ({ path: file.path, overwrite: false }))))).toEqual({
      'new/x.ts': 'failed:no_space', 'new/y.ts': 'written', 'old/made/z.ts': 'failed:no_space', 'old/kept/w.ts': 'failed:no_space' });
    expect(readdirSync(join(t.root, 'new'))).toEqual(['y.ts']);
    expect(readdirSync(join(t.root, 'old'))).toEqual(['kept']);
    expect(readdirSync(join(t.root, 'old/kept'))).toEqual([]);
  });

  it('leaves a folder someone else put a file in, or replaced with their own', async () => {
    let race: () => void = () => undefined;
    const t = await setup([{ path: 'mine/x.ts', content: 'x\n' }, { path: 'theirs/y.ts', content: 'y\n' }], { hooks: { beforeCommit: () => race() } }); 
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    let step = 0;
    race = () => {
      if (++step === 1) writeFileSync(join(t.root, 'mine/x.ts'), 'someone else\n');
      else { renameSync(join(t.root, 'theirs'), join(t.base, 'moved')); mkdirSync(join(t.root, 'theirs')); }
    };
    const result = await t.write(preview, preview.files.map(file => ({ path: file.path, overwrite: false })));
    expect(result.written).toBe(0);
    expect(readFileSync(join(t.root, 'mine/x.ts'), 'utf8')).toBe('someone else\n');
    expect(lstatSync(join(t.root, 'theirs')).isDirectory()).toBe(true);
  });
});

describe('generated code is never run (情景：代码不执行)', () => {
  it('a candidate full of commands lands as plain text and nothing runs', async () => {
    const script = '#!/bin/sh\ntouch "$(dirname "$0")/PWNED"\nrm -rf ~\n';
    const pkg = JSON.stringify({ name: 'x', scripts: { postinstall: 'touch PWNED' } });
    const t = await setup([{ path: 'install.sh', content: script }, { path: 'package.json', content: pkg }, { path: 'Makefile', content: 'all:\n\ttouch PWNED\n' }]); 
    const { root } = await t.choose();
    const preview = await t.previewOf(root!.rootId);
    await t.write(preview, preview.files.map(file => ({ path: file.path, overwrite: false })));
    expect(readFileSync(join(t.root, 'install.sh'), 'utf8')).toBe(script);
    expect(statSync(join(t.root, 'install.sh')).mode & 0o111).toBe(0);
    expect(readdirSync(t.root).sort()).toEqual(['Makefile', 'install.sh', 'package.json']);
    expect(t.sentinels()).toEqual(t.before);
  });

  it('the export module has no way to start a process', () => {
    for (const file of ['CodeExportService.ts', 'paths.ts', 'diff.ts']) {
      const source = readFileSync(join(__dirname, '../../../src/main/export', file), 'utf8');
      expect(source).not.toMatch(/child_process|\bspawn\b|\bexec(File)?(Sync)?\(|shell\.open|vm\.|new Function|\beval\(/u);
    }
  });
});

describe('records survive a restart and are protected (migration 13)', () => {
  it('keeps the write after reopening the database; validation covers the new tables', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'r15-db-'))); owned.push(dir);
    const filename = join(dir, 'roundtable.db');
    const t = await setup([{ path: 'a.ts', content: 'a\n' }], { filename }); 
    const { root } = await t.choose();
    const result = await t.write(await t.previewOf(root!.rootId), [{ path: 'a.ts', overwrite: false }]);
    await closeFixtures();
    const raw = new Sqlite(filename);
    try {
      expect(validateDatabase(raw).schemaVersion).toBe(14);
      expect(() => raw.prepare("UPDATE code_exports SET root_path='/elsewhere'").run()).toThrow('Code exports are append-only');
      expect(() => raw.prepare('DELETE FROM code_export_files').run()).toThrow('Code export files are append-only');
      expect(() => raw.prepare("INSERT INTO code_exports(id,version_id,run_id,client_request_id,root_path,created_at) SELECT 'x','not-a-version',v.run_id,'x','/x','t' FROM artifact_versions v").run()).toThrow('Invalid code export');
    } finally { raw.close(); }
    const reopened = hostFixture(undefined, filename, false);
    const artifacts = new ArtifactService(reopened.db, reopened.run);
    const listed = artifacts.list({ runId: t.runId });
    expect(artifactListSchema.safeParse(listed).success).toBe(true);
    expect(listed.artifacts[0].versions[0]).toMatchObject({ status: 'exported', codeWrites: [{ exportId: result.exportId, written: 1, folder: t.root }] });
  });

  it('validation refuses tampered records', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'r15-db-'))); owned.push(dir);
    const filename = join(dir, 'roundtable.db');
    const t = await setup([{ path: 'a.ts', content: 'a\n' }], { filename }); 
    const { root } = await t.choose();
    await t.write(await t.previewOf(root!.rootId), [{ path: 'a.ts', overwrite: false }]);
    await closeFixtures();
    let copies = 0;
    const tampered = async (sql: string, message: string) => {
      const copy = join(dir, `copy-${++copies}.db`);
      const source = new Sqlite(filename); await source.backup(copy); source.close();
      const raw = new Sqlite(copy);
      try { expect(validateDatabase(raw).schemaVersion).toBe(14); raw.exec(sql); expect(() => validateDatabase(raw)).toThrow(message); } finally { raw.close(); }
    };
    await tampered('DROP TRIGGER code_export_file_no_delete', 'Missing R15 code export protection');
    await tampered("INSERT INTO code_export_files SELECT export_id,1,'b.ts','none','skipped','made_up',content_sha256,0 FROM code_export_files", 'Invalid code export file');
    await tampered("INSERT INTO code_export_files SELECT export_id,5,'c.ts','none','skipped','not_selected',content_sha256,0 FROM code_export_files", 'Invalid code export file');
    await tampered("INSERT INTO code_export_files SELECT export_id,1,'../x','none','skipped','not_selected',content_sha256,0 FROM code_export_files", 'Invalid code export file');
    await tampered("DROP TRIGGER code_export_file_no_delete; DELETE FROM code_export_files", 'Missing R15 code export protection');
  });
});
