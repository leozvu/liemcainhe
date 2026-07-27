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
    };
    expect(data.ok).toBe(true);
    expect(data.collections).toHaveLength(6);
    expect(data.collections.find((item) => item.collection === 'agencyClients')).toMatchObject({ active: 3, tombstones: 1 });
    expect(data.collections.find((item) => item.collection === 'articleLibrary')).toMatchObject({ active: 0, tombstones: 0 });
    expect(DB.prepare).toHaveBeenCalledWith(expect.stringContaining('GROUP BY collection'));
  });

  it('không lộ số liệu khi thiếu danh tính workspace', async () => {
    const response = await worker.fetch(
      new Request('https://studio.test/api/cloud/workspace/health'),
      { DB: createHealthDb(), MEDIA: {} },
    );
    expect(response.status).toBe(401);
  });
});
