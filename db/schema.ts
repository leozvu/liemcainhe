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
