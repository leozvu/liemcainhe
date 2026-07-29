import { ReferenceAngle } from '../../types';
import { TranslationKey } from '../../services/i18n';

export const ANGLE_LABEL_KEYS: Record<ReferenceAngle, TranslationKey> = {
  front: 'assets.angle.front',
  'three-quarter': 'assets.angle.threeQuarter',
  profile: 'assets.angle.profile',
  back: 'assets.angle.back',
  unknown: 'assets.angle.unknown',
};

export const ASSET_TYPE_LABEL_KEYS = {
  product: 'assets.type.product',
  logo: 'assets.type.logo',
  character: 'assets.type.character',
  reference: 'assets.type.reference',
} as const satisfies Record<string, TranslationKey>;

export const READINESS_GAP_KEYS: Record<string, TranslationKey> = {
  'Chưa có ảnh tham chiếu nào.': 'assets.readiness.noReference',
  'Chỉ có một ảnh tham chiếu, khó giữ mặt ở cảnh nghiêng.': 'assets.readiness.singleReference',
  'Thiếu ảnh góc ba phần tư, góc hay dùng nhất khi quay.': 'assets.readiness.missingThreeQuarter',
  'Chưa khoá model, mỗi shot có thể dùng model khác nhau.': 'assets.readiness.unlockedModel',
};
