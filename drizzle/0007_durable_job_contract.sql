ALTER TABLE egoric_jobs ADD COLUMN idempotency_key TEXT;
ALTER TABLE egoric_jobs ADD COLUMN provider_task_id TEXT;

CREATE INDEX IF NOT EXISTS egoric_jobs_owner_project_idempotency_idx
  ON egoric_jobs (owner_email, project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
