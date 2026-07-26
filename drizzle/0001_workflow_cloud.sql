CREATE TABLE IF NOT EXISTS egoric_projects (
  owner_email TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_email, project_id)
);

CREATE INDEX IF NOT EXISTS egoric_projects_owner_updated_idx
  ON egoric_projects (owner_email, updated_at DESC);
