CREATE TABLE IF NOT EXISTS egoric_auth_users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'director', 'editor', 'account')),
  workspace_owner_email TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE INDEX IF NOT EXISTS egoric_auth_users_workspace_idx
  ON egoric_auth_users (workspace_owner_email, status, role);

CREATE TABLE IF NOT EXISTS egoric_auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES egoric_auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS egoric_auth_sessions_user_idx
  ON egoric_auth_sessions (user_id, expires_at);

CREATE INDEX IF NOT EXISTS egoric_auth_sessions_expiry_idx
  ON egoric_auth_sessions (expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS egoric_auth_invites (
  token_hash TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('director', 'editor', 'account')),
  workspace_owner_email TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (invited_by) REFERENCES egoric_auth_users(id)
);

CREATE INDEX IF NOT EXISTS egoric_auth_invites_workspace_idx
  ON egoric_auth_invites (workspace_owner_email, used_at, expires_at);

CREATE INDEX IF NOT EXISTS egoric_auth_invites_email_idx
  ON egoric_auth_invites (email, used_at);
