import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ASPECT,
  countRendered,
  getCoverImage,
  normalizeIllustrationPlan,
  planIllustrations,
  renderIllustration,
} from '../services/content/illustrationService';
import { createDefaultBrief } from '../services/content/contentAxes';
import { normalizeBrandKit } from '../services/brandKitService';
import { ArticleDraft, ArticleIllustration } from '../types/content';

const draft: ArticleDraft = {
  title: 'Vì sao giá vàng lập đỉnh',
  sapo: 'Ba lý do đứng sau.',
  sections: [
    { heading: 'Chuyện gì đang xảy ra', body: 'Giá tăng ba phiên liên tiếp.' },
    { heading: 'Vì sao lúc này', body: 'Lãi suất hạ.' },
    { heading: 'Nên làm gì', body: 'Đừng mua đuổi.' },
  ],
  hashtags: ['gia_vang'],
  seoTitle: 'Giá vàng',
  metaDescription: 'Ba lý do.',
  readingMinutes: 2,
};

const brief = createDefaultBrief('Giá vàng lập đỉnh');

const plan = {
  cover: { prompt: 'Vietnamese gold shop, morning light', altText: 'Tiệm vàng buổi sáng' },
  sections: [
    { sectionIndex: 0, prompt: 'Queue outside a gold shop in Hanoi', altText: 'Người xếp hàng' },
    { sectionIndex: 1, prompt: 'Interest rate chart on a desk', altText: 'Biểu đồ lãi suất' },
  ],
};

describe('chuẩn hoá ý tưởng ảnh', () => {
  it('lấy ảnh bìa với tỷ lệ mặc định 16:9', () => {
    const result = normalizeIllustrationPlan(plan, draft, 0, 1);
    expect(result).toHaveLength(1);
    expect(result[0].purpose).toBe('cover');
    expect(result[0].aspectRatio).toBe(DEFAULT_ASPECT.cover);
    expect(result[0].status).toBe('draft');
  });

  it('tôn trọng số ảnh mục được yêu cầu', () => {
    expect(normalizeIllustrationPlan(plan, draft, 1, 1)).toHaveLength(2);
    expect(normalizeIllustrationPlan(plan, draft, 2, 1)).toHaveLength(3);
  });

  it('kẹp chỉ số mục về trong phạm vi khi mô hình trả sai', () => {
    const lech = { ...plan, sections: [{ sectionIndex: 99, prompt: 'x', altText: 'y' }] };
    const result = normalizeIllustrationPlan(lech, draft, 1, 1);
    expect(result[1].sectionIndex).toBe(draft.sections.length - 1);
  });

  it('bù mô tả thay thế khi mô hình bỏ trống', () => {
    const thieu = { cover: { prompt: 'abc' }, sections: [] };
    expect(normalizeIllustrationPlan(thieu, draft, 0, 1)[0].altText).toBe(draft.title);
  });

  it('bỏ mục không có prompt', () => {
    const rong = { cover: { prompt: 'abc' }, sections: [{ sectionIndex: 0, prompt: '  ' }] };
    expect(normalizeIllustrationPlan(rong, draft, 1, 1)).toHaveLength(1);
  });

  it('báo lỗi khi không đề xuất được ảnh nào', () => {
    expect(() => normalizeIllustrationPlan({}, draft, 0, 1)).toThrow(/không đề xuất được ảnh/);
  });

  it('id là duy nhất', () => {
    const result = normalizeIllustrationPlan(plan, draft, 2, 1);
    expect(new Set(result.map((item) => item.id)).size).toBe(result.length);
  });
});

describe('lên ý tưởng ảnh', () => {
  it('yêu cầu prompt tiếng Anh và cảnh báo bối cảnh Việt Nam', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(plan));
    await planIllustrations(draft, brief, { chat: chat as never, sectionCount: 1 });

    const call = chat.mock.calls[0][0];
    expect(call.responseFormat).toBe('json');
    expect(call.systemPrompt).toContain('tiếng Anh');
    expect(call.systemPrompt).toContain('model sẽ mặc định vẽ người phương Tây');
    expect(call.systemPrompt).toContain('Không đưa chữ vào ảnh');
    expect(call.usageResourceId).toBe('content-illustration-plan');
  });

  it('đưa ràng buộc hình ảnh của Brand Kit vào prompt', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(plan));
    const kit = normalizeBrandKit({
      colors: [{ name: 'Xanh Egoric', hex: '#79e6df' }],
      assets: [{ id: 'a1', type: 'logo', name: 'Logo Egoric' }],
    } as never);

    await planIllustrations(draft, brief, { chat: chat as never, brandKit: kit });
    const sys = chat.mock.calls[0][0].systemPrompt;
    expect(sys).toContain('RÀNG BUỘC THƯƠNG HIỆU');
    // normalizeBrandKit chuẩn hoá mã màu về chữ hoa.
    expect(sys).toContain('#79E6DF');
  });

  it('không có Brand Kit thì prompt giữ nguyên', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(plan));
    await planIllustrations(draft, brief, { chat: chat as never });
    expect(chat.mock.calls[0][0].systemPrompt).not.toContain('RÀNG BUỘC THƯƠNG HIỆU');
  });

  it('không xin ảnh mục nhiều hơn số mục thật có', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(plan));
    await planIllustrations(draft, brief, { chat: chat as never, sectionCount: 99 });
    expect(chat.mock.calls[0][0].prompt).toContain(`${draft.sections.length} ảnh cho các mục`);
  });
});

describe('vẽ ảnh', () => {
  const target: ArticleIllustration = {
    id: 'i1',
    purpose: 'cover',
    prompt: 'A gold shop',
    altText: 'Tiệm vàng',
    aspectRatio: '16:9',
    status: 'draft',
  };

  it('gọi model ảnh với đúng tỷ lệ rồi ghi kết quả', async () => {
    const image = vi.fn().mockResolvedValue('data:image/png;base64,AAA');
    const done = await renderIllustration(target, { image: image as never });

    expect(image.mock.calls[0][0].aspectRatio).toBe('16:9');
    expect(image.mock.calls[0][0].usageResourceId).toBe('content-illustration-cover');
    expect(done.status).toBe('done');
    expect(done.imageUrl).toBe('data:image/png;base64,AAA');
  });

  it('lỗi thành trạng thái failed chứ không ném ra ngoài', async () => {
    const image = vi.fn().mockRejectedValue(new Error('Hết credit'));
    const done = await renderIllustration(target, { image: image as never });
    expect(done.status).toBe('failed');
    expect(done.error).toBe('Hết credit');
    expect(done.imageUrl).toBeUndefined();
  });

  it('prompt rỗng thì chặn trước, không gọi model', async () => {
    const image = vi.fn();
    const done = await renderIllustration({ ...target, prompt: '  ' }, { image: image as never });
    expect(done.status).toBe('failed');
    expect(image).not.toHaveBeenCalled();
  });

  it('vẽ lại xoá thông báo lỗi cũ', async () => {
    const image = vi.fn().mockResolvedValue('data:image/png;base64,BBB');
    const done = await renderIllustration(
      { ...target, status: 'failed', error: 'lỗi cũ' },
      { image: image as never },
    );
    expect(done.error).toBeUndefined();
  });
});

describe('trợ giúp hiển thị', () => {
  it('chỉ lấy ảnh bìa đã vẽ xong', () => {
    const chuaVe: ArticleDraft = {
      ...draft,
      illustrations: [{ id: 'i1', purpose: 'cover', prompt: 'x', altText: 'y', aspectRatio: '16:9', status: 'draft' }],
    };
    expect(getCoverImage(chuaVe)).toBeUndefined();

    const daVe: ArticleDraft = {
      ...draft,
      illustrations: [{ id: 'i1', purpose: 'cover', prompt: 'x', altText: 'y', aspectRatio: '16:9', status: 'done', imageUrl: 'u' }],
    };
    expect(getCoverImage(daVe)).toBe('u');
  });

  it('đếm số ảnh đã vẽ xong', () => {
    expect(countRendered([])).toBe(0);
    expect(
      countRendered([
        { id: '1', purpose: 'cover', prompt: 'a', altText: 'a', aspectRatio: '16:9', status: 'done' },
        { id: '2', purpose: 'section', prompt: 'b', altText: 'b', aspectRatio: '1:1', status: 'failed' },
      ]),
    ).toBe(1);
  });
});
