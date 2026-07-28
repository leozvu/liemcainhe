import { ImageGenerateOptions, ImageModelDefinition, VideoGenerateOptions, VideoModelDefinition } from '../../types/model';
import { extractImageFromApiResponse, normalizeImageResult } from '../imageGenerationHelpers';
import { localizeApiErrorMessage } from '../apiErrorLocalization';
import {
  createBillableHttpError,
  createConfirmedBillableFailure,
  submitPaidTaskSafely,
} from '../mediaExecutionService';

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const readError = async (response: Response): Promise<string> => {
  const fallback = `ShopAIKey trả HTTP ${response.status}`;
  try {
    const payload = await response.clone().json();
    return payload?.error?.message || payload?.message || payload?.detail || fallback;
  } catch {
    try {
      return (await response.text()).trim() || fallback;
    } catch {
      return fallback;
    }
  }
};

const authenticatedFetch = (
  url: string,
  apiKey: string,
  init: RequestInit = {},
): Promise<Response> => fetch(url, {
  ...init,
  headers: {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers || {}),
  },
});

/** Nano Banana dùng endpoint multimedia riêng của ShopAIKey. */
export const callShopAIKeyImageApi = async (
  options: ImageGenerateOptions,
  model: ImageModelDefinition,
  apiKey: string,
  apiBase: string,
): Promise<string> => {
  const endpoint = model.endpoint || '/images/google/generations';
  const response = await submitPaidTaskSafely(async () => {
    const next = await authenticatedFetch(`${apiBase}${endpoint}`, apiKey, {
      method: 'POST',
      body: JSON.stringify({
        model: model.apiModel || model.id,
        prompt: options.prompt,
        size: options.aspectRatio || model.params.defaultAspectRatio,
        imageSize: model.apiModel === 'nano-banana-pro' ? '4K' : '2K',
        format: 'png',
        response_format: 'b64_json',
        ...(options.referenceImages?.length
          ? { image_urls: options.referenceImages.filter(Boolean).slice(0, 5) }
          : {}),
      }),
    });
    if (!next.ok) {
      throw createBillableHttpError(
        localizeApiErrorMessage(await readError(next), next.status),
        next.status,
      );
    }
    return next;
  });

  await options.onProviderAccepted?.();
  const payload = await response.json();
  const result = extractImageFromApiResponse(payload);
  if (!result) {
    throw new Error('ShopAIKey đã nhận tác vụ ảnh nhưng không trả về dữ liệu ảnh hợp lệ. Hãy đối soát request ID trước khi chạy lại.');
  }
  return normalizeImageResult(result);
};

const extractVideoTaskId = (payload: any): string => String(
  payload?.data?.task_id || payload?.data?.taskId || payload?.task_id || payload?.taskId || '',
).trim();

const extractVideoResult = (payload: any): string => String(
  payload?.data?.result_url
  || payload?.data?.resultUrl
  || payload?.data?.url
  || payload?.result_url
  || payload?.resultUrl
  || payload?.url
  || '',
).trim();

/** Veo/Grok dùng hàng đợi generic có task ID; không tự tạo lại request khi poll lỗi. */
export const callShopAIKeyVideoApi = async (
  options: VideoGenerateOptions,
  model: VideoModelDefinition,
  apiKey: string,
  apiBase: string,
): Promise<string> => {
  const apiModel = model.apiModel || model.id;
  const aspectRatio = options.aspectRatio || model.params.defaultAspectRatio;
  const duration = options.duration || model.params.defaultDuration;
  const images = [options.startImage, options.endImage].filter((value): value is string => Boolean(value));
  const isGrok = apiModel.startsWith('grok-video');
  const metadata = isGrok
    ? {
        ...(images.length ? { images } : {}),
        duration,
        ratio: aspectRatio,
        resolution: '720P',
      }
    : {
        ...(images.length ? { images } : {}),
        aspect_ratio: aspectRatio,
        enhance_prompt: true,
        enable_upsample: false,
      };

  const createResponse = await submitPaidTaskSafely(async () => {
    const next = await authenticatedFetch(`${apiBase}/v1/video/generations`, apiKey, {
      method: 'POST',
      body: JSON.stringify({ model: apiModel, prompt: options.prompt, metadata }),
    });
    if (!next.ok) {
      throw createBillableHttpError(
        localizeApiErrorMessage(await readError(next), next.status),
        next.status,
      );
    }
    return next;
  });

  await options.onProviderAccepted?.();
  const created = await createResponse.json();
  const taskId = extractVideoTaskId(created);
  if (!taskId) {
    throw new Error('ShopAIKey đã nhận yêu cầu video nhưng không trả về task ID. Không tự chạy lại để tránh trừ phí hai lần.');
  }
  await options.onProviderTaskId?.(taskId);

  const startedAt = Date.now();
  let interval = 4_000;
  while (Date.now() - startedAt < 20 * 60 * 1000) {
    await wait(interval);
    interval = Math.min(10_000, Math.round(interval * 1.2));
    let statusResponse: Response;
    try {
      statusResponse = await authenticatedFetch(
        `${apiBase}/v1/video/generations/${encodeURIComponent(taskId)}`,
        apiKey,
      );
    } catch {
      continue;
    }
    if (!statusResponse.ok) {
      if ([401, 402, 403, 404].includes(statusResponse.status)) {
        throw createBillableHttpError(await readError(statusResponse), statusResponse.status);
      }
      continue;
    }

    const payload = await statusResponse.json();
    const status = String(payload?.data?.status || payload?.status || '').toLowerCase();
    if (status === 'success' || status === 'completed' || status === 'succeeded') {
      const result = extractVideoResult(payload);
      if (result) return result;
      throw new Error(`ShopAIKey báo hoàn tất task ${taskId} nhưng không trả về URL video.`);
    }
    if (status === 'failure' || status === 'failed' || status === 'error') {
      const reason = payload?.data?.fail_reason || payload?.fail_reason || payload?.error?.message || 'Tác vụ video ShopAIKey thất bại';
      throw createConfirmedBillableFailure(localizeApiErrorMessage(String(reason)));
    }
  }

  throw new Error(`Task ShopAIKey ${taskId} chưa có kết quả sau 20 phút. Hãy đối soát trạng thái trước khi chạy lại.`);
};
