CREATE TABLE IF NOT EXISTS egoric_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_email TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  stage TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  completed_units INTEGER,
  total_units INTEGER,
  resource_id TEXT,
  detail TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS egoric_jobs_owner_project_idx
  ON egoric_jobs (owner_email, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS egoric_media (
  owner_email TEXT NOT NULL,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  checksum TEXT,
  etag TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_email, project_id, path)
);

CREATE INDEX IF NOT EXISTS egoric_media_owner_project_idx
  ON egoric_media (owner_email, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS egoric_review_notes (
  id TEXT PRIMARY KEY NOT NULL,
  owner_email TEXT NOT NULL,
  project_id TEXT NOT NULL,
  shot_id TEXT,
  stage TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS egoric_review_notes_owner_project_idx
  ON egoric_review_notes (owner_email, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS egoric_stage_approvals (
  owner_email TEXT NOT NULL,
  project_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  approved_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_email, project_id, stage)
);

CREATE TABLE IF NOT EXISTS egoric_rate_limits (
  owner_email TEXT NOT NULL,
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_email, bucket)
);
