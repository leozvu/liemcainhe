import {
  CoreStage,
  ProductionJob,
  ProductionJobKind,
  ProductionJobStatus,
  ProjectCheckpoint,
  ProjectSnapshot,
  ProjectStage,
  ProjectState,
  ProjectWorkflowState,
  Shot,
} from '../types';
import {
  getActiveChatModel,
  getActiveImageModel,
  getActiveVideoModel,
  getApiKeyForModel,
} from './modelRegistry';
import { isVoiceProviderConfigured, normalizeProductionVoiceProviderId } from './voiceRegistry';
import { normalizeCreativeDirectorState } from './creativeDirectorState';
import { applyTransition } from './jobStateMachine';
import { isHostedRuntime } from './hostedRuntime';

export interface StageReadiness {
  id: CoreStage;
  label: string;
  description: string;
  complete: number;
  total: number;
  percent: number;
  status: 'ready' | 'attention' | 'blocked';
  blockers: string[];
}

export interface WorkflowReadiness {
  stages: StageReadiness[];
  overallPercent: number;
  nextStage: CoreStage;
  nextLabel: string;
  blockingCount: number;
  chargeableOperations: number;
}

export interface PreflightItem {
  id: string;
  label: string;
  detail: string;
  status: 'ready' | 'warning' | 'blocked';
  action?: 'models' | 'voice' | 'cloud';
}

const cloneValue = <T,>(value: T): T => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

export const createDefaultWorkflowState = (): ProjectWorkflowState => ({
  jobs: [],
  checkpoints: [],
  productionTasks: [],
  approvalGates: [],
  cloudSyncStatus: 'idle',
});

export const normalizeWorkflowState = (project: ProjectState): ProjectState => {
  const current = project.workflow || createDefaultWorkflowState();
  const creativeDirector = normalizeCreativeDirectorState(project.creativeDirector);
  const jobs = (current.jobs || []).map((job) =>
    job.status === 'running' || job.status === 'queued'
      ? {
          ...job,
          status: 'interrupted' as const,
          detail: 'Tác vụ bị gián đoạn khi ứng dụng đóng. Mở đúng công đoạn để chạy lại.',
          updatedAt: Date.now(),
        }
      : job,
  );

  return {
    ...project,
    creativeDirector: {
      ...creativeDirector,
      runs: creativeDirector.runs.map((run) => run.status === 'thinking' ? {
        ...run,
        status: 'failed',
        completedAt: Date.now(),
        error: 'Phiên tư vấn bị gián đoạn khi ứng dụng đóng.',
      } : run),
      missions: creativeDirector.missions.map((mission) => mission.status === 'running' ? {
        ...mission,
        status: 'paused',
        error: 'Nhiệm vụ bị gián đoạn. Bạn có thể tiếp tục từ hành động chưa hoàn tất.',
        actions: mission.actions.map((action) => action.status === 'running' ? {
          ...action,
          status: 'pending',
          error: undefined,
        } : action),
      } : mission),
    },
    voiceStudio: project.voiceStudio ? {
      defaultProviderId: normalizeProductionVoiceProviderId(project.voiceStudio.defaultProviderId),
      profiles: (project.voiceStudio.profiles || []).map((profile) => ({
        ...profile,
        providerId: normalizeProductionVoiceProviderId(profile.providerId),
        voiceId: normalizeProductionVoiceProviderId(profile.providerId) === profile.providerId ? profile.voiceId : '',
        voiceName: normalizeProductionVoiceProviderId(profile.providerId) === profile.providerId ? profile.voiceName : 'Kore',
        region: normalizeProductionVoiceProviderId(profile.providerId) === profile.providerId ? profile.region : 'international',
        pitch: profile.pitch ?? 0,
        emotion: profile.emotion || 'neutral',
      })),
      takes: project.voiceStudio.takes || [],
      selectedTakeByShot: project.voiceStudio.selectedTakeByShot || {},
      outputFormat: project.voiceStudio.outputFormat || 'mp3',
      normalizeLoudness: project.voiceStudio.normalizeLoudness ?? true,
      pronunciationDictionary: project.voiceStudio.pronunciationDictionary || [],
      previewText: project.voiceStudio.previewText || 'Xin chào, đây là bản thử giọng của Egoric Film Studio.',
      previewTake: project.voiceStudio.previewTake,
    } : project.voiceStudio,
    workflow: {
      ...createDefaultWorkflowState(),
      ...current,
      jobs,
      checkpoints: current.checkpoints || [],
      productionTasks: current.productionTasks || [],
      approvalGates: current.approvalGates || [],
    },
  };
};

const getSelectedVoiceTake = (project: ProjectState, shotId: string) => {
  const studio = project.voiceStudio;
  const selectedId = studio?.selectedTakeByShot[shotId];
  return studio?.takes.find((take) => take.id === selectedId && take.status === 'ready' && take.audioUrl);
};

const buildStage = (
  id: CoreStage,
  label: string,
  description: string,
  complete: number,
  total: number,
  blockers: string[],
): StageReadiness => {
  const percent = total === 0 ? (blockers.length ? 0 : 100) : Math.round((complete / total) * 100);
  return {
    id,
    label,
    description,
    complete,
    total,
    percent,
    blockers,
    status: blockers.length && complete === 0 ? 'blocked' : percent === 100 && blockers.length === 0 ? 'ready' : 'attention',
  };
};

export const getWorkflowReadiness = (project: ProjectState): WorkflowReadiness => {
  const scriptReady = Boolean(project.scriptData && project.shots.length);
  const scriptBlockers = [
    ...(!project.rawScript.trim() ? ['Chưa có nội dung kịch bản.'] : []),
    ...(!project.scriptData ? ['Kịch bản chưa được phân tích thành dữ liệu sản xuất.'] : []),
    ...(project.scriptData && !project.shots.length ? ['Chưa có danh sách cảnh quay.'] : []),
  ];

  const characters = project.scriptData?.characters || [];
  const scenes = project.scriptData?.scenes || [];
  const assetTotal = characters.length + scenes.length;
  const assetComplete = characters.filter((item) => item.referenceImage).length + scenes.filter((item) => item.referenceImage).length;
  const assetBlockers = !project.scriptData
    ? ['Hoàn tất phân tích kịch bản trước khi dựng tài nguyên.']
    : assetTotal === 0
      ? ['Kịch bản chưa có nhân vật hoặc bối cảnh.']
      : assetComplete < assetTotal
        ? [`Còn ${assetTotal - assetComplete} tài nguyên chưa có ảnh chuẩn.`]
        : [];

  const dialogueShots = project.shots.filter((shot) => Boolean(shot.dialogue?.trim()));
  const voiceComplete = dialogueShots.filter((shot) => getSelectedVoiceTake(project, shot.id) && !shot.workflow?.voiceStale).length;
  const voiceBlockers = !scriptReady
    ? ['Cần danh sách cảnh quay trước khi dựng giọng.']
    : voiceComplete < dialogueShots.length
      ? [`Còn ${dialogueShots.length - voiceComplete} câu thoại chưa duyệt bản thu.`]
      : [];

  const videoComplete = project.shots.filter((shot) => shot.interval?.videoUrl && !shot.workflow?.videoStale).length;
  const directorBlockers = !scriptReady
    ? ['Cần danh sách cảnh quay trước khi dựng hình.']
    : videoComplete < project.shots.length
      ? [`Còn ${project.shots.length - videoComplete} cảnh chưa có video hợp lệ.`]
      : [];

  const exportRequirements = project.shots.length + dialogueShots.length;
  const exportComplete = videoComplete + voiceComplete;
  const exportBlockers = [
    ...(videoComplete < project.shots.length ? ['Video chưa hoàn tất cho mọi cảnh.'] : []),
    ...(voiceComplete < dialogueShots.length ? ['Bản thoại phát hành chưa đầy đủ.'] : []),
  ];

  const stages = [
    buildStage('script', 'Kịch bản', 'Cấu trúc câu chuyện và danh sách cảnh', scriptReady ? 2 : project.scriptData ? 1 : 0, 2, scriptBlockers),
    buildStage('assets', 'Tài nguyên', 'Nhân vật và bối cảnh chuẩn', assetComplete, assetTotal, assetBlockers),
    buildStage('voice', 'Giọng thoại', 'Bản thu đã chọn cho từng câu thoại', voiceComplete, dialogueShots.length, voiceBlockers),
    buildStage('director', 'Xưởng dựng', 'Khung hình và video hợp lệ', videoComplete, project.shots.length, directorBlockers),
    buildStage('export', 'Xuất bản', 'Đủ hình và tiếng cho gói phát hành', exportComplete, exportRequirements, exportBlockers),
  ];

  const weightedTotal = stages.reduce((sum, stage) => sum + Math.max(1, stage.total), 0);
  const weightedComplete = stages.reduce((sum, stage) => sum + (stage.total === 0 && !stage.blockers.length ? 1 : stage.complete), 0);
  const next = stages.find((stage) => stage.status !== 'ready') || stages[stages.length - 1];
  const chargeableOperations = Math.max(0, assetTotal - assetComplete)
    + Math.max(0, dialogueShots.length - voiceComplete)
    + Math.max(0, project.shots.length - videoComplete);

  return {
    stages,
    overallPercent: Math.round((weightedComplete / weightedTotal) * 100),
    nextStage: next.id,
    nextLabel: next.status === 'ready' ? 'Xem gói phát hành' : `Tiếp tục ${next.label.toLowerCase()}`,
    blockingCount: stages.reduce((sum, stage) => sum + stage.blockers.length, 0),
    chargeableOperations,
  };
};

export const getPreflightItems = (project: ProjectState): PreflightItem[] => {
  const chat = getActiveChatModel();
  const image = getActiveImageModel();
  const video = getActiveVideoModel();
  const dialogueShots = project.shots.filter((shot) => Boolean(shot.dialogue?.trim()));
  const providerIds = new Set(project.voiceStudio?.profiles.map((profile) => profile.providerId) || []);
  if (dialogueShots.length && providerIds.size === 0) providerIds.add(project.voiceStudio?.defaultProviderId || 'shopaikey');
  const voiceReady = Array.from(providerIds).every((providerId) => isVoiceProviderConfigured(providerId));
  const hosted = isHostedRuntime();

  return [
    {
      id: 'chat-model',
      label: 'Mô hình kịch bản',
      detail: chat && getApiKeyForModel(chat.id) ? `${chat.name} đã có khóa truy cập.` : 'Chưa có mô hình hội thoại khả dụng.',
      status: chat && getApiKeyForModel(chat.id) ? 'ready' : 'blocked',
      action: 'models',
    },
    {
      id: 'image-model',
      label: 'Mô hình hình ảnh',
      detail: image && getApiKeyForModel(image.id) ? `${image.name} sẵn sàng tạo tài nguyên.` : 'Chưa có mô hình hình ảnh khả dụng.',
      status: image && getApiKeyForModel(image.id) ? 'ready' : 'blocked',
      action: 'models',
    },
    {
      id: 'video-model',
      label: 'Mô hình video',
      detail: video && getApiKeyForModel(video.id) ? `${video.name} sẵn sàng dựng cảnh.` : 'Chưa có mô hình video khả dụng.',
      status: video && getApiKeyForModel(video.id) ? 'ready' : 'blocked',
      action: 'models',
    },
    {
      id: 'voice-provider',
      label: 'Nhà cung cấp giọng',
      detail: !dialogueShots.length ? 'Dự án không có câu thoại cần tạo.' : voiceReady ? 'Các hồ sơ giọng đang dùng đã được cấu hình.' : 'Một hoặc nhiều hồ sơ giọng chưa có khóa.',
      status: !dialogueShots.length || voiceReady ? 'ready' : 'blocked',
      action: 'voice',
    },
    {
      id: 'cloud',
      label: 'Sao lưu đám mây',
      detail: hosted ? 'Có thể đồng bộ dự án và media bằng tài khoản nhân sự Egoric hiện tại.' : 'Chỉ hoạt động trên bản Egoric đã deploy và đăng nhập; bản local vẫn tự lưu trên thiết bị.',
      status: hosted ? 'ready' : 'warning',
      action: 'cloud',
    },
  ];
};

export const createProductionJob = (input: {
  kind: ProductionJobKind;
  stage: CoreStage;
  label: string;
  totalUnits?: number;
  resourceId?: string;
  detail?: string;
  idempotencyKey?: string;
  providerTaskId?: string;
}): ProductionJob => {
  const now = Date.now();
  return {
    id: `job_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind: input.kind,
    stage: input.stage,
    label: input.label,
    status: 'queued',
    progress: 0,
    completedUnits: 0,
    totalUnits: input.totalUnits,
    resourceId: input.resourceId,
    detail: input.detail,
    idempotencyKey: input.idempotencyKey,
    providerTaskId: input.providerTaskId,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
};

/** Ghi đúng snapshot job từ execution envelope, thêm mới nếu chưa tồn tại. */
export const upsertProductionJob = (project: ProjectState, job: ProductionJob): ProjectState => {
  const workflow = project.workflow || createDefaultWorkflowState();
  const exists = workflow.jobs.some((item) => item.id === job.id);
  const jobs = exists
    ? workflow.jobs.map((item) => item.id === job.id ? job : item)
    : [job, ...workflow.jobs];
  return { ...project, workflow: { ...workflow, jobs: jobs.slice(0, 100) } };
};

export const addProductionJob = (project: ProjectState, job: ProductionJob): ProjectState => {
  const workflow = project.workflow || createDefaultWorkflowState();
  return { ...project, workflow: { ...workflow, jobs: [job, ...workflow.jobs].slice(0, 100) } };
};

export const patchProductionJob = (
  project: ProjectState,
  jobId: string,
  updates: Partial<Omit<ProductionJob, 'id' | 'createdAt'>>,
): ProjectState => {
  const workflow = project.workflow || createDefaultWorkflowState();
  return {
    ...project,
    workflow: {
      ...workflow,
      jobs: workflow.jobs.map((job) => job.id === jobId ? { ...job, ...updates, updatedAt: Date.now() } : job),
    },
  };
};

export const setProductionJobStatus = (
  project: ProjectState,
  jobId: string,
  status: ProductionJobStatus,
  error?: string,
): ProjectState => patchProductionJob(project, jobId, {
  status,
  progress: status === 'completed' ? 100 : project.workflow?.jobs.find((job) => job.id === jobId)?.progress || 0,
  error,
  attempts: (project.workflow?.jobs.find((job) => job.id === jobId)?.attempts || 0) + (status === 'running' ? 1 : 0),
});

/** Mở khóa sau khi người vận hành đã đối chiếu tác vụ mơ hồ với provider. */
export const resolveInterruptedProductionJob = (
  project: ProjectState,
  jobId: string,
): ProjectState => {
  const workflow = project.workflow || createDefaultWorkflowState();
  return {
    ...project,
    workflow: {
      ...workflow,
      jobs: workflow.jobs.map((job) => job.id === jobId && job.status === 'interrupted'
        ? applyTransition(job, 'failed', {
          detail: 'Đã được người vận hành đối chiếu với provider và mở khóa để tạo lượt mới.',
          error: undefined,
        })
        : job),
    },
  };
};

export const clearFinishedJobs = (project: ProjectState): ProjectState => {
  const workflow = project.workflow || createDefaultWorkflowState();
  return {
    ...project,
    workflow: {
      ...workflow,
      jobs: workflow.jobs.filter((job) => !['completed', 'cancelled'].includes(job.status)),
    },
  };
};

const createSnapshot = (project: ProjectState): ProjectSnapshot => ({
  title: project.title,
  stage: project.stage,
  rawScript: project.rawScript,
  targetDuration: project.targetDuration,
  language: project.language,
  visualStyle: project.visualStyle,
  shotGenerationModel: project.shotGenerationModel,
  scriptData: cloneValue(project.scriptData),
  shots: cloneValue(project.shots),
  voiceStudio: cloneValue(project.voiceStudio),
  videoFactory: cloneValue(project.videoFactory),
  aiSupervisor: cloneValue(project.aiSupervisor),
  autoEditor: cloneValue(project.autoEditor),
  agencyReview: cloneValue(project.agencyReview),
  contentStudio: cloneValue(project.contentStudio),
});

export const createProjectCheckpoint = (project: ProjectState, label: string): ProjectState => {
  const workflow = project.workflow || createDefaultWorkflowState();
  const checkpoint: ProjectCheckpoint = {
    id: `checkpoint_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    label,
    createdAt: Date.now(),
    stage: project.stage,
    snapshot: createSnapshot(project),
  };
  return {
    ...project,
    workflow: { ...workflow, checkpoints: [checkpoint, ...workflow.checkpoints].slice(0, 3) },
  };
};

export const restoreProjectCheckpoint = (project: ProjectState, checkpointId: string): ProjectState => {
  const workflow = project.workflow || createDefaultWorkflowState();
  const checkpoint = workflow.checkpoints.find((item) => item.id === checkpointId);
  if (!checkpoint) return project;
  return {
    ...project,
    ...cloneValue(checkpoint.snapshot),
    lastModified: Date.now(),
    isParsingScript: false,
    workflow,
  };
};

export const deleteProjectCheckpoint = (project: ProjectState, checkpointId: string): ProjectState => {
  const workflow = project.workflow || createDefaultWorkflowState();
  return {
    ...project,
    workflow: { ...workflow, checkpoints: workflow.checkpoints.filter((item) => item.id !== checkpointId) },
  };
};

export const markShotWorkflowStale = (
  shot: Shot,
  change: 'dialogue' | 'visual' | 'casting' | 'keyframe' | 'video',
): Shot => {
  const current = shot.workflow || {};
  const workflow = {
    ...current,
    updatedAt: Date.now(),
    ...(change === 'dialogue' ? { voiceStale: true, videoStale: true, approved: false } : {}),
    ...(change === 'visual' ? { keyframesStale: true, videoStale: true, approved: false } : {}),
    ...(change === 'casting' ? { keyframesStale: true, voiceStale: true, videoStale: true, approved: false } : {}),
    ...(change === 'keyframe' ? { keyframesStale: false, videoStale: true, approved: false } : {}),
    ...(change === 'video' ? { videoStale: true, approved: false } : {}),
  };
  return { ...shot, workflow };
};

export const clearShotStaleFlag = (shot: Shot, target: 'voice' | 'keyframes' | 'video'): Shot => ({
  ...shot,
  workflow: {
    ...shot.workflow,
    [`${target}Stale`]: false,
    updatedAt: Date.now(),
  },
});

/**
 * Quy một chặng bất kỳ về chặng lõi gần nhất.
 *
 * Kho sáng tạo và Xưởng nội dung không phải chặng lõi nhưng vẫn cần một chặng
 * để gắn tác vụ và tiến độ; cả hai đều đổ về Kịch bản vì đó là nơi kết quả của
 * chúng đi tiếp.
 */
export const stageForProjectStage = (stage: ProjectStage): CoreStage =>
  stage === 'prompts' || stage === 'content' ? 'script' : stage;
