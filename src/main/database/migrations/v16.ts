// D149: 群聊. Each host message opens a round; its queue is stored so a retry or a restart carries on without asking a model again.
// Scheduling requests are requests like any other, so their usage goes in request_usage under a new kind. SQLite cannot change a
// CHECK, so that one table is rebuilt row for row, in order, with the same rules. Nothing else is touched, and existing rows keep
// their meaning. A Run without the group-chat marker never gets a row here.
export const migration16 = `
CREATE TABLE group_chat_rounds (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  message_id TEXT REFERENCES messages(id),
  classification TEXT NOT NULL CHECK(classification IN ('mention','gather','simple','open')),
  state TEXT NOT NULL CHECK(state IN ('open','done','superseded','stopped','limit')),
  schedule_more INTEGER NOT NULL CHECK(schedule_more IN (0,1)),
  batch_start INTEGER NOT NULL DEFAULT 0 CHECK(typeof(batch_start)='integer' AND batch_start >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_group_chat_open_round ON group_chat_rounds(run_id) WHERE state='open';
CREATE INDEX idx_group_chat_rounds_run ON group_chat_rounds(run_id, created_at);
CREATE TRIGGER group_chat_round_state BEFORE UPDATE OF state ON group_chat_rounds WHEN NEW.state <> OLD.state BEGIN
  SELECT CASE WHEN OLD.state <> 'open' THEN RAISE(ABORT,'A closed round stays closed') END;
END;
CREATE TRIGGER group_chat_round_identity BEFORE UPDATE OF id,run_id,message_id,classification,created_at ON group_chat_rounds BEGIN
  SELECT RAISE(ABORT,'Round identity is immutable');
END;
CREATE TRIGGER group_chat_round_no_delete BEFORE DELETE ON group_chat_rounds BEGIN
  SELECT RAISE(ABORT,'Rounds are append-only');
END;

CREATE TABLE group_chat_speakers (
  round_id TEXT NOT NULL REFERENCES group_chat_rounds(id),
  position INTEGER NOT NULL CHECK(typeof(position)='integer' AND position >= 0),
  agent_id TEXT NOT NULL,
  intent TEXT NOT NULL CHECK(intent IN ('reply','claim','report','challenge','propose_merge','summarize')),
  length TEXT NOT NULL CHECK(length IN ('short','medium','long')),
  source TEXT NOT NULL CHECK(source IN ('mention','gather','rule','schedule','hint')),
  assignment TEXT,
  state TEXT NOT NULL CHECK(state IN ('queued','started','dropped')),
  turn_id TEXT REFERENCES turns(id),
  PRIMARY KEY(round_id, position),
  CHECK((state='started') = (turn_id IS NOT NULL))
);
CREATE UNIQUE INDEX idx_group_chat_speaker_turn ON group_chat_speakers(turn_id) WHERE turn_id IS NOT NULL;
CREATE TRIGGER group_chat_speaker_state BEFORE UPDATE OF state ON group_chat_speakers WHEN NEW.state <> OLD.state BEGIN
  SELECT CASE WHEN OLD.state <> 'queued' THEN RAISE(ABORT,'A speaker leaves the queue once') END;
END;
CREATE TRIGGER group_chat_speaker_no_delete BEFORE DELETE ON group_chat_speakers BEGIN
  SELECT RAISE(ABORT,'Speakers are append-only');
END;

CREATE TABLE group_chat_schedule_requests (
  request_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  round_id TEXT NOT NULL REFERENCES group_chat_rounds(id),
  agent_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('generating','completed','invalid','failed','aborted','interrupted')),
  input_snapshot TEXT NOT NULL CHECK(json_valid(input_snapshot)),
  output_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_group_chat_schedule_round ON group_chat_schedule_requests(round_id, created_at);
CREATE INDEX idx_group_chat_schedule_run ON group_chat_schedule_requests(run_id, created_at);
CREATE TRIGGER group_chat_schedule_identity BEFORE UPDATE OF request_id,run_id,round_id,agent_id,provider_id,model_id,input_snapshot,created_at ON group_chat_schedule_requests BEGIN
  SELECT RAISE(ABORT,'Schedule request identity is immutable');
END;
CREATE TRIGGER group_chat_schedule_close_once BEFORE UPDATE OF status ON group_chat_schedule_requests WHEN NEW.status <> OLD.status BEGIN
  SELECT CASE WHEN OLD.status <> 'generating' THEN RAISE(ABORT,'A schedule request closes once') END;
END;
CREATE TRIGGER group_chat_schedule_no_delete BEFORE DELETE ON group_chat_schedule_requests BEGIN
  SELECT RAISE(ABORT,'Schedule requests are append-only');
END;

DROP TRIGGER request_usage_insert;
DROP TRIGGER request_usage_identity_immutable;
DROP TRIGGER request_usage_close_once;
DROP TRIGGER request_usage_result_once;
DROP TRIGGER request_usage_no_delete;
DROP INDEX idx_request_usage_run;
DROP INDEX idx_request_usage_created;
ALTER TABLE request_usage RENAME TO request_usage_before_v16;
CREATE TABLE request_usage (
  request_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  agent_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('turn','summary','artifact','schedule')),
  state TEXT NOT NULL CHECK(state IN ('in_flight','reported','unknown','not_sent')),
  input_tokens INTEGER CHECK(input_tokens IS NULL OR (typeof(input_tokens)='integer' AND input_tokens >= 0)),
  output_tokens INTEGER CHECK(output_tokens IS NULL OR (typeof(output_tokens)='integer' AND output_tokens >= 0)),
  cache_hit_tokens INTEGER CHECK(cache_hit_tokens IS NULL OR (typeof(cache_hit_tokens)='integer' AND cache_hit_tokens >= 0 AND input_tokens IS NOT NULL AND cache_hit_tokens <= input_tokens)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(state <> 'reported' OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL)),
  CHECK(state <> 'not_sent' OR (input_tokens IS NULL AND output_tokens IS NULL))
);
INSERT INTO request_usage(rowid,request_id,run_id,agent_id,provider_id,model_id,kind,state,input_tokens,output_tokens,cache_hit_tokens,created_at,updated_at)
  SELECT rowid,request_id,run_id,agent_id,provider_id,model_id,kind,state,input_tokens,output_tokens,cache_hit_tokens,created_at,updated_at FROM request_usage_before_v16 ORDER BY rowid;
DROP TABLE request_usage_before_v16;
CREATE INDEX idx_request_usage_run ON request_usage(run_id, created_at);
CREATE INDEX idx_request_usage_created ON request_usage(created_at);
CREATE TRIGGER request_usage_insert BEFORE INSERT ON request_usage BEGIN
  SELECT CASE WHEN NEW.state <> 'in_flight'
    OR (NEW.kind='turn' AND NOT EXISTS(SELECT 1 FROM request_attempts a JOIN turns t ON t.id=a.turn_id WHERE a.request_id=NEW.request_id AND a.run_id=NEW.run_id AND t.agent_id=NEW.agent_id))
    OR (NEW.kind='summary' AND NOT EXISTS(SELECT 1 FROM summary_requests r WHERE r.request_id=NEW.request_id AND r.run_id=NEW.run_id AND r.agent_id=NEW.agent_id))
    OR (NEW.kind='artifact' AND NOT EXISTS(SELECT 1 FROM artifact_requests r WHERE r.request_id=NEW.request_id AND r.run_id=NEW.run_id AND r.agent_id=NEW.agent_id))
    OR (NEW.kind='schedule' AND NOT EXISTS(SELECT 1 FROM group_chat_schedule_requests r WHERE r.request_id=NEW.request_id AND r.run_id=NEW.run_id AND r.agent_id=NEW.agent_id))
  THEN RAISE(ABORT,'Invalid usage identity') END;
END;
CREATE TRIGGER request_usage_identity_immutable BEFORE UPDATE OF request_id,run_id,agent_id,provider_id,model_id,kind,created_at ON request_usage BEGIN
  SELECT RAISE(ABORT,'Usage identity is immutable');
END;
CREATE TRIGGER request_usage_close_once BEFORE UPDATE OF state ON request_usage BEGIN
  SELECT CASE WHEN OLD.state <> 'in_flight' OR NEW.state NOT IN ('reported','unknown','not_sent') THEN RAISE(ABORT,'Invalid usage transition') END;
END;
CREATE TRIGGER request_usage_result_once BEFORE UPDATE OF input_tokens,output_tokens,cache_hit_tokens ON request_usage WHEN OLD.state <> 'in_flight' BEGIN
  SELECT RAISE(ABORT,'Closed usage is immutable');
END;
CREATE TRIGGER request_usage_no_delete BEFORE DELETE ON request_usage BEGIN
  SELECT RAISE(ABORT,'Usage is append-only');
END;
`;
