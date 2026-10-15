// @vitest-environment node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fs from 'node:fs/promises';
import Sqlite from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { createVerifiedBackup } from '../../../src/main/database/backup/createVerifiedBackup';
import { prepareRestore } from '../../../src/main/database/recovery/prepareRestore';
import { diskFixture, enlarge } from '../../unit/persistence/fixtures';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

describe('verified SQLite backup and staged recovery', () => {
  it('includes committed WAL even when an older reader blocks checkpoint', async () => {
    const f = diskFixture();
    const reader = new Sqlite(f.path, { timeout: 0 });
    try {
      reader.exec('BEGIN');
      reader.prepare('SELECT content FROM messages').get();
      f.db.prepare('UPDATE messages SET content = ? WHERE id = ?').run('WAL 中的最新部分文本', 'message');
      expect((f.db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>)[0].busy).toBe(1);
      const backup = await createVerifiedBackup(f.db, f.directory);
      expect(backup.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(backup.validation.counts).toMatchObject({ runs: 1, turns: 1, messages: 1, events: 1 });
      const restored = await prepareRestore(backup, f.directory);
      const candidate = new Sqlite(restored.path, { readonly: true });
      try {
        expect(candidate.pragma('integrity_check', { simple: true })).toBe('ok');
        expect(candidate.pragma('foreign_key_check')).toEqual([]);
        expect(candidate.prepare('SELECT content FROM messages').pluck().get()).toBe('WAL 中的最新部分文本');
        expect(candidate.prepare('SELECT id, run_id, request_id, partial_content FROM turns').get()).toEqual({ id: 'turn', run_id: 'run', request_id: 'request', partial_content: '已生成的部分文本' });
        expect(restored.validation.evidenceSha256).toBe(backup.validation.evidenceSha256);
      } finally { candidate.close(); }
      expect(readFileSync(backup.path)).toHaveLength(backup.bytes);
    } finally { reader.close(); f.dispose(); }
  });

  it('restarts consistently after a second connection commits during backup', async () => {
    const f = diskFixture();
    const writer = new Sqlite(f.path, { timeout: 0 });
    try {
      enlarge(f.db);
      let wrote = false;
      const backup = await createVerifiedBackup(f.db, f.directory, { onProgress(info) {
        if (info.remainingPages > 0 && !wrote) {
          writer.prepare('UPDATE turns SET partial_content = ?').run('并发提交');
          wrote = true;
        }
      } });
      expect(wrote).toBe(true);
      const candidate = new Sqlite(backup.path, { readonly: true });
      try { expect(candidate.prepare('SELECT partial_content FROM turns').pluck().get()).toBe('并发提交'); }
      finally { candidate.close(); }
    } finally { writer.close(); f.dispose(); }
  });

  it('excludes uncommitted writes and leaves the writer transaction untouched', async () => {
    const f = diskFixture();
    const writer = new Sqlite(f.path, { timeout: 0 });
    try {
      writer.exec('BEGIN IMMEDIATE');
      writer.prepare('UPDATE messages SET content = ?').run('未提交');
      const backup = await createVerifiedBackup(f.db, f.directory);
      const copy = new Sqlite(backup.path, { readonly: true });
      try { expect(copy.prepare('SELECT content FROM messages').pluck().get()).toBe('已生成的部分文本'); }
      finally { copy.close(); }
      expect(writer.inTransaction).toBe(true);
    } finally { writer.close(); f.dispose(); }
  });

  it('cancels an active backup and preserves an earlier verified backup', async () => {
    const f = diskFixture();
    try {
      const first = await createVerifiedBackup(f.db, f.directory);
      const original = readFileSync(first.path);
      enlarge(f.db);
      const abort = new AbortController();
      await expect(createVerifiedBackup(f.db, f.directory, { signal: abort.signal, onProgress() { abort.abort(); } })).rejects.toThrow(/cancel/i);
      expect(readFileSync(first.path)).toEqual(original);
      expect(readdirSync(f.directory).filter((name) => name.startsWith('backup-'))).toHaveLength(1);
      expect(readdirSync(f.directory).filter((name) => name.startsWith('.roundtable-'))).toEqual([]);
      expect(f.db.open).toBe(true);
    } finally { f.dispose(); }
  });

  it('rejects overlapping backup on the same connection without stopping the first', async () => {
    const f = diskFixture();
    try {
      enlarge(f.db);
      const first = createVerifiedBackup(f.db, f.directory);
      void first.catch(() => undefined);
      await expect(createVerifiedBackup(f.db, f.directory)).rejects.toThrow(/progress/i);
      expect(existsSync((await first).path)).toBe(true);
    } finally { f.dispose(); }
  });

  it('fails explicitly when an exclusive rollback-journal writer blocks backup', async () => {
    const f = diskFixture();
    let writer: Sqlite.Database | undefined;
    try {
      f.db.pragma('journal_mode = DELETE');
      writer = new Sqlite(f.path, { timeout: 0 });
      writer.exec('BEGIN EXCLUSIVE');
      await expect(createVerifiedBackup(f.db, f.directory, { timeoutMs: 25 })).rejects.toThrow(/busy|timed out/i);
      expect(readdirSync(f.directory).filter((name) => name.startsWith('backup-') || name.startsWith('.roundtable-'))).toEqual([]);
    } finally { writer?.close(); f.dispose(); }
  });

  it('does not publish a backup that exceeds its deadline', async () => {
    const f = diskFixture();
    try {
      enlarge(f.db);
      await expect(createVerifiedBackup(f.db, f.directory, { timeoutMs: 10, onProgress() {
        const until = performance.now() + 20;
        while (performance.now() < until) { /* Simulate a delayed progress consumer. */ }
      } })).rejects.toThrow(/timed out/i);
      expect(readdirSync(f.directory).filter((name) => name.startsWith('backup-') || name.startsWith('.roundtable-'))).toEqual([]);
    } finally { f.dispose(); }
  });

  it('fails cleanly when the source closes during an active backup', async () => {
    const f = diskFixture();
    try {
      enlarge(f.db);
      let closed = false;
      await expect(createVerifiedBackup(f.db, f.directory, { onProgress() { f.db.close(); closed = true; } })).rejects.toThrow();
      expect(closed).toBe(true);
      expect(readdirSync(f.directory).filter((name) => name.startsWith('backup-') || name.startsWith('.roundtable-'))).toEqual([]);
    } finally { f.dispose(); }
  });

  it('rejects a modified backup before restoring and preserves the source database', async () => {
    const f = diskFixture();
    try {
      const backup = await createVerifiedBackup(f.db, f.directory);
      const copy = new Sqlite(backup.path);
      try { copy.prepare('UPDATE messages SET content = ?').run('篡改'); } finally { copy.close(); }
      const before = readFileSync(f.path);
      await expect(prepareRestore(backup, f.directory)).rejects.toThrow(/checksum/i);
      expect(readFileSync(f.path)).toEqual(before);
      expect(existsSync(backup.path)).toBe(true);
      expect(readdirSync(f.directory).filter((name) => name.startsWith('.roundtable-restore-'))).toEqual([]);
    } finally { f.dispose(); }
  });

  it('does not publish structurally inconsistent source data', async () => {
    const f = diskFixture();
    try {
      f.db.exec("UPDATE messages SET run_id = NULL WHERE id = 'message'");
      await expect(createVerifiedBackup(f.db, f.directory)).rejects.toThrow(/identity/i);
      expect(readdirSync(f.directory).filter((name) => name.startsWith('backup-'))).toEqual([]);
      expect(f.db.prepare('SELECT run_id FROM messages').pluck().get()).toBeNull();
    } finally { f.dispose(); }
  });

  it('rejects pre-cancelled requests and invalid timeout before creating files', async () => {
    const f = diskFixture();
    try {
      const before = readdirSync(f.directory);
      await expect(createVerifiedBackup(f.db, f.directory, { signal: AbortSignal.abort() })).rejects.toThrow(/cancel/i);
      await expect(createVerifiedBackup(f.db, f.directory, { timeoutMs: 0 })).rejects.toThrow(/timeout/i);
      expect(readdirSync(f.directory)).toEqual(before);
    } finally { f.dispose(); }
  });

  it('never treats an interrupted staging file as a verified backup', async () => {
    const f = diskFixture();
    try {
      const backup = await createVerifiedBackup(f.db, f.directory);
      const incomplete = join(f.directory, 'incomplete.sqlite3');
      writeFileSync(incomplete, 'SQLite format 3\0incomplete');
      await expect(prepareRestore({ ...backup, path: incomplete }, f.directory)).rejects.toThrow();
      expect(existsSync(backup.path)).toBe(true);
    } finally { f.dispose(); }
  });

  it('uses a writable flush handle without directory fsync on Windows', async () => {
    const f = diskFixture();
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const originalOpen = (await vi.importActual<typeof fs>('node:fs/promises')).open;
    const open = vi.mocked(fs.open).mockClear().mockImplementation(async (path, flags, mode) => {
      if (path === f.directory) throw new Error('Windows cannot flush this directory handle');
      const handle = await originalOpen(path, flags, mode);
      if (flags === 'r') handle.sync = async () => { throw new Error('FlushFileBuffers requires write access'); };
      return handle;
    });
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const backup = await createVerifiedBackup(f.db, f.directory);
      expect(existsSync(backup.path)).toBe(true);
      expect(open).toHaveBeenCalledWith(expect.stringContaining('snapshot.partial'), 'r+');
    } finally {
      Object.defineProperty(process, 'platform', descriptor);
      open.mockImplementation(originalOpen);
      f.dispose();
    }
  });
});
