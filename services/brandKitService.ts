import {
  AgencyClient,
  BrandAsset,
  BrandAssetType,
  BrandColor,
  BrandKit,
  BrandPlatformRule,
  CampaignPlatform,
} from '../types';

const createId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const PLATFORM_LABELS: Record<CampaignPlatform, string> = {
  tiktok: 'TikTok',
  facebook: 'Facebook',
  instagram: 'Instagram/Reels',
  youtube: 'YouTube/Shorts',
  website: 'Website',
  other: 'Kênh khác',
};

const uniqueText = (value: unknown, limit = 40): string[] => Array.from(new Set(
  (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean),
)).slice(0, limit);

const normalizeHex = (value: unknown): string => {
  const raw = String(value || '').trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(raw)) return raw;
  if (/^[0-9A-F]{6}$/.test(raw)) return `#${raw}`;
  return '#18D8E8';
};

export const createDefaultBrandKit = (): BrandKit => ({
  colors: [],
  fonts: [],
  assets: [],
  toneOfVoice: '',
  mandatoryTerms: [],
  forbiddenTerms: [],
  ctas: [],
  approvedExamples: [],
  platformRules: [],
  updatedAt: Date.now(),
});

export const normalizeBrandKit = (value?: Partial<BrandKit> | null): BrandKit => {
  const source = value || createDefaultBrandKit();
  const colors: BrandColor[] = (Array.isArray(source.colors) ? source.colors : []).map((item, index) => ({
    id: item?.id || createId(`color_${index + 1}`),
    name: String(item?.name || `Màu ${index + 1}`).trim().slice(0, 80),
    hex: normalizeHex(item?.hex),
    usage: String(item?.usage || '').trim().slice(0, 240) || undefined,
  })).slice(0, 16);
  const assets: BrandAsset[] = (Array.isArray(source.assets) ? source.assets : []).map((item, index) => {
    const allowedTypes: BrandAssetType[] = ['logo', 'product', 'character', 'reference'];
    return {
      id: item?.id || createId(`asset_${index + 1}`),
      type: allowedTypes.includes(item?.type as BrandAssetType) ? item.type as BrandAssetType : 'reference',
      name: String(item?.name || `Tài nguyên ${index + 1}`).trim().slice(0, 160),
      url: String(item?.url || '').trim(),
      notes: String(item?.notes || '').trim().slice(0, 800) || undefined,
    };
  }).filter((item) => item.url).slice(0, 60);
  const platformRules: BrandPlatformRule[] = (Array.isArray(source.platformRules) ? source.platformRules : []).map((rule) => {
    const allowed: CampaignPlatform[] = ['tiktok', 'facebook', 'instagram', 'youtube', 'website', 'other'];
    return {
      platform: allowed.includes(rule?.platform as CampaignPlatform) ? rule.platform as CampaignPlatform : 'other',
      safeZone: String(rule?.safeZone || '').trim().slice(0, 800) || undefined,
      captionStyle: String(rule?.captionStyle || '').trim().slice(0, 800) || undefined,
      guidelines: String(rule?.guidelines || '').trim().slice(0, 1600) || undefined,
    };
  }).filter((rule) => rule.safeZone || rule.captionStyle || rule.guidelines).slice(0, 12);
  const voice = source.voiceProfile;
  return {
    colors,
    fonts: uniqueText(source.fonts, 12),
    assets,
    voiceProfile: voice?.name?.trim() ? {
      name: voice.name.trim().slice(0, 160),
      providerId: voice.providerId?.trim().slice(0, 120) || undefined,
      voiceId: voice.voiceId?.trim().slice(0, 240) || undefined,
      description: voice.description?.trim().slice(0, 1000) || undefined,
      language: voice.language?.trim().slice(0, 80) || undefined,
    } : undefined,
    toneOfVoice: String(source.toneOfVoice || '').trim().slice(0, 3000),
    mandatoryTerms: uniqueText(source.mandatoryTerms),
    forbiddenTerms: uniqueText(source.forbiddenTerms),
    ctas: uniqueText(source.ctas),
    approvedExamples: uniqueText(source.approvedExamples, 20),
    platformRules,
    updatedAt: Number(source.updatedAt) || Date.now(),
  };
};

export const normalizeAgencyClient = (client: AgencyClient): AgencyClient => ({
  ...client,
  brandKit: normalizeBrandKit(client.brandKit),
});

export interface BrandKitReadiness {
  score: number;
  ready: number;
  total: number;
  missing: string[];
}

export const getBrandKitReadiness = (kitValue?: BrandKit | null): BrandKitReadiness => {
  const kit = normalizeBrandKit(kitValue);
  const checks = [
    { label: 'Logo hoặc tài nguyên chuẩn', ready: kit.assets.some((asset) => asset.type === 'logo') },
    { label: 'Bảng màu', ready: kit.colors.length > 0 },
    { label: 'Font thương hiệu', ready: kit.fonts.length > 0 },
    { label: 'Sản phẩm hoặc nhân vật chuẩn', ready: kit.assets.some((asset) => ['product', 'character'].includes(asset.type)) },
    { label: 'Tone of voice', ready: kit.toneOfVoice.length >= 20 },
    { label: 'Voice profile', ready: Boolean(kit.voiceProfile?.name) },
    { label: 'Từ bắt buộc / từ cấm', ready: kit.mandatoryTerms.length + kit.forbiddenTerms.length > 0 },
    { label: 'CTA đã duyệt', ready: kit.ctas.length > 0 },
    { label: 'Nội dung mẫu đã duyệt', ready: kit.approvedExamples.length > 0 },
    { label: 'Quy chuẩn platform / safe zone', ready: kit.platformRules.length > 0 },
  ];
  const ready = checks.filter((check) => check.ready).length;
  return {
    score: Math.round((ready / checks.length) * 100),
    ready,
    total: checks.length,
    missing: checks.filter((check) => !check.ready).map((check) => check.label),
  };
};

const assetSummary = (assets: BrandAsset[]): string[] => assets.map((asset) => (
  `- ${asset.type}: ${asset.name}${asset.notes ? ` — ${asset.notes}` : ''}`
));

export const buildBrandKitPromptContext = (kitValue?: BrandKit | null): string => {
  const kit = normalizeBrandKit(kitValue);
  const rules = kit.platformRules.map((rule) => [
    `- ${PLATFORM_LABELS[rule.platform]}`,
    rule.safeZone ? `safe zone: ${rule.safeZone}` : '',
    rule.captionStyle ? `caption: ${rule.captionStyle}` : '',
    rule.guidelines ? `lưu ý: ${rule.guidelines}` : '',
  ].filter(Boolean).join(' · '));
  return [
    'BRAND KIT — NGUỒN SỰ THẬT BẮT BUỘC:',
    `- Tone of voice: ${kit.toneOfVoice || 'Chưa chốt; không tự suy diễn'}`,
    `- Bảng màu: ${kit.colors.length ? kit.colors.map((color) => `${color.name} ${color.hex}${color.usage ? ` (${color.usage})` : ''}`).join(', ') : 'Chưa chốt'}`,
    `- Font: ${kit.fonts.length ? kit.fonts.join(', ') : 'Chưa chốt'}`,
    `- Từ/cụm từ bắt buộc: ${kit.mandatoryTerms.length ? kit.mandatoryTerms.join(' | ') : 'Không có'}`,
    `- Từ/cụm từ cấm: ${kit.forbiddenTerms.length ? kit.forbiddenTerms.join(' | ') : 'Không có'}`,
    `- CTA ưu tiên: ${kit.ctas.length ? kit.ctas.join(' | ') : 'Chưa chốt'}`,
    kit.voiceProfile ? `- Voice profile: ${kit.voiceProfile.name}${kit.voiceProfile.description ? ` — ${kit.voiceProfile.description}` : ''}${kit.voiceProfile.language ? ` — ${kit.voiceProfile.language}` : ''}` : '- Voice profile: Chưa chốt',
    ...(kit.assets.length ? ['TÀI NGUYÊN CHUẨN:', ...assetSummary(kit.assets)] : ['TÀI NGUYÊN CHUẨN: Chưa có']),
    ...(rules.length ? ['QUY CHUẨN PLATFORM:', ...rules] : ['QUY CHUẨN PLATFORM: Chưa chốt']),
    ...(kit.approvedExamples.length ? ['MẪU NỘI DUNG ĐÃ DUYỆT:', ...kit.approvedExamples.map((item) => `- ${item}`)] : []),
    'YÊU CẦU BRAND GUARD: Không thay đổi logo, màu chủ đạo, cách gọi sản phẩm/nhân vật hoặc tone đã chốt. Nếu brief xung đột Brand Kit, phải cảnh báo trước khi đề xuất.',
  ].join('\n');
};

export const buildBrandVisualGuardrails = (kitValue?: BrandKit | null): string => {
  const kit = normalizeBrandKit(kitValue);
  const logo = kit.assets.filter((asset) => asset.type === 'logo').map((asset) => asset.name);
  const products = kit.assets.filter((asset) => asset.type === 'product').map((asset) => asset.name);
  const characters = kit.assets.filter((asset) => asset.type === 'character').map((asset) => asset.name);
  return [
    kit.colors.length ? `Bảng màu thương hiệu: ${kit.colors.map((color) => `${color.name} ${color.hex}`).join(', ')}.` : '',
    kit.fonts.length ? `Font thương hiệu: ${kit.fonts.join(', ')}.` : '',
    logo.length ? `Logo chuẩn: ${logo.join(', ')}; không tự vẽ lại hoặc biến dạng.` : '',
    products.length ? `Sản phẩm chuẩn cần giữ nguyên: ${products.join(', ')}.` : '',
    characters.length ? `Nhân vật đại diện cần nhất quán: ${characters.join(', ')}.` : '',
  ].filter(Boolean).join('\n');
};

export interface BrandComplianceReport {
  score: number;
  passed: boolean;
  violations: string[];
  warnings: string[];
}

const containsTerm = (text: string, term: string): boolean => text.toLocaleLowerCase('vi').includes(term.toLocaleLowerCase('vi'));

export const inspectBrandCompliance = (content: string, kitValue?: BrandKit | null): BrandComplianceReport => {
  const kit = normalizeBrandKit(kitValue);
  const text = content.trim();
  if (!text) return { score: 100, passed: true, violations: [], warnings: [] };
  const missingTerms = kit.mandatoryTerms.filter((term) => !containsTerm(text, term));
  const forbiddenTerms = kit.forbiddenTerms.filter((term) => containsTerm(text, term));
  const hasCta = kit.ctas.length === 0 || kit.ctas.some((cta) => containsTerm(text, cta));
  const violations = [
    ...forbiddenTerms.map((term) => `Có từ/cụm từ cấm: “${term}”`),
    ...missingTerms.map((term) => `Thiếu từ/cụm từ bắt buộc: “${term}”`),
  ];
  const warnings = hasCta ? [] : ['Chưa dùng CTA nào đã được duyệt trong Brand Kit.'];
  const score = Math.max(0, 100 - forbiddenTerms.length * 30 - missingTerms.length * 18 - warnings.length * 10);
  return { score, passed: violations.length === 0, violations, warnings };
};

