import { describe, expect, it } from 'vitest';
import { DistributionPublishJob } from '../types';
import { formatDistributionProgress, isDistributionJobActive } from '../services/distributionPublishingService';

const job = (status: DistributionPublishJob['status'], over: Partial<DistributionPublishJob> = {}): DistributionPublishJob => ({
  id: 'distributionjob_1', projectId: 'project_1', packageId: 'distribution_1', platform: 'youtube',
  connectionId: 'connection_1', connectionLabel: 'Egoric YouTube', status, visibility: 'private',
  attempt: 1, progress: 0, uploadedBytes: 0, totalBytes: 100, retrySafe: true,
  createdAt: 1, updatedAt: 1, ...over,
});

describe('Distribution Publishing Queue', () => {
  it('chỉ tự chạy các trạng thái có thể upload tiếp ngay', () => {
    expect(isDistributionJobActive(job('queued'))).toBe(true);
    expect(isDistributionJobActive(job('uploading'))).toBe(true);
    expect(isDistributionJobActive(job('processing'))).toBe(false);
    expect(isDistributionJobActive(job('indeterminate'))).toBe(false);
  });

  it('không mô tả indeterminate như failed để tránh retry mù', () => {
    expect(formatDistributionProgress(job('indeterminate'))).toContain('đối soát');
    expect(formatDistributionProgress(job('failed', { retrySafe: true }))).toContain('thử lại');
  });

  it('nói rõ TikTok draft cần creator hoàn tất', () => {
    expect(formatDistributionProgress(job('awaiting-user', { platform: 'tiktok' }))).toContain('TikTok');
  });
});
