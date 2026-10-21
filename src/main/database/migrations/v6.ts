// R12 host commands and message versions. Migrations 1–5 remain unchanged; existing rows are only backfilled.
export const migration6 = `
CREATE TABLE host_actions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('interject','setOverride','cancelOverride','setInstruction','clearInstruction','editMessage','regenerateMessage','selectVersion','abortGeneration')),
  status TEXT NOT NULL CHECK(status IN ('applied','pending','consumed','superseded','cancelled','expired')),
  fingerprint TEXT NOT NULL,
  agent_id TEXT,
  message_id TEXT REFERENCES messages(id),
  -- Deferred: an edit records its action before inserting the version that references it.
  result_message_id TEXT REFERENCES messages(id) DEFERRABLE INITIALLY DEFERRED,
  instruction_id TEXT,
  turn_id TEXT REFERENCES turns(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, client_request_id),
  CHECK(kind = 'setOverride' OR status = 'applied')
);
CREATE UNIQUE INDEX idx_host_pending_override ON host_actions(run_id) WHERE kind='setOverride' AND status='pending';
CREATE INDEX idx_host_actions_run ON host_actions(run_id, created_at);
CREATE TRIGGER host_action_identity_immutable BEFORE UPDATE OF id,run_id,client_request_id,kind,fingerprint,agent_id,message_id,result_message_id,instruction_id,created_at ON host_actions BEGIN
  SELECT RAISE(ABORT,'Host action identity is immutable');
END;
CREATE TRIGGER host_action_status_order BEFORE UPDATE OF status ON host_actions BEGIN
  SELECT CASE WHEN OLD.status <> 'pending' OR NEW.status NOT IN ('consumed','superseded','cancelled','expired') THEN RAISE(ABORT,'Invalid host action transition') END;
END;
CREATE TRIGGER host_action_no_delete BEFORE DELETE ON host_actions WHEN EXISTS(SELECT 1 FROM workflow_runs WHERE id=OLD.run_id) BEGIN
  SELECT RAISE(ABORT,'Host actions are append-only');
END;

CREATE TABLE host_instruction_revisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  instruction_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision >= 1),
  content TEXT,
  action_id TEXT NOT NULL UNIQUE REFERENCES host_actions(id),
  created_at TEXT NOT NULL,
  UNIQUE(instruction_id, revision)
);
CREATE INDEX idx_host_instruction_run ON host_instruction_revisions(run_id, instruction_id, revision);
CREATE TRIGGER host_instruction_immutable BEFORE UPDATE ON host_instruction_revisions BEGIN
  SELECT RAISE(ABORT,'Instruction revisions are immutable');
END;

CREATE TABLE message_versions (
  message_id TEXT PRIMARY KEY REFERENCES messages(id),
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK(typeof(version_number)='integer' AND version_number >= 1),
  origin TEXT NOT NULL CHECK(origin IN ('original','retry','continue','regenerate','edit')),
  action_id TEXT REFERENCES host_actions(id),
  basis_json TEXT CHECK(basis_json IS NULL OR (json_valid(basis_json) AND json_type(basis_json)='array')),
  UNIQUE(slot_id, version_number)
);
CREATE TRIGGER message_version_immutable BEFORE UPDATE OF message_id,run_id,slot_id,version_number,origin,action_id ON message_versions BEGIN
  SELECT RAISE(ABORT,'Message version identity is immutable');
END;
CREATE TABLE message_slots (
  slot_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id),
  active_message_id TEXT NOT NULL REFERENCES messages(id),
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_message_slots_run ON message_slots(run_id);
CREATE INDEX idx_message_versions_run ON message_versions(run_id, slot_id, version_number);

ALTER TABLE turns ADD COLUMN override_action_id TEXT REFERENCES host_actions(id);

-- Backfill: each Turn is one slot whose versions are its Attempt messages; other run messages are their own slot.
INSERT INTO message_versions(message_id,run_id,slot_id,version_number,origin)
  SELECT m.id, m.run_id, COALESCE(m.turn_id, m.id),
    ROW_NUMBER() OVER (PARTITION BY COALESCE(m.turn_id, m.id) ORDER BY m.sort_key),
    CASE WHEN ROW_NUMBER() OVER (PARTITION BY COALESCE(m.turn_id, m.id) ORDER BY m.sort_key) = 1 THEN 'original'
      WHEN json_extract(a.input_snapshot,'$.messages[#-1].content') = 'Continue the previous response from where it stopped.' THEN 'continue'
      ELSE 'retry' END
  FROM messages m LEFT JOIN request_attempts a ON a.message_id = m.id
  WHERE m.run_id IS NOT NULL;
UPDATE messages SET parent_version_id = (
  SELECT p.message_id FROM message_versions v JOIN message_versions p ON p.slot_id = v.slot_id AND p.version_number = v.version_number - 1
  WHERE v.message_id = messages.id) WHERE id IN (SELECT message_id FROM message_versions WHERE version_number > 1);
INSERT INTO message_slots(slot_id,run_id,turn_id,active_message_id,updated_at)
  SELECT v.slot_id, v.run_id, (SELECT m.turn_id FROM messages m WHERE m.id = v.slot_id OR m.turn_id = v.slot_id LIMIT 1),
    COALESCE(
      (SELECT a.message_id FROM request_attempts a WHERE a.turn_id = v.slot_id ORDER BY a.attempt_index DESC LIMIT 1),
      (SELECT x.message_id FROM message_versions x WHERE x.slot_id = v.slot_id ORDER BY x.version_number DESC LIMIT 1)),
    strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM message_versions v WHERE v.version_number = 1;
`;
