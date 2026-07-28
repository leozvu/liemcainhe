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
  columns: ['id', 'owner_email', 'project_id', 'kind', 'provider_id', 'model_id', 'resource_id', 'units', 'estimated_cost_usd', 'duration_ms', 'status', 'error', 'created_at'],
} as const;

export const campaignFinancialsSchema = {
  table: 'egoric_campaign_financials',
  primaryKey: ['owner_email', 'campaign_id'],
  indexes: [['owner_email', 'updated_at']],
  columns: ['owner_email', 'campaign_id', 'campaign_name', 'client_name', 'quoted_revenue_vnd', 'labor_hours', 'labor_hourly_rate_vnd', 'other_cost_vnd', 'exchange_rate_vnd_per_usd', 'notes', 'created_at', 'updated_at'],
} as const;

export const systemEventsSchema = {
  table: 'egoric_system_events',
  primaryKey: ['id'],
  indexes: [['owner_email', 'created_at']],
  columns: ['id', 'owner_email', 'project_id', 'severity', 'source', 'message', 'detail_json', 'created_at'],
} as const;

export const productionJobsSchema = {
  table: 'egoric_jobs',
  primaryKey: ['id'],
  indexes: [
    ['owner_email', 'project_id', 'updated_at'],
  ],
  uniqueIndexes: [{
    columns: ['owner_email', 'project_id', 'idempotency_key'],
    where: "idempotency_key IS NOT NULL AND status IN ('queued', 'running', 'completed', 'interrupted')",
  }],
  columns: [
    'id', 'owner_email', 'project_id', 'kind', 'stage', 'label', 'status',
    'progress', 'completed_units', 'total_units', 'resource_id',
    'idempotency_key', 'provider_task_id', 'detail', 'error', 'attempts',
    'created_at', 'updated_at',
  ],
} as const;

export const mediaMetadataSchema = {
  table: 'egoric_media',
  primaryKey: ['owner_email', 'project_id', 'path'],
} as const;

export const reviewNotesSchema = {
  table: 'egoric_review_notes',
  primaryKey: ['id'],
  indexes: [['owner_email', 'project_id', 'updated_at']],
} as const;

export const stageApprovalsSchema = {
  table: 'egoric_stage_approvals',
  primaryKey: ['owner_email', 'project_id', 'stage'],
} as const;

export const rateLimitsSchema = {
  table: 'egoric_rate_limits',
  primaryKey: ['owner_email', 'bucket'],
} as const;

export const clientReviewPortalsSchema = {
  table: 'egoric_client_review_portals',
  primaryKey: ['id'],
  indexes: [['owner_email', 'project_id', 'updated_at'], ['token']],
} as const;

export const clientReviewCommentsSchema = {
  table: 'egoric_client_review_comments',
  primaryKey: ['id'],
  indexes: [['portal_id', 'updated_at']],
} as const;

export const workspaceItemsSchema = {
  table: 'egoric_workspace_items',
  primaryKey: ['owner_email', 'collection', 'item_id'],
  indexes: [['owner_email', 'collection', 'updated_at']],
  columns: ['owner_email', 'collection', 'item_id', 'payload_json', 'updated_at', 'deleted_at'],
} as const;

export const distributionPackagesSchema = {
  table: 'egoric_distribution_packages',
  primaryKey: ['id'],
  indexes: [['owner_email', 'project_id', 'updated_at']],
  uniqueIndexes: [['owner_email', 'project_id', 'idempotency_key']],
} as const;

export const distributionConnectionsSchema = {
  table: 'egoric_distribution_connections',
  primaryKey: ['id'],
  indexes: [['owner_email', 'updated_at']],
  uniqueIndexes: [['owner_email', 'platform', 'external_account_id']],
  secretColumns: ['secret_json'],
} as const;

export const distributionOauthStatesSchema = {
  table: 'egoric_distribution_oauth_states',
  primaryKey: ['state_hash'],
  indexes: [['expires_at']],
} as const;

export const distributionJobsSchema = {
  table: 'egoric_distribution_jobs',
  primaryKey: ['id'],
  indexes: [['owner_email', 'project_id', 'updated_at']],
  uniqueIndexes: [['owner_email', 'project_id', 'idempotency_key']],
  secretColumns: ['private_json'],
} as const;
