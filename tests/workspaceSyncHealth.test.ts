import { describe, expect, it, vi } from 'vitest';
import worker from '../worker/index.js';

const createHealthDb = () => {
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn(() => ({
      all: vi.fn().mockResolvedValue({
        results: [
          { collection: 'agencyClients', active: 3, tombstones: 1, newestAt: 500 },
          { collection: 'campaignZeroRuns', active: 1, tombstones: 0, newestAt: 600 },
        ],
      }),
    })),
    sql,
  }));
  return { prepare };
};

describe('health endpoint của workspace cloud', () => {
  it('trả đủ sáu kho, kể cả kho chưa có bản ghi', async () => {
    const DB = createHealthDb();
    const response = await worker.fetch(new Request('https://studio.test/api/cloud/workspace/health', {
      headers: { 'oai-authenticated-user-email': 'owner@egoric.vn' },
    }), { DB, MEDIA: {} });

    expect(response.status).toBe(200);
    const data = await response.json() as {
      ok: boolean;
      collections: Array<{ collection: string; active: number; tombstones: number }>;
      capabilities: { media: boolean; inviteEmail: boolean; youtubePublishing: boolean };
    };
    expect(data.ok).toBe(true);
    expect(data.collections).toHaveLength(6);
    expect(data.collections.find((item) => item.collection === 'agencyClients')).toMatchObject({ active: 3, tombstones: 1 });
    expect(data.collections.find((item) => item.collection === 'articleLibrary')).toMatchObject({ active: 0, tombstones: 0 });
    expect(data.capabilities).toMatchObject({ media: true, inviteEmail: false, youtubePublishing: false });
    expect(DB.prepare).toHaveBeenCalledWith(expect.stringContaining('GROUP BY collection'));
  });

  it('không bắt Campaign và Client phụ thuộc R2', async () => {
    const DB = {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ all: vi.fn().mockResolvedValue({ results: [] }) })) })),
    };
    const response = await worker.fetch(new Request('https://studio.test/api/cloud/workspace?collection=agencyCampaigns&since=0', {
      headers: { 'oai-authenticated-user-email': 'owner@egoric.vn' },
    }), { DB });
    expect(response.status).toBe(200);
  });

  it('chỉ chặn route media khi R2 chưa bật', async () => {
    const response = await worker.fetch(new Request('https://studio.test/api/cloud/media/uploads', {
      method: 'POST',
      headers: { 'oai-authenticated-user-email': 'owner@egoric.vn', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj_test', path: 'shot.png', checksum: 'a'.repeat(64), size: 128 }),
    }), { DB: createHealthDb() });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('R2') });
  });

  it('không lộ số liệu khi thiếu danh tính workspace', async () => {
    const response = await worker.fetch(
      new Request('https://studio.test/api/cloud/workspace/health'),
      { DB: createHealthDb(), MEDIA: {} },
    );
    expect(response.status).toBe(401);
  });
});
