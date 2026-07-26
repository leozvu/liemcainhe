import { describe, expect, it } from 'vitest';
import { selectImageModelForGeneration } from '../services/imageModelSelection';
import { ImageModelDefinition } from '../types/model';

const model = (id: string, requiresReference: boolean): ImageModelDefinition => ({
  id,
  apiModel: id,
  name: id,
  type: 'image',
  providerId: 'kie-ai',
  isBuiltIn: true,
  isEnabled: true,
  params: { defaultAspectRatio: '16:9', supportedAspectRatios: ['16:9'] },
  kie: { requiresReference },
});

describe('selectImageModelForGeneration', () => {
  const promptModel = model('kie-nano-banana-2-lite', false);
  const editModel = model('kie-edit-only', true);

  it('tự dùng model prompt-only khi nhân vật chưa có ảnh tham chiếu', () => {
    expect(selectImageModelForGeneration([editModel, promptModel], editModel, false, () => true)?.id)
      .toBe(promptModel.id);
  });

  it('giữ model chỉnh ảnh khi đã có tham chiếu', () => {
    expect(selectImageModelForGeneration([editModel, promptModel], editModel, true, () => true)?.id)
      .toBe(editModel.id);
  });
});

