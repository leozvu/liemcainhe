import { ChatModelDefinition, ChatOptions, ChatModelParams, DEFAULT_PROVIDER_ID } from '../../types/model';
import { getApiKeyForModel, getApiBaseUrlForModel, getActiveChatModel } from '../modelRegistry';
import { localizeApiErrorMessage } from '../apiErrorLocalization';
import { verifyProviderApiKey } from '../providerService';

export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyError';
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
      if (error.message?.includes('400') || 
          error.message?.includes('401') || 
          error.message?.includes('403')) {
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

export const callChatApi = async (
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
  
  messages.push({ role: 'user', content: options.prompt });
  
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
        throw new Error(localizeApiErrorMessage(errorMessage, res.status));
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

export const verifyApiKey = async (apiKey: string, baseUrl?: string): Promise<{ success: boolean; message: string }> => {
  // baseUrl chỉ được giữ trong chữ ký để không làm hỏng mã gọi cũ.
  void baseUrl;
  return verifyProviderApiKey(DEFAULT_PROVIDER_ID, apiKey);
};
