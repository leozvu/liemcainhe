import {
  AgencyReviewGate,
  AgencyReviewRole,
  AgencyReviewRound,
  AgencyReviewState,
  ClientReviewPortal,
  ProjectState,
} from '../types';
import {
  addProductionJob,
  createProductionJob,
  createProjectCheckpoint,
  patchProductionJob,
} from './workflowService';
import { getAutoEditorSummary } from './autoEditorService';

export const AGENCY_REVIEW_ROLES: AgencyReviewRole[] = ['director', 'editor', 'account'];

export const AGENCY_REVIEW_ROLE_META: Record<AgencyReviewRole, { label: string; detail: string }> = {
  director: { label: 'Director', detail: 'Nhịp kể, hình ảnh, continuity và ý đồ sáng tạo' },
  editor: { label: 'Editor', detail: 'Dựng, âm thanh, caption, màu và thông số xuất bản' },
  account: { label: 'Account', detail: 'Brief, thương hiệu, CTA, phạm vi và cam kết với khách' },
};

const now = (): number => Date.now();
const createId = (prefix: string): string => `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const hashValue = (value: string): string => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  return (hash >>> 0).toString(36);
};

export const createDefaultAgencyReviewState = (): AgencyReviewState => ({ rounds: [], updatedAt: now() });

const normalizeGate = (role: AgencyReviewRole, gate?: Partial<AgencyReviewGate>): AgencyReviewGate => ({
  role,
  status: ['approved', 'changes-requested'].includes(gate?.status || '') ? gate!.status! : 'pending',
  reviewer: gate?.reviewer,
  note: gate?.note,
  updatedAt: Number(gate?.updatedAt) || now(),
});

export const normalizeAgencyReviewState = (value?: Partial<AgencyReviewState> | null): AgencyReviewState => {
  const fallback = createDefaultAgencyReviewState();
  if (!value) return fallback;
  const rounds = (Array.isArray(value.rounds) ? value.rounds : []).map((round): AgencyReviewRound => ({
    ...round,
    shotIds: Array.isArray(round.shotIds) ? Array.from(new Set(round.shotIds.filter(Boolean))) : [],
    gates: AGENCY_REVIEW_ROLES.map((role) => normalizeGate(role, round.gates?.find((gate) => gate.role === role))),
    createdAt: Number(round.createdAt) || now(),
    updatedAt: Number(round.updatedAt) || now(),
  }));
  return {
    rounds,
    activeRoundId: rounds.some((round) => round.id === value.activeRoundId) ? value.activeRoundId : rounds[0]?.id,
    updatedAt: Number(value.updatedAt) || now(),
  };
};

export const getAgencyReviewShotIds = (project: ProjectState): string[] => {
  const timelineIds = project.autoEditor?.timeline
    ?.slice()
    .sort((left, right) => left.order - right.order)
    .map((clip) => clip.shotId)
    .filter(Boolean) || [];
  const preferred = timelineIds.length
    ? timelineIds
    : project.shots.filter((shot) => !shot.factory).map((shot) => shot.id);
  const shotMap = new Map(project.shots.map((shot) => [shot.id, shot]));
  return Array.from(new Set(preferred)).filter((shotId) => {
    const shot = shotMap.get(shotId);
    return Boolean(shot?.interval?.videoUrl && !shot.workflow?.videoStale);
  });
};

export const getAgencyReviewSourceSignature = (project: ProjectState, shotIds = getAgencyReviewShotIds(project)): string => {
  const shots = new Map(project.shots.map((shot) => [shot.id, shot]));
  const payload = {
    shotIds,
    planSignature: project.autoEditor?.planSignature,
    editorSettings: project.autoEditor?.settings,
    clips: shotIds.map((shotId) => {
      const shot = shots.get(shotId);
      const voiceTakeId = project.voiceStudio?.selectedTakeByShot[shotId];
      const voice = project.voiceStudio?.takes.find((take) => take.id === voiceTakeId);
      return {
        shotId,
        videoUrl: shot?.interval?.videoUrl,
        duration: shot?.interval?.duration,
        videoStale: shot?.workflow?.videoStale,
        dialogue: shot?.dialogue,
        voiceTakeId,
        voiceUrl: voice?.audioUrl,
      };
    }),
  };
  return hashValue(JSON.stringify(payload));
};

export const getAgencyReviewSummary = (project: ProjectState) => {
  const state = normalizeAgencyReviewState(project.agencyReview);
  const activeRound = state.rounds.find((round) => round.id === state.activeRoundId);
  const stale = Boolean(activeRound && activeRound.sourceSignature !== getAgencyReviewSourceSignature(project, activeRound.shotIds));
  const nextRole = activeRound && !stale
    ? AGENCY_REVIEW_ROLES.find((role) => activeRound.gates.find((gate) => gate.role === role)?.status !== 'approved')
    : undefined;
  const approvedGates = activeRound?.gates.filter((gate) => gate.status === 'approved').length || 0;
  return {
    state,
    activeRound,
    stale,
    nextRole,
    approvedGates,
    readyForClient: Boolean(activeRound && !stale && activeRound.status === 'ready-client' && approvedGates === AGENCY_REVIEW_ROLES.length),
  };
};

export const createAgencyReviewRound = (project: ProjectState, label: string, note?: string): ProjectState => {
  const shotIds = getAgencyReviewShotIds(project);
  if (!shotIds.length) throw new Error('Chưa có video hợp lệ để mở vòng duyệt nội bộ.');
  if (project.autoEditor?.timeline.length && getAutoEditorSummary(project).stale) {
    throw new Error('Timeline Auto Editor đã thay đổi. Hãy lập lại timeline trước khi mở vòng duyệt.');
  }
  const state = normalizeAgencyReviewState(project.agencyReview);
  const timestamp = now();
  const id = createId('agency_review');
  const round: AgencyReviewRound = {
    id,
    label: label.trim().slice(0, 120) || `Vòng duyệt ${state.rounds.length + 1}`,
    note: note?.trim().slice(0, 1000) || undefined,
    status: 'internal-review',
    sourceSignature: getAgencyReviewSourceSignature(project, shotIds),
    shotIds,
    gates: AGENCY_REVIEW_ROLES.map((role) => ({ role, status: 'pending', updatedAt: timestamp })),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const checkpointed = createProjectCheckpoint(project, `Trước ${round.label}`);
  const job = createProductionJob({
    kind: 'agency-review',
    stage: 'export',
    label: `Duyệt nội bộ · ${round.label}`,
    totalUnits: AGENCY_REVIEW_ROLES.length,
    resourceId: id,
    detail: 'Đang chờ Director duyệt.',
  });
  const withJob = addProductionJob(checkpointed, { ...job, status: 'running', attempts: 1 });
  return {
    ...withJob,
    agencyReview: {
      rounds: [round, ...state.rounds].slice(0, 30),
      activeRoundId: id,
      updatedAt: timestamp,
    },
  };
};

export const updateAgencyReviewGate = (
  project: ProjectState,
  role: AgencyReviewRole,
  status: Exclude<AgencyReviewGate['status'], 'pending'>,
  reviewer: string,
  note?: string,
): ProjectState => {
  const summary = getAgencyReviewSummary(project);
  const round = summary.activeRound;
  if (!round) throw new Error('Chưa có vòng duyệt nội bộ đang hoạt động.');
  if (summary.stale) throw new Error('Media đã thay đổi sau khi mở vòng duyệt. Hãy tạo vòng duyệt mới.');
  if (['client-review', 'approved'].includes(round.status)) throw new Error('Vòng này đã được gửi khách hoặc đã nghiệm thu.');
  if (reviewer.trim().length < 2) throw new Error('Hãy nhập tên người duyệt.');
  const roleIndex = AGENCY_REVIEW_ROLES.indexOf(role);
  if (status === 'approved' && AGENCY_REVIEW_ROLES.slice(0, roleIndex).some((previousRole) => round.gates.find((gate) => gate.role === previousRole)?.status !== 'approved')) {
    throw new Error(`${AGENCY_REVIEW_ROLE_META[role].label} chỉ duyệt sau khi bước trước đã thông qua.`);
  }
  const timestamp = now();
  const gates = round.gates.map((gate) => {
    const gateIndex = AGENCY_REVIEW_ROLES.indexOf(gate.role);
    if (gate.role === role) return { ...gate, status, reviewer: reviewer.trim().slice(0, 120), note: note?.trim().slice(0, 1000) || undefined, updatedAt: timestamp };
    if (status === 'changes-requested' && gateIndex > roleIndex) return { role: gate.role, status: 'pending' as const, updatedAt: timestamp };
    return gate;
  });
  const approvedCount = gates.filter((gate) => gate.status === 'approved').length;
  const roundStatus = status === 'changes-requested'
    ? 'changes-requested' as const
    : approvedCount === AGENCY_REVIEW_ROLES.length ? 'ready-client' as const : 'internal-review' as const;
  let next: ProjectState = {
    ...project,
    agencyReview: {
      ...summary.state,
      rounds: summary.state.rounds.map((item) => item.id === round.id ? { ...item, gates, status: roundStatus, updatedAt: timestamp } : item),
      updatedAt: timestamp,
    },
  };
  const job = next.workflow?.jobs.find((item) => item.kind === 'agency-review' && item.resourceId === round.id);
  if (job) {
    const nextRole = AGENCY_REVIEW_ROLES[approvedCount];
    next = patchProductionJob(next, job.id, {
      status: roundStatus === 'ready-client' ? 'completed' : roundStatus === 'changes-requested' ? 'interrupted' : 'running',
      progress: Math.round((approvedCount / AGENCY_REVIEW_ROLES.length) * 100),
      completedUnits: approvedCount,
      detail: roundStatus === 'ready-client'
        ? 'Director, Editor và Account đã duyệt. Sẵn sàng gửi khách.'
        : roundStatus === 'changes-requested'
          ? `${AGENCY_REVIEW_ROLE_META[role].label} yêu cầu chỉnh sửa.`
          : `Đang chờ ${AGENCY_REVIEW_ROLE_META[nextRole].label} duyệt.`,
    });
  }
  return next;
};

export const markAgencyReviewPublished = (
  project: ProjectState,
  roundId: string,
  portal: ClientReviewPortal,
): ProjectState => {
  const state = normalizeAgencyReviewState(project.agencyReview);
  const version = [...portal.versions].reverse().find((item) => item.internalRoundId === roundId) || portal.versions.at(-1);
  const timestamp = now();
  return {
    ...project,
    agencyReview: {
      ...state,
      rounds: state.rounds.map((round) => round.id === roundId ? {
        ...round,
        status: 'client-review',
        portalId: portal.id,
        versionId: version?.id,
        updatedAt: timestamp,
      } : round),
      updatedAt: timestamp,
    },
  };
};

export const refreshAgencyReviewSourceSignature = (project: ProjectState, roundId: string): ProjectState => {
  const state = normalizeAgencyReviewState(project.agencyReview);
  const round = state.rounds.find((item) => item.id === roundId);
  if (!round) throw new Error('Không tìm thấy vòng duyệt cần đóng gói.');
  const timestamp = now();
  return {
    ...project,
    agencyReview: {
      ...state,
      rounds: state.rounds.map((item) => item.id === roundId ? {
        ...item,
        sourceSignature: getAgencyReviewSourceSignature(project, item.shotIds),
        updatedAt: timestamp,
      } : item),
      updatedAt: timestamp,
    },
  };
};

export const syncAgencyReviewFromClientDecision = (
  project: ProjectState,
  portal?: ClientReviewPortal,
): ProjectState => {
  if (!portal || portal.decision === 'pending') return project;
  const state = normalizeAgencyReviewState(project.agencyReview);
  const version = portal.versions.find((item) => item.id === portal.decisionVersionId) || portal.versions.at(-1);
  const roundId = version?.internalRoundId;
  if (!roundId || !state.rounds.some((round) => round.id === roundId)) return project;
  const timestamp = portal.decidedAt || now();
  return {
    ...project,
    agencyReview: {
      ...state,
      rounds: state.rounds.map((round) => round.id === roundId ? {
        ...round,
        status: portal.decision === 'approved' ? 'approved' : 'changes-requested',
        portalId: portal.id,
        versionId: version?.id,
        clientDecisionAt: timestamp,
        updatedAt: timestamp,
      } : round),
      updatedAt: timestamp,
    },
  };
};
