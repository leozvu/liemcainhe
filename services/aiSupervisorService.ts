import {
  AISupervisorIssue,
  AISupervisorIssueKind,
  AISupervisorIssueSeverity,
  AISupervisorIssueStatus,
  AISupervisorRepairTarget,
  AISupervisorShotReport,
  AISupervisorState,
  ProjectState,
  Shot,
} from '../types';
import { chatJson } from './modelService';
import { parseModelJson } from './jsonResponse';
import { getUsagePolicy } from './usageService';
import {
  addProductionJob,
  createProductionJob,
  createProjectCheckpoint,
  markShotWorkflowStale,
} from './workflowService';

const VISION_KINDS: AISupervisorIssueKind[] = ['face', 'hands', 'logo', 'product', 'continuity', 'safe-zone'];
const SEVERITY_PENALTY: Record<AISupervisorIssueSeverity, number> = { info: 0, warning: 10, critical: 25 };

const roundCost = (value: number): number => Math.round(value * 100_000) / 100_000;
const containsTerm = (text: string, term: string): boolean => text.toLocaleLowerCase('vi').includes(term.toLocaleLowerCase('vi'));

const compactFingerprint = (value?: string): string => {
  if (!value) return '-';
  const sample = `${value.length}:${value.slice(0, 48)}:${value.slice(-48)}`;
  let hash = 5381;
  for (let index = 0; index < sample.length; index += 1) hash = ((hash << 5) + hash) ^ sample.charCodeAt(index);
  return (hash >>> 0).toString(36);
};

export const getShotMediaSignature = (shot: Shot): string => [
  ...shot.keyframes.map((frame) => `${frame.id}:${compactFingerprint(frame.imageUrl)}:${frame.status}`),
  shot.interval ? `${shot.interval.id}:${compactFingerprint(shot.interval.videoUrl)}:${shot.interval.status}` : 'no-interval',
].join('|');

export const createDefaultAISupervisorState = (): AISupervisorState => ({
  reports: [],
  policy: {
    repairBudgetUsd: 10,
    visionBudgetUsd: 0.5,
    maxVisionShotsPerRun: 8,
    requireHumanApproval: true,
  },
  repairCommittedCostUsd: 0,
  visionSpentUsd: 0,
  updatedAt: Date.now(),
});

export const normalizeAISupervisorState = (value?: Partial<AISupervisorState> | null): AISupervisorState => {
  const defaults = createDefaultAISupervisorState();
  if (!value) return defaults;
  return {
    ...defaults,
    ...value,
    reports: Array.isArray(value.reports) ? value.reports : [],
    policy: {
      ...defaults.policy,
      ...(value.policy || {}),
      repairBudgetUsd: Math.max(0, Number(value.policy?.repairBudgetUsd ?? defaults.policy.repairBudgetUsd)),
      visionBudgetUsd: Math.max(0, Number(value.policy?.visionBudgetUsd ?? defaults.policy.visionBudgetUsd)),
      maxVisionShotsPerRun: Math.max(1, Math.min(30, Number(value.policy?.maxVisionShotsPerRun ?? defaults.policy.maxVisionShotsPerRun))),
    },
    repairCommittedCostUsd: Math.max(0, Number(value.repairCommittedCostUsd) || 0),
    visionSpentUsd: Math.max(0, Number(value.visionSpentUsd) || 0),
    updatedAt: Number(value.updatedAt) || Date.now(),
  };
};

const makeIssue = (
  shotId: string,
  kind: AISupervisorIssueKind,
  severity: AISupervisorIssueSeverity,
  title: string,
  detail: string,
  repairTarget: AISupervisorRepairTarget,
  suffix = 'primary',
): AISupervisorIssue => {
  const now = Date.now();
  return {
    id: `supervisor_${shotId}_${kind}_local_${suffix}`,
    kind,
    severity,
    status: 'open',
    source: 'local',
    title,
    detail,
    repairTarget,
    createdAt: now,
    updatedAt: now,
  };
};

const preserveIssueState = (issue: AISupervisorIssue, previous?: AISupervisorIssue): AISupervisorIssue => previous
  ? { ...issue, status: previous.status, createdAt: previous.createdAt, updatedAt: previous.updatedAt }
  : issue;

const estimateSpeechSeconds = (dialogue?: string): number => {
  const text = dialogue?.trim() || '';
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean).length;
  const pauses = (text.match(/[,.!?;:…]/g) || []).length;
  return Number((words / 2.65 + pauses * 0.16).toFixed(1));
};

const getShotGroupKey = (shot: Shot): string => shot.factory?.variantId || '__master__';

const getGroupLastShotIds = (shots: Shot[]): Set<string> => {
  const lastByGroup = new Map<string, string>();
  shots.forEach((shot) => lastByGroup.set(getShotGroupKey(shot), shot.id));
  return new Set(lastByGroup.values());
};

const getGroupContent = (shots: Shot[], groupKey: string): string => shots
  .filter((shot) => getShotGroupKey(shot) === groupKey)
  .flatMap((shot) => [
    shot.actionSummary,
    shot.dialogue || '',
    ...shot.keyframes.map((frame) => frame.visualPrompt),
    shot.interval?.videoPrompt || '',
  ])
  .filter(Boolean)
  .join('\n');

const scoreIssues = (issues: AISupervisorIssue[]): Pick<AISupervisorShotReport, 'score' | 'status'> => {
  const active = issues.filter((issue) => !['resolved', 'ignored'].includes(issue.status));
  const score = Math.max(0, 100 - active.reduce((sum, issue) => sum + SEVERITY_PENALTY[issue.severity], 0));
  if (active.some((issue) => issue.severity === 'critical')) return { score, status: 'fail' };
  if (active.some((issue) => issue.severity === 'warning')) return { score, status: 'warning' };
  return { score, status: 'pass' };
};

export const estimateSupervisorRepairCost = (project: ProjectState, shotId: string, issues?: AISupervisorIssue[]): number => {
  const shot = project.shots.find((item) => item.id === shotId);
  if (!shot) return 0;
  const report = normalizeAISupervisorState(project.aiSupervisor).reports.find((item) => item.shotId === shotId);
  const activeIssues = (issues || report?.issues || []).filter((issue) => issue.status === 'open');
  const targets = new Set(activeIssues.map((issue) => issue.repairTarget));
  const rates = getUsagePolicy().rates;
  const duration = Number(shot.interval?.duration || 4);
  let cost = 0;
  if (targets.has('keyframes')) cost += rates.imagePerOutput * 2 + rates.videoPerSecond * duration;
  else if (targets.has('video')) cost += rates.videoPerSecond * duration;
  if (targets.has('voice')) cost += ((shot.dialogue?.length || 0) / 1000) * rates.voicePerThousandCharacters;
  return roundCost(cost);
};

export const estimateVisionAuditCost = (shotCount = 1): number => {
  const perShot = Math.max(0.002, (6000 / 1_000_000) * getUsagePolicy().rates.chatPerMillionCharacters);
  return roundCost(perShot * Math.max(0, shotCount));
};

const localIssuesForShot = (project: ProjectState, shot: Shot, index: number, lastShotIds: Set<string>): AISupervisorIssue[] => {
  const issues: AISupervisorIssue[] = [];
  const startFrame = shot.keyframes.find((frame) => frame.type === 'start');
  const duration = Number(shot.interval?.duration || 0);

  if (!startFrame?.imageUrl) issues.push(makeIssue(shot.id, 'missing-media', 'warning', 'Thiếu khung hình đầu', 'Shot chưa có ảnh khung đầu để kiểm tra hoặc tạo video nhất quán.', 'keyframes', 'start'));
  if (!shot.interval?.videoUrl) issues.push(makeIssue(shot.id, 'missing-media', 'critical', 'Thiếu video đầu ra', 'Shot chưa có video hoàn chỉnh để chuyển sang vòng duyệt.', 'video', 'video'));
  if (shot.workflow?.keyframesStale) issues.push(makeIssue(shot.id, 'stale-media', 'warning', 'Khung hình đã lỗi thời', 'Nội dung shot đã đổi sau lần tạo ảnh gần nhất.', 'keyframes', 'keyframes'));
  if (shot.workflow?.videoStale) issues.push(makeIssue(shot.id, 'stale-media', 'critical', 'Video đã lỗi thời', 'Video không còn khớp với prompt, ảnh hoặc lời thoại hiện tại.', 'video', 'video'));

  const speechSeconds = estimateSpeechSeconds(shot.dialogue);
  if (speechSeconds > 0 && duration > 0 && speechSeconds > duration * 1.04) {
    const severity: AISupervisorIssueSeverity = speechSeconds > duration * 1.25 ? 'critical' : 'warning';
    issues.push(makeIssue(
      shot.id,
      'dialogue-overrun',
      severity,
      'Lời thoại dài hơn thời lượng',
      `Ước tính cần ${speechSeconds.toFixed(1)} giây nhưng shot chỉ có ${duration.toFixed(1)} giây. Hãy rút thoại hoặc tăng thời lượng trước khi tạo voice.`,
      'voice',
    ));
  }

  shot.characters.forEach((characterId) => {
    const character = project.scriptData?.characters.find((item) => String(item.id) === String(characterId));
    if (!character) {
      issues.push(makeIssue(shot.id, 'continuity', 'critical', 'Không tìm thấy hồ sơ nhân vật', `Shot tham chiếu nhân vật “${characterId}” nhưng hồ sơ không còn tồn tại.`, 'keyframes', `missing-${characterId}`));
    } else if (!character.referenceImage && !character.visualPrompt?.trim()) {
      issues.push(makeIssue(shot.id, 'continuity', 'critical', 'Nhân vật thiếu nguồn hình ảnh', `“${character.name}” không có ảnh reference và cũng chưa có visual prompt để chạy text-to-image.`, 'keyframes', `source-${characterId}`));
    }
  });

  const scene = project.scriptData?.scenes.find((item) => String(item.id) === String(shot.sceneId));
  if (scene && !scene.referenceImage && !scene.visualPrompt?.trim()) {
    issues.push(makeIssue(shot.id, 'continuity', 'warning', 'Bối cảnh thiếu mô tả chuẩn', `“${scene.location}” chưa có reference hoặc visual prompt nên continuity dễ lệch.`, 'keyframes', 'scene'));
  }

  const previous = project.shots[index - 1];
  if (previous && getShotGroupKey(previous) === getShotGroupKey(shot)) {
    const sharedCharacters = shot.characters.filter((id) => previous.characters.some((previousId) => String(previousId) === String(id)));
    sharedCharacters.forEach((characterId) => {
      const before = previous.characterVariations?.[characterId];
      const current = shot.characterVariations?.[characterId];
      if (before && current && before !== current) {
        issues.push(makeIssue(shot.id, 'continuity', 'warning', 'Biến thể nhân vật thay đổi giữa hai shot', `Nhân vật ${characterId} đổi variation từ “${before}” sang “${current}”. Xác nhận đây là chủ ý trước khi render.`, 'keyframes', `variation-${characterId}`));
      }
    });
  }

  const kit = project.brandKitSnapshot;
  if (kit) {
    const shotText = [shot.actionSummary, shot.dialogue || '', ...shot.keyframes.map((frame) => frame.visualPrompt), shot.interval?.videoPrompt || ''].join('\n');
    const forbidden = kit.forbiddenTerms.filter((term) => containsTerm(shotText, term));
    if (forbidden.length) issues.push(makeIssue(shot.id, 'brand', 'critical', 'Có nội dung vi phạm Brand Kit', `Phát hiện từ/cụm từ cấm: ${forbidden.map((term) => `“${term}”`).join(', ')}.`, 'script', 'forbidden'));

    if (lastShotIds.has(shot.id)) {
      const groupContent = getGroupContent(project.shots, getShotGroupKey(shot));
      const missingMandatory = kit.mandatoryTerms.filter((term) => !containsTerm(groupContent, term));
      if (missingMandatory.length) issues.push(makeIssue(shot.id, 'brand', 'warning', 'Thiếu thông điệp bắt buộc', `Toàn bộ phiên bản chưa có: ${missingMandatory.map((term) => `“${term}”`).join(', ')}.`, 'script', 'mandatory'));
      const hasCta = kit.ctas.length === 0 || kit.ctas.some((cta) => containsTerm(groupContent, cta));
      if (!hasCta) issues.push(makeIssue(shot.id, 'cta', 'warning', 'CTA chưa đúng Brand Kit', 'Phiên bản chưa dùng CTA nào đã được phê duyệt.', 'script'));
    }

    if (shot.factory?.aspectRatio === '9:16') {
      const verticalRule = kit.platformRules.find((rule) => ['tiktok', 'instagram', 'facebook'].includes(rule.platform));
      if (!verticalRule?.safeZone?.trim()) {
        issues.push(makeIssue(shot.id, 'safe-zone', 'warning', 'Chưa có quy chuẩn safe zone dọc', 'Brand Kit chưa mô tả vùng an toàn cho TikTok/Reels; AI Vision không thể xác nhận vị trí chữ, logo và CTA.', 'none', 'rule'));
      }
    }
  }

  return issues;
};

export const runLocalSupervisorAudit = (project: ProjectState): ProjectState => {
  const state = normalizeAISupervisorState(project.aiSupervisor);
  const previousByShot = new Map(state.reports.map((report) => [report.shotId, report]));
  const lastShotIds = getGroupLastShotIds(project.shots);
  const now = Date.now();
  const reports = project.shots.map((shot, index): AISupervisorShotReport => {
    const signature = getShotMediaSignature(shot);
    const previous = previousByShot.get(shot.id);
    const previousIssues = new Map((previous?.issues || []).map((issue) => [issue.id, issue]));
    const localIssues = localIssuesForShot(project, shot, index, lastShotIds)
      .map((issue) => preserveIssueState(issue, previousIssues.get(issue.id)));
    const visionStillValid = previous?.mediaSignature === signature;
    const visionIssues = visionStillValid
      ? (previous?.issues || []).filter((issue) => issue.source === 'ai-vision')
      : [];
    const issues = [...localIssues, ...visionIssues];
    const score = scoreIssues(issues);
    return {
      shotId: shot.id,
      ...score,
      visionStatus: visionStillValid ? previous?.visionStatus || 'not-run' : 'not-run',
      issues,
      mediaSignature: signature,
      analyzedAt: now,
      visionAnalyzedAt: visionStillValid ? previous?.visionAnalyzedAt : undefined,
      repairEstimatedCostUsd: estimateSupervisorRepairCost(project, shot.id, issues),
    };
  });
  return {
    ...project,
    aiSupervisor: { ...state, reports, lastLocalAuditAt: now, updatedAt: now },
  };
};

const getVisionInputs = (project: ProjectState, shot: Shot): { urls: string[]; labels: string[] } => {
  const urls: string[] = [];
  const labels: string[] = [];
  const add = (url: string | undefined, label: string) => {
    if (!url || urls.includes(url) || urls.length >= 8) return;
    urls.push(url);
    labels.push(`Ảnh ${urls.length}: ${label}`);
  };
  shot.keyframes.forEach((frame) => add(frame.imageUrl, `shot hiện tại — khung ${frame.type === 'start' ? 'đầu' : 'cuối'}`));
  const index = project.shots.findIndex((item) => item.id === shot.id);
  const previous = project.shots[index - 1];
  const next = project.shots[index + 1];
  if (previous && getShotGroupKey(previous) === getShotGroupKey(shot)) add(previous.keyframes.find((frame) => frame.type === 'end')?.imageUrl, 'shot liền trước — khung cuối để so continuity');
  if (next && getShotGroupKey(next) === getShotGroupKey(shot)) add(next.keyframes.find((frame) => frame.type === 'start')?.imageUrl, 'shot liền sau — khung đầu để so continuity');
  project.brandKitSnapshot?.assets
    .filter((asset) => ['logo', 'product', 'character'].includes(asset.type))
    .slice(0, 4)
    .forEach((asset) => add(asset.url, `tài nguyên chuẩn ${asset.type} — ${asset.name}`));
  return { urls, labels };
};

interface VisionPayload {
  issues?: Array<{
    kind?: AISupervisorIssueKind;
    severity?: AISupervisorIssueSeverity;
    title?: string;
    detail?: string;
    confidence?: number;
  }>;
}

const repairTargetForVisionKind = (kind: AISupervisorIssueKind): AISupervisorRepairTarget => {
  if (['face', 'hands', 'logo', 'product', 'continuity', 'safe-zone'].includes(kind)) return 'keyframes';
  return 'none';
};

export const runSupervisorVisionAudit = async (project: ProjectState, shotId: string): Promise<ProjectState> => {
  // Always refresh the deterministic report first so a media or brief change
  // cannot leave a previously valid Vision result attached to stale inputs.
  const withLocal = runLocalSupervisorAudit(project);
  const state = normalizeAISupervisorState(withLocal.aiSupervisor);
  const shot = withLocal.shots.find((item) => item.id === shotId);
  if (!shot) throw new Error('Không tìm thấy shot cần kiểm tra.');
  const inputs = getVisionInputs(withLocal, shot);
  if (!inputs.urls.length) throw new Error('Shot chưa có ảnh để AI Vision kiểm tra. Hãy tạo ít nhất một keyframe trước.');
  const estimatedCost = estimateVisionAuditCost(1);
  if (state.visionSpentUsd + estimatedCost > state.policy.visionBudgetUsd + 0.000001) {
    throw new Error(`Quét AI Vision ước tính $${estimatedCost.toFixed(3)}, vượt ngân sách kiểm định còn lại $${Math.max(0, state.policy.visionBudgetUsd - state.visionSpentUsd).toFixed(3)}.`);
  }

  const brandAssets = withLocal.brandKitSnapshot?.assets.filter((asset) => ['logo', 'product', 'character'].includes(asset.type)) || [];
  const result = await chatJson({
    systemPrompt: 'Bạn là AI Supervisor hậu kỳ quảng cáo. Chỉ báo lỗi nhìn thấy rõ; không suy đoán. Trả JSON hợp lệ, không Markdown.',
    prompt: [
      `Kiểm định hình ảnh của shot: ${shot.actionSummary}`,
      `Nhân vật dự kiến: ${shot.characters.join(', ') || 'không có'}`,
      `Brand asset cần đối chiếu: ${brandAssets.map((asset) => `${asset.type}: ${asset.name}`).join(', ') || 'không có ảnh chuẩn'}`,
      `Tỷ lệ: ${shot.factory?.aspectRatio || 'chưa xác định'}.`,
      ...inputs.labels,
      'Kiểm tra: mặt/identity, bàn tay và ngón tay, logo, hình dáng/nhãn sản phẩm, continuity với ảnh liền kề, chữ/logo/CTA có nằm sát mép hoặc ngoài safe zone.',
      'Không coi thay đổi góc máy, biểu cảm hoặc pose là lỗi nếu identity vẫn đúng. Nếu không đủ bằng chứng, bỏ qua thay vì cảnh báo.',
      'JSON schema: {"issues":[{"kind":"face|hands|logo|product|continuity|safe-zone","severity":"warning|critical","title":"ngắn gọn tiếng Việt","detail":"bằng chứng cụ thể tiếng Việt","confidence":0.0}]}',
    ].join('\n'),
    imageUrls: inputs.urls,
    timeout: 180000,
    overrideParams: { temperature: 0.1, maxTokens: 1800 },
  });
  const payload = parseModelJson<VisionPayload>(result);
  const now = Date.now();
  const visionIssues = (payload.issues || [])
    .filter((issue): issue is NonNullable<VisionPayload['issues']>[number] & { kind: AISupervisorIssueKind } => Boolean(issue.kind && VISION_KINDS.includes(issue.kind)))
    .slice(0, 12)
    .map((issue, index): AISupervisorIssue => ({
      id: `supervisor_${shot.id}_${issue.kind}_vision_${index}`,
      kind: issue.kind,
      severity: issue.severity === 'critical' ? 'critical' : 'warning',
      status: 'open',
      source: 'ai-vision',
      title: issue.title?.trim() || 'Lỗi thị giác cần kiểm tra',
      detail: issue.detail?.trim() || 'AI Vision phát hiện dấu hiệu bất thường trên khung hình.',
      repairTarget: repairTargetForVisionKind(issue.kind),
      confidence: Math.max(0, Math.min(1, Number(issue.confidence) || 0.7)),
      createdAt: now,
      updatedAt: now,
    }));
  const reports = state.reports.map((report) => {
    if (report.shotId !== shotId) return report;
    const issues = [...report.issues.filter((issue) => issue.source !== 'ai-vision'), ...visionIssues];
    const score = scoreIssues(issues);
    return {
      ...report,
      ...score,
      issues,
      visionStatus: 'complete' as const,
      visionAnalyzedAt: now,
      mediaSignature: getShotMediaSignature(shot),
      repairEstimatedCostUsd: estimateSupervisorRepairCost(withLocal, shotId, issues),
    };
  });
  return {
    ...withLocal,
    aiSupervisor: {
      ...state,
      reports,
      visionSpentUsd: roundCost(state.visionSpentUsd + estimatedCost),
      lastVisionAuditAt: now,
      updatedAt: now,
    },
  };
};

export const queueSupervisorRepair = (project: ProjectState, shotId: string): ProjectState => {
  // Re-audit immediately before queuing to enforce the latest media signature,
  // budget estimate and issue state without relying on the UI scan order.
  const withLocal = runLocalSupervisorAudit(project);
  const state = normalizeAISupervisorState(withLocal.aiSupervisor);
  const report = state.reports.find((item) => item.shotId === shotId);
  const shot = withLocal.shots.find((item) => item.id === shotId);
  if (!report || !shot) throw new Error('Chưa có báo cáo cho shot này.');
  const actionable = report.issues.filter((issue) => issue.status === 'open' && issue.repairTarget !== 'none');
  if (!actionable.length) throw new Error('Shot không có lỗi mở nào cần xếp hàng sửa.');
  const estimatedCost = estimateSupervisorRepairCost(withLocal, shotId, actionable);
  const remaining = Math.max(0, state.policy.repairBudgetUsd - state.repairCommittedCostUsd);
  if (estimatedCost > remaining + 0.000001) {
    throw new Error(`Chi phí sửa shot ước tính $${estimatedCost.toFixed(3)}, vượt ngân sách sửa còn lại $${remaining.toFixed(3)}.`);
  }

  let next = createProjectCheckpoint(withLocal, `Trước khi sửa Supervisor · ${shot.actionSummary.slice(0, 36)}`);
  const targets = new Set(actionable.map((issue) => issue.repairTarget));
  next = {
    ...next,
    shots: next.shots.map((item) => {
      if (item.id !== shotId) return item;
      let changed = item;
      if (targets.has('script') || targets.has('voice')) changed = markShotWorkflowStale(changed, 'dialogue');
      if (targets.has('keyframes')) changed = markShotWorkflowStale(changed, 'visual');
      else if (targets.has('video')) changed = markShotWorkflowStale(changed, 'video');
      return changed;
    }),
  };
  const job = createProductionJob({
    kind: 'ai-supervisor',
    stage: 'director',
    label: `Sửa chọn lọc · ${shot.actionSummary.slice(0, 44)}`,
    resourceId: shotId,
    totalUnits: Math.max(1, targets.size),
    detail: `Chỉ xếp hàng shot lỗi này · dự toán $${estimatedCost.toFixed(3)} · chưa gọi API`,
  });
  next = addProductionJob(next, job);
  next.aiSupervisor = {
    ...state,
    repairCommittedCostUsd: roundCost(state.repairCommittedCostUsd + estimatedCost),
    reports: state.reports.map((item) => item.shotId === shotId
      ? {
          ...item,
          issues: item.issues.map((issue) => actionable.some((candidate) => candidate.id === issue.id)
            ? { ...issue, status: 'queued' as const, updatedAt: Date.now() }
            : issue),
          repairEstimatedCostUsd: estimatedCost,
        }
      : item),
    updatedAt: Date.now(),
  };
  return next;
};

export const setSupervisorIssueStatus = (
  project: ProjectState,
  shotId: string,
  issueId: string,
  status: AISupervisorIssueStatus,
): ProjectState => {
  const state = normalizeAISupervisorState(project.aiSupervisor);
  const reports = state.reports.map((report) => {
    if (report.shotId !== shotId) return report;
    const issues = report.issues.map((issue) => issue.id === issueId ? { ...issue, status, updatedAt: Date.now() } : issue);
    return { ...report, ...scoreIssues(issues), issues };
  });
  return { ...project, aiSupervisor: { ...state, reports, updatedAt: Date.now() } };
};

export const updateAISupervisorPolicy = (
  project: ProjectState,
  policy: AISupervisorState['policy'],
): ProjectState => ({
  ...project,
  aiSupervisor: {
    ...normalizeAISupervisorState(project.aiSupervisor),
    policy: {
      ...policy,
      repairBudgetUsd: Math.max(0, Number(policy.repairBudgetUsd) || 0),
      visionBudgetUsd: Math.max(0, Number(policy.visionBudgetUsd) || 0),
      maxVisionShotsPerRun: Math.max(1, Math.min(30, Number(policy.maxVisionShotsPerRun) || 1)),
    },
    updatedAt: Date.now(),
  },
});

export const getAISupervisorSummary = (project: ProjectState) => {
  const state = normalizeAISupervisorState(project.aiSupervisor);
  const activeIssues = state.reports.flatMap((report) => report.issues).filter((issue) => !['resolved', 'ignored'].includes(issue.status));
  return {
    totalShots: project.shots.length,
    auditedShots: state.reports.length,
    passedShots: state.reports.filter((report) => report.status === 'pass').length,
    warningShots: state.reports.filter((report) => report.status === 'warning').length,
    failedShots: state.reports.filter((report) => report.status === 'fail').length,
    criticalIssues: activeIssues.filter((issue) => issue.severity === 'critical').length,
    warningIssues: activeIssues.filter((issue) => issue.severity === 'warning').length,
    visionPendingShots: state.reports.filter((report) => report.visionStatus !== 'complete').length,
    repairRemainingUsd: roundCost(Math.max(0, state.policy.repairBudgetUsd - state.repairCommittedCostUsd)),
    visionRemainingUsd: roundCost(Math.max(0, state.policy.visionBudgetUsd - state.visionSpentUsd)),
  };
};
