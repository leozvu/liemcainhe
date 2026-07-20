CREATE TABLE IF NOT EXISTS egoric_profiles (
  owner_email TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  studio_name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'Bản thử Studio',
  monthly_unit_limit INTEGER NOT NULL DEFAULT 1000,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS egoric_usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  owner_email TEXT NOT NULL,
  project_id TEXT,
  kind TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  units REAL NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS egoric_usage_owner_time_idx
  ON egoric_usage_events (owner_email, created_at DESC);

CREATE INDEX IF NOT EXISTS egoric_usage_owner_project_idx
  ON egoric_usage_events (owner_email, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS egoric_system_events (
  id TEXT PRIMARY KEY NOT NULL,
  owner_email TEXT NOT NULL,
  project_id TEXT,
  severity TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  detail_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS egoric_system_owner_time_idx
  ON egoric_system_events (owner_email, created_at DESC);
