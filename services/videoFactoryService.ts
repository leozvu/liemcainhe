import {
  AspectRatio,
  ProjectState,
  Shot,
  VideoFactoryPolicy,
  VideoFactoryState,
  VideoFactoryVariant,
  VideoFactoryVoiceMode,
} from '../types';
import { getActiveModelsConfig } from './modelRegistry';
import { getUsagePolicy } from './usageService';
import {
  addProductionJob,
  createProductionJob,
  createProjectCheckpoint,
  patchProductionJob,
} from './workflowService';

const createId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const uniqueText = (items: string[], fallback: string): string[] => Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, 20).length
  ? Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, 20)
  : [fallback];

export const createDefaultVideoFactoryState = (): VideoFactoryState => {
  const active = getActiveModelsConfig();
  const now = Date.now();
  return {
    hooks: [],
    ctas: [],
    aspectRatios: ['9:16'],
    durations: [15],
    voiceModes: ['with-voice'],
    audiences: [],
    variants: [],
    policy: {
      draftImageModelId: active.image,
      draftVideoModelId: active.video,
      finalImageModelId: active.image,
      finalVideoModelId: active.video,
      maxVariants: 30,
      budgetLimitUsd: 20,
      reuseAssets: true,
    },
    createdAt: now,
    updatedAt: now,
  };
};

export const normalizeVideoFactoryState = (value?: Partial<VideoFactoryState> | null): VideoFactoryState => {
  const defaults = createDefaultVideoFactoryState();
  if (!value) return defaults;
  const ratios = (Array.isArray(value.aspectRatios) ? value.aspectRatios : defaults.aspectRatios)
    .filter((item): item is AspectRatio => ['9:16', '1:1', '16:9'].includes(item));
  const voiceModes = (Array.isArray(value.voiceModes) ? value.voiceModes : defaults.voiceModes)
    .filter((item): item is VideoFactoryVoiceMode => ['with-voice', 'no-voice'].includes(item));
  return {
    ...defaults,
    ...value,
    hooks: Array.isArray(value.hooks) ? value.hooks : [],
    ctas: Array.isArray(value.ctas) ? value.ctas : [],
    aspectRatios: ratios.length ? Array.from(new Set(ratios)) : defaults.aspectRatios,
    durations: Array.from(new Set((Array.isArray(value.durations) ? value.durations : defaults.durations)
      .map(Number).filter((item) => item >= 4 && item <= 180))).slice(0, 8),
    voiceModes: voiceModes.length ? Array.from(new Set(voiceModes)) : defaults.voiceModes,
    audiences: Array.isArray(value.audiences) ? value.audiences : [],
    variants: Array.isArray(value.variants) ? value.variants : [],
    policy: { ...defaults.policy, ...(value.policy || {}) },
    createdAt: Number(value.createdAt) || defaults.createdAt,
    updatedAt: Number(value.updatedAt) || Date.now(),
  };
};

export interface VideoFactoryPlanInput {
  hooks: string[];
  ctas: string[];
  aspectRatios: AspectRatio[];
  durations: number[];
  voiceModes: VideoFactoryVoiceMode[];
  audiences: string[];
  policy: VideoFactoryPolicy;
}

const estimateVariantCost = (project: ProjectState, duration: number, voiceMode: VideoFactoryVoiceMode): number => {
  const rates = getUsagePolicy().rates;
  const sourceShots = project.shots.filter((shot) => !shot.factory);
  const imageCost = sourceShots.length * 2 * rates.imagePerOutput;
  const videoCost = duration * rates.videoPerSecond;
  const voiceCharacters = voiceMode === 'with-voice'
    ? sourceShots.reduce((sum, shot) => sum + (shot.dialogue?.length || 0), 0)
    : 0;
  const voiceCost = (voiceCharacters / 1000) * rates.voicePerThousandCharacters;
  return Number((imageCost + videoCost + voiceCost).toFixed(4));
};

const variantKey = (variant: Pick<VideoFactoryVariant, 'hook' | 'cta' | 'aspectRatio' | 'duration' | 'voiceMode' | 'audience'>): string => [
  variant.hook,
  variant.cta,
  variant.aspectRatio,
  variant.duration,
  variant.voiceMode,
  variant.audience,
].join('::').toLocaleLowerCase('vi');

export const createVideoFactoryPlan = (project: ProjectState, input: VideoFactoryPlanInput): ProjectState => {
  const sourceShots = project.shots.filter((shot) => !shot.factory);
  if (!sourceShots.length) throw new Error('Cần có storyboard/shot list trước khi tạo ma trận Video Factory.');
  const hooks = uniqueText(input.hooks, sourceShots[0]?.actionSummary || 'Hook chính');
  const ctas = uniqueText(input.ctas, project.brandKitSnapshot?.ctas[0] || 'CTA chính');
  const audiences = uniqueText(input.audiences, 'Nhóm khách hàng chính');
  const ratios = Array.from(new Set(input.aspectRatios)).filter((item): item is AspectRatio => ['9:16', '1:1', '16:9'].includes(item));
  const durations = Array.from(new Set(input.durations.map(Number))).filter((item) => item >= 4 && item <= 180);
  const voiceModes = Array.from(new Set(input.voiceModes));
  if (!ratios.length || !durations.length || !voiceModes.length) throw new Error('Hãy chọn ít nhất một tỷ lệ, thời lượng và chế độ voice.');
  const all: Array<Omit<VideoFactoryVariant, 'id' | 'name' | 'tier' | 'status' | 'estimatedCostUsd' | 'shotIds' | 'createdAt' | 'updatedAt'>> = [];
  hooks.forEach((hook) => ctas.forEach((cta) => ratios.forEach((aspectRatio) => durations.forEach((duration) => voiceModes.forEach((voiceMode) => audiences.forEach((audience) => {
    all.push({ hook, cta, aspectRatio, duration, voiceMode, audience });
  }))))));
  const maxVariants = Math.max(1, Math.min(120, Math.round(input.policy.maxVariants || 30)));
  const stride = Math.max(1, all.length / maxVariants);
  const sampled = Array.from({ length: Math.min(maxVariants, all.length) }, (_, index) => all[Math.floor(index * stride)]);
  const current = normalizeVideoFactoryState(project.videoFactory);
  const existingKeys = new Set(current.variants.map(variantKey));
  const now = Date.now();
  const created = sampled.filter((item) => !existingKeys.has(variantKey(item))).map((item, index): VideoFactoryVariant => ({
    id: createId('factory_variant'),
    name: `V${current.variants.length + index + 1} · ${item.aspectRatio} · ${item.duration}s · ${item.voiceMode === 'with-voice' ? 'Voice' : 'No voice'}`,
    ...item,
    tier: 'draft',
    status: 'planned',
    estimatedCostUsd: estimateVariantCost(project, item.duration, item.voiceMode),
    shotIds: [],
    createdAt: now,
    updatedAt: now,
  }));
  if (!created.length) throw new Error('Ma trận này đã tồn tại. Hãy thay đổi hook, CTA hoặc định dạng.');
  return {
    ...project,
    videoFactory: {
      ...current,
      hooks,
      ctas,
      aspectRatios: ratios,
      durations,
      voiceModes,
      audiences,
      variants: [...current.variants, ...created].slice(0, 240),
      policy: { ...input.policy, maxVariants, budgetLimitUsd: Math.max(0, Number(input.policy.budgetLimitUsd) || 0) },
      updatedAt: now,
    },
  };
};

const scaleShotDurations = (shots: Shot[], targetDuration: number): number[] => {
  const weights = shots.map((shot) => Math.max(1, Number(shot.interval?.duration || 8)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const raw = weights.map((weight) => Math.max(1, Math.round((weight / total) * targetDuration)));
  const delta = targetDuration - raw.reduce((sum, value) => sum + value, 0);
  raw[raw.length - 1] = Math.max(1, raw[raw.length - 1] + delta);
  return raw;
};

const activeFactoryCost = (state: VideoFactoryState, excludingId?: string): number => state.variants
  .filter((variant) => variant.id !== excludingId && ['materialized', 'approved', 'ready'].includes(variant.status))
  .reduce((sum, variant) => sum + variant.estimatedCostUsd, 0);

export const materializeVideoFactoryVariant = (project: ProjectState, variantId: string): ProjectState => {
  const state = normalizeVideoFactoryState(project.videoFactory);
  const variant = state.variants.find((item) => item.id === variantId);
  if (!variant) throw new Error('Không tìm thấy biến thể Video Factory.');
  if (variant.shotIds.length) return project;
  const committedCost = activeFactoryCost(state);
  if (state.policy.budgetLimitUsd > 0 && committedCost + variant.estimatedCostUsd > state.policy.budgetLimitUsd) {
    throw new Error(`Biến thể này sẽ vượt trần $${state.policy.budgetLimitUsd.toFixed(2)}. Hãy bỏ bớt biến thể hoặc tăng ngân sách.`);
  }
  const baseShots = project.shots.filter((shot) => !shot.factory);
  if (!baseShots.length) throw new Error('Không còn shot nguồn để tạo biến thể.');
  const durations = scaleShotDurations(baseShots, variant.duration);
  const now = Date.now();
  const shotIds: string[] = [];
  const cloned = baseShots.map((shot, index): Shot => {
    const id = `${shot.id}_${variant.id}`;
    shotIds.push(id);
    const first = index === 0;
    const last = index === baseShots.length - 1;
    const audienceNote = variant.audience ? `Điều chỉnh nhịp kể và ngôn ngữ cho nhóm: ${variant.audience}.` : '';
    const actionSummary = [first ? `HOOK: ${variant.hook}` : '', shot.actionSummary, last ? `CTA: ${variant.cta}` : '', audienceNote]
      .filter(Boolean).join(' ');
    const dialogue = variant.voiceMode === 'no-voice'
      ? undefined
      : [first ? variant.hook : '', shot.dialogue || '', last ? variant.cta : ''].filter(Boolean).join(' ');
    return {
      ...shot,
      id,
      actionSummary,
      dialogue,
      keyframes: shot.keyframes.map((frame) => ({
        ...frame,
        id: `${frame.id}_${variant.id}`,
        imageUrl: undefined,
        status: 'pending',
      })),
      interval: {
        ...(shot.interval || {
          id: `interval_${id}`,
          startKeyframeId: `${id}_start`,
          endKeyframeId: `${id}_end`,
          motionStrength: 0.5,
          status: 'pending' as const,
        }),
        id: `${shot.interval?.id || `interval_${shot.id}`}_${variant.id}`,
        startKeyframeId: `${shot.interval?.startKeyframeId || `${shot.id}_start`}_${variant.id}`,
        endKeyframeId: `${shot.interval?.endKeyframeId || `${shot.id}_end`}_${variant.id}`,
        duration: durations[index],
        videoUrl: undefined,
        status: 'pending',
      },
      workflow: { keyframesStale: true, voiceStale: variant.voiceMode === 'with-voice', videoStale: true, approved: false, updatedAt: now },
      factory: {
        variantId: variant.id,
        sourceShotId: shot.id,
        aspectRatio: variant.aspectRatio,
        targetDuration: variant.duration,
        voiceMode: variant.voiceMode,
        audience: variant.audience,
        tier: 'draft',
      },
    };
  });
  const job = createProductionJob({
    kind: 'video-factory',
    stage: 'director',
    label: `Video Factory · ${variant.name}`,
    totalUnits: cloned.length,
    resourceId: variant.id,
    detail: `Đã tạo ${cloned.length} shot draft. Chưa gọi API media.`,
  });
  const withJob = addProductionJob(project, job);
  return {
    ...withJob,
    shots: [...project.shots, ...cloned],
    videoFactory: {
      ...state,
      variants: state.variants.map((item) => item.id === variant.id ? {
        ...item,
        status: 'materialized',
        shotIds,
        updatedAt: now,
      } : item),
      updatedAt: now,
    },
  };
};

export const approveVideoFactoryVariant = (project: ProjectState, variantId: string): ProjectState => {
  const checkpointed = createProjectCheckpoint(project, 'Trước khi nâng biến thể lên model final');
  const state = normalizeVideoFactoryState(checkpointed.videoFactory);
  const variant = state.variants.find((item) => item.id === variantId);
  if (!variant || !variant.shotIds.length) throw new Error('Hãy tạo shot draft trước khi duyệt lên final.');
  const now = Date.now();
  return {
    ...checkpointed,
    shots: checkpointed.shots.map((shot) => shot.factory?.variantId === variantId ? {
      ...shot,
      keyframes: shot.keyframes.map((frame) => ({ ...frame, imageUrl: undefined, status: 'pending' })),
      interval: shot.interval ? { ...shot.interval, videoUrl: undefined, status: 'pending' } : shot.interval,
      workflow: { ...shot.workflow, keyframesStale: true, videoStale: true, approved: false, updatedAt: now },
      factory: { ...shot.factory, tier: 'final' },
    } : shot),
    videoFactory: {
      ...state,
      variants: state.variants.map((item) => item.id === variantId ? { ...item, tier: 'final', status: 'approved', updatedAt: now } : item),
      updatedAt: now,
    },
  };
};

export const removeVideoFactoryVariant = (project: ProjectState, variantId: string): ProjectState => {
  const state = normalizeVideoFactoryState(project.videoFactory);
  return {
    ...project,
    shots: project.shots.filter((shot) => shot.factory?.variantId !== variantId),
    videoFactory: {
      ...state,
      variants: state.variants.filter((variant) => variant.id !== variantId),
      updatedAt: Date.now(),
    },
  };
};

export const syncVideoFactoryProgress = (project: ProjectState): ProjectState => {
  const state = normalizeVideoFactoryState(project.videoFactory);
  let next = project;
  const variants = state.variants.map((variant) => {
    if (!variant.shotIds.length) return variant;
    const shots = project.shots.filter((shot) => variant.shotIds.includes(shot.id));
    const ready = shots.length > 0 && shots.every((shot) => Boolean(shot.interval?.videoUrl) && !shot.workflow?.videoStale);
    const job = project.workflow?.jobs.find((item) => item.resourceId === variant.id && item.kind === 'video-factory');
    if (job) next = patchProductionJob(next, job.id, {
      status: ready ? 'completed' : job.status,
      completedUnits: shots.filter((shot) => Boolean(shot.interval?.videoUrl) && !shot.workflow?.videoStale).length,
      progress: shots.length ? Math.round((shots.filter((shot) => Boolean(shot.interval?.videoUrl) && !shot.workflow?.videoStale).length / shots.length) * 100) : 0,
    });
    return ready ? { ...variant, status: 'ready' as const, updatedAt: Date.now() } : variant;
  });
  return { ...next, videoFactory: { ...state, variants, updatedAt: Date.now() } };
};

export const getVideoFactoryRuntimeState = (project: ProjectState): VideoFactoryState => {
  const state = normalizeVideoFactoryState(project.videoFactory);
  return {
    ...state,
    variants: state.variants.map((variant) => {
      if (!variant.shotIds.length) return variant;
      const shots = project.shots.filter((shot) => variant.shotIds.includes(shot.id));
      const ready = shots.length > 0 && shots.every((shot) => Boolean(shot.interval?.videoUrl) && !shot.workflow?.videoStale);
      return ready ? { ...variant, status: 'ready' as const } : variant;
    }),
  };
};

export const getVideoFactorySummary = (project: ProjectState) => {
  const state = getVideoFactoryRuntimeState(project);
  return {
    total: state.variants.length,
    planned: state.variants.filter((variant) => variant.status === 'planned').length,
    materialized: state.variants.filter((variant) => variant.status === 'materialized').length,
    approved: state.variants.filter((variant) => variant.status === 'approved').length,
    ready: state.variants.filter((variant) => variant.status === 'ready').length,
    committedCostUsd: Number(activeFactoryCost(state).toFixed(4)),
    plannedCostUsd: Number(state.variants.reduce((sum, variant) => sum + variant.estimatedCostUsd, 0).toFixed(4)),
  };
};
