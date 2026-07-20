import { describe, expect, it } from 'vitest';
import { collectCloudMediaPaths, createBlobChecksum } from '../services/cloudSyncService';

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
});
