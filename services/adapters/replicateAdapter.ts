import {
  ImageGenerateOptions,
  ImageModelDefinition,
  VideoGenerateOptions,
  VideoModelDefinition,
} from '../../types/model';
import { localizeApiErrorMessage } from '../apiErrorLocalization';

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: unknown;
  error?: string;
  urls?: { get?: string; cancel?: string };
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const readApiError = async (response: Response): Promise<string> => {
  try {
    const data = await response.json();
    return data?.detail || data?.error?.message || data?.error || `Lỗi HTTP ${response.status}`;
  } catch {
    return `Lỗi HTTP ${response.status}`;
  }
};

const resolveProxyUrl = (url: string, apiBase: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'api.replicate.com') {
      return `${apiBase}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // URL tương đối đã có thể gọi trực tiếp qua proxy hiện tại.
  }
  return url;
};

const dataUrlSize = (dataUrl: string): number => {
  const payload = dataUrl.split(',')[1] || '';
  return Math.floor((payload.length * 3) / 4);
};

/** Tải ảnh lớn lên kho tạm Replicate để tránh vượt giới hạn data URL. */
const prepareInputFile = async (
  value: string | undefined,
  apiKey: string,
  apiBase: string,
  index: number
): Promise<string | undefined> => {
  if (!value) return undefined;
  const normalized = /^(data:|https?:\/\/|blob:)/i.test(value)
    ? value
    : `data:image/png;base64,${value}`;
  if (!normalized.startsWith('data:') || dataUrlSize(normalized) <= 750_000) return normalized;

  const blob = await fetch(normalized).then((response) => response.blob());
  const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const form = new FormData();
  form.append('content', blob, `egoric-input-${index}.${extension}`);
  form.append('type', blob.type || 'application/octet-stream');
  form.append('filename', `egoric-input-${index}.${extension}`);
  form.append('metadata', JSON.stringify({ source: 'egoric-studio' }));

  const response = await fetch(`${apiBase}/v1/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(localizeApiErrorMessage(await readApiError(response), response.status));
  }
  const file = await response.json();
  if (!file?.urls?.get) throw new Error('Replicate không trả về địa chỉ tệp đã tải lên');
  return file.urls.get;
};

const createPrediction = async (
  apiModel: string,
  input: Record<string, unknown>,
  apiKey: string,
  apiBase: string,
  customEndpoint?: string
): Promise<ReplicatePrediction> => {
  const isVersioned = apiModel.includes(':');
  const endpoint = customEndpoint
    ? customEndpoint.replace('{model}', apiModel)
    : isVersioned
      ? '/v1/predictions'
      : `/v1/models/${apiModel}/predictions`;
  const body = isVersioned && !customEndpoint ? { version: apiModel, input } : { input };
  const response = await fetch(`${apiBase}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=60',
      'Cancel-After': '20m',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(localizeApiErrorMessage(await readApiError(response), response.status));
  }
  return response.json();
};

const waitForPrediction = async (
  initial: ReplicatePrediction,
  apiKey: string,
  apiBase: string
): Promise<ReplicatePrediction> => {
  let prediction = initial;
  const deadline = Date.now() + 20 * 60 * 1000;

  while (prediction.status === 'starting' || prediction.status === 'processing') {
    if (Date.now() >= deadline) throw new Error('Tác vụ Replicate đã hết thời gian chờ 20 phút');
    await sleep(3000);
    const getUrl = prediction.urls?.get || `/v1/predictions/${prediction.id}`;
    const response = await fetch(resolveProxyUrl(getUrl, apiBase), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(localizeApiErrorMessage(await readApiError(response), response.status));
    }
    prediction = await response.json();
  }

  if (prediction.status !== 'succeeded') {
    throw new Error(prediction.error || `Tác vụ Replicate kết thúc với trạng thái ${prediction.status}`);
  }
  return prediction;
};

const extractOutputUrl = (output: unknown): string => {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    const url = output.find((item) => typeof item === 'string');
    if (url) return url;
  }
  if (output && typeof output === 'object') {
    const candidate = (output as any).url || (output as any).uri || (output as any).output;
    if (typeof candidate === 'string') return candidate;
  }
  throw new Error('Replicate không trả về địa chỉ tệp kết quả');
};

const runPrediction = async (
  apiModel: string,
  input: Record<string, unknown>,
  apiKey: string,
  apiBase: string,
  customEndpoint?: string
): Promise<string> => {
  const prediction = await createPrediction(apiModel, input, apiKey, apiBase, customEndpoint);
  const completed = await waitForPrediction(prediction, apiKey, apiBase);
  return extractOutputUrl(completed.output);
};

export const callReplicateImageApi = async (
  options: ImageGenerateOptions,
  model: ImageModelDefinition,
  apiKey: string,
  apiBase: string
): Promise<string> => {
  const references = await Promise.all(
    (options.referenceImages || []).map((image, index) =>
      prepareInputFile(image, apiKey, apiBase, index)
    )
  );
  const imageInputs = references.filter(Boolean) as string[];
  const aspectRatio = options.aspectRatio || model.params.defaultAspectRatio;
  const apiModel = model.apiModel || model.id;
  const input: Record<string, unknown> = {
    prompt: options.prompt,
    aspect_ratio: aspectRatio,
    output_format: 'png',
  };

  if (apiModel === 'google/nano-banana' && imageInputs.length) {
    input.image_input = imageInputs;
  } else if (apiModel === 'black-forest-labs/flux-kontext-pro' && imageInputs[0]) {
    input.input_image = imageInputs[0];
  } else if (imageInputs.length) {
    input.image_input = imageInputs;
  }

  return runPrediction(apiModel, input, apiKey, apiBase, model.endpoint);
};

export const callReplicateVideoApi = async (
  options: VideoGenerateOptions,
  model: VideoModelDefinition,
  apiKey: string,
  apiBase: string
): Promise<string> => {
  const [startImage, endImage] = await Promise.all([
    prepareInputFile(options.startImage, apiKey, apiBase, 0),
    prepareInputFile(options.endImage, apiKey, apiBase, 1),
  ]);
  const apiModel = model.apiModel || model.id;
  const aspectRatio = options.aspectRatio || model.params.defaultAspectRatio;
  const duration = options.duration || model.params.defaultDuration;
  const input: Record<string, unknown> = {
    prompt: options.prompt,
    aspect_ratio: aspectRatio,
    duration,
  };

  if (apiModel === 'bytedance/seedance-1-pro') {
    input.resolution = '1080p';
    input.fps = 24;
    if (startImage) input.image = startImage;
    if (endImage) input.last_frame_image = endImage;
  } else if (apiModel === 'google/veo-3') {
    input.duration = 8;
    input.resolution = '1080p';
    input.generate_audio = true;
    if (startImage) input.image = startImage;
  } else {
    if (startImage) input.image = startImage;
    if (endImage) input.last_frame_image = endImage;
  }

  return runPrediction(apiModel, input, apiKey, apiBase, model.endpoint);
};
