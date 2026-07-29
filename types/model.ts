import type { CoreStage, ProductionJob, ProductionJobKind } from '../types';

export type ModelType = 'chat' | 'image' | 'video';

export type AspectRatio = '16:9' | '9:16' | '1:1';

export type VideoDuration = number;

export type VideoMode = 'sync' | 'async';

export type ProviderProtocol = 'openai-compatible' | 'google-openai' | 'replicate' | 'kie' | 'shopaikey';

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
export const SHOPAIKEY_PROVIDER_ID = 'shopaikey';
export const DEFAULT_PROVIDER_ID = SHOPAIKEY_PROVIDER_ID;
export const DEFAULT_PROVIDER_BASE_URL = 'https://api.shopaikey.com';

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
  /** Mã tài nguyên nghiệp vụ để quy chi phí về shot/asset. */
  usageResourceId?: string;
}

export interface ImageGenerateOptions {
  prompt: string;
  referenceImages?: string[];
  aspectRatio?: AspectRatio;
  usageResourceId?: string;
  execution?: MediaExecutionContext;
  /** Hook nội bộ: HTTP 2xx nghĩa là provider có thể đã tính phí dù body lỗi. */
  onProviderAccepted?: () => void | Promise<void>;
  /** Hook nội bộ: gọi ngay khi provider xác nhận đã tạo tác vụ trả phí. */
  onProviderTaskId?: (taskId: string) => void | Promise<void>;
}

export interface VideoGenerateOptions {
  prompt: string;
  startImage?: string;
  endImage?: string;
  aspectRatio?: AspectRatio;
  duration?: VideoDuration;
  usageResourceId?: string;
  execution?: MediaExecutionContext;
  /** Hook nội bộ: HTTP 2xx nghĩa là provider có thể đã tính phí dù body lỗi. */
  onProviderAccepted?: () => void | Promise<void>;
  /** Hook nội bộ: gọi ngay khi provider xác nhận đã tạo tác vụ trả phí. */
  onProviderTaskId?: (taskId: string) => void | Promise<void>;
}

/** Metadata nối một lần sinh media với hàng đợi bền vững của project. */
export interface MediaExecutionContext {
  projectId: string;
  jobs: ProductionJob[];
  kind: Extract<ProductionJobKind, 'asset-image' | 'keyframe-image' | 'video' | 'voice'>;
  stage: CoreStage;
  label: string;
  resourceId: string;
  /** Kết quả cũ tạo thành version key mới khi người dùng chủ động regenerate. */
  previousOutput?: string;
  onJobChange?: (job: ProductionJob) => void;
  /** Ghi output nghiệp vụ bền vững trước khi job được phép completed. */
  commitResult?: (result: unknown) => void | Promise<void>;
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
export const DEFAULT_CHAT_MODEL_ID = 'shopaikey-grok-fast';

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
    id: 'shopaikey-grok-fast',
    name: 'Grok 4.1 Fast Reasoning',
    apiModel: 'grok-4-1-fast-reasoning',
    type: 'chat',
    providerId: SHOPAIKEY_PROVIDER_ID,
    endpoint: '/v1/chat/completions',
    description: 'Tuyến nháp nội bộ chi phí thấp cho brief, hook, kịch bản và storyboard.',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'shopaikey-qwen3.5-plus',
    name: 'Qwen 3.5 Plus',
    apiModel: 'qwen3.5-plus',
    type: 'chat',
    providerId: SHOPAIKEY_PROVIDER_ID,
    endpoint: '/v1/chat/completions',
    description: 'Ngữ cảnh dài, phù hợp phân tích brief và tài liệu chiến dịch.',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'shopaikey-gpt-5-mini',
    name: 'GPT-5 Mini',
    apiModel: 'gpt-5-mini',
    type: 'chat',
    providerId: SHOPAIKEY_PROVIDER_ID,
    endpoint: '/v1/chat/completions',
    description: 'Tuyến dự phòng ổn định, chi phí thấp cho JSON storyboard và tác vụ vận hành.',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'shopaikey-gpt-5.2',
    name: 'GPT-5.2',
    apiModel: 'gpt-5.2-2025-12-11',
    type: 'chat',
    providerId: SHOPAIKEY_PROVIDER_ID,
    endpoint: '/v1/chat/completions',
    description: 'Tuyến chất lượng cao cho bản kịch bản và quyết định sáng tạo đã duyệt.',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'shopaikey-gpt-4.1',
    name: 'GPT-4.1',
    apiModel: 'gpt-4.1',
    type: 'chat',
    providerId: SHOPAIKEY_PROVIDER_ID,
    endpoint: '/v1/chat/completions',
    description: 'Tuyến ổn định có vision cho Supervisor và kiểm tra hình ảnh.',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
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
export const DEFAULT_IMAGE_MODEL_ID = 'shopaikey-nano-banana-2';

export const BUILTIN_IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: 'shopaikey-nano-banana-2',
    name: 'Nano Banana 2',
    apiModel: 'nano-banana-2',
    type: 'image',
    providerId: SHOPAIKEY_PROVIDER_ID,
    endpoint: '/images/google/generations',
    description: 'Tuyến ảnh mặc định, hỗ trợ tối đa 5 ảnh tham chiếu và đầu ra 2K.',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS, supportedAspectRatios: ['16:9', '9:16', '1:1'] },
  },
  {
    id: 'shopaikey-nano-banana-pro',
    name: 'Nano Banana Pro',
    apiModel: 'nano-banana-pro',
    type: 'image',
    providerId: SHOPAIKEY_PROVIDER_ID,
    endpoint: '/images/google/generations',
    description: 'Tuyến ảnh chất lượng cao cho key visual và shot đã được duyệt.',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS, supportedAspectRatios: ['16:9', '9:16', '1:1'] },
  },
  {
    id: 'shopaikey-gpt-image-1',
    name: 'GPT Image 1',
    apiModel: 'gpt-image-1',
    type: 'image',
    providerId: SHOPAIKEY_PROVIDER_ID,
    endpoint: '/v1/images/generations',
    description: 'Tuyến OpenAI Images cho hình quảng cáo và biến thể thiết kế.',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS, supportedAspectRatios: ['16:9', '9:16', '1:1'] },
  },
  {
    id: 'shopaikey-grok-image',
    name: 'Grok Imagine Image',
    apiModel: 'grok-imagine-image',
    type: 'image',
    providerId: SHOPAIKEY_PROVIDER_ID,
    endpoint: '/v1/chat/completions',
    description: 'Tuyến thử ý tưởng hình nhanh qua giao thức OpenAI của ShopAIKey.',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS, supportedAspectRatios: ['16:9', '9:16', '1:1'] },
  },
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
export const DEFAULT_VIDEO_MODEL_ID = 'shopaikey-veo3-fast';

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
    id: 'shopaikey-veo3-fast',
    name: 'Veo 3 Fast',
    type: 'video',
    providerId: SHOPAIKEY_PROVIDER_ID,
    apiModel: 'veo3-fast',
    endpoint: '/v1/video/generations',
    description: 'Tuyến video mặc định cho bản nháp và shot social.',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_SORA, supportedDurations: [5, 8] },
  },
  {
    id: 'shopaikey-veo31-fast',
    name: 'Veo 3.1 Fast',
    type: 'video',
    providerId: SHOPAIKEY_PROVIDER_ID,
    apiModel: 'veo3.1-fast',
    endpoint: '/v1/video/generations',
    description: 'Tuyến Veo mới hơn cho shot đã duyệt và chuyển động phức tạp.',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_SORA, supportedDurations: [5, 8] },
  },
  {
    id: 'shopaikey-grok-video-3',
    name: 'Grok Video 3',
    type: 'video',
    providerId: SHOPAIKEY_PROVIDER_ID,
    apiModel: 'grok-video-3',
    endpoint: '/v1/video/generations',
    description: 'Tuyến video ngắn có lựa chọn thời lượng và độ phân giải.',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_SORA, supportedDurations: [5, 8, 10] },
  },
  {
    id: 'shopaikey-sora-2',
    name: 'Sora 2',
    type: 'video',
    providerId: SHOPAIKEY_PROVIDER_ID,
    apiModel: 'sora-2',
    endpoint: '/v1/videos',
    description: 'Tuyến OpenAI Videos cho shot cao cấp; chỉ dùng sau khi duyệt ngân sách.',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_SORA },
  },
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
    id: SHOPAIKEY_PROVIDER_ID,
    name: 'ShopAIKey · nội bộ Egoric',
    baseUrl: DEFAULT_PROVIDER_BASE_URL,
    protocol: 'shopaikey',
    supportedModelTypes: ['chat', 'image', 'video'],
    description: 'Cổng reverse proxy tạm thời cho vận hành nội bộ. Không dùng cho dữ liệu khách hàng nhạy cảm.',
    keyUrl: 'https://shopaikey.com/en',
    isBuiltIn: true,
    isDefault: true,
  },
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
    baseUrl: 'https://openrouter.ai/api',
    protocol: 'openai-compatible',
    supportedModelTypes: ['chat'],
    description: 'Kết nối nhiều mô hình hội thoại như GPT, Claude, Gemini, Qwen và DeepSeek.',
    keyUrl: 'https://openrouter.ai/settings/keys',
    isBuiltIn: true,
    isDefault: false,
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
