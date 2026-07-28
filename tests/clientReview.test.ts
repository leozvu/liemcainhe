import { describe, expect, it } from 'vitest';
import { ClientReviewPortal } from '../types';
import { formatReviewTimecode, getClientReviewSummary } from '../services/clientReviewService';

const portal = (overrides: Partial<ClientReviewPortal> = {}): ClientReviewPortal => ({
  id: 'portal_1',
  projectId: 'project_1',
  title: 'Video ra mắt',
  clientName: 'Egoric Client',
  status: 'active',
  decision: 'pending',
  versions: [{
    id: 'version_1',
    number: 1,
    label: 'Bản duyệt V1',
    duration: 8,
    clips: [{
      id: 'clip_1',
      shotId: 'shot_1',
      title: 'Cảnh 01',
      actionSummary: 'Mở sản phẩm',
      duration: 8,
      videoUrl: 'https://media.example/video.mp4',
    }],
    createdAt: 1,
  }],
  comments: [
    { id: 'comment_1', versionId: 'version_1', clipId: 'clip_1', authorName: 'Minh', body: 'Sửa CTA', timecodeSeconds: 2, status: 'open', createdAt: 2, updatedAt: 2 },
    { id: 'comment_2', versionId: 'version_1', clipId: 'clip_1', authorName: 'Minh', body: 'Đã ổn', timecodeSeconds: 4, status: 'resolved', createdAt: 3, updatedAt: 3 },
  ],
  createdAt: 1,
  updatedAt: 3,
  ...overrides,
});

describe('client review portal', () => {
  it('formats review timecode at 25 fps', () => {
    expect(formatReviewTimecode(0)).toBe('00:00:00:00');
    expect(formatReviewTimecode(61.04)).toBe('00:01:01:01');
    expect(formatReviewTimecode(-10)).toBe('00:00:00:00');
  });

  it('summarizes versions and comment states', () => {
    const summary = getClientReviewSummary(portal());
    expect(summary.versionCount).toBe(1);
    expect(summary.latestVersion?.id).toBe('version_1');
    expect(summary.openComments).toBe(1);
    expect(summary.resolvedComments).toBe(1);
    expect(summary.isLocked).toBe(false);
  });

  it('locks the review after approval or link closure', () => {
    expect(getClientReviewSummary(portal({ decision: 'approved' })).isLocked).toBe(true);
    expect(getClientReviewSummary(portal({ status: 'closed' })).isLocked).toBe(true);
  });

  it('binds a client decision to the exact artifact signature', () => {
    const signed = portal({
      decision: 'approved',
      decisionVersionId: 'version_1',
      decisionArtifactSignature: 'master:output_1:sha256-a',
      versions: [{
        ...portal().versions[0],
        sourceKind: 'master',
        masterOutputId: 'output_1',
        artifactSignature: 'master:output_1:sha256-a',
        artifactChecksum: 'sha256-a',
      }],
    });
    expect(getClientReviewSummary(signed)).toMatchObject({
      decisionMatchesArtifact: true,
      approvalFingerprint: 'master:output_1:sha256-a',
    });
    expect(getClientReviewSummary({ ...signed, decisionArtifactSignature: 'master:output_1:sha256-old' }).decisionMatchesArtifact).toBe(false);
  });
});
