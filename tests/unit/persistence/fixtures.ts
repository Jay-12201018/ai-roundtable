import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { Database } from '../../../src/main/database/Database';

export function diskFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'roundtable-r03-test-'));
  const path = join(directory, 'source.db');
  const database = new Database(path);
  try {
    database.initialize();
    database.transaction(() => {
      database.insertRoom({ id: 'room', name: 'Fixture', objective: 'History' });
      database.insertAgent({ id: 'agent', roomId: 'room', displayName: 'A', roleTemplateId: 'draft', displayOrder: 0 });
      database.insertRun({ id: 'run', roomId: 'room', status: 'running', workflowSnapshot: { templateId: 'draft', members: ['agent'] } });
      database.insertTurn({ id: 'turn', runId: 'run', agentId: 'agent', status: 'running', requestId: 'request', turnIndex: 0 });
      database.updateTurn('turn', { partialContent: '已生成的部分文本' });
      database.insertMessage({ id: 'message', roomId: 'room', runId: 'run', turnId: 'turn', senderType: 'agent', senderName: 'A', content: '已生成的部分文本', status: 'streaming' });
      database.appendRunEvent({ runId: 'run', turnId: 'turn', type: 'turn_started', payload: { turnId: 'turn', messageId: 'message', agentId: 'agent', requestId: 'request' }, timestamp: '2026-10-14T00:00:00.000Z' });
    });
  } finally { database.close(); }
  const db = new Sqlite(path, { timeout: 0 });
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 0');
  return { directory, path, db, dispose() { if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

export function enlarge(db: Sqlite.Database): void {
  db.prepare('UPDATE messages SET content = ? WHERE id = ?').run('持久化'.repeat(180000), 'message');
}
