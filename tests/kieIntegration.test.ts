import { describe, expect, it } from 'vitest';
import {
  KIE_BUILTIN_CHAT_MODELS,
  KIE_BUILTIN_IMAGE_MODELS,
  KIE_BUILTIN_VIDEO_MODELS,
} from '../types/kieCatalog';
import { buildKieImageInput, buildKieVideoInput } from '../services/adapters/kieAdapter';

describe('KIE catalog', () => {
  it('nhập catalog lớn cho cả hội thoại, ảnh và video mà không trùng mã', () => {
    expect(KIE_BUILTIN_CHAT_MODELS.length).toBeGreaterThanOrEqual(20);
    expect(KIE_BUILTIN_IMAGE_MODELS.length).toBeGreaterThanOrEqual(40);
    expect(KIE_BUILTIN_VIDEO_MODELS.length).toBeGreaterThanOrEqual(45);
    const ids = [
      ...KIE_BUILTIN_CHAT_MODELS,
      ...KIE_BUILTIN_IMAGE_MODELS,
      ...KIE_BUILTIN_VIDEO_MODELS,
    ].map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('dùng payload tiết kiệm cho model ảnh mặc định', async () => {
    const model = KIE_BUILTIN_IMAGE_MODELS.find((item) => item.apiModel === 'nano-banana-2-lite')!;
    await expect(buildKieImageInput({ prompt: 'Khung hình điện ảnh', aspectRatio: '16:9' }, model, 'test'))
      .resolves.toEqual({ prompt: 'Khung hình điện ảnh', aspect_ratio: '16:9' });
  });

  it('tắt âm thanh mặc định và giữ đúng thời lượng cho Seedance Fast', async () => {
    const model = KIE_BUILTIN_VIDEO_MODELS.find((item) => item.apiModel === 'bytedance/seedance-2-fast')!;
    await expect(buildKieVideoInput({ prompt: 'Máy quay tiến chậm', aspectRatio: '9:16', duration: 8 }, model, 'test'))
      .resolves.toMatchObject({
        prompt: 'Máy quay tiến chậm',
        aspect_ratio: '9:16',
        duration: 8,
        resolution: '720p',
        generate_audio: false,
        web_search: false,
      });
  });
});

