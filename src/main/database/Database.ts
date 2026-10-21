import { randomUUID } from 'node:crypto';
import DatabaseDriver from 'better-sqlite3';
import { chmodSync } from 'node:fs';
import { mkdir, lstat, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { migration3 } from './migrations/v3';
import { migration4 } from './migrations/v4';
import { migration5 } from './migrations/v5';
import { reconciliationInputSchema, reconciliationAuditSchema, reconciliationEvidenceSummary, type ReconciliationInput, type TrialReconciliation } from '../providers/controlledTrial/reconciliation';
import { trialRecordSchema, type TrialRecord } from '../providers/controlledTrial/record';
import { ContractError } from '../../shared/contracts/errors';
import { roomInputSchema,roomConfigurationSchema,agentInputSchema,agentConfigurationSchema,providerInputSchema,providerConfigurationSchema,providerSummarySchema,listRoomsInputSchema,reorderAgentsInputSchema,roomMessagePageInputSchema,roomMessagePageSchema,roomRunPageInputSchema,roomRunPageSchema, compareRunPositions } from '../../shared/schemas/configuration';
import type { RoomInput,RoomConfiguration,AgentInput,AgentConfiguration,ProviderInput,ProviderConfiguration,ProviderSummary,RoomMessagePageInput,RoomMessagePage,RoomRunPageInput,RoomRunPage } from '../../shared/contracts/configuration';
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
  migration3,
  migration4,
  migration5,
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
    // Canonicalize the database's parent first so legitimate ancestor symlinks
    // (macOS /var -> /private/var, relocated home folders) are accepted, while a
    // symlinked or redirected `backups` directory itself is still rejected below.
    const directory = join(await realpath(dirname(resolve(this.filename))), 'backups');
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

  listAgents(roomId: string, validateRealSelection?: (providerId: string, modelId: string) => void): Array<{ id: string; roomId: string; displayName: string; roleTemplateId: string; displayOrder: number; systemPrompt: string; providerId: string | null; modelId: string | null }> {
    this.assertInitialized();
    if (this.getRoomConfiguration(roomId)?.archivedAt) throw new ContractError('invalid_state');
    const rows = this.db.prepare('SELECT id, room_id, display_name, role_template_id, display_order,system_prompt,provider_id,model_id,configuration_version FROM agents WHERE room_id = ? AND enabled=1 AND archived_at IS NULL ORDER BY display_order,id').all(roomId) as Array<{ id: string; room_id: string; display_name: string; role_template_id: string; display_order: number; system_prompt: string; provider_id: string | null; model_id: string | null; configuration_version: number }>;
    for (const row of rows) {
      // Only untouched pre-configuration Demo rows retain the legacy null-to-Mock path.
      if (row.configuration_version === 0 && row.provider_id === null && row.model_id === null) continue;
      if (row.provider_id === null || row.model_id === null) throw new ContractError('invalid_state');
      if (this.validateModelSelection(row.provider_id,row.model_id).kind !== 'mock') {
        if (!validateRealSelection) throw new ContractError('unsupported');
        validateRealSelection(row.provider_id, row.model_id);
      }
    }
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

  createRoom(input: RoomInput): RoomConfiguration {
    const room = configurationInput(roomInputSchema, input);
    return this.transaction(() => { this.insertRoom(room); return this.getRoomConfiguration(room.id)!; });
  }

  updateRoom(input: RoomInput): RoomConfiguration {
    const room = configurationInput(roomInputSchema, input);
    return this.transaction(() => {
      if (!this.getRoom(room.id)) throw new ContractError('not_found');
      this.db.prepare('UPDATE rooms SET name=?,objective=?,updated_at=? WHERE id=?').run(room.name, room.objective, now(), room.id);
      return this.getRoomConfiguration(room.id)!;
    });
  }

  getRoomConfiguration(id: string): RoomConfiguration | undefined {
    this.assertInitialized(); configurationInput(idSchema, id);
    const row = this.db.prepare('SELECT id,name,objective,archived_at AS archivedAt,created_at AS createdAt,updated_at AS updatedAt FROM rooms WHERE id=?').get(id);
    return row ? configurationOutput(roomConfigurationSchema, row) : undefined;
  }

  listRooms(input: { includeArchived?: boolean } = {}): RoomConfiguration[] {
    this.assertInitialized();
    const { includeArchived } = configurationInput(listRoomsInputSchema, input);
    const ids = this.db.prepare(`SELECT id FROM rooms ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY created_at,id`).pluck().all() as string[];
    return ids.map(id => this.getRoomConfiguration(id)!);
  }

  archiveRoom(id: string, archived = true): RoomConfiguration {
    configurationInput(idSchema, id); configurationInput(z.boolean(), archived);
    return this.transaction(() => {
      if (!this.getRoom(id)) throw new ContractError('not_found');
      if (archived && this.db.prepare("SELECT 1 FROM workflow_runs WHERE room_id=? AND status IN ('running','pausing','paused','cancelling') LIMIT 1").get(id)) throw new ContractError('invalid_state');
      this.db.prepare('UPDATE rooms SET archived_at=?,updated_at=? WHERE id=?').run(archived ? now() : null, now(), id);
      return this.getRoomConfiguration(id)!;
    });
  }

  deleteRoom(id: string): void {
    configurationInput(idSchema, id);
    this.transaction(() => {
      if (!this.getRoom(id)) throw new ContractError('not_found');
      if (this.db.prepare('SELECT 1 FROM workflow_runs WHERE room_id=? LIMIT 1').get(id) || this.db.prepare('SELECT 1 FROM messages WHERE room_id=? LIMIT 1').get(id)) throw new ContractError('invalid_state');
      for (const agent of this.listAgentConfigurations(id, true)) this.assertAgentUnreferenced(agent.id);
      this.db.prepare('DELETE FROM rooms WHERE id=?').run(id);
    });
  }

  createAgent(input: AgentInput): AgentConfiguration {
    const agent = configurationInput(agentInputSchema, input);
    return this.transaction(() => {
      this.assertAgentConfiguration(agent);
      if (this.db.prepare('SELECT 1 FROM agents WHERE id=?').get(agent.id)) throw new ContractError('invalid_state');
      const timestamp = now();
      this.db.prepare('INSERT INTO agents(id,room_id,display_name,role_template_id,provider_id,model_id,system_prompt,enabled,display_order,created_at,updated_at,configuration_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)')
        .run(agent.id, agent.roomId, agent.displayName, agent.roleTemplateId, agent.providerId, agent.modelId, agent.systemPrompt, Number(agent.enabled), agent.displayOrder, timestamp, timestamp);
      return this.getAgentConfiguration(agent.id)!;
    });
  }

  updateAgent(input: AgentInput): AgentConfiguration {
    const agent = configurationInput(agentInputSchema, input);
    return this.transaction(() => {
      const previous = this.getAgentConfiguration(agent.id);
      if (!previous) throw new ContractError('not_found');
      if (previous.roomId !== agent.roomId) throw new ContractError('invalid_input');
      this.assertAgentConfiguration(agent);
      this.db.prepare('UPDATE agents SET display_name=?,role_template_id=?,provider_id=?,model_id=?,system_prompt=?,enabled=?,display_order=?,updated_at=?,configuration_version=1 WHERE id=?')
        .run(agent.displayName, agent.roleTemplateId, agent.providerId, agent.modelId, agent.systemPrompt, Number(agent.enabled), agent.displayOrder, now(), agent.id);
      return this.getAgentConfiguration(agent.id)!;
    });
  }

  private assertAgentConfiguration(agent: z.output<typeof agentInputSchema>): void {
    const room = this.getRoomConfiguration(agent.roomId);
    if (!room) throw new ContractError('not_found');
    if (room.archivedAt) throw new ContractError('invalid_state');
    if (agent.providerId !== null) {
      const provider = this.getProviderConfiguration(agent.providerId);
      if (!provider) throw new ContractError('not_found');
      if (provider.kind === 'mock' && agent.modelId !== 'mock') throw new ContractError('invalid_input');
    }
  }

  getAgentConfiguration(id: string): AgentConfiguration | undefined {
    this.assertInitialized(); configurationInput(idSchema, id);
    const row = this.db.prepare('SELECT id,room_id AS roomId,display_name AS displayName,role_template_id AS roleTemplateId,provider_id AS providerId,model_id AS modelId,system_prompt AS systemPrompt,enabled,display_order AS displayOrder,archived_at AS archivedAt,created_at AS createdAt,updated_at AS updatedAt FROM agents WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? configurationOutput(agentConfigurationSchema, { ...row, enabled: row.enabled === 1 }) : undefined;
  }

  listAgentConfigurations(roomId: string, includeArchived = false): AgentConfiguration[] {
    this.assertInitialized(); configurationInput(idSchema, roomId); configurationInput(z.boolean(), includeArchived);
    if (!this.getRoom(roomId)) throw new ContractError('not_found');
    const ids = this.db.prepare(`SELECT id FROM agents WHERE room_id=? ${includeArchived ? '' : 'AND archived_at IS NULL'} ORDER BY display_order,id`).pluck().all(roomId) as string[];
    return ids.map(id => this.getAgentConfiguration(id)!);
  }

  reorderAgents(roomId: string, agentIds: string[]): AgentConfiguration[] {
    configurationInput(reorderAgentsInputSchema, { roomId, agentIds });
    return this.transaction(() => {
      const agents = this.listAgentConfigurations(roomId);
      if (new Set(agentIds).size !== agentIds.length || agents.length !== agentIds.length || agents.some(a => !agentIds.includes(a.id))) throw new ContractError('invalid_input');
      const update = this.db.prepare('UPDATE agents SET display_order=?,updated_at=? WHERE id=? AND room_id=?');
      agentIds.forEach((id, order) => update.run(order, now(), id, roomId));
      return this.listAgentConfigurations(roomId);
    });
  }

  archiveAgent(id: string, archived = true): AgentConfiguration {
    configurationInput(idSchema, id); configurationInput(z.boolean(), archived);
    return this.transaction(() => {
      if (!this.getAgentConfiguration(id)) throw new ContractError('not_found');
      this.db.prepare('UPDATE agents SET archived_at=?,updated_at=? WHERE id=?').run(archived ? now() : null, now(), id);
      return this.getAgentConfiguration(id)!;
    });
  }

  private assertAgentUnreferenced(id: string): void {
    if (this.db.prepare('SELECT 1 FROM turns WHERE agent_id=? LIMIT 1').get(id)
      || this.db.prepare("SELECT 1 FROM workflow_runs r WHERE r.current_agent_id=? OR EXISTS(SELECT 1 FROM json_each(r.members_snapshot) m WHERE json_extract(m.value,'$.agentId')=?) LIMIT 1").get(id, id)) throw new ContractError('invalid_state');
  }

  deleteAgent(id: string): void {
    configurationInput(idSchema, id);
    this.transaction(() => {
      if (!this.getAgentConfiguration(id)) throw new ContractError('not_found');
      this.assertAgentUnreferenced(id); this.db.prepare('DELETE FROM agents WHERE id=?').run(id);
    });
  }

  createProvider(input: ProviderInput): ProviderConfiguration {
    return this.writeProvider(input, false);
  }

  updateProvider(input: ProviderInput): ProviderConfiguration {
    return this.writeProvider(input, true);
  }

  private writeProvider(input: ProviderInput, update: boolean): ProviderConfiguration {
    const provider = configurationInput(providerInputSchema, input);
    if (provider.kind === 'mock' && (provider.defaultModelId !== null && provider.defaultModelId !== 'mock' || provider.customModels.some(m => m.id !== 'mock'))) throw new ContractError('invalid_input');
    return this.transaction(() => {
      const exists = !!this.db.prepare('SELECT 1 FROM providers WHERE id=?').get(provider.id);
      if (update && !exists) throw new ContractError('not_found');
      if (!update && exists) throw new ContractError('invalid_state');
      if (update) this.assertProviderMutable(provider.id);
      if (provider.isDefault) this.db.prepare('UPDATE providers SET is_default=0 WHERE is_default=1').run();
      const timestamp = now();
      const previous = update ? this.db.prepare('SELECT type,base_url FROM providers WHERE id=?').get(provider.id) as {type:string;base_url:string|null} : undefined;
      const targetChanged = !!previous && (previous.type !== provider.kind || previous.base_url !== provider.baseUrl);
      if (update) this.db.prepare('UPDATE providers SET name=?,type=?,base_url=?,enabled=?,is_default=?,default_model_id=?,custom_models_json=?,updated_at=? WHERE id=?')
        .run(provider.name, provider.kind, provider.baseUrl, Number(provider.enabled), Number(provider.isDefault), provider.defaultModelId, JSON.stringify(provider.customModels), timestamp, provider.id);
      else this.db.prepare('INSERT INTO providers(id,name,type,base_url,enabled,is_default,default_model_id,custom_models_json,created_at,updated_at,key_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(provider.id, provider.name, provider.kind, provider.baseUrl, Number(provider.enabled), Number(provider.isDefault), provider.defaultModelId, JSON.stringify(provider.customModels), timestamp, timestamp, randomUUID());
      if (targetChanged) {
        this.db.prepare('UPDATE providers SET api_key_reference=NULL,key_revision=? WHERE id=?').run(randomUUID(),provider.id);
        this.db.prepare('DELETE FROM key_records WHERE provider_id=?').run(provider.id);
      }
      return this.getProviderConfiguration(provider.id)!;
    });
  }

  getProviderConfiguration(id: string): ProviderConfiguration | undefined {
    this.assertInitialized(); configurationInput(idSchema, id);
    const row = this.db.prepare('SELECT id,name,type AS kind,base_url AS baseUrl,enabled,is_default AS isDefault,default_model_id AS defaultModelId,custom_models_json AS customModels,api_key_reference AS keyReference,created_at AS createdAt,updated_at AS updatedAt FROM providers WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return;
    let models: unknown;
    try { models = JSON.parse(row.customModels as string); } catch { throw new ContractError('invalid_state'); }
    return configurationOutput(providerConfigurationSchema, { ...row, enabled: row.enabled === 1, isDefault: row.isDefault === 1, customModels: models, keyReference: row.keyReference === null ? null : { id: row.keyReference } });
  }

  listProviderSummaries(): ProviderSummary[] {
    this.assertInitialized();
    const rows = this.db.prepare('SELECT id,name,type,enabled,is_default,default_model_id,api_key_reference FROM providers ORDER BY created_at,id').all() as Array<{ id: string; name: string; type: string; enabled: number; is_default: number; default_model_id: string | null; api_key_reference: string | null }>;
    return rows.map(row => {
      let configuration: ProviderConfiguration | undefined;
      try { configuration = this.getProviderConfiguration(row.id); } catch { /* Preserve invalid legacy rows; never echo their URL or raw configuration. */ }
      const record = row.api_key_reference ? this.rawKeyRecord(row.api_key_reference) : undefined;
      return configurationOutput(providerSummarySchema, { id: row.id, name: row.name, kind: configuration?.kind ?? null, enabled: row.enabled === 1,
        isDefault: row.is_default === 1, defaultModelId: configuration?.defaultModelId ?? null, customModels: configuration?.customModels ?? [], configurationValid: !!configuration, hasStoredKey: record?.providerId === row.id });
    });
  }

  validateModelSelection(providerId: string, modelId: string): ProviderConfiguration {
    configurationInput(idSchema, providerId); configurationInput(idSchema, modelId);
    const provider = this.getProviderConfiguration(providerId);
    if (!provider) throw new ContractError('not_found');
    if (!provider.enabled) throw new ContractError('invalid_state');
    if (provider.kind === 'mock' && modelId !== 'mock') throw new ContractError('invalid_input');
    return provider;
  }

  assertProviderMutable(id: string): void {
    this.assertInitialized(); configurationInput(idSchema, id);
    if (!this.db.prepare('SELECT 1 FROM providers WHERE id=?').get(id)) throw new ContractError('not_found');
    const used = this.db.prepare(`SELECT 1 FROM workflow_runs r WHERE r.status IN ('running','pausing','paused','cancelling') AND (
      EXISTS(SELECT 1 FROM json_each(r.members_snapshot) m WHERE json_extract(m.value,'$.providerId')=?)
      OR (r.members_snapshot IS NULL AND EXISTS(SELECT 1 FROM agents a WHERE a.room_id=r.room_id AND a.provider_id=?))) LIMIT 1`).get(id, id);
    if (used) throw new ContractError('invalid_state');
  }

  deleteProvider(id: string): void {
    configurationInput(idSchema, id);
    this.transaction(() => {
      this.assertProviderMutable(id);
      if (this.db.prepare('SELECT 1 FROM agents WHERE provider_id=? LIMIT 1').get(id)
        || this.db.prepare("SELECT 1 FROM workflow_runs r WHERE EXISTS(SELECT 1 FROM json_each(r.members_snapshot) m WHERE json_extract(m.value,'$.providerId')=?) LIMIT 1").get(id)) throw new ContractError('invalid_state');
      this.db.prepare('DELETE FROM key_records WHERE provider_id=?').run(id);
      this.db.prepare('DELETE FROM providers WHERE id=?').run(id);
    });
  }

  getProviderKeyRevision(providerId: string): string {
    this.assertInitialized(); configurationInput(idSchema, providerId);
    const revision = this.db.prepare('SELECT key_revision FROM providers WHERE id=?').pluck().get(providerId) as string | undefined;
    if (!revision) throw new ContractError('not_found');
    return revision;
  }

  replaceProviderKey(providerId: string, record: { id: string; providerId: string; encryptedValue: string; backend: string } | null, expectedRevision: string): void {
    this.transaction(() => {
      this.assertProviderMutable(providerId);
      if (this.getProviderKeyRevision(providerId) !== expectedRevision) throw new ContractError('invalid_state');
      if (record && (record.providerId !== providerId || this.rawKeyRecord(record.id))) throw new ContractError('invalid_state');
      if (record) this.storeKeyRecord(record);
      this.db.prepare('UPDATE providers SET api_key_reference=?,updated_at=?,key_revision=? WHERE id=?').run(record?.id ?? null, now(), randomUUID(), providerId);
      this.db.prepare('DELETE FROM key_records WHERE provider_id=? AND id<>?').run(providerId, record?.id ?? '');
    });
  }

  listRoomMessages(input: RoomMessagePageInput): RoomMessagePage {
    const { roomId, cursor, limit } = configurationInput(roomMessagePageInputSchema, input);
    return this.transaction(() => {
      if (!this.getRoom(roomId)) throw new ContractError('not_found');
      const maximum = this.db.prepare('SELECT COALESCE(MAX(sort_key),0) FROM messages WHERE room_id=?').pluck().get(roomId) as number;
      const through = cursor?.throughKey ?? maximum; const after = cursor?.afterKey ?? 0;
      if (cursor && (cursor.roomId !== roomId || after > through || through > maximum
        || [after, through].some(key => key > 0 && !this.db.prepare('SELECT 1 FROM messages WHERE room_id=? AND sort_key=?').get(roomId, key)))) throw new ContractError('invalid_input');
      const rows = this.db.prepare('SELECT id,room_id AS roomId,run_id AS runId,turn_id AS turnId,sender_type AS senderType,sender_name AS senderName,content,status,sort_key AS sortKey,created_at AS createdAt,updated_at AS updatedAt FROM messages WHERE room_id=? AND sort_key>? AND sort_key<=? ORDER BY sort_key LIMIT ?').all(roomId, after, through, limit + 1);
      const selected = rows.slice(0, limit); const hasMore = rows.length > limit;
      return configurationOutput(roomMessagePageSchema, { items: selected, hasMore, nextCursor: hasMore ? { roomId, afterKey: (selected.at(-1) as { sortKey: number }).sortKey, throughKey: through } : null });
    });
  }

  listRoomRuns(input: RoomRunPageInput): RoomRunPage {
    const { roomId, cursor, limit } = configurationInput(roomRunPageInputSchema, input);
    return this.transaction(() => {
      if (!this.getRoom(roomId)) throw new ContractError('not_found');
      const upper = this.db.prepare('SELECT created_at AS createdAt,id FROM workflow_runs WHERE room_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(roomId) as { createdAt: string; id: string } | undefined;
      if (!upper) {
        if (cursor) throw new ContractError('invalid_input');
        return { items: [], nextCursor: null, hasMore: false };
      }
      const through = cursor?.through ?? upper;
      const maximumRowId = this.db.prepare('SELECT COALESCE(MAX(rowid),0) FROM workflow_runs WHERE room_id=?').pluck().get(roomId) as number;
      const throughRowId = cursor?.throughRowId ?? maximumRowId;
      if (cursor && (cursor.roomId !== roomId || throughRowId > maximumRowId || [cursor.after, through].some(point => !this.db.prepare('SELECT 1 FROM workflow_runs WHERE room_id=? AND created_at=? AND id=?').get(roomId, point.createdAt, point.id))
        || compareHistoryPoint(cursor.after, through) > 0 || compareHistoryPoint(through, upper) > 0)) throw new ContractError('invalid_input');
      const afterSql = cursor ? 'AND (created_at,id)>(?,?)' : '';
      const args = cursor ? [roomId, throughRowId, cursor.after.createdAt, cursor.after.id, through.createdAt, through.id, limit + 1] : [roomId, throughRowId, through.createdAt, through.id, limit + 1];
      const rows = this.db.prepare(`SELECT id,room_id AS roomId,status,task,created_at AS createdAt,updated_at AS updatedAt FROM workflow_runs WHERE room_id=? AND rowid<=? ${afterSql} AND (created_at,id)<=(?,?) ORDER BY created_at,id LIMIT ?`).all(...args) as Array<{ id: string; createdAt: string }>;
      const selected = rows.slice(0, limit); const hasMore = rows.length > limit; const last = selected.at(-1)!;
      return configurationOutput(roomRunPageSchema, { items: selected, hasMore, nextCursor: hasMore ? { roomId, throughRowId, after: { createdAt: last.createdAt, id: last.id }, through } : null });
    });
  }

  reserveControlledTrial(record: TrialRecord): void {
    const value = trialRecordSchema.parse(record);
    if (value.state !== 'reserved') throw new ContractError('invalid_input');
    this.transaction(() => {
      if (this.hasUnresolvedControlledTrials()) throw new ContractError('invalid_state');
      this.db.prepare('INSERT INTO controlled_trials(id,request_id,provider_id,state,data_json) VALUES(?,?,?,?,?)')
        .run(value.id, value.requestId, value.providerId, value.state, JSON.stringify(value));
    });
  }

  listControlledTrials(): TrialRecord[] {
    this.assertInitialized();
    return (this.db.prepare('SELECT data_json FROM controlled_trials ORDER BY rowid DESC LIMIT 100').pluck().all() as string[])
      .map(value => trialRecordSchema.parse(JSON.parse(value)));
  }

  hasUnresolvedControlledTrials(): boolean {
    this.assertInitialized();
    return Boolean(this.db.prepare("SELECT 1 FROM controlled_trials WHERE state IN ('reserved','unknown') AND reservation_released=0 LIMIT 1").get());
  }

  reconcileControlledTrial(input: ReconciliationInput): TrialReconciliation {
    const value = configurationInput(reconciliationInputSchema, input);
    return this.transaction(() => {
      const row = this.db.prepare("SELECT data_json FROM controlled_trials WHERE id=? AND state='unknown' AND reservation_released=0").pluck().get(value.trialId) as string | undefined;
      if (!row) throw new ContractError('invalid_state');
      const trial = trialRecordSchema.parse(JSON.parse(row));
      if (trial.requestId !== value.requestId || trial.providerId !== value.providerId || trial.keyRevision !== value.keyRevision) throw new ContractError('forbidden');
      const reviewedAt = now();
      const age = Date.parse(reviewedAt) - Date.parse(trial.createdAt);
      if (age < 0 || age > 30 * 86400000) throw new ContractError('invalid_input');
      const audit = reconciliationAuditSchema.parse({ ...value, id: randomUUID(), reviewedAt, evidenceSummary: reconciliationEvidenceSummary });
      this.db.prepare('INSERT INTO controlled_trial_reconciliations(id,trial_id,decision,reviewed_at,data_json) VALUES(?,?,?,?,?)')
        .run(audit.id, audit.trialId, audit.decision, audit.reviewedAt, JSON.stringify(audit));
      if (audit.decision === 'release_reservation') {
        this.db.prepare("UPDATE controlled_trials SET reservation_released=1 WHERE id=? AND state='unknown' AND reservation_released=0").run(audit.trialId);
      }
      return audit;
    });
  }

  listControlledTrialReconciliations(trialId?: string): TrialReconciliation[] {
    this.assertInitialized();
    if (trialId !== undefined) configurationInput(idSchema, trialId);
    const query = trialId === undefined
      ? this.db.prepare('SELECT data_json FROM controlled_trial_reconciliations ORDER BY rowid')
      : this.db.prepare('SELECT data_json FROM controlled_trial_reconciliations WHERE trial_id=? ORDER BY rowid');
    return (query.pluck().all(...(trialId === undefined ? [] : [trialId])) as string[])
      .map(row => reconciliationAuditSchema.parse(JSON.parse(row)));
  }

  updateControlledTrialProgress(id: string, patch: Partial<Pick<TrialRecord, 'text' | 'observedUsage' | 'diagnostics'>>): void {
    this.transaction(() => {
      const row = this.db.prepare("SELECT data_json FROM controlled_trials WHERE id=? AND state='reserved'").pluck().get(id) as string | undefined;
      if (!row) throw new ContractError('invalid_state');
      const value = trialRecordSchema.parse({ ...JSON.parse(row), ...patch });
      this.db.prepare('UPDATE controlled_trials SET data_json=? WHERE id=?').run(JSON.stringify(value), id);
    });
  }

  finishControlledTrial(id: string, patch: Pick<TrialRecord, 'state' | 'outcome' | 'actualInputTokens' | 'actualOutputTokens' | 'accountedMicroCny' | 'errorCode'> & Pick<TrialRecord, 'diagnostics'>): TrialRecord {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT data_json FROM controlled_trials WHERE id=? AND state='reserved'").pluck().get(id) as string | undefined;
      if (!row || patch.state === 'reserved' || patch.outcome === 'running') throw new ContractError('invalid_state');
      const value = trialRecordSchema.parse({ ...JSON.parse(row), ...patch });
      this.db.prepare('UPDATE controlled_trials SET state=?,data_json=? WHERE id=?').run(value.state, JSON.stringify(value), id);
      return value;
    });
  }

  recoverControlledTrials(): void {
    this.transaction(() => {
      const rows = this.db.prepare("SELECT id,data_json FROM controlled_trials WHERE state='reserved'").all() as Array<{ id: string; data_json: string }>;
      for (const row of rows) {
        const value = trialRecordSchema.parse({ ...JSON.parse(row.data_json), state: 'unknown', outcome: 'interrupted' });
        this.db.prepare('UPDATE controlled_trials SET state=?,data_json=? WHERE id=?').run(value.state, JSON.stringify(value), row.id);
      }
    });
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

function configurationInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ContractError('invalid_input');
  return result.data;
}
function configurationOutput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ContractError('invalid_state');
  return result.data;
}
function compareHistoryPoint(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  return compareRunPositions(a,b);
}
