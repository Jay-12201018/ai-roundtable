// Manual release is separate from the immutable unknown billing evidence and never invents usage.
export const migration5 = `
ALTER TABLE controlled_trials ADD COLUMN reservation_released INTEGER NOT NULL DEFAULT 0 CHECK(reservation_released IN (0,1));
DROP INDEX idx_controlled_trial_unresolved;
CREATE UNIQUE INDEX idx_controlled_trial_unresolved ON controlled_trials((1)) WHERE state IN ('reserved','unknown') AND reservation_released=0;
CREATE TABLE controlled_trial_reconciliations (
  id TEXT PRIMARY KEY,
  trial_id TEXT NOT NULL REFERENCES controlled_trials(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK(decision IN ('retain_reservation','release_reservation')),
  reviewed_at TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(json_valid(data_json))
);
CREATE UNIQUE INDEX idx_controlled_trial_release ON controlled_trial_reconciliations(trial_id) WHERE decision='release_reservation';
CREATE TRIGGER prevent_trial_reconciliation_update BEFORE UPDATE ON controlled_trial_reconciliations BEGIN SELECT RAISE(ABORT,'Reconciliation audits are append-only'); END;
CREATE TRIGGER prevent_trial_reconciliation_delete BEFORE DELETE ON controlled_trial_reconciliations BEGIN SELECT RAISE(ABORT,'Reconciliation audits are append-only'); END;
`;
