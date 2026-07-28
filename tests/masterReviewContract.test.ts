import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const worker = readFileSync(path.join(root, 'worker', 'index.js'), 'utf8');
const migration = readFileSync(path.join(root, 'drizzle', '0009_master_review_signature.sql'), 'utf8');

describe('Master Review server contract', () => {
  it('persists the artifact signature beside the client decision', () => {
    expect(migration).toContain('ADD COLUMN decision_artifact_signature TEXT');
    expect(worker).toContain('decision_artifact_signature = ?');
    expect(worker).toContain('decisionArtifactSignature: row.decision_artifact_signature || undefined');
  });

  it('publishes the selected master instead of rebuilding a shot playlist', () => {
    expect(worker).toContain("artifactSignature = `master:${master.id}:${master.checksum}`");
    expect(worker).toContain("sourceKind: 'master'");
    expect(worker).toContain("Master gửi duyệt không trùng với bản đã được duyệt nội bộ.");
  });

  it('rejects a stale browser decision before writing approval', () => {
    expect(worker).toContain('artifactSignature !== version.artifactSignature');
    expect(worker).toContain('Artifact đã thay đổi sau khi trang được mở');
  });
});
