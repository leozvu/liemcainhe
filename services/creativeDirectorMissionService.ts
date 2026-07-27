import {
  Character,
  CreativeDirectorMission,
  CreativeDirectorMissionAction,
  CreativeDirectorToolName,
  Keyframe,
  ProjectState,
  Scene,
  Shot,
  VoiceProfile,
  VoiceTake,
} from '../types';
import { generateImage, generateImageWithModel, generateVideoWithModel } from './modelService';
import { getActiveImageModel, getDefaultAspectRatio, getDefaultVideoDuration } from './modelRegistry';
import { DEFAULT_IMAGE_MODEL_ID } from '../types/model';
import { getUsagePolicy } from './usageService';
import { createVoiceSourceHash, generateVoice } from './voiceService';
import { getVoiceProvider, isVoiceProviderConfigured } from './voiceRegistry';
import { normalizeCreativeDirectorState } from './creativeDirectorState';
import { buildBrandVisualGuardrails } from './brandKitService';
import {
  addProductionJob,
  clearShotStaleFlag,
  createProductionJob,
  createProjectCheckpoint,
  markShotWorkflowStale,
  patchProductionJob,
  setProductionJobStatus,
  upsertProductionJob,
} from './workflowService';
import { checkMissionBudget, computeBudget } from './directorBriefingService';
import {
  buildShotReferenceImages,
  pickReferences,
  resolveGenerationParams,
} from './consistencyService';
import { saveProjectToDB } from './storageService';

const createId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const sameId = (left?: string | number, right?: string | number): boolean => String(left) === String(right);
const roundCost = (value: number): number => Math.round(value * 100_000) / 100_000;

const getSpeakerId = (project: ProjectState, shot: Shot): string => {
  const characters = project.scriptData?.characters || [];
  return shot.characters.find((id) => characters.some((character) => sameId(character.id, id)))
    || characters[0]?.id
    || 'narrator';
};

const getVoiceProfile = (project: ProjectState, shot: Shot): VoiceProfile | undefined => {
  const speakerId = getSpeakerId(project, shot);
  return project.voiceStudio?.profiles.find((profile) => sameId(profile.characterId, speakerId));
};

const getSelectedCurrentVoiceTake = (project: ProjectState, shot: Shot): VoiceTake | undefined => {
  const studio = project.voiceStudio;
  const selectedId = studio?.selectedTakeByShot[shot.id];
  const take = studio?.takes.find((item) => item.id === selectedId && item.status === 'ready' && item.audioUrl);
  if (!take || shot.workflow?.voiceStale) return undefined;
  if (take.source === 'human') return take;
  const profile = getVoiceProfile(project, shot);
  if (!profile) return undefined;
  const hash = createVoiceSourceHash(
    shot.dialogue?.trim() || '',
    profile.voiceId,
    profile.speed,
    profile.emotion || 'neutral',
    profile.pitch ?? 0,
  );
  return take.sourceHash === hash ? take : undefined;
};

const actionStage = (tool: CreativeDirectorToolName): CreativeDirectorMissionAction['stage'] => {
  if (tool === 'generate-character-image' || tool === 'generate-scene-image') return 'assets';
  if (tool === 'generate-voice') return 'voice';
  return 'director';
};

const createAction = (input: {
  tool: CreativeDirectorToolName;
  label: string;
  resourceId: string;
  estimatedCostUsd: number;
  dependsOn?: string[];
  blockedReason?: string;
  shotId?: string;
  frameType?: 'start' | 'end';
  duration?: number;
  textToVideoOnly?: boolean;
  previousOutput?: string;
}): CreativeDirectorMissionAction => {
  const idempotencyKey = `${input.tool}:${input.resourceId}`;
  return {
    id: createId('director_action'),
    tool: input.tool,
    label: input.label,
    stage: actionStage(input.tool),
    status: input.blockedReason ? 'blocked' : 'pending',
    dependsOn: input.dependsOn || [],
    resourceId: input.resourceId,
    estimatedCostUsd: roundCost(input.estimatedCostUsd),
    attempts: 0,
    maxAttempts: 2,
    requiresApproval: input.estimatedCostUsd > 0,
    idempotencyKey,
    blockedReason: input.blockedReason,
    input: {
      shotId: input.shotId,
      frameType: input.frameType,
      duration: input.duration,
      textToVideoOnly: input.textToVideoOnly,
      previousOutput: input.previousOutput,
    },
  };
};

const getAssetDependencyIds = (
  shot: Shot,
  characterActionById: Map<string, string>,
  sceneActionById: Map<string, string>,
): string[] => {
  const dependencyIds = new Set<string>();
  const sceneActionId = sceneActionById.get(String(shot.sceneId));
  if (sceneActionId) dependencyIds.add(sceneActionId);
  shot.characters.forEach((characterId) => {
    const actionId = characterActionById.get(String(characterId));
    if (actionId) dependencyIds.add(actionId);
  });
  return Array.from(dependencyIds);
};

const planActions = (project: ProjectState): CreativeDirectorMissionAction[] => {
  if (!project.scriptData) return [];
  const rates = getUsagePolicy().rates;
  const actions: CreativeDirectorMissionAction[] = [];
  const characterActionById = new Map<string, string>();
  const sceneActionById = new Map<string, string>();

  project.scriptData.characters.forEach((character) => {
    if (character.referenceImage) return;
    const action = createAction({
      tool: 'generate-character-image',
      label: `Tạo ảnh chuẩn nhân vật ${character.name}`,
      resourceId: String(character.id),
      estimatedCostUsd: rates.imagePerOutput,
    });
    actions.push(action);
    characterActionById.set(String(character.id), action.id);
  });

  project.scriptData.scenes.forEach((scene) => {
    if (scene.referenceImage) return;
    const action = createAction({
      tool: 'generate-scene-image',
      label: `Tạo ảnh chuẩn bối cảnh ${scene.location}`,
      resourceId: String(scene.id),
      estimatedCostUsd: rates.imagePerOutput,
    });
    actions.push(action);
    sceneActionById.set(String(scene.id), action.id);
  });

  project.shots.forEach((shot, shotIndex) => {
    const assetDependencies = getAssetDependencyIds(shot, characterActionById, sceneActionById);
    const frameActionIds: string[] = [];
    const textToVideoOnly = Boolean(shot.interval?.textToVideoOnly);
    if (!textToVideoOnly) (['start', 'end'] as const).forEach((frameType) => {
      const frame = shot.keyframes?.find((keyframe) => keyframe.type === frameType);
      if (frame?.imageUrl && !shot.workflow?.keyframesStale) return;
      const action = createAction({
        tool: frameType === 'start' ? 'generate-start-keyframe' : 'generate-end-keyframe',
        label: `Tạo khung ${frameType === 'start' ? 'đầu' : 'cuối'} cảnh ${shotIndex + 1}`,
        resourceId: `${shot.id}:${frameType}`,
        estimatedCostUsd: rates.imagePerOutput,
        dependsOn: assetDependencies,
        shotId: shot.id,
        frameType,
        previousOutput: frame?.imageUrl,
      });
      actions.push(action);
      frameActionIds.push(action.id);
    });

    const videoReady = Boolean(shot.interval?.videoUrl && !shot.workflow?.videoStale);
    if (!videoReady) {
      const duration = Math.max(1, Number(shot.interval?.duration || getDefaultVideoDuration()));
      actions.push(createAction({
        tool: 'generate-video',
        label: `Dựng video cảnh ${shotIndex + 1}`,
        resourceId: String(shot.id),
        estimatedCostUsd: duration * rates.videoPerSecond,
        dependsOn: textToVideoOnly ? [] : frameActionIds,
        shotId: shot.id,
        duration,
        textToVideoOnly,
        previousOutput: shot.interval?.videoUrl,
      }));
    }

    if (shot.dialogue?.trim() && !getSelectedCurrentVoiceTake(project, shot)) {
      const profile = getVoiceProfile(project, shot);
      const provider = profile ? getVoiceProvider(profile.providerId) : undefined;
      let blockedReason: string | undefined;
      if (!project.voiceStudio || !profile) blockedReason = 'Chưa gán hồ sơ giọng cho nhân vật của cảnh này.';
      else if (profile.providerId === 'human') blockedReason = 'Cảnh dùng diễn viên thật; hãy tải bản thu thủ công.';
      else if (!provider?.supportsGeneration) blockedReason = 'Nhà cung cấp giọng này không hỗ trợ tạo tự động.';
      else if (!profile.voiceId.trim()) blockedReason = 'Hồ sơ giọng chưa có Voice ID.';
      else if (!isVoiceProviderConfigured(profile.providerId)) blockedReason = `Chưa cấu hình khóa ${provider.name}.`;
      actions.push(createAction({
        tool: 'generate-voice',
        label: `Tạo thoại cảnh ${shotIndex + 1}`,
        resourceId: String(shot.id),
        estimatedCostUsd: (shot.dialogue.trim().length / 1000) * rates.voicePerThousandCharacters,
        blockedReason,
        shotId: shot.id,
      }));
    }
  });

  return actions;
};

export const createCreativeDirectorMission = (
  project: ProjectState,
  goal = 'Hoàn thiện các media còn thiếu của dự án',
): { project: ProjectState; mission: CreativeDirectorMission } => {
  const actions = planActions(project);
  const estimatedCostUsd = roundCost(actions
    .filter((action) => action.status !== 'blocked')
    .reduce((sum, action) => sum + action.estimatedCostUsd, 0));
  const mission: CreativeDirectorMission = {
    id: createId('director_mission'),
    goal,
    status: actions.length === 0 ? 'completed' : estimatedCostUsd > 0 ? 'awaiting-approval' : 'draft',
    actions,
    estimatedCostUsd,
    createdAt: Date.now(),
    completedAt: actions.length === 0 ? Date.now() : undefined,
  };
  const director = normalizeCreativeDirectorState(project.creativeDirector);
  const nextProject: ProjectState = {
    ...project,
    creativeDirector: {
      ...director,
      missions: [mission, ...director.missions].slice(0, 20),
      plan: actions.slice(0, 20).map((action) => ({
        id: action.id,
        title: action.label,
        detail: action.blockedReason || `Chi phí ước tính $${action.estimatedCostUsd.toFixed(3)} · ${action.dependsOn.length} phụ thuộc`,
        stage: action.stage,
        status: action.status === 'blocked' ? 'blocked' : action.dependsOn.length ? 'suggested' : 'ready',
      })),
    },
    lastModified: Date.now(),
  };
  return { project: nextProject, mission };
};

const patchMission = (
  project: ProjectState,
  missionId: string,
  updater: (mission: CreativeDirectorMission) => CreativeDirectorMission,
): ProjectState => {
  const director = normalizeCreativeDirectorState(project.creativeDirector);
  return {
    ...project,
    creativeDirector: {
      ...director,
      missions: director.missions.map((mission) => mission.id === missionId ? updater(mission) : mission),
    },
    lastModified: Date.now(),
  };
};

export const startCreativeDirectorMission = (project: ProjectState, missionId: string): ProjectState => {
  const director = normalizeCreativeDirectorState(project.creativeDirector);
  const mission = director.missions.find((item) => item.id === missionId);
  if (!mission) throw new Error('Không tìm thấy nhiệm vụ sản xuất.');
  if (director.mode === 'advisory') throw new Error('Chế độ Tư vấn không được phép gọi API media.');
  const remainingCostUsd = getCreativeDirectorMissionRemainingCost(mission);
  if (remainingCostUsd > director.budgetLimitUsd) {
    throw new Error(`Phần còn lại dự kiến $${remainingCostUsd.toFixed(2)}, vượt trần $${director.budgetLimitUsd.toFixed(2)}.`);
  }

  /**
   * Trần cộng dồn cho cả dự án.
   *
   * Kiểm tra ở trên chỉ chặn từng nhiệm vụ, nên chạy nhiều nhiệm vụ nhỏ vẫn
   * đốt sạch ngân sách mà không có gì cản. Đây là chỗ đối chiếu với tiền đã
   * tiêu thật trong nhật ký usage.
   */
  const budget = computeBudget(project.id, director.projectBudgetUsd);
  const verdict = checkMissionBudget({ estimatedCostUsd: remainingCostUsd }, budget);
  if (!verdict.allowed) throw new Error(verdict.reason);
  if (mission.status === 'completed' || mission.status === 'cancelled') return project;

  let next = project;
  let jobId = mission.jobId;
  if (!jobId) {
    const job = createProductionJob({
      kind: 'creative-director',
      stage: 'director',
      label: mission.goal,
      totalUnits: mission.actions.length,
      resourceId: mission.id,
      detail: 'Agent đang điều phối chuỗi sản xuất.',
    });
    jobId = job.id;
    next = createProjectCheckpoint(next, `Trước nhiệm vụ: ${mission.goal}`);
    next = addProductionJob(next, job);
    next = setProductionJobStatus(next, job.id, 'running');
  } else {
    next = setProductionJobStatus(next, jobId, 'running');
  }
  return patchMission(next, missionId, (current) => ({
    ...current,
    jobId,
    status: 'running',
    startedAt: current.startedAt || Date.now(),
    error: undefined,
    actions: current.actions.map((action) => action.status === 'failed' && action.attempts < action.maxAttempts
      ? { ...action, status: 'pending', error: undefined }
      : action),
  }));
};

export const getCreativeDirectorMissionRemainingCost = (mission: CreativeDirectorMission): number => roundCost(mission.actions
  .filter((action) => action.status === 'pending' || (action.status === 'failed' && action.attempts < action.maxAttempts))
  .reduce((sum, action) => sum + action.estimatedCostUsd, 0));

export const getNextRunnableMissionAction = (mission: CreativeDirectorMission): CreativeDirectorMissionAction | undefined => {
  const completedIds = new Set(mission.actions
    .filter((action) => action.status === 'completed' || action.status === 'skipped')
    .map((action) => action.id));
  return mission.actions.find((action) =>
    action.status === 'pending' && action.dependsOn.every((dependencyId) => completedIds.has(dependencyId)),
  );
};

export const markCreativeDirectorActionRunning = (
  project: ProjectState,
  missionId: string,
  actionId: string,
): ProjectState => patchMission(project, missionId, (mission) => ({
  ...mission,
  status: 'running',
  actions: mission.actions.map((action) => action.id === actionId ? {
    ...action,
    status: 'running',
    attempts: action.attempts + 1,
    startedAt: Date.now(),
    error: undefined,
  } : action),
}));

const syncMissionJobProgress = (project: ProjectState, missionId: string): ProjectState => {
  const mission = normalizeCreativeDirectorState(project.creativeDirector).missions.find((item) => item.id === missionId);
  if (!mission?.jobId) return project;
  const completedUnits = mission.actions.filter((action) => action.status === 'completed' || action.status === 'skipped').length;
  return patchProductionJob(project, mission.jobId, {
    completedUnits,
    totalUnits: mission.actions.length,
    progress: mission.actions.length ? Math.round((completedUnits / mission.actions.length) * 100) : 100,
    detail: `${completedUnits}/${mission.actions.length} hành động hoàn tất`,
  });
};

export const markCreativeDirectorActionCompleted = (
  project: ProjectState,
  missionId: string,
  actionId: string,
): ProjectState => syncMissionJobProgress(patchMission(project, missionId, (mission) => ({
  ...mission,
  actions: mission.actions.map((action) => action.id === actionId ? {
    ...action,
    status: 'completed',
    completedAt: Date.now(),
    error: undefined,
  } : action),
})), missionId);

export const markCreativeDirectorActionFailed = (
  project: ProjectState,
  missionId: string,
  actionId: string,
  error: string,
): ProjectState => patchMission(project, missionId, (mission) => ({
  ...mission,
  status: mission.actions.find((action) => action.id === actionId && action.attempts < action.maxAttempts)
    ? 'running'
    : 'paused',
  error,
  actions: mission.actions.map((action) => action.id === actionId ? {
    ...action,
    status: action.attempts < action.maxAttempts ? 'pending' : 'failed',
    error,
  } : action),
}));

export const pauseCreativeDirectorMission = (project: ProjectState, missionId: string): ProjectState => {
  let next = patchMission(project, missionId, (mission) => ({ ...mission, status: 'paused' }));
  const mission = normalizeCreativeDirectorState(next.creativeDirector).missions.find((item) => item.id === missionId);
  if (mission?.jobId) next = setProductionJobStatus(next, mission.jobId, 'interrupted');
  return next;
};

export const cancelCreativeDirectorMission = (project: ProjectState, missionId: string): ProjectState => {
  let next = patchMission(project, missionId, (mission) => ({ ...mission, status: 'cancelled', completedAt: Date.now() }));
  const mission = normalizeCreativeDirectorState(next.creativeDirector).missions.find((item) => item.id === missionId);
  if (mission?.jobId) next = setProductionJobStatus(next, mission.jobId, 'cancelled');
  return next;
};

export const finalizeCreativeDirectorMission = (project: ProjectState, missionId: string): ProjectState => {
  let next = patchMission(project, missionId, (mission) => {
    const terminalProblems = new Set(mission.actions
      .filter((action) => action.status === 'failed' || action.status === 'blocked')
      .map((action) => action.id));
    const actions = mission.actions.map((action) => action.status === 'pending'
      && action.dependsOn.some((dependencyId) => terminalProblems.has(dependencyId))
      ? { ...action, status: 'blocked' as const, blockedReason: 'Một hành động phụ thuộc chưa hoàn tất.' }
      : action);
    const failed = actions.some((action) => action.status === 'failed');
    const blocked = actions.filter((action) => action.status === 'blocked').length;
    const pending = actions.some((action) => action.status === 'pending' || action.status === 'running');
    const completed = !failed && !pending && blocked === 0;
    return {
      ...mission,
      actions,
      status: completed ? 'completed' : failed ? 'failed' : 'paused',
      completedAt: completed || failed ? Date.now() : mission.completedAt,
      error: completed ? undefined : failed
        ? mission.error || 'Một hành động đã thất bại sau số lần thử tối đa.'
        : blocked ? `${blocked} hành động cần bạn cấu hình hoặc xử lý thủ công.` : mission.error,
    };
  });
  const mission = normalizeCreativeDirectorState(next.creativeDirector).missions.find((item) => item.id === missionId);
  if (mission?.jobId) {
    if (mission.status === 'completed') next = setProductionJobStatus(next, mission.jobId, 'completed');
    else if (mission.status === 'failed') next = setProductionJobStatus(next, mission.jobId, 'failed', mission.error);
    else next = setProductionJobStatus(next, mission.jobId, 'interrupted', mission.error);
  }
  return next;
};

const buildCharacterPrompt = (project: ProjectState, character: Character): string => [
  `Ảnh character sheet điện ảnh của ${character.name}.`,
  character.visualPrompt || `${character.gender}, ${character.age}, tính cách ${character.personality}.`,
  character.coreFeatures ? `Đặc điểm bất biến: ${character.coreFeatures}.` : '',
  `Phong cách dự án: ${project.visualStyle || project.scriptData?.visualStyle || 'điện ảnh chân thực'}.`,
  'Một nhân vật duy nhất, toàn thân, góc nhìn rõ khuôn mặt, ánh sáng studio trung tính, nền gọn, không chữ, không watermark.',
  character.negativePrompt ? `Tránh: ${character.negativePrompt}.` : '',
  buildBrandVisualGuardrails(project.brandKitSnapshot),
].filter(Boolean).join(' ');

const buildScenePrompt = (project: ProjectState, scene: Scene): string => [
  `Ảnh thiết lập bối cảnh điện ảnh tại ${scene.location}, thời điểm ${scene.time}.`,
  scene.visualPrompt || `Không khí ${scene.atmosphere}.`,
  `Phong cách dự án: ${project.visualStyle || project.scriptData?.visualStyle || 'điện ảnh chân thực'}.`,
  'Khung hình rộng, bố cục rõ chiều sâu, không nhân vật chính, không chữ, không watermark.',
  scene.negativePrompt ? `Tránh: ${scene.negativePrompt}.` : '',
  buildBrandVisualGuardrails(project.brandKitSnapshot),
].filter(Boolean).join(' ');

const getBrandAssetReferences = (
  project: ProjectState,
  types: Array<'logo' | 'product' | 'character' | 'reference'>,
  context = '',
): string[] => {
  const assets = project.brandKitSnapshot?.assets.filter((asset) => types.includes(asset.type)) || [];
  const normalizedContext = context.toLocaleLowerCase('vi');
  const matched = assets.filter((asset) => normalizedContext.includes(asset.name.toLocaleLowerCase('vi')));
  const preferred = matched.length ? matched : assets.length === 1 ? assets : assets.filter((asset) => asset.type === 'reference');
  return Array.from(new Set(preferred.map((asset) => asset.url).filter(Boolean))).slice(0, 3);
};

const getFactoryModelId = (project: ProjectState, shot: Shot, type: 'image' | 'video'): string | undefined => {
  if (!shot.factory || !project.videoFactory) return undefined;
  const policy = project.videoFactory.policy;
  if (shot.factory.tier === 'final') return type === 'image' ? policy.finalImageModelId : policy.finalVideoModelId;
  return type === 'image' ? policy.draftImageModelId : policy.draftVideoModelId;
};

const getReferenceImages = (project: ProjectState, shot: Shot): string[] => {
  if (!project.scriptData) return [];
  const brandContext = [shot.actionSummary, shot.dialogue || '', ...shot.characters.map((id) => (
    project.scriptData?.characters.find((item) => sameId(item.id, id))?.name || ''
  ))].join(' ');
  return buildShotReferenceImages(
    shot,
    project.scriptData,
    getBrandAssetReferences(project, ['product', 'character', 'reference'], brandContext),
  );
};

const buildKeyframePrompt = (project: ProjectState, shot: Shot, frameType: 'start' | 'end'): string => {
  const existing = shot.keyframes?.find((keyframe) => keyframe.type === frameType)?.visualPrompt;
  const scene = project.scriptData?.scenes.find((item) => sameId(item.id, shot.sceneId));
  const characters = shot.characters.map((id) => project.scriptData?.characters.find((item) => sameId(item.id, id)))
    .filter(Boolean)
    .map((character) => `${character!.name}: ${character!.coreFeatures || character!.visualPrompt || character!.personality}`)
    .join('; ');
  return [
    existing || shot.actionSummary,
    frameType === 'start'
      ? 'Khung đầu: trạng thái ngay trước hành động, tư thế và vị trí ban đầu rõ ràng.'
      : 'Khung cuối: trạng thái sau khi hành động hoàn tất, thể hiện kết quả và thay đổi cảm xúc.',
    scene ? `Bối cảnh: ${scene.location}, ${scene.time}, ${scene.atmosphere}.` : '',
    characters ? `Giữ tuyệt đối nhận dạng và trang phục theo ảnh tham chiếu. ${characters}.` : '',
    `Cỡ cảnh: ${shot.shotSize || 'cinematic medium-wide'}. Chuyển động máy dự kiến: ${shot.cameraMovement}.`,
    `Phong cách: ${project.visualStyle || project.scriptData?.visualStyle || 'điện ảnh chân thực'}.`,
    buildBrandVisualGuardrails(project.brandKitSnapshot),
    'Bố cục điện ảnh, ánh sáng hợp lý, không chữ, không watermark.',
  ].filter(Boolean).join(' ');
};

const buildVideoPrompt = (project: ProjectState, shot: Shot): string => shot.interval?.videoPrompt?.trim() || [
  shot.actionSummary,
  `Máy quay: ${shot.cameraMovement}.`,
  `Cỡ cảnh: ${shot.shotSize || 'cinematic'}.`,
  `Phong cách: ${project.visualStyle || project.scriptData?.visualStyle || 'điện ảnh chân thực'}.`,
  buildBrandVisualGuardrails(project.brandKitSnapshot),
  'Chuyển động tự nhiên, vật lý nhất quán, giữ nguyên khuôn mặt và trang phục, không morphing, không chữ, không watermark.',
].join(' ');

const patchAsset = (
  project: ProjectState,
  type: 'character' | 'scene',
  resourceId: string,
  imageUrl: string,
  prompt: string,
): ProjectState => {
  if (!project.scriptData) return project;
  const next: ProjectState = {
    ...project,
    scriptData: {
      ...project.scriptData,
      characters: type === 'character'
        ? project.scriptData.characters.map((character) => sameId(character.id, resourceId)
          ? { ...character, visualPrompt: character.visualPrompt || prompt, referenceImage: imageUrl, status: 'completed' }
          : character)
        : project.scriptData.characters,
      scenes: type === 'scene'
        ? project.scriptData.scenes.map((scene) => sameId(scene.id, resourceId)
          ? { ...scene, visualPrompt: scene.visualPrompt || prompt, referenceImage: imageUrl, status: 'completed' }
          : scene)
        : project.scriptData.scenes,
    },
  };
  return {
    ...next,
    shots: next.shots.map((shot) => {
      const affected = type === 'character'
        ? shot.characters.some((id) => sameId(id, resourceId))
        : sameId(shot.sceneId, resourceId);
      return affected ? markShotWorkflowStale(shot, 'visual') : shot;
    }),
  };
};

const isActionAlreadyComplete = (project: ProjectState, action: CreativeDirectorMissionAction): boolean => {
  if (action.tool === 'generate-character-image') {
    return Boolean(project.scriptData?.characters.find((item) => sameId(item.id, action.resourceId))?.referenceImage);
  }
  if (action.tool === 'generate-scene-image') {
    return Boolean(project.scriptData?.scenes.find((item) => sameId(item.id, action.resourceId))?.referenceImage);
  }
  const shot = project.shots.find((item) => sameId(item.id, action.input?.shotId || action.resourceId));
  if (!shot) return false;
  if (action.tool === 'generate-start-keyframe' || action.tool === 'generate-end-keyframe') {
    const output = shot.keyframes.find((item) => item.type === action.input?.frameType)?.imageUrl;
    return Boolean(output && output !== action.input?.previousOutput);
  }
  if (action.tool === 'generate-video') return Boolean(shot.interval?.videoUrl && shot.interval.videoUrl !== action.input?.previousOutput);
  if (action.tool === 'generate-voice') return Boolean(getSelectedCurrentVoiceTake(project, shot));
  return false;
};

export const executeCreativeDirectorAction = async (
  project: ProjectState,
  action: CreativeDirectorMissionAction,
  options: { onProjectUpdate?: (project: ProjectState) => void } = {},
): Promise<ProjectState> => {
  if (isActionAlreadyComplete(project, action)) return project;
  const aspectRatio = getDefaultAspectRatio();
  const execution = (
    kind: 'asset-image' | 'keyframe-image' | 'video',
    stage: 'assets' | 'director',
    resourceId: string,
    previousOutput?: string,
    commitResult?: (result: string) => ProjectState,
  ) => ({
    projectId: project.id,
    jobs: project.workflow?.jobs || [],
    kind,
    stage,
    label: action.label,
    resourceId,
    previousOutput,
    commitResult: commitResult ? async (result: string) => {
      project = commitResult(result);
      options.onProjectUpdate?.(project);
      await saveProjectToDB(project);
    } : undefined,
    onJobChange: (job: Parameters<typeof upsertProductionJob>[1]) => {
      project = upsertProductionJob(project, job);
      options.onProjectUpdate?.(project);
    },
  });

  if (action.tool === 'generate-character-image') {
    const character = project.scriptData?.characters.find((item) => sameId(item.id, action.resourceId));
    if (!character) throw new Error('Không tìm thấy nhân vật cần tạo ảnh.');
    const prompt = buildCharacterPrompt(project, character);
    const generation = resolveGenerationParams(
      [character],
      getActiveImageModel()?.id || DEFAULT_IMAGE_MODEL_ID,
      aspectRatio,
    );
    const referenceImages = Array.from(new Set([
      ...pickReferences(character).map((reference) => reference.imageUrl),
      ...getBrandAssetReferences(project, ['character', 'reference'], character.name),
    ]));
    await generateImageWithModel({
      prompt,
      referenceImages,
      aspectRatio: generation.aspectRatio || aspectRatio,
      usageResourceId: `asset:character:${action.resourceId}`,
      execution: execution(
        'asset-image',
        'assets',
        `character:${action.resourceId}`,
        character.referenceImage,
        (imageUrl) => patchAsset(project, 'character', action.resourceId, imageUrl, prompt),
      ),
    }, generation.modelId);
    return project;
  }

  if (action.tool === 'generate-scene-image') {
    const scene = project.scriptData?.scenes.find((item) => sameId(item.id, action.resourceId));
    if (!scene) throw new Error('Không tìm thấy bối cảnh cần tạo ảnh.');
    const prompt = buildScenePrompt(project, scene);
    await generateImage({
      prompt,
      referenceImages: getBrandAssetReferences(project, ['product', 'reference'], `${scene.location} ${scene.atmosphere}`),
      aspectRatio,
      usageResourceId: `asset:scene:${action.resourceId}`,
      execution: execution(
        'asset-image',
        'assets',
        `scene:${action.resourceId}`,
        scene.referenceImage,
        (imageUrl) => patchAsset(project, 'scene', action.resourceId, imageUrl, prompt),
      ),
    });
    return project;
  }

  const shotId = action.input?.shotId || action.resourceId;
  const shot = project.shots.find((item) => sameId(item.id, shotId));
  if (!shot) throw new Error('Không tìm thấy cảnh quay cho hành động này.');

  if (action.tool === 'generate-start-keyframe' || action.tool === 'generate-end-keyframe') {
    const frameType = action.input?.frameType || (action.tool === 'generate-start-keyframe' ? 'start' : 'end');
    const prompt = buildKeyframePrompt(project, shot, frameType);
    const factoryAspectRatio = shot.factory?.aspectRatio || aspectRatio;
    const shotCharacters = shot.characters
      .map((id) => project.scriptData?.characters.find((character) => sameId(character.id, id)))
      .filter((character): character is Character => Boolean(character));
    const generation = resolveGenerationParams(
      shotCharacters,
      getFactoryModelId(project, shot, 'image') || getActiveImageModel()?.id || DEFAULT_IMAGE_MODEL_ID,
      factoryAspectRatio,
    );
    const previousFrame = shot.keyframes.find((item) => item.type === frameType)?.imageUrl;
    const commitKeyframe = (imageUrl: string): ProjectState => {
      const keyframe: Keyframe = {
        id: shot.keyframes.find((item) => item.type === frameType)?.id || `${shot.id}-${frameType}`,
        type: frameType,
        visualPrompt: prompt,
        imageUrl,
        status: 'completed',
      };
      return {
        ...project,
        shots: project.shots.map((item) => {
          if (!sameId(item.id, shot.id)) return item;
          const keyframes = item.keyframes.some((frame) => frame.type === frameType)
            ? item.keyframes.map((frame) => frame.type === frameType ? keyframe : frame)
            : [...item.keyframes, keyframe];
          const allFramesReady = (['start', 'end'] as const).every((type) => keyframes.some((frame) => frame.type === type && frame.imageUrl));
          return {
            ...item,
            keyframes,
            workflow: {
              ...item.workflow,
              keyframesStale: !allFramesReady,
              videoStale: true,
              approved: false,
              updatedAt: Date.now(),
            },
          };
        }),
      };
    };
    await generateImageWithModel(
      {
        prompt,
        referenceImages: getReferenceImages(project, shot),
        aspectRatio: generation.aspectRatio || factoryAspectRatio,
        usageResourceId: `${shot.id}:keyframe:${frameType}`,
        execution: execution(
          'keyframe-image',
          'director',
          `${shot.id}:keyframe:${frameType}`,
          previousFrame,
          commitKeyframe,
        ),
      },
      generation.modelId,
    );
    return project;
  }

  if (action.tool === 'generate-video') {
    const textToVideoOnly = Boolean(action.input?.textToVideoOnly || shot.interval?.textToVideoOnly);
    const startFrame = shot.keyframes.find((frame) => frame.type === 'start');
    const endFrame = shot.keyframes.find((frame) => frame.type === 'end');
    if (!textToVideoOnly && !startFrame?.imageUrl) throw new Error('Cảnh chưa có khung đầu để tạo video.');
    const duration = Math.max(1, Number(action.input?.duration || shot.interval?.duration || getDefaultVideoDuration()));
    const prompt = buildVideoPrompt(project, shot);
    const commitVideo = (videoUrl: string): ProjectState => ({
      ...project,
      shots: project.shots.map((item) => sameId(item.id, shot.id) ? clearShotStaleFlag({
        ...item,
        interval: {
          id: item.interval?.id || `${item.id}-interval`,
          startKeyframeId: startFrame?.id || '',
          endKeyframeId: endFrame?.id || '',
          duration,
          motionStrength: item.interval?.motionStrength ?? 5,
          videoUrl,
          videoPrompt: prompt,
          textToVideoOnly,
          status: 'completed',
        },
      }, 'video') : item),
    });
    await generateVideoWithModel({
      prompt,
      startImage: textToVideoOnly ? undefined : startFrame?.imageUrl,
      endImage: textToVideoOnly ? undefined : endFrame?.imageUrl,
      aspectRatio: shot.factory?.aspectRatio || aspectRatio,
      duration,
      usageResourceId: `${shot.id}:video`,
      execution: execution('video', 'director', shot.id, shot.interval?.videoUrl, commitVideo),
    }, getFactoryModelId(project, shot, 'video'));
    return project;
  }

  if (action.tool === 'generate-voice') {
    const studio = project.voiceStudio;
    const profile = getVoiceProfile(project, shot);
    if (!studio || !profile) throw new Error('Chưa gán hồ sơ giọng cho nhân vật.');
    const provider = getVoiceProvider(profile.providerId);
    if (!provider.supportsGeneration || profile.providerId === 'human') throw new Error('Hồ sơ này không hỗ trợ tạo giọng tự động.');
    if (!profile.voiceId.trim()) throw new Error('Hồ sơ giọng chưa có Voice ID.');
    if (!isVoiceProviderConfigured(profile.providerId)) throw new Error(`Chưa cấu hình khóa ${provider.name}.`);
    const text = shot.dialogue?.trim();
    if (!text) throw new Error('Cảnh không có câu thoại để tạo.');
    const result = await generateVoice({
      providerId: profile.providerId,
      text,
      voiceId: profile.voiceId,
      speed: profile.speed,
      pitch: profile.pitch,
      emotion: profile.emotion,
      pronunciationDictionary: studio.pronunciationDictionary,
      outputFormat: studio.outputFormat,
      masterAudio: studio.normalizeLoudness,
    });
    const take: VoiceTake = {
      id: createId('voice_take'),
      shotId: shot.id,
      characterId: getSpeakerId(project, shot),
      text,
      source: 'synthetic',
      providerId: profile.providerId,
      voiceId: profile.voiceId,
      voiceName: profile.voiceName,
      status: 'ready',
      audioUrl: result.audioUrl,
      duration: result.duration,
      fileName: result.fileName,
      sourceHash: createVoiceSourceHash(text, profile.voiceId, profile.speed, profile.emotion || 'neutral', profile.pitch ?? 0),
      emotion: profile.emotion,
      pitch: profile.pitch,
      mastered: Boolean(result.mastering),
      masteringGainDb: result.mastering?.gainDb,
      trimmedSeconds: result.mastering?.trimmedSeconds,
      masteringSkippedReason: result.masteringSkippedReason,
      createdAt: Date.now(),
    };
    return {
      ...project,
      voiceStudio: {
        ...studio,
        takes: [take, ...studio.takes],
        selectedTakeByShot: { ...studio.selectedTakeByShot, [shot.id]: take.id },
      },
      shots: project.shots.map((item) => sameId(item.id, shot.id) ? clearShotStaleFlag(item, 'voice') : item),
    };
  }

  throw new Error('Công cụ agent chưa được hỗ trợ.');
};
