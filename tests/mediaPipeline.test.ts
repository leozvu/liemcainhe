import { describe, expect, it } from 'vitest';
import { collectCloudMediaPaths, createBlobChecksum, shouldUploadCloudMedia } from '../services/cloudSyncService';

describe('media cloud pipeline', () => {
  it('tạo checksum SHA-256 ổn định', async () => {
    const checksum = await createBlobChecksum(new Blob(['egoric']));
    expect(checksum).toHaveLength(64);
    expect(checksum).toBe(await createBlobChecksum(new Blob(['egoric'])));
  });

  it('thu thập duy nhất các media thuộc đúng dự án', () => {
    const paths = collectCloudMediaPaths('project_123', {
      image: '/api/cloud/media/project_123/shots/canh%2001.webp',
      nested: ['/api/cloud/media/project_123/voice/a.wav', '/api/cloud/media/other/x.mp4'],
    });
    expect(paths.sort()).toEqual(['shots/canh 01.webp', 'voice/a.wav']);
  });

  it('đưa media CDN tạm về R2 nhưng không tải lại media Egoric', () => {
    expect(shouldUploadCloudMedia('project_123', 'https://cdn.provider.example/video.mp4')).toBe(true);
    expect(shouldUploadCloudMedia('project_123', 'data:video/mp4;base64,AAAA')).toBe(true);
    expect(shouldUploadCloudMedia('project_123', '/api/cloud/media/project_123/video/shot.mp4')).toBe(false);
    expect(shouldUploadCloudMedia('project_123', 'http://insecure.example/video.mp4')).toBe(false);
  });
});
