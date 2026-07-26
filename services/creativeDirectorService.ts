import {
  CoreStage,
  CreativeDirectorPlanStep,
  CreativeDirectorProposal,
  CreativeDirectorProposalChanges,
  CreativeDirectorProposalKind,
  CreativeDirectorRun,
  CreativeDirectorShotDraft,
  CreativeDirectorState,
  MoodboardSpec,
  ProjectState,
  Shot,
} from '../types';
import { chatJson } from './modelService';
import { parseModelJson } from './jsonResponse';
import { getActiveChatModel, getActiveImageModel, getActiveVideoModel } from './modelRegistry';
import { getUsagePolicy } from './usageService';
import {
  addProductionJob,
  createProductionJob,
  createProjectCheckpoint,
  patchProductionJob,
  setProductionJobStatus,
  stageForProjectStage,
} from './workflowService';
import { normalizeCreativeDirectorState } from './creativeDirectorState';
import { buildBrandKitPromptContext, inspectBrandCompliance } from './brandKitService';

const CORE_STAGES: CoreStage[] = ['script', 'assets', 'voice', 'director', 'export'];
const PROPOSAL_KINDS: CreativeDirectorProposalKind[] = ['script', 'storyboard', 'moodboard', 'production-plan', 'timeline'];
const MAX_CONTEXT_SCRIPT = 16_000;
const MAX_CONTEXT_SHOTS = 80;

const id = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const text = (value: unknown, fallback = '', max = 12_000): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : fallback;
const list = (value: unknown, max = 20): string[] =>
  Array.isArray(value) ? value.map((item) => text(item, '', 500)).filter(Boolean).slice(0, max) : [];
const amount = (value: unknown): number => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export interface CreativeDirectorCostEstimate {
  totalUsd: number;
  imageUsd: number;
  videoUsd: number;
  voiceUsd: number;
  planningUsd: number;
  missingImages: number;
  missingVideos: number;
  videoSeconds: number;
  voiceCharacters: number;
}

export interface CreativeDirectorResult {
  message: string;
  diagnosis: string[];
  plan: CreativeDirectorPlanStep[];
  proposal?: CreativeDirectorProposal;
  memory: string[];
  suggestedReplies: string[];
}

export const estimateRemainingProductionCost = (project: ProjectState): CreativeDirectorCostEstimate => {
  const policy = getUsagePolicy();
  const characters = project.scriptData?.characters || [];
  const scenes = project.scriptData?.scenes || [];
  const missingImages = characters.filter((item) => !item.referenceImage).length
    + scenes.filter((item) => !item.referenceImage).length;
  const missingShots = project.shots.filter((shot) => !shot.interval?.videoUrl);
  const videoSeconds = missingShots.reduce((sum, shot) => sum + Math.max(1, shot.interval?.duration || 8), 0);
  const studio = project.voiceStudio;
  const missingDialogue = project.shots.filter((shot) => {
    if (!shot.dialogue?.trim()) return false;
    const selectedId = studio?.selectedTakeByShot[shot.id];
    return !studio?.takes.some((take) => take.id === selectedId && take.status === 'ready' && take.audioUrl);
  });
  const voiceCharacters = missingDialogue.reduce((sum, shot) => sum + (shot.dialogue?.length || 0), 0);
  const planningCharacters = Math.min(MAX_CONTEXT_SCRIPT, project.rawScript.length) + project.shots.length * 180;
  const imageUsd = missingImages * policy.rates.imagePerOutput;
  const videoUsd = videoSeconds * policy.rates.videoPerSecond;
  const voiceUsd = (voiceCharacters / 1000) * policy.rates.voicePerThousandCharacters;
  const planningUsd = (planningCharacters / 1_000_000) * policy.rates.chatPerMillionCharacters;
  return {
    totalUsd: Number((imageUsd + videoUsd + voiceUsd + planningUsd).toFixed(4)),
    imageUsd: Number(imageUsd.toFixed(4)),
    videoUsd: Number(videoUsd.toFixed(4)),
    voiceUsd: Number(voiceUsd.toFixed(4)),
    planningUsd: Number(planningUsd.toFixed(4)),
    missingImages,
    missingVideos: missingShots.length,
    videoSeconds,
    voiceCharacters,
  };
};

const sanitizeMoodboard = (value: unknown): MoodboardSpec | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const palette = Array.isArray(source.palette)
    ? source.palette.map((item) => {
        const color = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const rawHex = text(color.hex, '#707b89', 16);
        return {
          name: text(color.name, 'Màu chủ đạo', 80),
          hex: /^#[0-9a-f]{6}$/i.test(rawHex) ? rawHex.toUpperCase() : '#707B89',
          usage: text(color.usage, 'Sử dụng theo ngữ cảnh', 200),
        };
      }).slice(0, 8)
    : [];
  return {
    title: text(source.title, 'Moodboard dự án', 160),
    creativeDirection: text(source.creativeDirection, '', 1600),
    palette,
    lighting: list(source.lighting, 10),
    camera: list(source.camera, 10),
    textures: list(source.textures, 10),
    wardrobe: list(source.wardrobe, 10),
    typography: list(source.typography, 8),
    references: list(source.references, 12),
    avoid: list(source.avoid, 12),
  };
};

const sanitizeShotDrafts = (value: unknown): CreativeDirectorShotDraft[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    const shot = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      id: text(shot.id, '', 160) || undefined,
      sceneId: text(shot.sceneId, '', 160),
      actionSummary: text(shot.actionSummary, 'Cảnh quay chưa có mô tả', 2000),
      dialogue: text(shot.dialogue, '', 2000) || undefined,
      cameraMovement: text(shot.cameraMovement, 'Máy quay tĩnh', 300),
      shotSize: text(shot.shotSize, 'Trung cảnh', 160),
      characters: list(shot.characters, 20),
      duration: Math.min(30, Math.max(1, amount(shot.duration) || 8)),
      startFramePrompt: text(shot.startFramePrompt, '', 2000) || undefined,
      endFramePrompt: text(shot.endFramePrompt, '', 2000) || undefined,
    };
  }).filter((shot) => shot.actionSummary).slice(0, 120);
};

const sanitizeChanges = (value: unknown): CreativeDirectorProposalChanges => {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const timeline = Array.isArray(source.timeline)
    ? source.timeline.map((item) => {
        const entry = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const transition = ['cut', 'crossfade', 'fade-black'].includes(String(entry.transition))
          ? entry.transition as 'cut' | 'crossfade' | 'fade-black'
          : 'cut';
        return {
          shotId: text(entry.shotId, '', 160),
          duration: Math.min(60, Math.max(1, amount(entry.duration) || 8)),
          transition,
          transitionDuration: transition === 'cut' ? 0 : Math.min(2, amount(entry.transitionDuration) || 0.4),
          audioNote: text(entry.audioNote, '', 500) || undefined,
          editNote: text(entry.editNote, '', 500) || undefined,
        };
      }).filter((item) => item.shotId).slice(0, 160)
    : undefined;
  return {
    rawScript: text(source.rawScript, '', 80_000) || undefined,
    targetDuration: text(source.targetDuration, '', 40) || undefined,
    visualStyle: text(source.visualStyle, '', 300) || undefined,
    shots: sanitizeShotDrafts(source.shots),
    moodboard: sanitizeMoodboard(source.moodboard),
    productionPlan: Array.isArray(source.productionPlan) ? list(source.productionPlan, 30) : undefined,
    timeline,
  };
};

const sanitizePlan = (value: unknown): CreativeDirectorPlanStep[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const step = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const stage = CORE_STAGES.includes(step.stage as CoreStage) ? step.stage as CoreStage : 'script';
    const status = ['suggested', 'ready', 'blocked'].includes(String(step.status))
      ? step.status as CreativeDirectorPlanStep['status']
      : 'suggested';
    return {
      id: text(step.id, `agent_step_${index + 1}`, 120),
      title: text(step.title, `Bước ${index + 1}`, 160),
      detail: text(step.detail, '', 600),
      stage,
      status,
    };
  }).slice(0, 20);
};

const projectContext = (project: ProjectState): string => JSON.stringify({
  project: {
    id: project.id,
    title: project.title,
    stage: project.stage,
    targetDuration: project.targetDuration,
    language: project.language,
    visualStyle: project.visualStyle,
  },
  models: {
    chat: getActiveChatModel()?.name || 'Chưa cấu hình',
    image: getActiveImageModel()?.name || 'Chưa cấu hình',
    video: getActiveVideoModel()?.name || 'Chưa cấu hình',
  },
  script: project.rawScript.slice(0, MAX_CONTEXT_SCRIPT),
  scriptData: project.scriptData ? {
    title: project.scriptData.title,
    genre: project.scriptData.genre,
    logline: project.scriptData.logline,
    characters: project.scriptData.characters.map((character) => ({
      id: character.id,
      name: character.name,
      age: character.age,
      personality: character.personality,
      hasReference: Boolean(character.referenceImage),
    })),
    scenes: project.scriptData.scenes.map((scene) => ({
      id: scene.id,
      location: scene.location,
      time: scene.time,
      atmosphere: scene.atmosphere,
      hasReference: Boolean(scene.referenceImage),
    })),
  } : null,
  shots: project.shots.slice(0, MAX_CONTEXT_SHOTS).map((shot) => ({
    id: shot.id,
    sceneId: shot.sceneId,
    actionSummary: shot.actionSummary,
    dialogue: shot.dialogue,
    cameraMovement: shot.cameraMovement,
    shotSize: shot.shotSize,
    characters: shot.characters,
    duration: shot.interval?.duration || 8,
    hasVideo: Boolean(shot.interval?.videoUrl),
  })),
  approvedMemory: normalizeCreativeDirectorState(project.creativeDirector).memory,
  currentMoodboard: project.creativeDirector?.moodboard || null,
  brandGuard: project.brandKitSnapshot ? buildBrandKitPromptContext(project.brandKitSnapshot) : 'Dự án chưa liên kết Brand Kit.',
  remainingCostEstimate: estimateRemainingProductionCost(project),
}, null, 2);

const SYSTEM_PROMPT = `Bạn là Đạo diễn AI của Egoric Film Studio, một cố vấn sản xuất điện ảnh cao cấp bằng tiếng Việt.

Nhiệm vụ của bạn:
- Phản biện và phát triển kịch bản, storyboard, moodboard, kế hoạch sản xuất và timeline dựng.
- Luôn dựa trên dữ liệu dự án được cung cấp; không bịa rằng một ảnh, giọng hoặc video đã được tạo.
- Ưu tiên continuity nhân vật, bối cảnh, ánh sáng, nhịp kể và khả năng sản xuất thực tế.
- Xem Brand Kit/Brand Guard trong dữ liệu dự án là nguồn sự thật bắt buộc; không dùng từ cấm, không đổi cách gọi sản phẩm và phải cảnh báo khi brief xung đột thương hiệu.
- Không tự gọi công cụ trả phí. Chỉ đề xuất thay đổi có cấu trúc để ứng dụng cho người dùng duyệt.
- Trả lời hoàn toàn bằng tiếng Việt tự nhiên, không dùng thuật ngữ tiếng Trung và không nhắc tới nguồn gốc phần mềm.
- Nếu thông tin chưa đủ, vẫn đưa ra chẩn đoán hữu ích và hỏi tối đa một câu ngắn trong message.
- Chi phí trong proposal chỉ là chi phí media dự kiến; dùng 0 nếu proposal chỉ sửa văn bản/cấu trúc.

Chỉ trả về một đối tượng JSON hợp lệ theo schema:
{
  "message": "Câu trả lời trực tiếp, rõ ràng",
  "diagnosis": ["Nhận định quan trọng"],
  "plan": [{"id":"step_1","title":"Tên bước","detail":"Cách làm","stage":"script|assets|voice|director|export","status":"suggested|ready|blocked"}],
  "proposal": null hoặc {
    "kind":"script|storyboard|moodboard|production-plan|timeline",
    "title":"Tên đề xuất",
    "summary":"Tóm tắt thay đổi",
    "rationale":["Lý do"],
    "affectedShotIds":["shot_id"],
    "estimatedCostUsd":0,
    "requiresApproval":true,
    "changes":{
      "rawScript":"chỉ có khi người dùng yêu cầu viết/sửa kịch bản",
      "targetDuration":"tùy chọn",
      "visualStyle":"tùy chọn",
      "shots":[{"id":"tùy chọn","sceneId":"scene_id","actionSummary":"...","dialogue":"...","cameraMovement":"...","shotSize":"...","characters":["character_id"],"duration":8,"startFramePrompt":"...","endFramePrompt":"..."}],
      "moodboard":{"title":"...","creativeDirection":"...","palette":[{"name":"...","hex":"#RRGGBB","usage":"..."}],"lighting":[],"camera":[],"textures":[],"wardrobe":[],"typography":[],"references":[],"avoid":[]},
      "productionPlan":["Bước sản xuất"],
      "timeline":[{"shotId":"shot_id","duration":8,"transition":"cut|crossfade|fade-black","transitionDuration":0.4,"audioNote":"...","editNote":"..."}]
    }
  },
  "memory":["Chỉ lưu quyết định hoặc sở thích dài hạn đã được người dùng thể hiện"],
  "suggestedReplies":["Câu trả lời nhanh tiếp theo"]
}

Chỉ đưa đúng các trường changes liên quan đến yêu cầu hiện tại. Không thay toàn bộ storyboard nếu người dùng chỉ hỏi tư vấn.`;

export const consultCreativeDirector = async (
  project: ProjectState,
  query: string,
): Promise<CreativeDirectorResult> => {
  const state = normalizeCreativeDirectorState(project.creativeDirector);
  const recentMessages = state.messages.at(-1)?.role === 'user' && state.messages.at(-1)?.content === query
    ? state.messages.slice(-9, -1)
    : state.messages.slice(-8);
  const history = recentMessages.map((message) => `${message.role === 'user' ? 'Người dùng' : 'Đạo diễn AI'}: ${message.content}`).join('\n');
  const prompt = `CHẾ ĐỘ: ${state.mode}\nNGÂN SÁCH TỐI ĐA CHO MEDIA TRONG LẦN CHẠY: $${state.budgetLimitUsd.toFixed(2)}\n\nLỊCH SỬ GẦN ĐÂY:\n${history || 'Chưa có'}\n\nDỮ LIỆU DỰ ÁN:\n${projectContext(project)}\n\nYÊU CẦU MỚI:\n${query}`;
  const raw = await chatJson({
    systemPrompt: SYSTEM_PROMPT,
    prompt,
    timeout: 180_000,
    overrideParams: { temperature: 0.45 },
  });
  const parsed = parseModelJson<Record<string, unknown>>(raw);
  const plan = sanitizePlan(parsed.plan);
  let proposal: CreativeDirectorProposal | undefined;
  if (parsed.proposal && typeof parsed.proposal === 'object') {
    const source = parsed.proposal as Record<string, unknown>;
    const kind = PROPOSAL_KINDS.includes(source.kind as CreativeDirectorProposalKind)
      ? source.kind as CreativeDirectorProposalKind
      : 'production-plan';
    const estimatedCostUsd = amount(source.estimatedCostUsd);
    proposal = {
      id: id('proposal'),
      kind,
      title: text(source.title, 'Đề xuất của Đạo diễn AI', 200),
      summary: text(source.summary, '', 1500),
      rationale: list(source.rationale, 12),
      affectedShotIds: list(source.affectedShotIds, 160),
      estimatedCostUsd,
      requiresApproval: true,
      status: 'pending',
      changes: sanitizeChanges(source.changes),
      createdAt: Date.now(),
    };
  }
  const complianceContent = proposal ? [
    proposal.summary,
    proposal.changes.rawScript || '',
    ...(proposal.changes.shots || []).flatMap((shot) => [shot.dialogue || '', shot.actionSummary || '']),
  ].filter(Boolean).join('\n') : '';
  const compliance = project.brandKitSnapshot && complianceContent
    ? inspectBrandCompliance(complianceContent, project.brandKitSnapshot)
    : undefined;
  const diagnosis = list(parsed.diagnosis, 16);
  if (compliance && (!compliance.passed || compliance.warnings.length)) {
    diagnosis.unshift(`Brand Guard ${compliance.score}/100: ${[...compliance.violations, ...compliance.warnings].join('; ')}`);
  }
  return {
    message: text(parsed.message, 'Tôi đã phân tích dự án và chuẩn bị đề xuất.', 6000),
    diagnosis: diagnosis.slice(0, 16),
    plan,
    proposal,
    memory: list(parsed.memory, 12),
    suggestedReplies: list(parsed.suggestedReplies, 4),
  };
};

export const beginCreativeDirectorRun = (
  project: ProjectState,
  query: string,
): { project: ProjectState; run: CreativeDirectorRun } => {
  const state = normalizeCreativeDirectorState(project.creativeDirector);
  const now = Date.now();
  const run: CreativeDirectorRun = {
    id: id('director_run'),
    query,
    status: 'thinking',
    startedAt: now,
  };
  const job = createProductionJob({
    kind: 'creative-director',
    stage: stageForProjectStage(project.stage),
    label: 'Đạo diễn AI đang phân tích dự án',
    totalUnits: 1,
    resourceId: run.id,
    detail: query.slice(0, 240),
  });
  run.jobId = job.id;
  const withJob = setProductionJobStatus(addProductionJob(project, job), job.id, 'running');
  return {
    run,
    project: {
      ...withJob,
      creativeDirector: {
        ...state,
        messages: [...state.messages, { id: id('director_message'), role: 'user' as const, content: query, createdAt: now }].slice(-100),
        runs: [run, ...state.runs].slice(0, 50),
      },
    },
  };
};

export const completeCreativeDirectorRun = (
  project: ProjectState,
  runId: string,
  result: CreativeDirectorResult,
): ProjectState => {
  const state = normalizeCreativeDirectorState(project.creativeDirector);
  const now = Date.now();
  const proposals = result.proposal ? [result.proposal, ...state.proposals].slice(0, 50) : state.proposals;
  const status = result.proposal ? 'awaiting-approval' as const : 'completed' as const;
  const completed: ProjectState = {
    ...project,
    creativeDirector: {
      ...state,
      proposals,
      plan: result.plan.length ? result.plan : state.plan,
      memory: Array.from(new Set([...state.memory, ...result.memory])).slice(-40),
      messages: [...state.messages, {
        id: id('director_message'),
        role: 'assistant' as const,
        content: result.message,
        createdAt: now,
        proposalId: result.proposal?.id,
      }].slice(-100),
      runs: state.runs.map((run) => run.id === runId ? {
        ...run,
        status,
        completedAt: now,
        proposalId: result.proposal?.id,
      } : run),
    },
  };
  const jobId = state.runs.find((run) => run.id === runId)?.jobId;
  if (!jobId) return completed;
  const withCompletedStatus = setProductionJobStatus(completed, jobId, 'completed');
  return patchProductionJob(withCompletedStatus, jobId, { completedUnits: 1 });
};

export const failCreativeDirectorRun = (
  project: ProjectState,
  runId: string,
  error: string,
): ProjectState => {
  const state = normalizeCreativeDirectorState(project.creativeDirector);
  const now = Date.now();
  const failed: ProjectState = {
    ...project,
    creativeDirector: {
      ...state,
      messages: [...state.messages, {
        id: id('director_message'),
        role: 'assistant' as const,
        content: `Tôi chưa thể hoàn tất phân tích: ${error}`,
        createdAt: now,
      }].slice(-100),
      runs: state.runs.map((run) => run.id === runId ? {
        ...run,
        status: 'failed',
        completedAt: now,
        error,
      } : run),
    },
  };
  const jobId = state.runs.find((run) => run.id === runId)?.jobId;
  return jobId ? setProductionJobStatus(failed, jobId, 'failed', error) : failed;
};

const resolveCharacterIds = (project: ProjectState, values: string[]): string[] => {
  const characters = project.scriptData?.characters || [];
  return values.map((value) => {
    const normalized = value.toLocaleLowerCase('vi');
    return characters.find((character) => character.id === value || character.name.toLocaleLowerCase('vi') === normalized)?.id;
  }).filter((value): value is string => Boolean(value));
};

const buildShots = (project: ProjectState, drafts: CreativeDirectorShotDraft[]): Shot[] => {
  const sceneIds = new Set((project.scriptData?.scenes || []).map((scene) => scene.id));
  const fallbackSceneId = project.scriptData?.scenes[0]?.id || 'scene_1';
  return drafts.map((draft, index) => {
    const shotId = draft.id && /^[a-zA-Z0-9_-]{2,160}$/.test(draft.id)
      ? draft.id
      : `shot_agent_${Date.now().toString(36)}_${index + 1}`;
    return {
      id: shotId,
      sceneId: sceneIds.has(draft.sceneId) ? draft.sceneId : fallbackSceneId,
      actionSummary: draft.actionSummary,
      dialogue: draft.dialogue,
      cameraMovement: draft.cameraMovement,
      shotSize: draft.shotSize,
      characters: resolveCharacterIds(project, draft.characters),
      keyframes: [
        {
          id: `${shotId}_start`,
          type: 'start',
          visualPrompt: draft.startFramePrompt || `${draft.actionSummary}. Khung hình mở đầu, ${draft.shotSize || 'trung cảnh'}.`,
          status: 'pending',
        },
        {
          id: `${shotId}_end`,
          type: 'end',
          visualPrompt: draft.endFramePrompt || `${draft.actionSummary}. Khung hình kết thúc, chuyển động ${draft.cameraMovement}.`,
          status: 'pending',
        },
      ],
      interval: {
        id: `${shotId}_interval`,
        startKeyframeId: `${shotId}_start`,
        endKeyframeId: `${shotId}_end`,
        duration: draft.duration || 8,
        motionStrength: 0.6,
        status: 'pending',
      },
      workflow: {
        keyframesStale: false,
        voiceStale: Boolean(draft.dialogue),
        videoStale: true,
        approved: false,
        updatedAt: Date.now(),
      },
    };
  });
};

export const applyCreativeDirectorProposal = (
  project: ProjectState,
  proposalId: string,
): ProjectState => {
  const state = normalizeCreativeDirectorState(project.creativeDirector);
  const proposal = state.proposals.find((item) => item.id === proposalId && item.status === 'pending');
  if (!proposal) return project;
  const changesCoreProject = Boolean(
    proposal.changes.rawScript
    || proposal.changes.shots
    || proposal.changes.targetDuration
    || proposal.changes.visualStyle,
  );
  let next = changesCoreProject
    ? createProjectCheckpoint(project, `Trước khi áp dụng: ${proposal.title}`)
    : project;
  const now = Date.now();
  if (proposal.changes.rawScript) {
    next = {
      ...next,
      rawScript: proposal.changes.rawScript,
      scriptData: proposal.changes.shots ? next.scriptData : null,
      shots: proposal.changes.shots ? next.shots : [],
      stage: 'script',
    };
  }
  if (proposal.changes.targetDuration) next = { ...next, targetDuration: proposal.changes.targetDuration };
  if (proposal.changes.visualStyle) next = { ...next, visualStyle: proposal.changes.visualStyle };
  if (proposal.changes.shots?.length) next = { ...next, shots: buildShots(next, proposal.changes.shots), stage: 'script' };

  const current = normalizeCreativeDirectorState(next.creativeDirector);
  return {
    ...next,
    lastModified: now,
    creativeDirector: {
      ...current,
      moodboard: proposal.changes.moodboard || current.moodboard,
      productionPlan: proposal.changes.productionPlan || current.productionPlan,
      timeline: proposal.changes.timeline || current.timeline,
      proposals: current.proposals.map((item) => item.id === proposalId ? { ...item, status: 'applied', appliedAt: now } : item),
      runs: current.runs.map((run) => run.proposalId === proposalId ? { ...run, status: 'completed', completedAt: now } : run),
      messages: [...current.messages, {
        id: id('director_message'),
        role: 'assistant' as const,
        content: `Đã áp dụng “${proposal.title}”. Tôi đã tạo checkpoint trước khi thay đổi nội dung cốt lõi để bạn có thể khôi phục nếu cần.`,
        createdAt: now,
      }].slice(-100),
    },
  };
};

export const rejectCreativeDirectorProposal = (
  project: ProjectState,
  proposalId: string,
): ProjectState => {
  const state = normalizeCreativeDirectorState(project.creativeDirector);
  return {
    ...project,
    creativeDirector: {
      ...state,
      proposals: state.proposals.map((item) => item.id === proposalId ? { ...item, status: 'rejected' } : item),
      runs: state.runs.map((run) => run.proposalId === proposalId ? { ...run, status: 'completed', completedAt: Date.now() } : run),
    },
  };
};
