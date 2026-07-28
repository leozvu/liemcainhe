import { AgencyCampaign, AgencyClient, ProjectState } from '../types';
import { getBrandKitReadiness } from './brandKitService';
import { getCampaignBriefReadiness } from './campaignService';
import { runUsageTelemetryDryRun, TelemetryDryRunReport, UsageRecord } from './usageService';
import {
  BillableLifecycleDryRunReport,
  BillableLifecycleEvent,
  BillableReconciliationReport,
  buildBillableReconciliation,
  runBillableLifecycleDryRun,
} from './billableTelemetryService';
import { readWorkspaceStore, writeWorkspaceStore } from './storageService';
import {
  cloudTransport,
  indexedDbSyncStore,
  LocalStore,
  syncCollection,
  SyncTransport,
} from './workspaceSyncService';
import type { WorkspaceFieldTestEvidence } from './workspaceFieldTestService';

export type CampaignZeroStatus = 'running' | 'completed';
export type CampaignZeroStage = 'brief' | 'pre-production' | 'production' | 'review' | 'editing' | 'delivery' | 'operations';

export interface CampaignZeroWorkSession {
  id: string;
  stage: CampaignZeroStage;
  startedAt: number;
  endedAt?: number;
}

export interface CampaignZeroRun {
  version: 1;
  campaignId: string;
  status: CampaignZeroStatus;
  clientProxyName?: string;
  telemetry?: CampaignZeroTelemetryReport;
  workspaceSyncProof?: WorkspaceFieldTestEvidence;
  providerBalanceBeforeUsd?: number;
  providerBalanceAfterUsd?: number;
  workSessions: CampaignZeroWorkSession[];
  startedAt: number;
  completedAt?: number;
  updatedAt: number;
}

export type CampaignZeroGateGroup = 'foundation' | 'instrumentation' | 'production' | 'review' | 'delivery';

export interface CampaignZeroGate {
  id: string;
  group: CampaignZeroGateGroup;
  label: string;
  detail: string;
  complete: boolean;
}

export interface CampaignZeroSnapshot {
  gates: CampaignZeroGate[];
  completedGates: number;
  totalGates: number;
  progress: number;
  nextGate?: CampaignZeroGate;
  projectCount: number;
  requestCount: number;
  failureCount: number;
  estimatedCostUsd: number;
  actualProviderSpendUsd?: number;
  costVarianceUsd?: number;
  workMinutes: number;
  activeSession?: CampaignZeroWorkSession;
  billable: BillableReconciliationReport;
}

export interface CampaignZeroTelemetryReport extends TelemetryDryRunReport {
  lifecycle?: BillableLifecycleDryRunReport;
}

export interface CampaignZeroPaidPreflightCheck {
  id: 'telemetry' | 'project' | 'balance' | 'budget' | 'voice-provider' | 'unresolved-jobs';
  label: string;
  detail: string;
  complete: boolean;
}

export interface CampaignZeroPaidPreflight {
  ready: boolean;
  checks: CampaignZeroPaidPreflightCheck[];
  blockers: CampaignZeroPaidPreflightCheck[];
  maxTestCharacters: 200;
}

const STORAGE_KEY = 'egoric_campaign_zero_runs_v1';
const STORE_NAME = 'campaignZeroRuns';
const createId = (prefix: string, at: number): string => `${prefix}_${at.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const finiteAmount = (value?: number): number | undefined => Number.isFinite(value) ? Math.max(0, Number(value)) : undefined;

const normalizeWorkspaceSyncProof = (value?: Partial<WorkspaceFieldTestEvidence>): WorkspaceFieldTestEvidence | undefined => {
  if (!value || value.version !== 1 || value.status !== 'verified' || !value.id || !value.code
    || !value.deviceA?.id || !value.deviceA?.label || !value.deviceB?.id || !value.deviceB?.label
    || !Number(value.createdAt) || !Number(value.acknowledgedAt) || !Number(value.verifiedAt)
    || !Number(value.updatedAt) || !Number(value.expiresAt)) return undefined;
  return value as WorkspaceFieldTestEvidence;
};

const normalizeTelemetry = (value?: Partial<CampaignZeroTelemetryReport>): CampaignZeroTelemetryReport | undefined => {
  if (!value || value.status !== 'passed' || !Number(value.checkedAt) || !value.recordId) return undefined;
  const lifecycle = value.lifecycle?.status === 'passed'
    && Array.isArray(value.lifecycle.recordIds)
    && Array.isArray(value.lifecycle.phases)
    ? value.lifecycle
    : undefined;
  return { ...value, lifecycle } as CampaignZeroTelemetryReport;
};

const normalizeRun = (value: Partial<CampaignZeroRun>): CampaignZeroRun | undefined => {
  if (!value.campaignId || !Number(value.startedAt)) return undefined;
  const sessions = (Array.isArray(value.workSessions) ? value.workSessions : [])
    .filter((session): session is CampaignZeroWorkSession => Boolean(session?.id && session?.stage && Number(session?.startedAt)))
    .map((session) => ({
      ...session,
      startedAt: Number(session.startedAt),
      endedAt: Number(session.endedAt) || undefined,
    }))
    .slice(0, 200);
  return {
    version: 1,
    campaignId: value.campaignId,
    status: value.status === 'completed' ? 'completed' : 'running',
    clientProxyName: value.clientProxyName?.trim().slice(0, 120) || undefined,
    telemetry: normalizeTelemetry(value.telemetry),
    workspaceSyncProof: normalizeWorkspaceSyncProof(value.workspaceSyncProof),
    providerBalanceBeforeUsd: finiteAmount(value.providerBalanceBeforeUsd),
    providerBalanceAfterUsd: finiteAmount(value.providerBalanceAfterUsd),
    workSessions: sessions,
    startedAt: Number(value.startedAt),
    completedAt: Number(value.completedAt) || undefined,
    updatedAt: Number(value.updatedAt) || Number(value.startedAt),
  };
};

const readLegacyRuns = (): CampaignZeroRun[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return (Array.isArray(parsed) ? parsed : []).map(normalizeRun).filter(Boolean) as CampaignZeroRun[];
  } catch {
    return [];
  }
};

let migrationPromise: Promise<void> | undefined;

const migrateLegacyCampaignZeroRuns = async (): Promise<void> => {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    if (typeof indexedDB === 'undefined') return;
    const legacy = readLegacyRuns();
    if (!legacy.length) return;
    const current = await readWorkspaceStore<CampaignZeroRun>(STORE_NAME);
    const byCampaign = new Map(current.map((run) => [run.campaignId, run]));
    legacy.forEach((run) => {
      const saved = byCampaign.get(run.campaignId);
      if (!saved || run.updatedAt > saved.updatedAt) byCampaign.set(run.campaignId, run);
    });
    await writeWorkspaceStore(STORE_NAME, Array.from(byCampaign.values()));
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Bản IndexedDB đã an toàn. */ }
  })();
  return migrationPromise;
};

const loadCampaignZeroRuns = async (): Promise<CampaignZeroRun[]> => {
  if (typeof indexedDB === 'undefined') return readLegacyRuns();
  await migrateLegacyCampaignZeroRuns();
  const rows = await readWorkspaceStore<CampaignZeroRun>(STORE_NAME);
  return rows
    .map(normalizeRun)
    .filter((run): run is CampaignZeroRun => Boolean(run))
    .sort((left, right) => right.updatedAt - left.updatedAt);
};

export const loadCampaignZeroRun = async (campaignId: string): Promise<CampaignZeroRun | undefined> =>
  (await loadCampaignZeroRuns()).find((run) => run.campaignId === campaignId);

export const saveCampaignZeroRun = async (run: CampaignZeroRun): Promise<CampaignZeroRun> => {
  const normalized = normalizeRun(run);
  if (!normalized) throw new Error('Dữ liệu Campaign 0 không hợp lệ.');
  if (typeof indexedDB === 'undefined') {
    if (typeof localStorage !== 'undefined') {
      const next = [normalized, ...readLegacyRuns().filter((item) => item.campaignId !== normalized.campaignId)];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
    return normalized;
  }
  await migrateLegacyCampaignZeroRuns();
  await writeWorkspaceStore(STORE_NAME, [normalized]);
  return normalized;
};

export type CampaignZeroCloudPhase = 'synced' | 'local-only' | 'error';

export interface CampaignZeroSyncReport {
  phase: CampaignZeroCloudPhase;
  pulled: number;
  pushed: number;
  error?: string;
}

export const syncCampaignZeroRuns = async (options: {
  hosted?: boolean;
  full?: boolean;
  store?: LocalStore;
  transport?: SyncTransport;
} = {}): Promise<CampaignZeroSyncReport> => {
  const hosted = options.hosted ?? (typeof window !== 'undefined' && window.location.hostname.endsWith('.chatgpt.site'));
  if (!hosted) return { phase: 'local-only', pulled: 0, pushed: 0 };
  const outcome = await syncCollection(
    'campaignZeroRuns',
    options.store ?? indexedDbSyncStore,
    options.transport ?? cloudTransport,
    options.full ? { since: 0 } : undefined,
  );
  if (outcome.error) return { phase: 'error', pulled: 0, pushed: 0, error: outcome.error };
  return { phase: 'synced', pulled: outcome.pulled, pushed: outcome.pushed };
};

export const createCampaignZeroRun = (campaignId: string, at = Date.now()): CampaignZeroRun => {
  if (!campaignId.trim()) throw new Error('Không tìm thấy chiến dịch để bắt đầu Campaign 0.');
  return {
    version: 1,
    campaignId,
    status: 'running',
    workSessions: [],
    startedAt: at,
    updatedAt: at,
  };
};

export const setCampaignZeroClientProxy = (run: CampaignZeroRun, name: string, at = Date.now()): CampaignZeroRun => {
  const normalized = name.trim().slice(0, 120);
  if (normalized.length < 2) throw new Error('Hãy nhập tên người đóng vai khách hàng.');
  return { ...run, clientProxyName: normalized, status: 'running', completedAt: undefined, updatedAt: at };
};

export const attachCampaignZeroTelemetry = (
  run: CampaignZeroRun,
  telemetry: CampaignZeroTelemetryReport,
  at = Date.now(),
): CampaignZeroRun => ({ ...run, telemetry, status: 'running', completedAt: undefined, updatedAt: at });

/** Chạy song song hai đường telemetry 0đ: usage và lifecycle attempt. */
export const runCampaignZeroTelemetryDryRun = async (
  projectId: string,
): Promise<CampaignZeroTelemetryReport> => {
  const [usage, lifecycle] = await Promise.all([
    runUsageTelemetryDryRun({ projectId }),
    runBillableLifecycleDryRun({ projectId }),
  ]);
  return { ...usage, lifecycle };
};

export const attachCampaignZeroWorkspaceProof = (
  run: CampaignZeroRun,
  proof: WorkspaceFieldTestEvidence,
  at = Date.now(),
): CampaignZeroRun => {
  const normalized = normalizeWorkspaceSyncProof(proof);
  if (!normalized || normalized.expiresAt <= at) throw new Error('Bằng chứng hai thiết bị chưa hợp lệ hoặc đã hết hạn.');
  return { ...run, workspaceSyncProof: normalized, status: 'running', completedAt: undefined, updatedAt: at };
};

export const setCampaignZeroProviderBalances = (
  run: CampaignZeroRun,
  beforeUsd: number,
  afterUsd: number,
  at = Date.now(),
): CampaignZeroRun => {
  const before = finiteAmount(beforeUsd);
  const after = finiteAmount(afterUsd);
  if (before === undefined || after === undefined) throw new Error('Số dư provider phải là số không âm.');
  if (after > before) throw new Error('Số dư sau không thể lớn hơn số dư trước trong lần đối soát này.');
  return {
    ...run,
    providerBalanceBeforeUsd: before,
    providerBalanceAfterUsd: after,
    status: 'running',
    completedAt: undefined,
    updatedAt: at,
  };
};

export const setCampaignZeroProviderBalanceBefore = (
  run: CampaignZeroRun,
  beforeUsd: number,
  at = Date.now(),
): CampaignZeroRun => {
  const before = finiteAmount(beforeUsd);
  if (before === undefined) throw new Error('Số dư provider trước test phải là số không âm.');
  return {
    ...run,
    providerBalanceBeforeUsd: before,
    providerBalanceAfterUsd: undefined,
    status: 'running',
    completedAt: undefined,
    updatedAt: at,
  };
};

export const startCampaignZeroWorkSession = (
  run: CampaignZeroRun,
  stage: CampaignZeroStage,
  at = Date.now(),
): CampaignZeroRun => {
  if (run.workSessions.some((session) => !session.endedAt)) throw new Error('Hãy kết thúc phiên đang chạy trước.');
  return {
    ...run,
    status: 'running',
    completedAt: undefined,
    workSessions: [{ id: createId('campaign_zero_session', at), stage, startedAt: at }, ...run.workSessions],
    updatedAt: at,
  };
};

export const stopCampaignZeroWorkSession = (run: CampaignZeroRun, at = Date.now()): CampaignZeroRun => {
  const active = run.workSessions.find((session) => !session.endedAt);
  if (!active) throw new Error('Không có phiên làm việc nào đang chạy.');
  return {
    ...run,
    workSessions: run.workSessions.map((session) => session.id === active.id
      ? { ...session, endedAt: Math.max(at, session.startedAt) }
      : session),
    updatedAt: at,
  };
};

const roundIsInternallyApproved = (project: ProjectState): boolean => (project.agencyReview?.rounds || []).some((round) => (
  round.gates.length === 3 && round.gates.every((gate) => gate.status === 'approved')
));

const roundIsClientApproved = (project: ProjectState): boolean => (project.agencyReview?.rounds || []).some((round) => (
  round.status === 'approved' && Boolean(round.portalId) && Boolean(round.clientDecisionAt)
));

export const buildCampaignZeroSnapshot = (input: {
  campaign: AgencyCampaign;
  client: AgencyClient;
  projects: ProjectState[];
  run?: CampaignZeroRun;
  usageRecords?: UsageRecord[];
  lifecycleEvents?: BillableLifecycleEvent[];
  now?: number;
}): CampaignZeroSnapshot => {
  const { campaign, client, run } = input;
  const now = input.now ?? Date.now();
  const linkedIds = new Set([
    ...campaign.projectIds,
    ...campaign.deliverables.map((deliverable) => deliverable.projectId).filter(Boolean) as string[],
  ]);
  const campaignProjects = input.projects.filter((project) => project.campaignId === campaign.id || linkedIds.has(project.id));
  const projectIds = new Set(campaignProjects.map((project) => project.id));
  const usage = (input.usageRecords || []).filter((record) => record.projectId && projectIds.has(record.projectId));
  const successfulKinds = new Set(usage.filter((record) => record.status === 'success').map((record) => record.kind));
  const estimatedCostUsd = usage.reduce((sum, record) => sum + record.estimatedCostUsd, 0);
  const completedWorkMs = (run?.workSessions || []).reduce((sum, session) => (
    sum + (session.endedAt ? Math.max(0, session.endedAt - session.startedAt) : 0)
  ), 0);
  const activeSession = run?.workSessions.find((session) => !session.endedAt);
  const displayWorkMs = completedWorkMs + (activeSession ? Math.max(0, now - activeSession.startedAt) : 0);
  const actualProviderSpendUsd = run?.providerBalanceBeforeUsd !== undefined && run.providerBalanceAfterUsd !== undefined
    ? Math.max(0, run.providerBalanceBeforeUsd - run.providerBalanceAfterUsd)
    : undefined;
  const brief = getCampaignBriefReadiness(campaign, client);
  const brand = getBrandKitReadiness(client.brandKit);
  const telemetryCloudReady = run?.telemetry?.cloud === 'synced';
  const lifecycleCloudReady = run?.telemetry?.lifecycle?.cloud === 'synced';
  const workspaceSyncReady = Boolean(
    run?.workspaceSyncProof?.status === 'verified'
    && run.workspaceSyncProof.verifiedAt
    && run.workspaceSyncProof.expiresAt > now,
  );
  const gates: CampaignZeroGate[] = [
    { id: 'brief', group: 'foundation', label: 'Brief sẵn sàng từ 80%', detail: `Hiện tại ${brief.score}% · còn thiếu ${brief.missing.length} mục`, complete: brief.score >= 80 },
    { id: 'brand-kit', group: 'foundation', label: 'Brand Kit sẵn sàng từ 80%', detail: `Hiện tại ${brand.score}% · còn thiếu ${brand.missing.length} mục`, complete: brand.score >= 80 },
    { id: 'project', group: 'foundation', label: 'Đã tạo project từ deliverable', detail: `${campaignProjects.length} project liên kết hợp lệ`, complete: campaignProjects.length > 0 },
    { id: 'client-proxy', group: 'instrumentation', label: 'Đã chỉ định người đóng vai khách', detail: run?.clientProxyName || 'Phải là người không tham gia sinh nội dung nếu có thể', complete: Boolean(run?.clientProxyName) },
    { id: 'telemetry', group: 'instrumentation', label: 'Usage + lifecycle chạy khô thành công', detail: telemetryCloudReady && lifecycleCloudReady ? 'Usage và 6 pha lifecycle đã được cloud xác nhận · chi phí 0 USD' : run?.telemetry ? 'Usage đã chạy; lifecycle attempt chưa được cloud xác nhận đầy đủ' : 'Chưa chạy kiểm tra 0đ', complete: telemetryCloudReady && lifecycleCloudReady },
    { id: 'workspace-sync', group: 'instrumentation', label: 'Đồng bộ hai thiết bị đã được chứng minh', detail: workspaceSyncReady ? `Mã ${run?.workspaceSyncProof?.code} · ${run?.workspaceSyncProof?.deviceA.label} ↔ ${run?.workspaceSyncProof?.deviceB?.label}` : run?.workspaceSyncProof ? 'Bằng chứng đã hết hạn; hãy chạy lại tại Trung tâm đồng bộ' : 'Tạo mã trên thiết bị A, xác nhận bằng thiết bị B rồi chốt', complete: workspaceSyncReady },
    { id: 'human-time', group: 'instrumentation', label: 'Đã ghi thời gian nhân sự', detail: `${Math.round(completedWorkMs / 60000)} phút đã đóng phiên`, complete: completedWorkMs > 0 },
    { id: 'chat', group: 'production', label: 'Có một lượt chat rẻ thành công', detail: 'Dùng để kiểm prompt, routing và usage trước media', complete: successfulKinds.has('chat') },
    { id: 'image', group: 'production', label: 'Có ít nhất một ảnh draft thành công', detail: 'Chỉ nâng model sau khi draft được duyệt', complete: successfulKinds.has('image') },
    { id: 'video', group: 'production', label: 'Có ít nhất một video ngắn thành công', detail: 'Chạy sau ảnh với budget cap đã chốt', complete: successfulKinds.has('video') },
    { id: 'internal-review', group: 'review', label: 'Director → Editor → Account đã duyệt', detail: 'Ba gate phải duyệt riêng, không duyệt hàng loạt', complete: campaignProjects.some(roundIsInternallyApproved) },
    { id: 'client-review', group: 'review', label: 'Client hoặc proxy đã duyệt qua portal', detail: 'Quyết định phải gắn version và thời điểm duyệt', complete: campaignProjects.some(roundIsClientApproved) },
    { id: 'delivery', group: 'delivery', label: 'Toàn bộ deliverable đã bàn giao', detail: 'Master đã duyệt và trạng thái đầu ra là Đã bàn giao', complete: campaign.deliverables.length > 0 && campaign.deliverables.every((item) => item.status === 'delivered') },
    { id: 'reconciliation', group: 'delivery', label: 'Đã đối soát số dư provider', detail: actualProviderSpendUsd === undefined ? 'Nhập số dư trước và sau Golden Run' : `Chi tiêu thực tế ${actualProviderSpendUsd.toFixed(4)} USD`, complete: actualProviderSpendUsd !== undefined },
  ];
  const billable = buildBillableReconciliation({
    projects: campaignProjects,
    usageRecords: usage,
    lifecycleEvents: input.lifecycleEvents || [],
  });
  const completedGates = gates.filter((gate) => gate.complete).length;
  return {
    gates,
    completedGates,
    totalGates: gates.length,
    progress: Math.round((completedGates / gates.length) * 100),
    nextGate: gates.find((gate) => !gate.complete),
    projectCount: campaignProjects.length,
    requestCount: usage.length,
    failureCount: usage.filter((record) => record.status === 'failed').length,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    actualProviderSpendUsd,
    costVarianceUsd: actualProviderSpendUsd === undefined ? undefined : Number((actualProviderSpendUsd - estimatedCostUsd).toFixed(6)),
    workMinutes: Math.round(displayWorkMs / 60000),
    activeSession,
    billable,
  };
};

export const buildCampaignZeroPaidPreflight = (input: {
  campaign: AgencyCampaign;
  run?: CampaignZeroRun;
  snapshot: CampaignZeroSnapshot;
  hasConfiguredVoiceProvider: boolean;
}): CampaignZeroPaidPreflight => {
  const checks: CampaignZeroPaidPreflightCheck[] = [
    {
      id: 'telemetry',
      label: 'Dry-run usage và lifecycle đã lên cloud',
      detail: 'Phải đủ 6 pha giả lập và tổng chi phí 0 USD.',
      complete: input.run?.telemetry?.cloud === 'synced' && input.run.telemetry.lifecycle?.cloud === 'synced',
    },
    {
      id: 'project',
      label: 'Có project Campaign 0 hợp lệ',
      detail: `${input.snapshot.projectCount} project đang liên kết.`,
      complete: input.snapshot.projectCount > 0,
    },
    {
      id: 'balance',
      label: 'Đã chốt số dư provider trước test',
      detail: input.run?.providerBalanceBeforeUsd === undefined ? 'Nhập số dư trước khi mở request thật.' : `${input.run.providerBalanceBeforeUsd.toFixed(4)} USD`,
      complete: input.run?.providerBalanceBeforeUsd !== undefined,
    },
    {
      id: 'budget',
      label: 'Chiến dịch có ngân sách đã duyệt',
      detail: `${input.campaign.budget.toLocaleString('vi-VN')} ${input.campaign.currency}`,
      complete: input.campaign.budget > 0,
    },
    {
      id: 'voice-provider',
      label: 'Có provider voice trả phí đã cấu hình',
      detail: input.hasConfiguredVoiceProvider ? 'Khóa voice đã sẵn sàng trên thiết bị này.' : 'Cần cấu hình FPT.AI, Viettel AI hoặc ElevenLabs.',
      complete: input.hasConfiguredVoiceProvider,
    },
    {
      id: 'unresolved-jobs',
      label: 'Không còn tác vụ trả phí mất dấu',
      detail: input.snapshot.billable.riskCount ? `${input.snapshot.billable.riskCount} điểm cần đối chiếu trước khi gọi mới.` : 'Không có job interrupted hoặc khoảng trống telemetry.',
      complete: input.snapshot.billable.riskCount === 0,
    },
  ];
  return {
    ready: checks.every((check) => check.complete),
    checks,
    blockers: checks.filter((check) => !check.complete),
    maxTestCharacters: 200,
  };
};

export const completeCampaignZeroRun = (
  run: CampaignZeroRun,
  snapshot: CampaignZeroSnapshot,
  at = Date.now(),
): CampaignZeroRun => {
  if (snapshot.completedGates !== snapshot.totalGates) {
    throw new Error(`Campaign 0 còn ${snapshot.totalGates - snapshot.completedGates} cổng chưa hoàn tất.`);
  }
  if (snapshot.activeSession) throw new Error('Hãy kết thúc phiên làm việc trước khi đóng Campaign 0.');
  return { ...run, status: 'completed', completedAt: at, updatedAt: at };
};
