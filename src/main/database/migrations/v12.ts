// R14 (D118–D123): structured artifacts. Migrations 1–11 remain unchanged; no earlier table changes. The only earlier
// objects touched are the two ledger cross-check triggers of migration 9, recreated here so that pricing and
// write-offs also accept artifact requests (same rules, one more ledger table in the union).
export const migration12 = `
-- One artifact per (Run, kind of document the host asked for). Its room is the Run's room.
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  room_id TEXT NOT NULL REFERENCES rooms(id),
  kind TEXT NOT NULL CHECK(kind IN ('prd','minutes','actions','code')),
  client_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, client_request_id)
);
CREATE INDEX idx_artifacts_run ON artifacts(run_id, created_at);
CREATE TRIGGER artifact_insert BEFORE INSERT ON artifacts BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM workflow_runs r WHERE r.id=NEW.run_id AND r.room_id=NEW.room_id)
  THEN RAISE(ABORT,'Invalid artifact identity') END;
END;
CREATE TRIGGER artifact_immutable BEFORE UPDATE ON artifacts BEGIN
  SELECT RAISE(ABORT,'Artifacts are immutable');
END;
CREATE TRIGGER artifact_no_delete BEFORE DELETE ON artifacts BEGIN
  SELECT RAISE(ABORT,'Artifacts are append-only');
END;

-- Every generation, regeneration and host edit is a new version; older versions are never changed. A generated
-- version streams into raw_output while pending, then is validated exactly once: content_json holds the normalized
-- valid document, issues_json the field-located problems. Raw output is always kept as received.
CREATE TABLE artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  version_number INTEGER NOT NULL CHECK(typeof(version_number)='integer' AND version_number >= 1),
  origin TEXT NOT NULL CHECK(origin IN ('generate','regenerate','edit')),
  parent_version_id TEXT REFERENCES artifact_versions(id),
  client_request_id TEXT NOT NULL,
  agent_id TEXT,
  validation TEXT NOT NULL CHECK(validation IN ('pending','valid','invalid')),
  raw_output TEXT NOT NULL CHECK(length(raw_output) <= 1000000),
  content_json TEXT CHECK(content_json IS NULL OR (json_valid(content_json) AND json_type(content_json)='object')),
  issues_json TEXT CHECK(issues_json IS NULL OR (json_valid(issues_json) AND json_type(issues_json)='array' AND json_array_length(issues_json) >= 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(artifact_id, version_number),
  UNIQUE(run_id, client_request_id),
  CHECK((validation='valid') = (content_json IS NOT NULL)),
  CHECK((validation='invalid') = (issues_json IS NOT NULL)),
  CHECK(origin <> 'edit' OR (validation='valid' AND agent_id IS NULL AND parent_version_id IS NOT NULL)),
  CHECK(origin = 'edit' OR agent_id IS NOT NULL),
  CHECK(origin <> 'generate' OR (version_number=1 AND parent_version_id IS NULL))
);
CREATE INDEX idx_artifact_versions_artifact ON artifact_versions(artifact_id, version_number);
CREATE TRIGGER artifact_version_insert BEFORE INSERT ON artifact_versions BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM artifacts a WHERE a.id=NEW.artifact_id AND a.run_id=NEW.run_id)
    OR NEW.version_number <> COALESCE((SELECT MAX(version_number) FROM artifact_versions WHERE artifact_id=NEW.artifact_id), 0) + 1
    OR (NEW.origin <> 'edit' AND NEW.validation <> 'pending')
    OR (NEW.parent_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM artifact_versions p WHERE p.id=NEW.parent_version_id AND p.artifact_id=NEW.artifact_id))
  THEN RAISE(ABORT,'Invalid artifact version') END;
END;
CREATE TRIGGER artifact_version_identity_immutable BEFORE UPDATE OF id,artifact_id,run_id,version_number,origin,parent_version_id,client_request_id,agent_id,created_at ON artifact_versions BEGIN
  SELECT RAISE(ABORT,'Artifact version identity is immutable');
END;
CREATE TRIGGER artifact_version_output_once BEFORE UPDATE OF raw_output,validation,content_json,issues_json ON artifact_versions BEGIN
  -- Output grows only while its request streams; it is validated only after the request completed.
  SELECT CASE WHEN OLD.validation <> 'pending'
    OR (NEW.raw_output IS NOT OLD.raw_output AND NOT EXISTS(SELECT 1 FROM artifact_requests r WHERE r.version_id=OLD.id AND r.status='generating'))
    OR (NEW.validation <> 'pending' AND NOT EXISTS(SELECT 1 FROM artifact_requests r WHERE r.version_id=OLD.id AND r.status='completed'))
  THEN RAISE(ABORT,'Validated artifact versions are immutable') END;
END;
CREATE TRIGGER artifact_version_no_delete BEFORE DELETE ON artifact_versions BEGIN
  SELECT RAISE(ABORT,'Artifact versions are append-only');
END;

-- D121: the message versions a version is based on; only completed public or summary messages of the same Run.
CREATE TABLE artifact_sources (
  version_id TEXT NOT NULL REFERENCES artifact_versions(id),
  message_id TEXT NOT NULL REFERENCES messages(id),
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  position INTEGER NOT NULL CHECK(typeof(position)='integer' AND position >= 0),
  PRIMARY KEY(version_id, message_id)
);
CREATE TRIGGER artifact_source_insert BEFORE INSERT ON artifact_sources BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM artifact_versions v WHERE v.id=NEW.version_id AND v.run_id=NEW.run_id)
    OR NOT EXISTS(SELECT 1 FROM messages m JOIN message_versions mv ON mv.message_id=m.id
      WHERE m.id=NEW.message_id AND m.run_id=NEW.run_id AND mv.run_id=NEW.run_id AND m.status='completed' AND m.sender_type IN ('agent','user','system'))
  THEN RAISE(ABORT,'Invalid artifact source') END;
END;
CREATE TRIGGER artifact_source_immutable BEFORE UPDATE ON artifact_sources BEGIN
  SELECT RAISE(ABORT,'Artifact sources are immutable');
END;
CREATE TRIGGER artifact_source_no_delete BEFORE DELETE ON artifact_sources BEGIN
  SELECT RAISE(ABORT,'Artifact sources are append-only');
END;

-- A generated version's request. It has no Turn, so its ledger row lives in artifact_charges (D120).
CREATE TABLE artifact_requests (
  request_id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL UNIQUE REFERENCES artifact_versions(id),
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('generating','completed','failed','aborted','interrupted')),
  finish_reason TEXT CHECK(finish_reason IS NULL OR (finish_reason IN ('stop','length') AND status='completed')),
  input_snapshot TEXT NOT NULL CHECK(json_valid(input_snapshot) AND json_type(input_snapshot)='object' AND json_extract(input_snapshot,'$.requestId')=request_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_artifact_requests_run ON artifact_requests(run_id, created_at);
CREATE TRIGGER artifact_request_insert BEFORE INSERT ON artifact_requests BEGIN
  SELECT CASE WHEN NEW.status <> 'generating'
    OR NOT EXISTS(SELECT 1 FROM artifact_versions v WHERE v.id=NEW.version_id AND v.run_id=NEW.run_id AND v.agent_id=NEW.agent_id AND v.origin <> 'edit' AND v.validation='pending')
  THEN RAISE(ABORT,'Invalid artifact request identity') END;
END;
CREATE TRIGGER artifact_request_identity_immutable BEFORE UPDATE OF request_id,version_id,run_id,agent_id,input_snapshot,created_at ON artifact_requests BEGIN
  SELECT RAISE(ABORT,'Artifact request identity is immutable');
END;
CREATE TRIGGER artifact_request_finish_once BEFORE UPDATE OF status,finish_reason ON artifact_requests BEGIN
  SELECT CASE WHEN OLD.status <> 'generating' OR NEW.status = 'generating' THEN RAISE(ABORT,'Invalid artifact request transition') END;
END;
CREATE TRIGGER artifact_request_no_delete BEFORE DELETE ON artifact_requests BEGIN
  SELECT RAISE(ABORT,'Artifact requests are append-only');
END;

CREATE TABLE artifact_charges (
  request_id TEXT PRIMARY KEY REFERENCES artifact_requests(request_id),
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency IN ('CNY','USD')),
  state TEXT NOT NULL CHECK(state IN ('reserved','settled','unknown','not_sent')),
  input_token_bound INTEGER NOT NULL CHECK(typeof(input_token_bound)='integer' AND input_token_bound >= 0),
  output_token_limit INTEGER NOT NULL CHECK(typeof(output_token_limit)='integer' AND output_token_limit >= 0),
  input_micro_per_token INTEGER NOT NULL CHECK(typeof(input_micro_per_token)='integer' AND input_micro_per_token >= 0),
  output_micro_per_token INTEGER NOT NULL CHECK(typeof(output_micro_per_token)='integer' AND output_micro_per_token >= 0),
  reserved_micro INTEGER NOT NULL CHECK(typeof(reserved_micro)='integer' AND reserved_micro = input_token_bound * input_micro_per_token + output_token_limit * output_micro_per_token),
  input_tokens INTEGER CHECK(input_tokens IS NULL OR (typeof(input_tokens)='integer' AND input_tokens >= 0)),
  output_tokens INTEGER CHECK(output_tokens IS NULL OR (typeof(output_tokens)='integer' AND output_tokens >= 0)),
  accounted_micro INTEGER CHECK(accounted_micro IS NULL OR typeof(accounted_micro)='integer'),
  price_evidence TEXT NOT NULL CHECK(length(price_evidence) > 0),
  price_reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(currency = 'CNY' OR (input_micro_per_token = 0 AND output_micro_per_token = 0)),
  CHECK((state = 'settled') = (accounted_micro IS NOT NULL)),
  CHECK(state <> 'settled' OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL
    AND accounted_micro = input_tokens * input_micro_per_token + output_tokens * output_micro_per_token)),
  CHECK(state <> 'not_sent' OR (input_tokens IS NULL AND output_tokens IS NULL))
);
CREATE INDEX idx_artifact_charges_run ON artifact_charges(run_id, created_at);
CREATE TRIGGER artifact_charge_identity_insert BEFORE INSERT ON artifact_charges BEGIN
  SELECT CASE WHEN NEW.state <> 'reserved'
    OR NOT EXISTS(SELECT 1 FROM artifact_requests r WHERE r.request_id = NEW.request_id AND r.run_id = NEW.run_id)
  THEN RAISE(ABORT,'Invalid charge identity') END;
END;
CREATE TRIGGER artifact_charge_identity_immutable BEFORE UPDATE OF request_id,run_id,provider_id,model_id,currency,input_token_bound,output_token_limit,input_micro_per_token,output_micro_per_token,reserved_micro,price_evidence,price_reviewed_at,created_at ON artifact_charges BEGIN
  SELECT RAISE(ABORT,'Charge identity and price are immutable');
END;
CREATE TRIGGER artifact_charge_settle_once BEFORE UPDATE OF state ON artifact_charges BEGIN
  SELECT CASE WHEN OLD.state <> 'reserved' OR NEW.state NOT IN ('settled','unknown','not_sent') THEN RAISE(ABORT,'Invalid charge transition') END;
END;
CREATE TRIGGER artifact_charge_result_once BEFORE UPDATE OF input_tokens,output_tokens,accounted_micro ON artifact_charges WHEN OLD.state <> 'reserved' BEGIN
  SELECT RAISE(ABORT,'Settled charges are immutable');
END;
CREATE TRIGGER artifact_charge_no_delete BEFORE DELETE ON artifact_charges BEGIN
  SELECT RAISE(ABORT,'Charges are append-only');
END;

-- D122: a model's valid version becomes effective only when the host adopts it; a host edit is adopted by its author.
CREATE TABLE artifact_adoptions (
  version_id TEXT PRIMARY KEY REFERENCES artifact_versions(id),
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  client_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, client_request_id)
);
CREATE TRIGGER artifact_adoption_insert BEFORE INSERT ON artifact_adoptions BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM artifact_versions v WHERE v.id=NEW.version_id AND v.run_id=NEW.run_id AND v.validation='valid' AND v.origin <> 'edit')
  THEN RAISE(ABORT,'Invalid artifact adoption') END;
END;
CREATE TRIGGER artifact_adoption_immutable BEFORE UPDATE ON artifact_adoptions BEGIN
  SELECT RAISE(ABORT,'Artifact adoptions are append-only');
END;
CREATE TRIGGER artifact_adoption_no_delete BEFORE DELETE ON artifact_adoptions BEGIN
  SELECT RAISE(ABORT,'Artifact adoptions are append-only');
END;

-- Each copy or save of an effective version. Saving to a file never applies to a code candidate (writing code is R15).
CREATE TABLE artifact_exports (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES artifact_versions(id),
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  client_request_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('markdown','json')),
  target TEXT NOT NULL CHECK(target IN ('clipboard','file')),
  file_name TEXT CHECK(file_name IS NULL OR length(file_name) BETWEEN 1 AND 260),
  created_at TEXT NOT NULL,
  UNIQUE(run_id, client_request_id),
  CHECK((target = 'file') = (file_name IS NOT NULL))
);
CREATE INDEX idx_artifact_exports_version ON artifact_exports(version_id, created_at);
CREATE TRIGGER artifact_export_insert BEFORE INSERT ON artifact_exports BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM artifact_versions v JOIN artifacts a ON a.id=v.artifact_id
      WHERE v.id=NEW.version_id AND v.run_id=NEW.run_id AND v.validation='valid'
        AND (v.origin='edit' OR EXISTS(SELECT 1 FROM artifact_adoptions d WHERE d.version_id=v.id))
        AND (NEW.target <> 'file' OR a.kind <> 'code'))
  THEN RAISE(ABORT,'Invalid artifact export') END;
END;
CREATE TRIGGER artifact_export_immutable BEFORE UPDATE ON artifact_exports BEGIN
  SELECT RAISE(ABORT,'Artifact exports are append-only');
END;
CREATE TRIGGER artifact_export_no_delete BEFORE DELETE ON artifact_exports BEGIN
  SELECT RAISE(ABORT,'Artifact exports are append-only');
END;

-- Migration 9's cross-checks, with artifact requests added to the ledger they look at; the rules are unchanged.
DROP TRIGGER charge_pricing_insert;
CREATE TRIGGER charge_pricing_insert BEFORE INSERT ON charge_pricing BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM (SELECT request_id,run_id,state,input_tokens,output_tokens,accounted_micro FROM request_charges
      UNION ALL SELECT request_id,run_id,state,input_tokens,output_tokens,accounted_micro FROM summary_charges
      UNION ALL SELECT request_id,run_id,state,input_tokens,output_tokens,accounted_micro FROM artifact_charges) c
    WHERE c.request_id=NEW.request_id AND c.run_id=NEW.run_id AND c.state='settled'
      AND COALESCE(NEW.cache_hit_tokens,0) <= c.input_tokens AND NEW.amount_micro <= c.accounted_micro
      AND NEW.amount_micro * 1000000 >= COALESCE(NEW.cache_hit_tokens,0) * NEW.cache_hit_micro_per_million
        + (c.input_tokens - COALESCE(NEW.cache_hit_tokens,0)) * NEW.cache_miss_micro_per_million + c.output_tokens * NEW.output_micro_per_million
      AND NEW.amount_micro * 1000000 - (COALESCE(NEW.cache_hit_tokens,0) * NEW.cache_hit_micro_per_million
        + (c.input_tokens - COALESCE(NEW.cache_hit_tokens,0)) * NEW.cache_miss_micro_per_million + c.output_tokens * NEW.output_micro_per_million) < 1000000)
  THEN RAISE(ABORT,'Invalid charge pricing') END;
END;
DROP TRIGGER charge_writeoff_insert;
CREATE TRIGGER charge_writeoff_insert BEFORE INSERT ON charge_writeoffs BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM (SELECT request_id,run_id,state,currency,reserved_micro FROM request_charges
      UNION ALL SELECT request_id,run_id,state,currency,reserved_micro FROM summary_charges
      UNION ALL SELECT request_id,run_id,state,currency,reserved_micro FROM artifact_charges) c
    WHERE c.request_id=NEW.request_id AND c.run_id=NEW.run_id AND c.state='unknown' AND c.currency='CNY' AND NEW.amount_micro <= c.reserved_micro)
  THEN RAISE(ABORT,'Invalid charge write-off') END;
END;
`;
