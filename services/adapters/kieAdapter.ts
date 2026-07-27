import type {
  ChatModelDefinition,
  ChatOptions,
  ImageGenerateOptions,
  ImageModelDefinition,
  VideoGenerateOptions,
  VideoModelDefinition,
} from '../../types/model';
import { localizeApiErrorMessage } from '../apiErrorLocalization';
import { createConfirmedBillableFailure } from '../mediaExecutionService';

const KIE_FILE_PROXY = '/api-proxy/kie-files';
const MARKET_CREATE_ENDPOINT = '/api/v1/jobs/createTask';
const MARKET_STATUS_ENDPOINT = '/api/v1/jobs/recordInfo';
const VEO_CREATE_ENDPOINT = '/api/v1/veo/generate';
const VEO_STATUS_ENDPOINT = '/api/v1/veo/record-info';
const MIN_CREATE_INTERVAL_MS = 1800;
const MAX_RATE_LIMIT_RETRIES = 3;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class KieRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'KieRequestError';
  }
}

let createQueue: Promise<void> = Promise.resolve();
let lastCreateStartedAt = 0;

/** Xếp hàng riêng thao tác tạo tác vụ; việc thăm dò kết quả vẫn chạy song song. */
const enqueueCreateRequest = async <T>(operation: () => Promise<T>): Promise<T> => {
  let release!: () => void;
  const previous = createQueue;
  createQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous.catch(() => undefined);
  try {
    const remaining = MIN_CREATE_INTERVAL_MS - (Date.now() - lastCreateStartedAt);
    if (remaining > 0) await wait(remaining);
    lastCreateStartedAt = Date.now();
    return await operation();
  } finally {
    release();
  }
};

const readError = async (response: Response): Promise<string> => {
  const raw = await response.text().catch(() => '');
  try {
    const payload = JSON.parse(raw);
    return payload?.msg || payload?.message || payload?.error?.message || raw || `Lỗi HTTP ${response.status}`;
  } catch {
    return raw || `Lỗi HTTP ${response.status}`;
  }
};

const requestJson = async <T>(url: string, apiKey: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new KieRequestError(
      localizeApiErrorMessage(await readError(response), response.status),
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (typeof payload?.code === 'number' && payload.code !== 200) {
    throw new KieRequestError(
      localizeApiErrorMessage(payload?.msg || `KIE trả về mã ${payload.code}`, payload.code),
      payload.code,
    );
  }
  return payload as T;
};

const createPaidTaskSafely = async <T>(operation: () => Promise<T>): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      return await enqueueCreateRequest(operation);
    } catch (error) {
      lastError = error;
      const rateLimited = error instanceof KieRequestError && error.status === 429;
      if (!rateLimited || attempt === MAX_RATE_LIMIT_RETRIES - 1) throw error;
      const retryAfter = error.retryAfterMs || 3000 * (attempt + 1);
      await wait(retryAfter);
    }
  }
  throw lastError;
};

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Không thể đọc ảnh tham chiếu'));
  reader.readAsDataURL(blob);
});

const normalizeDataUrl = async (source: string): Promise<string> => {
  if (/^data:/i.test(source)) return source;
  if (/^https?:/i.test(source) || /^blob:/i.test(source) || source.startsWith('/')) {
    const resolved = source.startsWith('/') ? new URL(source, window.location.origin).toString() : source;
    const response = await fetch(resolved);
    if (!response.ok) throw new Error(`Không thể đọc ảnh tham chiếu (${response.status})`);
    return blobToDataUrl(await response.blob());
  }
  return `data:image/png;base64,${source.replace(/^data:image\/[^;]+;base64,/, '')}`;
};

/** KIE Market chỉ nhận URL công khai; dữ liệu cục bộ được tải lên kho tạm ba ngày của KIE. */
export const ensureKieFileUrl = async (source: string, apiKey: string, index = 0): Promise<string> => {
  if (/^https?:/i.test(source)) {
    try {
      const url = new URL(source);
      if (url.origin !== window.location.origin) return source;
    } catch {
      // Chuyển sang upload base64 ở dưới.
    }
  }

  const base64Data = await normalizeDataUrl(source);
  const mime = base64Data.match(/^data:([^;]+);/)?.[1] || 'image/png';
  const extension = mime.includes('jpeg') ? 'jpg' : mime.split('/')[1]?.replace('svg+xml', 'svg') || 'png';
  const payload = await requestJson<any>(`${KIE_FILE_PROXY}/api/file-base64-upload`, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      base64Data,
      uploadPath: 'egoric-inputs',
      fileName: `egoric-${Date.now()}-${index}.${extension}`,
    }),
  });
  const fileUrl = payload?.data?.fileUrl || payload?.data?.downloadUrl;
  if (!fileUrl) throw new Error('KIE không trả về URL sau khi tải ảnh tham chiếu');
  return fileUrl;
};

const uploadReferences = async (sources: Array<string | undefined>, apiKey: string): Promise<string[]> => {
  const valid = sources.filter((source): source is string => Boolean(source?.trim()));
  const urls: string[] = [];
  for (let index = 0; index < valid.length; index += 1) {
    urls.push(await ensureKieFileUrl(valid[index], apiKey, index));
  }
  return urls;
};

const applyReferences = (
  input: Record<string, unknown>,
  urls: string[],
  field?: string,
  mode: 'single' | 'array' = 'array',
  maxReferences?: number,
) => {
  if (!field || urls.length === 0) return;
  const selected = maxReferences ? urls.slice(0, maxReferences) : urls;
  input[field] = mode === 'single' ? selected[0] : selected;
};

export const buildKieImageInput = async (
  options: ImageGenerateOptions,
  model: ImageModelDefinition,
  apiKey: string,
): Promise<Record<string, unknown>> => {
  const config = model.kie || {};
  const urls = await uploadReferences(options.referenceImages || [], apiKey);
  if (config.requiresReference && urls.length === 0) {
    throw new Error(`${model.name} cần ít nhất một ảnh tham chiếu`);
  }
  const input: Record<string, unknown> = { ...(config.defaults || {}) };
  if (!config.omitPrompt) input.prompt = options.prompt;
  const aspectRatio = options.aspectRatio || model.params.defaultAspectRatio;
  if (config.aspectRatioField) {
    input[config.aspectRatioField] = config.aspectRatioMap?.[aspectRatio] || aspectRatio;
  }
  applyReferences(input, urls, config.referenceField, config.referenceMode, config.maxReferences);
  return input;
};

export const buildKieVideoInput = async (
  options: VideoGenerateOptions,
  model: VideoModelDefinition,
  apiKey: string,
): Promise<Record<string, unknown>> => {
  const config = model.kie || {};
  const urls = await uploadReferences([options.startImage, options.endImage], apiKey);
  if (config.requiresReference && urls.length === 0) {
    throw new Error(`${model.name} cần khung hình đầu hoặc ảnh tham chiếu`);
  }
  const input: Record<string, unknown> = { ...(config.defaults || {}) };
  if (!config.omitPrompt) input.prompt = options.prompt;
  const aspectRatio = options.aspectRatio || model.params.defaultAspectRatio;
  if (config.aspectRatioField) {
    input[config.aspectRatioField] = config.aspectRatioMap?.[aspectRatio] || aspectRatio;
  }
  const duration = options.duration || model.params.defaultDuration;
  if (config.durationField) input[config.durationField] = config.durationAsString ? String(duration) : duration;
  applyReferences(input, urls, config.referenceField, config.referenceMode, config.maxReferences);
  if (config.endReferenceField && urls[1]) input[config.endReferenceField] = urls[1];
  return input;
};

const extractUrls = (value: any): string[] => {
  if (!value) return [];
  if (typeof value === 'string') {
    try { return extractUrls(JSON.parse(value)); } catch { return /^https?:/i.test(value) ? [value] : []; }
  }
  if (Array.isArray(value)) return value.flatMap(extractUrls);
  const candidates = value.resultUrls || value.result_urls || value.urls || value.output || value.outputs || value.url;
  return candidates ? extractUrls(candidates) : [];
};

const pollMarketTask = async (apiBase: string, apiKey: string, taskId: string): Promise<string> => {
  const startedAt = Date.now();
  let interval = 2500;
  while (Date.now() - startedAt < 20 * 60 * 1000) {
    await wait(interval);
    interval = Math.min(8000, Math.round(interval * 1.18));
    let payload: any;
    try {
      payload = await requestJson<any>(`${apiBase}${MARKET_STATUS_ENDPOINT}?taskId=${encodeURIComponent(taskId)}`, apiKey);
    } catch (error) {
      const status = error instanceof KieRequestError ? error.status : undefined;
      if ((status && [401, 402, 403].includes(status)) || Date.now() - startedAt > 60_000) throw error;
      continue;
    }
    const data = payload?.data || {};
    const state = String(data.state || data.status || '').toLowerCase();
    if (state === 'success' || state === 'completed' || state === 'succeeded') {
      const urls = extractUrls(data.resultJson || data.result || data.output || data);
      if (urls[0]) return urls[0];
      throw new Error('Tác vụ KIE hoàn tất nhưng không trả về tệp kết quả');
    }
    if (state === 'fail' || state === 'failed' || state === 'error') {
      const rawError = data.failMsg || data.errorMessage || data.error || 'Tác vụ KIE thất bại';
      throw createConfirmedBillableFailure(localizeApiErrorMessage(rawError));
    }
  }
  throw new Error('Tác vụ KIE hết thời gian chờ sau 20 phút');
};

const createMarketTask = async (
  apiBase: string,
  apiKey: string,
  model: string,
  input: Record<string, unknown>,
  onProviderAccepted?: () => void | Promise<void>,
  onProviderTaskId?: (taskId: string) => void | Promise<void>,
): Promise<string> => {
  // Chỉ thử lại khi KIE xác nhận HTTP 429 (yêu cầu đã bị từ chối, chưa tạo tác vụ).
  // Không thử lại lỗi mạng/5xx vì yêu cầu trước có thể đã được nhận và tính phí.
  const payload = await createPaidTaskSafely(() => requestJson<any>(`${apiBase}${MARKET_CREATE_ENDPOINT}`, apiKey, {
      method: 'POST',
      body: JSON.stringify({ model, input }),
    }));
  await onProviderAccepted?.();
  const taskId = payload?.data?.taskId || payload?.data?.task_id || payload?.taskId;
  if (!taskId) throw new Error('KIE không trả về mã tác vụ');
  await onProviderTaskId?.(String(taskId));
  return pollMarketTask(apiBase, apiKey, taskId);
};

const callKieVeo = async (
  options: VideoGenerateOptions,
  model: VideoModelDefinition,
  apiKey: string,
  apiBase: string,
): Promise<string> => {
  const input = await buildKieVideoInput(options, model, apiKey);
  const imageUrls = Array.isArray(input.imageUrls) ? input.imageUrls as string[] : [];
  const generationType = imageUrls.length > 1
    ? 'FIRST_AND_LAST_FRAMES_2_VIDEO'
    : imageUrls.length === 1 ? 'REFERENCE_2_VIDEO' : 'TEXT_2_VIDEO';
  const payload = await createPaidTaskSafely(() => requestJson<any>(`${apiBase}${VEO_CREATE_ENDPOINT}`, apiKey, {
      method: 'POST',
      body: JSON.stringify({
        prompt: options.prompt,
        imageUrls,
        model: model.apiModel || model.id,
        aspect_ratio: options.aspectRatio || model.params.defaultAspectRatio,
        enableFallback: false,
        enableTranslation: true,
        generationType,
      }),
    }));
  await options.onProviderAccepted?.();
  const taskId = payload?.data?.taskId || payload?.data?.task_id || payload?.taskId;
  if (!taskId) throw new Error('KIE Veo không trả về mã tác vụ');
  await options.onProviderTaskId?.(String(taskId));

  const startedAt = Date.now();
  while (Date.now() - startedAt < 20 * 60 * 1000) {
    await wait(6000);
    let status: any;
    try {
      status = await requestJson<any>(`${apiBase}${VEO_STATUS_ENDPOINT}?taskId=${encodeURIComponent(taskId)}`, apiKey);
    } catch (error) {
      const errorStatus = error instanceof KieRequestError ? error.status : undefined;
      if ((errorStatus && [401, 402, 403].includes(errorStatus)) || Date.now() - startedAt > 60_000) throw error;
      continue;
    }
    const data = status?.data || {};
    const successFlag = Number(data.successFlag ?? data.success_flag ?? 0);
    const urls = extractUrls(data.response || data.result || data);
    if (successFlag === 1 || urls.length > 0) {
      if (urls[0]) return urls[0];
    }
    if (successFlag === 2 || successFlag === 3 || data.errorCode || data.errorMessage) {
      throw createConfirmedBillableFailure(
        localizeApiErrorMessage(data.errorMessage || data.error || 'Tác vụ KIE Veo thất bại'),
      );
    }
  }
  throw new Error('Tác vụ KIE Veo hết thời gian chờ sau 20 phút');
};

export const callKieImageApi = async (
  options: ImageGenerateOptions,
  model: ImageModelDefinition,
  apiKey: string,
  apiBase: string,
): Promise<string> => createMarketTask(
  apiBase,
  apiKey,
  model.apiModel || model.id,
  await buildKieImageInput(options, model, apiKey),
  options.onProviderAccepted,
  options.onProviderTaskId,
);

export const callKieVideoApi = async (
  options: VideoGenerateOptions,
  model: VideoModelDefinition,
  apiKey: string,
  apiBase: string,
): Promise<string> => {
  if (model.kie?.taskApi === 'veo') return callKieVeo(options, model, apiKey, apiBase);
  return createMarketTask(
    apiBase,
    apiKey,
    model.apiModel || model.id,
    await buildKieVideoInput(options, model, apiKey),
    options.onProviderAccepted,
    options.onProviderTaskId,
  );
};

const extractChatText = (payload: any): string => {
  const chatText = payload?.choices?.[0]?.message?.content;
  if (typeof chatText === 'string') return chatText;
  const claudeText = payload?.content?.find?.((item: any) => item?.type === 'text')?.text;
  if (typeof claudeText === 'string') return claudeText;
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const responseText = payload?.output
    ?.flatMap?.((item: any) => item?.content || [])
    ?.find?.((item: any) => item?.type === 'output_text' || item?.type === 'text')?.text;
  return typeof responseText === 'string' ? responseText : '';
};

export const callKieChatApi = async (
  options: ChatOptions,
  model: ChatModelDefinition,
  apiKey: string,
  apiBase: string,
): Promise<string> => {
  const config = model.kie || {};
  const params = { ...model.params, ...options.overrideParams };
  const endpoint = model.endpoint || '/v1/chat/completions';
  const imageUrls = (options.imageUrls || []).filter(Boolean);
  const openAiUserContent = imageUrls.length
    ? [
        { type: 'text', text: options.prompt },
        ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
      ]
    : options.prompt;
  const messages = [
    ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
    { role: 'user', content: openAiUserContent },
  ];
  let body: Record<string, unknown>;
  if (config.chatApi === 'responses') {
    body = {
      model: model.apiModel || model.id,
      stream: false,
      ...(params.maxTokens ? { max_output_tokens: params.maxTokens } : {}),
      input: [
        ...(options.systemPrompt ? [{ role: 'system', content: [{ type: 'input_text', text: options.systemPrompt }] }] : []),
        {
          role: 'user',
          content: [
            { type: 'input_text', text: options.prompt },
            ...imageUrls.map((imageUrl) => ({ type: 'input_image', image_url: imageUrl })),
          ],
        },
      ],
    };
  } else if (config.chatApi === 'claude') {
    body = {
      model: model.apiModel || model.id,
      max_tokens: params.maxTokens || 4096,
      stream: false,
      ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
      messages: [{
        role: 'user',
        content: imageUrls.length
          ? [
              { type: 'text', text: options.prompt },
              ...imageUrls.map((url) => ({ type: 'image', source: { type: 'url', url } })),
            ]
          : options.prompt,
      }],
    };
  } else {
    body = {
      ...(config.omitModel ? {} : { model: model.apiModel || model.id }),
      stream: false,
      messages,
      temperature: params.temperature,
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
      ...(options.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
    };
  }
  const payload = await requestJson<any>(`${apiBase}${endpoint}`, apiKey, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const text = extractChatText(payload);
  if (!text) throw new Error(`${model.name} không trả về nội dung văn bản`);
  return text;
};
