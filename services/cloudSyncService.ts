import { ProjectState } from '../types';
import { recordUsage } from './usageService';

export interface CloudProjectMetadata {
  id: string;
  title: string;
  updatedAt: number;
}

interface MediaTask {
  path: string;
  sourceUrl: string;
  apply: (url: string) => void;
}

const safeSegment = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 90) || 'asset';

const extensionForDataUrl = (dataUrl: string, fallback: string) => {
  const mime = dataUrl.match(/^data:([^;,]+)/)?.[1] || '';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('mp4')) return 'mp4';
  return fallback;
};

const MULTIPART_THRESHOLD = 8 * 1024 * 1024;
const PART_SIZE = 8 * 1024 * 1024;

export const createBlobChecksum = async (blob: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
};

const fetchWithRetry = async (input: RequestInfo | URL, init: RequestInit, attempts = 3): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (response.ok || response.status < 500 || attempt === attempts) return response;
      lastError = new Error(`Máy chủ media tạm thời lỗi (${response.status})`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
  }
  throw lastError instanceof Error ? lastError : new Error('Không thể tải media');
};

const uploadMediaSource = async (projectId: string, task: MediaTask): Promise<string> => {
  if (task.sourceUrl.startsWith('https://')) {
    const response = await fetch('/api/cloud/media/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, path: task.path, sourceUrl: task.sourceUrl }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Không thể nhập media từ nhà cung cấp (${response.status})`);
    return payload.url as string;
  }
  const sourceResponse = await fetch(task.sourceUrl);
  if (!sourceResponse.ok) throw new Error(`Không thể tải media nguồn (${sourceResponse.status})`);
  const blob = await sourceResponse.blob();
  const contentType = blob.type || 'application/octet-stream';
  const checksum = await createBlobChecksum(blob);
  const initResponse = await fetch('/api/cloud/media/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      path: task.path,
      contentType,
      size: blob.size,
      checksum,
      multipart: blob.size > MULTIPART_THRESHOLD,
    }),
  });
  if (!initResponse.ok) {
    const payload = await initResponse.json().catch(() => ({}));
    throw new Error(payload.error || `Không thể chuẩn bị upload media (${initResponse.status})`);
  }
  const session = await initResponse.json();
  if (session.skipped) return session.url as string;

  if (!session.uploadId) {
    const response = await fetchWithRetry(`/api/cloud/media?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(task.path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'x-egoric-checksum': checksum, 'x-egoric-size': String(blob.size) },
      body: blob,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Không thể tải media lên cloud (${response.status})`);
    }
    return (await response.json()).url as string;
  }

  const parts: Array<{ partNumber: number; etag: string }> = [];
  try {
    for (let offset = 0, partNumber = 1; offset < blob.size; offset += PART_SIZE, partNumber += 1) {
      const response = await fetchWithRetry(
        `/api/cloud/media/uploads/${encodeURIComponent(session.uploadId)}/parts/${partNumber}?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(task.path)}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: blob.slice(offset, Math.min(blob.size, offset + PART_SIZE)) },
      );
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Upload phần ${partNumber} thất bại`);
      parts.push(await response.json());
    }
    const complete = await fetch(`/api/cloud/media/uploads/${encodeURIComponent(session.uploadId)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, path: task.path, contentType, size: blob.size, checksum, parts }),
    });
    if (!complete.ok) throw new Error((await complete.json().catch(() => ({}))).error || 'Không thể hoàn tất upload media');
    return (await complete.json()).url as string;
  } catch (error) {
    void fetch(`/api/cloud/media/uploads/${encodeURIComponent(session.uploadId)}/complete?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(task.path)}`, { method: 'DELETE' });
    throw error;
  }
};

export const collectCloudMediaPaths = (projectId: string, value: unknown): string[] => {
  const prefix = `/api/cloud/media/${encodeURIComponent(projectId)}/`;
  const paths = new Set<string>();
  const visit = (current: unknown) => {
    if (typeof current === 'string' && current.startsWith(prefix)) {
      paths.add(current.slice(prefix.length).split('/').map(decodeURIComponent).join('/'));
      return;
    }
    if (Array.isArray(current)) current.forEach(visit);
    else if (current && typeof current === 'object') Object.values(current as Record<string, unknown>).forEach(visit);
  };
  visit(value);
  return Array.from(paths);
};

export const shouldUploadCloudMedia = (projectId: string, value?: string): boolean => {
  if (!value) return false;
  const cloudPrefix = `/api/cloud/media/${encodeURIComponent(projectId)}/`;
  if (value.startsWith(cloudPrefix)) return false;
  return value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('https://');
};

const collectMediaTasks = (project: ProjectState): { clone: ProjectState; tasks: MediaTask[] } => {
  const clone = structuredClone(project);
  const tasks: MediaTask[] = [];
  const add = (value: string | undefined, path: string, apply: (url: string) => void) => {
    if (!value || !shouldUploadCloudMedia(project.id, value)) return;
    tasks.push({ path, sourceUrl: value, apply });
  };

  clone.scriptData?.characters.forEach((character, charIndex) => {
    add(character.referenceImage, `characters/${safeSegment(character.id)}.${extensionForDataUrl(character.referenceImage || '', 'jpg')}`, (url) => {
      clone.scriptData!.characters[charIndex].referenceImage = url;
    });
    character.variations?.forEach((variation, variationIndex) => {
      add(variation.referenceImage, `characters/${safeSegment(character.id)}_${safeSegment(variation.id)}.${extensionForDataUrl(variation.referenceImage || '', 'jpg')}`, (url) => {
        clone.scriptData!.characters[charIndex].variations[variationIndex].referenceImage = url;
      });
    });
  });

  clone.scriptData?.scenes.forEach((scene, sceneIndex) => {
    add(scene.referenceImage, `scenes/${safeSegment(scene.id)}.${extensionForDataUrl(scene.referenceImage || '', 'jpg')}`, (url) => {
      clone.scriptData!.scenes[sceneIndex].referenceImage = url;
    });
  });

  clone.shots.forEach((shot, shotIndex) => {
    shot.keyframes?.forEach((keyframe, keyframeIndex) => {
      add(keyframe.imageUrl, `shots/${safeSegment(shot.id)}_${keyframe.type}.${extensionForDataUrl(keyframe.imageUrl || '', 'jpg')}`, (url) => {
        clone.shots[shotIndex].keyframes[keyframeIndex].imageUrl = url;
      });
    });
    add(shot.interval?.videoUrl, `video/${safeSegment(shot.id)}.${extensionForDataUrl(shot.interval?.videoUrl || '', 'mp4')}`, (url) => {
      if (clone.shots[shotIndex].interval) clone.shots[shotIndex].interval!.videoUrl = url;
    });
  });

  clone.voiceStudio?.takes.forEach((take, takeIndex) => {
    add(take.audioUrl, `voice/${safeSegment(take.shotId)}_${safeSegment(take.id)}.${extensionForDataUrl(take.audioUrl || '', 'mp3')}`, (url) => {
      if (clone.voiceStudio) clone.voiceStudio.takes[takeIndex].audioUrl = url;
    });
  });

  clone.brandKitSnapshot?.assets.forEach((asset, assetIndex) => {
    add(asset.url, `brand/${safeSegment(asset.id)}.${extensionForDataUrl(asset.url || '', 'png')}`, (url) => {
      if (clone.brandKitSnapshot) clone.brandKitSnapshot.assets[assetIndex].url = url;
    });
  });

  add(clone.autoEditor?.settings.musicUrl, `editor/music.${extensionForDataUrl(clone.autoEditor?.settings.musicUrl || '', 'mp3')}`, (url) => {
    if (clone.autoEditor) clone.autoEditor.settings.musicUrl = url;
  });

  // Checkpoints remain a lightweight local safety net. Cloud stores the current
  // authoritative project state and avoids duplicating several generations of blobs.
  if (clone.workflow) clone.workflow.checkpoints = [];
  return { clone, tasks };
};

export const syncProjectToCloud = async (
  project: ProjectState,
  onProgress?: (progress: number, detail: string) => void,
): Promise<ProjectState> => {
  const { clone, tasks } = collectMediaTasks(project);
  let completed = 0;
  onProgress?.(4, tasks.length ? `Đang chuẩn bị ${tasks.length} tệp media…` : 'Đang chuẩn bị dữ liệu dự án…');

  for (let index = 0; index < tasks.length; index += 3) {
    const batch = tasks.slice(index, index + 3);
    await Promise.all(batch.map(async (task) => {
      const url = await uploadMediaSource(project.id, task);
      task.apply(url);
      completed += 1;
      onProgress?.(5 + Math.round((completed / Math.max(1, tasks.length)) * 80), `Đang tải media ${completed}/${tasks.length}…`);
    }));
  }

  const syncedAt = Date.now();
  clone.workflow = {
    ...(clone.workflow || { jobs: [], checkpoints: [] }),
    checkpoints: [],
    lastCloudSyncAt: syncedAt,
    cloudSyncStatus: 'synced',
    cloudSyncError: undefined,
  };
  onProgress?.(90, 'Đang lưu trạng thái sản xuất…');
  const response = await fetch(`/api/cloud/projects/${encodeURIComponent(project.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(clone),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Không thể đồng bộ dự án (${response.status})`);
  }
  onProgress?.(96, 'Đang dọn media không còn sử dụng…');
  const cleanupResponse = await fetch('/api/cloud/media/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: project.id, usedPaths: collectCloudMediaPaths(project.id, clone) }),
  });
  if (!cleanupResponse.ok && cleanupResponse.status !== 401) {
    console.warn('Không thể dọn media mồ côi; dự án vẫn đã được sao lưu.');
  }
  onProgress?.(100, 'Đã sao lưu dự án và media.');
  recordUsage({ kind: 'cloud', modelId: 'Egoric Cloud', inputSize: tasks.length, status: 'success' });
  return clone;
};

export const listCloudProjects = async (): Promise<CloudProjectMetadata[]> => {
  const response = await fetch('/api/cloud/projects');
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Không thể tải danh sách dự án cloud');
  }
  const payload = await response.json();
  return payload.projects || [];
};

export const loadCloudProject = async (projectId: string): Promise<ProjectState> => {
  const response = await fetch(`/api/cloud/projects/${encodeURIComponent(projectId)}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Không thể tải dự án cloud');
  }
  const payload = await response.json();
  return payload.project as ProjectState;
};

export const deleteCloudProject = async (projectId: string): Promise<void> => {
  const response = await fetch(`/api/cloud/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Không thể xóa bản sao cloud');
  }
};
