import { describe, expect, it, vi } from 'vitest';
import {
  MAX_EXAMPLES,
  MIN_MEMORY_DECISIONS,
  MAX_REJECTIONS,
  buildClientMemory,
  buildMemoryPromptContext,
  describeMemory,
  findEngagementRate,
  hasMemory,
  isMemoryActionable,
  memorySampleCount,
} from '../services/content/clientMemoryService';
import { PublishLedgerEntry, fingerprintPost } from '../services/content/publishLedgerService';
import { CHANNEL_LIMITS, toPostText } from '../services/content/publishService';
import { generateArticle } from '../services/content/articleService';
import { createDefaultBrief } from '../services/content/contentAxes';
import { ArticleDraft, SavedArticle } from '../types/content';

const draft = (over: Partial<ArticleDraft> = {}): ArticleDraft => ({
  title: 'Giá vàng lập đỉnh',
  sapo: 'Ba lý do đứng sau.',
  sections: [{ heading: 'Chuyện gì', body: 'Giá tăng ba phiên liên tiếp. Người mua xếp hàng.' }],
  hashtags: ['gia_vang'],
  seoTitle: 'Giá vàng',
  metaDescription: 'Ba lý do.',
  readingMinutes: 1,
  ...over,
});

const article = (over: Partial<SavedArticle> = {}): SavedArticle => ({
  id: 'a1',
  title: 'Giá vàng lập đỉnh',
  createdAt: 1,
  updatedAt: 1,
  clientId: 'c1',
  brief: createDefaultBrief('Giá vàng'),
  draft: draft(),
  ...over,
});

const approved = (id: string, over: Partial<SavedArticle> = {}) =>
  article({ id, title: `Bài ${id}`, review: { decision: 'approved' }, ...over });

/**
 * Đệm cho đủ ngưỡng tác động.
 *
 * `buildMemoryPromptContext` trả rỗng khi chưa đủ `MIN_MEMORY_DECISIONS` quyết
 * định. Các test kiểm nội dung khối ngữ cảnh phải vượt ngưỡng trước, nếu không
 * chúng chỉ đang kiểm chuỗi rỗng.
 */
const padded = (...items: SavedArticle[]): SavedArticle[] => [
  ...items,
  ...Array.from({ length: MIN_MEMORY_DECISIONS }, (_, index) => approved(`pad${index}`)),
];

describe('gom trí nhớ theo khách', () => {
  it('chỉ lấy bài của đúng khách', () => {
    const memory = buildClientMemory(
      [approved('a'), approved('b', { clientId: 'c2' })],
      { clientId: 'c1' },
    );
    expect(memory.approvedCount).toBe(1);
    expect(memory.approved[0].title).toBe('Bài a');
  });

  it('không nêu khách thì gom tất cả, để dữ liệu cũ chưa gắn khách vẫn dùng được', () => {
    const memory = buildClientMemory([approved('a'), approved('b', { clientId: undefined })]);
    expect(memory.approvedCount).toBe(2);
  });

  it('bỏ qua bài chưa duyệt và bài đang chờ', () => {
    const memory = buildClientMemory(padded(
      approved('a'),
      article({ id: 'b' }),
      article({ id: 'c', review: { decision: 'pending' } }),
    ));
    // `padded` thêm MIN_MEMORY_DECISIONS bài đã duyệt; chỉ 'a' là của test này.
    expect(memory.approvedCount).toBe(1 + MIN_MEMORY_DECISIONS);
  });

  it('đếm đủ nhưng chỉ đưa vài mẫu vào prompt', () => {
    const many = Array.from({ length: 10 }, (_, i) => approved(`a${i}`));
    const memory = buildClientMemory(many);
    expect(memory.approvedCount).toBe(10);
    expect(memory.approved).toHaveLength(MAX_EXAMPLES);
  });

  it('bài bị yêu cầu sửa chỉ tính khi có ghi lý do', () => {
    const memory = buildClientMemory(padded(
      article({ id: 'a', review: { decision: 'changes-requested', note: 'Sapo quá dài' } }),
      article({ id: 'b', review: { decision: 'changes-requested' } }),
    ));
    expect(memory.rejectedCount).toBe(2);
    expect(memory.rejected).toHaveLength(1);
    expect(memory.rejected[0].reason).toBe('Sapo quá dài');
  });

  it('giới hạn số lý do đưa vào prompt', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      article({ id: `r${i}`, review: { decision: 'changes-requested', note: `Lý do ${i}` } }),
    );
    expect(buildClientMemory(many).rejected).toHaveLength(MAX_REJECTIONS);
  });

  it('thư viện rỗng thì không có trí nhớ', () => {
    const memory = buildClientMemory([]);
    expect(hasMemory(memory)).toBe(false);
    expect(describeMemory(memory)).toContain('Chưa có bài nào');
  });
});

describe('xếp bài chạy tốt lên trước', () => {
  const withInsights = (id: string, d: ArticleDraft, rate: number): [SavedArticle, PublishLedgerEntry] => {
    const art = approved(id, { draft: d });
    const limit = CHANNEL_LIMITS['facebook-page'];
    return [
      art,
      {
        fingerprint: fingerprintPost('facebook-page', '1', toPostText(d, limit)),
        channelId: 'facebook-page',
        accountId: '1',
        textPreview: 'x',
        status: 'success',
        startedAt: 1,
        postId: `p-${id}`,
        insights: {
          channelId: 'facebook-page',
          postId: `p-${id}`,
          fetchedAt: 1,
          reach: 1000,
          engagements: rate * 10,
        },
      },
    ];
  };

  it('bài tương tác cao đứng trước bài tương tác thấp', () => {
    const [lowArt, lowEntry] = withInsights('thap', draft({ title: 'Thấp' }), 2);
    const [highArt, highEntry] = withInsights('cao', draft({ title: 'Cao', sapo: 'Khác hẳn.' }), 9);

    const memory = buildClientMemory([lowArt, highArt], { ledger: [lowEntry, highEntry] });
    expect(memory.approved[0].engagementRate).toBeGreaterThan(memory.approved[1].engagementRate!);
  });

  it('bài đã đo được xếp trước bài chưa đo, nhưng bài chưa đo vẫn được dùng', () => {
    const [measured, entry] = withInsights('do', draft({ title: 'Đã đo' }), 5);
    const unmeasured = approved('chua', { draft: draft({ title: 'Chưa đo', sapo: 'Khác.' }) });

    const memory = buildClientMemory([unmeasured, measured], { ledger: [entry] });
    expect(memory.approved[0].engagementRate).toBeDefined();
    expect(memory.approved[1].engagementRate).toBeUndefined();
    expect(memory.approved).toHaveLength(2);
  });

  it('không có nhật ký thì không bịa số liệu', () => {
    expect(findEngagementRate(approved('a'), [])).toBeUndefined();
  });

  it('bản ghi thất bại không được tính là hiệu quả', () => {
    const [art, entry] = withInsights('a', draft(), 9);
    expect(findEngagementRate(art, [{ ...entry, status: 'failed' }])).toBeUndefined();
  });
});

describe('khối ngữ cảnh đưa vào prompt', () => {
  it('trí nhớ rỗng thì trả chuỗi rỗng, không nhét rác vào prompt', () => {
    expect(buildMemoryPromptContext(buildClientMemory([]))).toBe('');
  });

  it('nêu mẫu đã duyệt kèm góc tiếp cận và giọng', () => {
    const text = buildMemoryPromptContext(buildClientMemory(padded(approved('a'))));
    expect(text).toContain('TRÍ NHỚ VỀ KHÁCH HÀNG NÀY');
    expect(text).toContain('Bài a');
    expect(text).toContain('Góc tiếp cận');
    expect(text).toContain('Giọng');
  });

  it('nêu lý do từng bị yêu cầu sửa như điều cấm', () => {
    const memory = buildClientMemory(padded(
      article({ id: 'r', review: { decision: 'changes-requested', note: 'Đừng dùng từ bùng nổ' } }),
    ));
    const text = buildMemoryPromptContext(memory);
    expect(text).toContain('tuyệt đối tránh lặp lại');
    expect(text).toContain('Đừng dùng từ bùng nổ');
  });

  it('phần đã duyệt đứng trước phần bị từ chối', () => {
    const memory = buildClientMemory(padded(
      approved('a'),
      article({ id: 'r', review: { decision: 'changes-requested', note: 'Lý do X' } }),
    ));
    const text = buildMemoryPromptContext(memory);
    expect(text.indexOf('Đã duyệt')).toBeLessThan(text.indexOf('tuyệt đối tránh'));
  });
});

describe('nối vào prompt viết bài', () => {
  const draftJson = {
    title: 'x', sapo: 'y',
    sections: [{ heading: 'a', body: 'b' }],
    hashtags: [], seoTitle: 'x', metaDescription: 'y',
  };

  it('trí nhớ đi vào system prompt, sau Brand Kit', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(draftJson));
    const memory = buildClientMemory(padded(approved('a')));

    await generateArticle(createDefaultBrief('Chủ đề'), { chat: chat as never, memory });

    const sys = chat.mock.calls[0][0].systemPrompt;
    expect(sys).toContain('TRÍ NHỚ VỀ KHÁCH HÀNG NÀY');
    // Quy tắc viết tiếng Việt vẫn phải còn nguyên.
    expect(sys).toContain('Không viết hoa toàn bộ');
    expect(sys.indexOf('Không viết hoa toàn bộ')).toBeLessThan(sys.indexOf('TRÍ NHỚ'));
  });

  it('không có trí nhớ thì prompt giữ nguyên như cũ', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(draftJson));
    await generateArticle(createDefaultBrief('Chủ đề'), { chat: chat as never });
    expect(chat.mock.calls[0][0].systemPrompt).not.toContain('TRÍ NHỚ');
  });

  it('trí nhớ rỗng cũng không nhét khối trống vào prompt', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(draftJson));
    await generateArticle(createDefaultBrief('Chủ đề'), {
      chat: chat as never,
      memory: buildClientMemory([]),
    });
    expect(chat.mock.calls[0][0].systemPrompt).not.toContain('TRÍ NHỚ');
  });
});

describe('mô tả một dòng', () => {
  it('nêu số bài đã học và số lần bị yêu cầu sửa', () => {
    const memory = buildClientMemory(padded(
      approved('a'),
      article({ id: 'r', review: { decision: 'changes-requested', note: 'x' } }),
    ));
    const text = describeMemory(memory);
    expect(text).toContain('1 bài đã duyệt');
    expect(text).toContain('1 lần bị yêu cầu sửa');
  });
});

/**
 * Ngưỡng tác động, chốt trong plan vòng 2 với Codex.
 *
 * Bản đầu không có ngưỡng nào: bài được duyệt **đầu tiên** đã đi thẳng vào
 * prompt của bài thứ hai. Một quyết định thì chưa phải khuôn mẫu — có thể là
 * duyệt vội hoặc duyệt vì deadline. Học từ nó rồi nhân bản vào mọi bài sau là
 * tự củng cố một mẫu ngẫu nhiên.
 */
describe('ngưỡng trước khi trí nhớ được tác động', () => {
  const nApproved = (n: number) => Array.from({ length: n }, (_, i) => approved(`x${i}`));

  it('một quyết định thì KHÔNG vào prompt', () => {
    const memory = buildClientMemory([approved('a')]);
    expect(hasMemory(memory)).toBe(true);
    expect(isMemoryActionable(memory)).toBe(false);
    expect(buildMemoryPromptContext(memory)).toBe('');
  });

  it('9 quyết định vẫn chưa đủ — ranh giới phải chặt', () => {
    const memory = buildClientMemory(nApproved(MIN_MEMORY_DECISIONS - 1));
    expect(buildMemoryPromptContext(memory)).toBe('');
  });

  it('đúng ngưỡng thì bắt đầu tác động', () => {
    const memory = buildClientMemory(nApproved(MIN_MEMORY_DECISIONS));
    expect(isMemoryActionable(memory)).toBe(true);
    expect(buildMemoryPromptContext(memory)).toContain('TRÍ NHỚ VỀ KHÁCH HÀNG NÀY');
  });

  it('bài bị từ chối cũng tính vào mẫu, không chỉ bài được duyệt', () => {
    const rejected = Array.from({ length: MIN_MEMORY_DECISIONS }, (_, i) =>
      article({ id: `r${i}`, review: { decision: 'changes-requested', note: `Lý do ${i}` } }),
    );
    expect(memorySampleCount(buildClientMemory(rejected))).toBe(MIN_MEMORY_DECISIONS);
    expect(buildMemoryPromptContext(buildClientMemory(rejected))).not.toBe('');
  });

  it('dưới ngưỡng vẫn hiện được cho người dùng xem — chỉ là chưa điều khiển gì', () => {
    const memory = buildClientMemory([approved('a')]);
    expect(describeMemory(memory)).not.toContain('Chưa có bài nào');
  });
});
