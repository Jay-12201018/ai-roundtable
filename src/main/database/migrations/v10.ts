// Discussion continuity (D111): a finished discussion continues in the same Run. Migrations 1–9 remain unchanged.
export const migration10 = `
-- One row per continuation: the host's interjection (an 'interject' host action of the same Run) and who answers it,
-- in order. Its Turns reference the action through turns.override_action_id, so they never count as plan Turns.
-- elapsed_base_ms is the Run's execution time when it was continued; the duration limit counts from there.
CREATE TABLE run_continuations (
  action_id TEXT PRIMARY KEY REFERENCES host_actions(id),
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  agent_ids_json TEXT NOT NULL CHECK(json_valid(agent_ids_json) AND json_type(agent_ids_json)='array'
    AND json_array_length(agent_ids_json) BETWEEN 1 AND 64),
  elapsed_base_ms INTEGER NOT NULL CHECK(typeof(elapsed_base_ms)='integer' AND elapsed_base_ms BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_run_continuations_run ON run_continuations(run_id, created_at);
CREATE TRIGGER run_continuation_insert BEFORE INSERT ON run_continuations BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM host_actions a WHERE a.id=NEW.action_id AND a.run_id=NEW.run_id AND a.kind='interject')
  THEN RAISE(ABORT,'Invalid continuation identity') END;
END;
CREATE TRIGGER run_continuation_immutable BEFORE UPDATE ON run_continuations BEGIN
  SELECT RAISE(ABORT,'Continuations are append-only');
END;
CREATE TRIGGER run_continuation_no_delete BEFORE DELETE ON run_continuations BEGIN
  SELECT RAISE(ABORT,'Continuations are append-only');
END;
`;
