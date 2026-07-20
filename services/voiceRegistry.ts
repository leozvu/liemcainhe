import { VoiceProviderId, VoiceRegion } from '../types';

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

export const VOICE_PROVIDERS: VoiceProviderDefinition[] = [
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

export const getVoiceProvider = (id: VoiceProviderId): VoiceProviderDefinition =>
  VOICE_PROVIDERS.find((provider) => provider.id === id) || VOICE_PROVIDERS[0];

const readCredentials = (): Partial<Record<VoiceProviderId, VoiceProviderCredentials>> => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
};

export const getVoiceCredentials = (providerId: VoiceProviderId): VoiceProviderCredentials =>
  readCredentials()[providerId] || {};

export const setVoiceCredentials = (
  providerId: VoiceProviderId,
  credentials: VoiceProviderCredentials,
): void => {
  const current = readCredentials();
  const normalized = {
    apiKey: credentials.apiKey?.trim() || undefined,
    appId: credentials.appId?.trim() || undefined,
    callbackUrl: credentials.callbackUrl?.trim() || undefined,
  };
  current[providerId] = normalized;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
};

export const clearVoiceCredentials = (providerId: VoiceProviderId): void => {
  const current = readCredentials();
  delete current[providerId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
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

