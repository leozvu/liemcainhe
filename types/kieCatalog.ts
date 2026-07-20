import type {
  AspectRatio,
  ChatModelDefinition,
  ImageModelDefinition,
  VideoDuration,
  VideoModelDefinition,
} from './model';

export const KIE_PROVIDER_ID = 'kie-ai';

export type KieTaskApi = 'market' | 'veo';
export type KieChatApi = 'chat-completions' | 'responses' | 'claude';

export interface KieModelConfig {
  taskApi?: KieTaskApi;
  chatApi?: KieChatApi;
  omitModel?: boolean;
  referenceField?: string;
  referenceMode?: 'single' | 'array';
  endReferenceField?: string;
  requiresReference?: boolean;
  maxReferences?: number;
  aspectRatioField?: string;
  aspectRatioMap?: Partial<Record<AspectRatio, string>>;
  durationField?: string;
  durationAsString?: boolean;
  omitPrompt?: boolean;
  defaults?: Record<string, string | number | boolean | string[]>;
}

const imageRatios: AspectRatio[] = ['16:9', '9:16', '1:1'];
const videoRatios: AspectRatio[] = ['16:9', '9:16', '1:1'];
const directRatio = { aspectRatioField: 'aspect_ratio' } satisfies Partial<KieModelConfig>;
const sizedRatio = {
  aspectRatioField: 'image_size',
  aspectRatioMap: { '16:9': 'landscape_16_9', '9:16': 'portrait_16_9', '1:1': 'square' },
} satisfies Partial<KieModelConfig>;

const chat = (
  id: string,
  name: string,
  apiModel: string,
  endpoint: string,
  chatApi: KieChatApi,
  omitModel = false,
): ChatModelDefinition => ({
  id: `kie-${id}`,
  name,
  apiModel,
  type: 'chat',
  providerId: KIE_PROVIDER_ID,
  endpoint,
  description: `Hội thoại qua KIE · ${chatApi === 'claude' ? 'giao thức Claude' : chatApi === 'responses' ? 'Responses API' : 'Chat Completions'}`,
  isBuiltIn: true,
  isEnabled: true,
  params: { temperature: 0.7 },
  kie: { chatApi, omitModel },
});

const image = (
  apiModel: string,
  name: string,
  config: KieModelConfig = {},
  description = 'Tạo ảnh qua KIE',
): ImageModelDefinition => ({
  id: `kie-${apiModel.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`,
  apiModel,
  name,
  type: 'image',
  providerId: KIE_PROVIDER_ID,
  description,
  isBuiltIn: true,
  isEnabled: true,
  params: { defaultAspectRatio: '16:9', supportedAspectRatios: imageRatios },
  kie: { taskApi: 'market', ...config },
});

const video = (
  apiModel: string,
  name: string,
  config: KieModelConfig,
  durations: VideoDuration[] = [5, 10],
  description = 'Tạo video qua KIE',
): VideoModelDefinition => ({
  id: `kie-${apiModel.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`,
  apiModel,
  name,
  type: 'video',
  providerId: KIE_PROVIDER_ID,
  description,
  isBuiltIn: true,
  isEnabled: true,
  params: {
    mode: 'async',
    defaultAspectRatio: '16:9',
    supportedAspectRatios: videoRatios,
    defaultDuration: durations[0],
    supportedDurations: durations,
  },
  kie: { taskApi: 'market', durationField: 'duration', ...config },
});

export const KIE_BUILTIN_CHAT_MODELS: ChatModelDefinition[] = [
  chat('gpt-5-2', 'GPT-5.2', 'gpt-5.2', '/gpt-5-2/v1/chat/completions', 'chat-completions', true),
  chat('gpt-5-4', 'GPT-5.4', 'gpt-5-4', '/codex/v1/responses', 'responses'),
  chat('gpt-5-5', 'GPT-5.5', 'gpt-5-5', '/codex/v1/responses', 'responses'),
  chat('gpt-5-6-luna', 'GPT-5.6 Luna', 'gpt-5-6-luna', '/codex/v1/responses', 'responses'),
  chat('gpt-5-6-terra', 'GPT-5.6 Terra', 'gpt-5-6-terra', '/codex/v1/responses', 'responses'),
  chat('gpt-5-6-sol', 'GPT-5.6 Sol', 'gpt-5-6-sol', '/codex/v1/responses', 'responses'),
  chat('claude-opus-4-7', 'Claude Opus 4.7', 'claude-opus-4-7', '/claude/v1/messages', 'claude'),
  chat('claude-opus-4-8', 'Claude Opus 4.8', 'claude-opus-4-8', '/claude/v1/messages', 'claude'),
  chat('claude-fable-5', 'Claude Fable 5', 'claude-fable-5', '/claude/v1/messages', 'claude'),
  chat('claude-sonnet-5', 'Claude Sonnet 5', 'claude-sonnet-5', '/claude/v1/messages', 'claude'),
  chat('claude-haiku-4-5', 'Claude Haiku 4.5', 'claude-haiku-4-5', '/claude/v1/messages', 'claude'),
  chat('claude-opus-4-5', 'Claude Opus 4.5', 'claude-opus-4-5', '/claude/v1/messages', 'claude'),
  chat('claude-opus-4-6', 'Claude Opus 4.6', 'claude-opus-4-6', '/claude/v1/messages', 'claude'),
  chat('claude-sonnet-4-5', 'Claude Sonnet 4.5', 'claude-sonnet-4-5', '/claude/v1/messages', 'claude'),
  chat('claude-sonnet-4-6', 'Claude Sonnet 4.6', 'claude-sonnet-4-6', '/claude/v1/messages', 'claude'),
  chat('gpt-codex', 'GPT Codex', 'gpt-5.1-codex', '/api/v1/responses', 'responses'),
  chat('gemini-2-5-pro', 'Gemini 2.5 Pro', 'gemini-2.5-pro', '/gemini-2.5-pro/v1/chat/completions', 'chat-completions', true),
  chat('gemini-3-pro', 'Gemini 3 Pro', 'gemini-3-pro', '/gemini-3-pro/v1/chat/completions', 'chat-completions', true),
  chat('gemini-3-1-pro', 'Gemini 3.1 Pro', 'gemini-3.1-pro', '/gemini-3.1-pro/v1/chat/completions', 'chat-completions'),
  chat('gemini-2-5-flash', 'Gemini 2.5 Flash', 'gemini-2.5-flash', '/gemini-2.5-flash/v1/chat/completions', 'chat-completions', true),
  chat('gemini-3-flash', 'Gemini 3 Flash', 'gemini-3-flash', '/gemini-3-flash/v1/chat/completions', 'chat-completions', true),
  chat('gemini-3-5-flash', 'Gemini 3.5 Flash', 'gemini-3.5-flash', '/gemini-3-5-flash-openai/v1/chat/completions', 'chat-completions', true),
  chat('grok-4-3', 'Grok 4.3', 'grok-4-3', '/grok/v1/responses', 'responses'),
  chat('grok-4-5', 'Grok 4.5', 'grok-4-5', '/grok/v1/responses', 'responses'),
];

export const KIE_BUILTIN_IMAGE_MODELS: ImageModelDefinition[] = [
  image('nano-banana-2-lite', 'Nano Banana 2 Lite', { ...directRatio, referenceField: 'image_urls', referenceMode: 'array', maxReferences: 10 }, 'Tiết kiệm · tạo/chỉnh ảnh · tối đa 10 ảnh tham chiếu'),
  image('nano-banana-2', 'Nano Banana 2', { ...directRatio, referenceField: 'image_input', referenceMode: 'array', maxReferences: 10, defaults: { resolution: '1K', output_format: 'png' } }, 'Cân bằng · tạo/chỉnh ảnh chất lượng cao'),
  image('nano-banana-pro', 'Nano Banana Pro', { ...directRatio, referenceField: 'image_input', referenceMode: 'array', requiresReference: true, defaults: { resolution: '1K', output_format: 'png' } }, 'Cao cấp · cần ảnh tham chiếu'),
  image('google/nano-banana', 'Nano Banana', { ...directRatio, defaults: { output_format: 'png', image_size: '1K' } }),
  image('google/nano-banana-edit', 'Nano Banana Edit', { ...directRatio, referenceField: 'image_urls', referenceMode: 'array', requiresReference: true, defaults: { output_format: 'png', image_size: '1K' } }, 'Chỉnh ảnh · cần ảnh tham chiếu'),
  image('google/imagen4-fast', 'Imagen 4 Fast', { ...directRatio }),
  image('google/imagen4', 'Imagen 4', { ...directRatio }),
  image('google/imagen4-ultra', 'Imagen 4 Ultra', { ...directRatio }),
  image('bytedance/seedream', 'Seedream 3', { ...sizedRatio, defaults: { guidance_scale: 2.5 } }),
  image('bytedance/seedream-v4-text-to-image', 'Seedream 4 · Văn bản', { ...sizedRatio, defaults: { image_resolution: '1K', max_images: 1 } }),
  image('bytedance/seedream-v4-edit', 'Seedream 4 · Chỉnh ảnh', { ...sizedRatio, referenceField: 'image_urls', referenceMode: 'array', requiresReference: true, defaults: { image_resolution: '1K', max_images: 1 } }),
  image('seedream/4.5-text-to-image', 'Seedream 4.5 · Văn bản', { ...directRatio, defaults: { quality: 'basic' } }),
  image('seedream/4.5-edit', 'Seedream 4.5 · Chỉnh ảnh', { ...directRatio, referenceField: 'image_urls', referenceMode: 'array', requiresReference: true, defaults: { quality: 'basic' } }),
  image('seedream/5-lite-text-to-image', 'Seedream 5 Lite · Văn bản', { ...directRatio, defaults: { quality: 'basic', output_format: 'png' } }),
  image('seedream/5-lite-image-to-image', 'Seedream 5 Lite · Chỉnh ảnh', { ...directRatio, referenceField: 'image_urls', referenceMode: 'array', requiresReference: true, defaults: { quality: 'basic', output_format: 'png' } }),
  image('seedream/5-pro-text-to-image', 'Seedream 5 Pro · Văn bản', { ...directRatio, defaults: { quality: 'basic', output_format: 'png' } }),
  image('seedream/5-pro-image-to-image', 'Seedream 5 Pro · Chỉnh ảnh', { ...directRatio, referenceField: 'image_urls', referenceMode: 'array', requiresReference: true, defaults: { quality: 'basic', output_format: 'png' } }),
  image('z-image', 'Z-Image', { ...directRatio }),
  image('flux-2/pro-text-to-image', 'FLUX.2 Pro · Văn bản', { ...directRatio, defaults: { resolution: '1K' } }),
  image('flux-2/pro-image-to-image', 'FLUX.2 Pro · Chỉnh ảnh', { ...directRatio, referenceField: 'input_urls', referenceMode: 'array', requiresReference: true, defaults: { resolution: '1K' } }),
  image('flux-2/flex-text-to-image', 'FLUX.2 Flex · Văn bản', { ...directRatio, defaults: { resolution: '1K' } }),
  image('flux-2/flex-image-to-image', 'FLUX.2 Flex · Chỉnh ảnh', { ...directRatio, referenceField: 'input_urls', referenceMode: 'array', requiresReference: true, defaults: { resolution: '1K' } }),
  image('grok-imagine/text-to-image', 'Grok Imagine · Văn bản', { ...directRatio, defaults: { enable_pro: false } }),
  image('grok-imagine/image-to-image', 'Grok Imagine · Chỉnh ảnh', { referenceField: 'image_urls', referenceMode: 'array', requiresReference: true }),
  image('gpt-image/1.5-text-to-image', 'GPT Image 1.5 · Văn bản', { ...directRatio, defaults: { quality: 'medium' } }),
  image('gpt-image/1.5-image-to-image', 'GPT Image 1.5 · Chỉnh ảnh', { ...directRatio, referenceField: 'input_urls', referenceMode: 'array', requiresReference: true, defaults: { quality: 'medium' } }),
  image('gpt-image-2-text-to-image', 'GPT Image 2 · Văn bản', { ...directRatio, defaults: { resolution: '1K' } }),
  image('gpt-image-2-image-to-image', 'GPT Image 2 · Chỉnh ảnh', { ...directRatio, referenceField: 'input_urls', referenceMode: 'array', requiresReference: true, defaults: { resolution: '1K' } }),
  image('ideogram/character', 'Ideogram Character', { ...sizedRatio, referenceField: 'reference_image_urls', referenceMode: 'array', defaults: { rendering_speed: 'TURBO', expand_prompt: true, num_images: 1 } }),
  image('ideogram/character-remix', 'Ideogram Character Remix', { ...sizedRatio, referenceField: 'image_url', referenceMode: 'single', requiresReference: true, defaults: { rendering_speed: 'TURBO', expand_prompt: true, num_images: 1, strength: 0.7 } }),
  image('ideogram/v3-text-to-image', 'Ideogram V3 · Văn bản', { ...sizedRatio, defaults: { rendering_speed: 'TURBO', expand_prompt: true } }),
  image('ideogram/v3-remix', 'Ideogram V3 · Remix', { ...sizedRatio, referenceField: 'image_url', referenceMode: 'single', requiresReference: true, defaults: { rendering_speed: 'TURBO', expand_prompt: true, num_images: 1, strength: 0.7 } }),
  image('qwen/text-to-image', 'Qwen · Văn bản', { ...sizedRatio, defaults: { num_inference_steps: 25, guidance_scale: 4, output_format: 'png', acceleration: 'regular' } }),
  image('qwen/image-to-image', 'Qwen · Ảnh sang ảnh', { referenceField: 'image_url', referenceMode: 'single', requiresReference: true, defaults: { strength: 0.75, output_format: 'png', acceleration: 'regular' } }),
  image('qwen/image-edit', 'Qwen · Chỉnh ảnh', { ...sizedRatio, referenceField: 'image_url', referenceMode: 'single', requiresReference: true, defaults: { num_inference_steps: 25, guidance_scale: 4, num_images: 1, output_format: 'png', acceleration: 'regular' } }),
  image('qwen2/text-to-image', 'Qwen2 · Văn bản', { ...sizedRatio, defaults: { output_format: 'png' } }),
  image('qwen2/image-edit', 'Qwen2 · Chỉnh ảnh', { ...sizedRatio, referenceField: 'image_url', referenceMode: 'single', requiresReference: true, defaults: { output_format: 'png' } }),
  image('wan/2-7-image', 'Wan 2.7 Image', { ...directRatio, referenceField: 'input_urls', referenceMode: 'array', defaults: { enable_sequential: false, resolution: '2K', thinking_mode: 'auto' } }),
  image('wan/2-7-image-pro', 'Wan 2.7 Image Pro', { ...directRatio, referenceField: 'input_urls', referenceMode: 'array', defaults: { enable_sequential: false, resolution: '2K', thinking_mode: 'auto' } }),
  image('topaz/image-upscale', 'Topaz · Nâng độ phân giải', { referenceField: 'image_url', referenceMode: 'single', requiresReference: true, omitPrompt: true, defaults: { upscale_factor: 2 } }, 'Công cụ ảnh · cần một ảnh đầu vào'),
  image('recraft/remove-background', 'Recraft · Xóa nền', { referenceField: 'image', referenceMode: 'single', requiresReference: true, omitPrompt: true }, 'Công cụ ảnh · cần một ảnh đầu vào'),
  image('recraft/crisp-upscale', 'Recraft · Làm nét', { referenceField: 'image', referenceMode: 'single', requiresReference: true, omitPrompt: true }, 'Công cụ ảnh · cần một ảnh đầu vào'),
];

const imageUrl = { referenceField: 'image_url', referenceMode: 'single', requiresReference: true } satisfies Partial<KieModelConfig>;
const imageUrls = { referenceField: 'image_urls', referenceMode: 'array', requiresReference: true } satisfies Partial<KieModelConfig>;

export const KIE_BUILTIN_VIDEO_MODELS: VideoModelDefinition[] = [
  video('bytedance/seedance-2-fast', 'Seedance 2 Fast', { ...directRatio, referenceField: 'first_frame_url', referenceMode: 'single', endReferenceField: 'last_frame_url', defaults: { resolution: '720p', generate_audio: false, web_search: false } }, [5, 8, 10, 15], 'Tiết kiệm · hỗ trợ văn bản, khung đầu và khung cuối'),
  video('bytedance/seedance-2-mini', 'Seedance 2 Mini', { ...directRatio, referenceField: 'first_frame_url', referenceMode: 'single', endReferenceField: 'last_frame_url', defaults: { resolution: '720p', generate_audio: false, web_search: false } }, [5, 8, 10, 15], 'Tiết kiệm nhất · hỗ trợ văn bản và ảnh'),
  video('bytedance/seedance-2', 'Seedance 2', { ...directRatio, referenceField: 'first_frame_url', referenceMode: 'single', endReferenceField: 'last_frame_url', defaults: { resolution: '720p', generate_audio: false, web_search: false } }, [5, 8, 10, 15]),
  video('bytedance/seedance-1.5-pro', 'Seedance 1.5 Pro', { ...directRatio, referenceField: 'input_urls', referenceMode: 'array', defaults: { resolution: '720p', fixed_lens: false, generate_audio: false } }, [4, 8, 12]),
  video('grok-imagine/text-to-video', 'Grok Imagine · Văn bản', { ...directRatio, defaults: { mode: 'normal', resolution: '480p' } }, [6, 10, 15, 30]),
  video('grok-imagine/image-to-video', 'Grok Imagine · Ảnh', { ...directRatio, ...imageUrls, defaults: { mode: 'normal', resolution: '480p' } }, [6, 10, 15, 30]),
  video('grok-imagine-video-1-5-preview', 'Grok Imagine Video 1.5', { ...directRatio, referenceField: 'image_urls', referenceMode: 'array', defaults: { resolution: '720p' } }, [5, 10]),
  video('kling-2.6/text-to-video', 'Kling 2.6 · Văn bản', { ...directRatio, durationAsString: true, defaults: { sound: false } }, [5, 10]),
  video('kling-2.6/image-to-video', 'Kling 2.6 · Ảnh', { ...imageUrls, durationAsString: true, defaults: { sound: false } }, [5, 10]),
  video('kling/v2-5-turbo-text-to-video-pro', 'Kling 2.5 Turbo Pro · Văn bản', { ...directRatio, durationAsString: true }, [5, 10]),
  video('kling/v2-5-turbo-image-to-video-pro', 'Kling 2.5 Turbo Pro · Ảnh', { ...imageUrl, endReferenceField: 'tail_image_url', durationAsString: true }, [5, 10]),
  video('kling/v2-1-master-text-to-video', 'Kling 2.1 Master · Văn bản', { ...directRatio, durationAsString: true }, [5, 10]),
  video('kling/v2-1-master-image-to-video', 'Kling 2.1 Master · Ảnh', { ...imageUrl, durationAsString: true }, [5, 10]),
  video('kling/v2-1-pro', 'Kling 2.1 Pro · Ảnh', { ...imageUrl, endReferenceField: 'tail_image_url', durationAsString: true }, [5, 10]),
  video('kling/v2-1-standard', 'Kling 2.1 Standard · Ảnh', { ...imageUrl, durationAsString: true }, [5, 10]),
  video('kling-3.0/video', 'Kling 3.0', { ...directRatio, referenceField: 'image_urls', referenceMode: 'array', durationAsString: true, maxReferences: 2, defaults: { sound: false, mode: 'std', multi_shots: false } }, [5, 10, 15]),
  video('kling/v3-turbo-text-to-video', 'Kling 3 Turbo · Văn bản', { ...directRatio, durationAsString: true, defaults: { resolution: '720p' } }, [5, 10]),
  video('kling/v3-turbo-image-to-video', 'Kling 3 Turbo · Ảnh', { ...imageUrls, durationAsString: true, maxReferences: 2, defaults: { resolution: '720p' } }, [5, 10]),
  video('bytedance/v1-pro-fast-image-to-video', 'ByteDance V1 Pro Fast · Ảnh', { ...imageUrl, defaults: { resolution: '720p' } }, [5, 10]),
  video('bytedance/v1-pro-image-to-video', 'ByteDance V1 Pro · Ảnh', { ...imageUrl, defaults: { resolution: '720p', camera_fixed: false } }, [5, 10]),
  video('bytedance/v1-pro-text-to-video', 'ByteDance V1 Pro · Văn bản', { ...directRatio, defaults: { resolution: '720p', camera_fixed: false } }, [5, 10]),
  video('bytedance/v1-lite-image-to-video', 'ByteDance V1 Lite · Ảnh', { ...imageUrl, endReferenceField: 'end_image_url', defaults: { resolution: '720p', camera_fixed: false } }, [5, 10]),
  video('bytedance/v1-lite-text-to-video', 'ByteDance V1 Lite · Văn bản', { ...directRatio, defaults: { resolution: '720p', camera_fixed: false } }, [5, 10]),
  video('hailuo/2-3-image-to-video-pro', 'Hailuo 2.3 Pro · Ảnh', { ...imageUrl, defaults: { resolution: '768p' } }, [6, 10]),
  video('hailuo/2-3-image-to-video-standard', 'Hailuo 2.3 Standard · Ảnh', { ...imageUrl, defaults: { resolution: '768p' } }, [6, 10]),
  video('hailuo/02-text-to-video-pro', 'Hailuo 02 Pro · Văn bản', { durationField: undefined, defaults: { prompt_optimizer: true } }, [6]),
  video('hailuo/02-image-to-video-pro', 'Hailuo 02 Pro · Ảnh', { ...imageUrl, endReferenceField: 'end_image_url', durationField: undefined, defaults: { prompt_optimizer: true } }, [6]),
  video('hailuo/02-text-to-video-standard', 'Hailuo 02 Standard · Văn bản', { defaults: { prompt_optimizer: true } }, [6, 10]),
  video('hailuo/02-image-to-video-standard', 'Hailuo 02 Standard · Ảnh', { ...imageUrl, endReferenceField: 'end_image_url', defaults: { resolution: '768p', prompt_optimizer: true } }, [6, 10]),
  video('wan/2-2-a14b-text-to-video-turbo', 'Wan 2.2 Turbo · Văn bản', { ...directRatio, durationField: undefined, defaults: { resolution: '720p', enable_prompt_expansion: true, acceleration: 'regular' } }, [5]),
  video('wan/2-2-a14b-image-to-video-turbo', 'Wan 2.2 Turbo · Ảnh', { ...imageUrl, durationField: undefined, defaults: { resolution: '720p', enable_prompt_expansion: true, acceleration: 'regular' } }, [5]),
  video('wan/2-5-text-to-video', 'Wan 2.5 · Văn bản', { ...directRatio, defaults: { resolution: '720p', enable_prompt_expansion: true } }, [5, 10]),
  video('wan/2-5-image-to-video', 'Wan 2.5 · Ảnh', { ...imageUrl, defaults: { resolution: '720p', enable_prompt_expansion: true } }, [5, 10]),
  video('wan/2-6-text-to-video', 'Wan 2.6 · Văn bản', { defaults: { resolution: '720p' } }, [5, 10]),
  video('wan/2-6-image-to-video', 'Wan 2.6 · Ảnh', { ...imageUrls, defaults: { resolution: '720p' } }, [5, 10]),
  video('wan/2-6-flash-image-to-video', 'Wan 2.6 Flash · Ảnh', { ...imageUrls, defaults: { resolution: '720p', audio: false, multi_shots: false } }, [5, 10]),
  video('wan/2-7-text-to-video', 'Wan 2.7 · Văn bản', { aspectRatioField: 'ratio', defaults: { resolution: '720p', prompt_extend: true, watermark: false } }, [5, 10, 15]),
  video('wan/2-7-image-to-video', 'Wan 2.7 · Ảnh', { referenceField: 'first_frame_url', referenceMode: 'single', requiresReference: true, endReferenceField: 'last_frame_url', defaults: { resolution: '720p', prompt_extend: true, watermark: false } }, [5, 10, 15]),
  video('wan/2-7-r2v', 'Wan 2.7 · Tham chiếu', { ...directRatio, referenceField: 'reference_image', referenceMode: 'single', requiresReference: true, defaults: { resolution: '720p', prompt_extend: true, watermark: false } }, [5, 10, 15]),
  video('happyhorse/text-to-video', 'HappyHorse · Văn bản', { ...directRatio, defaults: { resolution: '720p' } }, [5, 10]),
  video('happyhorse/image-to-video', 'HappyHorse · Ảnh', { ...imageUrl, defaults: { resolution: '720p' } }, [5, 10]),
  video('happyhorse/reference-to-video', 'HappyHorse · Tham chiếu', { ...directRatio, referenceField: 'reference_image', referenceMode: 'single', requiresReference: true, defaults: { resolution: '720p' } }, [5, 10]),
  video('happyhorse-1-1/text-to-video', 'HappyHorse 1.1 · Văn bản', { ...directRatio, defaults: { resolution: '720p' } }, [5, 10]),
  video('happyhorse-1-1/image-to-video', 'HappyHorse 1.1 · Ảnh', { ...imageUrls, defaults: { resolution: '720p' } }, [5, 10]),
  video('happyhorse-1-1/reference-to-video', 'HappyHorse 1.1 · Tham chiếu', { ...directRatio, referenceField: 'reference_image', referenceMode: 'single', requiresReference: true, defaults: { resolution: '720p' } }, [5, 10]),
  video('gemini-omni-video', 'Gemini Omni Video', { referenceField: 'image_urls', referenceMode: 'array', maxReferences: 10, durationField: undefined }, [8]),
  video('veo3_fast', 'Veo 3.1 Fast', { taskApi: 'veo', referenceField: 'imageUrls', referenceMode: 'array', maxReferences: 2, durationField: undefined, defaults: { enableFallback: false, enableTranslation: true } }, [8], 'Veo qua KIE · tắt fallback tự động để kiểm soát credit'),
  video('veo3', 'Veo 3.1 Quality', { taskApi: 'veo', referenceField: 'imageUrls', referenceMode: 'array', maxReferences: 2, durationField: undefined, defaults: { enableFallback: false, enableTranslation: true } }, [8], 'Veo chất lượng cao qua KIE · tắt fallback tự động'),
];

