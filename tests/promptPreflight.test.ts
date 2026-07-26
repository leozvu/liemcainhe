import { describe, expect, it, vi } from 'vitest';
import {
  PreflightBlockedError,
  PreflightInput,
  assertGenerationAllowed,
  describePreflight,
  estimateSavedCost,
  normalizeJudgeResponse,
  preflightPrompt,
  runLocalPreflight,
  setPreflightBrandKit,
} from '../services/promptPreflight';
import { normalizeBrandKit } from '../services/brandKitService';

const input = (over: Partial<PreflightInput> = {}): PreflightInput => ({
  prompt: 'A Vietnamese barista pouring coffee in a small Hanoi shop, morning light',
  target: 'image',
  ...over,
});

describe('luật cục bộ — không tốn tiền', () => {
  it('prompt tốt thì không có lỗi nào', () => {
    expect(runLocalPreflight(input())).toEqual([]);
  });

  it('prompt rỗng bị chặn và dừng luôn', () => {
    const issues = runLocalPreflight(input({ prompt: '   ' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'empty', severity: 'block' });
  });

  it('prompt quá ngắn bị chặn, kèm cách sửa cụ thể', () => {
    const issues = runLocalPreflight(input({ prompt: 'a coffee shop' }));
    expect(issues[0]).toMatchObject({ code: 'too-vague', severity: 'block' });
    expect(issues[0].fix).toContain('chủ thể');
  });

  it('bắt được yêu cầu chữ trong ảnh, cả tiếng Anh lẫn tiếng Việt', () => {
    const cases = [
      'A poster with the text "Sale 50%" on a wall in Hanoi',
      'Biển hiệu có dòng chữ khuyến mãi trước cửa tiệm cà phê Hà Nội',
      'A shop sign that says Happy New Year above the door outside',
    ];
    for (const prompt of cases) {
      const issues = runLocalPreflight(input({ prompt }));
      expect(issues.some((i) => i.code === 'text-in-image'), prompt).toBe(true);
    }
  });

  it('chữ trong ảnh chỉ cảnh báo, không chặn — đôi khi vẫn muốn thử', () => {
    const issue = runLocalPreflight(input({ prompt: 'A poster with the text "Sale" in a Hanoi street' }))
      .find((i) => i.code === 'text-in-image');
    expect(issue?.severity).toBe('warn');
  });

  it('bắt mâu thuẫn nội tại, tiếng Anh', () => {
    const cases: [string, string][] = [
      ['A street at night under bright sunlight in Hanoi city', 'ban đêm nhưng lại nắng gắt'],
      ['Close-up of a barista and a wide shot of the whole street', 'vừa cận cảnh vừa toàn cảnh'],
      ['Minimalist composition, highly detailed textures everywhere here', 'vừa tối giản vừa cực kỳ chi tiết'],
      ['Black and white photo with vibrant colours all around it', 'vừa đen trắng vừa màu rực rỡ'],
    ];
    for (const [prompt, label] of cases) {
      const hit = runLocalPreflight(input({ prompt })).find((i) => i.code === 'contradiction');
      expect(hit, prompt).toBeDefined();
      expect(hit?.message).toContain(label);
    }
  });

  /**
   * Những cụm này bắt đầu bằng `đ` hoặc kết thúc bằng `ỡ`, tức là cả hai đầu
   * đều không phải ký tự ASCII. Với `\b` của JavaScript chúng không bao giờ
   * khớp — luật vẫn chạy nhưng im lặng không bắt được gì.
   */
  it('bắt mâu thuẫn tiếng Việt, kể cả cụm bắt đầu bằng đ hoặc kết thúc bằng dấu', () => {
    const cases: [string, string][] = [
      ['Con phố lúc đêm khuya dưới nắng gắt giữa trưa Hà Nội', 'ban đêm nhưng lại nắng gắt'],
      ['Ảnh đen trắng nhưng màu sắc rực rỡ khắp khung hình', 'vừa đen trắng vừa màu rực rỡ'],
      ['Cận cảnh người pha cà phê và toàn cảnh con phố', 'vừa cận cảnh vừa toàn cảnh'],
    ];
    for (const [prompt, label] of cases) {
      const hit = runLocalPreflight(input({ prompt })).find((i) => i.code === 'contradiction');
      expect(hit, prompt).toBeDefined();
      expect(hit?.message).toContain(label);
    }
  });

  it('không bắt nhầm khi cụm nằm trong từ dài hơn', () => {
    // "đêm" nằm trong "đêmm" không phải một từ; ranh giới Unicode phải chặn.
    const issues = runLocalPreflight(input({ prompt: 'Buổi sáng yên tĩnh tại quán cà phê nhỏ ở Hà Nội' }));
    expect(issues.some((i) => i.code === 'contradiction')).toBe(false);
  });

  it('chặn khi prompt chứa từ cấm của khách', () => {
    const kit = normalizeBrandKit({ forbiddenTerms: ['cam kết lợi nhuận'] } as never);
    const issues = runLocalPreflight(
      input({ prompt: 'Poster quảng cáo cam kết lợi nhuận cho nhà đầu tư tại Hà Nội', brandKit: kit }),
    );
    const hit = issues.find((i) => i.code === 'brand-forbidden');
    expect(hit?.severity).toBe('block');
    expect(hit?.message).toContain('cam kết lợi nhuận');
  });

  it('không có Brand Kit thì bỏ qua vòng kiểm từ cấm', () => {
    expect(runLocalPreflight(input()).some((i) => i.code === 'brand-forbidden')).toBe(false);
  });

  it('chặn khi model bắt buộc ảnh tham chiếu mà không có', () => {
    const issues = runLocalPreflight(input({ requiresReference: true, hasReference: false }));
    expect(issues.find((i) => i.code === 'missing-reference')?.severity).toBe('block');
  });

  it('có ảnh tham chiếu rồi thì không phàn nàn', () => {
    const issues = runLocalPreflight(input({ requiresReference: true, hasReference: true }));
    expect(issues.some((i) => i.code === 'missing-reference')).toBe(false);
  });
});

describe('ước tính tiền tránh được', () => {
  it('video tính theo thời lượng, ảnh tính theo lượt', () => {
    const video = estimateSavedCost(input({ target: 'video', durationSeconds: 10 }));
    const image = estimateSavedCost(input({ target: 'image' }));
    expect(video).toBeGreaterThan(image);
    expect(image).toBeGreaterThan(0);
  });

  it('video không nêu thời lượng vẫn ước tính được', () => {
    expect(estimateSavedCost(input({ target: 'video' }))).toBeGreaterThan(0);
  });
});

describe('chuẩn hoá phản hồi của model chấm', () => {
  it('bóc lỗi kèm cách sửa', () => {
    const result = normalizeJudgeResponse({
      issues: [{ message: 'Không rõ chủ thể', fix: 'Nêu rõ người hay vật' }],
      revisedPrompt: 'bản đã sửa',
    });
    expect(result.issues[0]).toMatchObject({ code: 'model-flagged', message: 'Không rõ chủ thể' });
    expect(result.revisedPrompt).toBe('bản đã sửa');
  });

  it('model KHÔNG được tự ý chặn, mọi lỗi nó nêu đều chỉ là cảnh báo', () => {
    const result = normalizeJudgeResponse({
      issues: [{ message: 'Cái này hỏng chắc', severity: 'block' }],
    });
    // Chặn là quyền của luật cục bộ, vốn xác định và kiểm chứng được.
    expect(result.issues[0].severity).toBe('warn');
  });

  it('bỏ mục không có nội dung, và prompt sửa rỗng thì coi như không có', () => {
    const result = normalizeJudgeResponse({
      issues: [{ message: '  ' }, { fix: 'chỉ có fix' }, { message: 'thật' }],
      revisedPrompt: '   ',
    });
    expect(result.issues).toHaveLength(1);
    expect(result.revisedPrompt).toBeUndefined();
  });

  it('phản hồi lạ thì trả rỗng, không ném lỗi', () => {
    expect(normalizeJudgeResponse(null).issues).toEqual([]);
    expect(normalizeJudgeResponse({ issues: 'sai kiểu' }).issues).toEqual([]);
  });
});

describe('chạy đủ hai tầng', () => {
  it('luật cục bộ đã chặn thì KHÔNG gọi model, tiết kiệm luôn lời gọi chấm', async () => {
    const chat = vi.fn();
    const report = await preflightPrompt(input({ prompt: 'ngắn quá' }), { chat: chat as never });

    expect(chat).not.toHaveBeenCalled();
    expect(report.verdict).toBe('block');
    expect(report.estimatedSavedUsd).toBeGreaterThan(0);
  });

  it('luật cục bộ chỉ cảnh báo thì vẫn gọi model để soi tiếp', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify({ issues: [], revisedPrompt: '' }));
    const report = await preflightPrompt(
      input({ prompt: 'A poster with the text "Sale" in a Hanoi street corner' }),
      { chat: chat as never },
    );

    expect(chat).toHaveBeenCalledTimes(1);
    expect(report.verdict).toBe('warn');
  });

  it('gộp lỗi của cả hai tầng', async () => {
    const chat = vi.fn().mockResolvedValue(
      JSON.stringify({ issues: [{ message: 'Thiếu bối cảnh Việt Nam' }] }),
    );
    const report = await preflightPrompt(
      input({ prompt: 'A poster with the text "Sale" in a street corner somewhere' }),
      { chat: chat as never },
    );

    expect(report.issues.map((i) => i.code).sort()).toEqual(['model-flagged', 'text-in-image']);
  });

  it('prompt sạch thì đạt', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify({ issues: [] }));
    const report = await preflightPrompt(input(), { chat: chat as never });
    expect(report.verdict).toBe('pass');
    expect(report.issues).toEqual([]);
  });

  it('model chấm hỏng thì KHÔNG chặn việc sinh, chỉ trả kết quả tầng luật', async () => {
    const chat = vi.fn().mockRejectedValue(new Error('Hết credit'));
    const report = await preflightPrompt(input(), { chat: chat as never });
    // Đây là lớp hỗ trợ, không phải cổng bắt buộc.
    expect(report.verdict).toBe('pass');
  });

  it('model trả JSON hỏng cũng không chặn', async () => {
    const chat = vi.fn().mockResolvedValue('không phải json');
    const report = await preflightPrompt(input(), { chat: chat as never });
    expect(report.verdict).toBe('pass');
  });

  it('localOnly thì không gọi mạng lần nào', async () => {
    const chat = vi.fn();
    await preflightPrompt(input(), { chat: chat as never, localOnly: true });
    expect(chat).not.toHaveBeenCalled();
  });

  it('dùng nhãn chi phí riêng để tách được trong bảng usage', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify({ issues: [] }));
    await preflightPrompt(input(), { chat: chat as never });
    expect(chat.mock.calls[0][0].usageResourceId).toBe('preflight-judge');
  });
});

describe('cổng chặn tự động trong lõi sinh ảnh và video', () => {
  it('chặn prompt rỗng', () => {
    expect(() => assertGenerationAllowed('   ', 'video', null)).toThrow(PreflightBlockedError);
  });

  it('chặn prompt chứa từ cấm của khách', () => {
    const kit = normalizeBrandKit({ forbiddenTerms: ['cam kết lợi nhuận'] } as never);
    expect(() => assertGenerationAllowed('Poster cam kết lợi nhuận cho khách hàng', 'image', kit))
      .toThrow(PreflightBlockedError);
  });

  /**
   * Phần quan trọng nhất của cổng này: nó nằm trong đường sinh lõi được gọi từ
   * StageDirector, Video Factory, Đạo diễn AI và cả bước sửa lỗi của Supervisor.
   * Chặn nhầm một lượt sinh đúng gây bực hơn nhiều so với để lọt một lượt hỏng.
   */
  it('KHÔNG chặn prompt ngắn — đó chỉ là suy đoán theo số từ', () => {
    expect(() => assertGenerationAllowed('a shop', 'image', null)).not.toThrow();
  });

  it('KHÔNG chặn khi thiếu ảnh tham chiếu — lõi đã tự đổi model', () => {
    expect(() => assertGenerationAllowed('Cận cảnh ly cà phê trên bàn gỗ buổi sáng', 'image', null))
      .not.toThrow();
  });

  it('KHÔNG chặn prompt đòi chữ trong ảnh — chỉ là cảnh báo', () => {
    expect(() => assertGenerationAllowed('A sign with the text Sale in a Hanoi street', 'image', null))
      .not.toThrow();
  });

  it('prompt bình thường đi qua trót lọt', () => {
    const kit = normalizeBrandKit({ forbiddenTerms: ['cam kết lợi nhuận'] } as never);
    expect(() => assertGenerationAllowed(
      'A Vietnamese barista pouring coffee in a small Hanoi shop, morning light',
      'video',
      kit,
    )).not.toThrow();
  });

  it('lỗi ném ra mang theo chi tiết để giao diện hiện được', () => {
    try {
      assertGenerationAllowed('', 'video', null);
      expect.unreachable('phải ném lỗi');
    } catch (error) {
      expect(error).toBeInstanceOf(PreflightBlockedError);
      expect((error as PreflightBlockedError).issues[0].code).toBe('empty');
      expect((error as PreflightBlockedError).message).toContain('rỗng');
    }
  });

  it('Brand Kit đặt qua context toàn cục cũng có hiệu lực', () => {
    setPreflightBrandKit(normalizeBrandKit({ forbiddenTerms: ['bao lãi'] } as never));
    expect(() => assertGenerationAllowed('Poster bao lãi mỗi tháng cho nhà đầu tư', 'image'))
      .toThrow(PreflightBlockedError);

    setPreflightBrandKit(undefined);
    expect(() => assertGenerationAllowed('Poster bao lãi mỗi tháng cho nhà đầu tư', 'image'))
      .not.toThrow();
  });
});

describe('mô tả một dòng', () => {
  it('nêu số tiền tránh được khi chặn', () => {
    const report = {
      verdict: 'block' as const,
      issues: [{ code: 'empty' as const, severity: 'block' as const, message: 'x' }],
      estimatedSavedUsd: 0.96,
      checkedAt: 0,
    };
    expect(describePreflight(report)).toContain('0.96');
  });

  it('đạt thì nói gọn', () => {
    expect(describePreflight({ verdict: 'pass', issues: [], checkedAt: 0 })).toBe('Prompt ổn, sinh được.');
  });
});
