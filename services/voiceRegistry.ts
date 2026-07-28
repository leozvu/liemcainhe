import { VoiceProviderId, VoiceRegion } from '../types';
import { clearVoiceSecret, getVoiceSecret, setVoiceSecret } from './credentialVault';
import { SHOPAIKEY_PROVIDER_ID } from '../types/model';
import { getProviderApiKey, setProviderApiKey } from './modelRegistry';

export interface VoiceOption {
  id: string;
  name: string;
  region: VoiceRegion;
  gender: 'female' | 'male' | 'neutral';
  description: string;
}

export interface VoiceProviderDefinition {
  id: VoiceProviderId;
  name: string;
  shortName: string;
  description: string;
  keyUrl?: string;
  supportsGeneration: boolean;
  requiresVoiceId?: boolean;
  requiresAppId?: boolean;
  requiresCallback?: boolean;
  voices: VoiceOption[];
}

export interface VoiceProviderCredentials {
  apiKey?: string;
  appId?: string;
  callbackUrl?: string;
}

const STORAGE_KEY = 'egoric_voice_provider_credentials';

const ALL_VOICE_PROVIDERS: VoiceProviderDefinition[] = [
  {
    id: 'shopaikey',
    name: 'ShopAIKey · Gemini TTS',
    shortName: 'ShopAIKey TTS',
    description: 'Giọng Gemini qua cùng khóa ShopAIKey đang dùng cho hội thoại, ảnh và video.',
    keyUrl: 'https://shopaikey.com/en',
    supportsGeneration: true,
    voices: [
      { id: 'Kore', name: 'Kore', region: 'international', gender: 'female', description: 'Giọng nữ cân bằng, phù hợp bản nháp tiếng Việt.' },
      { id: 'Aoede', name: 'Aoede', region: 'international', gender: 'female', description: 'Giọng nữ sáng và giàu năng lượng.' },
      { id: 'Leda', name: 'Leda', region: 'international', gender: 'female', description: 'Giọng nữ nhẹ, hợp nội dung lifestyle.' },
      { id: 'Orus', name: 'Orus', region: 'international', gender: 'male', description: 'Giọng nam vững và rõ.' },
      { id: 'Puck', name: 'Puck', region: 'international', gender: 'male', description: 'Giọng nam trẻ và linh hoạt.' },
    ],
  },
  {
    id: 'fpt',
    name: 'FPT.AI Voice Maker',
    shortName: 'FPT.AI',
    description: 'Giọng Việt ba miền, phù hợp thuyết minh và hội thoại sản xuất nội dung.',
    keyUrl: 'https://console.fpt.ai/',
    supportsGeneration: true,
    voices: [
      { id: 'banmai', name: 'Ban Mai', region: 'north', gender: 'female', description: 'Nữ miền Bắc · rõ ràng, quen thuộc' },
      { id: 'thuminh', name: 'Thu Minh', region: 'north', gender: 'female', description: 'Nữ miền Bắc · điềm tĩnh' },
      { id: 'leminh', name: 'Lê Minh', region: 'north', gender: 'male', description: 'Nam miền Bắc · trầm, chắc' },
      { id: 'myan', name: 'Mỹ An', region: 'central', gender: 'female', description: 'Nữ miền Trung · mềm mại' },
      { id: 'giahuy', name: 'Gia Huy', region: 'central', gender: 'male', description: 'Nam miền Trung · tự nhiên' },
      { id: 'lannhi', name: 'Lan Nhi', region: 'south', gender: 'female', description: 'Nữ miền Nam · trẻ trung' },
      { id: 'linhsan', name: 'Linh San', region: 'south', gender: 'female', description: 'Nữ miền Nam · nhẹ nhàng' },
    ],
  },
  {
    id: 'viettel',
    name: 'Viettel AI Text to Speech',
    shortName: 'Viettel AI',
    description: 'Tổng hợp trực tiếp MP3/WAV với nhiều giọng và vùng miền Việt Nam.',
    keyUrl: 'https://viettelai.vn/dashboard/token',
    supportsGeneration: true,
    voices: [
      { id: 'hn-thanhphuong', name: 'Thanh Phương', region: 'north', gender: 'female', description: 'Nữ miền Bắc · sáng, rõ' },
      { id: 'hn-namkhanh', name: 'Nam Khanh', region: 'north', gender: 'male', description: 'Nam miền Bắc · trang trọng' },
      { id: 'hn-tienquan', name: 'Tiến Quân', region: 'north', gender: 'male', description: 'Nam miền Bắc · truyền cảm' },
      { id: 'hue-baoquoc', name: 'Bảo Quốc', region: 'central', gender: 'male', description: 'Nam miền Trung · đặc trưng Huế' },
      { id: 'hcm-diemmy', name: 'Diễm My', region: 'south', gender: 'female', description: 'Nữ miền Nam · gần gũi' },
      { id: 'hcm-thuyduyen', name: 'Thúy Duyên', region: 'south', gender: 'female', description: 'Nữ miền Nam · mềm, tự nhiên' },
      { id: 'hcm-minhquan', name: 'Minh Quân', region: 'south', gender: 'male', description: 'Nam miền Nam · vững, ấm' },
    ],
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    shortName: 'ElevenLabs',
    description: 'Giọng biểu cảm; dùng Eleven v3 hoặc Flash v2.5 có hỗ trợ tiếng Việt.',
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    supportsGeneration: true,
    requiresVoiceId: true,
    voices: [],
  },
  {
    id: 'vbee',
    name: 'Vbee AIVoice API',
    shortName: 'Vbee',
    description: 'API bất đồng bộ dành cho doanh nghiệp; cần App ID và callback URL công khai.',
    keyUrl: 'https://vbee.vn/api',
    supportsGeneration: false,
    requiresVoiceId: true,
    requiresAppId: true,
    requiresCallback: true,
    voices: [],
  },
  {
    id: 'human',
    name: 'Diễn viên lồng tiếng',
    shortName: 'Người thật',
    description: 'Tải bản thu thật, quản lý nhiều take và chọn bản phát hành cuối.',
    supportsGeneration: false,
    voices: [],
  },
];

const VISIBLE_VOICE_PROVIDER_IDS = new Set<VoiceProviderId>(['shopaikey', 'human']);

// Chỉ ShopAIKey và bản thu người thật được đưa lên giao diện production.
// Các định nghĩa cũ vẫn được giữ nội bộ để đọc được project/take đã tạo trước đây.
export const VOICE_PROVIDERS: VoiceProviderDefinition[] = ALL_VOICE_PROVIDERS.filter((provider) =>
  VISIBLE_VOICE_PROVIDER_IDS.has(provider.id),
);

export const getVoiceProvider = (id: VoiceProviderId): VoiceProviderDefinition =>
  ALL_VOICE_PROVIDERS.find((provider) => provider.id === id)
  || ALL_VOICE_PROVIDERS.find((provider) => provider.id === 'shopaikey')!;

export const normalizeProductionVoiceProviderId = (id?: VoiceProviderId): VoiceProviderId =>
  id === 'human' ? 'human' : 'shopaikey';

let legacyCredentialsMigrated = false;

const migrateLegacyCredentials = (): void => {
  if (legacyCredentialsMigrated || typeof localStorage === 'undefined') return;
  legacyCredentialsMigrated = true;
  try {
    const legacy = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<Record<VoiceProviderId, VoiceProviderCredentials>>;
    Object.entries(legacy).forEach(([providerId, credentials]) => {
      if (credentials && typeof credentials === 'object') setVoiceSecret(providerId, credentials);
    });
  } catch {
    // Bản lưu cũ hỏng không được phép chặn Xưởng giọng Việt.
  } finally {
    localStorage.removeItem(STORAGE_KEY);
  }
};

export const getVoiceCredentials = (providerId: VoiceProviderId): VoiceProviderCredentials => {
  migrateLegacyCredentials();
  if (providerId === 'shopaikey') return { apiKey: getProviderApiKey(SHOPAIKEY_PROVIDER_ID) };
  return getVoiceSecret(providerId);
};

export const setVoiceCredentials = (
  providerId: VoiceProviderId,
  credentials: VoiceProviderCredentials,
): void => {
  const normalized = {
    apiKey: credentials.apiKey?.trim() || undefined,
    appId: credentials.appId?.trim() || undefined,
    callbackUrl: credentials.callbackUrl?.trim() || undefined,
  };
  if (providerId === 'shopaikey') {
    setProviderApiKey(SHOPAIKEY_PROVIDER_ID, normalized.apiKey || '');
    return;
  }
  setVoiceSecret(providerId, normalized);
};

export const clearVoiceCredentials = (providerId: VoiceProviderId): void => {
  if (providerId === 'shopaikey') {
    setProviderApiKey(SHOPAIKEY_PROVIDER_ID, '');
    return;
  }
  clearVoiceSecret(providerId);
};

export const isVoiceProviderConfigured = (providerId: VoiceProviderId): boolean => {
  if (providerId === 'human') return true;
  const provider = getVoiceProvider(providerId);
  const credentials = getVoiceCredentials(providerId);
  if (!credentials.apiKey) return false;
  if (provider.requiresAppId && !credentials.appId) return false;
  if (provider.requiresCallback && !credentials.callbackUrl) return false;
  return true;
};
