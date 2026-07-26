function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Mã tài nguyên dùng được cho /v1/videos/{id}/content (loại trừ mã giữ chỗ task/video_task). */
export function isSoraVideoAssetId(id: string | null | undefined): boolean {
  if (!id) return false;
  if (id.startsWith('video_task_') || id.startsWith('task_')) return false;
  return id.startsWith('video_');
}

export function isTaskPlaceholderVideoId(id: string | null | undefined): boolean {
  if (!id) return false;
  return id.startsWith('task_') || id.startsWith('video_task_');
}

function firstVideoAssetId(candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (c && isSoraVideoAssetId(c)) return c;
  }
  return null;
}

export function resolveSoraVideoDownloadId(statusData: Record<string, unknown>): string | null {
  const outputs = statusData.outputs;
  const outIds: string[] = [];
  if (Array.isArray(outputs)) {
    for (const item of outputs) {
      const s = asString(item);
      if (s && !s.startsWith('http')) outIds.push(s);
      else if (item && typeof item === 'object' && item !== null) {
        const id = asString((item as Record<string, unknown>).id);
        if (id) outIds.push(id);
      }
    }
  }

  const videoObj = statusData.video;
  const videoNestedId =
    videoObj && typeof videoObj === 'object' && videoObj !== null
      ? asString((videoObj as Record<string, unknown>).id)
      : null;

  const result = statusData.result;
  let resultId: string | null = null;
  if (result && typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>;
    resultId = asString(r.video_id) || asString(r.id) || asString(r.file_id);
    if (resultId && isTaskPlaceholderVideoId(resultId)) resultId = null;
  }

  const preferred = firstVideoAssetId([
    videoNestedId,
    asString(statusData.video_id),
    asString(statusData.output_video),
    ...outIds,
    resultId,
  ]);

  if (preferred) return preferred;

  const rawId = asString(statusData.id);
  if (rawId && isSoraVideoAssetId(rawId)) return rawId;

  return null;
}

function looksLikeVideoUrl(url: string): boolean {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (/\.mp4/i.test(u)) return true;
  if (/replicate\.delivery|amazonaws/i.test(u)) {
    return true;
  }
  if (/\/videos?\//i.test(u) || /\/object\//i.test(u) || /\/download/i.test(u)) return true;
  return false;
}

function extractVideoUrlByRegex(source: unknown): string | null {
  let text: string;
  try {
    text = typeof source === 'string' ? source : JSON.stringify(source);
  } catch {
    return null;
  }
  text = text.replace(/\\\//g, '/');
  const matches = text.match(/https?:\/\/[^"'\\\s<>]+/gi) || [];
  for (let m of matches) {
    m = m.replace(/[,}\]]+$/, '').replace(/\\+$/, '');
    if (looksLikeVideoUrl(m)) return m;
  }
  return null;
}

function walkExtractVideoUrl(root: unknown, depth: number): string | null {
  if (depth > 16 || root == null) return null;

  if (typeof root === 'string') {
    const s = root.trim();
    if (looksLikeVideoUrl(s)) return s;
    if ((s.startsWith('{') || s.startsWith('[')) && s.length > 2) {
      try {
        return walkExtractVideoUrl(JSON.parse(s), depth + 1);
      } catch {
        return null;
      }
    }
    return null;
  }

  if (Array.isArray(root)) {
    for (const item of root) {
      const u = walkExtractVideoUrl(item, depth + 1);
      if (u) return u;
    }
    return null;
  }

  if (typeof root === 'object') {
    const obj = root as Record<string, unknown>;
    const priorityKeys = [
      'result_url',
      'video_url',
      'download_url',
      'url',
      'file_url',
      'output_url',
      'play_url',
      'signed_url',
      'presigned_url',
      'resource_url',
      'href',
      'link',
    ];
    for (const key of priorityKeys) {
      const v = asString(obj[key]);
      if (v && looksLikeVideoUrl(v)) return v.trim();
    }
    for (const v of Object.values(obj)) {
      const u = walkExtractVideoUrl(v, depth + 1);
      if (u) return u;
    }
  }

  return null;
}

/** Quét sâu và dùng biểu thức chính quy dự phòng để lấy liên kết video HTTPS từ JSON trạng thái. */
export function extractAnyVideoDownloadUrl(root: unknown): string | null {
  const fromWalk = walkExtractVideoUrl(root, 0);
  if (fromWalk) return fromWalk;
  return extractVideoUrlByRegex(root);
}

/** @deprecated Dùng extractAnyVideoDownloadUrl. */
export function extractSoraDirectVideoUrl(statusData: Record<string, unknown>): string | null {
  return extractAnyVideoDownloadUrl(statusData);
}

export async function fetchVideoUrlAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const r = reader.result as string;
      if (r && r.startsWith('data:')) resolve(r);
      else reject(new Error('Chuyển video sang base64 thất bại'));
    };
    reader.onerror = () => reject(new Error('Đọc video thất bại'));
    reader.readAsDataURL(blob);
  });
}

async function resolveVideoStorageUrl(directUrl: string): Promise<string> {
  try {
    return await fetchVideoUrlAsDataUrl(directUrl);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('Không thể chuyển liên kết video sang base64; sẽ lưu URL từ xa để phát:', msg);
    return directUrl;
  }
}

export function encodeVideoPathId(id: string): string {
  return encodeURIComponent(id).replace(/%3A/gi, ':');
}

async function fetchTaskStatus(
  apiBase: string,
  taskId: string,
  apiKey: string
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${apiBase}/v1/videos/${encodeVideoPathId(taskId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Liên kết trực tiếp có thể xuất hiện muộn vài giây; thăm dò đến khi có URL hoặc hết thời gian chờ. */
async function pollStatusForVideoUrl(
  apiBase: string,
  taskId: string,
  apiKey: string,
  initial: Record<string, unknown> | null,
  maxAttempts = 10,
  intervalMs = 2000
): Promise<{ url: string | null; status: Record<string, unknown> | null }> {
  let latest: Record<string, unknown> | null = initial;

  for (let i = 0; i < maxAttempts; i++) {
    if (latest) {
      const url = extractAnyVideoDownloadUrl(latest);
      if (url) return { url, status: latest };
    }
    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
      latest = await fetchTaskStatus(apiBase, taskId, apiKey);
    }
  }

  return { url: null, status: latest };
}

async function blobResponseToDataUrl(downloadResponse: Response): Promise<string> {
  const contentType = downloadResponse.headers.get('content-type') || '';
  if (contentType.includes('video') || contentType.includes('octet-stream')) {
    const videoBlob = await downloadResponse.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        if (result && result.startsWith('data:')) resolve(result);
        else reject(new Error('Chuyển đổi video thất bại'));
      };
      reader.onerror = () => reject(new Error('Đọc video thất bại'));
      reader.readAsDataURL(videoBlob);
    });
  }

  const text = await downloadResponse.text();
  let downloadData: Record<string, unknown>;
  try {
    downloadData = JSON.parse(text) as Record<string, unknown>;
  } catch {
    const fromText = extractAnyVideoDownloadUrl(text);
    if (fromText) return resolveVideoStorageUrl(fromText);
    throw new Error(text || 'Không lấy được địa chỉ tải video');
  }

  const nestedUrl = extractAnyVideoDownloadUrl(downloadData);
  if (nestedUrl) return resolveVideoStorageUrl(nestedUrl);

  throw new Error('Không lấy được địa chỉ tải video');
}

async function tryDownloadContentUrl(
  contentUrl: string,
  apiKey: string,
  signal: AbortSignal
): Promise<string> {
  const downloadResponse = await fetch(contentUrl, {
    method: 'GET',
    headers: { Accept: '*/*', Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!downloadResponse.ok) {
    const errText = await downloadResponse.text().catch(() => '');
    const nestedUrl = extractAnyVideoDownloadUrl(errText);
    if (nestedUrl) return resolveVideoStorageUrl(nestedUrl);
    throw new Error(`HTTP ${downloadResponse.status}`);
  }
  return blobResponseToDataUrl(downloadResponse);
}

function buildContentDownloadUrls(
  apiBase: string,
  taskId: string,
  videoAssetId: string | null
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const add = (path: string) => {
    const full = `${apiBase}${path}`;
    if (!seen.has(full)) {
      seen.add(full);
      urls.push(full);
    }
  };

  if (videoAssetId && isSoraVideoAssetId(videoAssetId)) {
    add(`/v1/videos/${encodeVideoPathId(videoAssetId)}/content`);
  }
  if (taskId) {
    add(`/v1/videos/${encodeVideoPathId(taskId)}/content`);
  }
  return urls;
}

export async function downloadSoraCompletedVideo(options: {
  apiBase: string;
  apiKey: string;
  taskId: string;
  completedStatus: Record<string, unknown> | null;
  initialVideoId?: string | null;
}): Promise<string> {
  const { apiBase, apiKey, taskId, completedStatus } = options;
  let videoAssetId = options.initialVideoId || null;

  const { url: directUrl, status: latestStatus } = await pollStatusForVideoUrl(
    apiBase,
    taskId,
    apiKey,
    completedStatus
  );

  if (directUrl) {
    console.log('📥 Đang dùng liên kết video do tác vụ trả về');
    return resolveVideoStorageUrl(directUrl);
  }

  if (!videoAssetId && latestStatus) {
    videoAssetId = resolveSoraVideoDownloadId(latestStatus);
  }
  if (isTaskPlaceholderVideoId(videoAssetId)) {
    videoAssetId = null;
  }

  const contentUrls = buildContentDownloadUrls(apiBase, taskId, videoAssetId);

  if (contentUrls.length === 0) {
    console.warn('[video] Mẫu trạng thái tác vụ:', latestStatus || completedStatus);
    throw new Error(
      'Tác vụ đã hoàn tất nhưng không phân tích được địa chỉ video. Hãy mở phản hồi GET của tác vụ trong Network, kiểm tra liên kết MP4 HTTPS hoặc gửi JSON cho đội phát triển.'
    );
  }

  const maxDownloadRetries = 4;
  const downloadTimeout = 600000;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxDownloadRetries; attempt++) {
    for (const contentUrl of contentUrls) {
      try {
        const downloadController = new AbortController();
        const downloadTimeoutId = setTimeout(() => downloadController.abort(), downloadTimeout);
        const dataUrl = await tryDownloadContentUrl(contentUrl, apiKey, downloadController.signal);
        clearTimeout(downloadTimeoutId);
        return dataUrl;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    const { url: url2 } = await pollStatusForVideoUrl(apiBase, taskId, apiKey, null, 3, 2000);
    if (url2) {
      console.log('📥 Đã tìm thấy liên kết trực tiếp trong lần thử lại');
      return resolveVideoStorageUrl(url2);
    }

    if (attempt < maxDownloadRetries) {
      console.warn(`Tải nội dung thất bại, thử lại sau ${5 * attempt} giây...`, lastError?.message);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }

  const lastMsg = lastError?.message || '';
  if (/502|404/.test(lastMsg)) {
    throw new Error(
      `${lastMsg}. Điểm cuối /content không khả dụng và phản hồi tác vụ không chứa liên kết MP4 có thể nhận diện. Hãy gửi JSON phản hồi của API truy vấn tác vụ để đội phát triển bổ sung tương thích.`
    );
  }

  throw lastError || new Error('Tải video thất bại: đã đạt số lần thử lại tối đa');
}
