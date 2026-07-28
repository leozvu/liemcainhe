import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Distribution Publishing server contract', () => {
  const worker = readFileSync(resolve('worker/index.js'), 'utf8');
  const migration = readFileSync(resolve('drizzle/0011_distribution_publishing.sql'), 'utf8');
  const schema = readFileSync(resolve('db/schema.ts'), 'utf8');

  it('mã hóa OAuth token và dùng state một lần', () => {
    expect(worker).toContain("crypto.subtle.importKey('raw', raw, 'AES-GCM'");
    expect(worker).toContain('egoric_distribution_oauth_states');
    expect(worker).toContain("DELETE FROM egoric_distribution_oauth_states WHERE state_hash = ?");
    expect(worker).toContain('DISTRIBUTION_TOKEN_KEY');
    expect(worker).toContain('await encryptDistributionSecret(env, privateState)');
    expect(worker).toContain('await decryptDistributionSecret(env, row.private_json)');
  });

  it('có YouTube resumable và TikTok creator inbox chính thức', () => {
    expect(worker).toContain('uploadType=resumable&part=snippet,status');
    expect(worker).toContain("'content-range': `bytes ${offset}-${offset + length - 1}/${job.totalBytes}`");
    expect(worker).toContain('/v2/post/publish/inbox/video/init/');
    expect(worker).toContain('/v2/post/publish/status/fetch/');
    expect(worker).toContain("status: 'awaiting-user'");
  });

  it('giữ job indeterminate và chống tạo trùng', () => {
    expect(worker).toContain('Không rõ YouTube đã nhận chunk hay chưa');
    expect(worker).toContain('Không rõ TikTok đã nhận chunk hay chưa');
    expect(worker).toContain('Hãy đối soát trước; không được upload lại mù');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS egoric_distribution_jobs_idempotency_idx');
    expect(schema).toContain('distributionJobsSchema');
    expect(schema).toContain("secretColumns: ['private_json']");
  });

  it('không lưu secret vào account export', () => {
    expect(worker).toContain('SELECT id, platform, external_account_id, display_name, status, scopes_json');
    expect(worker).not.toContain("SELECT * FROM egoric_distribution_connections WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 5000");
  });
});
