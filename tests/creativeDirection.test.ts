import { describe, expect, it, vi } from 'vitest';
import { createDefaultBrief } from '../services/content/contentAxes';
import {
  CREATIVE_LENSES,
  MAX_ACTIVE_LENSES,
  buildCreativeDirectionPromptContext,
  getCreativeLens,
  getCreativeLensOption,
  suggestCreativeDirections,
  updateDirectionSelection,
} from '../services/content/creativeDirectionService';
import { generateArticle } from '../services/content/articleService';
import { buildStoryBridgeFromTrend } from '../services/content/storyBridgeService';

describe('Phòng chiến lược Egoric', () => {
  const brief = {
    ...createDefaultBrief('Một thương hiệu Việt mở rộng ra Đông Nam Á'),
    intent: 'conversion' as const,
    approach: 'casestudy' as const,
    audience: 'chu_doanh_nghiep' as const,
  };

  it('có đủ 15 lăng kính và lựa chọn không trùng nhau', () => {
    expect(CREATIVE_LENSES).toHaveLength(15);
    expect(new Set(CREATIVE_LENSES.map((lens) => lens.key)).size).toBe(15);
    for (const lens of CREATIVE_LENSES) {
      expect(lens.options.length).toBeGreaterThanOrEqual(4);
      expect(new Set(lens.options.map((option) => option.id)).size).toBe(lens.options.length);
      for (const option of lens.options) {
        expect(option.directive.length).toBeGreaterThan(60);
      }
    }
  });

  it('đề xuất tại máy có tính xác định và tối đa năm lăng kính', () => {
    const first = suggestCreativeDirections(brief);
    const second = suggestCreativeDirections(brief);
    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    expect(first[0].name).toBe('Từ vấn đề đến hành động');
    for (const direction of first) {
      expect(direction.selections.length).toBeLessThanOrEqual(MAX_ACTIVE_LENSES);
      expect(new Set(direction.selections.map((item) => item.lens)).size).toBe(direction.selections.length);
      for (const selection of direction.selections) {
        expect(() => getCreativeLensOption(selection)).not.toThrow();
      }
    }
  });

  it('không cho thêm lăng kính thứ sáu nhưng vẫn cho thay lựa chọn đang có', () => {
    const direction = suggestCreativeDirections(brief)[0];
    expect(direction.selections).toHaveLength(5);
    expect(() => updateDirectionSelection(direction, 'culture', 'do-thi-duong-dai')).toThrow(/tối đa 5/);

    const firstSelection = direction.selections[0];
    const replacement = getCreativeLens(firstSelection.lens).options.find(
      (option) => option.id !== firstSelection.optionId,
    )!;
    const changed = updateDirectionSelection(direction, firstSelection.lens, replacement.id);
    expect(changed.selections).toHaveLength(5);
    expect(changed.selections.some((item) => item.optionId === replacement.id)).toBe(true);
  });

  it('dựng prompt rõ tên hướng, cường độ và từng directive', () => {
    const direction = suggestCreativeDirections(brief)[0];
    const block = buildCreativeDirectionPromptContext(direction);
    expect(block).toContain('HƯỚNG SÁNG TẠO ĐÃ ĐƯỢC ĐẠO DIỄN CHỐT');
    expect(block).toContain(direction.name);
    expect(block).toContain('Cường độ');
    expect(block).toContain(getCreativeLensOption(direction.selections[0]).directive);
  });

  it('đưa cùng một hướng vào prompt viết bài và dựng phim', async () => {
    const direction = suggestCreativeDirections(brief)[0];
    const articleChat = vi.fn().mockResolvedValue(JSON.stringify({
      title: 'Hướng đi mới',
      sapo: 'Một câu chuyện đáng chú ý.',
      sections: [{ heading: 'Bắt đầu', body: 'Nội dung.' }],
      hashtags: [],
      seoTitle: 'Hướng đi mới',
      metaDescription: 'Một câu chuyện đáng chú ý.',
    }));
    await generateArticle({ ...brief, creativeDirection: direction }, { chat: articleChat as never });
    expect(articleChat.mock.calls[0][0].prompt).toContain(direction.name);

    const storyChat = vi.fn().mockResolvedValue(JSON.stringify({
      logline: 'Một chủ doanh nghiệp tìm ra lối đi mới.',
      rawScript: 'Buổi sáng, anh Minh mở cửa hàng và bắt đầu một thay đổi nhỏ.',
      characterHints: [],
    }));
    await buildStoryBridgeFromTrend(
      { title: brief.topic, sourceId: 'thu-cong', sourceLabel: 'Tự nhập', category: 'kinh_doanh', rank: 1 },
      { chat: storyChat as never, creativeDirection: direction },
    );
    expect(storyChat.mock.calls[0][0].systemPrompt).toContain(direction.name);
  });
});
