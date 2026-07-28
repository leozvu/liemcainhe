import { describe, expect, it } from 'vitest';
import {
  BROLL_THRESHOLD_SECONDS,
  MIN_CLIP_SECONDS,
  analyzePacing,
  analyzeTimeline,
  describeEditingReport,
  findTruncatedDialogue,
  pickBestTake,
  recommendClipDuration,
  recommendTransition,
  snapToBeats,
  speechDuration,
  suggestBRollPoints,
  suggestReframe,
} from '../services/editingIntelligenceService';
import { AutoEditorTimelineClip, Shot, VoiceTake } from '../types';

const shot = (over: Partial<Shot> = {}): Shot => ({
  id: 's1',
  sceneId: 'scene_1',
  actionSummary: 'Hạnh mở quầy',
  cameraMovement: 'static',
  characters: ['ch1'],
  keyframes: [],
  ...over,
});

const clip = (over: Partial<AutoEditorTimelineClip> = {}): AutoEditorTimelineClip => ({
  id: 'c1',
  shotId: 's1',
  order: 0,
  offset: 0,
  duration: 4,
  transition: 'cut',
  ...over,
});

const take = (over: Partial<VoiceTake> = {}): VoiceTake => ({
  id: 't1',
  shotId: 's1',
  text: 'Xin chào',
  source: 'synthetic',
  providerId: 'elevenlabs',
  status: 'ready',
  audioUrl: 'data:audio',
  duration: 3,
  createdAt: 1,
  ...over,
});

describe('thời lượng lời thoại', () => {
  it('không có thoại thì bằng không', () => {
    expect(speechDuration()).toBe(0);
    expect(speechDuration('   ')).toBe(0);
  });

  it('câu dài hơn thì cần nhiều thời gian hơn', () => {
    expect(speechDuration('Xin chào các bạn')).toBeLessThan(
      speechDuration('Xin chào các bạn, hôm nay chúng ta sẽ nói về một chủ đề rất thú vị'),
    );
  });

  it('có chừa khoảng thở hai đầu', () => {
    // Chuỗi rất ngắn vẫn phải hơn thời gian đọc thuần.
    expect(speechDuration('A')).toBeGreaterThan(1);
  });
});

describe('độ dài khung hình nên có', () => {
  it('thoại quyết định sàn — không bao giờ ngắn hơn thời gian nói', () => {
    const dialogue = 'Đây là một câu thoại khá dài để kiểm tra xem hệ thống có tính đúng không';
    const result = recommendClipDuration(shot(), dialogue);
    expect(result.seconds).toBeGreaterThanOrEqual(speechDuration(dialogue) - 0.1);
    expect(result.reason).toContain('lời thoại');
  });

  it('cảnh toàn giữ lâu hơn cảnh cận', () => {
    const wide = recommendClipDuration(shot({ shotSize: 'toàn cảnh' }));
    const close = recommendClipDuration(shot({ shotSize: 'cận cảnh' }));
    expect(wide.seconds).toBeGreaterThan(close.seconds);
    expect(wide.reason).toContain('quét hết khung');
  });

  it('máy có chuyển động thì giữ lâu hơn để cú máy hoàn thành', () => {
    const moving = recommendClipDuration(shot({ cameraMovement: 'pan trái' }));
    const still = recommendClipDuration(shot({ cameraMovement: 'static' }));
    expect(moving.seconds).toBeGreaterThan(still.seconds);
  });

  it('nhận ra cả từ chỉ chuyển động bằng tiếng Việt', () => {
    expect(recommendClipDuration(shot({ cameraMovement: 'lia máy sang phải' })).seconds)
      .toBeGreaterThan(recommendClipDuration(shot({ cameraMovement: 'cố định' })).seconds);
  });

  it('không bao giờ ngắn hơn ngưỡng mắt kịp đọc', () => {
    expect(recommendClipDuration(shot({ shotSize: 'cận cảnh' })).seconds)
      .toBeGreaterThanOrEqual(MIN_CLIP_SECONDS);
  });
});

describe('chuyển cảnh', () => {
  it('cắt thẳng là mặc định trong cùng bối cảnh', () => {
    expect(recommendTransition(shot(), shot()).transition).toBe('cut');
  });

  it('mờ chồng khi đổi bối cảnh', () => {
    const result = recommendTransition(shot({ sceneId: 'scene_2' }), shot({ sceneId: 'scene_1' }));
    expect(result.transition).toBe('crossfade');
    expect(result.reason).toContain('Đổi bối cảnh');
  });

  it('clip đầu tiên luôn cắt thẳng', () => {
    expect(recommendTransition(shot(), undefined).transition).toBe('cut');
  });
});

describe('phân tích nhịp cả timeline', () => {
  it('đánh dấu clip lệch nhịp đáng kể', () => {
    const clips = [clip({ id: 'a', duration: 20 })];
    const [result] = analyzePacing(clips, [shot()]);
    expect(result.significant).toBe(true);
    expect(result.recommendedDuration).toBeLessThan(20);
  });

  it('lệch nhỏ thì không bắt sửa', () => {
    const recommended = recommendClipDuration(shot()).seconds;
    const [result] = analyzePacing([clip({ duration: recommended + 0.2 })], [shot()]);
    expect(result.significant).toBe(false);
  });

  it('shot không tồn tại vẫn ra khuyến nghị, không ném lỗi', () => {
    expect(() => analyzePacing([clip({ shotId: 'khong-co' })], [])).not.toThrow();
  });
});

describe('phát hiện cắt mất lời thoại', () => {
  it('bắt được clip ngắn hơn lời thoại và nói thiếu bao nhiêu giây', () => {
    const dialogue = 'Một câu thoại rất dài mà chắc chắn không thể đọc hết trong hai giây đâu nhé';
    const [found] = findTruncatedDialogue([clip({ duration: 2, dialogue })]);
    expect(found.clipId).toBe('c1');
    expect(found.shortBy).toBeGreaterThan(0);
  });

  it('clip đủ dài thì không báo', () => {
    expect(findTruncatedDialogue([clip({ duration: 30, dialogue: 'Ngắn thôi' })])).toEqual([]);
  });

  it('clip không thoại thì không báo', () => {
    expect(findTruncatedDialogue([clip({ duration: 0.5 })])).toEqual([]);
  });
});

describe('cắt theo nhịp nhạc', () => {
  it('dịch điểm cắt về phách gần nhất', () => {
    // 120 bpm → mỗi phách 0.5s. Clip 2.1s nên về 2.0s.
    const [result] = snapToBeats([clip({ duration: 2.1 })], 120);
    expect(result.duration).toBe(2);
  });

  it('KHÔNG dịch khi phải dịch quá nửa phách — nhịp kể chuyện thắng nhịp nhạc', () => {
    // 60 bpm → phách 1s, nửa phách 0.5s. Clip 2.5s cách đều hai phách.
    const [result] = snapToBeats([clip({ duration: 2.5 })], 60);
    expect(result.duration).toBe(2.5);
  });

  it('cộng dồn offset đúng qua nhiều clip', () => {
    const results = snapToBeats(
      [clip({ id: 'a', duration: 2.1 }), clip({ id: 'b', duration: 1.9 })],
      120,
    );
    expect(results[0].offset).toBe(0);
    expect(results[1].offset).toBe(results[0].duration);
  });

  it('bpm không hợp lệ thì giữ nguyên', () => {
    const clips = [clip({ duration: 2.1 })];
    expect(snapToBeats(clips, 0)).toEqual(clips);
  });

  it('không dịch xuống dưới ngưỡng tối thiểu', () => {
    const [result] = snapToBeats([clip({ duration: 1.3 })], 120);
    expect(result.duration).toBeGreaterThanOrEqual(MIN_CLIP_SECONDS);
  });
});

describe('chọn take giọng', () => {
  it('ưu tiên bản thu người thật khi cả hai cùng vừa', () => {
    const choice = pickBestTake(
      [take({ id: 'may', source: 'synthetic', duration: 3 }), take({ id: 'nguoi', source: 'human', duration: 2.8 })],
      4,
    );
    expect(choice?.take.id).toBe('nguoi');
    expect(choice?.reason).toContain('người thật');
  });

  it('loại take dài hơn khung hình và nói rõ dài bao nhiêu', () => {
    const choice = pickBestTake(
      [take({ id: 'dai', duration: 9 }), take({ id: 'vua', duration: 3 })],
      4,
    );
    expect(choice?.take.id).toBe('vua');
    expect(choice?.rejected[0]).toMatchObject({ takeId: 'dai' });
    expect(choice?.rejected[0].reason).toContain('5');
  });

  it('trong số vừa thì chọn bản thong thả nhất', () => {
    const choice = pickBestTake(
      [take({ id: 'voi', duration: 1.5 }), take({ id: 'thong-tha', duration: 3.5 })],
      4,
    );
    expect(choice?.take.id).toBe('thong-tha');
  });

  it('không take nào vừa thì vẫn chọn và khuyên kéo dài shot', () => {
    const choice = pickBestTake([take({ id: 'dai', duration: 10 })], 3);
    expect(choice?.take.id).toBe('dai');
    expect(choice?.reason).toContain('kéo dài shot');
  });

  it('bỏ qua take chưa sẵn sàng hoặc thiếu audio', () => {
    expect(pickBestTake([take({ status: 'error' })], 4)).toBeNull();
    expect(pickBestTake([take({ audioUrl: undefined })], 4)).toBeNull();
  });
});

describe('đổi tỷ lệ khung', () => {
  it('không đổi tỷ lệ thì không phải làm gì', () => {
    expect(suggestReframe(shot(), '16:9', '16:9').focus).toBe('center');
  });

  it('dọc sang ngang thì crop trên dưới và ưu tiên phần trên', () => {
    const result = suggestReframe(shot(), '9:16', '16:9');
    expect(result.focus).toBe('top');
    expect(result.reason).toContain('trên/dưới');
  });

  it('cảnh toàn cắt sang dọc thì giữ trục giữa vì chỉ mất hai bên', () => {
    const result = suggestReframe(shot({ shotSize: 'toàn cảnh' }), '16:9', '9:16');
    expect(result.focus).toBe('center');
    expect(result.reason).toContain('Crop hai bên');
  });

  it('nhiều nhân vật thì cảnh báo sẽ mất người', () => {
    const result = suggestReframe(shot({ characters: ['a', 'b'] }), '16:9', '9:16');
    expect(result.warning).toContain('2 nhân vật');
    expect(result.warning).toContain('dựng riêng');
  });

  it('một chủ thể thì giữ giữa khung', () => {
    const result = suggestReframe(shot({ characters: ['a'] }), '16:9', '1:1');
    expect(result.focus).toBe('center');
    expect(result.warning).toBeUndefined();
  });
});

describe('đề xuất chèn cảnh phụ', () => {
  it('clip dài với khung tĩnh thì đề xuất chèn ở giữa', () => {
    const [suggestion] = suggestBRollPoints([clip({ duration: 10 })], [shot()]);
    expect(suggestion.atSecond).toBe(5);
    expect(suggestion.reason).toContain('khung tĩnh');
  });

  it('clip dài nhưng máy có chuyển động thì nói rõ là đỡ ì hơn', () => {
    const [suggestion] = suggestBRollPoints([clip({ duration: 10 })], [shot({ cameraMovement: 'dolly vào' })]);
    expect(suggestion.reason).toContain('đỡ ì');
  });

  it('clip ngắn thì không đề xuất', () => {
    expect(suggestBRollPoints([clip({ duration: BROLL_THRESHOLD_SECONDS - 0.1 })], [shot()])).toEqual([]);
  });
});

describe('báo cáo tổng hợp', () => {
  it('gộp cả ba nhóm và đếm số điểm đáng sửa', () => {
    const report = analyzeTimeline(
      [
        clip({ id: 'a', duration: 2, dialogue: 'Một câu thoại rất dài không thể đọc hết trong hai giây đâu nhé bạn ơi' }),
        clip({ id: 'b', duration: 12 }),
      ],
      [shot()],
    );
    expect(report.truncatedDialogue.length).toBeGreaterThan(0);
    expect(report.bRoll.length).toBeGreaterThan(0);
    expect(report.actionableCount).toBeGreaterThan(0);
    expect(describeEditingReport(report)).toContain('cắt mất thoại');
  });

  it('timeline ổn thì nói ổn, không bịa việc', () => {
    const recommended = recommendClipDuration(shot()).seconds;
    const report = analyzeTimeline([clip({ duration: recommended })], [shot()]);
    expect(report.actionableCount).toBe(0);
    expect(describeEditingReport(report)).toContain('không có gì đáng sửa');
  });
});
