ALTER TABLE egoric_auth_invites ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'not_configured';
ALTER TABLE egoric_auth_invites ADD COLUMN delivery_provider TEXT;
ALTER TABLE egoric_auth_invites ADD COLUMN delivery_message_id TEXT;
ALTER TABLE egoric_auth_invites ADD COLUMN delivery_attempted_at INTEGER;
