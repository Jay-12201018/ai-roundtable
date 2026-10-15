import Sqlite from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdtemp, open, rm, stat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { DatabaseValidation } from '../recovery/validateDatabase';
import { validateDatabase } from '../recovery/validateDatabase';

export type BackupOptions = { signal?: AbortSignal; timeoutMs?: number; onProgress?: (progress: Sqlite.BackupMetadata) => void };
export type VerifiedBackup = { path: string; sha256: string; bytes: number; totalPages: number; validation: DatabaseValidation };

const activeBackups = new WeakSet<Sqlite.Database>();

export async function createVerifiedBackup(source: Sqlite.Database, directory: string, options: BackupOptions = {}): Promise<VerifiedBackup> {
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid backup timeout');
  const deadline = performance.now() + timeoutMs;
  const check = () => {
    if (options.signal?.aborted) throw new Error('Backup cancelled');
    if (performance.now() >= deadline) throw new Error('Backup timed out');
  };
  check();
  if (activeBackups.has(source)) throw new Error('Backup already in progress');
  if (source.inTransaction) throw new Error('Cannot back up an uncommitted source transaction');
  activeBackups.add(source);
  let staging: string | undefined;
  let published: string | undefined;
  try {
    staging = await mkdtemp(join(directory, '.roundtable-backup-'));
    const partial = join(staging, 'snapshot.partial');
    check();
    const pages = await source.backup(partial, { progress(info) {
      check();
      options.onProgress?.(info);
      check();
      return 100;
    } });
    check();
    // SQLite BUSY before the first transfer can appear as a zero-page result.
    if (!pages.totalPages || pages.remainingPages) throw new Error('Backup busy: no complete snapshot');
    const candidate = new Sqlite(partial, { fileMustExist: true });
    let validation: DatabaseValidation;
    try {
      if (candidate.pragma('journal_mode = DELETE', { simple: true }) !== 'delete') throw new Error('Backup journal is not standalone');
      validation = validateDatabase(candidate);
    } finally { candidate.close(); }
    await chmod(partial, 0o600);
    const bytes = (await stat(partial)).size;
    const sha256 = await fileSha256(partial);
    check();
    const file = await open(partial, 'r+');
    try { await file.sync(); } finally { await file.close(); }
    check();
    const path = join(directory, `backup-${randomUUID()}.sqlite3`);
    await link(partial, path);
    published = path;
    // shortcut: Node cannot fsync Windows directories; qualify power-loss durability before Windows release.
    if (process.platform !== 'win32') {
      const parent = await open(directory, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    }
    check();
    return { path, sha256, bytes, totalPages: pages.totalPages, validation };
  } catch (error) {
    if (published) await rm(published, { force: true });
    throw error;
  } finally {
    activeBackups.delete(source);
    if (staging) await rm(staging, { recursive: true, force: true });
  }
}

export async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
