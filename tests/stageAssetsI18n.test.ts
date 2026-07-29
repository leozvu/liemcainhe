import { describe, expect, it } from 'vitest';
import { ANGLE_LABEL_KEYS, ASSET_TYPE_LABEL_KEYS, READINESS_GAP_KEYS } from '../components/StageAssets/assetCopy';
import { DEFAULTS, REGIONAL_FEATURES } from '../components/StageAssets/constants';
import { translate } from '../services/i18n';

describe('Assets Studio bilingual contract', () => {
  it('localizes reference angles and asset types without changing their IDs', () => {
    expect(Object.keys(ANGLE_LABEL_KEYS)).toEqual(['front', 'three-quarter', 'profile', 'back', 'unknown']);
    expect(translate('en', ANGLE_LABEL_KEYS['three-quarter'])).toBe('Three-quarter');
    expect(translate('vi', ANGLE_LABEL_KEYS.profile)).toBe('Nghiêng');
    expect(translate('en', ASSET_TYPE_LABEL_KEYS.product)).toBe('Product');
  });

  it('localizes existing readiness reports at the display boundary', () => {
    const source = 'Chưa khoá model, mỗi shot có thể dùng model khác nhau.';
    expect(translate('en', READINESS_GAP_KEYS[source])).toBe(
      'The model is not locked, so different shots may use different models.',
    );
  });

  it('keeps generation defaults and regional prompt directives unchanged', () => {
    expect(DEFAULTS).toMatchObject({
      language: 'Vietnamese',
      visualStyle: 'live-action',
      genre: 'Điện ảnh',
      modelVersion: 'gpt-5.2',
    });
    expect(REGIONAL_FEATURES.Vietnamese.character).toBe(
      'Người Việt Nam, đường nét khuôn mặt Đông Nam Á, bản sắc Việt Nam, ',
    );
    expect(REGIONAL_FEATURES.Japanese.scene).toBe(
      'Bối cảnh Nhật Bản, kiến trúc và thẩm mỹ Nhật Bản, ',
    );
  });
});
