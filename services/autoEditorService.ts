import {
  AspectRatio,
  AutoEditorCaptionCue,
  AutoEditorOutput,
  AutoEditorOutputStatus,
  AutoEditorSettings,
  AutoEditorState,
  AutoEditorTimelineClip,
  ProjectState,
  Shot,
  VideoFactoryVariant,
  VoiceTake,
} from '../types';
import {
  addProductionJob,
  createProductionJob,
  createProjectCheckpoint,
  patchProductionJob,
} from './workflowService';

const createId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export interface AutoEditorSource {
  id: string;
  label: string;
  detail: string;
  shotCount: number;
  readyCount: number;
  variant?: VideoFactoryVariant;
}

export interface AutoEditorPreflightIssue {
  id: string;
  severity: 'warning' | 'blocked';
  label: string;
  detail: string;
  shotId?: string;
}

export const createDefaultAutoEditorState = (project?: ProjectState): AutoEditorState => {
  const now = Date.now();
  const logo = project?.brandKitSnapshot?.assets.find((asset) => asset.type === 'logo' && asset.url);
  return {
    settings: {
      sourceId: 'master',
      aspectRatios: ['9:16'],
      includeVoice: true,
      captionsEnabled: true,
      captionStyle: 'bold',
      transition: 'cut',
      colorPreset: 'natural',
      logoEnabled: Boolean(logo),
      logoAssetId: logo?.id,
      logoPosition: 'top-right',
      logoSizePercent: 14,
      musicEnabled: false,
      musicVolume: 0.16,
      duckingDb: -12,
      fps: 25,
    },
    timeline: [],
    captions: [],
    outputs: [],
    updatedAt: now,
  };
};

export const normalizeAutoEditorState = (
  value?: Partial<AutoEditorState> | null,
  project?: ProjectState,
): AutoEditorState => {
  const defaults = createDefaultAutoEditorState(project);
  if (!value) return defaults;
  const settings = { ...defaults.settings, ...(value.settings || {}) };
  const ratios = (Array.isArray(settings.aspectRatios) ? settings.aspectRatios : defaults.settings.aspectRatios)
    .filter((ratio): ratio is AspectRatio => ['9:16', '1:1', '16:9'].includes(ratio));
  return {
    ...defaults,
    ...value,
    settings: {
      ...settings,
      aspectRatios: ratios.length ? Array.from(new Set(ratios)) : defaults.settings.aspectRatios,
      logoSizePercent: clamp(Number(settings.logoSizePercent) || defaults.settings.logoSizePercent, 6, 30),
      musicVolume: clamp(Number(settings.musicVolume) || 0, 0, 1),
      duckingDb: clamp(Number(settings.duckingDb) || defaults.settings.duckingDb, -30, -3),
      fps: settings.fps === 30 ? 30 : 25,
    },
    timeline: Array.isArray(value.timeline) ? value.timeline : [],
    captions: Array.isArray(value.captions) ? value.captions : [],
    outputs: Array.isArray(value.outputs) ? value.outputs : [],
    updatedAt: Number(value.updatedAt) || now(),
  };
};

const now = (): number => Date.now();

const sourceShots = (project: ProjectState, sourceId: string): Shot[] => {
  if (sourceId !== 'master') return project.shots.filter((shot) => shot.factory?.variantId === sourceId);
  const baseShots = project.shots.filter((shot) => !shot.factory);
  const byId = new Map(baseShots.map((shot) => [shot.id, shot]));
  const ordered: Shot[] = [];
  const included = new Set<string>();
  (project.creativeDirector?.timeline || []).forEach((entry) => {
    const shot = byId.get(entry.shotId);
    if (!shot || included.has(shot.id)) return;
    ordered.push(shot);
    included.add(shot.id);
  });
  baseShots.forEach((shot) => {
    if (!included.has(shot.id)) ordered.push(shot);
  });
  return ordered;
};

const selectedVoiceTake = (project: ProjectState, shotId: string): VoiceTake | undefined => {
  const takeId = project.voiceStudio?.selectedTakeByShot[shotId];
  return project.voiceStudio?.takes.find((take) => take.id === takeId && take.status === 'ready' && take.audioUrl);
};

export const getAutoEditorSources = (project: ProjectState): AutoEditorSource[] => {
  const base = sourceShots(project, 'master');
  const variants = project.videoFactory?.variants || [];
  return [
    {
      id: 'master',
      label: 'Bản chính',
      detail: 'Storyboard gốc theo timeline của Trợ lý đạo diễn',
      shotCount: base.length,
      readyCount: base.filter((shot) => shot.interval?.videoUrl && !shot.workflow?.videoStale).length,
    },
    ...variants.filter((variant) => variant.shotIds.length).map((variant) => {
      const shots = sourceShots(project, variant.id);
      return {
        id: variant.id,
        label: variant.name,
        detail: `${variant.audience || 'Tệp chính'} · ${variant.duration}s · ${variant.voiceMode === 'with-voice' ? 'Có voice' : 'Không voice'}`,
        shotCount: shots.length,
        readyCount: shots.filter((shot) => shot.interval?.videoUrl && !shot.workflow?.videoStale).length,
        variant,
      };
    }),
  ];
};

const buildTimeline = (project: ProjectState, settings: AutoEditorSettings): AutoEditorTimelineClip[] => {
  let offset = 0;
  return sourceShots(project, settings.sourceId).map((shot, index) => {
    const duration = Math.max(1, Number(shot.interval?.duration) || 8);
    const take = settings.includeVoice ? selectedVoiceTake(project, shot.id) : undefined;
    const clip: AutoEditorTimelineClip = {
      id: `editor_clip_${shot.id}`,
      shotId: shot.id,
      order: index,
      offset,
      duration,
      videoUrl: shot.interval?.videoUrl,
      voiceTakeId: take?.id,
      dialogue: shot.dialogue?.trim() || undefined,
      transition: index === 0 ? 'cut' : settings.transition,
    };
    offset += duration;
    return clip;
  });
};

const splitCaptionText = (text: string): string[] => {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [];
  const chunks: string[] = [];
  let current: string[] = [];
  words.forEach((word) => {
    current.push(word);
    const punctuationBreak = /[.!?…,:;]$/.test(word) && current.length >= 3;
    if (current.length >= 7 || punctuationBreak) {
      chunks.push(current.join(' '));
      current = [];
    }
  });
  if (current.length) chunks.push(current.join(' '));
  return chunks;
};

const buildCaptions = (timeline: AutoEditorTimelineClip[]): AutoEditorCaptionCue[] => timeline.flatMap((clip) => {
  if (!clip.dialogue) return [];
  const chunks = splitCaptionText(clip.dialogue);
  const totalWords = chunks.reduce((sum, chunk) => sum + chunk.split(' ').length, 0);
  let cursor = clip.offset;
  return chunks.map((text, index) => {
    const share = text.split(' ').length / Math.max(1, totalWords);
    const availableEnd = clip.offset + clip.duration;
    const end = index === chunks.length - 1 ? availableEnd : Math.min(availableEnd, cursor + Math.max(0.8, clip.duration * share));
    const cue: AutoEditorCaptionCue = {
      id: `caption_${clip.shotId}_${index}`,
      shotId: clip.shotId,
      start: Number(cursor.toFixed(3)),
      end: Number(Math.max(cursor + 0.3, end).toFixed(3)),
      text,
    };
    cursor = cue.end;
    return cue;
  });
});

const getLogoUrl = (project: ProjectState, settings: AutoEditorSettings): string | undefined => {
  if (!settings.logoEnabled) return undefined;
  return project.brandKitSnapshot?.assets.find((asset) => asset.id === settings.logoAssetId && asset.type === 'logo')?.url
    || project.brandKitSnapshot?.assets.find((asset) => asset.type === 'logo' && asset.url)?.url;
};

export const getAutoEditorLogoUrl = (project: ProjectState): string | undefined => {
  const state = normalizeAutoEditorState(project.autoEditor, project);
  return getLogoUrl(project, state.settings);
};

const editorSignature = (project: ProjectState, settings: AutoEditorSettings, timeline?: AutoEditorTimelineClip[]): string => {
  const clips = timeline || buildTimeline(project, settings);
  const data = JSON.stringify({
    settings,
    logo: getLogoUrl(project, settings),
    clips: clips.map((clip) => ({
      shotId: clip.shotId,
      duration: clip.duration,
      videoUrl: clip.videoUrl,
      dialogue: clip.dialogue,
      voiceTakeId: clip.voiceTakeId,
      voiceUrl: clip.voiceTakeId ? project.voiceStudio?.takes.find((take) => take.id === clip.voiceTakeId)?.audioUrl : undefined,
    })),
  });
  let hash = 5381;
  for (let index = 0; index < data.length; index += 1) hash = ((hash << 5) + hash) ^ data.charCodeAt(index);
  return (hash >>> 0).toString(36);
};

const safeFileName = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 70) || 'egoric-video';

export const updateAutoEditorSettings = (project: ProjectState, updates: Partial<AutoEditorSettings>): ProjectState => {
  const state = normalizeAutoEditorState(project.autoEditor, project);
  return {
    ...project,
    autoEditor: {
      ...state,
      settings: { ...state.settings, ...updates },
      updatedAt: now(),
    },
  };
};

export const createAutoEditorPlan = (project: ProjectState): ProjectState => {
  const state = normalizeAutoEditorState(project.autoEditor, project);
  const timeline = buildTimeline(project, state.settings);
  if (!timeline.length) throw new Error('Nguồn đã chọn chưa có shot để dựng.');
  const captions = state.settings.captionsEnabled ? buildCaptions(timeline) : [];
  const signature = editorSignature(project, state.settings, timeline);
  const totalDuration = timeline.reduce((sum, clip) => sum + clip.duration, 0);
  const timestamp = now();
  const outputs = state.settings.aspectRatios.map((aspectRatio, index): AutoEditorOutput => {
    const existing = state.outputs.find((output) => output.aspectRatio === aspectRatio);
    const ratioName = aspectRatio.replace(':', 'x');
    const samePlan = state.planSignature === signature;
    return {
      id: existing?.id || createId('editor_output'),
      name: `${index === 0 ? 'Master' : 'Biến thể'} ${aspectRatio}`,
      aspectRatio,
      status: samePlan && existing ? existing.status : 'planned',
      fileName: `${safeFileName(project.title)}-${ratioName}.mp4`,
      estimatedRenderMinutes: Number(Math.max(0.5, (totalDuration / 60) * (aspectRatio === '9:16' ? 1.35 : 1.15) + timeline.length * 0.08).toFixed(1)),
      error: samePlan ? existing?.error : undefined,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
  });
  const job = createProductionJob({
    kind: 'auto-editor',
    stage: 'export',
    label: 'Auto Editor · Lập timeline',
    totalUnits: timeline.length,
    resourceId: `editor_plan_${signature}`,
    detail: `Đã lập ${timeline.length} clip, ${captions.length} cue phụ đề và ${outputs.length} đầu ra. Chưa render, không gọi API.`,
  });
  const withJob = addProductionJob(project, {
    ...job,
    status: 'completed',
    progress: 100,
    completedUnits: timeline.length,
  });
  return {
    ...withJob,
    autoEditor: {
      ...state,
      timeline,
      captions,
      outputs,
      planSignature: signature,
      lastPlannedAt: timestamp,
      updatedAt: timestamp,
    },
  };
};

export const getAutoEditorPreflight = (project: ProjectState): AutoEditorPreflightIssue[] => {
  const state = normalizeAutoEditorState(project.autoEditor, project);
  const timeline = state.timeline.length ? state.timeline : buildTimeline(project, state.settings);
  const shotMap = new Map(project.shots.map((shot) => [shot.id, shot]));
  const issues: AutoEditorPreflightIssue[] = [];
  if (!timeline.length) issues.push({ id: 'no-shots', severity: 'blocked', label: 'Chưa có timeline', detail: 'Hãy chọn nguồn có storyboard hoặc biến thể đã tạo.' });
  timeline.forEach((clip, index) => {
    const shot = shotMap.get(clip.shotId);
    if (!clip.videoUrl) issues.push({ id: `video-${clip.shotId}`, severity: 'blocked', label: `Cảnh ${index + 1} chưa có video`, detail: shot?.actionSummary || 'Cần tạo video trước khi dựng.', shotId: clip.shotId });
    else if (shot?.workflow?.videoStale) issues.push({ id: `stale-${clip.shotId}`, severity: 'warning', label: `Cảnh ${index + 1} đang dùng video cũ`, detail: 'Nội dung nguồn đã thay đổi sau lần tạo video gần nhất.', shotId: clip.shotId });
    if (state.settings.includeVoice && clip.dialogue && !clip.voiceTakeId) issues.push({ id: `voice-${clip.shotId}`, severity: 'warning', label: `Cảnh ${index + 1} chưa có voice được chọn`, detail: 'Video vẫn render được nhưng đoạn này sẽ không có lời đọc.', shotId: clip.shotId });
  });
  if (state.settings.logoEnabled && !getLogoUrl(project, state.settings)) issues.push({ id: 'logo', severity: 'blocked', label: 'Chưa có logo hợp lệ', detail: 'Chọn logo trong Brand Kit hoặc tắt lớp logo.' });
  if (state.settings.musicEnabled && !state.settings.musicUrl) issues.push({ id: 'music', severity: 'blocked', label: 'Chưa có nhạc nền', detail: 'Tải tệp nhạc lên hoặc tắt nhạc nền.' });
  return issues;
};

export const getAutoEditorSummary = (project: ProjectState) => {
  const state = normalizeAutoEditorState(project.autoEditor, project);
  const currentSignature = editorSignature(project, state.settings);
  const issues = getAutoEditorPreflight(project);
  const totalDuration = state.timeline.reduce((sum, clip) => sum + clip.duration, 0);
  return {
    state,
    stale: !state.planSignature || state.planSignature !== currentSignature,
    issues,
    blocked: issues.filter((issue) => issue.severity === 'blocked').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    totalDuration,
    readyClips: state.timeline.filter((clip) => clip.videoUrl).length,
    readyOutputs: state.outputs.filter((output) => output.status === 'ready').length,
  };
};

const setOutputStatus = (
  project: ProjectState,
  outputId: string,
  status: AutoEditorOutputStatus,
  error?: string,
): ProjectState => {
  const state = normalizeAutoEditorState(project.autoEditor, project);
  return {
    ...project,
    autoEditor: {
      ...state,
      outputs: state.outputs.map((output) => output.id === outputId ? { ...output, status, error, updatedAt: now() } : output),
      lastRenderedAt: status === 'ready' ? now() : state.lastRenderedAt,
      updatedAt: now(),
    },
  };
};

export const startAutoEditorRender = (project: ProjectState, outputId: string): ProjectState => {
  const summary = getAutoEditorSummary(project);
  if (summary.stale) throw new Error('Timeline đã thay đổi. Hãy lập lại timeline trước khi render.');
  if (summary.blocked) throw new Error(`Còn ${summary.blocked} lỗi chặn render. Hãy xử lý phần kiểm tra đầu vào.`);
  const output = summary.state.outputs.find((item) => item.id === outputId);
  if (!output) throw new Error('Không tìm thấy đầu ra Auto Editor.');
  const checkpointed = createProjectCheckpoint(project, `Trước khi render ${output.name}`);
  const job = createProductionJob({
    kind: 'auto-editor',
    stage: 'export',
    label: `Auto Editor · ${output.name}`,
    totalUnits: summary.state.timeline.length,
    resourceId: outputId,
    detail: 'Render cục bộ bằng FFmpeg, không gọi API AI.',
  });
  const withJob = addProductionJob(checkpointed, { ...job, status: 'running', attempts: 1 });
  return setOutputStatus(withJob, outputId, 'rendering');
};

export const finishAutoEditorRender = (project: ProjectState, outputId: string): ProjectState => {
  const job = project.workflow?.jobs.find((item) => item.kind === 'auto-editor' && item.resourceId === outputId && item.status === 'running');
  const completed = job ? patchProductionJob(project, job.id, {
    status: 'completed',
    progress: 100,
    completedUnits: project.autoEditor?.timeline.length || 0,
    detail: 'Đã render và tải MP4 trên thiết bị.',
  }) : project;
  return setOutputStatus(completed, outputId, 'ready');
};

export const failAutoEditorRender = (project: ProjectState, outputId: string, error: string): ProjectState => {
  const job = project.workflow?.jobs.find((item) => item.kind === 'auto-editor' && item.resourceId === outputId && item.status === 'running');
  const failed = job ? patchProductionJob(project, job.id, { status: 'failed', error }) : project;
  return setOutputStatus(failed, outputId, 'failed', error);
};

const secondsToSrt = (seconds: number): string => {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
};

export const buildAutoEditorSrt = (project: ProjectState): string => {
  const state = normalizeAutoEditorState(project.autoEditor, project);
  return state.captions.map((cue, index) => `${index + 1}\n${secondsToSrt(cue.start)} --> ${secondsToSrt(cue.end)}\n${cue.text}\n`).join('\n');
};

export const downloadAutoEditorSrt = (project: ProjectState): void => {
  const srt = buildAutoEditorSrt(project);
  if (!srt) throw new Error('Timeline chưa có phụ đề để tải.');
  const url = URL.createObjectURL(new Blob([srt], { type: 'application/x-subrip;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFileName(project.title)}-vi.srt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
};
