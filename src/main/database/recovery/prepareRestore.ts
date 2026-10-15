import type { BackupOptions, VerifiedBackup } from '../backup/createVerifiedBackup';
import { createVerifiedBackup, fileSha256 } from '../backup/createVerifiedBackup';
import Sqlite from 'better-sqlite3';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

export async function prepareRestore(backup: VerifiedBackup, directory: string, options: BackupOptions = {}): Promise<VerifiedBackup & { directory: string }> {
  const timeout = options.timeoutMs??30000;
  if (!Number.isSafeInteger(timeout) || timeout<=0) throw new Error('Invalid restore timeout');
  const deadline = performance.now()+timeout;
  const check = () => {
    if (options.signal?.aborted) throw new Error('Restore cancelled');
    if (performance.now()>=deadline) throw new Error('Restore timed out');
  };
  check();
  if (!(await lstat(backup.path)).isFile()) throw new Error('Backup must be a regular file');
  check();
  if (await fileSha256(backup.path) !== backup.sha256) throw new Error('Backup checksum mismatch');
  check();
  const source = new Sqlite(backup.path, { readonly: true, fileMustExist: true });
  let staging: string | undefined;
  try {
    if (source.pragma('journal_mode', { simple: true }) !== 'delete') throw new Error('Backup is not a standalone database');
    staging = await mkdtemp(join(directory, '.roundtable-restore-'));
    check();
    const restored = await createVerifiedBackup(source, staging, {...options,timeoutMs:Math.max(1,Math.ceil(deadline-performance.now()))});
    check();
    if (await fileSha256(backup.path) !== backup.sha256) throw new Error('Backup checksum changed during recovery');
    check();
    if (restored.validation.evidenceSha256 !== backup.validation.evidenceSha256) throw new Error('Restored evidence does not match backup');
    return { ...restored, directory: staging };
  } catch (error) {
    if (staging) await rm(staging, { recursive: true, force: true });
    throw error;
  } finally { source.close(); }
}
