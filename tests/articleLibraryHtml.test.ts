import { describe, expect, it } from 'vitest';
import {
  ArticleStore,
  findPublishRecords,
  listArticles,
  saveArticle,
  searchArticles,
} from '../services/content/articleLibraryService';
import {
  ARTICLE_LAYOUTS,
  escapeHtml,
  renderArticleHtml,
} from '../services/content/articleHtmlService';
import { fingerprintPost, PublishLedgerEntry } from '../services/content/publishLedgerService';
import { CHANNEL_LIMITS, toPostText } from '../services/content/publishService';
import { createDefaultBrief } from '../services/content/contentAxes';
import { normalizeBrandKit } from '../services/brandKitService';
import { ArticleDraft, SavedArticle } from '../types/content';

const draft: ArticleDraft = {
  title: 'Giá vàng lập đỉnh',
  sapo: 'Ba lý do đứng sau.',
  sections: [
    { heading: 'Chuyện gì', body: 'Đoạn một.\n\nĐoạn hai có\nxuống dòng đơn.' },
    { heading: 'Vì sao', body: 'Lãi suất hạ.' },
  ],
  hashtags: ['gia_vang', 'lai_suat'],
  seoTitle: 'Giá vàng lập đỉnh',
  metaDescription: 'Ba lý do.',
  readingMinutes: 2,
};

const brief = createDefaultBrief('Giá vàng lập đỉnh');

const memoryStore = (seed: SavedArticle[] = []) => {
  const rows = new Map(seed.map((item) => [item.id, item]));
  const store: ArticleStore & { rows: typeof rows } = {
    rows,
    readAll: async () => [...rows.values()],
    put: async (article) => { rows.set(article.id, article); },
    remove: async (id) => { rows.delete(id); },
  };
  return store;
};

describe('thư viện bài viết', () => {
  it('lưu bài mới kèm nguồn gốc dự án', async () => {
    const store = memoryStore();
    const saved = await saveArticle(draft, brief, {
      store,
      now: () => 1000,
      projectId: 'p1',
      projectTitle: 'Chiến dịch A',
    });

    expect(saved.title).toBe('Giá vàng lập đỉnh');
    expect(saved.createdAt).toBe(1000);
    expect(saved.projectTitle).toBe('Chiến dịch A');
    expect(store.rows.size).toBe(1);
  });

  it('ghi đè giữ nguyên thời điểm tạo, chỉ đổi thời điểm sửa', async () => {
    const store = memoryStore();
    const first = await saveArticle(draft, brief, { store, now: () => 1000 });
    const second = await saveArticle(
      { ...draft, title: 'Tiêu đề mới' },
      brief,
      { store, now: () => 5000, existingId: first.id },
    );

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(1000);
    expect(second.updatedAt).toBe(5000);
    expect(second.title).toBe('Tiêu đề mới');
    expect(store.rows.size).toBe(1);
  });

  it('bài không tiêu đề thì lấy chủ đề làm tên', async () => {
    const store = memoryStore();
    const saved = await saveArticle({ ...draft, title: '' }, brief, { store, now: () => 1 });
    expect(saved.title).toBe(brief.topic);
  });

  it('xếp bài mới sửa lên trước', async () => {
    const store = memoryStore();
    await saveArticle({ ...draft, title: 'Cũ' }, brief, { store, now: () => 100 });
    await saveArticle({ ...draft, title: 'Mới' }, brief, { store, now: () => 900 });
    expect((await listArticles(store)).map((a) => a.title)).toEqual(['Mới', 'Cũ']);
  });

  it('kho hỏng thì trả mảng rỗng chứ không ném lỗi', async () => {
    const hong: ArticleStore = {
      readAll: async () => { throw new Error('hỏng'); },
      put: async () => {},
      remove: async () => {},
    };
    expect(await listArticles(hong)).toEqual([]);
  });
});

describe('tìm bài không cần bỏ dấu', () => {
  const articles: SavedArticle[] = [
    { id: '1', title: 'Giá vàng lập đỉnh', createdAt: 1, updatedAt: 1, brief, draft },
    {
      id: '2',
      title: 'Chuyện nghề quảng cáo',
      createdAt: 2,
      updatedAt: 2,
      brief: createDefaultBrief('Quảng cáo'),
      draft: { ...draft, title: 'Chuyện nghề quảng cáo', hashtags: ['marketing'] },
    },
  ];

  it('gõ không dấu vẫn tìm ra bài có dấu', () => {
    expect(searchArticles(articles, 'gia vang').map((a) => a.id)).toEqual(['1']);
    expect(searchArticles(articles, 'quang cao').map((a) => a.id)).toEqual(['2']);
  });

  it('gõ có dấu vẫn tìm được', () => {
    expect(searchArticles(articles, 'Giá vàng').map((a) => a.id)).toEqual(['1']);
  });

  it('tìm được theo hashtag và theo chữ đ', () => {
    expect(searchArticles(articles, 'marketing').map((a) => a.id)).toEqual(['2']);
    expect(searchArticles(articles, 'lap dinh').map((a) => a.id)).toEqual(['1']);
  });

  it('truy vấn rỗng thì trả về tất cả', () => {
    expect(searchArticles(articles, '   ')).toHaveLength(2);
  });
});

describe('đối chiếu với nhật ký đăng bài', () => {
  const article: SavedArticle = { id: '1', title: 'x', createdAt: 1, updatedAt: 1, brief, draft };

  const entryFor = (channelId: 'facebook-page' | 'threads', accountId?: string): PublishLedgerEntry => ({
    fingerprint: fingerprintPost(channelId, accountId, toPostText(draft, CHANNEL_LIMITS[channelId])),
    channelId,
    accountId,
    textPreview: 'x',
    status: 'success',
    startedAt: 1,
  });

  it('nhận ra bài đã đăng trên kênh nào', () => {
    const found = findPublishRecords(article, [entryFor('facebook-page', '123')]);
    expect(found).toHaveLength(1);
    expect(found[0].channelId).toBe('facebook-page');
  });

  it('không tính bản ghi thất bại hay còn treo', () => {
    const failed = { ...entryFor('facebook-page', '1'), status: 'failed' as const };
    const pending = { ...entryFor('threads', '1'), status: 'pending' as const };
    expect(findPublishRecords(article, [failed, pending])).toEqual([]);
  });

  it('bài khác nội dung thì không bị nhận nhầm là đã đăng', () => {
    const khac: SavedArticle = { ...article, draft: { ...draft, title: 'Tiêu đề hoàn toàn khác' } };
    expect(findPublishRecords(khac, [entryFor('facebook-page', '1')])).toEqual([]);
  });
});

describe('dàn trang HTML', () => {
  it('thoát ký tự để nội dung không phá cấu trúc trang', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
  });

  it('tiêu đề chứa thẻ HTML bị vô hiệu hoá trong trang xuất ra', () => {
    const doc = renderArticleHtml({ ...draft, title: '<img src=x onerror=alert(1)>' });
    expect(doc).not.toContain('<img src=x onerror');
    expect(doc).toContain('&lt;img src=x onerror');
  });

  it('dựng trang độc lập, không phụ thuộc tệp ngoài', () => {
    const doc = renderArticleHtml(draft);
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('lang="vi"');
    expect(doc).toContain('<title>Giá vàng lập đỉnh</title>');
    expect(doc).toContain('name="description" content="Ba lý do."');
    // Không được tham chiếu ra ngoài.
    expect(doc).not.toMatch(/<link[^>]+href="http/);
    expect(doc).not.toMatch(/<script/);
  });

  it('tách đoạn theo dòng trống, giữ xuống dòng đơn thành br', () => {
    const doc = renderArticleHtml(draft);
    expect(doc).toContain('<p>Đoạn một.</p>');
    expect(doc).toContain('Đoạn hai có<br>xuống dòng đơn.');
  });

  it('lấy màu và font từ Brand Kit', () => {
    const kit = normalizeBrandKit({
      colors: [{ name: 'Chính', hex: '#79E6DF' }],
      fonts: ['Manrope'],
    } as never);
    const doc = renderArticleHtml(draft, { brandKit: kit });
    expect(doc).toContain('#79E6DF');
    expect(doc).toContain('Manrope');
  });

  it('Brand Kit rỗng vẫn ra trang dùng được', () => {
    const doc = renderArticleHtml(draft, { brandKit: null });
    expect(doc).toContain('<h1>');
    expect(doc).toContain('Be Vietnam Pro');
  });

  it('mỗi bố cục cho ra CSS khác nhau', () => {
    const docs = ARTICLE_LAYOUTS.map((item) => renderArticleHtml(draft, { layout: item.value }));
    expect(new Set(docs).size).toBe(ARTICLE_LAYOUTS.length);
    expect(renderArticleHtml(draft, { layout: 'card' })).toContain('section class="block"');
  });

  it('chèn ảnh đã vẽ xong, bỏ qua ảnh chưa vẽ', () => {
    const coAnh: ArticleDraft = {
      ...draft,
      illustrations: [
        { id: '1', purpose: 'cover', prompt: 'p', altText: 'Ảnh bìa', aspectRatio: '16:9', status: 'done', imageUrl: 'data:image/png;base64,AAA' },
        { id: '2', purpose: 'section', sectionIndex: 0, prompt: 'p', altText: 'Chưa vẽ', aspectRatio: '1:1', status: 'draft' },
      ],
    };
    const doc = renderArticleHtml(coAnh);
    expect(doc).toContain('alt="Ảnh bìa"');
    expect(doc).not.toContain('alt="Chưa vẽ"');
  });

  it('tắt được phần ảnh khi cần bản chỉ chữ', () => {
    const coAnh: ArticleDraft = {
      ...draft,
      illustrations: [
        { id: '1', purpose: 'cover', prompt: 'p', altText: 'Ảnh bìa', aspectRatio: '16:9', status: 'done', imageUrl: 'u' },
      ],
    };
    expect(renderArticleHtml(coAnh, { includeImages: false })).not.toContain('alt="Ảnh bìa"');
  });
});
