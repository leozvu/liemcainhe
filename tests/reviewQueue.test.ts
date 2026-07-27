import { describe, expect, it } from 'vitest';
import {
  buildReviewQueue,
  countQueue,
  decideArticle,
  fingerprintReviewArtifact,
  filterQueue,
} from '../services/reviewQueueService';
import { ArticleStore, saveArticle } from '../services/content/articleLibraryService';
import { createDefaultBrief } from '../services/content/contentAxes';
import { ArticleDraft, SavedArticle } from '../types/content';
import { ProjectState } from '../types';

const draft: ArticleDraft = {
  title: 'Giá vàng lập đỉnh',
  sapo: 'Ba lý do.',
  sections: [{ heading: 'A', body: 'Một hai ba bốn năm sáu bảy tám chín mười.' }],
  hashtags: ['gia_vang'],
  seoTitle: 'Giá vàng',
  metaDescription: 'Ba lý do.',
  readingMinutes: 1,
};

const brief = { ...createDefaultBrief('Giá vàng'), targetWords: 10 };

const article = (over: Partial<SavedArticle> = {}): SavedArticle => ({
  id: 'a1',
  title: 'Giá vàng lập đỉnh',
  createdAt: 1,
  updatedAt: 100,
  projectId: 'p1',
  projectTitle: 'Chiến dịch A',
  brief,
  draft,
  ...over,
});

const memoryStore = (seed: SavedArticle[] = []) => {
  const rows = new Map(seed.map((item) => [item.id, item]));
  const store: ArticleStore & { rows: typeof rows } = {
    rows,
    readAll: async () => [...rows.values()],
    put: async (item) => { rows.set(item.id, item); },
    remove: async (id) => { rows.delete(id); },
  };
  return store;
};

const noProjects = async () => [] as ProjectState[];

describe('dựng hàng đợi', () => {
  it('bài chưa quyết thì nằm ở chờ duyệt', async () => {
    const queue = await buildReviewQueue({
      articles: async () => [article()],
      projects: noProjects,
    });
    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe('article');
    expect(queue[0].decision).toBe('pending');
    expect(queue[0].projectTitle).toBe('Chiến dịch A');
  });

  it('vi phạm Brand Kit thì bị chặn, không chỉ cảnh báo', async () => {
    const queue = await buildReviewQueue({
      articles: async () => [
        article({
          compliance: { score: 40, passed: false, violations: ['Có từ cấm: “bao lãi”'], warnings: [] },
        }),
      ],
      projects: noProjects,
    });
    expect(queue[0].blocked).toBe(true);
    expect(queue[0].signals.find((s) => s.label === 'Brand Kit')?.status).toBe('fail');
  });

  it('đạt Brand Kit thì không bị chặn', async () => {
    const queue = await buildReviewQueue({
      articles: async () => [
        article({ compliance: { score: 100, passed: true, violations: [], warnings: [] } }),
      ],
      projects: noProjects,
    });
    expect(queue[0].blocked).toBe(false);
  });

  it('không có Brand Kit thì cảnh báo chứ không chặn', async () => {
    const queue = await buildReviewQueue({ articles: async () => [article()], projects: noProjects });
    const signal = queue[0].signals.find((s) => s.label === 'Brand Kit');
    expect(signal?.status).toBe('warn');
    expect(queue[0].blocked).toBe(false);
  });

  it('nhắc khi độ dài lệch quá xa yêu cầu', async () => {
    const dai = { ...draft, sections: [{ heading: 'A', body: 'từ '.repeat(200) }] };
    const queue = await buildReviewQueue({
      articles: async () => [article({ draft: dai })],
      projects: noProjects,
    });
    expect(queue[0].signals.find((s) => s.label === 'Độ dài')?.status).toBe('warn');
  });

  it('báo chưa có ảnh nào', async () => {
    const queue = await buildReviewQueue({ articles: async () => [article()], projects: noProjects });
    expect(queue[0].signals.find((s) => s.label === 'Ảnh')?.detail).toBe('Chưa có ảnh nào');
  });

  it('xếp mục mới nhất lên trước', async () => {
    const queue = await buildReviewQueue({
      articles: async () => [
        article({ id: 'cu', title: 'Cũ', updatedAt: 10 }),
        article({ id: 'moi', title: 'Mới', updatedAt: 900 }),
      ],
      projects: noProjects,
    });
    expect(queue.map((item) => item.title)).toEqual(['Mới', 'Cũ']);
  });

  it('một nguồn hỏng không làm sập cả hàng đợi', async () => {
    const queue = await buildReviewQueue({
      articles: async () => { throw new Error('kho hỏng'); },
      projects: noProjects,
    });
    expect(queue).toEqual([]);
  });

  it('dự án không có vòng duyệt thì không xuất hiện', async () => {
    const queue = await buildReviewQueue({
      articles: async () => [],
      projects: async () => [{ id: 'p1', title: 'Dự án', agencyReview: { rounds: [] } } as never],
    });
    expect(queue).toEqual([]);
  });
});

describe('lọc và đếm', () => {
  const items = [
    { decision: 'pending', blocked: false },
    { decision: 'pending', blocked: true },
    { decision: 'approved', blocked: false },
    { decision: 'changes-requested', blocked: true },
  ].map((over, i) => ({
    id: `i${i}`, kind: 'article' as const, sourceId: `a${i}`, title: 't',
    updatedAt: i, signals: [], ...over,
  })) as never[];

  it('đếm đúng từng trạng thái', () => {
    const counts = countQueue(items);
    expect(counts).toMatchObject({ total: 4, pending: 2, approved: 1, changesRequested: 1, blocked: 2 });
  });

  it('lọc theo trạng thái, "all" giữ nguyên', () => {
    expect(filterQueue(items, 'pending')).toHaveLength(2);
    expect(filterQueue(items, 'approved')).toHaveLength(1);
    expect(filterQueue(items, 'all')).toHaveLength(4);
  });
});

describe('ghi quyết định', () => {
  const dat = { score: 100, passed: true, violations: [], warnings: [] };

  it('duyệt được bài đạt chuẩn và ghi xuống kho', async () => {
    const store = memoryStore([article({ compliance: dat })]);
    const updated = await decideArticle(article({ compliance: dat }), 'approved', {
      store,
      now: () => 500,
      reviewer: 'Leo',
    });

    expect(updated.review?.decision).toBe('approved');
    expect(updated.review?.decidedAt).toBe(500);
    expect(store.rows.get('a1')?.review?.decision).toBe('approved');
    expect(store.rows.get('a1')?.review?.reviewer).toBe('Leo');
    expect(updated.review).toMatchObject({
      schemaVersion: 2,
      mode: 'individual',
      role: 'account',
      opened: true,
      gate: 'content-internal',
    });
    expect(updated.review?.artifactVersion).toBe(fingerprintReviewArtifact(updated));
  });

  it('ghi đúng nguồn quyết định khách hàng đại diện, không suy đoán lại ở Client Memory', async () => {
    const updated = await decideArticle(article({ compliance: dat }), 'approved', {
      store: memoryStore(),
      mode: 'client-portal',
      role: 'client-proxy',
      opened: true,
      gate: 'content-client',
    });

    expect(updated.review).toMatchObject({
      schemaVersion: 2,
      mode: 'client-portal',
      role: 'client-proxy',
      opened: true,
      gate: 'content-client',
    });
  });

  it('vân tay review ổn định khi nội dung giữ nguyên và đổi khi draft đổi', () => {
    const original = article();
    const sameContent = article({ updatedAt: 999 });
    const changed = article({ draft: { ...draft, title: 'Một phiên bản nội dung khác' } });

    expect(fingerprintReviewArtifact(original)).toBe(fingerprintReviewArtifact(sameContent));
    expect(fingerprintReviewArtifact(original)).not.toBe(fingerprintReviewArtifact(changed));
  });

  it('KHÔNG duyệt được bài vi phạm Brand Kit', async () => {
    await expect(
      decideArticle(
        article({ compliance: { score: 30, passed: false, violations: ['từ cấm'], warnings: [] } }),
        'approved',
      ),
    ).rejects.toThrow(/vi phạm Brand Kit/);
  });

  it('vẫn yêu cầu sửa được với bài vi phạm', async () => {
    const viPham = article({ compliance: { score: 30, passed: false, violations: ['từ cấm'], warnings: [] } });
    const store = memoryStore([viPham]);
    const updated = await decideArticle(viPham, 'changes-requested', {
      store,
      note: 'Bỏ từ cấm ở đoạn hai',
    });
    expect(updated.review?.decision).toBe('changes-requested');
    expect(updated.review?.note).toBe('Bỏ từ cấm ở đoạn hai');
  });
});

describe('lỗ hổng bàn duyệt phải bịt', () => {
  it('sửa nội dung sau khi duyệt thì mất hiệu lực phê duyệt', async () => {
    const store = memoryStore();

    const daDuyet = await saveArticle(draft, brief, {
      store,
      now: () => 100,
      review: { decision: 'approved', decidedAt: 100 },
      compliance: { score: 100, passed: true, violations: [], warnings: [] },
    });
    expect(daDuyet.review?.decision).toBe('approved');

    // Sửa một chữ rồi lưu lại cùng id.
    const daSua = await saveArticle(
      { ...draft, title: 'Tiêu đề đã bị sửa sau khi duyệt' },
      brief,
      { store, now: () => 200, existingId: daDuyet.id },
    );

    expect(daSua.review).toBeUndefined();
    expect(daSua.compliance).toBeUndefined();
  });

  it('lưu lại y nguyên nội dung thì giữ phê duyệt', async () => {
    const store = memoryStore();
    const daDuyet = await saveArticle(draft, brief, {
      store,
      now: () => 100,
      review: { decision: 'approved', decidedAt: 100 },
    });
    const luuLai = await saveArticle(draft, brief, { store, now: () => 200, existingId: daDuyet.id });
    expect(luuLai.review?.decision).toBe('approved');
  });

  it('bài đã sửa quay lại hàng đợi ở trạng thái chờ duyệt', async () => {
    const store = memoryStore();
    const daDuyet = await saveArticle(draft, brief, {
      store,
      now: () => 100,
      review: { decision: 'approved', decidedAt: 100 },
    });
    await saveArticle({ ...draft, sapo: 'Sapo mới' }, brief, {
      store,
      now: () => 200,
      existingId: daDuyet.id,
    });

    const queue = await buildReviewQueue({ articles: () => store.readAll(), projects: noProjects });
    expect(queue[0].decision).toBe('pending');
  });
});
