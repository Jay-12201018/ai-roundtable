import DatabaseDriver from 'better-sqlite3';
import { copyFileSync, existsSync } from 'node:fs';

export type RoomRecord = {
  id: string;
  name: string;
  objective: string;
};

export type RunRecord = {
  id: string;
  roomId: string;
  status: string;
  workflowSnapshot: Record<string, unknown>;
};

export type MessageRecord = {
  id: string;
  roomId: string;
  runId: string;
  senderType: string;
  senderName: string;
  content: string;
  status?: string;
  turnId?: string;
};

export type TurnRecord = {
  id: string;
  runId: string;
  agentId: string;
  status: string;
  requestId: string;
  turnIndex: number;
  partialContent: string;
};

export type RunEventRecord = {
  runId: string;
  turnId?: string;
  type: string;
  payload: unknown;
  timestamp?: string;
};

type RawRoom = RoomRecord & { created_at: string; updated_at: string };
type RawRun = { id: string; room_id: string; status: string; workflow_snapshot: string; created_at: string; updated_at: string };
type RawMessage = { id: string; room_id: string; run_id: string; turn_id: string | null; sender_type: string; sender_name: string; content: string; status: string; created_at: string; updated_at: string };
type RawEvent = { run_id: string; turn_id: string | null; sequence: number; type: string; payload_json: string; timestamp: string };

const migrations = [
  `
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      objective TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      base_url TEXT,
      api_key_reference TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      role_template_id TEXT NOT NULL,
      provider_id TEXT,
      model_id TEXT,
      system_prompt TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'automatic',
      workflow_snapshot TEXT NOT NULL,
      current_turn_id TEXT,
      current_agent_id TEXT,
      max_turns INTEGER NOT NULL DEFAULT 12,
      max_duration_ms INTEGER NOT NULL DEFAULT 300000,
      output_token_limit INTEGER NOT NULL DEFAULT 1024,
      started_at TEXT,
      finished_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
      status TEXT NOT NULL,
      request_id TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      partial_content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(run_id, turn_index)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
      turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
      sender_type TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      parent_version_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      turn_id TEXT,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      UNIQUE(run_id, sequence)
    );
    CREATE TABLE IF NOT EXISTS key_records (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      backend TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schema_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agents_room ON agents(room_id, display_order);
    CREATE INDEX IF NOT EXISTS idx_runs_room ON workflow_runs(room_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_turns_run ON turns(run_id, turn_index);
    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_run_sequence ON run_events(run_id, sequence);
  `,
];

export class Database {
  private readonly db: DatabaseDriver.Database;
  private readonly filename: string;
  private initialized = false;

  constructor(filename: string) {
    this.filename = filename;
    this.db = new DatabaseDriver(filename);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
  }

  initialize(): void {
    if (this.initialized) return;
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
    const current = this.db.prepare('SELECT MAX(version) as version FROM schema_migrations').get() as { version?: number };
    const currentVersion = current.version ?? 0;
    if (currentVersion < migrations.length && this.filename !== ':memory:' && existsSync(this.filename)) {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      copyFileSync(this.filename, `${this.filename}.backup-${Date.now()}`);
    }
    try {
      this.db.transaction(() => {
        migrations.forEach((migration, index) => {
          const version = index + 1;
          if (version <= currentVersion) return;
          this.db.exec(migration);
          this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(version, now());
        });
      })();
    } catch (error) {
      this.initialized = false;
      throw new Error(`Database migration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.initialized = true;
  }

  transaction<T>(work: () => T): T {
    this.assertInitialized();
    return this.db.transaction(work)();
  }

  insertRoom(room: RoomRecord): void {
    this.assertInitialized();
    const timestamp = now();
    this.db.prepare('INSERT INTO rooms(id, name, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(room.id, room.name, room.objective, timestamp, timestamp);
  }

  getRoom(id: string): RoomRecord | undefined {
    this.assertInitialized();
    const row = this.db.prepare('SELECT id, name, objective, created_at, updated_at FROM rooms WHERE id = ?').get(id) as RawRoom | undefined;
    return row ? { id: row.id, name: row.name, objective: row.objective } : undefined;
  }

  insertAgent(agent: { id: string; roomId: string; displayName: string; roleTemplateId: string; displayOrder: number }): void {
    this.assertInitialized();
    const timestamp = now();
    this.db.prepare('INSERT INTO agents(id, room_id, display_name, role_template_id, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(agent.id, agent.roomId, agent.displayName, agent.roleTemplateId, agent.displayOrder, timestamp, timestamp);
  }

  listAgents(roomId: string): Array<{ id: string; roomId: string; displayName: string; roleTemplateId: string; displayOrder: number }> {
    this.assertInitialized();
    const rows = this.db.prepare('SELECT id, room_id, display_name, role_template_id, display_order FROM agents WHERE room_id = ? ORDER BY display_order').all(roomId) as Array<{ id: string; room_id: string; display_name: string; role_template_id: string; display_order: number }>;
    return rows.map((row) => ({ id: row.id, roomId: row.room_id, displayName: row.display_name, roleTemplateId: row.role_template_id, displayOrder: row.display_order }));
  }

  insertRun(run: RunRecord & { mode?: string; maxTurns?: number; maxDurationMs?: number; outputTokenLimit?: number }): void {
    this.assertInitialized();
    const timestamp = now();
    this.db.prepare('INSERT INTO workflow_runs(id, room_id, status, mode, workflow_snapshot, max_turns, max_duration_ms, output_token_limit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(run.id, run.roomId, run.status, run.mode ?? 'automatic', JSON.stringify(run.workflowSnapshot), run.maxTurns ?? 12, run.maxDurationMs ?? 300000, run.outputTokenLimit ?? 1024, timestamp, timestamp);
  }

  updateRun(id: string, patch: { status?: string; currentTurnId?: string | null; currentAgentId?: string | null; startedAt?: string | null; finishedAt?: string | null; lastError?: string | null }): void {
    this.assertInitialized();
    const fields: string[] = [];
    const values: unknown[] = [];
    const mapping = { status: 'status', currentTurnId: 'current_turn_id', currentAgentId: 'current_agent_id', startedAt: 'started_at', finishedAt: 'finished_at', lastError: 'last_error' } as const;
    for (const [key, column] of Object.entries(mapping)) {
      const value = patch[key as keyof typeof patch];
      if (value === undefined) continue;
      fields.push(`${column} = ?`);
      values.push(value);
    }
    if (fields.length === 0) return;
    fields.push('updated_at = ?');
    values.push(now(), id);
    this.db.prepare(`UPDATE workflow_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  getRun(id: string): RunRecord | undefined {
    this.assertInitialized();
    const row = this.db.prepare('SELECT id, room_id, status, workflow_snapshot, created_at, updated_at FROM workflow_runs WHERE id = ?').get(id) as RawRun | undefined;
    return row ? { id: row.id, roomId: row.room_id, status: row.status, workflowSnapshot: JSON.parse(row.workflow_snapshot) as Record<string, unknown> } : undefined;
  }

  markInFlightRunsInterrupted(): number {
    this.assertInitialized();
    const timestamp = now();
    const result = this.db.transaction(() => {
      const runResult = this.db.prepare("UPDATE workflow_runs SET status = 'interrupted', updated_at = ?, finished_at = ? WHERE status IN ('running', 'pausing', 'cancelling')").run(timestamp, timestamp);
      this.db.prepare("UPDATE turns SET status = 'interrupted', updated_at = ? WHERE status IN ('running', 'pending', 'queued')").run(timestamp);
      this.db.prepare("UPDATE messages SET status = 'aborted', updated_at = ? WHERE status = 'streaming'").run(timestamp);
      return runResult.changes;
    })();
    return result;
  }

  insertTurn(turn: { id: string; runId: string; agentId: string; status: string; requestId: string; turnIndex: number }): void {
    this.assertInitialized();
    const timestamp = now();
    this.db.prepare('INSERT INTO turns(id, run_id, agent_id, status, request_id, turn_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(turn.id, turn.runId, turn.agentId, turn.status, turn.requestId, turn.turnIndex, timestamp, timestamp);
  }

  updateTurn(id: string, patch: { status?: string; partialContent?: string }): void {
    this.assertInitialized();
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
    if (patch.partialContent !== undefined) { fields.push('partial_content = ?'); values.push(patch.partialContent); }
    if (fields.length === 0) return;
    fields.push('updated_at = ?'); values.push(now(), id);
    this.db.prepare(`UPDATE turns SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  listTurns(runId: string): TurnRecord[] {
    this.assertInitialized();
    const rows = this.db.prepare('SELECT id, run_id, agent_id, status, request_id, turn_index, partial_content FROM turns WHERE run_id = ? ORDER BY turn_index').all(runId) as Array<{ id: string; run_id: string; agent_id: string; status: string; request_id: string; turn_index: number; partial_content: string }>;
    return rows.map((row) => ({ id: row.id, runId: row.run_id, agentId: row.agent_id, status: row.status, requestId: row.request_id, turnIndex: row.turn_index, partialContent: row.partial_content }));
  }

  getTurn(id: string): TurnRecord | undefined {
    this.assertInitialized();
    const row = this.db.prepare('SELECT id, run_id, agent_id, status, request_id, turn_index, partial_content FROM turns WHERE id = ?').get(id) as { id: string; run_id: string; agent_id: string; status: string; request_id: string; turn_index: number; partial_content: string } | undefined;
    return row ? { id: row.id, runId: row.run_id, agentId: row.agent_id, status: row.status, requestId: row.request_id, turnIndex: row.turn_index, partialContent: row.partial_content } : undefined;
  }

  insertMessage(message: MessageRecord): void {
    this.assertInitialized();
    const timestamp = now();
    this.db.prepare('INSERT INTO messages(id, room_id, run_id, turn_id, sender_type, sender_name, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(message.id, message.roomId, message.runId, message.turnId ?? null, message.senderType, message.senderName, message.content, message.status ?? 'completed', timestamp, timestamp);
  }

  updateMessage(id: string, content: string, status = 'streaming'): void {
    this.assertInitialized();
    this.db.prepare('UPDATE messages SET content = ?, status = ?, updated_at = ? WHERE id = ?').run(content, status, now(), id);
  }

  getMessage(id: string): MessageRecord | undefined {
    this.assertInitialized();
    const row = this.db.prepare('SELECT id, room_id, run_id, turn_id, sender_type, sender_name, content, status FROM messages WHERE id = ?').get(id) as RawMessage | undefined;
    return row ? { id: row.id, roomId: row.room_id, runId: row.run_id, turnId: row.turn_id ?? undefined, senderType: row.sender_type, senderName: row.sender_name, content: row.content, status: row.status } : undefined;
  }

  listMessages(roomId: string): MessageRecord[] {
    this.assertInitialized();
    const rows = this.db.prepare('SELECT id, room_id, run_id, turn_id, sender_type, sender_name, content, status, created_at, updated_at FROM messages WHERE room_id = ? ORDER BY created_at, rowid').all(roomId) as RawMessage[];
    return rows.map((row) => ({ id: row.id, roomId: row.room_id, runId: row.run_id, turnId: row.turn_id ?? undefined, senderType: row.sender_type, senderName: row.sender_name, content: row.content, status: row.status }));
  }

  appendRunEvent(event: RunEventRecord): number {
    this.assertInitialized();
    const last = this.db.prepare('SELECT MAX(sequence) as sequence FROM run_events WHERE run_id = ?').get(event.runId) as { sequence?: number };
    const sequence = (last.sequence ?? 0) + 1;
    this.db.prepare('INSERT INTO run_events(run_id, turn_id, sequence, type, payload_json, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run(event.runId, event.turnId ?? null, sequence, event.type, JSON.stringify(event.payload), event.timestamp ?? now());
    return sequence;
  }

  listRunEvents(runId: string, cursor: number): Array<RunEventRecord & { sequence: number }> {
    this.assertInitialized();
    const rows = this.db.prepare('SELECT run_id, turn_id, sequence, type, payload_json, timestamp FROM run_events WHERE run_id = ? AND sequence > ? ORDER BY sequence').all(runId, cursor) as RawEvent[];
    return rows.map((row) => ({ runId: row.run_id, turnId: row.turn_id ?? undefined, sequence: row.sequence, type: row.type, payload: JSON.parse(row.payload_json), timestamp: row.timestamp }));
  }

  storeKeyRecord(record: { id: string; providerId: string; encryptedValue: string; backend: string }): void {
    this.assertInitialized();
    const timestamp = now();
    this.db.prepare('INSERT OR REPLACE INTO key_records(id, provider_id, encrypted_value, backend, created_at, updated_at) VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM key_records WHERE id = ?), ?), ?)').run(record.id, record.providerId, record.encryptedValue, record.backend, record.id, timestamp, timestamp);
  }

  rawKeyRecord(id: string): { id: string; providerId: string; encryptedValue: string; backend: string } | undefined {
    this.assertInitialized();
    const row = this.db.prepare('SELECT id, provider_id, encrypted_value, backend FROM key_records WHERE id = ?').get(id) as { id: string; provider_id: string; encrypted_value: string; backend: string } | undefined;
    return row ? { id: row.id, providerId: row.provider_id, encryptedValue: row.encrypted_value, backend: row.backend } : undefined;
  }

  deleteKeyRecord(id: string): void {
    this.assertInitialized();
    this.db.prepare('DELETE FROM key_records WHERE id = ?').run(id);
  }

  close(): void {
    if (this.db.open) this.db.close();
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('Database has not been initialized');
  }

}

function now(): string {
  return new Date().toISOString();
}
