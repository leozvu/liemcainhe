export type ModelType = 'chat' | 'image' | 'video';

export type AspectRatio = '16:9' | '9:16' | '1:1';

export type VideoDuration = 4 | 8 | 12;

export type VideoMode = 'sync' | 'async' | 'doubao';

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
  globalApiKey?: string;
}

export interface ChatOptions {
  prompt: string;
  systemPrompt?: string;
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

export const DEFAULT_VIDEO_PARAMS_DOUBAO: VideoModelParams = {
  mode: 'doubao',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16', '1:1'],
  defaultDuration: 8,
  supportedDurations: [4, 8, 12],
};

/** 全局默认文本模型 ID */
export const DEFAULT_CHAT_MODEL_ID = 'gpt-5.2';

/** 已下架的内置文本模型（加载时迁移到默认模型，自定义模型不受影响） */
export const DEPRECATED_BUILTIN_CHAT_MODEL_IDS = [
  'gpt-5.1',
  'gpt-41',
  'claude-sonnet-4-5-20250929',
] as const;

/** 将旧内置模型 ID 迁移为默认；其余 ID（含用户自定义）原样保留 */
export const migrateDeprecatedChatModelId = (modelId?: string): string => {
  if (!modelId?.trim()) return DEFAULT_CHAT_MODEL_ID;
  if ((DEPRECATED_BUILTIN_CHAT_MODEL_IDS as readonly string[]).includes(modelId)) {
    return DEFAULT_CHAT_MODEL_ID;
  }
  return modelId;
};

export const BUILTIN_CHAT_MODELS: ChatModelDefinition[] = [
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    type: 'chat',
    providerId: 'antsk',
    description: 'Lựa chọn ổn định để phân tích kịch bản, chia cảnh và trích xuất nhân vật/sự kiện',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    type: 'chat',
    providerId: 'antsk',
    description: 'Tăng cường sáng tạo, hỗ trợ nhiều phương án chia cảnh, nhịp kịch bản và gợi ý máy quay',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
];

/** 全局默认图片模型 ID */
export const DEFAULT_IMAGE_MODEL_ID = 'qwen-image-2.0';

export const BUILTIN_IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: 'qwen-image-2.0',
    name: 'Qwen Image 2.0',
    type: 'image',
    providerId: 'antsk',
    endpoint: '/v1/images/generations',
    description: 'Tạo ảnh Qwen qua endpoint /v1/images/generations',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS },
  },
];

/** 已下架的内置图片模型（加载时移除，激活项迁移到默认模型） */
export const DEPRECATED_BUILTIN_IMAGE_MODEL_IDS = ['gemini-3-pro-image-preview'] as const;

/** 全局默认视频模型 ID */
export const DEFAULT_VIDEO_MODEL_ID = 'doubao-seedance-2-0-fast';

/** 已下架的内置视频模型（加载时迁移到默认视频模型，自定义模型不受影响） */
export const DEPRECATED_BUILTIN_VIDEO_MODEL_IDS = [
  'veo',
  'veo-3.1',
  'veo_3_1_t2v_fast_landscape',
  'veo_3_1_t2v_fast_portrait',
  'veo_3_1_i2v_s_fast_fl_landscape',
  'veo_3_1_i2v_s_fast_fl_portrait',
] as const;

/** 将旧内置视频模型 ID 迁移为默认视频模型；其余 ID（含用户自定义）原样保留 */
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
    id: 'doubao-seedance-2-0-fast',
    name: 'Doubao Seedance 2.0 Fast',
    type: 'video',
    providerId: 'antsk',
    apiModel: 'doubao-seedance-2-0-fast',
    endpoint: '/v1/videos',
    description: 'Tạo video Doubao Seedance 2.0 Fast qua /v1/videos bất đồng bộ (khuyên dùng)',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_SORA },
  },
  {
    id: 'sora-2',
    name: 'Sora-2',
    type: 'video',
    providerId: 'antsk',
    apiModel: 'sora-2',
    endpoint: '/v1/videos',
    description: 'Tạo video OpenAI Sora ở chế độ bất đồng bộ, hỗ trợ nhiều thời lượng',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_SORA },
  },
];

export const DEPEI_PROVIDER_BASE_URL = 'https://api.gitcc.com';

export const BUILTIN_PROVIDERS: ModelProvider[] = [
  {
    id: 'antsk',
    name: 'Gateway AI mặc định',
    baseUrl: DEPEI_PROVIDER_BASE_URL,
    isBuiltIn: true,
    isDefault: true,
  },
];

export const ALL_BUILTIN_MODELS: ModelDefinition[] = [
  ...BUILTIN_CHAT_MODELS,
  ...BUILTIN_IMAGE_MODELS,
  ...BUILTIN_VIDEO_MODELS,
];

export const DEFAULT_ACTIVE_MODELS: ActiveModels = {
  chat: DEFAULT_CHAT_MODEL_ID,
  image: DEFAULT_IMAGE_MODEL_ID,
  video: DEFAULT_VIDEO_MODEL_ID,
};
