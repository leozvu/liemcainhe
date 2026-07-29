import { ModelDefinition, ModelType } from '../types/model';
import { getApiKeyForModel, getModels } from './modelRegistry';
import { ProviderHealth, getProviderHealth, shouldSkipProvider } from './providerHealthService';
import { assertUsageAllowed, recordUsage } from './usageService';
import { classifyApiError } from './apiErrorLocalization';
import { isProviderModelAllowed } from './providerCapabilities';

export interface ModelRoutingPolicy {
  enabled: boolean;
  maxAttempts: number;
  fallbackModelIds: Record<ModelType, string[]>;
}

const STORAGE_KEY = 'egoric_model_routing_policy_v1';

const DEFAULT_POLICY: ModelRoutingPolicy = {
  enabled: true,
  maxAttempts: 2,
  fallbackModelIds: {
    chat: ['shopaikey-grok-fast', 'shopaikey-gpt-5-mini', 'shopaikey-qwen3.5-plus', 'shopaikey-gpt-4.1'],
    image: [],
    video: [],
  },
};

export const getModelRoutingPolicy = (): ModelRoutingPolicy => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      ...DEFAULT_POLICY,
      ...stored,
      fallbackModelIds: { ...DEFAULT_POLICY.fallbackModelIds, ...(stored.fallbackModelIds || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_POLICY);
  }
};

export const saveModelRoutingPolicy = (policy: ModelRoutingPolicy): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(policy));
};

/**
 * Bỏ các model thuộc nhà cung cấp đang mất kết nối.
 *
 * Nếu lọc xong không còn gì thì trả lại nguyên danh sách: thà thử rồi nhận lỗi
 * thật của nhà cung cấp, còn hơn báo "không có model khả dụng" — thông báo đó
 * khiến người dùng đi tìm nhầm chỗ, tưởng mình cấu hình sai.
 *
 * Quy tắc không tự chuyển tuyến của KIE vẫn nguyên vẹn: khi preferred là KIE
 * thì danh sách chỉ có một phần tử, lọc xong rỗng nên được khôi phục.
 */
export const applyCircuitBreaker = (
  candidates: ModelDefinition[],
  health: ProviderHealth[],
): ModelDefinition[] => {
  const alive = candidates.filter((model) => !shouldSkipProvider(health, model.providerId));
  return alive.length ? alive : candidates;
};

export const getRoutingCandidates = (type: ModelType, preferred: ModelDefinition): ModelDefinition[] => {
  const policy = getModelRoutingPolicy();
  const models = getModels(type).filter((model) => model.isEnabled);
  // Một lần tạo media có thể bị tính phí ngay cả khi kết quả không dùng được.
  // Ảnh/video tuyệt đối không tự gọi model thứ hai nếu người dùng chưa chủ động chọn.
  // Chat chỉ chuyển model khi request trước hỏng ở tầng mạng/server, không có
  // output để sử dụng. Media vẫn tuyệt đối không tự gọi model thứ hai.
  const allowFallback = type === 'chat'
    && preferred.providerId !== 'kie-ai';
  const orderedIds = [preferred.id, ...(policy.enabled && allowFallback ? policy.fallbackModelIds[type] : [])];
  const seen = new Set<string>();
  const ordered = orderedIds
    .map((id) => models.find((model) => model.id === id))
    .filter((model): model is ModelDefinition => Boolean(model))
    .filter((model) => !seen.has(model.id) && Boolean(seen.add(model.id)))
    // `/v1/models` của ShopAIKey là catalog OpenAI/chat. Một số model media
    // xuất hiện trong đó nhưng Nano Banana lại không, dù endpoint ảnh riêng
    // vẫn chạy bình thường. Chỉ dùng catalog này làm preflight cho chat và
    // video; nếu áp cho ảnh, nút "Kiểm tra key" sẽ tự làm hỏng tạo ảnh.
    .filter((model) => type === 'image'
      || isProviderModelAllowed(model.providerId, model.apiModel || model.id) !== false);
  const configured = ordered.filter((model) => Boolean(getApiKeyForModel(model.id)));
  const usable = applyCircuitBreaker(configured.length ? configured : ordered, getProviderHealth());
  return usable.slice(0, Math.max(1, policy.maxAttempts));
};

export const canFallbackFromModelError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const status = Number((error as { status?: unknown } | null)?.status);
  const category = classifyApiError(message, Number.isFinite(status) ? status : undefined);
  return category === 'server'
    || category === 'network'
    || /\b50[0-9]\b|service unavailable|bad gateway|gateway timeout/i.test(message);
};

export const executeWithModelFallback = async <T>(input: {
  type: ModelType;
  preferred: ModelDefinition;
  operation: (model: ModelDefinition) => Promise<T>;
  inputSize?: number;
  durationSeconds?: number;
  resourceId?: string;
}): Promise<T> => {
  assertUsageAllowed();
  const candidates = getRoutingCandidates(input.type, input.preferred);
  if (!candidates.length) {
    throw new Error('Khóa API hiện tại không cấp quyền cho các mô hình đã cấu hình. Hãy kiểm tra nhóm model của khóa trong Mô hình và API.');
  }
  let lastError: unknown;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const startedAt = Date.now();
    try {
      const result = await input.operation(candidate);
      recordUsage({
        kind: input.type,
        providerId: candidate.providerId,
        modelId: candidate.id,
        resourceId: input.resourceId,
        inputSize: input.inputSize,
        durationSeconds: input.durationSeconds,
        durationMs: Date.now() - startedAt,
        status: 'success',
      });
      return result;
    } catch (error) {
      lastError = error;
      recordUsage({
        kind: input.type,
        providerId: candidate.providerId,
        modelId: candidate.id,
        resourceId: input.resourceId,
        durationMs: Date.now() - startedAt,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      if (index === candidates.length - 1 || !canFallbackFromModelError(error)) {
        if (error && typeof error === 'object') {
          Object.defineProperty(error, 'modelRoutingExhausted', {
            value: true,
            configurable: true,
          });
        }
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Không có tuyến mô hình khả dụng');
};
