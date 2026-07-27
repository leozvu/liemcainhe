import { describe, expect, it } from 'vitest';
import {
  ReviewQueueItem,
  buildReviewQueue,
  decideBatch,
  groupQueueByDay,
  groupQueueByProject,
  partitionForBatch,
} from '../services/reviewQueueService';
import { ArticleStore } from '../services/content/articleLibraryService';
import { createDefaultBrief } from '../services/content/contentAxes';
import { SavedArticle } from '../types/content';

const DAY = 24 * 60 * 60 * 1000;

const item = (over: Partial<ReviewQueueItem> = {}): ReviewQueueItem => ({
  id: 'article:a1',
  kind: 'article',
  sourceId: 'a1',
  title: 'Bài sạch',
  updatedAt: 1,
  decision: 'pending',
  signals: [{ label: 'Brand Kit', status: 'pass', detail: '96/100' }],
  blocked: false,
  ...over,
});

const brief = createDefaultBrief('Chủ đề');

/** Thân bài đủ dài để tín hiệu "Độ dài" báo pass — nếu không nó warn thật, và đúng. */
const bodyOfTargetLength = (): string => Array.from({ length: brief.targetWords }, () => 'chữ').join(' ');

const article = (over: Partial<SavedArticle> = {}): SavedArticle => ({
  id: 'a1',
  title: 'Bài sạch',
  createdAt: 1,
  updatedAt: 1,
  brief,
  draft: {
    title: 'Bài sạch',
    sapo: 'Mở bài.',
    sections: [{ heading: 'A', body: bodyOfTargetLength() }],
    hashtags: [],
    seoTitle: 'x',
    metaDescription: 'y',
    readingMinutes: 1,
  },
  review: { decision: 'pending' },
  ...over,
});

const memoryStore = (seed: SavedArticle[] = []): ArticleStore => {
  const items = [...seed];
  return {
    readAll: async () => [...items],
    put: async (next) => {
      const index = items.findIndex((row) => row.id === next.id);
      if (index >= 0) items[index] = next;
      else items.push(next);
    },
    remove: async (id) => {
      const index = items.findIndex((row) => row.id === id);
      if (index >= 0) items.splice(index, 1);
    },
  };
};

describe('tách mục duyệt hàng loạt được', () => {
  it('mục sạch mọi tín hiệu thì duyệt hàng loạt được', () => {
    const { eligible } = partitionForBatch([item()]);
    expect(eligible).toHaveLength(1);
  });

  it('có một cảnh báo là phải mở ra quyết riêng — đây là cả điểm của thiết kế', () => {
    const { eligible, needsAttention } = partitionForBatch([
      item({ signals: [{ label: 'Brand Kit', status: 'warn', detail: 'Chưa kiểm' }] }),
    ]);
    expect(eligible).toEqual([]);
    expect(needsAttention).toHaveLength(1);
  });

  it('bị chặn thì không bao giờ lọt vào danh sách hàng loạt', () => {
    const { eligible } = partitionForBatch([item({ blocked: true })]);
    expect(eligible).toEqual([]);
  });

  it('một tín hiệu fail giữa nhiều tín hiệu pass vẫn bị loại', () => {
    const { eligible } = partitionForBatch([
      item({
        signals: [
          { label: 'Brand Kit', status: 'pass' },
          { label: 'Độ dài', status: 'fail' },
        ],
      }),
    ]);
    expect(eligible).toEqual([]);
  });

  it('không có tín hiệu nào thì KHÔNG coi là sạch — chưa kiểm khác với đã kiểm và đạt', () => {
    const { eligible, needsAttention } = partitionForBatch([item({ signals: [] })]);
    expect(eligible).toEqual([]);
    expect(needsAttention).toHaveLength(1);
  });

  it('video không duyệt hàng loạt được ở đây', () => {
    const { eligible } = partitionForBatch([
      item({ kind: 'video', signals: [{ label: 'Vòng duyệt', status: 'pass' }] }),
    ]);
    expect(eligible).toEqual([]);
  });

  it('mục đã quyết rồi thì không nằm trong nhóm nào', () => {
    const { eligible, needsAttention } = partitionForBatch([item({ decision: 'approved' })]);
    expect(eligible).toEqual([]);
    expect(needsAttention).toEqual([]);
  });
});

describe('bài thật đi qua buildReviewQueue', () => {
  /**
   * Test này tồn tại vì các test phía trên tự dựng ReviewQueueItem, nên không
   * bắt được chuyện tín hiệu thật trông thế nào. Bản đầu tiên của
   * partitionForBatch đòi MỌI tín hiệu phải `pass`, mà tín hiệu "Ảnh" luôn
   * `warn` khi bài không có ảnh — bài đăng dạng chữ thì gần như không bao giờ
   * có. Kết quả: không bài nào duyệt hàng loạt được, tính năng chết ngay từ
   * đầu. Chỉ mở trình duyệt lên mới thấy.
   */
  it('bài sạch Brand Kit và không có ảnh vẫn duyệt hàng loạt được', async () => {
    const clean = article({
      id: 'a1',
      compliance: { passed: true, score: 96, violations: [], warnings: [] },
    });

    const queue = await buildReviewQueue({
      articles: async () => [clean],
      projects: async () => [],
    });

    expect(queue).toHaveLength(1);
    // Đúng là có tín hiệu warn về ảnh — nhưng nó là advisory.
    expect(queue[0].signals.some((signal) => signal.label === 'Ảnh' && signal.status === 'warn')).toBe(true);

    const { eligible } = partitionForBatch(queue);
    expect(eligible).toHaveLength(1);
  });

  it('bài vi phạm Brand Kit thì vẫn không lọt vào duyệt hàng loạt', async () => {
    const queue = await buildReviewQueue({
      articles: async () => [
        article({ id: 'a2', compliance: { passed: false, score: 40, violations: ['Chứa từ cấm'], warnings: [] } }),
      ],
      projects: async () => [],
    });

    expect(partitionForBatch(queue).eligible).toEqual([]);
  });

  it('bài chưa kiểm Brand Kit thì phải mở ra quyết riêng', async () => {
    const queue = await buildReviewQueue({
      articles: async () => [article({ id: 'a3', compliance: undefined })],
      projects: async () => [],
    });

    const { eligible, needsAttention } = partitionForBatch(queue);
    expect(eligible).toEqual([]);
    expect(needsAttention).toHaveLength(1);
  });
});

describe('ghi quyết định hàng loạt', () => {
  it('duyệt được nhiều bài một lượt', async () => {
    const store = memoryStore([article({ id: 'a1' }), article({ id: 'a2', title: 'Bài hai' })]);
    const results = await decideBatch(
      [item({ id: 'article:a1', sourceId: 'a1' }), item({ id: 'article:a2', sourceId: 'a2' })],
      'approved',
      { store, now: () => 500 },
    );

    expect(results.every((row) => row.ok)).toBe(true);
    const saved = await store.readAll();
    expect(saved.every((row) => row.review?.decision === 'approved')).toBe(true);
    expect(saved.every((row) => row.review?.schemaVersion === 2)).toBe(true);
    expect(saved.every((row) => row.review?.mode === 'batch')).toBe(true);
    expect(saved.every((row) => row.review?.role === 'account')).toBe(true);
    expect(saved.every((row) => row.review?.opened === false)).toBe(true);
    expect(saved.every((row) => row.review?.gate === 'content-internal')).toBe(true);
  });

  it('một bài hỏng không làm dừng các bài còn lại', async () => {
    const store = memoryStore([article({ id: 'a1' })]);
    const results = await decideBatch(
      [item({ sourceId: 'khong-co', id: 'article:x' }), item({ sourceId: 'a1', id: 'article:a1' })],
      'approved',
      { store },
    );

    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('Không tìm thấy');
    expect(results[1].ok).toBe(true);
  });

  it('hàng rào Brand Kit vẫn chặn kể cả khi lọt vào danh sách hàng loạt', async () => {
    const store = memoryStore([
      article({ id: 'a1', compliance: { passed: false, score: 40, violations: ['Chứa từ cấm'], warnings: [] } }),
    ]);
    const results = await decideBatch([item({ sourceId: 'a1' })], 'approved', { store });

    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('Brand Kit');
  });

  it('ghi được cả quyết định yêu cầu sửa, kèm ghi chú chung', async () => {
    const store = memoryStore([article({ id: 'a1' })]);
    await decideBatch([item({ sourceId: 'a1' })], 'changes-requested', {
      store,
      note: 'Sửa lại câu mở',
      now: () => 7,
    });

    const saved = (await store.readAll())[0];
    expect(saved.review?.decision).toBe('changes-requested');
    expect(saved.review?.note).toBe('Sửa lại câu mở');
  });

  it('video trong lô thì báo rõ lý do thay vì im lặng bỏ qua', async () => {
    const results = await decideBatch([item({ kind: 'video' })], 'approved', {
      loadArticles: async () => [],
    });
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('Trung tâm sản xuất');
  });

  it('danh sách rỗng thì không nổ', async () => {
    expect(await decideBatch([], 'approved', { loadArticles: async () => [] })).toEqual([]);
  });
});

describe('gom nhóm', () => {
  const now = new Date('2026-07-26T10:00:00').getTime();

  it('gọi đúng hôm nay và hôm qua', () => {
    const groups = groupQueueByDay(
      [item({ id: '1', updatedAt: now }), item({ id: '2', updatedAt: now - DAY })],
      now,
    );
    expect(groups[0].label).toBe('Hôm nay');
    expect(groups[1].label).toBe('Hôm qua');
  });

  it('ngày cũ hơn thì hiện ngày tháng', () => {
    const groups = groupQueueByDay([item({ updatedAt: now - 5 * DAY })], now);
    // Dấu phân cách khác nhau giữa Node và trình duyệt (21-07 với 21/07), nên
    // chỉ kiểm ngày và tháng, không kiểm dấu.
    expect(groups[0].label).toMatch(/^\d{2}\D\d{2}$/);
    expect(groups[0].label).not.toBe('Hôm nay');
  });

  it('nhiều mục cùng ngày nằm chung một nhóm', () => {
    const groups = groupQueueByDay(
      [item({ id: '1', updatedAt: now }), item({ id: '2', updatedAt: now - 3600_000 })],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });

  it('gom theo dự án, mục không thuộc dự án nào vẫn có chỗ', () => {
    const groups = groupQueueByProject([
      item({ id: '1', projectId: 'p1', projectTitle: 'Chiến dịch A' }),
      item({ id: '2' }),
    ]);
    expect(groups.map((group) => group.label)).toContain('Chiến dịch A');
    expect(groups.map((group) => group.label)).toContain('Không thuộc dự án nào');
  });
});
