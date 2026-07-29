interface ProviderModelAvailability {
  providerId: string;
  apiModelIds: string[];
  checkedAt: number;
}

const STORAGE_PREFIX = 'egoric_provider_models_v1:';
export const PROVIDER_MODEL_AVAILABILITY_TTL_MS = 30 * 60 * 1000;
const memory = new Map<string, ProviderModelAvailability>();

const storage = (): Storage | undefined => {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
};

export const saveProviderModelAvailability = (
  providerId: string,
  apiModelIds: string[],
  checkedAt: number = Date.now(),
): ProviderModelAvailability => {
  const record: ProviderModelAvailability = {
    providerId,
    apiModelIds: Array.from(new Set(apiModelIds.map((id) => String(id || '').trim()).filter(Boolean))),
    checkedAt,
  };
  memory.set(providerId, record);
  try {
    storage()?.setItem(`${STORAGE_PREFIX}${providerId}`, JSON.stringify(record));
  } catch {
    // Cache quyền model chỉ là tối ưu; không được làm hỏng luồng cấu hình key.
  }
  return record;
};

export const getProviderModelAvailability = (
  providerId: string,
  now: number = Date.now(),
): ProviderModelAvailability | undefined => {
  let record = memory.get(providerId);
  if (!record) {
    try {
      const raw = storage()?.getItem(`${STORAGE_PREFIX}${providerId}`);
      if (raw) record = JSON.parse(raw) as ProviderModelAvailability;
    } catch {
      record = undefined;
    }
  }
  if (!record || !Array.isArray(record.apiModelIds)) return undefined;
  if (now - Number(record.checkedAt || 0) > PROVIDER_MODEL_AVAILABILITY_TTL_MS) return undefined;
  memory.set(providerId, record);
  return record;
};

export const clearProviderModelAvailability = (providerId: string): void => {
  memory.delete(providerId);
  try {
    storage()?.removeItem(`${STORAGE_PREFIX}${providerId}`);
  } catch {
    // Không có sessionStorage (SSR/private mode) thì chỉ xóa cache bộ nhớ.
  }
};

/** `undefined` nghĩa là chưa kiểm tra, không phải bị cấm. */
export const isProviderModelAllowed = (
  providerId: string,
  apiModelId: string,
): boolean | undefined => {
  const availability = getProviderModelAvailability(providerId);
  if (!availability) return undefined;
  return availability.apiModelIds.includes(apiModelId);
};
