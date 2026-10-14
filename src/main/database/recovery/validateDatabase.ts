import type Sqlite from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { messageStatusValues, runStatusValues, turnStatusValues } from '../../../shared/types/run';

export type DatabaseValidation = { schemaVersion: number; counts: { runs: number; turns: number; messages: number; events: number }; evidenceSha256: string };

export function validateDatabase(db: Sqlite.Database): DatabaseValidation {
  return db.transaction(() => {
    const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
    if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('SQLite foreign key check failed');

    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all() as string[];
    for (const table of ['rooms', 'providers', 'agents', 'workflow_runs', 'turns', 'messages', 'run_events', 'key_records', 'schema_backups']) {
      if (!tables.includes(table)) throw new Error('Recovery schema is incomplete');
    }
    // An intact original schema may predate the ledger; report unknown version 0 without adding one.
    const versions = tables.includes('schema_migrations') ? db.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all() as number[] : [];
    if (versions.some((version, index) => version !== index + 1)) throw new Error('Invalid migration ledger');

    for (const [table, statuses] of [['workflow_runs', runStatusValues], ['turns', turnStatusValues], ['messages', messageStatusValues]] as const) {
      if (db.prepare(`SELECT 1 FROM ${table} WHERE status NOT IN (${statuses.map(() => '?').join(',')}) LIMIT 1`).get(...statuses)) throw new Error('Invalid persisted status');
    }
    assertNoRows(db, "SELECT 1 FROM workflow_runs WHERE NOT json_valid(workflow_snapshot) LIMIT 1", 'Invalid workflow JSON');
    assertNoRows(db, "SELECT 1 FROM workflow_runs WHERE json_type(workflow_snapshot) <> 'object' LIMIT 1", 'Invalid workflow JSON');
    assertNoRows(db, 'SELECT 1 FROM run_events WHERE NOT json_valid(payload_json) LIMIT 1', 'Invalid event JSON');
    assertNoRows(db, `SELECT 1 FROM (
      SELECT sequence, ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY sequence) AS expected FROM run_events
    ) WHERE sequence <> expected LIMIT 1`, 'Invalid event sequence');

    assertNoRows(db, `SELECT 1 FROM turns t JOIN workflow_runs r ON r.id = t.run_id JOIN agents a ON a.id = t.agent_id
      WHERE a.room_id <> r.room_id LIMIT 1`, 'Invalid Turn identity');
    assertNoRows(db, `SELECT 1 FROM messages m LEFT JOIN workflow_runs r ON r.id = m.run_id LEFT JOIN turns t ON t.id = m.turn_id
      WHERE (m.run_id IS NOT NULL AND m.room_id <> r.room_id)
      OR (m.turn_id IS NOT NULL AND (m.run_id IS NULL OR t.run_id <> m.run_id)) LIMIT 1`, 'Invalid Message identity');
    assertNoRows(db, `SELECT 1 FROM workflow_runs r LEFT JOIN turns t ON t.id = r.current_turn_id LEFT JOIN agents a ON a.id = r.current_agent_id
      WHERE (r.current_turn_id IS NOT NULL AND (t.id IS NULL OR t.run_id <> r.id))
      OR (r.current_agent_id IS NOT NULL AND (a.id IS NULL OR a.room_id <> r.room_id)) LIMIT 1`, 'Invalid Run identity');
    // v0 stored Turn identity only in payload; validate it without rewriting history.
    assertNoRows(db, `SELECT 1 FROM run_events e LEFT JOIN turns t ON t.id = COALESCE(e.turn_id, json_extract(e.payload_json, '$.turnId'))
      LEFT JOIN messages m ON m.id = json_extract(e.payload_json, '$.messageId')
      WHERE (COALESCE(e.turn_id, json_extract(e.payload_json, '$.turnId')) IS NOT NULL AND (t.id IS NULL OR t.run_id <> e.run_id))
      OR (json_type(e.payload_json, '$.turnId') IS NOT NULL AND (t.id IS NULL OR json_extract(e.payload_json, '$.turnId') IS NOT t.id))
      OR (json_type(e.payload_json, '$.requestId') IS NOT NULL AND (t.id IS NULL OR json_extract(e.payload_json, '$.requestId') IS NOT t.request_id))
      OR (json_type(e.payload_json, '$.agentId') IS NOT NULL AND (t.id IS NULL OR json_extract(e.payload_json, '$.agentId') IS NOT t.agent_id))
      OR (json_type(e.payload_json, '$.messageId') IS NOT NULL AND (m.id IS NULL OR m.run_id IS NOT e.run_id OR m.turn_id IS NOT t.id)) LIMIT 1`, 'Invalid event identity');

    const hash = createHash('sha256');
    const schema = db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type, name').raw().all();
    hash.update(JSON.stringify(schema));
    for (const table of tables) {
      hash.update(JSON.stringify(table));
      const identifier = '"' + table.replaceAll('"', '""') + '"';
      for (const row of db.prepare(`SELECT * FROM ${identifier} ORDER BY rowid`).safeIntegers().raw().iterate()) {
        hash.update(JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? { integer: value.toString() } : value) + '\n');
      }
    }
    return {
      schemaVersion: versions.at(-1) ?? 0,
      counts: { runs: count(db, 'workflow_runs'), turns: count(db, 'turns'), messages: count(db, 'messages'), events: count(db, 'run_events') },
      evidenceSha256: hash.digest('hex'),
    };
  })();
}

function assertNoRows(db: Sqlite.Database, sql: string, message: string): void {
  if (db.prepare(sql).get()) throw new Error(message);
}

function count(db: Sqlite.Database, table: string): number {
  return db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
}
