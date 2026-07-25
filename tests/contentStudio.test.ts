import { describe, expect, it, vi } from 'vitest';
import {
  APPROACH_OPTIONS,
  AUDIENCE_OPTIONS,
  INTENT_OPTIONS,
  VOICE_OPTIONS,
  buildAxisDirectives,
  createDefaultBrief,
  getIntent,
} from '../services/content/contentAxes';
import {
  articleToMarkdown,
  describeBrief,
  estimateReadingMinutes,
  generateArticle,
  normalizeArticleDraft,
} from '../services/content/articleService';
import {
  buildStoryBridgeFromArticle,
  buildStoryBridgeFromTrend,
  normalizeStoryBridge,
  toFilmProjectSeed,
} from '../services/content/storyBridgeService';
import { inspectBrandCompliance, normalizeBrandKit } from '../services/brandKitService';
import { ArticleDraft, ContentBrief, TrendItem } from '../types/content';

const brief: ContentBrief = {
  ...createDefaultBrief('Giá vàng lập đỉnh mới'),
  intent: 'education',
  approach: 'explainer',
  voice: 'chuyen_gia',
  audience: 'van_phong',
  keywords: ['giá vàng', 'lãi suất'],
  targetWords: 800,
};

const draftJson = {
  title: 'Vì sao giá vàng lập đỉnh',
  sapo: 'Giá vàng vừa vượt mốc cũ. Đây là ba lý do đứng sau.',
  sections: [
    { heading: 'Chuyện gì đang xảy ra', body: 'Giá vàng trong nước tăng liên tiếp ba phiên.' },
    { heading: 'Vì sao lúc này', body: 'Lãi suất hạ khiến dòng tiền dịch chuyển.' },
  ],
  hashtags: ['#giá vàng', 'lai_suat', '#giá vàng'],
  seoTitle: 'Vì sao giá vàng lập đỉnh mới',
  metaDescription: 'Ba lý do đứng sau đợt tăng giá vàng.',
};

describe('bốn trục điều khiển', () => {
  it('mọi lựa chọn đều có directive dạng chỉ dẫn hành động', () => {
    const all = [...INTENT_OPTIONS, ...APPROACH_OPTIONS, ...VOICE_OPTIONS, ...AUDIENCE_OPTIONS];
    expect(all.length).toBe(4 + 8 + 6 + 6);
    for (const option of all) {
      expect(option.label.length, `${option.value} thiếu nhãn`).toBeGreaterThan(0);
      expect(option.directive.length, `${option.value} có directive quá ngắn`).toBeGreaterThan(40);
    }
  });

  it('giá trị trên mỗi trục là duy nhất', () => {
    for (const axis of [INTENT_OPTIONS, APPROACH_OPTIONS, VOICE_OPTIONS, AUDIENCE_OPTIONS]) {
      const values = axis.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('ghép đủ bốn directive vào khối chỉ dẫn', () => {
    const block = buildAxisDirectives(brief);
    expect(block).toContain(getIntent('education').directive);
    expect(block).toContain('Góc tiếp cận');
    expect(block).toContain('Giọng');
    expect(block).toContain('Người đọc');
  });

  it('ném lỗi rõ ràng với giá trị lạ', () => {
    expect(() => getIntent('khong_co' as never)).toThrow(/không hợp lệ/);
  });

  it('brief mặc định dùng được ngay', () => {
    const d = createDefaultBrief('Chủ đề X');
    expect(d.topic).toBe('Chủ đề X');
    expect(() => buildAxisDirectives(d)).not.toThrow();
  });

  it('mô tả brief thành một dòng', () => {
    expect(describeBrief(brief)).toBe('Giải thích · Cắt nghĩa · Chuyên gia · Dân văn phòng');
  });
});

describe('chuẩn hoá bài viết', () => {
  it('bóc đủ trường và khử trùng lặp hashtag', () => {
    const draft = normalizeArticleDraft(draftJson, brief);
    expect(draft.title).toBe('Vì sao giá vàng lập đỉnh');
    expect(draft.sections).toHaveLength(2);
    expect(draft.hashtags).toEqual(['giá_vàng', 'lai_suat']);
    expect(draft.readingMinutes).toBeGreaterThanOrEqual(1);
  });

  it('bù trường thiếu thay vì gãy', () => {
    const draft = normalizeArticleDraft(
      { sections: [{ heading: '', body: 'Chỉ có thân bài.' }] },
      brief,
    );
    expect(draft.title).toBe(brief.topic);
    expect(draft.seoTitle.length).toBeGreaterThan(0);
    expect(draft.metaDescription.length).toBeGreaterThan(0);
    expect(draft.hashtags).toEqual([]);
  });

  it('bỏ mục rỗng', () => {
    const draft = normalizeArticleDraft(
      { sections: [{ heading: 'A', body: '' }, { heading: 'B', body: 'Có nội dung' }] },
      brief,
    );
    expect(draft.sections).toHaveLength(1);
    expect(draft.sections[0].heading).toBe('B');
  });

  it('báo lỗi tiếng Việt khi không có thân bài nào', () => {
    expect(() => normalizeArticleDraft({ title: 'X', sections: [] }, brief)).toThrow(
      /không trả về phần thân bài/,
    );
    expect(() => normalizeArticleDraft(null, brief)).toThrow(/không trả về phần thân bài/);
  });

  it('ước lượng thời gian đọc tối thiểu một phút', () => {
    expect(estimateReadingMinutes({ ...draftJson, sections: [{ heading: 'A', body: 'ngắn' }] } as never))
      .toBe(1);
  });
});

describe('xuất Markdown', () => {
  it('dựng đúng cấu trúc tiêu đề, sapo, mục và hashtag', () => {
    const md = articleToMarkdown(normalizeArticleDraft(draftJson, brief));
    expect(md).toContain('# Vì sao giá vàng lập đỉnh');
    expect(md).toContain('**Giá vàng vừa vượt mốc cũ.');
    expect(md).toContain('## Chuyện gì đang xảy ra');
    expect(md).toContain('#giá_vàng #lai_suat');
    expect(md.endsWith('\n')).toBe(true);
  });
});

describe('sinh bài', () => {
  it('gửi quy tắc tiếng Việt, directive và yêu cầu JSON', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(draftJson));
    await generateArticle(brief, { chat: chat as never, usageResourceId: 'chien-dich-1' });

    const call = chat.mock.calls[0][0];
    expect(call.responseFormat).toBe('json');
    expect(call.usageResourceId).toBe('chien-dich-1');
    expect(call.systemPrompt).toContain('Không viết hoa toàn bộ');
    expect(call.systemPrompt).toContain('không dịch máy từ tiếng Anh');
    expect(call.prompt).toContain('Giá vàng lập đỉnh mới');
    expect(call.prompt).toContain('giá vàng, lãi suất');
    expect(call.prompt).toContain('khoảng 800 chữ');
  });

  it('đọc được JSON bọc trong khối mã', async () => {
    const chat = vi.fn().mockResolvedValue('```json\n' + JSON.stringify(draftJson) + '\n```');
    const draft = await generateArticle(brief, { chat: chat as never });
    expect(draft.title).toBe('Vì sao giá vàng lập đỉnh');
  });

  it('chặn brief không có chủ đề trước khi gọi model', async () => {
    const chat = vi.fn();
    await expect(generateArticle({ ...brief, topic: '  ' }, { chat: chat as never })).rejects.toThrow(
      /Chưa có chủ đề/,
    );
    expect(chat).not.toHaveBeenCalled();
  });

  it('nhắc nguồn xu hướng khi brief có origin', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(draftJson));
    await generateArticle(
      { ...brief, origin: { sourceId: 'cafef', sourceLabel: 'CafeF' } },
      { chat: chat as never },
    );
    expect(chat.mock.calls[0][0].prompt).toContain('CafeF');
  });
});

describe('tích hợp Brand Kit', () => {
  const kit = normalizeBrandKit({
    toneOfVoice: 'Điềm đạm, thực tế, không hô hào',
    mandatoryTerms: ['Egoric'],
    forbiddenTerms: ['cam kết lợi nhuận'],
    ctas: ['Nhắn tin để được tư vấn'],
  });

  it('đưa tone, từ bắt buộc và từ cấm vào prompt viết bài', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(draftJson));
    await generateArticle(brief, { chat: chat as never, brandKit: kit });

    const sys = chat.mock.calls[0][0].systemPrompt;
    expect(sys).toContain('BRAND KIT');
    expect(sys).toContain('Điềm đạm, thực tế, không hô hào');
    expect(sys).toContain('Egoric');
    expect(sys).toContain('cam kết lợi nhuận');
    // Quy tắc viết tiếng Việt vẫn phải còn, không bị Brand Kit thay thế.
    expect(sys).toContain('Không viết hoa toàn bộ');
  });

  it('không có Brand Kit thì prompt giữ nguyên như cũ', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(draftJson));
    await generateArticle(brief, { chat: chat as never });
    expect(chat.mock.calls[0][0].systemPrompt).not.toContain('BRAND KIT');
  });

  it('truyện phim ngắn cũng nhận Brand Kit', async () => {
    const chat = vi.fn().mockResolvedValue(
      JSON.stringify({ logline: 'x', rawScript: 'Truyện.', characterHints: [] }),
    );
    await buildStoryBridgeFromTrend(
      { title: 'A', sourceId: 'cafef', sourceLabel: 'CafeF', category: 'kinh_doanh', rank: 1 },
      { chat: chat as never, brandKit: kit },
    );
    expect(chat.mock.calls[0][0].systemPrompt).toContain('BRAND KIT');
  });

  it('chặn được bài có từ cấm và bắt được bài thiếu từ bắt buộc', () => {
    const viPham = inspectBrandCompliance('Chúng tôi cam kết lợi nhuận 20% mỗi tháng.', kit);
    expect(viPham.passed).toBe(false);
    expect(viPham.violations.some((v) => v.includes('cam kết lợi nhuận'))).toBe(true);
    expect(viPham.violations.some((v) => v.includes('Egoric'))).toBe(true);

    const dat = inspectBrandCompliance('Egoric giúp bạn dựng video. Nhắn tin để được tư vấn.', kit);
    expect(dat.passed).toBe(true);
    expect(dat.warnings).toEqual([]);
  });
});

describe('nhãn chi phí theo quy ước sẵn có', () => {
  it('viết bài và dựng truyện dùng nhãn riêng, không lặp lại projectId', async () => {
    const chatBai = vi.fn().mockResolvedValue(JSON.stringify(draftJson));
    await generateArticle(brief, { chat: chatBai as never });
    expect(chatBai.mock.calls[0][0].usageResourceId).toBe('content-article');

    const chatTruyen = vi.fn().mockResolvedValue(
      JSON.stringify({ logline: 'x', rawScript: 'Truyện.', characterHints: [] }),
    );
    await buildStoryBridgeFromTrend(
      { title: 'A', sourceId: 'cafef', sourceLabel: 'CafeF', category: 'kinh_doanh', rank: 1 },
      { chat: chatTruyen as never },
    );
    expect(chatTruyen.mock.calls[0][0].usageResourceId).toBe('content-story');
  });
});

describe('cầu nối sang xưởng phim', () => {
  const bridgeJson = {
    logline: 'Một nhân viên ngân hàng phải chọn giữa lời khuyên đúng và chỉ tiêu doanh số.',
    rawScript: 'Sáng thứ hai, Hạnh mở quầy giao dịch...',
    suggestedVisualStyle: 'điện ảnh, tông ấm',
    characterHints: ['Hạnh — nữ, 32 tuổi, giao dịch viên', ''],
  };

  const trend: TrendItem = {
    title: 'Giá vàng lập đỉnh mới',
    sourceId: 'cafef',
    sourceLabel: 'CafeF',
    category: 'kinh_doanh',
    rank: 2,
  };

  it('dựng cầu nối từ chủ đề nóng', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(bridgeJson));
    const bridge = await buildStoryBridgeFromTrend(trend, { chat: chat as never, durationSeconds: 45 });

    expect(bridge.suggestedDurationSeconds).toBe(45);
    expect(bridge.characterHints).toEqual(['Hạnh — nữ, 32 tuổi, giao dịch viên']);
    expect(chat.mock.calls[0][0].prompt).toContain('khoảng 45 giây');
    expect(chat.mock.calls[0][0].prompt).toContain('CafeF');
    expect(chat.mock.calls[0][0].systemPrompt).toContain('Nhân vật là người Việt');
  });

  it('dùng sườn tiêu đề mục chứ không đổ nguyên thân bài vào prompt', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(bridgeJson));
    const draft = normalizeArticleDraft(draftJson, brief) as ArticleDraft;
    await buildStoryBridgeFromArticle(draft, brief, { chat: chat as never });

    const prompt = chat.mock.calls[0][0].prompt;
    expect(prompt).toContain('Chuyện gì đang xảy ra → Vì sao lúc này');
    expect(prompt).not.toContain('Giá vàng trong nước tăng liên tiếp ba phiên');
    expect(prompt).toContain('Dân văn phòng');
  });

  it('mặc định 60 giây và có phong cách hình ảnh dự phòng', () => {
    const bridge = normalizeStoryBridge({ rawScript: 'Truyện.' }, 'Chủ đề', 60);
    expect(bridge.suggestedDurationSeconds).toBe(60);
    expect(bridge.suggestedVisualStyle.length).toBeGreaterThan(0);
    expect(bridge.logline).toBe('Chủ đề');
  });

  it('báo lỗi khi không có nội dung truyện', () => {
    expect(() => normalizeStoryBridge({ logline: 'chỉ có logline' }, 'X', 60)).toThrow(
      /không trả về nội dung truyện/,
    );
  });

  it('đổi thành phần khởi tạo dự án phim đúng định dạng Phase 01', () => {
    const bridge = normalizeStoryBridge(bridgeJson, 'Giá vàng', 90);
    const seed = toFilmProjectSeed(bridge, 'Phim ngắn giá vàng');

    expect(seed).toEqual({
      title: 'Phim ngắn giá vàng',
      rawScript: 'Sáng thứ hai, Hạnh mở quầy giao dịch...',
      targetDuration: '90 giây',
      language: 'Tiếng Việt',
      visualStyle: 'điện ảnh, tông ấm',
    });
  });
});
