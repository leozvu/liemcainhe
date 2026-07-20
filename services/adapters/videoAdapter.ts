import { VideoModelDefinition, VideoGenerateOptions, AspectRatio, VideoDuration } from '../../types/model';
import { getApiKeyForModel, getApiBaseUrlForModel, getActiveVideoModel, getProviderById } from '../modelRegistry';
import { ApiKeyError } from './chatAdapter';
import { throwFromVideoHttpError, formatVideoTaskErrorForUser } from '../videoHttpErrors';
import { resolveSoraVideoDownloadId, downloadSoraCompletedVideo, encodeVideoPathId } from '../soraVideoResolve';
import { localizeApiErrorMessage } from '../apiErrorLocalization';
import { callReplicateVideoApi } from './replicateAdapter';
import { callKieVideoApi } from './kieAdapter';
import { executeWithModelFallback } from '../modelRoutingService';

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

const resizeImageToSize = async (base64Data: string, targetWidth: number, targetHeight: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Không thể tạo ngữ cảnh canvas'));
        return;
      }
      const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
      const scaledWidth = img.width * scale;
      const scaledHeight = img.height * scale;
      const offsetX = (targetWidth - scaledWidth) / 2;
      const offsetY = (targetHeight - scaledHeight) / 2;
      ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);
      const result = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      resolve(result);
    };
    img.onerror = () => reject(new Error('Tải ảnh thất bại'));
    img.src = `data:image/png;base64,${base64Data}`;
  });
};

const getSizeFromAspectRatio = (aspectRatio: AspectRatio): { width: number; height: number; size: string } => {
  const sizeMap: Record<AspectRatio, { width: number; height: number; size: string }> = {
    '16:9': { width: 1280, height: 720, size: '1280x720' },
    '9:16': { width: 720, height: 1280, size: '720x1280' },
    '1:1': { width: 720, height: 720, size: '720x720' },
  };
  return sizeMap[aspectRatio];
};

const getVeoModelName = (hasReferenceImage: boolean, aspectRatio: AspectRatio): string => {
  const orientation = aspectRatio === '9:16' ? 'portrait' : 'landscape';
  
  if (hasReferenceImage) {
    return `veo_3_1_i2v_s_fast_fl_${orientation}`;
  } else {
    return `veo_3_1_t2v_fast_${orientation}`;
  }
};

const callVeoApi = async (
  options: VideoGenerateOptions,
  model: VideoModelDefinition,
  apiKey: string,
  apiBase: string
): Promise<string> => {
  const aspectRatio = options.aspectRatio || model.params.defaultAspectRatio;
  const hasStartImage = !!options.startImage;
  
  const finalAspectRatio = aspectRatio === '1:1' ? '16:9' : aspectRatio;
  
  const modelName = getVeoModelName(hasStartImage, finalAspectRatio);
  
  const cleanStart = options.startImage?.replace(/^data:image\/(png|jpeg|jpg);base64,/, '') || '';
  const cleanEnd = options.endImage?.replace(/^data:image\/(png|jpeg|jpg);base64,/, '') || '';

  const messages: any[] = [{ role: 'user', content: options.prompt }];

  if (cleanStart) {
    messages[0].content = [
      { type: 'text', text: options.prompt },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${cleanStart}` } },
    ];
  }

  if (cleanEnd && Array.isArray(messages[0].content)) {
    messages[0].content.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${cleanEnd}` },
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1200000);

  try {
    const response = await retryOperation(async () => {
      const res = await fetch(`${apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          stream: false,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throwFromVideoHttpError(res.status, errorText, 'veo');
      }

      return res;
    });

    clearTimeout(timeoutId);

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    const urlMatch = content.match(/https?:\/\/[^\s\])"]+\.mp4[^\s\])"']*/i) ||
                    content.match(/https?:\/\/[^\s\])"]+/i);
    
    if (!urlMatch) {
      throw new Error('Tạo video thất bại: không thể lấy URL video từ phản hồi');
    }

    const videoUrl = urlMatch[0];

    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Tải video thất bại: ${videoResponse.status}`);
    }

    const videoBlob = await videoResponse.blob();
    const reader = new FileReader();
    
    return new Promise((resolve, reject) => {
      reader.onloadend = () => {
        const result = reader.result as string;
        if (result && result.startsWith('data:')) {
          resolve(result);
        } else {
          reject(new Error('Chuyển đổi video thất bại'));
        }
      };
      reader.onerror = () => reject(new Error('Đọc video thất bại'));
      reader.readAsDataURL(videoBlob);
    });
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Tạo video hết thời gian chờ (20 phút)');
    }
    throw error;
  }
};

const callSoraApi = async (
  options: VideoGenerateOptions,
  model: VideoModelDefinition,
  apiKey: string,
  apiBase: string
): Promise<string> => {
  const aspectRatio = options.aspectRatio || model.params.defaultAspectRatio;
  const duration = options.duration || model.params.defaultDuration;
  const apiModel = model.apiModel || model.id;
  
  const { width, height, size } = getSizeFromAspectRatio(aspectRatio);

  const formData = new FormData();
  formData.append('model', apiModel);
  formData.append('prompt', options.prompt);
  formData.append('seconds', String(duration));
  formData.append('size', size);

  if (options.startImage) {
    const cleanBase64 = options.startImage.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
    const resizedBase64 = await resizeImageToSize(cleanBase64, width, height);
    
    const byteCharacters = atob(resizedBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/png' });
    formData.append('input_reference', blob, 'reference.png');
  }

  const createResponse = await fetch(`${apiBase}/v1/videos`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throwFromVideoHttpError(createResponse.status, errorText, 'sora');
  }

  const createData = await createResponse.json();
  const taskId = createData.id || createData.task_id;
  
  if (!taskId) {
    throw new Error('Không thể tạo tác vụ video: máy chủ không trả về mã tác vụ');
  }

  const maxPollingTime = 1200000;
  const pollingInterval = 5000;
  const startTime = Date.now();
  
  let videoId: string | null = null;
  let completedStatus: Record<string, unknown> | null = null;

  while (Date.now() - startTime < maxPollingTime) {
    await new Promise(resolve => setTimeout(resolve, pollingInterval));
    
    const statusResponse = await fetch(`${apiBase}/v1/videos/${encodeVideoPathId(taskId)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!statusResponse.ok) {
      console.warn('Không thể truy vấn trạng thái tác vụ, đang thử lại...');
      continue;
    }

    const statusData = await statusResponse.json();
    const status = statusData.status;

    if (status === 'completed' || status === 'succeeded') {
      completedStatus = statusData as Record<string, unknown>;
      videoId = resolveSoraVideoDownloadId(statusData as Record<string, unknown>);
      if (!videoId && statusData.outputs?.length) {
        const o0 = statusData.outputs[0];
        videoId = typeof o0 === 'string' ? o0 : o0?.id;
      }
      if (!videoId) {
        videoId = statusData.id || null;
      }
      break;
    } else if (status === 'failed' || status === 'error') {
      throw new Error(formatVideoTaskErrorForUser(statusData.error ?? statusData, statusData.message, 'sora'));
    }
  }

  if (!videoId && !completedStatus) {
    throw new Error('Tạo video hết thời gian chờ (20 phút) hoặc không có mã video');
  }

  return downloadSoraCompletedVideo({
    apiBase,
    apiKey,
    taskId,
    completedStatus,
    initialVideoId: videoId,
  });
};

const callVideoApiOnce = async (
  options: VideoGenerateOptions,
  model?: VideoModelDefinition
): Promise<string> => {
  const activeModel = model || getActiveVideoModel();
  if (!activeModel) {
    throw new Error('Không có mô hình video khả dụng');
  }

  const apiKey = getApiKeyForModel(activeModel.id);
  if (!apiKey) {
    throw new ApiKeyError('Thiếu khóa API. Hãy cấu hình khóa API trong phần cài đặt');
  }

  const apiBase = getApiBaseUrlForModel(activeModel.id);
  const provider = getProviderById(activeModel.providerId);
  if (provider?.protocol === 'replicate') {
    return callReplicateVideoApi(options, activeModel, apiKey, apiBase);
  }
  if (provider?.protocol === 'kie') {
    return callKieVideoApi(options, activeModel, apiKey, apiBase);
  }
  const mode = activeModel.params.mode;

  const apiModel = activeModel.apiModel || activeModel.id;
  const endpoint = activeModel.endpoint || '';
  const usesVideosApi =
    mode === 'async' || endpoint.includes('/v1/videos');

  if (usesVideosApi) {
    return callSoraApi(options, activeModel, apiKey, apiBase);
  } else {
    return callVeoApi(options, activeModel, apiKey, apiBase);
  }
};

export const callVideoApi = async (
  options: VideoGenerateOptions,
  model?: VideoModelDefinition,
): Promise<string> => {
  const preferred = model || getActiveVideoModel();
  if (!preferred) throw new Error('Không có mô hình video khả dụng');
  return executeWithModelFallback({
    type: 'video',
    preferred,
    inputSize: options.prompt.length,
    durationSeconds: options.duration || preferred.params.defaultDuration,
    operation: (candidate) => callVideoApiOnce(options, candidate as VideoModelDefinition),
  });
};

export const isAspectRatioSupported = (
  aspectRatio: AspectRatio,
  model?: VideoModelDefinition
): boolean => {
  const activeModel = model || getActiveVideoModel();
  if (!activeModel) return false;
  
  return activeModel.params.supportedAspectRatios.includes(aspectRatio);
};

export const isDurationSupported = (
  duration: VideoDuration,
  model?: VideoModelDefinition
): boolean => {
  const activeModel = model || getActiveVideoModel();
  if (!activeModel) return false;
  
  return activeModel.params.supportedDurations.includes(duration);
};
