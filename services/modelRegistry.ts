// Author: forsearch | Updated: 2026-04-30
import {
  ModelType,
  ModelDefinition,
  ModelProvider,
  ModelRegistryState,
  ActiveModels,
  ChatModelDefinition,
  ImageModelDefinition,
  VideoModelDefinition,
  BUILTIN_PROVIDERS,
  ALL_BUILTIN_MODELS,
  DEFAULT_ACTIVE_MODELS,
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_IMAGE_MODEL_ID,
  DEPRECATED_BUILTIN_CHAT_MODEL_IDS,
  DEPRECATED_BUILTIN_IMAGE_MODEL_IDS,
  DEPRECATED_BUILTIN_VIDEO_MODEL_IDS,
  migrateDeprecatedVideoModelId,
  AspectRatio,
  VideoDuration,
} from '../types/model';

const STORAGE_KEY = 'ai_manga_studio_model_registry';
const LEGACY_STORAGE_KEY = ['big' + 'banana', 'model', 'registry'].join('_');
const API_KEY_STORAGE_KEY = 'antsk_api_key';

const normalizeBaseUrl = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();

let registryState: ModelRegistryState | null = null;

const getDefaultState = (): ModelRegistryState => ({
  providers: [...BUILTIN_PROVIDERS],
  models: [...ALL_BUILTIN_MODELS],
  activeModels: { ...DEFAULT_ACTIVE_MODELS },
  globalApiKey: localStorage.getItem(API_KEY_STORAGE_KEY) || undefined,
});

export const loadRegistry = (): ModelRegistryState => {
  if (registryState) {
    return registryState;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as ModelRegistryState;
      // Hợp nhất nhà cung cấp tích hợp và ghi đè baseUrl/tên để loại bỏ dữ liệu cũ trong localStorage.
      BUILTIN_PROVIDERS.forEach(bp => {
        const idx = parsed.providers.findIndex(p => p.id === bp.id);
        if (idx === -1) {
          parsed.providers.unshift(bp);
        } else {
          parsed.providers[idx] = { ...parsed.providers[idx], baseUrl: bp.baseUrl, name: bp.name };
        }
      });

      // Loại nhà cung cấp trùng baseUrl, ưu tiên mục xuất hiện trước (thường là mục tích hợp).
      const seenBaseUrls = new Set<string>();
      parsed.providers = parsed.providers.filter(p => {
        const key = normalizeBaseUrl(p.baseUrl);
        if (seenBaseUrls.has(key)) return false;
        seenBaseUrls.add(key);
        return true;
      });
      
      // Hợp nhất mô hình tích hợp và đồng bộ tham số với mã nguồn.
      ALL_BUILTIN_MODELS.forEach(bm => {
        const existingIndex = parsed.models.findIndex(m => m.id === bm.id);
        if (existingIndex === -1) {
          // Thêm mô hình tích hợp còn thiếu.
          parsed.models.push(bm);
        } else {
          // Cập nhật tham số mô hình tích hợp nhưng giữ lựa chọn isEnabled của người dùng.
          const existing = parsed.models[existingIndex];
          parsed.models[existingIndex] = {
            ...bm,
            isEnabled: existing.isEnabled,
          };
        }
      });

      // Di chuyển apiModel còn thiếu, ưu tiên suy ra từ id hoặc tiền tố providerId.
      parsed.models = parsed.models.map(m => {
        if (m.apiModel) return m;
        if (m.providerId && m.id.startsWith(`${m.providerId}:`)) {
          return { ...m, apiModel: m.id.slice(m.providerId.length + 1) };
        }
        return { ...m, apiModel: m.id };
      });

      parsed.models = parsed.models.filter(
        (m) =>
          !(
            m.type === 'video' &&
            m.isBuiltIn &&
            ((DEPRECATED_BUILTIN_VIDEO_MODEL_IDS as readonly string[]).includes(m.id) ||
              m.id.startsWith('veo_3_1'))
          )
      );
      parsed.activeModels.video = migrateDeprecatedVideoModelId(parsed.activeModels.video);

      parsed.models = parsed.models.filter(
        (m) =>
          !(
            m.type === 'chat' &&
            m.isBuiltIn &&
            (DEPRECATED_BUILTIN_CHAT_MODEL_IDS as readonly string[]).includes(m.id)
          )
      );
      if (
        (DEPRECATED_BUILTIN_CHAT_MODEL_IDS as readonly string[]).includes(
          parsed.activeModels.chat
        )
      ) {
        parsed.activeModels.chat = DEFAULT_CHAT_MODEL_ID;
      }

      parsed.models = parsed.models.filter(
        (m) =>
          !(
            m.type === 'image' &&
            m.isBuiltIn &&
            (DEPRECATED_BUILTIN_IMAGE_MODEL_IDS as readonly string[]).includes(m.id)
          )
      );
      if (
        (DEPRECATED_BUILTIN_IMAGE_MODEL_IDS as readonly string[]).includes(
          parsed.activeModels.image
        )
      ) {
        parsed.activeModels.image = DEFAULT_IMAGE_MODEL_ID;
      }

      if (parsed.activeModels.video === 'sora-2' || parsed.activeModels.video === 'doubao-seedance-2-0') {
        parsed.activeModels.video = DEFAULT_VIDEO_MODEL_ID;
      }

      parsed.models = parsed.models.filter(
        (m) => !(m.isBuiltIn && m.id === 'doubao-seedance-2-0')
      );
      
      // Đồng bộ API Key toàn cục.
      parsed.globalApiKey = localStorage.getItem(API_KEY_STORAGE_KEY) || parsed.globalApiKey;
      
      registryState = parsed;
      saveRegistry(parsed);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return parsed;
    }
  } catch (e) {
    console.error('Tải sổ đăng ký mô hình thất bại:', e);
  }

  registryState = getDefaultState();
  return registryState;
};

/**
 * Lưu trạng thái vào localStorage.
 */
export const saveRegistry = (state: ModelRegistryState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    registryState = state;
  } catch (e) {
    console.error('Lưu sổ đăng ký mô hình thất bại:', e);
  }
};

/**
 * Lấy trạng thái hiện tại.
 */
export const getRegistryState = (): ModelRegistryState => {
  return loadRegistry();
};

/**
 * Đặt lại về trạng thái mặc định.
 */
export const resetRegistry = (): void => {
  registryState = null;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  loadRegistry();
};

// ============================================
// Quản lý nhà cung cấp
// ============================================

/**
 * Lấy tất cả nhà cung cấp.
 */
export const getProviders = (): ModelProvider[] => {
  return loadRegistry().providers;
};

/**
 * Lấy nhà cung cấp theo ID.
 */
export const getProviderById = (id: string): ModelProvider | undefined => {
  return getProviders().find(p => p.id === id);
};

/**
 * Lấy nhà cung cấp mặc định.
 */
export const getDefaultProvider = (): ModelProvider => {
  return getProviders().find(p => p.isDefault) || BUILTIN_PROVIDERS[0];
};

/**
 * Thêm nhà cung cấp.
 */
export const addProvider = (provider: Omit<ModelProvider, 'id' | 'isBuiltIn'>): ModelProvider => {
  const state = loadRegistry();
  const normalized = normalizeBaseUrl(provider.baseUrl);
  const existing = state.providers.find(p => normalizeBaseUrl(p.baseUrl) === normalized);
  if (existing) return existing;
  const newProvider: ModelProvider = {
    ...provider,
    id: `provider_${Date.now()}`,
    isBuiltIn: false,
  };
  state.providers.push(newProvider);
  saveRegistry(state);
  return newProvider;
};

/**
 * Cập nhật nhà cung cấp.
 */
export const updateProvider = (id: string, updates: Partial<ModelProvider>): boolean => {
  const state = loadRegistry();
  const index = state.providers.findIndex(p => p.id === id);
  if (index === -1) return false;

  if (state.providers[index].isBuiltIn) {
    delete updates.id;
    delete updates.isBuiltIn;
    delete updates.baseUrl;
  }

  state.providers[index] = { ...state.providers[index], ...updates };
  saveRegistry(state);
  return true;
};

/**
 * Xóa nhà cung cấp.
 */
export const removeProvider = (id: string): boolean => {
  const state = loadRegistry();
  const provider = state.providers.find(p => p.id === id);
  
  if (!provider || provider.isBuiltIn) return false;
  
  state.models = state.models.filter(m => m.providerId !== id);
  state.providers = state.providers.filter(p => p.id !== id);
  
  saveRegistry(state);
  return true;
};

// ============================================
// Quản lý mô hình
// ============================================

/**
 * Lấy tất cả mô hình.
 */
export const getModels = (type?: ModelType): ModelDefinition[] => {
  const models = loadRegistry().models;
  if (type) {
    return models.filter(m => m.type === type);
  }
  return models;
};

/**
 * Lấy danh sách mô hình hội thoại.
 */
export const getChatModels = (): ChatModelDefinition[] => {
  return getModels('chat') as ChatModelDefinition[];
};

/**
 * Lấy danh sách mô hình ảnh.
 */
export const getImageModels = (): ImageModelDefinition[] => {
  return getModels('image') as ImageModelDefinition[];
};

/**
 * Lấy danh sách mô hình video.
 */
export const getVideoModels = (): VideoModelDefinition[] => {
  return getModels('video') as VideoModelDefinition[];
};

/**
 * Lấy mô hình theo ID.
 */
export const getModelById = (id: string): ModelDefinition | undefined => {
  return getModels().find(m => m.id === id);
};

/**
 * Lấy mô hình đang hoạt động.
 */
export const getActiveModel = (type: ModelType): ModelDefinition | undefined => {
  const state = loadRegistry();
  const activeId = state.activeModels[type];
  return getModelById(activeId);
};

/**
 * Lấy mô hình hội thoại đang hoạt động.
 */
export const getActiveChatModel = (): ChatModelDefinition | undefined => {
  return getActiveModel('chat') as ChatModelDefinition | undefined;
};

/**
 * Lấy mô hình ảnh đang hoạt động.
 */
export const getActiveImageModel = (): ImageModelDefinition | undefined => {
  return getActiveModel('image') as ImageModelDefinition | undefined;
};

/**
 * Lấy mô hình video đang hoạt động.
 */
export const getActiveVideoModel = (): VideoModelDefinition | undefined => {
  return getActiveModel('video') as VideoModelDefinition | undefined;
};

/**
 * Đặt mô hình đang hoạt động.
 */
export const setActiveModel = (type: ModelType, modelId: string): boolean => {
  const model = getModelById(modelId);
  if (!model || model.type !== type || !model.isEnabled) return false;

  const state = loadRegistry();
  state.activeModels[type] = modelId;
  saveRegistry(state);
  return true;
};

/**
 * Đăng ký mô hình mới.
 * @param model - Định nghĩa mô hình (có thể có id tùy chỉnh, không gồm isBuiltIn).
 */
export const registerModel = (model: Omit<ModelDefinition, 'isBuiltIn'> & { id?: string }): ModelDefinition => {
  const state = loadRegistry();
  
  const providedId = (model as any).id?.trim();
  const apiModel = (model as any).apiModel?.trim();
  const baseId = providedId || (apiModel ? `${model.providerId}:${apiModel}` : `model_${Date.now()}`);
  let modelId = baseId;

  // Tự tạo ID duy nhất khi không được cung cấp; tên mô hình API có thể trùng nhau.
  if (!providedId) {
    let suffix = 1;
    while (state.models.some(m => m.id === modelId)) {
      modelId = `${baseId}_${suffix++}`;
    }
  } else if (state.models.some(m => m.id === modelId)) {
    throw new Error(`ID mô hình "${modelId}" đã tồn tại. Hãy dùng ID khác`);
  }
  
  const newModel = {
    ...model,
    id: modelId,
    apiModel: apiModel || (model.providerId && modelId.startsWith(`${model.providerId}:`)
      ? modelId.slice(model.providerId.length + 1)
      : modelId),
    isBuiltIn: false,
  } as ModelDefinition;
  
  state.models.push(newModel);
  saveRegistry(state);
  return newModel;
};

/**
 * Cập nhật mô hình.
 */
export const updateModel = (id: string, updates: Partial<ModelDefinition>): boolean => {
  const state = loadRegistry();
  const index = state.models.findIndex(m => m.id === id);
  if (index === -1) return false;

  // Mô hình tích hợp chỉ cho phép đổi isEnabled và params.
  if (state.models[index].isBuiltIn) {
    const allowedUpdates: Partial<ModelDefinition> = {};
    if (updates.isEnabled !== undefined) allowedUpdates.isEnabled = updates.isEnabled;
    if (updates.params) allowedUpdates.params = updates.params as any;
    state.models[index] = { ...state.models[index], ...allowedUpdates } as ModelDefinition;
  } else {
    state.models[index] = { ...state.models[index], ...updates } as ModelDefinition;
  }

  saveRegistry(state);
  return true;
};

/**
 * Xóa mô hình.
 */
export const removeModel = (id: string): boolean => {
  const state = loadRegistry();
  const model = state.models.find(m => m.id === id);
  
  // Không thể xóa mô hình tích hợp.
  if (!model || model.isBuiltIn) return false;
  
  // Nếu xóa mô hình đang hoạt động, chuyển sang mô hình cùng loại khả dụng đầu tiên.
  if (state.activeModels[model.type] === id) {
    const fallback = state.models.find(m => m.type === model.type && m.id !== id && m.isEnabled);
    if (fallback) {
      state.activeModels[model.type] = fallback.id;
    }
  }
  
  state.models = state.models.filter(m => m.id !== id);
  saveRegistry(state);
  return true;
};

/**
 * Bật hoặc tắt mô hình.
 */
export const toggleModelEnabled = (id: string, enabled: boolean): boolean => {
  return updateModel(id, { isEnabled: enabled });
};

// ============================================
// Quản lý API Key
// ============================================

/**
 * Lấy API Key toàn cục.
 */
export const getGlobalApiKey = (): string | undefined => {
  return loadRegistry().globalApiKey || localStorage.getItem(API_KEY_STORAGE_KEY) || undefined;
};

/**
 * Đặt API Key toàn cục.
 */
export const setGlobalApiKey = (apiKey: string): void => {
  const state = loadRegistry();
  state.globalApiKey = apiKey;
  localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  saveRegistry(state);
};

/**
 * Lấy API Key cho mô hình.
 * Ưu tiên: khóa riêng của mô hình > khóa nhà cung cấp > khóa toàn cục.
 */
export const getApiKeyForModel = (modelId: string): string | undefined => {
  const model = getModelById(modelId);
  if (!model) return getGlobalApiKey();
  
  // 1. Ưu tiên API Key riêng của mô hình.
  if (model.apiKey) {
    return model.apiKey;
  }
  
  // 2. Tiếp theo dùng API Key của nhà cung cấp.
  const provider = getProviderById(model.providerId);
  if (provider?.apiKey) {
    return provider.apiKey;
  }
  
  // 3. Cuối cùng dùng API Key toàn cục.
  return getGlobalApiKey();
};

/** Dùng đường dẫn tương đối qua proxy Vite khi chạy cục bộ để tránh CORS. */
const API_PROXY_PATH = '/api-proxy';

/** Kiểm tra môi trường localhost/127.0.0.1 để quyết định định tuyến qua proxy. */
function isLocalOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const o = window.location.origin;
  return o.startsWith('http://localhost') || o.startsWith('http://127.0.0.1') || o.startsWith('https://localhost') || o.startsWith('https://127.0.0.1');
}

function isGitccApiBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'api.gitcc.com';
  } catch {
    return false;
  }
}

/**
 * Lấy URL API cơ sở cho mô hình.
 * Nhà cung cấp dùng GitCC (api.gitcc.com); định tuyến qua /api-proxy để tránh CORS.
 * - Khi phát triển cục bộ: proxy Vite chuyển tiếp đến GitCC.
 * - Khi triển khai: Nginx chuyển tiếp đến GitCC.
 */
export const getApiBaseUrlForModel = (modelId: string): string => {
  const model = getModelById(modelId);
  const provider = model ? getProviderById(model.providerId) : BUILTIN_PROVIDERS[0];
  let baseUrl = (provider?.baseUrl || BUILTIN_PROVIDERS[0].baseUrl).replace(/\/+$/, '');

  // Luôn đi qua /api-proxy để trình duyệt không truy cập chéo miền trực tiếp.
  if (isGitccApiBaseUrl(baseUrl)) {
    return API_PROXY_PATH;
  }

  return baseUrl;
};

// ============================================
// Hàm tiện ích
// ============================================

/**
 * Lấy cấu hình đầy đủ của mô hình đang hoạt động.
 */
export const getActiveModelsConfig = (): ActiveModels => {
  return loadRegistry().activeModels;
};

/**
 * Kiểm tra mô hình khả dụng (đã bật và có API Key).
 */
export const isModelAvailable = (modelId: string): boolean => {
  const model = getModelById(modelId);
  if (!model || !model.isEnabled) return false;
  
  const apiKey = getApiKeyForModel(modelId);
  return !!apiKey;
};

// ============================================
// Tiện ích giá trị mặc định để tương thích ngược
// ============================================

/**
 * Lấy tỷ lệ khung hình mặc định.
 */
export const getDefaultAspectRatio = (): AspectRatio => {
  const imageModel = getActiveImageModel();
  if (imageModel) {
    return imageModel.params.defaultAspectRatio;
  }
  return '16:9';
};

/**
 * Lấy thời lượng video mặc định.
 */
export const getDefaultVideoDuration = (): VideoDuration => {
  const videoModel = getActiveVideoModel();
  if (videoModel) {
    return videoModel.params.defaultDuration;
  }
  return 8;
};

/**
 * Lấy loại mô hình video.
 */
export const getVideoModelType = (): 'sora' | 'veo' => {
  const videoModel = getActiveVideoModel();
  if (videoModel) {
    return videoModel.params.mode === 'async' ? 'sora' : 'veo';
  }
  return 'sora';
};
