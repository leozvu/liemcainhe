import { AspectRatio } from '../types/model';
import { localizeApiErrorMessage } from './apiErrorLocalization';

/** Các mô hình ảnh dùng giao thức OpenAI Images thay vì chat/completions. */
export const shouldUseImagesGenerationsEndpoint = (
  apiModel: string,
  customEndpoint?: string
): boolean => {
  const id = (apiModel || '').toLowerCase();
  const ep = (customEndpoint || '').toLowerCase();

  if (ep.includes('/images/generations')) return true;
  if (ep.includes('/chat/completions') || ep.includes('generatecontent')) return false;

  if (/qwen-image/i.test(id) && !/edit/i.test(id)) return true;
  if (/^dall-e|^gpt-image|^flux-/i.test(id)) return true;

  return false;
};

export const aspectRatioToImageSize = (aspectRatio: AspectRatio): string => {
  const map: Record<AspectRatio, string> = {
    '16:9': '1280x720',
    '9:16': '720x1280',
    '1:1': '1024x1024',
  };
  return map[aspectRatio] || '1024x1024';
};

const pickHttpImageUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return null;
};

const isValidBase64Payload = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.length > 80;
};

const extractDataUrlFromText = (text: string): string | null => {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (/^data:image\//i.test(trimmed)) return trimmed;
  const markdownMatch = trimmed.match(/!\[[^\]]*\]\((data:image\/[^;]+;base64,[^)]+)\)/i);
  if (markdownMatch) return markdownMatch[1];
  const anyDataMatch = trimmed.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
  if (anyDataMatch) return anyDataMatch[1];
  if (trimmed.length > 100 && /^[A-Za-z0-9+/=]+$/.test(trimmed.replace(/\s/g, ''))) {
    return `data:image/png;base64,${trimmed}`;
  }
  return null;
};

/** Trích xuất ảnh từ nhiều kiểu phản hồi của gateway. */
export const extractImageFromApiResponse = (response: unknown): string | null => {
  if (!response || typeof response !== 'object') return null;
  const r = response as Record<string, unknown>;

  const data = r.data;
  if (Array.isArray(data) && data.length > 0) {
    const item = data[0] as Record<string, unknown>;
    const itemUrl = pickHttpImageUrl(item.url);
    if (itemUrl) return itemUrl;

    if (typeof item.b64_json === 'string' && isValidBase64Payload(item.b64_json)) {
      const fromB64 =
        extractDataUrlFromText(item.b64_json) ?? `data:image/png;base64,${item.b64_json.trim()}`;
      if (fromB64 && fromB64.length > 80) return fromB64;
    }
    if (typeof item.base64 === 'string' && isValidBase64Payload(item.base64)) {
      const fromB64 =
        extractDataUrlFromText(item.base64) ?? `data:image/png;base64,${item.base64.trim()}`;
      if (fromB64 && fromB64.length > 80) return fromB64;
    }
  }

  const metadata = r.metadata as Record<string, unknown> | undefined;
  const metaOutput = metadata?.output as Record<string, unknown> | undefined;
  const metaChoices = metaOutput?.choices as Array<{ message?: { content?: unknown[] } }> | undefined;
  if (metaChoices?.[0]?.message?.content) {
    for (const part of metaChoices[0].message!.content!) {
      const p = part as Record<string, unknown>;
      const fromMeta =
        pickHttpImageUrl(p.image) ||
        pickHttpImageUrl(p.url) ||
        (typeof p.image === 'string' ? extractDataUrlFromText(p.image) : null);
      if (fromMeta) return fromMeta;
    }
  }

  const choices = r.choices as Array<{ message?: Record<string, unknown> }> | undefined;
  if (choices?.length) {
    const msg = choices[0].message;
    if (!msg) return null;

    const images = msg.images;
    if (Array.isArray(images)) {
      for (const img of images) {
        const rec = img as Record<string, unknown>;
        const url =
          (rec.url as string) ||
          (rec.image_url as { url?: string })?.url ||
          (rec.b64_json as string);
        if (typeof url === 'string' && url) {
          const parsed = extractDataUrlFromText(url) ?? (url.startsWith('http') ? url : null);
          if (parsed) return parsed;
        }
      }
    }

    const content = msg.content;
    if (typeof content === 'string') {
      const parsed =
        extractDataUrlFromText(content) ??
        (content.length > 100 ? `data:image/png;base64,${content}` : null);
      if (parsed) return parsed;
    }
    if (Array.isArray(content)) {
      for (const item of content) {
        const part = item as Record<string, unknown>;
        if (part.type === 'image_url') {
          const url = (part.image_url as { url?: string })?.url;
          if (url) {
            return url.startsWith('data:') ? url : `data:image/png;base64,${url}`;
          }
        }
        if (part.type === 'image' || part.image !== undefined) {
          const fromPart =
            pickHttpImageUrl(part.image) ||
            (typeof part.image === 'string' ? extractDataUrlFromText(part.image) : null);
          if (fromPart) return fromPart;
        }
      }
    }
  }

  const candidates = r.candidates as Array<{ content?: { parts?: unknown[] } }> | undefined;
  if (candidates?.[0]?.content?.parts) {
    for (const part of candidates[0].content!.parts!) {
      const p = part as Record<string, unknown>;
      const inline = p.inlineData as { data?: string } | undefined;
      if (inline?.data) {
        return `data:image/png;base64,${inline.data}`;
      }
    }
  }

  return null;
};

export const urlToImageDataUrl = async (url: string): Promise<string> => {
  if (url.startsWith('data:image/')) return url;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Tải ảnh thất bại: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      if (result?.startsWith('data:')) resolve(result);
      else reject(new Error('Chuyển đổi hình ảnh thất bại'));
    };
    reader.onerror = () => reject(new Error('Không thể đọc hình ảnh'));
    reader.readAsDataURL(blob);
  });
};

export const normalizeImageResult = async (raw: string): Promise<string> => {
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      return await urlToImageDataUrl(raw);
    } catch (e) {
      // Một số liên kết ảnh ngoài không cho phép tải bằng fetch do CORS nhưng vẫn hiển thị được qua img.
      console.warn('Không thể chuyển ảnh sang base64, sẽ hiển thị URL gốc:', e);
      return raw;
    }
  }
  if (raw.startsWith('data:image/') && raw.length < 100) {
    throw new Error('Dữ liệu hình ảnh không hợp lệ (base64 trống)');
  }
  return raw;
};

export const callImagesGenerationsApi = async (params: {
  apiBase: string;
  apiKey: string;
  model: string;
  prompt: string;
  aspectRatio: AspectRatio;
}): Promise<string> => {
  const res = await fetch(`${params.apiBase.replace(/\/+$/, '')}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      prompt: params.prompt,
      n: 1,
      response_format: 'b64_json',
      size: aspectRatioToImageSize(params.aspectRatio),
    }),
  });

  if (!res.ok) {
    let errorMessage = `Tạo ảnh thất bại: HTTP ${res.status}`;
    try {
      const errBody = await res.json();
      errorMessage = (errBody as { error?: { message?: string } }).error?.message || errorMessage;
    } catch {
      const text = await res.text();
      if (text) errorMessage = text;
    }
    throw new Error(localizeApiErrorMessage(errorMessage, res.status));
  }

  const data = await res.json();
  const extracted = extractImageFromApiResponse(data);
  if (!extracted) {
    throw new Error(
      `Tạo ảnh thất bại: /v1/images/generations của model ${params.model} không trả về dữ liệu. Hãy kiểm tra tên model và quyền tài khoản.`
    );
  }
  return normalizeImageResult(extracted);
};
