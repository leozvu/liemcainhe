import { ModelDefinition, ModelType } from '../types/model';
import { getApiKeyForModel, getModels } from './modelRegistry';
import { assertUsageAllowed, recordUsage } from './usageService';

export interface ModelRoutingPolicy {
  enabled: boolean;
  maxAttempts: number;
  fallbackModelIds: Record<ModelType, string[]>;
}

const STORAGE_KEY = 'egoric_model_routing_policy_v1';

const DEFAULT_POLICY: ModelRoutingPolicy = {
  enabled: true,
  maxAttempts: 3,
  fallbackModelIds: {
    chat: ['openrouter-auto', 'openrouter-gpt-5.2', 'google-gemini-flash'],
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

export const getRoutingCandidates = (type: ModelType, preferred: ModelDefinition): ModelDefinition[] => {
  const policy = getModelRoutingPolicy();
  const models = getModels(type).filter((model) => model.isEnabled);
  // Một lần tạo media có thể bị tính phí ngay cả khi kết quả không dùng được.
  // Với KIE, tuyệt đối không tự gọi model thứ hai nếu người dùng chưa chủ động chọn.
  const allowFallback = preferred.providerId !== 'kie-ai';
  const orderedIds = [preferred.id, ...(policy.enabled && allowFallback ? policy.fallbackModelIds[type] : [])];
  const seen = new Set<string>();
  const ordered = orderedIds
    .map((id) => models.find((model) => model.id === id))
    .filter((model): model is ModelDefinition => Boolean(model))
    .filter((model) => !seen.has(model.id) && Boolean(seen.add(model.id)));
  const configured = ordered.filter((model) => Boolean(getApiKeyForModel(model.id)));
  return (configured.length ? configured : ordered).slice(0, Math.max(1, policy.maxAttempts));
};

export const canFallbackFromModelError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/an toàn nội dung|content policy|tham số không hợp lệ|lời thoại phải|400/.test(message)) return false;
  return /hạn mức|quota|balance|429|401|403|500|502|503|504|hết thời gian|timeout|mạng|network|failed to fetch|không thể kết nối|gián đoạn|service unavailable/.test(message);
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
      if (index === candidates.length - 1 || !canFallbackFromModelError(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Không có tuyến mô hình khả dụng');
};
