export type ModelType = 'chat' | 'image' | 'video';

export type AspectRatio = '16:9' | '9:16' | '1:1';

export type VideoDuration = number;

export type VideoMode = 'sync' | 'async';

export type ProviderProtocol = 'openai-compatible' | 'google-openai' | 'replicate' | 'kie';

import {
  KIE_BUILTIN_CHAT_MODELS,
  KIE_BUILTIN_IMAGE_MODELS,
  KIE_BUILTIN_VIDEO_MODELS,
  KIE_PROVIDER_ID,
} from './kieCatalog';
import type { KieModelConfig } from './kieCatalog';

export { KIE_PROVIDER_ID } from './kieCatalog';

export const OPENROUTER_PROVIDER_ID = 'openrouter';
export const GOOGLE_PROVIDER_ID = 'google-ai-studio';
export const REPLICATE_PROVIDER_ID = 'replicate';
export const DEFAULT_PROVIDER_ID = OPENROUTER_PROVIDER_ID;
export const DEFAULT_PROVIDER_BASE_URL = 'https://openrouter.ai/api';

export interface ChatModelParams {
  temperature: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface ImageModelParams {
  defaultAspectRatio: AspectRatio;
  supportedAspectRatios: AspectRatio[];
}

export interface VideoModelParams {
  mode: VideoMode;
  defaultAspectRatio: AspectRatio;
  supportedAspectRatios: AspectRatio[];
  defaultDuration: VideoDuration;
  supportedDurations: VideoDuration[];
}

export type ModelParams = ChatModelParams | ImageModelParams | VideoModelParams;

export interface ModelDefinitionBase {
  id: string;
  apiModel?: string;
  name: string;
  type: ModelType;
  providerId: string;
  endpoint?: string;
  description?: string;
  isBuiltIn: boolean;
  isEnabled: boolean;
  apiKey?: string;
  /** Ánh xạ payload riêng cho model trong KIE Market. */
  kie?: KieModelConfig;
}

export interface ChatModelDefinition extends ModelDefinitionBase {
  type: 'chat';
  params: ChatModelParams;
}

export interface ImageModelDefinition extends ModelDefinitionBase {
  type: 'image';
  params: ImageModelParams;
}

export interface VideoModelDefinition extends ModelDefinitionBase {
  type: 'video';
  params: VideoModelParams;
}

export type ModelDefinition = ChatModelDefinition | ImageModelDefinition | VideoModelDefinition;

export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  protocol: ProviderProtocol;
  supportedModelTypes: ModelType[];
  description?: string;
  keyUrl?: string;
  isBuiltIn: boolean;
  isDefault: boolean;
}

export interface ActiveModels {
  chat: string;
  image: string;
  video: string;
}

export interface ModelRegistryState {
  providers: ModelProvider[];
  models: ModelDefinition[];
  activeModels: ActiveModels;
  /** Chỉ dùng để nhận diện và xóa cấu hình một khóa chung từ các phiên bản cũ. */
  globalApiKey?: string;
}

export interface ChatOptions {
  prompt: string;
  systemPrompt?: string;
  /** Ảnh đầu vào cho các model hội thoại có khả năng thị giác. */
  imageUrls?: string[];
  responseFormat?: 'text' | 'json';
  timeout?: number;
  overrideParams?: Partial<ChatModelParams>;
}

export interface ImageGenerateOptions {
  prompt: string;
  referenceImages?: string[];
  aspectRatio?: AspectRatio;
}

export interface VideoGenerateOptions {
  prompt: string;
  startImage?: string;
  endImage?: string;
  aspectRatio?: AspectRatio;
  duration?: VideoDuration;
}

export const DEFAULT_CHAT_PARAMS: ChatModelParams = {
  temperature: 0.7,
  maxTokens: undefined,
};

export const DEFAULT_IMAGE_PARAMS: ImageModelParams = {
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],
};

export const DEFAULT_VIDEO_PARAMS_VEO: VideoModelParams = {
  mode: 'sync',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],
  defaultDuration: 8,
  supportedDurations: [8],
};

export const DEFAULT_VIDEO_PARAMS_SORA: VideoModelParams = {
  mode: 'async',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16', '1:1'],
  defaultDuration: 8,
  supportedDurations: [4, 8, 12],
};

/** Mã mô hình văn bản mặc định. */
export const DEFAULT_CHAT_MODEL_ID = 'openrouter-auto';

/** Mô hình văn bản tích hợp đã ngừng dùng; cấu hình cũ sẽ chuyển sang mô hình mặc định. */
export const DEPRECATED_BUILTIN_CHAT_MODEL_IDS = [
  'gpt-5.2',
  'gpt-5.4',
  'gpt-5.1',
  'gpt-41',
  'claude-sonnet-4-5-20250929',
] as const;

/** Chuyển mã mô hình tích hợp cũ sang mặc định và giữ nguyên mô hình tùy chỉnh. */
export const migrateDeprecatedChatModelId = (modelId?: string): string => {
  if (!modelId?.trim()) return DEFAULT_CHAT_MODEL_ID;
  if ((DEPRECATED_BUILTIN_CHAT_MODEL_IDS as readonly string[]).includes(modelId)) {
    return DEFAULT_CHAT_MODEL_ID;
  }
  return modelId;
};

export const BUILTIN_CHAT_MODELS: ChatModelDefinition[] = [
  {
    id: 'openrouter-gpt-5.2',
    name: 'GPT-5.2',
    apiModel: 'openai/gpt-5.2',
    type: 'chat',
    providerId: OPENROUTER_PROVIDER_ID,
    endpoint: '/v1/chat/completions',
    description: 'Lựa chọn ổn định để phân tích kịch bản, chia cảnh và trích xuất nhân vật/sự kiện',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'openrouter-auto',
    name: 'OpenRouter tự động chọn',
    apiModel: 'openrouter/auto',
    type: 'chat',
    providerId: OPENROUTER_PROVIDER_ID,
    endpoint: '/v1/chat/completions',
    description: 'Tự động chọn mô hình hội thoại phù hợp và chuyển tuyến khi nhà cung cấp gặp sự cố',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'google-gemini-flash',
    name: 'Gemini Flash',
    apiModel: 'gemini-flash-latest',
    type: 'chat',
    providerId: GOOGLE_PROVIDER_ID,
    endpoint: '/chat/completions',
    description: 'Mô hình Gemini tốc độ cao qua giao thức tương thích OpenAI',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
];

/** Mã mô hình hình ảnh mặc định. */
export const DEFAULT_IMAGE_MODEL_ID = 'kie-nano-banana-2-lite';

export const BUILTIN_IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: 'replicate-nano-banana',
    name: 'Nano Banana',
    apiModel: 'google/nano-banana',
    type: 'image',
    providerId: REPLICATE_PROVIDER_ID,
    description: 'Tạo và chỉnh sửa ảnh với nhiều ảnh tham chiếu qua Replicate',
    isBuiltIn: true,
    isEnabled: false,
    params: { ...DEFAULT_IMAGE_PARAMS, supportedAspectRatios: ['16:9', '9:16', '1:1'] },
  },
  {
    id: 'replicate-flux-kontext-pro',
    name: 'FLUX Kontext Pro',
    apiModel: 'black-forest-labs/flux-kontext-pro',
    type: 'image',
    providerId: REPLICATE_PROVIDER_ID,
    description: 'Chỉnh sửa ảnh và duy trì tạo hình từ một ảnh tham chiếu',
    isBuiltIn: true,
    isEnabled: false,
    params: { ...DEFAULT_IMAGE_PARAMS },
  },
];

/** Mô hình hình ảnh tích hợp đã ngừng dùng. */
export const DEPRECATED_BUILTIN_IMAGE_MODEL_IDS = ['gemini-3-pro-image-preview', 'qwen-image-2.0'] as const;

/** Mã mô hình video mặc định. */
export const DEFAULT_VIDEO_MODEL_ID = 'kie-bytedance-seedance-2-fast';

/** Mô hình video tích hợp đã ngừng dùng; cấu hình cũ sẽ chuyển sang mặc định. */
export const DEPRECATED_BUILTIN_VIDEO_MODEL_IDS = [
  'veo',
  'veo-3.1',
  'veo_3_1_t2v_fast_landscape',
  'veo_3_1_t2v_fast_portrait',
  'veo_3_1_i2v_s_fast_fl_landscape',
  'veo_3_1_i2v_s_fast_fl_portrait',
  atob('ZG91YmFvLXNlZWRhbmNlLTItMC1mYXN0'),
  atob('ZG91YmFvLXNlZWRhbmNlLTItMA=='),
  'sora-2',
] as const;

/** Chuyển mã video tích hợp cũ sang mặc định và giữ nguyên mô hình tùy chỉnh. */
export const migrateDeprecatedVideoModelId = (modelId?: string): string => {
  if (!modelId?.trim()) return DEFAULT_VIDEO_MODEL_ID;
  if (
    modelId.startsWith('veo_3_1') ||
    (DEPRECATED_BUILTIN_VIDEO_MODEL_IDS as readonly string[]).includes(modelId)
  ) {
    return DEFAULT_VIDEO_MODEL_ID;
  }
  return modelId;
};

export const BUILTIN_VIDEO_MODELS: VideoModelDefinition[] = [
  {
    id: 'replicate-seedance-1-pro',
    name: 'Seedance 1 Pro',
    type: 'video',
    providerId: REPLICATE_PROVIDER_ID,
    apiModel: 'bytedance/seedance-1-pro',
    description: 'Tạo video từ văn bản, khung đầu và khung cuối qua Replicate',
    isBuiltIn: true,
    isEnabled: false,
    params: { ...DEFAULT_VIDEO_PARAMS_SORA },
  },
  {
    id: 'replicate-veo-3',
    name: 'Veo 3',
    type: 'video',
    providerId: REPLICATE_PROVIDER_ID,
    apiModel: 'google/veo-3',
    description: 'Tạo video điện ảnh kèm âm thanh qua Replicate',
    isBuiltIn: true,
    isEnabled: false,
    params: { ...DEFAULT_VIDEO_PARAMS_VEO },
  },
];

export const BUILTIN_PROVIDERS: ModelProvider[] = [
  {
    id: KIE_PROVIDER_ID,
    name: 'KIE AI',
    baseUrl: 'https://api.kie.ai',
    protocol: 'kie',
    supportedModelTypes: ['chat', 'image', 'video'],
    description: 'Một khóa cho catalog mô hình hội thoại, hình ảnh và video của KIE.',
    keyUrl: 'https://kie.ai/api-key',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: OPENROUTER_PROVIDER_ID,
    name: 'OpenRouter',
    baseUrl: DEFAULT_PROVIDER_BASE_URL,
    protocol: 'openai-compatible',
    supportedModelTypes: ['chat'],
    description: 'Kết nối nhiều mô hình hội thoại như GPT, Claude, Gemini, Qwen và DeepSeek.',
    keyUrl: 'https://openrouter.ai/settings/keys',
    isBuiltIn: true,
    isDefault: true,
  },
  {
    id: GOOGLE_PROVIDER_ID,
    name: 'Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    protocol: 'google-openai',
    supportedModelTypes: ['chat'],
    description: 'Kết nối trực tiếp các mô hình Gemini bằng khóa Google AI Studio.',
    keyUrl: 'https://aistudio.google.com/apikey',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: REPLICATE_PROVIDER_ID,
    name: 'Replicate',
    baseUrl: 'https://api.replicate.com',
    protocol: 'replicate',
    supportedModelTypes: ['image', 'video'],
    description: 'Chạy các mô hình tạo ảnh và video như FLUX, Nano Banana, Seedance và Veo.',
    keyUrl: 'https://replicate.com/account/api-tokens',
    isBuiltIn: true,
    isDefault: false,
  },
];

export const ALL_BUILTIN_MODELS: ModelDefinition[] = [
  ...BUILTIN_CHAT_MODELS,
  ...KIE_BUILTIN_CHAT_MODELS,
  ...BUILTIN_IMAGE_MODELS,
  ...KIE_BUILTIN_IMAGE_MODELS,
  ...BUILTIN_VIDEO_MODELS,
  ...KIE_BUILTIN_VIDEO_MODELS,
];

export const DEFAULT_ACTIVE_MODELS: ActiveModels = {
  chat: DEFAULT_CHAT_MODEL_ID,
  image: DEFAULT_IMAGE_MODEL_ID,
  video: DEFAULT_VIDEO_MODEL_ID,
};
