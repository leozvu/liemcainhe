import {
  GOOGLE_PROVIDER_ID,
  OPENROUTER_PROVIDER_ID,
  REPLICATE_PROVIDER_ID,
  KIE_PROVIDER_ID,
  SHOPAIKEY_PROVIDER_ID,
} from '../types/model';
import {
  getApiBaseUrlForProvider,
  getModels,
  getProviderById,
} from './modelRegistry';
import { ModelType } from '../types/model';
import { localizeApiErrorMessage } from './apiErrorLocalization';

export interface ProviderVerificationResult {
  success: boolean;
  message: string;
  remaining?: number;
  discoveredModels?: number;
}

export interface DiscoveredProviderModel {
  id: string;
  name: string;
  type: ModelType;
}

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json();
    return payload?.error?.message || payload?.detail || payload?.message || `Lỗi HTTP ${response.status}`;
  } catch {
    return `Lỗi HTTP ${response.status}`;
  }
};

/** Xác thực khóa bằng một điểm cuối miễn phí của đúng nhà cung cấp. */
export const verifyProviderApiKey = async (
  providerId: string,
  apiKey: string
): Promise<ProviderVerificationResult> => {
  const provider = getProviderById(providerId);
  if (!provider) return { success: false, message: 'Không tìm thấy nhà cung cấp' };
  if (!apiKey.trim()) return { success: false, message: 'Vui lòng nhập khóa API' };

  const baseUrl = getApiBaseUrlForProvider(providerId);
  let url = `${baseUrl}/v1/models`;
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey.trim()}` };

  if (providerId === OPENROUTER_PROVIDER_ID) {
    url = `${baseUrl}/v1/key`;
  } else if (providerId === GOOGLE_PROVIDER_ID) {
    url = `${baseUrl.replace(/\/openai$/, '')}/models?pageSize=1`;
    delete headers.Authorization;
    headers['x-goog-api-key'] = apiKey.trim();
  } else if (providerId === REPLICATE_PROVIDER_ID) {
    url = `${baseUrl}/v1/account`;
  } else if (providerId === KIE_PROVIDER_ID) {
    url = `${baseUrl}/api/v1/chat/credit`;
  } else if (providerId === SHOPAIKEY_PROVIDER_ID) {
    url = `${baseUrl}/v1/models`;
  }

  try {
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      const message = await readErrorMessage(response);
      return {
        success: false,
        message: localizeApiErrorMessage(message, response.status),
      };
    }

    const payload = await response.json().catch(() => ({}));
    if (providerId === OPENROUTER_PROVIDER_ID && payload?.data) {
      const remaining = payload.data.limit_remaining;
      return {
        success: true,
        message:
          typeof remaining === 'number'
            ? `Khóa hợp lệ · hạn mức còn lại ${remaining.toLocaleString('vi-VN')}`
            : 'Khóa OpenRouter hợp lệ',
        remaining: typeof remaining === 'number' ? remaining : undefined,
      };
    }
    if (providerId === REPLICATE_PROVIDER_ID && payload?.username) {
      return { success: true, message: `Đã kết nối tài khoản ${payload.username}` };
    }
    if (providerId === KIE_PROVIDER_ID && typeof payload?.data === 'number') {
      const catalogSize = getModels().filter((model) => model.providerId === KIE_PROVIDER_ID).length;
      return {
        success: true,
        message: `Khóa KIE hợp lệ · còn ${payload.data.toLocaleString('vi-VN')} credit · ${catalogSize} model đã nhập sẵn`,
        remaining: payload.data,
        discoveredModels: catalogSize,
      };
    }
    if (providerId === SHOPAIKEY_PROVIDER_ID) {
      const discoveredModels = Array.isArray(payload?.data) ? payload.data.length : 0;
      return {
        success: true,
        message: discoveredModels
          ? `Khóa ShopAIKey hợp lệ · phát hiện ${discoveredModels.toLocaleString('vi-VN')} model hội thoại`
          : 'Khóa ShopAIKey hợp lệ',
        discoveredModels,
      };
    }
    return { success: true, message: `Khóa ${provider.name} hợp lệ` };
  } catch (error: any) {
    return {
      success: false,
      message: localizeApiErrorMessage(error?.message || 'Không thể kết nối nhà cung cấp'),
    };
  }
};

export const discoverProviderModels = async (
  providerId: string,
  apiKey: string,
): Promise<DiscoveredProviderModel[]> => {
  const provider = getProviderById(providerId);
  if (!provider || !apiKey.trim()) return [];
  if (providerId === KIE_PROVIDER_ID) return [];
  if (providerId === REPLICATE_PROVIDER_ID) {
    return getModels().filter((model) => model.providerId === providerId).map((model) => ({ id: model.apiModel || model.id, name: model.name, type: model.type }));
  }

  const baseUrl = getApiBaseUrlForProvider(providerId);
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey.trim()}` };
  let url = `${baseUrl}/v1/models`;
  if (providerId === OPENROUTER_PROVIDER_ID) url = `${baseUrl}/v1/models`;
  if (providerId === GOOGLE_PROVIDER_ID) {
    url = `${baseUrl.replace(/\/openai$/, '')}/models?pageSize=1000`;
    delete headers.Authorization;
    headers['x-goog-api-key'] = apiKey.trim();
  }

  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(localizeApiErrorMessage(await readErrorMessage(response), response.status));
  const payload = await response.json();
  if (providerId === GOOGLE_PROVIDER_ID) {
    return (payload.models || [])
      .filter((model: any) => (model.supportedGenerationMethods || []).includes('generateContent'))
      .map((model: any) => ({ id: String(model.name || '').replace(/^models\//, ''), name: model.displayName || model.name, type: 'chat' as const }));
  }
  return (payload.data || []).map((model: any) => ({
    id: model.id,
    name: model.name || model.display_name || model.id,
    // /v1/models không công bố contract phân loại media. Ảnh/video đã có
    // catalog riêng; model phát hiện động chỉ được nhập vào tuyến hội thoại.
    type: 'chat' as const,
  }));
};
