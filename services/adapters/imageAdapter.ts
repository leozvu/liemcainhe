import { ImageModelDefinition, ImageGenerateOptions, AspectRatio } from '../../types/model';
import { getApiKeyForModel, getApiBaseUrlForModel, getActiveImageModel } from '../modelRegistry';
import { ApiKeyError } from './chatAdapter';
import {
  shouldUseImagesGenerationsEndpoint,
  callImagesGenerationsApi,
  extractImageFromApiResponse,
  normalizeImageResult,
} from '../imageGenerationHelpers';

const retryOperation = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 2000
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

export const callImageApi = async (
  options: ImageGenerateOptions,
  model?: ImageModelDefinition
): Promise<string> => {
  const activeModel = model || getActiveImageModel();
  if (!activeModel) {
    throw new Error('Không có mô hình tạo ảnh khả dụng');
  }

  const apiKey = getApiKeyForModel(activeModel.id);
  if (!apiKey) {
    throw new ApiKeyError('Thiếu API Key. Hãy cấu hình API Key trong phần cài đặt');
  }
  
  const apiBase = getApiBaseUrlForModel(activeModel.id);
  const apiModel = activeModel.apiModel || activeModel.id;
  const customEndpoint = activeModel.endpoint;
  const aspectRatio = options.aspectRatio || activeModel.params.defaultAspectRatio;

  if (shouldUseImagesGenerationsEndpoint(apiModel, customEndpoint)) {
    return callImagesGenerationsApi({
      apiBase,
      apiKey,
      model: apiModel,
      prompt: options.prompt,
      aspectRatio,
    });
  }

  const endpoint = '/v1/chat/completions';

  let finalPrompt = options.prompt;
  if (options.referenceImages && options.referenceImages.length > 0) {
    finalPrompt = `
      ⚠️⚠️⚠️ CRITICAL REQUIREMENTS - CHARACTER CONSISTENCY ⚠️⚠️⚠️
      
      Reference Images Information:
      - The FIRST image is the Scene/Environment reference.
      - Any subsequent images are Character references (Base Look or Variation).
      
      Task:
      Generate a cinematic shot matching this prompt: "${options.prompt}".
      
      ⚠️ ABSOLUTE REQUIREMENTS (NON-NEGOTIABLE):
      1. Scene Consistency:
         - STRICTLY maintain the visual style, lighting, and environment from the scene reference.
      
      2. Character Consistency - HIGHEST PRIORITY:
         If characters are present in the prompt, they MUST be IDENTICAL to the character reference images:
         • Facial Features: Eyes (color, shape, size), nose structure, mouth shape, facial contours must be EXACTLY the same
         • Hairstyle & Hair Color: Length, color, texture, and style must be PERFECTLY matched
         • Clothing & Outfit: Style, color, material, and accessories must be IDENTICAL
         • Body Type: Height, build, proportions must remain consistent
         
      ⚠️ DO NOT create variations or interpretations of the character - STRICT REPLICATION ONLY!
      ⚠️ Character appearance consistency is THE MOST IMPORTANT requirement!
    `;
  }

  const messageContent: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: finalPrompt }];
  if (options.referenceImages?.length) {
    for (const img of options.referenceImages) {
      if (!img?.trim()) continue;
      const url = /^data:image\//i.test(img)
        ? img
        : `data:image/png;base64,${img.replace(/^data:image\/[^;]+;base64,/, '')}`;
      messageContent.push({ type: 'image_url', image_url: { url } });
    }
  }

  const requestBody: any = {
    model: apiModel,
    messages: [{ role: 'user', content: messageContent }],
    max_tokens: 2048,
  };

  const response = await retryOperation(async () => {
    const res = await fetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': '*/*',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      if (res.status === 400) {
        throw new Error('Yêu cầu bị chặn vì an toàn nội dung. Hãy chỉnh prompt khung hình/ảnh, loại bỏ mô tả bạo lực, máu me hoặc nhạy cảm rồi thử lại.');
      }
      if (res.status === 500) {
        throw new Error('Hệ thống đang có nhiều yêu cầu. Vui lòng thử lại sau.');
      }
      
      let errorMessage = `Lỗi HTTP: ${res.status}`;
      try {
        const errorText = await res.text();
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorMessage;
        } catch {
          if (errorText) errorMessage = errorText;
        }
      } catch (_) {}
      throw new Error(errorMessage);
    }

    return await res.json();
  });

  const extracted = extractImageFromApiResponse(response);
  if (extracted) {
    return normalizeImageResult(extracted);
  }
  throw new Error(`Tạo ảnh thất bại: mô hình ${apiModel} không trả về dữ liệu ảnh`);
};

export const isAspectRatioSupported = (
  aspectRatio: AspectRatio,
  model?: ImageModelDefinition
): boolean => {
  const activeModel = model || getActiveImageModel();
  if (!activeModel) return false;
  
  return activeModel.params.supportedAspectRatios.includes(aspectRatio);
};
