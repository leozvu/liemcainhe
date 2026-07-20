/**
 * Logical schema for the Sites D1 binding. Runtime access stays in worker/index.js
 * because this Vite application ships a plain Cloudflare Worker rather than Vinext.
 */
export const cloudProjectsSchema = {
  table: 'egoric_projects',
  primaryKey: ['owner_email', 'project_id'],
  columns: {
    ownerEmail: 'TEXT NOT NULL',
    projectId: 'TEXT NOT NULL',
    title: 'TEXT NOT NULL',
    payloadJson: 'TEXT NOT NULL',
    updatedAt: 'INTEGER NOT NULL',
  },
} as const;

export const accountProfilesSchema = {
  table: 'egoric_profiles',
  primaryKey: ['owner_email'],
  columns: ['owner_email', 'display_name', 'studio_name', 'plan', 'monthly_unit_limit', 'created_at', 'updated_at'],
} as const;

export const usageEventsSchema = {
  table: 'egoric_usage_events',
  primaryKey: ['id'],
  indexes: [['owner_email', 'created_at'], ['owner_email', 'project_id', 'created_at']],
  columns: ['id', 'owner_email', 'project_id', 'kind', 'provider_id', 'model_id', 'units', 'estimated_cost_usd', 'duration_ms', 'status', 'error', 'created_at'],
} as const;

export const systemEventsSchema = {
  table: 'egoric_system_events',
  primaryKey: ['id'],
  indexes: [['owner_email', 'created_at']],
  columns: ['id', 'owner_email', 'project_id', 'severity', 'source', 'message', 'detail_json', 'created_at'],
} as const;
