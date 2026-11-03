-- The schema as first released (migration 1), kept so upgrades from it can be tested without the original commit.
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
