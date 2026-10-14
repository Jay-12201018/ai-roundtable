// Published migration 2: append only; migration 1 remains unchanged.
export const migration2 = `
  ALTER TABLE workflow_runs ADD COLUMN task TEXT;
  ALTER TABLE workflow_runs ADD COLUMN members_snapshot TEXT CHECK(members_snapshot IS NULL OR (json_valid(members_snapshot) AND json_type(members_snapshot) = 'array'));
  ALTER TABLE workflow_runs ADD COLUMN next_turn_index INTEGER CHECK(next_turn_index IS NULL OR (typeof(next_turn_index) = 'integer' AND next_turn_index BETWEEN 0 AND 9007199254740991));
  ALTER TABLE workflow_runs ADD COLUMN elapsed_execution_ms INTEGER CHECK(elapsed_execution_ms IS NULL OR (typeof(elapsed_execution_ms) = 'integer' AND elapsed_execution_ms BETWEEN 0 AND 9007199254740991));
  CREATE TABLE request_attempts (
    request_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES workflow_runs(id),
    turn_id TEXT NOT NULL REFERENCES turns(id), message_id TEXT NOT NULL UNIQUE REFERENCES messages(id),
    attempt_index INTEGER NOT NULL CHECK(typeof(attempt_index) = 'integer' AND attempt_index BETWEEN 0 AND 9007199254740991),
    status TEXT NOT NULL CHECK(status IN ('queued','pending','running','completed','failed','aborted','interrupted','cancelled')),
    input_snapshot TEXT CHECK(input_snapshot IS NULL OR (json_valid(input_snapshot) AND json_type(input_snapshot) = 'object')),
    provider_request_id TEXT, created_at TEXT, started_at TEXT, finished_at TEXT, updated_at TEXT,
    UNIQUE(turn_id, attempt_index)
  );
  CREATE TRIGGER attempt_identity_insert BEFORE INSERT ON request_attempts BEGIN
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM turns t JOIN workflow_runs r ON r.id=t.run_id JOIN messages m ON m.id=NEW.message_id
      WHERE t.id=NEW.turn_id AND t.run_id=NEW.run_id AND m.run_id=NEW.run_id AND m.turn_id=NEW.turn_id AND m.room_id=r.room_id
        AND (NEW.attempt_index<>0 OR t.request_id=NEW.request_id)
    ) OR (NEW.input_snapshot IS NOT NULL AND json_extract(NEW.input_snapshot,'$.requestId') IS NOT NEW.request_id)
    THEN RAISE(ABORT,'Invalid Attempt identity') END;
  END;
  CREATE TRIGGER attempt_identity_immutable BEFORE UPDATE OF request_id,run_id,turn_id,message_id,attempt_index,input_snapshot ON request_attempts BEGIN
    SELECT RAISE(ABORT,'Attempt identity and input are immutable');
  END;
  INSERT INTO request_attempts(request_id,run_id,turn_id,message_id,attempt_index,status)
    SELECT t.request_id,t.run_id,t.id,m.id,0,t.status FROM turns t JOIN messages m ON m.turn_id=t.id AND m.run_id=t.run_id
    JOIN workflow_runs r ON r.id=t.run_id AND m.room_id=r.room_id
    WHERE (SELECT COUNT(*) FROM turns x WHERE x.request_id=t.request_id)=1
      AND (SELECT COUNT(*) FROM messages x WHERE x.turn_id=t.id)=1;
  ALTER TABLE run_events ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 0 CHECK(typeof(protocol_version)='integer' AND protocol_version BETWEEN 0 AND 9007199254740991);
  ALTER TABLE run_events ADD COLUMN request_id TEXT REFERENCES request_attempts(request_id);
  ALTER TABLE messages ADD COLUMN sort_key INTEGER;
  UPDATE messages SET sort_key=rowid;
  CREATE UNIQUE INDEX idx_message_sort_key ON messages(sort_key);
  CREATE INDEX idx_messages_run_sort ON messages(run_id,sort_key);
  CREATE INDEX idx_attempts_run_turn ON request_attempts(run_id,turn_id,attempt_index);
  CREATE TABLE persistence_counters(name TEXT PRIMARY KEY,value INTEGER NOT NULL CHECK(value BETWEEN 0 AND 9007199254740991));
  INSERT INTO persistence_counters VALUES('message',COALESCE((SELECT MAX(sort_key) FROM messages),0));
  ALTER TABLE schema_backups ADD COLUMN sha256 TEXT;
  ALTER TABLE schema_backups ADD COLUMN byte_count INTEGER;
  ALTER TABLE schema_backups ADD COLUMN total_pages INTEGER;
  ALTER TABLE schema_backups ADD COLUMN evidence_sha256 TEXT;
  ALTER TABLE schema_backups ADD COLUMN validation_json TEXT;
  ALTER TABLE schema_backups ADD COLUMN verified_at TEXT;
`;
