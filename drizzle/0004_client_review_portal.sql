CREATE TABLE IF NOT EXISTS egoric_client_review_portals (
  id TEXT PRIMARY KEY NOT NULL,
  token TEXT UNIQUE NOT NULL,
  owner_email TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL,
  campaign_name TEXT,
  deliverable_title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  decision TEXT NOT NULL DEFAULT 'pending',
  decision_version_id TEXT,
  decision_note TEXT,
  reviewer_name TEXT,
  reviewer_email TEXT,
  decided_at INTEGER,
  expires_at INTEGER,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS egoric_client_review_portals_owner_project_idx
  ON egoric_client_review_portals (owner_email, project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS egoric_client_review_portals_token_idx
  ON egoric_client_review_portals (token);

CREATE TABLE IF NOT EXISTS egoric_client_review_comments (
  id TEXT PRIMARY KEY NOT NULL,
  portal_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  clip_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_email TEXT,
  body TEXT NOT NULL,
  timecode_seconds REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (portal_id) REFERENCES egoric_client_review_portals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS egoric_client_review_comments_portal_idx
  ON egoric_client_review_comments (portal_id, updated_at DESC);
