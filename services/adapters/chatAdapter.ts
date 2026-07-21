import { ChatModelDefinition, ChatOptions, ChatModelParams, DEFAULT_PROVIDER_ID } from '../../types/model';
import { getApiKeyForModel, getApiBaseUrlForModel, getActiveChatModel, getProviderById } from '../modelRegistry';
import { localizeApiErrorMessage } from '../apiErrorLocalization';
import { verifyProviderApiKey } from '../providerService';
import { executeWithModelFallback } from '../modelRoutingService';
import { callKieChatApi } from './kieAdapter';

export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

class ProviderHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = status;
  }
}

const retryOperation = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> => {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.status);
      const nonRetryableClientError = status >= 400
        && status < 500
        && ![408, 409, 429].includes(status);
      if (nonRetryableClientError || error instanceof ApiKeyError) {
        throw error;
      }
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }
  
  throw lastError;
};

const cleanJsonResponse = (response: string): string => {
  let cleaned = response.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
  cleaned = cleaned.replace(/```\s*$/, '');
  return cleaned.trim();
};

const callChatApiOnce = async (
  options: ChatOptions,
  model?: ChatModelDefinition
): Promise<string> => {
  const activeModel = model || getActiveChatModel();
  if (!activeModel) {
    throw new Error('Không có mô hình hội thoại khả dụng');
  }

  const apiKey = getApiKeyForModel(activeModel.id);
  if (!apiKey) {
    throw new ApiKeyError('Thiếu khóa API. Hãy cấu hình khóa API trong phần cài đặt');
  }
  
  const apiBase = getApiBaseUrlForModel(activeModel.id);
  const provider = getProviderById(activeModel.providerId);
  if (provider?.protocol === 'kie') {
    return callKieChatApi(options, activeModel, apiKey, apiBase);
  }
  const endpoint = activeModel.endpoint || '/v1/chat/completions';
  const apiModel = activeModel.apiModel || activeModel.id;
  
  const params: ChatModelParams = {
    ...activeModel.params,
    ...options.overrideParams,
  };
  
  const messages: any[] = [];
  
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  
  const userContent = options.imageUrls?.length
    ? [
        { type: 'text', text: options.prompt },
        ...options.imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
      ]
    : options.prompt;
  messages.push({ role: 'user', content: userContent });
  
  const requestBody: any = {
    model: apiModel,
    messages,
    temperature: params.temperature,
  };
  if (params.maxTokens !== undefined) {
    requestBody.max_tokens = params.maxTokens;
  }
  
  if (params.topP !== undefined) {
    requestBody.top_p = params.topP;
  }
  if (params.frequencyPenalty !== undefined) {
    requestBody.frequency_penalty = params.frequencyPenalty;
  }
  if (params.presencePenalty !== undefined) {
    requestBody.presence_penalty = params.presencePenalty;
  }
  
  if (options.responseFormat === 'json') {
    requestBody.response_format = { type: 'json_object' };
  }
  
  const timeout = options.timeout || 600000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await retryOperation(async () => {
      const res = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      
      if (!res.ok) {
        let errorMessage = `Lỗi HTTP: ${res.status}`;
        try {
          const errorData = await res.json();
          errorMessage = errorData.error?.message || errorMessage;
        } catch (e) {
          const errorText = await res.text();
          if (errorText) errorMessage = errorText;
        }
        throw new ProviderHttpError(localizeApiErrorMessage(errorMessage, res.status), res.status);
      }
      
      return res;
    });
    
    clearTimeout(timeoutId);
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    if (options.responseFormat === 'json') {
      return cleanJsonResponse(content);
    }
    
    return content;
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error(`Yêu cầu hết thời gian chờ (${timeout / 1000} giây)`);
    }
    
    throw error;
  }
};

export const callChatApi = async (
  options: ChatOptions,
  model?: ChatModelDefinition,
): Promise<string> => {
  const preferred = model || getActiveChatModel();
  if (!preferred) throw new Error('Không có mô hình hội thoại khả dụng');
  return executeWithModelFallback({
    type: 'chat',
    preferred,
    inputSize: options.prompt.length + (options.systemPrompt?.length || 0),
    operation: (candidate) => callChatApiOnce(options, candidate as ChatModelDefinition),
  });
};

export const verifyApiKey = async (apiKey: string, baseUrl?: string): Promise<{ success: boolean; message: string }> => {
  // baseUrl chỉ được giữ trong chữ ký để không làm hỏng mã gọi cũ.
  void baseUrl;
  return verifyProviderApiKey(DEFAULT_PROVIDER_ID, apiKey);
};
