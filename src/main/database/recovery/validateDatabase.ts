import type Sqlite from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { messageStatusValues, runStatusValues, turnStatusValues } from '../../../shared/types/run';
import { requestAttemptSchema,executionMetadataSchema } from '../../../shared/schemas/persistence';
import { timestampSchema } from '../../../shared/schemas/common';
import { providerModelSchema } from '../../../shared/schemas/provider';
import { runEventSchema } from '../../../shared/schemas/run';
import { trialRecordSchema } from '../../providers/controlledTrial/record';
import { reconciliationAuditSchema } from '../../providers/controlledTrial/reconciliation';
import { budgetBlockSchema, requestChargeSchema } from '../../../shared/schemas/budget';
import { artifactContentSchemas, artifactIssueSchema, artifactKindSchema, artifactNothingKinds } from '../../../shared/schemas/artifact';
import { streamChatInputSchema } from '../../../shared/schemas/provider';

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
    const modern = (versions.at(-1)??0)>=2;
    const reconciliations = (versions.at(-1) ?? 0) >= 5;
    if ((versions.at(-1) ?? 0) >= 4) {
      if (!tables.includes('controlled_trials')) throw new Error('Recovery v4 schema is incomplete');
      const unresolvedIndex = db.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name='idx_controlled_trial_unresolved'").pluck().get() as string | undefined;
      if (unresolvedIndex?.replace(/\s+/gu, '').toLowerCase().replace(/;$/u, '') !== "createuniqueindexidx_controlled_trial_unresolvedoncontrolled_trials((1))wherestatein('reserved','unknown')" + (reconciliations ? "andreservation_released=0" : "")) throw new Error('Missing trial reservation uniqueness');
      const indexes = db.prepare("PRAGMA index_list('controlled_trials')").all() as Array<{ name: string; unique: number; partial: number }>;
      if (!indexes.some(index => index.unique === 1 && index.partial === 0 && JSON.stringify((db.prepare(`PRAGMA index_info("${index.name.replaceAll('"', '""')}")`).all() as Array<{ name: string }>).map(column => column.name)) === '["request_id"]')) throw new Error('Missing trial request identity uniqueness');
      const unresolved = db.prepare("SELECT COUNT(*) FROM controlled_trials WHERE state IN ('reserved','unknown')" + (reconciliations ? ' AND reservation_released=0' : '')).pluck().get() as number;
      if (unresolved > 1) throw new Error('Multiple unresolved trial reservations');
      for (const row of db.prepare('SELECT id,request_id,provider_id,state,data_json FROM controlled_trials').all() as Array<{ id: string; request_id: string; provider_id: string; state: string; data_json: string }>) {
        const value = trialRecordSchema.parse(JSON.parse(row.data_json));
        if (value.id !== row.id || value.requestId !== row.request_id || value.providerId !== row.provider_id || value.state !== row.state) throw new Error('Trial reservation identity mismatch');
      }
    }
    if (reconciliations) {
      if (!tables.includes('controlled_trial_reconciliations')) throw new Error('Recovery v5 schema is incomplete');
      for (const action of ['update', 'delete']) {
        const name = `prevent_trial_reconciliation_${action}`;
        const trigger = db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").pluck().get(name) as string | undefined;
        const expected = `CREATE TRIGGER ${name} BEFORE ${action.toUpperCase()} ON controlled_trial_reconciliations BEGIN SELECT RAISE(ABORT,'Reconciliation audits are append-only'); END`;
        if (trigger?.replace(/\s+/gu, '').toLowerCase().replace(/;$/u, '') !== expected.replace(/\s+/gu, '').toLowerCase()) throw new Error('Missing immutable reconciliation audit protection');
      }
      const releaseIndex = db.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name='idx_controlled_trial_release'").pluck().get() as string | undefined;
      if (releaseIndex?.replace(/\s+/gu, '').toLowerCase().replace(/;$/u, '') !== "createuniqueindexidx_controlled_trial_releaseoncontrolled_trial_reconciliations(trial_id)wheredecision='release_reservation'") throw new Error('Missing reconciliation release uniqueness');
      assertNoRows(db, "SELECT 1 FROM controlled_trials WHERE typeof(reservation_released)<>'integer' OR reservation_released NOT IN (0,1) OR (reservation_released=1 AND state<>'unknown') LIMIT 1", 'Invalid trial release marker');
      for (const row of db.prepare('SELECT id,trial_id,decision,reviewed_at,data_json FROM controlled_trial_reconciliations').all() as Array<{ id: string; trial_id: string; decision: string; reviewed_at: string; data_json: string }>) {
        const value = reconciliationAuditSchema.parse(JSON.parse(row.data_json));
        const original = db.prepare('SELECT data_json FROM controlled_trials WHERE id=?').pluck().get(value.trialId) as string | undefined;
        if (!original) throw new Error('Missing reconciled trial');
        const trial = trialRecordSchema.parse(JSON.parse(original));
        if (value.id !== row.id || value.trialId !== row.trial_id || value.decision !== row.decision || value.reviewedAt !== row.reviewed_at || trial.state !== 'unknown' || value.requestId !== trial.requestId || value.providerId !== trial.providerId || value.keyRevision !== trial.keyRevision) throw new Error('Reconciliation audit identity mismatch');
      }
      assertNoRows(db, "SELECT 1 FROM controlled_trials t WHERE t.reservation_released <> EXISTS(SELECT 1 FROM controlled_trial_reconciliations a WHERE a.trial_id=t.id AND a.decision='release_reservation') LIMIT 1", 'Trial release is missing explicit reconciliation evidence');
    }
    if ((versions.at(-1) ?? 0) >= 3) {
      for (const [table, required] of Object.entries({ rooms: ['archived_at'], agents: ['archived_at','configuration_version'], providers: ['is_default','default_model_id','custom_models_json','key_revision'] })) {
        const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>).map(c => c.name));
        if (required.some(column => !columns.has(column))) throw new Error('Recovery v3 schema is incomplete');
      }
      assertNoRows(db, "SELECT 1 FROM agents WHERE enabled NOT IN (0,1) OR configuration_version NOT IN (0,1) LIMIT 1", 'Invalid Agent configuration');
      assertNoRows(db, "SELECT 1 FROM providers WHERE enabled NOT IN (0,1) OR is_default NOT IN (0,1) OR (is_default=1 AND enabled<>1) OR typeof(key_revision)<>'text' OR length(key_revision)=0 LIMIT 1", 'Invalid Provider configuration');
      assertNoRows(db, 'SELECT 1 WHERE (SELECT COUNT(*) FROM providers WHERE is_default=1)>1', 'Invalid default Provider');
      assertNoRows(db, "SELECT 1 FROM providers p JOIN key_records k ON k.id=p.api_key_reference WHERE k.provider_id<>p.id LIMIT 1", 'Invalid Provider Key ownership');
      for (const table of ['rooms','agents']) {
        for (const row of db.prepare(`SELECT archived_at FROM ${table} WHERE archived_at IS NOT NULL`).iterate() as Iterable<{archived_at:unknown}>) {
          if (!timestampSchema.safeParse(row.archived_at).success) throw new Error('Invalid archive timestamp');
        }
      }
      for (const row of db.prepare('SELECT custom_models_json FROM providers').iterate() as Iterable<{custom_models_json:string}>) {
        let models: unknown;
        try { models=JSON.parse(row.custom_models_json); } catch { throw new Error('Invalid Provider model JSON'); }
        if (!Array.isArray(models) || models.some(model => !providerModelSchema.safeParse(model).success) || new Set(models.map(model => (model as {id:string}).id)).size!==models.length) throw new Error('Invalid Provider models');
      }
    }

    if (modern && !tables.includes('request_attempts')) throw new Error('Recovery v2 schema is incomplete');

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
      WHERE ${modern?'e.protocol_version=0 AND':''} ((COALESCE(e.turn_id, json_extract(e.payload_json, '$.turnId')) IS NOT NULL AND (t.id IS NULL OR t.run_id <> e.run_id))
      OR (json_type(e.payload_json, '$.turnId') IS NOT NULL AND (t.id IS NULL OR json_extract(e.payload_json, '$.turnId') IS NOT t.id))
      OR (json_type(e.payload_json, '$.requestId') IS NOT NULL AND (t.id IS NULL OR json_extract(e.payload_json, '$.requestId') IS NOT t.request_id))
      OR (json_type(e.payload_json, '$.agentId') IS NOT NULL AND (t.id IS NULL OR json_extract(e.payload_json, '$.agentId') IS NOT t.agent_id))
      OR (json_type(e.payload_json, '$.messageId') IS NOT NULL AND (m.id IS NULL OR m.run_id IS NOT e.run_id OR m.turn_id IS NOT t.id))) LIMIT 1`, 'Invalid event identity');

    if (modern) {
      assertNoRows(db,"SELECT 1 FROM run_events WHERE typeof(protocol_version)<>'integer' OR protocol_version<0 OR protocol_version>9007199254740991 LIMIT 1",'Invalid event protocol');
      assertNoRows(db,`SELECT 1 FROM run_events e LEFT JOIN turns t ON t.id=e.turn_id LEFT JOIN request_attempts a ON a.request_id=e.request_id
        WHERE (e.turn_id IS NOT NULL AND (t.id IS NULL OR t.run_id<>e.run_id)) OR (e.request_id IS NOT NULL AND (a.request_id IS NULL OR a.run_id<>e.run_id OR (e.turn_id IS NOT NULL AND a.turn_id<>e.turn_id))) LIMIT 1`,'Invalid event record identity');
      assertNoRows(db,`SELECT 1 FROM request_attempts a JOIN turns t ON t.id=a.turn_id JOIN messages m ON m.id=a.message_id JOIN workflow_runs r ON r.id=a.run_id
        WHERE t.run_id<>a.run_id OR m.run_id<>a.run_id OR m.turn_id<>a.turn_id OR m.room_id<>r.room_id LIMIT 1`,'Invalid Attempt identity');
      const attempts = db.prepare(`SELECT request_id AS requestId,run_id AS runId,turn_id AS turnId,message_id AS messageId,attempt_index AS attemptIndex,status,input_snapshot AS inputSnapshot,
        provider_request_id AS providerRequestId,created_at AS createdAt,started_at AS startedAt,finished_at AS finishedAt,updated_at AS updatedAt FROM request_attempts`).iterate() as Iterable<Record<string,unknown>>;
      for (const row of attempts) {
        let input: unknown = null;
        try { if(row.inputSnapshot!==null) input=JSON.parse(row.inputSnapshot as string); } catch {throw new Error('Invalid Attempt JSON');}
        if(!requestAttemptSchema.safeParse({...row,inputSnapshot:input}).success) throw new Error('Invalid Attempt evidence');
      }
      const runs=db.prepare(`SELECT task,members_snapshot AS membersSnapshot,next_turn_index AS nextTurnIndex,elapsed_execution_ms AS elapsedExecutionMs,mode,max_turns AS maxTurns,
        max_duration_ms AS maxDurationMs,output_token_limit AS outputTokenLimit,current_turn_id AS currentTurnId,current_agent_id AS currentAgentId,started_at AS startedAt,finished_at AS finishedAt,
        created_at AS createdAt,updated_at AS updatedAt FROM workflow_runs`).iterate() as Iterable<Record<string,unknown>>;
      for(const row of runs) {
        let members:unknown=null;
        try {if(row.membersSnapshot!==null) members=JSON.parse(row.membersSnapshot as string);} catch {throw new Error('Invalid member JSON');}
        if(!executionMetadataSchema.safeParse({...row,membersSnapshot:members}).success) throw new Error('Invalid Run execution metadata');
      }
      assertNoRows(db,"SELECT 1 FROM messages WHERE sort_key IS NULL OR typeof(sort_key)<>'integer' OR sort_key<1 LIMIT 1",'Invalid Message order');
      assertNoRows(db,"SELECT 1 WHERE (SELECT value FROM persistence_counters WHERE name='message') IS NULL OR (SELECT value FROM persistence_counters WHERE name='message')<COALESCE((SELECT MAX(sort_key) FROM messages),0)",'Invalid Message counter');
      const events=db.prepare('SELECT run_id,turn_id,request_id,sequence,type,payload_json,timestamp FROM run_events WHERE protocol_version=1').iterate() as Iterable<{run_id:string;turn_id:string|null;request_id:string|null;sequence:number;type:string;payload_json:string;timestamp:string}>;
      for(const row of events) {
        const result=runEventSchema.safeParse({version:1,runId:row.run_id,turnId:row.turn_id??undefined,requestId:row.request_id??undefined,sequence:row.sequence,type:row.type,payload:JSON.parse(row.payload_json),timestamp:row.timestamp});
        if(!result.success) throw new Error('Invalid v1 event');
        const event=result.data;
        if(event.turnId) {
          const attempt=db.prepare('SELECT run_id AS runId,turn_id AS turnId,message_id AS messageId FROM request_attempts WHERE request_id=?').get(event.requestId) as {runId:string;turnId:string;messageId:string}|undefined;
          const turn=db.prepare('SELECT agent_id FROM turns WHERE id=?').get(event.turnId) as {agent_id:string}|undefined;
          if(!attempt || attempt.runId!==event.runId || attempt.turnId!==event.turnId || !turn || 'messageId' in event.payload && event.payload.messageId!==attempt.messageId || 'agentId' in event.payload && event.payload.agentId!==turn.agent_id) throw new Error('Invalid event Attempt identity');
          if('senderName' in event.payload && event.payload.senderName!==db.prepare('SELECT sender_name FROM messages WHERE id=?').pluck().get(attempt.messageId)) throw new Error('Invalid event sender identity');
        }
      }
    }

    const hash = createHash('sha256');
    const schema = db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type, name').raw().all();
    if ((versions.at(-1) ?? 0) >= 6) {
      for (const table of ['host_actions', 'host_instruction_revisions', 'message_versions', 'message_slots']) if (!tables.includes(table)) throw new Error('Recovery v6 schema is incomplete');
      for (const name of ['host_action_identity_immutable', 'host_action_status_order', 'host_action_no_delete', 'host_instruction_immutable', 'message_version_immutable']) {
        if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name=?").get(name)) throw new Error('Missing host/version history protection');
      }
      assertNoRows(db, "SELECT 1 FROM messages m WHERE m.run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM message_versions v WHERE v.message_id=m.id AND v.run_id=m.run_id) LIMIT 1", 'Message without version record');
      assertNoRows(db, `SELECT 1 FROM message_versions v JOIN messages m ON m.id=v.message_id LEFT JOIN message_slots s ON s.slot_id=v.slot_id
        WHERE s.slot_id IS NULL OR s.run_id<>v.run_id OR (s.turn_id IS NOT m.turn_id) OR (m.turn_id IS NOT NULL AND v.slot_id<>m.turn_id)
          OR (m.parent_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM message_versions p WHERE p.message_id=m.parent_version_id AND p.slot_id=v.slot_id)) LIMIT 1`, 'Inconsistent message version chain');
      assertNoRows(db, "SELECT 1 FROM message_slots s WHERE NOT EXISTS(SELECT 1 FROM message_versions v WHERE v.message_id=s.active_message_id AND v.slot_id=s.slot_id) LIMIT 1", 'Invalid active message version');
      assertNoRows(db, `SELECT 1 FROM host_actions a WHERE (a.message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.id=a.message_id AND m.run_id=a.run_id))
        OR (a.turn_id IS NOT NULL AND (a.kind<>'setOverride' OR a.status<>'consumed' OR NOT EXISTS(SELECT 1 FROM turns t WHERE t.id=a.turn_id AND t.run_id=a.run_id AND t.override_action_id=a.id))) LIMIT 1`, 'Invalid host action identity');
      // D111 (v10): a continuation answer references its continuation's interjection instead of a consumed Override.
      const continuation = (versions.at(-1) ?? 0) >= 10 ? ' AND NOT EXISTS(SELECT 1 FROM run_continuations c WHERE c.action_id=t.override_action_id AND c.run_id=t.run_id)' : '';
      assertNoRows(db, `SELECT 1 FROM turns t LEFT JOIN host_actions a ON a.id=t.override_action_id WHERE t.override_action_id IS NOT NULL${continuation} AND (a.id IS NULL OR a.run_id<>t.run_id OR a.turn_id IS NOT t.id OR a.agent_id<>t.agent_id) LIMIT 1`, 'Invalid override Turn');
      assertNoRows(db, "SELECT 1 FROM host_instruction_revisions r JOIN host_actions a ON a.id=r.action_id WHERE a.run_id<>r.run_id OR a.kind NOT IN ('setInstruction','clearInstruction') LIMIT 1", 'Invalid instruction revision');
    }
    if ((versions.at(-1) ?? 0) >= 8) {
      const columns = db.prepare("SELECT name FROM pragma_table_info('request_attempts')").pluck().all() as string[];
      if (!columns.includes('finish_reason') || !db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='request_attempt_finish_once'").get()) throw new Error('Recovery v8 schema is incomplete');
      assertNoRows(db, "SELECT 1 FROM request_attempts WHERE finish_reason IS NOT NULL AND (status<>'completed' OR finish_reason NOT IN ('stop','length')) LIMIT 1", 'Invalid attempt finish reason');
    }
    if ((versions.at(-1) ?? 0) >= 7) {
      for (const table of ['run_budgets', 'request_charges']) if (!tables.includes(table)) throw new Error('Recovery v7 schema is incomplete');
      for (const name of ['run_budget_limit_immutable', 'run_budget_no_delete', 'request_charge_identity_insert', 'request_charge_identity_immutable',
        'request_charge_settle_once', 'request_charge_result_once', 'request_charge_no_delete']) {
        if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name=?").get(name)) throw new Error('Missing budget ledger protection');
      }
      assertNoRows(db, 'SELECT 1 FROM workflow_runs r WHERE NOT EXISTS(SELECT 1 FROM run_budgets b WHERE b.run_id=r.id) LIMIT 1', 'Run without budget');
      assertNoRows(db, 'SELECT 1 FROM request_charges c LEFT JOIN request_attempts a ON a.request_id=c.request_id WHERE a.request_id IS NULL OR a.run_id<>c.run_id LIMIT 1', 'Invalid charge identity');
      for (const row of db.prepare('SELECT blocked_json FROM run_budgets WHERE blocked_json IS NOT NULL').pluck().iterate() as Iterable<string>) {
        if (!budgetBlockSchema.safeParse(JSON.parse(row)).success) throw new Error('Invalid budget block');
      }
      const charges = db.prepare(`SELECT request_id AS requestId,provider_id AS providerId,model_id AS modelId,currency,state,input_token_bound AS inputTokenBound,
        output_token_limit AS outputTokenLimit,input_micro_per_token AS inputMicroPerToken,output_micro_per_token AS outputMicroPerToken,reserved_micro AS reservedMicro,
        input_tokens AS inputTokens,output_tokens AS outputTokens,accounted_micro AS accountedMicro,price_reviewed_at AS priceReviewedAt,created_at AS createdAt,updated_at AS updatedAt FROM request_charges`).iterate() as Iterable<Record<string, unknown>>;
      for (const row of charges) {
        const chargedMicro = row.state === 'settled' ? row.accountedMicro : row.state === 'not_sent' ? 0 : row.reservedMicro;
        if (!requestChargeSchema.safeParse({ ...row, chargedMicro }).success) throw new Error('Invalid charge evidence');
      }
    }
    const artifacts = (versions.at(-1) ?? 0) >= 12;
    // R14: from migration 12 artifact requests are a third ledger table that pricing and write-offs may refer to.
    const artifactCharge = (alias: string, state: string, extra = '') => artifacts
      ? ` AND NOT EXISTS(SELECT 1 FROM artifact_charges c WHERE c.request_id=${alias}.request_id AND c.run_id=${alias}.run_id AND c.state='${state}'${extra})` : '';
    if ((versions.at(-1) ?? 0) >= 9) {
      for (const table of ['run_budget_topups', 'context_summaries', 'summary_requests', 'summary_confirmations', 'summary_charges', 'charge_pricing', 'charge_writeoffs']) {
        if (!tables.includes(table)) throw new Error('Recovery v9 schema is incomplete');
      }
      for (const name of ['run_budget_topup_insert', 'run_budget_topup_immutable', 'run_budget_topup_no_delete', 'context_summary_immutable', 'context_summary_no_delete',
        'summary_request_insert', 'summary_request_identity_immutable', 'summary_request_finish_once', 'summary_request_no_delete', 'summary_confirmation_insert',
        'summary_confirmation_immutable', 'summary_confirmation_no_delete', 'summary_charge_identity_insert', 'summary_charge_identity_immutable', 'summary_charge_settle_once',
        'summary_charge_result_once', 'summary_charge_no_delete', 'charge_pricing_insert', 'charge_pricing_immutable', 'charge_pricing_no_delete',
        'charge_writeoff_insert', 'charge_writeoff_immutable', 'charge_writeoff_no_delete']) {
        if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name=?").get(name)) throw new Error('Missing R13B ledger protection');
      }
      assertNoRows(db, `SELECT 1 FROM context_summaries s LEFT JOIN message_slots m ON m.slot_id=s.id
        WHERE m.slot_id IS NULL OR m.run_id<>s.run_id OR m.turn_id IS NOT NULL LIMIT 1`, 'Summary without its timeline slot');
      assertNoRows(db, `SELECT 1 FROM summary_requests r JOIN messages m ON m.id=r.message_id JOIN message_versions v ON v.message_id=m.id
        WHERE m.sender_type<>'system' OR m.run_id<>r.run_id OR v.slot_id<>r.summary_id LIMIT 1`, 'Invalid summary request identity');
      assertNoRows(db, "SELECT 1 FROM summary_charges c LEFT JOIN summary_requests r ON r.request_id=c.request_id WHERE r.request_id IS NULL OR r.run_id<>c.run_id LIMIT 1", 'Invalid summary charge identity');
      assertNoRows(db, `SELECT 1 FROM charge_pricing p WHERE NOT EXISTS(SELECT 1 FROM request_charges c WHERE c.request_id=p.request_id AND c.run_id=p.run_id AND c.state='settled')
        AND NOT EXISTS(SELECT 1 FROM summary_charges c WHERE c.request_id=p.request_id AND c.run_id=p.run_id AND c.state='settled')${artifactCharge('p', 'settled')} LIMIT 1`, 'Pricing without a settled charge');
      assertNoRows(db, `SELECT 1 FROM charge_writeoffs w WHERE NOT EXISTS(SELECT 1 FROM request_charges c WHERE c.request_id=w.request_id AND c.run_id=w.run_id AND c.state='unknown' AND w.amount_micro<=c.reserved_micro)
        AND NOT EXISTS(SELECT 1 FROM summary_charges c WHERE c.request_id=w.request_id AND c.run_id=w.run_id AND c.state='unknown' AND w.amount_micro<=c.reserved_micro)${artifactCharge('w', 'unknown', ' AND w.amount_micro<=c.reserved_micro')} LIMIT 1`, 'Write-off without an unknown charge');
      assertNoRows(db, `SELECT 1 FROM run_budgets b WHERE b.limit_micro + COALESCE((SELECT SUM(t.amount_micro) FROM run_budget_topups t WHERE t.run_id=b.run_id),0) > 1000000000 LIMIT 1`, 'Run budget above the limit');
      assertChargeEvidence(db, 'summary_charges', 'summary');
    }
    if ((versions.at(-1) ?? 0) >= 10) {
      if (!tables.includes('run_continuations')) throw new Error('Recovery v10 schema is incomplete');
      for (const name of ['run_continuation_insert', 'run_continuation_immutable', 'run_continuation_no_delete']) {
        if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name=?").get(name)) throw new Error('Missing continuation protection');
      }
      assertNoRows(db, `SELECT 1 FROM run_continuations c LEFT JOIN host_actions a ON a.id=c.action_id
        WHERE a.id IS NULL OR a.run_id<>c.run_id OR a.kind<>'interject' LIMIT 1`, 'Invalid continuation identity');
      assertNoRows(db, `SELECT 1 FROM turns t JOIN run_continuations c ON c.action_id=t.override_action_id
        WHERE c.run_id<>t.run_id OR NOT EXISTS(SELECT 1 FROM json_each(c.agent_ids_json) j WHERE j.value=t.agent_id)
          OR (SELECT COUNT(*) FROM turns u WHERE u.override_action_id=c.action_id) > json_array_length(c.agent_ids_json) LIMIT 1`, 'Invalid continuation Turn');
    }
    if ((versions.at(-1) ?? 0) >= 11) {
      if (!tables.includes('provider_target_approvals')) throw new Error('Recovery v11 schema is incomplete');
      // D113: an approval names an existing real Provider of the same kind; a stale Key revision is harmless (unused).
      assertNoRows(db, `SELECT 1 FROM provider_target_approvals a LEFT JOIN providers p ON p.id=a.provider_id
        WHERE p.id IS NULL OR p.type<>a.kind OR a.kind='mock' LIMIT 1`, 'Invalid target approval');
    }
    if (artifacts) {
      for (const table of ['artifacts', 'artifact_versions', 'artifact_sources', 'artifact_requests', 'artifact_charges', 'artifact_adoptions', 'artifact_exports']) {
        if (!tables.includes(table)) throw new Error('Recovery v12 schema is incomplete');
      }
      for (const name of ['artifact_insert', 'artifact_immutable', 'artifact_no_delete', 'artifact_version_insert', 'artifact_version_identity_immutable', 'artifact_version_output_once',
        'artifact_version_no_delete', 'artifact_source_insert', 'artifact_source_immutable', 'artifact_source_no_delete', 'artifact_request_insert', 'artifact_request_identity_immutable',
        'artifact_request_finish_once', 'artifact_request_no_delete', 'artifact_charge_identity_insert', 'artifact_charge_identity_immutable', 'artifact_charge_settle_once',
        'artifact_charge_result_once', 'artifact_charge_no_delete', 'artifact_adoption_insert', 'artifact_adoption_immutable', 'artifact_adoption_no_delete',
        'artifact_export_insert', 'artifact_export_immutable', 'artifact_export_no_delete']) {
        if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name=?").get(name)) throw new Error('Missing R14 artifact protection');
      }
      // The recreated migration 9 cross-checks must also know artifact requests.
      for (const name of ['charge_pricing_insert', 'charge_writeoff_insert']) {
        const sql = db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").pluck().get(name) as string | undefined;
        if (!sql?.includes('FROM artifact_charges')) throw new Error('Missing R14 ledger protection');
      }
      assertNoRows(db, "SELECT 1 FROM artifacts a LEFT JOIN workflow_runs r ON r.id=a.run_id WHERE r.id IS NULL OR r.room_id<>a.room_id LIMIT 1", 'Invalid artifact identity');
      assertNoRows(db, `SELECT 1 FROM artifact_versions v LEFT JOIN artifacts a ON a.id=v.artifact_id LEFT JOIN artifact_versions p ON p.id=v.parent_version_id
        WHERE a.id IS NULL OR a.run_id<>v.run_id OR (v.parent_version_id IS NOT NULL AND (p.id IS NULL OR p.artifact_id<>v.artifact_id OR p.version_number>=v.version_number))
          OR v.version_number <> (SELECT COUNT(*) FROM artifact_versions u WHERE u.artifact_id=v.artifact_id AND u.version_number<=v.version_number) LIMIT 1`, 'Invalid artifact version');
      assertNoRows(db, `SELECT 1 FROM artifact_versions v WHERE v.origin<>'edit' AND NOT EXISTS(SELECT 1 FROM artifact_requests r WHERE r.version_id=v.id) LIMIT 1`, 'Generated artifact version without its request');
      assertNoRows(db, `SELECT 1 FROM artifact_versions v JOIN artifact_requests r ON r.version_id=v.id
        WHERE r.run_id<>v.run_id OR r.agent_id IS NOT v.agent_id OR v.origin='edit' OR (v.validation<>'pending' AND r.status<>'completed') LIMIT 1`, 'Invalid artifact request identity');
      assertNoRows(db, `SELECT 1 FROM artifact_sources s JOIN artifact_versions v ON v.id=s.version_id JOIN messages m ON m.id=s.message_id
        WHERE v.run_id<>s.run_id OR m.run_id<>s.run_id LIMIT 1`, 'Artifact source outside its Run');
      assertNoRows(db, "SELECT 1 FROM artifact_charges c LEFT JOIN artifact_requests r ON r.request_id=c.request_id WHERE r.request_id IS NULL OR r.run_id<>c.run_id LIMIT 1", 'Invalid artifact charge identity');
      assertNoRows(db, `SELECT 1 FROM artifact_adoptions d LEFT JOIN artifact_versions v ON v.id=d.version_id
        WHERE v.id IS NULL OR v.run_id<>d.run_id OR v.validation<>'valid' OR v.origin='edit' LIMIT 1`, 'Invalid artifact adoption');
      assertNoRows(db, `SELECT 1 FROM artifact_exports e LEFT JOIN artifact_versions v ON v.id=e.version_id LEFT JOIN artifacts a ON a.id=v.artifact_id
        WHERE v.id IS NULL OR v.run_id<>e.run_id OR v.validation<>'valid' OR (e.target='file' AND a.kind='code')
          OR (v.origin<>'edit' AND NOT EXISTS(SELECT 1 FROM artifact_adoptions d WHERE d.version_id=v.id)) LIMIT 1`, 'Invalid artifact export');
      for (const row of db.prepare('SELECT a.kind,v.validation,v.content_json AS content,v.issues_json AS issues,v.empty_reason AS empty FROM artifact_versions v JOIN artifacts a ON a.id=v.artifact_id')
        .iterate() as Iterable<{ kind: string; validation: string; content: string | null; issues: string | null; empty: string | null }>) {
        const kind = artifactKindSchema.parse(row.kind);
        // D124: only kinds a discussion may lack can be empty.
        if (row.empty !== null && !artifactNothingKinds.includes(kind)) throw new Error('Invalid empty artifact');
        if (row.content !== null && !artifactContentSchemas[kind].safeParse(JSON.parse(row.content)).success) throw new Error('Invalid artifact content');
        if (row.issues !== null && !(JSON.parse(row.issues) as unknown[]).every(issue => artifactIssueSchema.safeParse(issue).success)) throw new Error('Invalid artifact issues');
      }
      for (const row of db.prepare('SELECT request_id,input_snapshot FROM artifact_requests').iterate() as Iterable<{ request_id: string; input_snapshot: string }>) {
        const input = streamChatInputSchema.safeParse(JSON.parse(row.input_snapshot));
        if (!input.success || input.data.requestId !== row.request_id) throw new Error('Invalid artifact request input');
      }
      assertChargeEvidence(db, 'artifact_charges', 'artifact');
    }
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

/** Every ledger row of a Turn-less request table is a well-formed charge of that kind. */
function assertChargeEvidence(db: Sqlite.Database, table: 'summary_charges' | 'artifact_charges', kind: 'summary' | 'artifact'): void {
  const rows = db.prepare(`SELECT request_id AS requestId,provider_id AS providerId,model_id AS modelId,currency,state,input_token_bound AS inputTokenBound,
    output_token_limit AS outputTokenLimit,input_micro_per_token AS inputMicroPerToken,output_micro_per_token AS outputMicroPerToken,reserved_micro AS reservedMicro,
    input_tokens AS inputTokens,output_tokens AS outputTokens,accounted_micro AS accountedMicro,price_reviewed_at AS priceReviewedAt,created_at AS createdAt,updated_at AS updatedAt FROM ${table}`).iterate() as Iterable<Record<string, unknown>>;
  for (const row of rows) {
    const chargedMicro = row.state === 'settled' ? row.accountedMicro : row.state === 'not_sent' ? 0 : row.reservedMicro;
    if (!requestChargeSchema.safeParse({ ...row, chargedMicro, kind }).success) throw new Error('Invalid charge evidence');
  }
}

function assertNoRows(db: Sqlite.Database, sql: string, message: string): void {
  if (db.prepare(sql).get()) throw new Error(message);
}

function count(db: Sqlite.Database, table: string): number {
  return db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
}
