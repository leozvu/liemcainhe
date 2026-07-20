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
  DEFAULT_VIDEO_MODEL_ID,
  DEPRECATED_BUILTIN_CHAT_MODEL_IDS,
  DEPRECATED_BUILTIN_IMAGE_MODEL_IDS,
  DEPRECATED_BUILTIN_VIDEO_MODEL_IDS,
  migrateDeprecatedVideoModelId,
  AspectRatio,
  VideoDuration,
  DEFAULT_PROVIDER_ID,
  OPENROUTER_PROVIDER_ID,
  GOOGLE_PROVIDER_ID,
  REPLICATE_PROVIDER_ID,
  KIE_PROVIDER_ID,
} from '../types/model';
import {
  clearModelCredentials,
  getModelSecret,
  getProviderSecret,
  setModelSecret,
  setProviderSecret,
} from './credentialVault';

const STORAGE_KEY = 'egoric_studio_model_registry';
const LEGACY_STORAGE_KEYS = [atob('YWlfbWFuZ2Ffc3R1ZGlvX21vZGVsX3JlZ2lzdHJ5')];
const API_KEY_STORAGE_KEY = 'egoric_studio_api_key';
const LEGACY_API_KEY_STORAGE_KEYS = [atob('YW50c2tfYXBpX2tleQ==')];
const LEGACY_PROVIDER_ID = atob('YW50c2s=');
const LEGACY_API_HOST = atob('YXBpLmdpdGNjLmNvbQ==');

const normalizeBaseUrl = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();

let registryState: ModelRegistryState | null = null;

const readFirstStoredValue = (keys: string[]): string | null => {
  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value) return value;
  }
  return null;
};

const clearStoredValues = (keys: string[]): void => {
  keys.forEach((key) => localStorage.removeItem(key));
};

const isLegacyProvider = (provider: Partial<ModelProvider>): boolean => {
  if (provider.id === LEGACY_PROVIDER_ID || provider.id === 'egoric-gateway') return true;
  try {
    return new URL(provider.baseUrl || '').hostname === LEGACY_API_HOST;
  } catch {
    return false;
  }
};

const cloneBuiltInProviders = (): ModelProvider[] =>
  BUILTIN_PROVIDERS.map((provider) => ({ ...provider, apiKey: getProviderSecret(provider.id) }));

const cloneBuiltInModels = (): ModelDefinition[] =>
  ALL_BUILTIN_MODELS.map((model) => ({ ...model, apiKey: getModelSecret(model.id), params: { ...model.params } } as ModelDefinition));

const getDefaultState = (): ModelRegistryState => ({
  providers: cloneBuiltInProviders(),
  models: cloneBuiltInModels(),
  activeModels: { ...DEFAULT_ACTIVE_MODELS },
});

export const loadRegistry = (): ModelRegistryState => {
  if (registryState) {
    return registryState;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY) || readFirstStoredValue(LEGACY_STORAGE_KEYS);
    if (stored) {
      const parsed = JSON.parse(stored) as ModelRegistryState;
      const legacyProviderIds = new Set(
        (parsed.providers || []).filter(isLegacyProvider).map((provider) => provider.id)
      );
      legacyProviderIds.add(LEGACY_PROVIDER_ID);
      legacyProviderIds.add('egoric-gateway');

      parsed.providers = (parsed.providers || [])
        .filter((provider) => !isLegacyProvider(provider))
        .map((provider) => {
          if (provider.apiKey) setProviderSecret(provider.id, provider.apiKey);
          return {
            ...provider,
            apiKey: provider.apiKey || getProviderSecret(provider.id),
            protocol: provider.protocol || 'openai-compatible',
            supportedModelTypes:
              provider.supportedModelTypes ||
              (['chat', 'image', 'video'] as ModelType[]),
          };
        });
      parsed.models = (parsed.models || []).filter(
        (model) => !legacyProviderIds.has(model.providerId)
      );
      parsed.activeModels = parsed.activeModels || { ...DEFAULT_ACTIVE_MODELS };
      // Đồng bộ toàn bộ metadata nhà cung cấp tích hợp nhưng giữ khóa người dùng đã nhập.
      BUILTIN_PROVIDERS.forEach(bp => {
        const idx = parsed.providers.findIndex(p => p.id === bp.id);
        if (idx === -1) {
          parsed.providers.unshift({ ...bp });
        } else {
          const apiKey = parsed.providers[idx].apiKey || getProviderSecret(bp.id);
          parsed.providers[idx] = { ...bp, apiKey };
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
          parsed.models.push({ ...bm, params: { ...bm.params } } as ModelDefinition);
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
        if (m.apiKey) setModelSecret(m.id, m.apiKey);
        const apiKey = m.apiKey || getModelSecret(m.id);
        if (m.apiModel) return { ...m, apiKey };
        if (m.providerId && m.id.startsWith(`${m.providerId}:`)) {
          return { ...m, apiKey, apiModel: m.id.slice(m.providerId.length + 1) };
        }
        return { ...m, apiKey, apiModel: m.id };
      });

      // KIE đang là tuyến media chính; vô hiệu hóa catalog Replicate cũ để tránh chọn nhầm và phát sinh phí.
      parsed.models = parsed.models.map((model) =>
        model.isBuiltIn && model.providerId === REPLICATE_PROVIDER_ID
          ? { ...model, isEnabled: false }
          : model
      );
      if (parsed.activeModels.image?.startsWith('replicate-')) {
        parsed.activeModels.image = DEFAULT_IMAGE_MODEL_ID;
      }
      if (parsed.activeModels.video?.startsWith('replicate-')) {
        parsed.activeModels.video = DEFAULT_VIDEO_MODEL_ID;
      }

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

      const activeFallbacks: ActiveModels = { ...DEFAULT_ACTIVE_MODELS };
      (['chat', 'image', 'video'] as ModelType[]).forEach((type) => {
        const activeId = parsed.activeModels[type];
        const activeModel = parsed.models.find(
          (model) => model.id === activeId && model.type === type && model.isEnabled
        );
        if (!activeModel) parsed.activeModels[type] = activeFallbacks[type];
      });

      // Không chuyển khóa của cổng cũ sang nhà cung cấp mới vì khóa không tương thích.
      delete parsed.globalApiKey;
      localStorage.removeItem(API_KEY_STORAGE_KEY);
      
      registryState = parsed;
      saveRegistry(parsed);
      clearStoredValues(LEGACY_STORAGE_KEYS);
      clearStoredValues(LEGACY_API_KEY_STORAGE_KEYS);
      return parsed;
    }
  } catch (e) {
    console.error('Tải sổ đăng ký mô hình thất bại:', e);
  }

  registryState = getDefaultState();
  localStorage.removeItem(API_KEY_STORAGE_KEY);
  clearStoredValues(LEGACY_API_KEY_STORAGE_KEYS);
  return registryState;
};

/**
 * Lưu trạng thái vào localStorage.
 */
export const saveRegistry = (state: ModelRegistryState): void => {
  try {
    state.providers.forEach((provider) => setProviderSecret(provider.id, provider.apiKey));
    state.models.forEach((model) => setModelSecret(model.id, model.apiKey));
    const persistedState: ModelRegistryState = {
      ...state,
      providers: state.providers.map(({ apiKey: _apiKey, ...provider }) => provider),
      models: state.models.map(({ apiKey: _apiKey, ...model }) => model as ModelDefinition),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState));
    clearStoredValues(LEGACY_STORAGE_KEYS);
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
  clearStoredValues(LEGACY_STORAGE_KEYS);
  localStorage.removeItem(API_KEY_STORAGE_KEY);
  clearStoredValues(LEGACY_API_KEY_STORAGE_KEYS);
  clearModelCredentials();
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
  setProviderSecret(id, undefined);
  
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
export const registerModel = (model: Omit<ModelDefinition, 'id' | 'isBuiltIn'> & { id?: string }): ModelDefinition => {
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
  setModelSecret(id, undefined);
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
 * Tương thích ngược: khóa "toàn cục" nay là khóa OpenRouter.
 * Mã mới nên dùng getProviderApiKey/setProviderApiKey.
 */
export const getGlobalApiKey = (): string | undefined => {
  return getProviderApiKey(OPENROUTER_PROVIDER_ID);
};

/** Tương thích ngược với màn hình cũ; không phát tán khóa sang nhà cung cấp khác. */
export const setGlobalApiKey = (apiKey: string): void => {
  setProviderApiKey(OPENROUTER_PROVIDER_ID, apiKey);
};

/** Lấy khóa đã lưu cho đúng nhà cung cấp. */
export const getProviderApiKey = (providerId: string): string | undefined =>
  getProviderById(providerId)?.apiKey || getProviderSecret(providerId);

/** Lưu hoặc xóa khóa cho một nhà cung cấp. */
export const setProviderApiKey = (providerId: string, apiKey: string): boolean => {
  const normalizedKey = apiKey.trim();
  return updateProvider(providerId, { apiKey: normalizedKey || undefined });
};

/**
 * Lấy API Key cho mô hình.
 * Ưu tiên: khóa riêng của mô hình > khóa đúng nhà cung cấp.
 */
export const getApiKeyForModel = (modelId: string): string | undefined => {
  const model = getModelById(modelId);
  if (!model) return undefined;
  
  // 1. Ưu tiên API Key riêng của mô hình.
  if (model.apiKey || getModelSecret(model.id)) {
    return model.apiKey || getModelSecret(model.id);
  }
  
  // 2. Tiếp theo dùng API Key của nhà cung cấp.
  const provider = getProviderById(model.providerId);
  if (provider?.apiKey || getProviderSecret(model.providerId)) {
    return provider?.apiKey || getProviderSecret(model.providerId);
  }
  
  return undefined;
};

const BUILTIN_PROVIDER_PROXY_BASES: Record<string, string> = {
  [OPENROUTER_PROVIDER_ID]: '/api-proxy/openrouter/api',
  [GOOGLE_PROVIDER_ID]: '/api-proxy/google/v1beta/openai',
  [REPLICATE_PROVIDER_ID]: '/api-proxy/replicate',
  [KIE_PROVIDER_ID]: '/api-proxy/kie',
};

/**
 * Lấy địa chỉ API của nhà cung cấp. Ba nhà cung cấp tích hợp luôn đi qua proxy
 * cùng miền để khóa không bị lộ cho một đích tùy ý và để tránh lỗi CORS.
 */
export const getApiBaseUrlForProvider = (providerId: string): string => {
  const proxyBase = BUILTIN_PROVIDER_PROXY_BASES[providerId];
  if (proxyBase) return proxyBase;
  const provider = getProviderById(providerId) || getDefaultProvider();
  return provider.baseUrl.replace(/\/+$/, '');
};

/**
 * Lấy URL API cơ sở cho mô hình theo đúng nhà cung cấp của nó.
 */
export const getApiBaseUrlForModel = (modelId: string): string => {
  const model = getModelById(modelId);
  const provider = model ? getProviderById(model.providerId) : BUILTIN_PROVIDERS[0];
  return getApiBaseUrlForProvider(provider?.id || DEFAULT_PROVIDER_ID);
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
