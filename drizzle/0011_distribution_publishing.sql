CREATE TABLE IF NOT EXISTS egoric_distribution_connections (
  id TEXT PRIMARY KEY NOT NULL,
  owner_email TEXT NOT NULL,
  platform TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  scopes_json TEXT NOT NULL DEFAULT '[]',
  secret_json TEXT NOT NULL,
  expires_at INTEGER,
  last_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS egoric_distribution_connections_account_idx
  ON egoric_distribution_connections (owner_email, platform, external_account_id);

CREATE INDEX IF NOT EXISTS egoric_distribution_connections_owner_idx
  ON egoric_distribution_connections (owner_email, updated_at DESC);

CREATE TABLE IF NOT EXISTS egoric_distribution_oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  owner_email TEXT NOT NULL,
  project_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  return_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS egoric_distribution_oauth_states_expiry_idx
  ON egoric_distribution_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS egoric_distribution_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_email TEXT NOT NULL,
  project_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  idempotency_key TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  private_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS egoric_distribution_jobs_idempotency_idx
  ON egoric_distribution_jobs (owner_email, project_id, idempotency_key);

CREATE INDEX IF NOT EXISTS egoric_distribution_jobs_owner_project_idx
  ON egoric_distribution_jobs (owner_email, project_id, updated_at DESC);
