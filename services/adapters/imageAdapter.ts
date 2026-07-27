import { ImageModelDefinition, ImageGenerateOptions, AspectRatio } from '../../types/model';
import { getApiKeyForModel, getApiBaseUrlForModel, getActiveImageModel, getProviderById } from '../modelRegistry';
import { ApiKeyError } from './chatAdapter';
import { localizeApiErrorMessage } from '../apiErrorLocalization';
import {
  shouldUseImagesGenerationsEndpoint,
  callImagesGenerationsApi,
  extractImageFromApiResponse,
  normalizeImageResult,
} from '../imageGenerationHelpers';
import { callReplicateImageApi } from './replicateAdapter';
import { callKieImageApi } from './kieAdapter';
import { executeWithModelFallback } from '../modelRoutingService';
import { createBillableHttpError, submitPaidTaskSafely } from '../mediaExecutionService';

const callImageApiOnce = async (
  options: ImageGenerateOptions,
  model?: ImageModelDefinition
): Promise<string> => {
  const activeModel = model || getActiveImageModel();
  if (!activeModel) {
    throw new Error('Không có mô hình tạo ảnh khả dụng');
  }

  const apiKey = getApiKeyForModel(activeModel.id);
  if (!apiKey) {
    throw new ApiKeyError('Thiếu khóa API. Hãy cấu hình khóa API trong phần cài đặt');
  }
  
  const apiBase = getApiBaseUrlForModel(activeModel.id);
  const provider = getProviderById(activeModel.providerId);
  if (provider?.protocol === 'replicate') {
    return callReplicateImageApi(options, activeModel, apiKey, apiBase);
  }
  if (provider?.protocol === 'kie') {
    return callKieImageApi(options, activeModel, apiKey, apiBase);
  }
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
      onProviderAccepted: options.onProviderAccepted,
    });
  }

  const endpoint = '/v1/chat/completions';

  let finalPrompt = options.prompt;
  if (options.referenceImages && options.referenceImages.length > 0) {
    finalPrompt = `
      ⚠️⚠️⚠️ YÊU CẦU QUAN TRỌNG — NHẤT QUÁN NHÂN VẬT ⚠️⚠️⚠️

      Thông tin ảnh tham chiếu:
      - Ảnh ĐẦU TIÊN là tham chiếu bối cảnh hoặc môi trường.
      - Các ảnh tiếp theo là tham chiếu nhân vật, gồm tạo hình cơ bản hoặc biến thể.

      Nhiệm vụ:
      Tạo cảnh quay điện ảnh phù hợp với câu lệnh: "${options.prompt}".

      ⚠️ YÊU CẦU BẮT BUỘC:
      1. Nhất quán bối cảnh:
         - Giữ nghiêm ngặt phong cách hình ảnh, ánh sáng và môi trường từ ảnh tham chiếu.

      2. Nhất quán nhân vật — ƯU TIÊN CAO NHẤT:
         Nếu câu lệnh có nhân vật, họ phải giống hệt ảnh tham chiếu:
         • Khuôn mặt: mắt, mũi, miệng và đường nét phải hoàn toàn giống nhau.
         • Kiểu tóc và màu tóc: độ dài, màu sắc, chất tóc và kiểu tóc phải khớp chính xác.
         • Trang phục: kiểu dáng, màu sắc, chất liệu và phụ kiện phải giống hệt.
         • Vóc dáng: chiều cao, thể hình và tỷ lệ cơ thể phải nhất quán.

      ⚠️ Không tạo biến thể hoặc diễn giải lại nhân vật; chỉ tái tạo đúng tham chiếu.
      ⚠️ Sự nhất quán về ngoại hình nhân vật là yêu cầu quan trọng nhất.
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

  const response = await submitPaidTaskSafely(async () => {
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
        throw createBillableHttpError('Yêu cầu bị chặn vì an toàn nội dung. Hãy chỉnh câu lệnh khung hình hoặc ảnh, loại bỏ mô tả bạo lực, máu me hoặc nhạy cảm rồi thử lại.', res.status);
      }
      if (res.status === 500) {
        throw createBillableHttpError('Hệ thống đang có nhiều yêu cầu. Vui lòng thử lại sau.', res.status);
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
      throw createBillableHttpError(localizeApiErrorMessage(errorMessage, res.status), res.status);
    }

    await options.onProviderAccepted?.();
    return await res.json();
  });

  const extracted = extractImageFromApiResponse(response);
  if (extracted) {
    return normalizeImageResult(extracted);
  }
  throw new Error(`Tạo ảnh thất bại: mô hình ${apiModel} không trả về dữ liệu ảnh`);
};

export const callImageApi = async (
  options: ImageGenerateOptions,
  model?: ImageModelDefinition,
): Promise<string> => {
  const preferred = model || getActiveImageModel();
  if (!preferred) throw new Error('Không có mô hình tạo ảnh khả dụng');
  return executeWithModelFallback({
    type: 'image',
    preferred,
    inputSize: options.prompt.length,
    resourceId: options.usageResourceId,
    operation: (candidate) => callImageApiOnce(options, candidate as ImageModelDefinition),
  });
};

export const isAspectRatioSupported = (
  aspectRatio: AspectRatio,
  model?: ImageModelDefinition
): boolean => {
  const activeModel = model || getActiveImageModel();
  if (!activeModel) return false;
  
  return activeModel.params.supportedAspectRatios.includes(aspectRatio);
};
