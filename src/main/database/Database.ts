import { randomUUID } from 'node:crypto';
import DatabaseDriver from 'better-sqlite3';
import { chmodSync } from 'node:fs';
import { mkdir, lstat, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { migration3 } from './migrations/v3';
import { migration4 } from './migrations/v4';
import { migration5 } from './migrations/v5';
import { migration6 } from './migrations/v6';
import { migration7 } from './migrations/v7';
import { migration8 } from './migrations/v8';
import { migration9 } from './migrations/v9';
import { migration10 } from './migrations/v10';
import { migration11 } from './migrations/v11';
import { migration12 } from './migrations/v12';
import { migration13 } from './migrations/v13';
import { migration14 } from './migrations/v14';
import { requestUsageSchema, type RequestUsage, type UsageKind } from '../../shared/schemas/usage';
import type { StreamChatInput as StreamChatInputRecord } from '../../shared/contracts/provider';
import { ContractError } from '../../shared/contracts/errors';
import type { ArtifactIssue, ArtifactKind } from '../../shared/schemas/artifact';
import { apiErrorSchema, errorCodeSchema, type ApiError, type ErrorCode } from '../../shared/schemas/error';
import { roomInputSchema,roomConfigurationSchema,agentInputSchema,agentConfigurationSchema,providerInputSchema,providerConfigurationSchema,providerSummarySchema,listRoomsInputSchema,reorderAgentsInputSchema,roomMessagePageInputSchema,roomMessagePageSchema,roomRunPageInputSchema,roomRunPageSchema, compareRunPositions } from '../../shared/schemas/configuration';
import type { RoomInput,RoomConfiguration,AgentInput,AgentConfiguration,ProviderInput,ProviderConfiguration,ProviderSummary,RoomMessagePageInput,RoomMessagePage,RoomRunPageInput,RoomRunPage } from '../../shared/contracts/configuration';
import { migration2 } from './migrations/v2';
import { createVerifiedBackup, type VerifiedBackup } from './backup/createVerifiedBackup';
import { prepareRestore } from './recovery/prepareRestore';
import { validateDatabase } from './recovery/validateDatabase';
import { classifyInterruptedRuns } from './recovery/classifyInterruptedRuns';
import { executionMetadataSchema, storedRunSchema, createAttemptInputSchema, requestAttemptSchema, messagePageInputSchema, eventPageInputSchema } from '../../shared/schemas/persistence';
import type { ExecutionMetadata,StoredRun, RequestAttempt, CreateAttemptInput, MessageCursor } from '../../shared/schemas/persistence';
import { idSchema, looksLikeApiKey, modelIdSchema, sequenceSchema } from '../../shared/schemas/common';
import { DEFAULT_OUTPUT_TOKEN_LIMIT, runEventSchema } from '../../shared/schemas/run';
import { streamChatInputSchema } from '../../shared/schemas/provider';
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
  overrideActionId?: string;
};

export type VersionOrigin = 'original' | 'retry' | 'continue' | 'regenerate' | 'edit';
/** One version of a message slot (a Turn, or a host message); exactly one version per slot is active. */
export type VersionRecord = {
  messageId: string; runId: string; slotId: string; turnId?: string; versionNumber: number; origin: VersionOrigin;
  parentMessageId?: string; actionId?: string; basis: string[] | null; active: boolean;
};
export type VersionInput = { origin?: VersionOrigin; slotId?: string; parentMessageId?: string; actionId?: string; basis?: string[]; activate?: boolean };
export type HostActionRecord = {
  id: string; runId: string; clientRequestId: string; kind: string; status: string; fingerprint: string;
  agentId?: string; messageId?: string; resultMessageId?: string; instructionId?: string; turnId?: string; createdAt: string; updatedAt: string;
};
/** D111: a finished discussion continued in the same Run: the host's interjection and who answers it, in order. */
export type ContinuationRecord = { actionId: string; runId: string; agentIds: string[]; elapsedBaseMs: number; createdAt: string };
export type InstructionRevisionRecord = { id: string; runId: string; instructionId: string; revision: number; content: string | null; actionId: string; createdAt: string };
export type UsageRow = { runId: string; usage: RequestUsage };
export type SummaryRequestRecord = { requestId: string; summaryId: string; runId: string; messageId: string; clientRequestId: string; agentId: string;
  status: 'generating' | 'completed' | 'failed' | 'aborted' | 'interrupted'; finishReason?: 'stop' | 'length'; inputSnapshot: StreamChatInputRecord; createdAt: string;
  /** D125: from the request's summary_updated event (migration 9 has no column for it). */ errorCode?: ErrorCode };
export type SummaryRecord = { id: string; runId: string; clientRequestId: string; agentId: string; covered: string[]; basedOnSummaryId?: string; createdAt: string;
  requests: SummaryRequestRecord[]; confirmedMessageIds: string[]; revokedMessageIds: string[] };

/** R14: one artifact and its versions, oldest first. */
export type ArtifactRequestRecord = { requestId: string; status: 'generating' | 'completed' | 'failed' | 'aborted' | 'interrupted'; finishReason?: 'stop' | 'length'; errorCode?: ErrorCode; createdAt: string };
export type ArtifactVersionRecord = { id: string; artifactId: string; runId: string; number: number; origin: 'generate' | 'regenerate' | 'edit'; parentVersionId?: string;
  clientRequestId: string; agentId?: string; validation: 'pending' | 'valid' | 'invalid' | 'empty'; rawOutput: string; contentJson: string | null; issuesJson: string | null; emptyReason: string | null;
  createdAt: string; updatedAt: string; request?: ArtifactRequestRecord; sources: string[];
  exports: Array<{ id: string; format: 'markdown' | 'json'; target: 'clipboard' | 'file'; fileName?: string; createdAt: string }>;
  /** R15: writes of a code version into a folder, oldest first. */
  codeWrites: Array<{ id: string; rootPath: string; written: number; skipped: number; failed: number; createdAt: string }> };
/** R15: one write of a code version and what happened to each of its files. */
export type CodeExportFileRecord = { path: string; action: 'create' | 'overwrite' | 'none'; outcome: 'written' | 'skipped' | 'failed'; reason?: string; contentSha256: string; bytes: number };
export type CodeExportRecord = { id: string; versionId: string; runId: string; clientRequestId: string; rootPath: string; createdAt: string; files: CodeExportFileRecord[] };
export type ArtifactRecord = { id: string; runId: string; roomId: string; kind: ArtifactKind; clientRequestId: string; createdAt: string; versions: ArtifactVersionRecord[] };
type RawArtifactVersion = Omit<ArtifactVersionRecord, 'parentVersionId' | 'agentId' | 'request' | 'sources' | 'exports' | 'codeWrites'> & { parentVersionId: string | null; agentId: string | null };

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
  migration6,
  migration7,
  migration8,
  migration9,
  migration10,
  migration11,
  migration12,
  migration13,
  migration14,
];

export type ModelDiscovery = { modelIds: string[]; outcome: 'listed' | 'unsupported' | 'authentication_failed' | 'failed'; checkedAt: string; listedAt: string | null };
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
      // D143: the registry speaks first, so a member outside the catalog hears that rather than that its service is stopped.
      if (validateRealSelection && this.getProviderConfiguration(row.provider_id)?.kind !== 'mock') validateRealSelection(row.provider_id, row.model_id);
      if (this.validateModelSelection(row.provider_id,row.model_id).kind !== 'mock' && !validateRealSelection) throw new ContractError('unsupported');
    }
    return rows.map((row) => ({ id: row.id, roomId: row.room_id, displayName: row.display_name, roleTemplateId: row.role_template_id, displayOrder: row.display_order, systemPrompt: row.system_prompt, providerId: row.provider_id, modelId: row.model_id }));
  }

  insertRun(run: Omit<Pick<RunRecord,'id'|'roomId'|'status'|'workflowSnapshot'>,'status'> & {status:string} & Partial<ExecutionMetadata>): void {
    this.assertInitialized();
    const timestamp = now();
    const value=storedRunSchema.parse({id:run.id,roomId:run.roomId,status:run.status,workflowSnapshot:run.workflowSnapshot,lastError:null,
      task:run.task??null,membersSnapshot:run.membersSnapshot??null,nextTurnIndex:run.nextTurnIndex??null,elapsedExecutionMs:run.elapsedExecutionMs??null,
      mode:run.mode??'automatic',maxTurns:run.maxTurns??12,maxDurationMs:run.maxDurationMs??300000,outputTokenLimit:run.outputTokenLimit??DEFAULT_OUTPUT_TOKEN_LIMIT,
      currentTurnId:null,currentAgentId:null,startedAt:null,finishedAt:null,createdAt:timestamp,updatedAt:timestamp});
    this.db.prepare('INSERT INTO workflow_runs(id,room_id,status,mode,workflow_snapshot,max_turns,max_duration_ms,output_token_limit,created_at,updated_at,task,members_snapshot,next_turn_index,elapsed_execution_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(value.id,value.roomId,value.status,value.mode,JSON.stringify(value.workflowSnapshot),value.maxTurns,value.maxDurationMs,value.outputTokenLimit,timestamp,timestamp,value.task,value.membersSnapshot===null?null:JSON.stringify(value.membersSnapshot),value.nextTurnIndex,value.elapsedExecutionMs);
  }

  /** D133: open one real request's usage row, in the transaction that records the request. */
  openUsage(input: { requestId: string; runId: string; agentId: string; providerId: string; modelId: string; kind: UsageKind }): void {
    this.assertInitialized();
    const timestamp = now();
    this.db.prepare(`INSERT INTO request_usage(request_id,run_id,agent_id,provider_id,model_id,kind,state,input_tokens,output_tokens,cache_hit_tokens,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'in_flight',NULL,NULL,NULL,?,?)`).run(input.requestId, input.runId, input.agentId, input.providerId, input.modelId, input.kind, timestamp, timestamp);
  }

  /**
   * D133: close an open usage row exactly once, from evidence only: `reported` needs provider usage from a terminal
   * stream; `unknown` keeps what was observed and is never recorded as zero; `not_sent` means the request provably
   * never reached the network. A row already closed, or none, is left as it is.
   */
  closeUsage(requestId: string, outcome: { state: 'reported'; inputTokens: number; outputTokens: number; cacheHitTokens?: number }
    | { state: 'unknown'; observed?: { inputTokens: number; outputTokens: number; cacheHitTokens?: number } } | { state: 'not_sent' }): void {
    this.assertInitialized();
    const usage = outcome.state === 'reported' ? outcome : outcome.state === 'unknown' ? outcome.observed : undefined;
    const hit = usage?.cacheHitTokens;
    const cacheHitTokens = hit !== undefined && Number.isSafeInteger(hit) && hit >= 0 && hit <= usage!.inputTokens ? hit : null;
    this.db.prepare("UPDATE request_usage SET state=?,input_tokens=?,output_tokens=?,cache_hit_tokens=?,updated_at=? WHERE request_id=? AND state='in_flight'")
      .run(outcome.state, usage?.inputTokens ?? null, usage?.outputTokens ?? null, cacheHitTokens, now(), requestId);
  }

  getUsage(requestId: string): RequestUsage | undefined {
    this.assertInitialized(); idSchema.parse(requestId);
    const row = this.db.prepare(`SELECT ${usageColumns} FROM request_usage WHERE request_id=?`).get(requestId) as RequestUsage | undefined;
    return row ? requestUsageSchema.parse(row) : undefined;
  }

  /** The usage rows of a Run, in the order the requests were opened. */
  listRunUsage(runId: string): RequestUsage[] {
    this.requireRun(runId);
    return (this.db.prepare(`SELECT ${usageColumns} FROM request_usage WHERE run_id=? ORDER BY created_at,rowid`).all(runId) as RequestUsage[]).map(row => requestUsageSchema.parse(row));
  }

  /** D108: every usage row of every Run, for the usage report. */
  listAllUsage(): UsageRow[] {
    this.assertInitialized();
    return (this.db.prepare(`SELECT run_id AS runId,${usageColumns} FROM request_usage ORDER BY created_at,rowid`).all() as Array<RequestUsage & { runId: string }>)
      .map(({ runId, ...usage }) => ({ runId, usage: requestUsageSchema.parse(usage) }));
  }

  /** The Runs, rooms and Provider names the usage report needs to label its rows. */
  listUsageLabels(): { runs: Array<{ runId: string; roomId: string; roomName: string; task: string; createdAt: string; members: Array<{ agentId: string; displayName: string }> }>; providers: Array<{ id: string; name: string }> } {
    this.assertInitialized();
    const runs = (this.db.prepare(`SELECT r.id AS runId,r.room_id AS roomId,m.name AS roomName,COALESCE(r.task,'') AS task,r.created_at AS createdAt,r.members_snapshot AS members
      FROM workflow_runs r JOIN rooms m ON m.id=r.room_id WHERE EXISTS(SELECT 1 FROM request_usage u WHERE u.run_id=r.id)`).all() as Array<{ runId: string; roomId: string; roomName: string; task: string; createdAt: string; members: string | null }>)
      .map(({ members, ...run }) => ({ ...run, members: members === null ? [] : (JSON.parse(members) as Array<{ agentId: string; displayName: string }>).map(({ agentId, displayName }) => ({ agentId, displayName })) }));
    const providers = this.db.prepare('SELECT id,name FROM providers').all() as Array<{ id: string; name: string }>;
    return { runs, providers };
  }

  // R13B (D107) conversation summaries. A summary's id is the slot id of its timeline message.
  insertSummary(input: { id: string; runId: string; clientRequestId: string; agentId: string; covered: string[]; basedOnSummaryId?: string }): void {
    this.assertInitialized();
    z.array(idSchema).min(1).max(4096).parse(input.covered);
    this.db.prepare('INSERT INTO context_summaries(id,run_id,client_request_id,agent_id,covered_json,based_on_summary_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(input.id, input.runId, input.clientRequestId, input.agentId, JSON.stringify(input.covered), input.basedOnSummaryId ?? null, now());
  }

  insertSummaryRequest(input: { requestId: string; summaryId: string; runId: string; messageId: string; clientRequestId: string; agentId: string; inputSnapshot: StreamChatInputRecord }): void {
    this.assertInitialized();
    const timestamp = now();
    this.db.prepare(`INSERT INTO summary_requests(request_id,summary_id,run_id,message_id,client_request_id,agent_id,status,finish_reason,input_snapshot,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'generating',NULL,?,?,?)`).run(input.requestId, input.summaryId, input.runId, input.messageId, input.clientRequestId, input.agentId,
      JSON.stringify(input.inputSnapshot), timestamp, timestamp);
  }

  finishSummaryRequest(requestId: string, status: 'completed' | 'failed' | 'aborted', finishReason?: 'stop' | 'length'): void {
    this.assertInitialized();
    const result = this.db.prepare("UPDATE summary_requests SET status=?,finish_reason=?,updated_at=? WHERE request_id=? AND status='generating'").run(status, finishReason ?? null, now(), requestId);
    if (result.changes !== 1) throw new Error('Summary request is not generating');
  }

  findSummaryRequestByClient(runId: string, clientRequestId: string): SummaryRequestRecord | undefined {
    this.assertInitialized();
    const row = this.db.prepare(`${summaryRequestSelect} WHERE run_id=? AND client_request_id=?`).get(runId, clientRequestId) as RawSummaryRequest | undefined;
    return row ? summaryRequestFrom(row) : undefined;
  }

  getSummaryRequest(requestId: string): SummaryRequestRecord | undefined {
    this.assertInitialized();
    const row = this.db.prepare(`${summaryRequestSelect} WHERE request_id=?`).get(requestId) as RawSummaryRequest | undefined;
    return row ? summaryRequestFrom(row) : undefined;
  }

  listSummaries(runId: string): SummaryRecord[] {
    this.requireRun(runId);
    const summaries = this.db.prepare('SELECT id,run_id AS runId,client_request_id AS clientRequestId,agent_id AS agentId,covered_json AS covered,based_on_summary_id AS basedOnSummaryId,created_at AS createdAt FROM context_summaries WHERE run_id=? ORDER BY created_at,rowid')
      .all(runId) as Array<Omit<SummaryRecord, 'covered' | 'requests' | 'confirmedMessageIds' | 'revokedMessageIds' | 'basedOnSummaryId'> & { covered: string; basedOnSummaryId: string | null }>;
    return summaries.map(({ covered, basedOnSummaryId, ...summary }) => ({ ...summary, covered: z.array(idSchema).parse(JSON.parse(covered)),
      ...(basedOnSummaryId === null ? {} : { basedOnSummaryId }),
      requests: (this.db.prepare(`${summaryRequestSelect} WHERE summary_id=? ORDER BY created_at,rowid`).all(summary.id) as RawSummaryRequest[]).map(summaryRequestFrom).map(request => {
        if (request.status !== 'failed' && request.status !== 'aborted') return request;
        const code = errorCodeSchema.safeParse(this.db.prepare(`SELECT json_extract(payload_json,'$.errorCode') FROM run_events WHERE run_id=? AND type='summary_updated'
          AND json_extract(payload_json,'$.messageId')=? AND json_extract(payload_json,'$.errorCode') IS NOT NULL ORDER BY sequence DESC LIMIT 1`).pluck().get(runId, request.messageId));
        return code.success ? { ...request, errorCode: code.data } : request;
      }),
      confirmedMessageIds: this.db.prepare('SELECT message_id FROM summary_confirmations WHERE summary_id=? ORDER BY created_at,rowid').pluck().all(summary.id) as string[],
      // D140: the latest change of each version counts.
      revokedMessageIds: this.db.prepare(`SELECT e.message_id FROM summary_use_events e WHERE e.summary_id=? AND e.in_use=0
        AND e.id=(SELECT MAX(id) FROM summary_use_events l WHERE l.message_id=e.message_id)`).pluck().all(summary.id) as string[] }));
  }

  /** A confirmation is per version and append-only; confirming the same version again is the same confirmation. */
  confirmSummaryVersion(input: { messageId: string; summaryId: string; runId: string; clientRequestId?: string }): boolean {
    this.assertInitialized();
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM summary_confirmations WHERE message_id=?').get(input.messageId)) return false;
      this.db.prepare('INSERT INTO summary_confirmations(message_id,summary_id,run_id,client_request_id,created_at) VALUES(?,?,?,?,?)')
        .run(input.messageId, input.summaryId, input.runId, input.clientRequestId ?? null, now());
      return true;
    });
  }

  /** D140: the host stops using a version, or uses it again. Repeating a clientRequestId is the same change. */
  setSummaryUse(input: { messageId: string; summaryId: string; runId: string; clientRequestId: string; inUse: boolean }): boolean {
    this.assertInitialized();
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM summary_use_events WHERE run_id=? AND client_request_id=?').get(input.runId, input.clientRequestId)) return false;
      this.db.prepare('INSERT INTO summary_use_events(message_id,summary_id,run_id,client_request_id,in_use,created_at) VALUES(?,?,?,?,?,?)')
        .run(input.messageId, input.summaryId, input.runId, input.clientRequestId, input.inUse ? 1 : 0, now());
      return true;
    });
  }

  findSummaryUseByClient(runId: string, clientRequestId: string): { messageId: string; summaryId: string; inUse: boolean } | undefined {
    this.assertInitialized();
    const row = this.db.prepare('SELECT message_id AS messageId,summary_id AS summaryId,in_use AS inUse FROM summary_use_events WHERE run_id=? AND client_request_id=?').get(runId, clientRequestId) as { messageId: string; summaryId: string; inUse: number } | undefined;
    return row && { messageId: row.messageId, summaryId: row.summaryId, inUse: row.inUse === 1 };
  }

  findSummaryConfirmationByClient(runId: string, clientRequestId: string): { messageId: string; summaryId: string } | undefined {
    this.assertInitialized();
    return this.db.prepare('SELECT message_id AS messageId,summary_id AS summaryId FROM summary_confirmations WHERE run_id=? AND client_request_id=?').get(runId, clientRequestId) as { messageId: string; summaryId: string } | undefined;
  }

  // R14 (D118–D123) structured artifacts. Every write is append-only; a version's output and validation are set once.
  insertArtifact(input: { id: string; runId: string; roomId: string; kind: ArtifactKind; clientRequestId: string }): void {
    this.assertInitialized();
    this.db.prepare('INSERT INTO artifacts(id,run_id,room_id,kind,client_request_id,created_at) VALUES(?,?,?,?,?,?)')
      .run(input.id, input.runId, input.roomId, input.kind, input.clientRequestId, now());
  }

  /**
   * A new version with the message versions it is based on. A generated version starts pending with empty output;
   * a host edit is valid from the start. Sources must be completed messages of the same Run (D121).
   */
  insertArtifactVersion(input: { id: string; artifactId: string; runId: string; origin: ArtifactVersionRecord['origin']; parentVersionId?: string; clientRequestId: string;
    agentId?: string; sources: readonly string[]; edit?: { rawOutput: string; contentJson: string } }): void {
    this.assertInitialized();
    z.array(idSchema).max(4096).parse(input.sources);
    this.transaction(() => {
      const timestamp = now();
      const number = (this.db.prepare('SELECT COALESCE(MAX(version_number),0)+1 FROM artifact_versions WHERE artifact_id=?').pluck().get(input.artifactId) as number);
      const runOf = this.db.prepare('SELECT run_id FROM messages WHERE id=?').pluck();
      if (input.sources.some(id => runOf.get(id) !== input.runId)) throw new ContractError('invalid_input', 'sources');
      this.db.prepare(`INSERT INTO artifact_versions(id,artifact_id,run_id,version_number,origin,parent_version_id,client_request_id,agent_id,validation,raw_output,content_json,issues_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)`).run(input.id, input.artifactId, input.runId, number, input.origin, input.parentVersionId ?? null, input.clientRequestId,
        input.agentId ?? null, input.edit ? 'valid' : 'pending', input.edit?.rawOutput ?? '', input.edit?.contentJson ?? null, timestamp, timestamp);
      const source = this.db.prepare('INSERT INTO artifact_sources(version_id,message_id,run_id,position) VALUES(?,?,?,?)');
      input.sources.forEach((messageId, position) => source.run(input.id, messageId, input.runId, position));
    });
  }

  insertArtifactRequest(input: { requestId: string; versionId: string; runId: string; agentId: string; inputSnapshot: StreamChatInputRecord }): void {
    this.assertInitialized();
    const timestamp = now();
    this.db.prepare(`INSERT INTO artifact_requests(request_id,version_id,run_id,agent_id,status,finish_reason,input_snapshot,created_at,updated_at) VALUES(?,?,?,?,'generating',NULL,?,?,?)`)
      .run(input.requestId, input.versionId, input.runId, input.agentId, JSON.stringify(input.inputSnapshot), timestamp, timestamp);
  }

  /** The output received so far, kept as evidence while the request streams. */
  setArtifactOutput(versionId: string, rawOutput: string): void {
    this.assertInitialized();
    this.db.prepare('UPDATE artifact_versions SET raw_output=?,updated_at=? WHERE id=?').run(rawOutput, now(), versionId);
  }

  finishArtifactRequest(requestId: string, status: 'completed' | 'failed' | 'aborted', finishReason?: 'stop' | 'length', errorCode?: ErrorCode): void {
    this.assertInitialized();
    if (errorCode !== undefined) errorCodeSchema.parse(errorCode);
    const result = this.db.prepare("UPDATE artifact_requests SET status=?,finish_reason=?,error_code=?,updated_at=? WHERE request_id=? AND status='generating'")
      .run(status, finishReason ?? null, status === 'completed' ? null : errorCode ?? null, now(), requestId);
    if (result.changes !== 1) throw new Error('Artifact request is not generating');
  }

  /** The one validation of a completed generated version. */
  validateArtifactVersion(versionId: string, outcome: { contentJson: string } | { issues: ArtifactIssue[] } | { empty: string }): void {
    this.assertInitialized();
    const [validation, content, issues, empty] = 'contentJson' in outcome ? ['valid', outcome.contentJson, null, null] : 'empty' in outcome ? ['empty', null, null, outcome.empty]
      : ['invalid', null, JSON.stringify(outcome.issues), null];
    const result = this.db.prepare("UPDATE artifact_versions SET validation=?,content_json=?,issues_json=?,empty_reason=?,updated_at=? WHERE id=? AND validation='pending'").run(validation, content, issues, empty, now(), versionId);
    if (result.changes !== 1) throw new Error('Artifact version is already validated');
  }

  insertArtifactExport(input: { id: string; versionId: string; runId: string; clientRequestId: string; format: 'markdown' | 'json'; target: 'clipboard' | 'file'; fileName?: string }): void {
    this.assertInitialized();
    this.db.prepare('INSERT INTO artifact_exports(id,version_id,run_id,client_request_id,format,target,file_name,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(input.id, input.versionId, input.runId, input.clientRequestId, input.format, input.target, input.fileName ?? null, now());
  }

  /** What an earlier delivery of the same clientRequestId did in this Run, if anything (artifact commands are idempotent). */
  findArtifactWrite(runId: string, clientRequestId: string): { kind: 'artifact' | 'version' | 'export'; id: string } | undefined {
    this.assertInitialized();
    const row = this.db.prepare(`SELECT 'version' AS kind,id FROM artifact_versions WHERE run_id=? AND client_request_id=?
      UNION ALL SELECT 'export',id FROM artifact_exports WHERE run_id=? AND client_request_id=?`).get(runId, clientRequestId, runId, clientRequestId) as { kind: 'version' | 'export'; id: string } | undefined;
    return row;
  }

  getArtifactExport(id: string): { id: string; versionId: string; format: 'markdown' | 'json'; target: 'clipboard' | 'file'; fileName?: string } | undefined {
    this.assertInitialized();
    const row = this.db.prepare('SELECT id,version_id AS versionId,format,target,file_name AS fileName FROM artifact_exports WHERE id=?').get(id) as
      { id: string; versionId: string; format: 'markdown' | 'json'; target: 'clipboard' | 'file'; fileName: string | null } | undefined;
    if (!row) return;
    const { fileName, ...rest } = row;
    return { ...rest, ...(fileName === null ? {} : { fileName }) };
  }

  /** R15: one write and its per-file results, recorded after the files were handled; never the file contents. */
  insertCodeExport(input: Omit<CodeExportRecord, 'createdAt'>): string {
    this.assertInitialized();
    return this.transaction(() => {
      const createdAt = now();
      this.db.prepare('INSERT INTO code_exports(id,version_id,run_id,client_request_id,root_path,created_at) VALUES(?,?,?,?,?,?)')
        .run(input.id, input.versionId, input.runId, input.clientRequestId, input.rootPath, createdAt);
      const file = this.db.prepare('INSERT INTO code_export_files(export_id,position,path,action,outcome,reason,content_sha256,byte_count) VALUES(?,?,?,?,?,?,?,?)');
      input.files.forEach((entry, position) => file.run(input.id, position, entry.path, entry.action, entry.outcome, entry.reason ?? null, entry.contentSha256, entry.bytes));
      return createdAt;
    });
  }

  /** The earlier write of the same clientRequestId in this Run, if any (a write is never repeated). */
  findCodeExport(runId: string, clientRequestId: string): CodeExportRecord | undefined {
    this.assertInitialized();
    const row = this.db.prepare('SELECT id,version_id AS versionId,run_id AS runId,client_request_id AS clientRequestId,root_path AS rootPath,created_at AS createdAt FROM code_exports WHERE run_id=? AND client_request_id=?')
      .get(runId, clientRequestId) as Omit<CodeExportRecord, 'files'> | undefined;
    if (!row) return;
    const files = (this.db.prepare('SELECT path,action,outcome,reason,content_sha256 AS contentSha256,byte_count AS bytes FROM code_export_files WHERE export_id=? ORDER BY position').all(row.id) as
      Array<Omit<CodeExportFileRecord, 'reason'> & { reason: string | null }>).map(({ reason, ...entry }) => ({ ...entry, ...(reason === null ? {} : { reason }) }));
    return { ...row, files };
  }

  listArtifacts(runId: string): ArtifactRecord[] {
    this.requireRun(runId);
    return this.transaction(() => {
      const artifacts = this.db.prepare('SELECT id,run_id AS runId,room_id AS roomId,kind,client_request_id AS clientRequestId,created_at AS createdAt FROM artifacts WHERE run_id=? ORDER BY created_at,rowid')
        .all(runId) as Array<Omit<ArtifactRecord, 'versions'>>;
      const versions = this.db.prepare(`SELECT id,artifact_id AS artifactId,run_id AS runId,version_number AS number,origin,parent_version_id AS parentVersionId,client_request_id AS clientRequestId,
        agent_id AS agentId,validation,raw_output AS rawOutput,content_json AS contentJson,issues_json AS issuesJson,empty_reason AS emptyReason,created_at AS createdAt,updated_at AS updatedAt
        FROM artifact_versions WHERE run_id=? ORDER BY artifact_id,version_number`).all(runId) as RawArtifactVersion[];
      const requests = new Map((this.db.prepare(`SELECT request_id AS requestId,version_id AS versionId,status,finish_reason AS finishReason,error_code AS errorCode,created_at AS createdAt FROM artifact_requests WHERE run_id=?`)
        .all(runId) as Array<{ requestId: string; versionId: string; status: ArtifactRequestRecord['status']; finishReason: 'stop' | 'length' | null; errorCode: string | null; createdAt: string }>)
        .map(({ versionId, finishReason, errorCode, ...request }) => [versionId, { ...request, ...(finishReason === null ? {} : { finishReason }),
          ...(errorCode === null ? {} : { errorCode: errorCodeSchema.parse(errorCode) }) }]));
      const sources = new Map<string, string[]>();
      for (const row of this.db.prepare('SELECT version_id AS versionId,message_id AS messageId FROM artifact_sources WHERE run_id=? ORDER BY version_id,position').all(runId) as Array<{ versionId: string; messageId: string }>) {
        sources.set(row.versionId, [...(sources.get(row.versionId) ?? []), row.messageId]);
      }
      const exports = new Map<string, ArtifactVersionRecord['exports']>();
      for (const row of this.db.prepare('SELECT id,version_id AS versionId,format,target,file_name AS fileName,created_at AS createdAt FROM artifact_exports WHERE run_id=? ORDER BY created_at,rowid')
        .all(runId) as Array<{ id: string; versionId: string; format: 'markdown' | 'json'; target: 'clipboard' | 'file'; fileName: string | null; createdAt: string }>) {
        const { versionId, fileName, ...entry } = row;
        exports.set(versionId, [...(exports.get(versionId) ?? []), { ...entry, ...(fileName === null ? {} : { fileName }) }]);
      }
      const codeWrites = new Map<string, ArtifactVersionRecord['codeWrites']>();
      for (const row of this.db.prepare(`SELECT e.id,e.version_id AS versionId,e.root_path AS rootPath,e.created_at AS createdAt,
          SUM(f.outcome='written') AS written,SUM(f.outcome='skipped') AS skipped,SUM(f.outcome='failed') AS failed
        FROM code_exports e JOIN code_export_files f ON f.export_id=e.id WHERE e.run_id=? GROUP BY e.id ORDER BY e.created_at,e.rowid`)
        .all(runId) as Array<{ id: string; versionId: string; rootPath: string; createdAt: string; written: number; skipped: number; failed: number }>) {
        const { versionId, ...entry } = row;
        codeWrites.set(versionId, [...(codeWrites.get(versionId) ?? []), entry]);
      }
      return artifacts.map(artifact => ({ ...artifact, versions: versions.filter(version => version.artifactId === artifact.id).map(({ parentVersionId, agentId, ...version }) => ({
        ...version, ...(parentVersionId === null ? {} : { parentVersionId }), ...(agentId === null ? {} : { agentId }),
        ...(requests.has(version.id) ? { request: requests.get(version.id)! } : {}), sources: sources.get(version.id) ?? [],
        exports: exports.get(version.id) ?? [], codeWrites: codeWrites.get(version.id) ?? [] })) }));
    });
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

  /**
   * D096: clears stored model IDs that look like an API key (a key pasted into a model field) and returns how many
   * places were cleared. When anything changed, freed pages are zeroed (secure_delete + VACUUM) and the WAL is
   * truncated, so the plaintext does not linger in the file. Never returns or logs the values themselves.
   */
  purgeKeyLikeModelIds(): number {
    this.assertInitialized();
    const cleared = this.db.transaction(() => {
      let count = 0;
      const providers = this.db.prepare('SELECT id,default_model_id,custom_models_json FROM providers').all() as Array<{ id: string; default_model_id: string | null; custom_models_json: string }>;
      for (const row of providers) {
        const clearDefault = row.default_model_id !== null && looksLikeApiKey(row.default_model_id);
        let models: unknown;
        try { models = JSON.parse(row.custom_models_json); } catch { models = undefined; }
        const kept = Array.isArray(models) ? models.filter((model: { id?: unknown } | null) => !(typeof model?.id === 'string' && looksLikeApiKey(model.id))) : models;
        const removed = Array.isArray(models) ? models.length - (kept as unknown[]).length : 0;
        if (!clearDefault && !removed) continue;
        count += Number(clearDefault) + removed;
        this.db.prepare('UPDATE providers SET default_model_id=?,custom_models_json=? WHERE id=?')
          .run(clearDefault ? null : row.default_model_id, removed ? JSON.stringify(kept) : row.custom_models_json, row.id);
      }
      const agents = this.db.prepare('SELECT id,model_id FROM agents WHERE model_id IS NOT NULL').all() as Array<{ id: string; model_id: string }>;
      for (const row of agents.filter(agent => looksLikeApiKey(agent.model_id))) {
        this.db.prepare('UPDATE agents SET model_id=NULL WHERE id=?').run(row.id);
        count++;
      }
      return count;
    })();
    if (cleared && this.filename !== ':memory:') {
      const previous = this.db.pragma('secure_delete', { simple: true });
      this.db.pragma('secure_delete = ON');
      this.db.exec('VACUUM');
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      this.db.pragma(`secure_delete = ${Number(previous) ? 'ON' : 'OFF'}`);
    }
    return cleared;
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
      // A version regeneration does not change Run status; any request still open at startup was interrupted.
      this.db.prepare("UPDATE request_attempts SET status='interrupted',updated_at=?,finished_at=? WHERE status IN ('running','pending','queued')").run(timestamp, timestamp);
      // An interrupted request reached the provider or may have: its usage stays unknown, never zero.
      this.db.prepare("UPDATE request_usage SET state='unknown',updated_at=? WHERE state='in_flight'").run(timestamp);
      // R13B: a summary request open at startup was interrupted the same way; it is never resent automatically.
      this.db.prepare("UPDATE summary_requests SET status='interrupted',updated_at=? WHERE status='generating'").run(timestamp);
      // R14: an artifact request too; its version keeps the partial output and stays unvalidated.
      this.db.prepare("UPDATE artifact_requests SET status='interrupted',updated_at=? WHERE status='generating'").run(timestamp);
      this.db.prepare("UPDATE messages SET status='aborted',updated_at=? WHERE status='streaming' AND run_id IS NOT NULL").run(timestamp);
      return ids.length;
    })();
    return result;
  }

  /**
   * A host-directed Turn references its host action: a pending Override, consumed here, or the latest continuation
   * (D111), whose next answering member it must be. Either way it is not a plan Turn.
   */
  insertTurn(turn: { id: string; runId: string; agentId: string; status: string; requestId: string; turnIndex: number; overrideActionId?: string; continuationId?: string }): void {
    this.assertInitialized();
    const timestamp = now();
    this.db.transaction(() => {
      const run = this.getRun(turn.runId);
      const agent = this.db.prepare('SELECT room_id FROM agents WHERE id=?').get(turn.agentId) as { room_id: string } | undefined;
      if (!run || agent?.room_id !== run.roomId || run.nextTurnIndex !== null && run.nextTurnIndex !== turn.turnIndex
        || turn.overrideActionId !== undefined && turn.continuationId !== undefined) throw new Error('Invalid Turn allocation');
      if (turn.overrideActionId !== undefined) {
        const action = this.getHostAction(turn.overrideActionId);
        if (!action || action.runId !== turn.runId || action.kind !== 'setOverride' || action.status !== 'pending' || action.agentId !== turn.agentId) throw new Error('Invalid Turn allocation');
      }
      if (turn.continuationId !== undefined) {
        const continuation = this.listContinuations(turn.runId).at(-1);
        const answered = continuation ? (this.db.prepare('SELECT COUNT(*) FROM turns WHERE run_id=? AND override_action_id=?').pluck().get(turn.runId, continuation.actionId) as number) : 0;
        if (!continuation || continuation.actionId !== turn.continuationId || continuation.agentIds[answered] !== turn.agentId) throw new Error('Invalid Turn allocation');
      }
      this.db.prepare('INSERT INTO turns(id, run_id, agent_id, status, request_id, turn_index, created_at, updated_at, override_action_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(turn.id, turn.runId, turn.agentId, turn.status, turn.requestId, turn.turnIndex, timestamp, timestamp, turn.overrideActionId ?? turn.continuationId ?? null);
      if (turn.overrideActionId !== undefined) this.db.prepare("UPDATE host_actions SET status='consumed',turn_id=?,updated_at=? WHERE id=?").run(turn.id, timestamp, turn.overrideActionId);
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
    const rows = this.db.prepare('SELECT id, run_id, agent_id, status, request_id, turn_index, partial_content, override_action_id FROM turns WHERE run_id = ? ORDER BY turn_index').all(runId) as RawTurn[];
    return rows.map(turnFromRow);
  }

  getTurn(id: string): TurnRecord | undefined {
    this.assertInitialized();
    const row = this.db.prepare('SELECT id, run_id, agent_id, status, request_id, turn_index, partial_content, override_action_id FROM turns WHERE id = ?').get(id) as RawTurn | undefined;
    return row ? turnFromRow(row) : undefined;
  }

  insertMessage(message: MessageRecord, version: VersionInput = {}): void {
    this.assertInitialized();
    const timestamp = now();
    this.db.transaction(() => {
      const run = this.getRun(message.runId);
      if (!run || run.roomId !== message.roomId || message.turnId && this.getTurn(message.turnId)?.runId !== message.runId) throw new Error('Invalid Message identity');
      const slotId = message.turnId ?? version.slotId ?? message.id;
      const slot = this.db.prepare('SELECT run_id AS runId,turn_id AS turnId,active_message_id AS activeMessageId FROM message_slots WHERE slot_id=?').get(slotId) as { runId: string; turnId: string | null; activeMessageId: string } | undefined;
      if (version.slotId !== undefined && (message.turnId !== undefined && version.slotId !== message.turnId || !slot)) throw new Error('Invalid Message version');
      if (slot && (slot.runId !== message.runId || (slot.turnId ?? undefined) !== message.turnId)) throw new Error('Invalid Message version');
      const parent = slot ? version.parentMessageId ?? slot.activeMessageId : undefined;
      if (version.parentMessageId !== undefined && (!slot || this.db.prepare('SELECT slot_id FROM message_versions WHERE message_id=?').pluck().get(version.parentMessageId) !== slotId)) throw new Error('Invalid Message version');
      if (version.basis !== undefined) z.array(idSchema).max(4096).parse(version.basis);
      const key = this.db.prepare("UPDATE persistence_counters SET value=value+1 WHERE name='message' RETURNING value").pluck().get() as number;
      this.db.prepare('INSERT INTO messages(id,room_id,run_id,turn_id,sender_type,sender_name,content,status,created_at,updated_at,sort_key,parent_version_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(message.id,message.roomId,message.runId,message.turnId??null,message.senderType,message.senderName,message.content,message.status??'completed',timestamp,timestamp,key,parent??null);
      const number = slot ? (this.db.prepare('SELECT MAX(version_number) FROM message_versions WHERE slot_id=?').pluck().get(slotId) as number) + 1 : 1;
      this.db.prepare('INSERT INTO message_versions(message_id,run_id,slot_id,version_number,origin,action_id,basis_json) VALUES(?,?,?,?,?,?,?)')
        .run(message.id, message.runId, slotId, number, version.origin ?? (slot ? 'retry' : 'original'), version.actionId ?? null, version.basis === undefined ? null : JSON.stringify(version.basis));
      if (!slot) this.db.prepare('INSERT INTO message_slots(slot_id,run_id,turn_id,active_message_id,updated_at) VALUES(?,?,?,?,?)').run(slotId, message.runId, message.turnId ?? null, message.id, timestamp);
      else if (version.activate !== false) this.db.prepare('UPDATE message_slots SET active_message_id=?,updated_at=? WHERE slot_id=?').run(message.id, timestamp, slotId);
    }).immediate();
  }

  /** Select one existing version as its slot's effective version; history rows are never rewritten. */
  activateVersion(messageId: string): void {
    this.assertInitialized(); idSchema.parse(messageId);
    const result = this.db.prepare('UPDATE message_slots SET active_message_id=?,updated_at=? WHERE slot_id=(SELECT slot_id FROM message_versions WHERE message_id=?)').run(messageId, now(), messageId);
    if (result.changes !== 1) throw new Error('Message version not found');
  }

  getVersion(messageId: string): VersionRecord | undefined {
    this.assertInitialized(); idSchema.parse(messageId);
    const row = this.db.prepare(`${versionSelect} WHERE v.message_id=?`).get(messageId) as RawVersion | undefined;
    return row ? versionFromRow(row) : undefined;
  }

  listVersions(runId: string): VersionRecord[] {
    this.requireRun(runId);
    return (this.db.prepare(`${versionSelect} WHERE v.run_id=? ORDER BY m.sort_key`).all(runId) as RawVersion[]).map(versionFromRow);
  }

  getHostAction(id: string): HostActionRecord | undefined {
    this.assertInitialized(); idSchema.parse(id);
    const row = this.db.prepare(`${hostActionSelect} WHERE id=?`).get(id) as RawHostAction | undefined;
    return row ? hostActionFromRow(row) : undefined;
  }

  findHostAction(runId: string, clientRequestId: string): HostActionRecord | undefined {
    this.assertInitialized(); idSchema.parse(runId); idSchema.parse(clientRequestId);
    const row = this.db.prepare(`${hostActionSelect} WHERE run_id=? AND client_request_id=?`).get(runId, clientRequestId) as RawHostAction | undefined;
    return row ? hostActionFromRow(row) : undefined;
  }

  listHostActions(runId: string): HostActionRecord[] {
    this.requireRun(runId);
    return (this.db.prepare(`${hostActionSelect} WHERE run_id=? ORDER BY rowid`).all(runId) as RawHostAction[]).map(hostActionFromRow);
  }

  /** D111: continuations of a Run, oldest first; only the latest one can still have members to answer. */
  listContinuations(runId: string): ContinuationRecord[] {
    this.requireRun(runId);
    const rows = this.db.prepare('SELECT action_id AS actionId,run_id AS runId,agent_ids_json AS agentIds,elapsed_base_ms AS elapsedBaseMs,created_at AS createdAt FROM run_continuations WHERE run_id=? ORDER BY created_at,rowid')
      .all(runId) as Array<Omit<ContinuationRecord, 'agentIds'> & { agentIds: string }>;
    return rows.map(row => ({ ...row, agentIds: z.array(idSchema).min(1).max(64).parse(JSON.parse(row.agentIds)) }));
  }

  insertContinuation(continuation: Omit<ContinuationRecord, 'createdAt'>): ContinuationRecord {
    this.assertInitialized();
    const value = z.object({ actionId: idSchema, runId: idSchema, agentIds: z.array(idSchema).min(1).max(64), elapsedBaseMs: sequenceSchema }).strict().parse(continuation);
    return this.transaction(() => {
      this.requireRun(value.runId);
      this.db.prepare('INSERT INTO run_continuations(action_id,run_id,agent_ids_json,elapsed_base_ms,created_at) VALUES(?,?,?,?,?)')
        .run(value.actionId, value.runId, JSON.stringify(value.agentIds), value.elapsedBaseMs, now());
      return this.listContinuations(value.runId).find(item => item.actionId === value.actionId)!;
    });
  }

  getPendingOverride(runId: string): HostActionRecord | undefined {
    this.requireRun(runId);
    const row = this.db.prepare(`${hostActionSelect} WHERE run_id=? AND kind='setOverride' AND status='pending'`).get(runId) as RawHostAction | undefined;
    return row ? hostActionFromRow(row) : undefined;
  }

  insertHostAction(action: Omit<HostActionRecord, 'createdAt' | 'updatedAt' | 'turnId'>): HostActionRecord {
    this.assertInitialized();
    const timestamp = now();
    return this.transaction(() => {
      this.requireRun(action.runId);
      this.db.prepare('INSERT INTO host_actions(id,run_id,client_request_id,kind,status,fingerprint,agent_id,message_id,result_message_id,instruction_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(action.id, action.runId, action.clientRequestId, action.kind, action.status, action.fingerprint, action.agentId ?? null, action.messageId ?? null,
          action.resultMessageId ?? null, action.instructionId ?? null, timestamp, timestamp);
      return this.getHostAction(action.id)!;
    });
  }

  /** Only a pending Override changes status; every other host action is recorded once as applied. */
  settleHostAction(id: string, status: 'superseded' | 'cancelled' | 'expired'): void {
    this.assertInitialized();
    const result = this.db.prepare("UPDATE host_actions SET status=?,updated_at=? WHERE id=? AND status='pending'").run(status, now(), id);
    if (result.changes !== 1) throw new Error('Host action is not pending');
  }

  insertInstructionRevision(revision: Omit<InstructionRevisionRecord, 'createdAt' | 'revision'>): InstructionRevisionRecord {
    this.assertInitialized();
    return this.transaction(() => {
      const owner = this.db.prepare('SELECT run_id FROM host_instruction_revisions WHERE instruction_id=? LIMIT 1').pluck().get(revision.instructionId) as string | undefined;
      if (owner !== undefined && owner !== revision.runId) throw new ContractError('not_found');
      const next = ((this.db.prepare('SELECT MAX(revision) FROM host_instruction_revisions WHERE instruction_id=?').pluck().get(revision.instructionId) as number | null) ?? 0) + 1;
      const createdAt = now();
      this.db.prepare('INSERT INTO host_instruction_revisions(id,run_id,instruction_id,revision,content,action_id,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(revision.id, revision.runId, revision.instructionId, next, revision.content, revision.actionId, createdAt);
      return { ...revision, revision: next, createdAt };
    });
  }

  listInstructionRevisions(runId: string): InstructionRevisionRecord[] {
    this.requireRun(runId);
    return (this.db.prepare('SELECT id,run_id AS runId,instruction_id AS instructionId,revision,content,action_id AS actionId,created_at AS createdAt FROM host_instruction_revisions WHERE run_id=? ORDER BY rowid').all(runId) as InstructionRevisionRecord[]);
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
      provider_request_id AS providerRequestId,created_at AS createdAt,started_at AS startedAt,finished_at AS finishedAt,updated_at AS updatedAt,finish_reason AS finishReason FROM request_attempts WHERE request_id=?`).get(requestId) as (Omit<RequestAttempt,'inputSnapshot'> & {inputSnapshot:string|null}) | undefined;
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

  updateAttempt(requestId: string, patch: {status?: RequestAttempt['status'];providerRequestId?:string;finishReason?:'stop'|'length'}): void {
    const parsed = z.object({status:z.enum(turnStatusValues).optional(),providerRequestId:idSchema.optional(),finishReason:z.enum(['stop','length']).optional()}).strict().parse(patch);
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
      this.db.prepare('UPDATE request_attempts SET status=?,provider_request_id=?,started_at=?,finished_at=?,updated_at=?,finish_reason=? WHERE request_id=?')
        .run(status,parsed.providerRequestId??attempt.providerRequestId,attempt.startedAt??(status==='running'?timestamp:null),attempt.finishedAt??(!['queued','pending','running'].includes(status)?timestamp:null),timestamp,parsed.finishReason??attempt.finishReason??null,requestId);
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
      return {run,turns:this.listTurns(runId),messages:ids.map(id=>this.getMessage(id)!),attempts:this.listAttempts(runId),sequence:this.getRunEventSequence(runId),
        versions:this.listVersions(runId),hostActions:this.listHostActions(runId),instructions:this.listInstructionRevisions(runId),
        usage:this.listRunUsage(runId),summaries:this.listSummaries(runId),continuations:this.listContinuations(runId),
        artifactRequestIds:this.db.prepare('SELECT request_id FROM artifact_requests WHERE run_id=? ORDER BY created_at,rowid').pluck().all(runId) as string[]};
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
    const row = this.db.prepare('SELECT id,room_id AS roomId,display_name AS displayName,role_template_id AS roleTemplateId,provider_id AS providerId,model_id AS modelId,system_prompt AS systemPrompt,enabled,display_order AS displayOrder,archived_at AS archivedAt,configuration_version AS configurationVersion,created_at AS createdAt,updated_at AS updatedAt FROM agents WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return;
    // D096: a stored model ID that looks like an API key is withheld, never returned to the Renderer or used.
    const withheld = typeof row.modelId === 'string' && looksLikeApiKey(row.modelId);
    const { configurationVersion, ...agent } = row;
    // Never configured: listAgents lets it run on the built-in demo, and the page should say so rather than ask for a model.
    const builtInDemo = configurationVersion === 0 && agent.providerId === null && agent.modelId === null;
    return configurationOutput(agentConfigurationSchema, { ...agent, enabled: row.enabled === 1, ...(withheld ? { modelId: null, withheldModelId: true } : {}), ...(builtInDemo ? { builtInDemo: true } : {}) });
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
    // D096: model IDs that look like an API key stay in the row until the next save, but are never returned or used.
    const withheldDefault = typeof row.defaultModelId === 'string' && looksLikeApiKey(row.defaultModelId);
    const kept = Array.isArray(models) ? models.filter((model: { id?: unknown } | null) => !(typeof model?.id === 'string' && looksLikeApiKey(model.id))) : models;
    const withheld = withheldDefault || Array.isArray(models) && (kept as unknown[]).length !== models.length;
    return configurationOutput(providerConfigurationSchema, { ...row, enabled: row.enabled === 1, isDefault: row.isDefault === 1, customModels: kept, keyReference: row.keyReference === null ? null : { id: row.keyReference },
      ...(withheldDefault ? { defaultModelId: null } : {}), ...(withheld ? { withheldModelIds: true } : {}) });
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
    configurationInput(idSchema, providerId); configurationInput(modelIdSchema, modelId);
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

  /** The error of a Run's latest turn_failed event, if it reads as one; older events may not. */
  latestTurnFailure(runId: string): ApiError | undefined {
    this.assertInitialized();
    const payload = this.db.prepare("SELECT payload_json FROM run_events WHERE run_id=? AND type='turn_failed' ORDER BY sequence DESC LIMIT 1").pluck().get(runId) as string | undefined;
    if (!payload) return undefined;
    try { const parsed = apiErrorSchema.safeParse((JSON.parse(payload) as { error?: unknown }).error); return parsed.success ? parsed.data : undefined; } catch { return undefined; }
  }

  /** D143: what the service's own model list said last, if it was ever asked. */
  getModelDiscovery(providerId: string): ModelDiscovery | undefined {
    this.assertInitialized();
    const row = this.db.prepare('SELECT model_ids_json AS ids, outcome, checked_at AS checkedAt, listed_at AS listedAt FROM provider_model_discovery WHERE provider_id=?').get(providerId) as { ids: string; outcome: ModelDiscovery['outcome']; checkedAt: string; listedAt: string | null } | undefined;
    if (!row) return undefined;
    let ids: unknown;
    try { ids = JSON.parse(row.ids); } catch { ids = []; }
    return { modelIds: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [], outcome: row.outcome, checkedAt: row.checkedAt, listedAt: row.listedAt };
  }
  /** A list that could not be read keeps the one before it. */
  saveModelDiscovery(providerId: string, outcome: ModelDiscovery['outcome'], modelIds?: readonly string[]): void {
    this.assertInitialized();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO provider_model_discovery(provider_id,model_ids_json,outcome,checked_at,listed_at) VALUES(?,?,?,?,?)
      ON CONFLICT(provider_id) DO UPDATE SET model_ids_json=coalesce(?,model_ids_json), outcome=excluded.outcome, checked_at=excluded.checked_at, listed_at=coalesce(excluded.listed_at,listed_at)`)
      .run(providerId, JSON.stringify(modelIds ?? []), outcome, now, modelIds ? now : null, modelIds ? JSON.stringify(modelIds) : null);
  }
  clearModelDiscovery(providerId: string): void {
    this.assertInitialized();
    this.db.prepare('DELETE FROM provider_model_discovery WHERE provider_id=?').run(providerId);
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
      // D113: a confirmation names one Key revision; replacing or deleting the Key withdraws it at once.
    });
  }

  /** D113: remembers that the host confirmed sending this Provider's current Key to `baseUrl` as `kind`. */
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

type RawTurn = { id: string; run_id: string; agent_id: string; status: string; request_id: string; turn_index: number; partial_content: string; override_action_id: string | null };
function turnFromRow(row: RawTurn): TurnRecord {
  return { id: row.id, runId: row.run_id, agentId: row.agent_id, status: row.status, requestId: row.request_id, turnIndex: row.turn_index, partialContent: row.partial_content,
    ...(row.override_action_id === null ? {} : { overrideActionId: row.override_action_id }) };
}
const versionSelect = `SELECT v.message_id AS messageId,v.run_id AS runId,v.slot_id AS slotId,s.turn_id AS turnId,v.version_number AS versionNumber,v.origin,
  m.parent_version_id AS parentMessageId,v.action_id AS actionId,v.basis_json AS basis,(s.active_message_id=v.message_id) AS active
  FROM message_versions v JOIN messages m ON m.id=v.message_id JOIN message_slots s ON s.slot_id=v.slot_id`;
type RawVersion = { messageId: string; runId: string; slotId: string; turnId: string | null; versionNumber: number; origin: VersionOrigin; parentMessageId: string | null; actionId: string | null; basis: string | null; active: number };
function versionFromRow(row: RawVersion): VersionRecord {
  return { messageId: row.messageId, runId: row.runId, slotId: row.slotId, versionNumber: row.versionNumber, origin: row.origin, active: row.active === 1,
    basis: row.basis === null ? null : z.array(idSchema).parse(JSON.parse(row.basis)),
    ...(row.turnId === null ? {} : { turnId: row.turnId }), ...(row.parentMessageId === null ? {} : { parentMessageId: row.parentMessageId }),
    ...(row.actionId === null ? {} : { actionId: row.actionId }) };
}
const hostActionSelect = `SELECT id,run_id AS runId,client_request_id AS clientRequestId,kind,status,fingerprint,agent_id AS agentId,message_id AS messageId,
  result_message_id AS resultMessageId,instruction_id AS instructionId,turn_id AS turnId,created_at AS createdAt,updated_at AS updatedAt FROM host_actions`;
type RawHostAction = { [K in keyof HostActionRecord]-?: HostActionRecord[K] extends string ? string : string | null };
function hostActionFromRow(row: RawHostAction): HostActionRecord {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as HostActionRecord;
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

const usageColumns = 'request_id AS requestId,agent_id AS agentId,provider_id AS providerId,model_id AS modelId,kind,state,input_tokens AS inputTokens,output_tokens AS outputTokens,cache_hit_tokens AS cacheHitTokens,created_at AS createdAt,updated_at AS updatedAt';
const summaryRequestSelect = `SELECT request_id AS requestId,summary_id AS summaryId,run_id AS runId,message_id AS messageId,client_request_id AS clientRequestId,agent_id AS agentId,
  status,finish_reason AS finishReason,input_snapshot AS inputSnapshot,created_at AS createdAt FROM summary_requests`;
type RawSummaryRequest = Omit<SummaryRequestRecord, 'inputSnapshot' | 'finishReason'> & { inputSnapshot: string; finishReason: 'stop' | 'length' | null };
function summaryRequestFrom(row: RawSummaryRequest): SummaryRequestRecord {
  const { finishReason, inputSnapshot, ...request } = row;
  return { ...request, inputSnapshot: streamChatInputSchema.parse(JSON.parse(inputSnapshot)), ...(finishReason === null ? {} : { finishReason }) };
}
