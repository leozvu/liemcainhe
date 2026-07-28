import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectCloudMediaPaths,
  createBlobChecksum,
  shouldUploadCloudMedia,
  uploadProjectMediaBlob,
} from '../services/cloudSyncService';

afterEach(() => vi.unstubAllGlobals());

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

  it('lưu master nhỏ bằng một request PUT và trả metadata có checksum', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ skipped: false }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: '/api/cloud/media/project_123/editor/masters/output.mp4' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const progress: number[] = [];
    const blob = new Blob(['egoric-master'], { type: 'video/mp4' });

    const result = await uploadProjectMediaBlob('project_123', 'editor/masters/output.mp4', blob, (value) => progress.push(value));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/cloud/media/uploads');
    expect(fetchMock.mock.calls[1][0]).toContain('path=editor%2Fmasters%2Foutput.mp4');
    expect(fetchMock.mock.calls[1][1]?.body).toBe(blob);
    expect(result).toMatchObject({ bytes: blob.size, url: '/api/cloud/media/project_123/editor/masters/output.mp4' });
    expect(result.checksum).toHaveLength(64);
    expect(progress).toEqual([4, 100]);
  });

  it('chia master lớn thành nhiều phần rồi mới hoàn tất phiên upload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ uploadId: 'upload_1' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ partNumber: 1, etag: 'etag_1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ partNumber: 2, etag: 'etag_2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: '/api/cloud/media/project_123/editor/masters/large.mp4' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = new Blob([new Uint8Array(9 * 1024 * 1024)], { type: 'video/mp4' });

    const result = await uploadProjectMediaBlob('project_123', 'editor/masters/large.mp4', blob);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1][0]).toContain('/parts/1?');
    expect(fetchMock.mock.calls[2][0]).toContain('/parts/2?');
    const completion = JSON.parse(String(fetchMock.mock.calls[3][1]?.body));
    expect(completion.parts).toEqual([{ partNumber: 1, etag: 'etag_1' }, { partNumber: 2, etag: 'etag_2' }]);
    expect(result.bytes).toBe(blob.size);
  });

  it('chặn artifact rỗng trước khi gọi mạng', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadProjectMediaBlob('project_123', 'editor/masters/empty.mp4', new Blob([]))).rejects.toThrow('Tệp master rỗng');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
