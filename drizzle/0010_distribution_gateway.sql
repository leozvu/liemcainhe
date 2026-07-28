CREATE TABLE IF NOT EXISTS egoric_distribution_packages (
  id TEXT PRIMARY KEY NOT NULL,
  owner_email TEXT NOT NULL,
  project_id TEXT NOT NULL,
  review_portal_id TEXT NOT NULL,
  review_version_id TEXT NOT NULL,
  review_round_id TEXT NOT NULL,
  master_output_id TEXT NOT NULL,
  master_checksum TEXT NOT NULL,
  artifact_signature TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS egoric_distribution_packages_owner_project_idx
  ON egoric_distribution_packages (owner_email, project_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS egoric_distribution_packages_idempotency_idx
  ON egoric_distribution_packages (owner_email, project_id, idempotency_key);
