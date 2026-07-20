import { ProjectState } from '../types';
import { recordUsage } from './usageService';

export interface CloudProjectMetadata {
  id: string;
  title: string;
  updatedAt: number;
}

interface MediaTask {
  path: string;
  dataUrl: string;
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

const uploadDataUrl = async (projectId: string, task: MediaTask): Promise<string> => {
  const blob = await fetch(task.dataUrl).then((response) => response.blob());
  const response = await fetch(`/api/cloud/media?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(task.path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Không thể tải media lên cloud (${response.status})`);
  }
  const payload = await response.json();
  return payload.url as string;
};

const collectMediaTasks = (project: ProjectState): { clone: ProjectState; tasks: MediaTask[] } => {
  const clone = structuredClone(project);
  const tasks: MediaTask[] = [];
  const add = (value: string | undefined, path: string, apply: (url: string) => void) => {
    if (!value?.startsWith('data:')) return;
    tasks.push({ path, dataUrl: value, apply });
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
      const url = await uploadDataUrl(project.id, task);
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
