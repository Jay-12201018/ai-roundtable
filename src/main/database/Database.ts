import DatabaseDriver from 'better-sqlite3';
import { chmodSync } from 'node:fs';
import { mkdir, lstat, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { migration2 } from './migrations/v2';
import { createVerifiedBackup, type VerifiedBackup } from './backup/createVerifiedBackup';
import { prepareRestore } from './recovery/prepareRestore';
import { validateDatabase } from './recovery/validateDatabase';
import { classifyInterruptedRuns } from './recovery/classifyInterruptedRuns';
import { executionMetadataSchema, storedRunSchema, createAttemptInputSchema, requestAttemptSchema, messagePageInputSchema, eventPageInputSchema } from '../../shared/schemas/persistence';
import type { ExecutionMetadata,StoredRun, RequestAttempt, CreateAttemptInput, MessageCursor } from '../../shared/schemas/persistence';
import { idSchema, sequenceSchema } from '../../shared/schemas/common';
import { runEventSchema } from '../../shared/schemas/run';
import { turnStatusValues } from '../../shared/types/run';

export type RoomRecord = {
  id: string;
  name: string;
  objective: string;
};

export type RunRecord = StoredRun;

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
  protocolVersion?: number;
  requestId?: string;
};
export type PersistedRunEvent = RunEventRecord & { sequence: number; timestamp: string; protocolVersion: number };

type RawRoom = RoomRecord & { created_at: string; updated_at: string };
type RawRun = { id: string; room_id: string; status: string; workflow_snapshot: string; created_at: string; updated_at: string };
type RawMessage = { id: string; room_id: string; run_id: string; turn_id: string | null; sender_type: string; sender_name: string; content: string; status: string; created_at: string; updated_at: string };
type RawEvent = { run_id: string; turn_id: string | null; sequence: number; type: string; payload_json: string; timestamp: string; protocol_version: number; request_id: string | null };

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
  migration2,
];

export class Database {
  private readonly db: DatabaseDriver.Database;
  private readonly filename: string;
  private initialized = false;
  private initialization?: Promise<void>;
  private readonly commitCallbacks: Array<() => void> = [];

  constructor(filename: string) {
    this.filename = filename;
    this.db = new DatabaseDriver(filename);
    this.db.pragma('foreign_keys = ON');
  }

  initialize(): void | Promise<void> {
    if (this.initialized) return;
    if (this.initialization) return this.initialization;
    const tables = this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").pluck().all() as string[];
    const versions = tables.includes('schema_migrations') ? this.db.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all() as number[] : [];
    if (versions.some((v, i) => v !== i + 1) || (versions.at(-1) ?? 0) > migrations.length) throw new Error('Database migration failed: unsupported migration ledger');
    const version = versions.at(-1) ?? 0;
    const empty = versions.length===0 && tables.every(table => table === 'schema_migrations');
    if (!empty) {
      // Refuse incomplete/conflicting databases before changing the ledger or journal.
      validateDatabase(this.db);
      if (this.filename !== ':memory:' && version < migrations.length) {
        this.initialization = this.backupAndMigrate(version);
        return this.initialization;
      }
    }
    this.migrate(version);
  }

  private migrate(version: number, backup?: VerifiedBackup): void {
    try {
      this.db.transaction(() => {
        this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
        migrations.forEach((migration, index) => {
          const next = index + 1;
          if (next <= version) return;
          this.db.exec(migration);
          this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(next, now());
        });
        validateDatabase(this.db);
        if (backup) this.db.prepare('INSERT INTO schema_backups(version,path,created_at,sha256,byte_count,total_pages,evidence_sha256,validation_json,verified_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(backup.validation.schemaVersion, backup.path, now(), backup.sha256, backup.bytes, backup.totalPages, backup.validation.evidenceSha256, JSON.stringify(backup.validation), now());
      })();
    } catch (error) {
      this.initialized = false;
      throw new Error(`Database migration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.initialized = true;
    this.db.pragma('journal_mode = WAL');
    if (this.filename !== ':memory:') chmodSync(this.filename, 0o600);
  }

  private async backupDirectory(): Promise<string> {
    const directory = join(dirname(resolve(this.filename)), 'backups');
    await mkdir(directory, { mode: 0o700, recursive: true });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || await realpath(directory) !== directory) throw new Error('Unsafe backup directory');
    return directory;
  }

  private async backupAndMigrate(version: number): Promise<void> {
    const directory = await this.backupDirectory();
    const backup = await createVerifiedBackup(this.db, directory);
    const candidate = await prepareRestore(backup, directory);
    try { this.migrate(version, backup); }
    finally { await rm(candidate.directory, { recursive: true, force: true }); }
  }

  async prepareRegisteredRestore(id: number): Promise<VerifiedBackup & { directory: string }> {
    this.assertInitialized();
    sequenceSchema.refine(n => n > 0).parse(id);
    const row = this.db.prepare('SELECT path,sha256,byte_count,total_pages,evidence_sha256,validation_json,verified_at FROM schema_backups WHERE id=?').get(id) as { path: string; sha256: string | null; byte_count: number; total_pages: number; evidence_sha256: string; validation_json: string | null; verified_at: string | null } | undefined;
    if (!row?.verified_at || !row.sha256 || !row.validation_json) throw new Error('Backup has not been verified');
    const directory = await this.backupDirectory();
    if (dirname(row.path) !== directory || !/^backup-[0-9a-f-]+\.sqlite3$/u.test(row.path.slice(directory.length + 1))) throw new Error('Untrusted backup path');
    const validation = JSON.parse(row.validation_json) as VerifiedBackup['validation'];
    if (validation.evidenceSha256 !== row.evidence_sha256) throw new Error('Backup evidence mismatch');
    return prepareRestore({ path: row.path, sha256: row.sha256, bytes: row.byte_count, totalPages: row.total_pages, validation }, directory);
  }

  transaction<T>(work: () => T): T {
    this.assertInitialized();
    const outer = !this.db.inTransaction;
    const marker = this.commitCallbacks.length;
    let result: T;
    try { result = this.db.transaction(work)(); }
    catch (error) { this.commitCallbacks.splice(marker); throw error; }
    if (outer) for (const callback of this.commitCallbacks.splice(0)) callback();
    return result;
  }

  afterCommit(work: () => void): void {
    if (this.db.inTransaction) this.commitCallbacks.push(work);
    else work();
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

  listAgents(roomId: string): Array<{ id: string; roomId: string; displayName: string; roleTemplateId: string; displayOrder: number; systemPrompt: string; providerId: string | null; modelId: string | null }> {
    this.assertInitialized();
    const rows = this.db.prepare('SELECT id, room_id, display_name, role_template_id, display_order,system_prompt,provider_id,model_id FROM agents WHERE room_id = ? ORDER BY display_order,rowid').all(roomId) as Array<{ id: string; room_id: string; display_name: string; role_template_id: string; display_order: number; system_prompt: string; provider_id: string | null; model_id: string | null }>;
    return rows.map((row) => ({ id: row.id, roomId: row.room_id, displayName: row.display_name, roleTemplateId: row.role_template_id, displayOrder: row.display_order, systemPrompt: row.system_prompt, providerId: row.provider_id, modelId: row.model_id }));
  }

  insertRun(run: Omit<Pick<RunRecord,'id'|'roomId'|'status'|'workflowSnapshot'>,'status'> & {status:string} & Partial<ExecutionMetadata>): void {
    this.assertInitialized();
    const timestamp = now();
    const value=storedRunSchema.parse({id:run.id,roomId:run.roomId,status:run.status,workflowSnapshot:run.workflowSnapshot,lastError:null,
      task:run.task??null,membersSnapshot:run.membersSnapshot??null,nextTurnIndex:run.nextTurnIndex??null,elapsedExecutionMs:run.elapsedExecutionMs??null,
      mode:run.mode??'automatic',maxTurns:run.maxTurns??12,maxDurationMs:run.maxDurationMs??300000,outputTokenLimit:run.outputTokenLimit??1024,
      currentTurnId:null,currentAgentId:null,startedAt:null,finishedAt:null,createdAt:timestamp,updatedAt:timestamp});
    this.db.prepare('INSERT INTO workflow_runs(id,room_id,status,mode,workflow_snapshot,max_turns,max_duration_ms,output_token_limit,created_at,updated_at,task,members_snapshot,next_turn_index,elapsed_execution_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(value.id,value.roomId,value.status,value.mode,JSON.stringify(value.workflowSnapshot),value.maxTurns,value.maxDurationMs,value.outputTokenLimit,timestamp,timestamp,value.task,value.membersSnapshot===null?null:JSON.stringify(value.membersSnapshot),value.nextTurnIndex,value.elapsedExecutionMs);
  }

  updateRun(id: string, patch: { status?: string;mode?:'automatic'|'step'; currentTurnId?: string | null; currentAgentId?: string | null; startedAt?: string | null; finishedAt?: string | null; lastError?: string | null }): void {
    this.assertInitialized();
    const fields: string[] = [];
    const values: unknown[] = [];
    if(patch.mode!==undefined) z.enum(['automatic','step']).parse(patch.mode);
    const mapping = { status: 'status',mode:'mode', currentTurnId: 'current_turn_id', currentAgentId: 'current_agent_id', startedAt: 'started_at', finishedAt: 'finished_at', lastError: 'last_error' } as const;
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
    const row = this.db.prepare(`SELECT id,room_id AS roomId,status,workflow_snapshot AS workflowSnapshot,task,members_snapshot AS membersSnapshot,next_turn_index AS nextTurnIndex,
      elapsed_execution_ms AS elapsedExecutionMs,mode,max_turns AS maxTurns,max_duration_ms AS maxDurationMs,output_token_limit AS outputTokenLimit,
      current_turn_id AS currentTurnId,current_agent_id AS currentAgentId,started_at AS startedAt,finished_at AS finishedAt,created_at AS createdAt,updated_at AS updatedAt,last_error AS lastError FROM workflow_runs WHERE id=?`).get(id) as (Omit<RunRecord, 'workflowSnapshot' | 'membersSnapshot'> & { workflowSnapshot: string; membersSnapshot: string | null }) | undefined;
    if (!row) return;
    return storedRunSchema.parse({...row,workflowSnapshot:JSON.parse(row.workflowSnapshot),membersSnapshot:row.membersSnapshot===null?null:JSON.parse(row.membersSnapshot)});
  }

  updateRunProgress(id: string, patch: { elapsedExecutionMs?: number; nextTurnIndex?: number }): void {
    const parsed = z.object({ elapsedExecutionMs: sequenceSchema.optional(), nextTurnIndex: sequenceSchema.optional() }).strict().parse(patch);
    this.transaction(() => {
      const run = this.getRun(id);
      if (!run) throw new Error('Run not found');
      for (const key of ['elapsedExecutionMs', 'nextTurnIndex'] as const) {
        const value = parsed[key];
        if (value === undefined) continue;
        if (run[key] === null || value < run[key]) throw new Error('Progress must preserve unknown history and remain monotonic');
        this.db.prepare(`UPDATE workflow_runs SET ${key === 'elapsedExecutionMs' ? 'elapsed_execution_ms' : 'next_turn_index'}=?,updated_at=? WHERE id=?`).run(value, now(), id);
      }
    });
  }

  markInFlightRunsInterrupted(): number {
    this.assertInitialized();
    const timestamp = now();
    const result = this.db.transaction(() => {
      const runs = this.db.prepare('SELECT id,status FROM workflow_runs').all() as Array<{ id: string; status: string }>;
      const ids = classifyInterruptedRuns(runs);
      for (const id of ids) {
        this.db.prepare("UPDATE workflow_runs SET status='interrupted',current_turn_id=NULL,current_agent_id=NULL,updated_at=?,finished_at=? WHERE id=?").run(timestamp, timestamp, id);
        this.db.prepare("UPDATE turns SET status='interrupted',updated_at=? WHERE run_id=? AND status IN ('running','pending','queued')").run(timestamp, id);
        this.db.prepare("UPDATE request_attempts SET status='interrupted',updated_at=?,finished_at=? WHERE run_id=? AND status IN ('running','pending','queued')").run(timestamp, timestamp, id);
        this.db.prepare("UPDATE messages SET status='aborted',updated_at=? WHERE run_id=? AND status='streaming'").run(timestamp, id);
        this.appendRunEvent({ runId: id, protocolVersion: 1, type: 'run_state_changed', payload: { status: 'interrupted' }, timestamp });
      }
      return ids.length;
    })();
    return result;
  }

  insertTurn(turn: { id: string; runId: string; agentId: string; status: string; requestId: string; turnIndex: number }): void {
    this.assertInitialized();
    const timestamp = now();
    this.db.transaction(() => {
      const run = this.getRun(turn.runId);
      const agent = this.db.prepare('SELECT room_id FROM agents WHERE id=?').get(turn.agentId) as { room_id: string } | undefined;
      if (!run || agent?.room_id !== run.roomId || run.nextTurnIndex !== null && run.nextTurnIndex !== turn.turnIndex) throw new Error('Invalid Turn allocation');
      this.db.prepare('INSERT INTO turns(id, run_id, agent_id, status, request_id, turn_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(turn.id, turn.runId, turn.agentId, turn.status, turn.requestId, turn.turnIndex, timestamp, timestamp);
      if (run.nextTurnIndex !== null) this.db.prepare('UPDATE workflow_runs SET next_turn_index=next_turn_index+1,updated_at=? WHERE id=?').run(timestamp, turn.runId);
    }).immediate();
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
    this.db.transaction(() => {
      const run = this.getRun(message.runId);
      if (!run || run.roomId !== message.roomId || message.turnId && this.getTurn(message.turnId)?.runId !== message.runId) throw new Error('Invalid Message identity');
      const key = this.db.prepare("UPDATE persistence_counters SET value=value+1 WHERE name='message' RETURNING value").pluck().get() as number;
      this.db.prepare('INSERT INTO messages(id,room_id,run_id,turn_id,sender_type,sender_name,content,status,created_at,updated_at,sort_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(message.id,message.roomId,message.runId,message.turnId??null,message.senderType,message.senderName,message.content,message.status??'completed',timestamp,timestamp,key);
    }).immediate();
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

  createAttempt(input: CreateAttemptInput): RequestAttempt {
    const attempt = createAttemptInputSchema.parse(input);
    return this.transaction(() => {
      const turn = this.getTurn(attempt.turnId);
      const message = this.getMessage(attempt.messageId);
      const previous = this.db.prepare('SELECT MAX(attempt_index) AS last FROM request_attempts WHERE turn_id=?').get(attempt.turnId) as { last: number | null };
      if (!['queued','pending','running'].includes(attempt.status) || !turn || turn.runId!==attempt.runId || message?.runId!==attempt.runId || message.turnId!==attempt.turnId || attempt.attemptIndex!==(previous.last??-1)+1 || attempt.attemptIndex===0 && turn.requestId!==attempt.requestId) throw new Error('Invalid Attempt identity or order');
      const timestamp = now();
      this.db.prepare('INSERT INTO request_attempts(request_id,run_id,turn_id,message_id,attempt_index,status,input_snapshot,created_at,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(attempt.requestId,attempt.runId,attempt.turnId,attempt.messageId,attempt.attemptIndex,attempt.status,JSON.stringify(attempt.inputSnapshot),timestamp,attempt.status==='running'?timestamp:null,timestamp);
      return this.getAttempt(attempt.requestId)!;
    });
  }

  getAttempt(requestId: string): RequestAttempt | undefined {
    this.assertInitialized(); idSchema.parse(requestId);
    const row = this.db.prepare(`SELECT request_id AS requestId,run_id AS runId,turn_id AS turnId,message_id AS messageId,attempt_index AS attemptIndex,status,input_snapshot AS inputSnapshot,
      provider_request_id AS providerRequestId,created_at AS createdAt,started_at AS startedAt,finished_at AS finishedAt,updated_at AS updatedAt FROM request_attempts WHERE request_id=?`).get(requestId) as (Omit<RequestAttempt,'inputSnapshot'> & {inputSnapshot:string|null}) | undefined;
    return row ? requestAttemptSchema.parse({...row,inputSnapshot:row.inputSnapshot===null?null:JSON.parse(row.inputSnapshot)}) : undefined;
  }

  listAttempts(runId: string): RequestAttempt[] {
    this.requireRun(runId);
    const ids = this.db.prepare('SELECT request_id FROM request_attempts WHERE run_id=? ORDER BY turn_id,attempt_index').pluck().all(runId) as string[];
    return ids.map(id=>this.getAttempt(id)!);
  }

  getLatestAttemptRequestId(turnId: string): string | undefined {
    this.assertInitialized();idSchema.parse(turnId);
    return this.db.prepare('SELECT request_id FROM request_attempts WHERE turn_id=? ORDER BY attempt_index DESC LIMIT 1').pluck().get(turnId) as string | undefined;
  }

  updateAttempt(requestId: string, patch: {status?: RequestAttempt['status'];providerRequestId?:string}): void {
    const parsed = z.object({status:z.enum(turnStatusValues).optional(),providerRequestId:idSchema.optional()}).strict().parse(patch);
    this.transaction(() => {
      const attempt = this.getAttempt(requestId);
      if (!attempt) throw new Error('Attempt not found');
      const allowed: Partial<Record<RequestAttempt['status'],readonly RequestAttempt['status'][]>> = {
        queued:['pending','running','cancelled','interrupted'],pending:['running','failed','aborted','cancelled','interrupted'],running:['completed','failed','aborted','cancelled','interrupted'],
      };
      const status = parsed.status??attempt.status;
      if (status!==attempt.status && !allowed[attempt.status]?.includes(status)) throw new Error('Invalid Attempt transition');
      if (attempt.providerRequestId!==null && parsed.providerRequestId!==undefined && parsed.providerRequestId!==attempt.providerRequestId) throw new Error('Provider request identity is immutable');
      const timestamp = now();
      this.db.prepare('UPDATE request_attempts SET status=?,provider_request_id=?,started_at=?,finished_at=?,updated_at=? WHERE request_id=?')
        .run(status,parsed.providerRequestId??attempt.providerRequestId,attempt.startedAt??(status==='running'?timestamp:null),attempt.finishedAt??(!['queued','pending','running'].includes(status)?timestamp:null),timestamp,requestId);
    });
  }

  listRunMessages(runId: string,options: {after?:MessageCursor;limit:number}) {
    return this.transaction(()=>{
    this.requireRun(runId);
    const {after,limit} = messagePageInputSchema.parse(options);
    if (after && (after.runId!==runId || after.sequence>0 && !this.db.prepare('SELECT 1 FROM messages WHERE run_id=? AND sort_key=?').get(runId,after.sequence))) throw new Error('Invalid Message cursor');
    const rows = this.db.prepare('SELECT id,sort_key FROM messages WHERE run_id=? AND sort_key>? ORDER BY sort_key LIMIT ?').all(runId,after?.sequence??0,limit+1) as Array<{id:string;sort_key:number}>;
    const selected = rows.slice(0,limit);
    return {messages:selected.map(row=>this.getMessage(row.id)!),nextCursor:{runId,sequence:selected.at(-1)?.sort_key??after?.sequence??0},hasMore:rows.length>limit};
    });
  }

  readRunSnapshot(runId: string) {
    return this.transaction(() => {
      const run = this.getRun(runId);
      if (!run) throw new Error('Run not found');
      const ids = this.db.prepare('SELECT id FROM messages WHERE run_id=? ORDER BY sort_key').pluck().all(runId) as string[];
      return {run,turns:this.listTurns(runId),messages:ids.map(id=>this.getMessage(id)!),attempts:this.listAttempts(runId),sequence:this.getRunEventSequence(runId)};
    });
  }

  readRunSubscription(runId: string,cursor:number) {
    sequenceSchema.parse(cursor);
    return this.transaction(() => {
      const snapshot = this.readRunSnapshot(runId);
      if (cursor>snapshot.sequence) return {...snapshot,events:[] as PersistedRunEvent[],resyncRequired:true};
      try {
        const page = this.listRunEvents(runId,{cursor,throughSequence:snapshot.sequence,limit:500});
        const complete = !page.hasMore && page.nextCursor===snapshot.sequence && page.events.every((e,i)=>e.sequence===cursor+i+1);
        return {...snapshot,events:complete?page.events:[],resyncRequired:!complete};
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return {...snapshot,events:[] as PersistedRunEvent[],resyncRequired:true};
      }
    });
  }

  getRunEventSequence(runId: string): number {
    this.requireRun(runId);
    return sequenceSchema.parse(this.db.prepare('SELECT COALESCE(MAX(sequence),0) FROM run_events WHERE run_id=?').pluck().get(runId));
  }

  private requireRun(runId: string): void {
    this.assertInitialized();idSchema.parse(runId);
    if (!this.db.prepare('SELECT 1 FROM workflow_runs WHERE id=?').get(runId)) throw new Error('Run not found');
  }

  appendRunEvent(event: RunEventRecord): PersistedRunEvent {
    this.assertInitialized();
    return this.db.transaction(() => {
      const sequence = sequenceSchema.parse(this.getRunEventSequence(event.runId)+1);
      const timestamp = event.timestamp??now();
      const protocolVersion = sequenceSchema.parse(event.protocolVersion??0);
      const payloadJson = JSON.stringify(event.payload);
      if (protocolVersion===1) {
        const parsed = runEventSchema.parse({version:1,runId:event.runId,turnId:event.turnId,requestId:event.requestId,sequence,type:event.type,payload:event.payload,timestamp});
        if (parsed.turnId) {
          const attempt = this.getAttempt(parsed.requestId!);
          const turn = this.getTurn(parsed.turnId);
          if (!attempt || attempt.runId!==event.runId || attempt.turnId!==parsed.turnId || !turn || 'messageId' in parsed.payload && parsed.payload.messageId!==attempt.messageId || 'agentId' in parsed.payload && parsed.payload.agentId!==turn.agentId) throw new Error('Invalid event Attempt identity');
          if ('senderName' in parsed.payload && parsed.payload.senderName!==this.getMessage(attempt.messageId)?.senderName) throw new Error('Invalid event sender identity');
        }
      }
      this.db.prepare('INSERT INTO run_events(run_id,turn_id,sequence,type,payload_json,timestamp,protocol_version,request_id) VALUES(?,?,?,?,?,?,?,?)').run(event.runId,event.turnId??null,sequence,event.type,payloadJson,timestamp,protocolVersion,event.requestId??null);
      return {runId:event.runId,turnId:event.turnId,sequence,type:event.type,payload:JSON.parse(payloadJson),timestamp,protocolVersion,requestId:event.requestId};
    }).immediate();
  }

  listRunEvents(runId: string,cursor:number): PersistedRunEvent[];
  listRunEvents(runId: string,options:{cursor:number;throughSequence:number;limit:number}): {events:PersistedRunEvent[];nextCursor:number;throughSequence:number;hasMore:boolean};
  listRunEvents(runId: string,input:number|{cursor:number;throughSequence:number;limit:number}): PersistedRunEvent[] | {events:PersistedRunEvent[];nextCursor:number;throughSequence:number;hasMore:boolean} {
    this.assertInitialized();
    this.requireRun(runId);
    const paged = typeof input!=='number';
    const {cursor,throughSequence,limit} = paged?eventPageInputSchema.parse(input):{cursor:sequenceSchema.parse(input),throughSequence:this.getRunEventSequence(runId),limit:-1};
    if (paged && (throughSequence>this.getRunEventSequence(runId) || cursor>throughSequence)) throw new Error('Invalid event upper bound');
    const rows = this.db.prepare('SELECT run_id,turn_id,sequence,type,payload_json,timestamp,protocol_version,request_id FROM run_events WHERE run_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?').all(runId,cursor,throughSequence,paged?limit+1:-1) as RawEvent[];
    const selected = paged?rows.slice(0,limit):rows;
    const events = selected.map(row=>({runId:row.run_id,turnId:row.turn_id??undefined,sequence:row.sequence,type:row.type,payload:JSON.parse(row.payload_json),timestamp:row.timestamp,protocolVersion:row.protocol_version,requestId:row.request_id??undefined}));
    return paged?{events,nextCursor:events.at(-1)?.sequence??cursor,throughSequence,hasMore:rows.length>limit}:events;
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
