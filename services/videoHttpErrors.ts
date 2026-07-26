import { localizeApiErrorMessage } from './apiErrorLocalization';

export type ParsedApiError = { message?: string; type?: string; code?: string; param?: string };

export function parseOpenAIStyleErrorBody(text: string): { error?: ParsedApiError } | null {
  try {
    return JSON.parse(text) as { error?: ParsedApiError };
  } catch {
    return null;
  }
}

/** Lấy thông báo sâu nhất từ JSON hoặc đối tượng lỗi và giữ nguyên nội dung từ nền tảng. */
export function extractInnermostErrorMessage(input: unknown, depth = 0): string {
  if (depth > 10 || input == null) return '';

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return '';
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 2) {
      try {
        const inner = extractInnermostErrorMessage(JSON.parse(trimmed), depth + 1);
        if (inner) return inner;
      } catch {
        /* Chuỗi không phải JSON được xem là thông báo cuối cùng. */
      }
    }
    return trimmed;
  }

  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (obj.error) {
      const fromError = extractInnermostErrorMessage(obj.error, depth + 1);
      if (fromError) return fromError;
    }
    if (typeof obj.message === 'string') {
      const fromMsg = extractInnermostErrorMessage(obj.message, depth + 1);
      if (fromMsg) return fromMsg;
    }
  }

  return '';
}

function extractFromResponseBody(bodyText: string): string {
  const trimmed = (bodyText || '').trim();
  if (!trimmed) return '';
  const parsed = parseOpenAIStyleErrorBody(trimmed);
  return extractInnermostErrorMessage(parsed?.error ?? parsed ?? trimmed);
}

/** Lỗi yêu cầu HTTP: chỉ hiển thị thông báo sâu nhất. */
export function formatVideoRequestErrorForUser(
  status: number,
  bodyText: string,
  _mode: 'sora' | 'veo' = 'sora'
): string {
  const inner = extractFromResponseBody(bodyText);
  return localizeApiErrorMessage(inner, status);
}

/** Lỗi theo dõi tác vụ: chỉ hiển thị thông báo sâu nhất. */
export function formatVideoTaskErrorForUser(
  err: unknown,
  fallbackMessage?: string,
  _mode: 'sora' | 'veo' = 'sora'
): string {
  const inner =
    extractInnermostErrorMessage(err) ||
    extractInnermostErrorMessage(fallbackMessage);
  return localizeApiErrorMessage(inner || fallbackMessage);
}

export function throwFromVideoHttpError(status: number, bodyText: string, mode: 'sora' | 'veo' = 'sora'): never {
  throw new Error(formatVideoRequestErrorForUser(status, bodyText, mode));
}

export async function throwFromVideoResponse(res: Response, mode: 'sora' | 'veo' = 'sora'): Promise<never> {
  const text = await res.text();
  throwFromVideoHttpError(res.status, text, mode);
}
