// Published on acceptance only: migrations 1 and 2 remain byte-for-byte unchanged.
export const migration3 = `
  ALTER TABLE rooms ADD COLUMN archived_at TEXT;
  ALTER TABLE agents ADD COLUMN archived_at TEXT;
  ALTER TABLE agents ADD COLUMN configuration_version INTEGER NOT NULL DEFAULT 0 CHECK(configuration_version IN (0,1));
  ALTER TABLE providers ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1));
  ALTER TABLE providers ADD COLUMN default_model_id TEXT;
  ALTER TABLE providers ADD COLUMN custom_models_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(custom_models_json) AND json_type(custom_models_json)='array');
  ALTER TABLE providers ADD COLUMN key_revision TEXT NOT NULL DEFAULT '';
  UPDATE providers SET key_revision=lower(hex(randomblob(16)));
  CREATE UNIQUE INDEX idx_provider_single_default ON providers(is_default) WHERE is_default=1;
  CREATE INDEX idx_messages_room_sort ON messages(room_id,sort_key);
  CREATE INDEX idx_runs_room_created ON workflow_runs(room_id,created_at,id);
`;
