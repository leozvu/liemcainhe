import { describe, expect, it, vi } from 'vitest';
import {
  describeInsights,
  engagementRate,
  fetchPostInsights,
  hasMetrics,
  readMetaInsightValues,
  totalEngagements,
} from '../services/content/insightsService';
import { LedgerStore, PublishLedgerEntry, refreshInsights } from '../services/content/publishLedgerService';
import { PostInsights } from '../types/content';

const creds = { accessToken: 'tok', accountId: '123' };

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('bóc số liệu của Meta', () => {
  it('lấy giá trị mới nhất của từng metric', () => {
    const payload = {
      data: [
        { name: 'post_impressions', values: [{ value: 100 }, { value: 250 }] },
        { name: 'post_engaged_users', values: [{ value: 12 }] },
      ],
    };
    expect(readMetaInsightValues(payload)).toEqual({ post_impressions: 250, post_engaged_users: 12 });
  });

  it('bỏ qua metric rỗng hoặc sai kiểu', () => {
    const payload = {
      data: [
        { name: 'a', values: [] },
        { name: 'b', values: [{ value: 'không phải số' }] },
        { values: [{ value: 5 }] },
        { name: 'c', values: [{ value: 7 }] },
      ],
    };
    expect(readMetaInsightValues(payload)).toEqual({ c: 7 });
  });

  it('phản hồi lạ thì trả về rỗng chứ không ném lỗi', () => {
    expect(readMetaInsightValues(null)).toEqual({});
    expect(readMetaInsightValues({ data: 'sai kiểu' })).toEqual({});
  });
});

describe('đọc số liệu Facebook', () => {
  it('gộp số hiển thị và số tương tác từ hai lời gọi', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) =>
      url.includes('/insights')
        ? jsonRes({
            data: [
              { name: 'post_impressions', values: [{ value: 1000 }] },
              { name: 'post_impressions_unique', values: [{ value: 800 }] },
              { name: 'post_engaged_users', values: [{ value: 64 }] },
            ],
          })
        : jsonRes({
            reactions: { summary: { total_count: 40 } },
            comments: { summary: { total_count: 15 } },
            shares: { count: 9 },
          }),
    );

    const result = await fetchPostInsights('facebook-page', 'p1', creds, { fetchImpl: fetchImpl as never });

    expect(result).toMatchObject({
      channelId: 'facebook-page',
      impressions: 1000,
      reach: 800,
      engagements: 64,
      likes: 40,
      comments: 15,
      shares: 9,
    });
    expect(result.unavailable).toBeUndefined();
  });

  it('một lời gọi hỏng vẫn giữ được phần còn lại', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) =>
      url.includes('/insights')
        ? jsonRes({ error: { message: 'Không đủ quyền' } }, 403)
        : jsonRes({ reactions: { summary: { total_count: 5 } } }),
    );

    const result = await fetchPostInsights('facebook-page', 'p1', creds, { fetchImpl: fetchImpl as never });
    expect(result.likes).toBe(5);
    expect(result.impressions).toBeUndefined();
    expect(result.unavailable).toBeUndefined();
  });

  it('hỏng cả hai thì ghi rõ lý do', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ error: { message: 'Token hết hạn' } }, 401));
    const result = await fetchPostInsights('facebook-page', 'p1', creds, { fetchImpl: fetchImpl as never });
    expect(result.unavailable).toBe('Token hết hạn');
  });
});

describe('đọc số liệu Threads', () => {
  it('ánh xạ đúng tên metric của Threads', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonRes({
        data: [
          { name: 'views', values: [{ value: 500 }] },
          { name: 'likes', values: [{ value: 30 }] },
          { name: 'replies', values: [{ value: 4 }] },
          { name: 'reposts', values: [{ value: 2 }] },
        ],
      }),
    );
    const result = await fetchPostInsights('threads', 'm1', creds, { fetchImpl: fetchImpl as never });
    expect(result).toMatchObject({ impressions: 500, likes: 30, comments: 4, shares: 2 });
  });
});

describe('các đường chặn trước khi gọi mạng', () => {
  it('Zalo nói rõ nền tảng không mở API', async () => {
    const fetchImpl = vi.fn();
    const result = await fetchPostInsights('zalo-oa', 'a1', creds, { fetchImpl: fetchImpl as never });
    expect(result.unavailable).toContain('không mở API');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('thiếu token thì không gọi mạng', async () => {
    const fetchImpl = vi.fn();
    const result = await fetchPostInsights('facebook-page', 'p1', {}, { fetchImpl: fetchImpl as never });
    expect(result.unavailable).toContain('Chưa có token');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lỗi mạng thành lý do, không ném ra ngoài', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    const result = await fetchPostInsights('facebook-page', 'p1', creds, { fetchImpl: fetchImpl as never });
    expect(result.unavailable).toBe('Failed to fetch');
  });
});

describe('tính toán và hiển thị', () => {
  const base: PostInsights = { channelId: 'facebook-page', postId: 'p1', fetchedAt: 0 };

  it('ưu tiên con số nền tảng tự tính thay vì cộng thủ công', () => {
    expect(totalEngagements({ ...base, engagements: 64, likes: 40, comments: 15, shares: 9 })).toBe(64);
    expect(totalEngagements({ ...base, likes: 40, comments: 15, shares: 9 })).toBe(64);
  });

  it('không có gì để cộng thì trả undefined, không trả 0', () => {
    expect(totalEngagements(base)).toBeUndefined();
  });

  it('tỷ lệ tương tác tính trên số người tiếp cận', () => {
    expect(engagementRate({ ...base, reach: 800, engagements: 64 })).toBe(8);
    expect(engagementRate({ ...base, impressions: 1000, engagements: 55 })).toBe(5.5);
  });

  it('thiếu mẫu số thì không bịa tỷ lệ', () => {
    expect(engagementRate({ ...base, engagements: 10 })).toBeUndefined();
    expect(engagementRate({ ...base, reach: 0, engagements: 10 })).toBeUndefined();
  });

  it('phân biệt chưa đọc được với bằng 0', () => {
    expect(hasMetrics(base)).toBe(false);
    expect(hasMetrics({ ...base, unavailable: 'Token hết hạn' })).toBe(false);
    expect(hasMetrics({ ...base, reach: 0 })).toBe(true);
  });

  it('mô tả một dòng nêu lý do khi không đọc được', () => {
    expect(describeInsights({ ...base, unavailable: 'Token hết hạn' })).toBe('Token hết hạn');
    expect(describeInsights(base)).toBe('Chưa có số liệu');
    expect(describeInsights({ ...base, reach: 800, engagements: 64 })).toBe(
      '800 người tiếp cận · 64 tương tác · 8%',
    );
  });
});

describe('làm mới số liệu trong nhật ký', () => {
  const memoryStore = (seed: PublishLedgerEntry[]) => {
    const rows = new Map(seed.map((entry) => [entry.fingerprint, entry]));
    const store: LedgerStore & { rows: typeof rows } = {
      rows,
      readAll: async () => [...rows.values()],
      put: async (entry) => { rows.set(entry.fingerprint, entry); },
    };
    return store;
  };

  const entry = (over: Partial<PublishLedgerEntry> = {}): PublishLedgerEntry => ({
    fingerprint: 'fp1',
    channelId: 'facebook-page',
    textPreview: 'x',
    status: 'success',
    startedAt: 0,
    postId: 'p1',
    ...over,
  });

  it('chỉ đọc số liệu cho bài đã đăng thành công và có postId', async () => {
    const store = memoryStore([
      entry(),
      entry({ fingerprint: 'fp2', status: 'failed' }),
      entry({ fingerprint: 'fp3', postId: undefined }),
    ]);
    const fetchInsights = vi.fn().mockResolvedValue({ channelId: 'facebook-page', postId: 'p1', fetchedAt: 1, reach: 10 });

    const result = await refreshInsights(() => creds, {
      store,
      fetchInsights: fetchInsights as never,
      now: () => 1000,
    });

    expect(fetchInsights).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(store.rows.get('fp1')?.insights?.reach).toBe(10);
  });

  it('bỏ qua bản ghi vừa đọc gần đây, tránh gọi mạng thừa', async () => {
    const store = memoryStore([
      entry({ insights: { channelId: 'facebook-page', postId: 'p1', fetchedAt: 900, reach: 5 } }),
    ]);
    const fetchInsights = vi.fn();

    await refreshInsights(() => creds, {
      store,
      fetchInsights: fetchInsights as never,
      now: () => 1000,
      staleAfterMs: 500,
    });

    expect(fetchInsights).not.toHaveBeenCalled();
  });

  it('bản ghi cũ quá ngưỡng thì đọc lại', async () => {
    const store = memoryStore([
      entry({ insights: { channelId: 'facebook-page', postId: 'p1', fetchedAt: 0, reach: 5 } }),
    ]);
    const fetchInsights = vi.fn().mockResolvedValue({ channelId: 'facebook-page', postId: 'p1', fetchedAt: 1000, reach: 99 });

    await refreshInsights(() => creds, {
      store,
      fetchInsights: fetchInsights as never,
      now: () => 1000,
      staleAfterMs: 500,
    });

    expect(fetchInsights).toHaveBeenCalledTimes(1);
    expect(store.rows.get('fp1')?.insights?.reach).toBe(99);
  });

  it('lấy đúng token theo từng kênh', async () => {
    const store = memoryStore([entry(), entry({ fingerprint: 'fp2', channelId: 'threads', postId: 'm1' })]);
    const nhan: string[] = [];
    const fetchInsights = vi.fn().mockImplementation(async (channelId: string, postId: string, c: { accessToken?: string }) => {
      nhan.push(`${channelId}:${c.accessToken}`);
      return { channelId, postId, fetchedAt: 1 };
    });

    await refreshInsights(
      (channelId) => ({ accessToken: `tok-${channelId}` }),
      { store, fetchInsights: fetchInsights as never, now: () => 1000 },
    );

    expect(nhan.sort()).toEqual(['facebook-page:tok-facebook-page', 'threads:tok-threads']);
  });

  it('kho hỏng thì trả rỗng chứ không ném lỗi', async () => {
    const hong: LedgerStore = {
      readAll: async () => { throw new Error('hỏng'); },
      put: async () => {},
    };
    expect(await refreshInsights(() => creds, { store: hong })).toEqual([]);
  });
});
