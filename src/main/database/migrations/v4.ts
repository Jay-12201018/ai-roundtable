// An unresolved test reservation survives restart; it is never silently released or retried.
export const migration4 = `
CREATE TABLE controlled_trials (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  provider_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('reserved','unknown','settled')),
  data_json TEXT NOT NULL CHECK(json_valid(data_json))
);
CREATE UNIQUE INDEX idx_controlled_trial_unresolved ON controlled_trials((1)) WHERE state IN ('reserved','unknown');
`;
