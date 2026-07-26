ALTER TABLE egoric_usage_events ADD COLUMN resource_id TEXT;

CREATE INDEX IF NOT EXISTS egoric_usage_events_owner_resource_idx
  ON egoric_usage_events (owner_email, project_id, resource_id, created_at DESC);

CREATE TABLE IF NOT EXISTS egoric_campaign_financials (
  owner_email TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  client_name TEXT,
  quoted_revenue_vnd REAL NOT NULL DEFAULT 0,
  labor_hours REAL NOT NULL DEFAULT 0,
  labor_hourly_rate_vnd REAL NOT NULL DEFAULT 0,
  other_cost_vnd REAL NOT NULL DEFAULT 0,
  exchange_rate_vnd_per_usd REAL NOT NULL DEFAULT 26000,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_email, campaign_id)
);

CREATE INDEX IF NOT EXISTS egoric_campaign_financials_owner_updated_idx
  ON egoric_campaign_financials (owner_email, updated_at DESC);
