import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Distribution Gateway server contract', () => {
  const worker = readFileSync(resolve('worker/index.js'), 'utf8');
  const migration = readFileSync(resolve('drizzle/0010_distribution_gateway.sql'), 'utf8');

  it('có route server riêng và không cho client tự bịa package', () => {
    expect(worker).toContain("url.pathname === '/api/distribution-packages'");
    expect(worker).toContain('handleDistributionPackagesApi');
    expect(worker).toContain('portalRow.decision_artifact_signature !== expectedArtifactSignature');
    expect(worker).toContain('reviewRound.sourceSignature !== reviewSourceSignature');
    expect(worker).toContain("status = 'open'");
  });

  it('lưu ledger bền vững và chống tạo trùng cùng artifact', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS egoric_distribution_packages');
    expect(migration).toContain('artifact_signature TEXT NOT NULL');
    expect(migration).toContain('idempotency_key TEXT NOT NULL');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS egoric_distribution_packages_idempotency_idx');
    expect(worker).toContain('duplicate: true');
  });
});
