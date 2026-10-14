import type { BackupOptions, VerifiedBackup } from '../backup/createVerifiedBackup';
import { createVerifiedBackup, fileSha256 } from '../backup/createVerifiedBackup';
import Sqlite from 'better-sqlite3';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

export async function prepareRestore(backup: VerifiedBackup, directory: string, options: BackupOptions = {}): Promise<VerifiedBackup & { directory: string }> {
  if (!(await lstat(backup.path)).isFile()) throw new Error('Backup must be a regular file');
  if (await fileSha256(backup.path) !== backup.sha256) throw new Error('Backup checksum mismatch');
  const source = new Sqlite(backup.path, { readonly: true, fileMustExist: true });
  let staging: string | undefined;
  try {
    if (source.pragma('journal_mode', { simple: true }) !== 'delete') throw new Error('Backup is not a standalone database');
    staging = await mkdtemp(join(directory, '.roundtable-restore-'));
    const restored = await createVerifiedBackup(source, staging, options);
    if (await fileSha256(backup.path) !== backup.sha256) throw new Error('Backup checksum changed during recovery');
    if (restored.validation.evidenceSha256 !== backup.validation.evidenceSha256) throw new Error('Restored evidence does not match backup');
    return { ...restored, directory: staging };
  } catch (error) {
    if (staging) await rm(staging, { recursive: true, force: true });
    throw error;
  } finally { source.close(); }
}
