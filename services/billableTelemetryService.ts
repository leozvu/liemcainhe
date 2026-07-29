import { ProductionJob, ProductionJobKind, ProjectState } from '../types';
import type { TelemetryCloudStatus, UsageKind, UsageRecord } from './usageService';
import { isHostedRuntime } from './hostedRuntime';

export type BillableLifecyclePhase =
  | 'preflight-passed'
  | 'preflight-blocked'
  | 'submitted'
  | 'provider-accepted'
  | 'provider-task'
  | 'output-committed'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'deduplicated';

export interface BillableLifecycleEvent {
  id: string;
  timestamp: number;
  projectId: string;
  jobId: string;
  kind: ProductionJobKind;
  resourceId?: string;
  idempotencyKey?: string;
  providerTaskId?: string;
  phase: BillableLifecyclePhase;
  sequence?: number;
  error?: string;
  dryRun?: boolean;
}

export interface BillableLifecycleDryRunReport {
  status: 'passed';
  checkedAt: number;
  recordIds: string[];
  phases: BillableLifecyclePhase[];
  localPersisted: true;
  cloud: TelemetryCloudStatus;
  estimatedCostUsd: 0;
  units: 0;
}

export interface BillableReconciliationIssue {
  id: string;
  kind: 'interrupted' | 'accepted-failure' | 'job-without-usage' | 'usage-without-job';
  label: string;
  detail: string;
  projectId: string;
  jobId?: string;
  resourceId?: string;
  providerTaskId?: string;
}

export interface BillableReconciliationReport {
  attempts: number;
  submitted: number;
  providerAccepted: number;
  completed: number;
  matched: number;
  interrupted: number;
  failed: number;
  deduplicated: number;
  completedWithoutUsage: number;
  usageWithoutJob: number;
  acceptedFailures: number;
  riskCount: number;
  estimatedCostUsd: number;
  issues: BillableReconciliationIssue[];
}

const STORAGE_KEY = 'egoric_billable_lifecycle_v1';
const MAX_EVENTS = 2_000;
const BILLABLE_KINDS = new Set<ProductionJobKind>(['asset-image', 'keyframe-image', 'video', 'voice']);
const PHASE_SEQUENCE: Record<BillableLifecyclePhase, number> = {
  'preflight-passed': 10,
  'preflight-blocked': 15,
  submitted: 20,
  'provider-accepted': 30,
  'provider-task': 40,
  'output-committed': 50,
  completed: 60,
  failed: 60,
  interrupted: 60,
  deduplicated: 70,
};

const createId = (timestamp: number): string =>
  `bill_${timestamp.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const readStoredEvents = (): BillableLifecycleEvent[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeStoredEvents = (events: BillableLifecycleEvent[]): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, MAX_EVENTS)));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('egoric-billable-lifecycle-updated'));
};

const isHosted = isHostedRuntime;

const postHostedLifecycle = async (event: BillableLifecycleEvent): Promise<TelemetryCloudStatus> => {
  if (!isHosted()) return 'local-only';
  const response = await fetch('/api/account/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: event.projectId,
      severity: event.phase === 'failed' || event.phase === 'interrupted' || event.phase === 'preflight-blocked' ? 'warning' : 'info',
      source: 'billable-lifecycle',
      message: `${event.kind} · ${event.phase}`,
      detail: event,
    }),
    keepalive: true,
  });
  if (!response.ok) throw new Error(`Lifecycle telemetry cloud trả HTTP ${response.status}.`);
  return 'synced';
};

export const getBillableLifecycleEvents = (options: { includeDryRun?: boolean } = {}): BillableLifecycleEvent[] =>
  readStoredEvents().filter((event) => options.includeDryRun || !event.dryRun);

export const recordBillableLifecycleEvent = (input: Omit<BillableLifecycleEvent, 'id' | 'timestamp'> & {
  id?: string;
  timestamp?: number;
}): BillableLifecycleEvent => {
  const timestamp = input.timestamp ?? Date.now();
  const event: BillableLifecycleEvent = {
    ...input,
    id: input.id || createId(timestamp),
    timestamp,
    sequence: input.sequence ?? PHASE_SEQUENCE[input.phase],
    error: input.error?.slice(0, 800),
  };
  // Telemetry không bao giờ được phép làm hỏng tác vụ media đang trả tiền.
  // Dry-run gọi writer trực tiếp và sẽ phát hiện lỗi lưu; runtime chỉ best effort.
  try {
    writeStoredEvents([event, ...readStoredEvents()]);
  } catch {
    // Campaign 0 reconciliation sẽ chỉ ra execution trail bị thiếu.
  }
  void postHostedLifecycle(event).catch(() => undefined);
  return event;
};

export interface BillableLifecycleDryRunOptions {
  now?: () => number;
  projectId?: string;
  read?: () => BillableLifecycleEvent[];
  write?: (events: BillableLifecycleEvent[]) => void;
  sync?: (event: BillableLifecycleEvent) => Promise<TelemetryCloudStatus>;
}

const DRY_RUN_PHASES: BillableLifecyclePhase[] = [
  'preflight-passed',
  'submitted',
  'provider-accepted',
  'provider-task',
  'output-committed',
  'completed',
];

/**
 * Kiểm tra toàn bộ đường ghi lifecycle bằng attempt giả 0đ. Hàm này không gọi
 * model, không tạo provider task và không đi vào Cost Dashboard.
 */
export const runBillableLifecycleDryRun = async (
  options: BillableLifecycleDryRunOptions = {},
): Promise<BillableLifecycleDryRunReport> => {
  const checkedAt = (options.now ?? Date.now)();
  const read = options.read ?? readStoredEvents;
  const write = options.write ?? writeStoredEvents;
  const sync = options.sync ?? postHostedLifecycle;
  const projectId = options.projectId || 'campaign-zero-dry-run';
  const jobId = `dry_job_${checkedAt.toString(36)}`;
  const idempotencyKey = `dry_key_${checkedAt.toString(36)}`;
  const events = DRY_RUN_PHASES.map((phase, index): BillableLifecycleEvent => ({
    id: `bill_dry_${checkedAt.toString(36)}_${index}`,
    timestamp: checkedAt + index,
    projectId,
    jobId,
    kind: 'voice',
    resourceId: 'campaign-zero-lifecycle-dry-run',
    idempotencyKey,
    providerTaskId: phase === 'provider-task' || index > DRY_RUN_PHASES.indexOf('provider-task') ? 'dry-provider-task' : undefined,
    phase,
    sequence: PHASE_SEQUENCE[phase],
    dryRun: true,
  }));

  write([...events].reverse().concat(read()).slice(0, MAX_EVENTS));
  const stored = read().filter((event) => event.jobId === jobId).sort((left, right) => (left.sequence || 0) - (right.sequence || 0));
  if (stored.length !== events.length || stored.some((event, index) => event.phase !== DRY_RUN_PHASES[index])) {
    throw new Error('Lifecycle telemetry không đọc lại đúng thứ tự attempt local vừa tạo.');
  }

  const statuses = await Promise.all(events.map(sync));
  const cloud: TelemetryCloudStatus = statuses.every((status) => status === 'synced') ? 'synced' : 'local-only';
  return {
    status: 'passed',
    checkedAt,
    recordIds: events.map((event) => event.id),
    phases: [...DRY_RUN_PHASES],
    localPersisted: true,
    cloud,
    estimatedCostUsd: 0,
    units: 0,
  };
};

const usageKindForJob = (kind: ProductionJobKind): UsageKind | undefined => {
  if (kind === 'asset-image' || kind === 'keyframe-image') return 'image';
  if (kind === 'video') return 'video';
  if (kind === 'voice') return 'voice';
  return undefined;
};

const canonicalResourceId = (kind: UsageKind, resourceId?: string): string => {
  const value = resourceId || 'unscoped';
  // Các entry point cũ dùng nhãn hiển thị khác nhau cho cùng một output. Chỉ
  // chuẩn hoá khi đối soát, không đổi resourceId/idempotency key đang chạy.
  if (kind === 'image' && value.startsWith('asset:')) return value.slice('asset:'.length);
  if (kind === 'video' && value.endsWith(':video')) return value.slice(0, -':video'.length);
  return value;
};

const matchKey = (projectId: string, kind: UsageKind, resourceId?: string): string =>
  `${projectId}:${kind}:${canonicalResourceId(kind, resourceId)}`;

/** Đối chiếu job, usage và lifecycle để chỉ ra nơi Dashboard có thể thiếu giá vốn. */
export const buildBillableReconciliation = (input: {
  projects: ProjectState[];
  usageRecords: UsageRecord[];
  lifecycleEvents: BillableLifecycleEvent[];
}): BillableReconciliationReport => {
  const projectIds = new Set(input.projects.map((project) => project.id));
  const jobs = input.projects.flatMap((project) => (project.workflow?.jobs || [])
    .filter((job) => BILLABLE_KINDS.has(job.kind))
    .map((job) => ({ ...job, projectId: project.id })));
  const usage = input.usageRecords.filter((record) =>
    Boolean(record.projectId && projectIds.has(record.projectId))
    && ['image', 'video', 'voice'].includes(record.kind),
  );
  const lifecycle = input.lifecycleEvents.filter((event) => projectIds.has(event.projectId) && !event.dryRun);
  const successUsageKeys = new Set(usage
    .filter((record) => record.status === 'success' && record.projectId)
    .map((record) => matchKey(record.projectId!, record.kind, record.resourceId)));
  const jobKeys = new Set(jobs.flatMap((job) => {
    const kind = usageKindForJob(job.kind);
    return kind ? [matchKey(job.projectId, kind, job.resourceId)] : [];
  }));
  const acceptedJobIds = new Set(lifecycle
    .filter((event) => event.phase === 'provider-accepted' || event.phase === 'provider-task')
    .map((event) => event.jobId));
  const submittedJobIds = new Set(lifecycle.filter((event) => event.phase === 'submitted').map((event) => event.jobId));
  const issues: BillableReconciliationIssue[] = [];

  jobs.forEach((job) => {
    const kind = usageKindForJob(job.kind);
    const hasUsage = Boolean(kind && successUsageKeys.has(matchKey(job.projectId, kind, job.resourceId)));
    if (job.status === 'interrupted') {
      issues.push({
        id: `interrupted:${job.projectId}:${job.id}`,
        kind: 'interrupted',
        label: 'Tác vụ đang mất dấu',
        detail: job.providerTaskId ? `Đối chiếu task ${job.providerTaskId} trước khi mở khóa.` : 'Provider có thể đã nhận request; không được tự chạy lại.',
        projectId: job.projectId,
        jobId: job.id,
        resourceId: job.resourceId,
        providerTaskId: job.providerTaskId,
      });
    }
    if (job.status === 'failed' && acceptedJobIds.has(job.id)) {
      issues.push({
        id: `accepted-failure:${job.projectId}:${job.id}`,
        kind: 'accepted-failure',
        label: 'Provider đã nhận rồi mới thất bại',
        detail: 'Khoản này có thể vẫn bị tính tiền dù usage đang ghi 0 USD.',
        projectId: job.projectId,
        jobId: job.id,
        resourceId: job.resourceId,
        providerTaskId: job.providerTaskId,
      });
    }
    if (job.status === 'completed' && !hasUsage) {
      issues.push({
        id: `job-without-usage:${job.projectId}:${job.id}`,
        kind: 'job-without-usage',
        label: 'Job hoàn tất nhưng thiếu usage',
        detail: 'Giá vốn Dashboard đang thấp hơn thực tế cho output này.',
        projectId: job.projectId,
        jobId: job.id,
        resourceId: job.resourceId,
        providerTaskId: job.providerTaskId,
      });
    }
  });

  usage.filter((record) => record.status === 'success' && record.projectId).forEach((record) => {
    if (jobKeys.has(matchKey(record.projectId!, record.kind, record.resourceId))) return;
    issues.push({
      id: `usage-without-job:${record.id}`,
      kind: 'usage-without-job',
      label: 'Usage không có job tương ứng',
      detail: 'Request đã vào giá vốn nhưng thiếu execution trail để điều tra hoặc chống gửi trùng.',
      projectId: record.projectId!,
      resourceId: record.resourceId,
    });
  });

  const completed = jobs.filter((job) => job.status === 'completed');
  const matched = completed.filter((job) => {
    const kind = usageKindForJob(job.kind);
    return Boolean(kind && successUsageKeys.has(matchKey(job.projectId, kind, job.resourceId)));
  }).length;
  return {
    attempts: jobs.length,
    submitted: jobs.filter((job) => submittedJobIds.has(job.id) || job.status !== 'queued').length,
    providerAccepted: jobs.filter((job) => acceptedJobIds.has(job.id) || Boolean(job.providerTaskId)).length,
    completed: completed.length,
    matched,
    interrupted: jobs.filter((job) => job.status === 'interrupted').length,
    failed: jobs.filter((job) => job.status === 'failed').length,
    deduplicated: lifecycle.filter((event) => event.phase === 'deduplicated').length,
    completedWithoutUsage: issues.filter((issue) => issue.kind === 'job-without-usage').length,
    usageWithoutJob: issues.filter((issue) => issue.kind === 'usage-without-job').length,
    acceptedFailures: issues.filter((issue) => issue.kind === 'accepted-failure').length,
    riskCount: issues.length,
    estimatedCostUsd: Number(usage.reduce((sum, record) => sum + record.estimatedCostUsd, 0).toFixed(6)),
    issues,
  };
};
