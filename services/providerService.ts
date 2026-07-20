import {
  GOOGLE_PROVIDER_ID,
  OPENROUTER_PROVIDER_ID,
  REPLICATE_PROVIDER_ID,
} from '../types/model';
import {
  getApiBaseUrlForProvider,
  getProviderById,
} from './modelRegistry';
import { localizeApiErrorMessage } from './apiErrorLocalization';

export interface ProviderVerificationResult {
  success: boolean;
  message: string;
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
      };
    }
    if (providerId === REPLICATE_PROVIDER_ID && payload?.username) {
      return { success: true, message: `Đã kết nối tài khoản ${payload.username}` };
    }
    return { success: true, message: `Khóa ${provider.name} hợp lệ` };
  } catch (error: any) {
    return {
      success: false,
      message: localizeApiErrorMessage(error?.message || 'Không thể kết nối nhà cung cấp'),
    };
  }
};
