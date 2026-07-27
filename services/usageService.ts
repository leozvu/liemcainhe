import { ModelType } from '../types/model';

export type UsageKind = ModelType | 'voice' | 'cloud' | 'export';
export type UsageStatus = 'success' | 'failed';

export interface UsageRecord {
  id: string;
  timestamp: number;
  projectId?: string;
  kind: UsageKind;
  providerId?: string;
  modelId?: string;
  resourceId?: string;
  units: number;
  estimatedCostUsd: number;
  durationMs?: number;
  status: UsageStatus;
  error?: string;
}

export interface UsagePolicy {
  monthlyUnitLimit: number;
  warnAtPercent: number;
  enforceLimit: boolean;
  rates: {
    chatPerMillionCharacters: number;
    imagePerOutput: number;
    videoPerSecond: number;
    voicePerThousandCharacters: number;
  };
  modelRates?: Record<string, Partial<UsagePolicy['rates']>>;
}

export interface UsageSummary {
  units: number;
  estimatedCostUsd: number;
  successes: number;
  failures: number;
  byKind: Record<UsageKind, { units: number; estimatedCostUsd: number; requests: number }>;
  limit: number;
  percent: number;
}

const RECORDS_KEY = 'egoric_usage_records_v1';
const POLICY_KEY = 'egoric_usage_policy_v1';
const MAX_RECORDS = 500;
export const TELEMETRY_DRY_RUN_PROVIDER_ID = 'egoric-telemetry-dry-run';
let activeProjectId: string | undefined;

const DEFAULT_POLICY: UsagePolicy = {
  monthlyUnitLimit: 1000,
  warnAtPercent: 80,
  enforceLimit: false,
  rates: {
    chatPerMillionCharacters: 5,
    imagePerOutput: 0.04,
    videoPerSecond: 0.12,
    voicePerThousandCharacters: 0.02,
  },
};
const emptyKindSummary = () => ({ units: 0, estimatedCostUsd: 0, requests: 0 });

export const setUsageProjectContext = (projectId?: string): void => {
  activeProjectId = projectId;
};

export const getUsagePolicy = (): UsagePolicy => {
  try {
    const stored = JSON.parse(localStorage.getItem(POLICY_KEY) || '{}');
    return {
      ...DEFAULT_POLICY,
      ...stored,
      rates: { ...DEFAULT_POLICY.rates, ...(stored.rates || {}) },
      modelRates: stored.modelRates && typeof stored.modelRates === 'object' ? stored.modelRates : {},
    };
  } catch {
    return { ...DEFAULT_POLICY, rates: { ...DEFAULT_POLICY.rates } };
  }
};

export const saveUsagePolicy = (policy: UsagePolicy): void => {
  localStorage.setItem(POLICY_KEY, JSON.stringify(policy));
};

const readStoredUsageRecords = (): UsageRecord[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
};

export const isTelemetryDryRunRecord = (record: Pick<UsageRecord, 'providerId'>): boolean =>
  record.providerId === TELEMETRY_DRY_RUN_PROVIDER_ID;

/** Dry-run được lưu để kiểm đường telemetry nhưng không được tính vào giá vốn. */
export const getUsageRecords = (): UsageRecord[] =>
  readStoredUsageRecords().filter((record) => !isTelemetryDryRunRecord(record));

const writeStoredUsageRecords = (records: UsageRecord[]): void => {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('egoric-usage-updated'));
  }
};

const startOfCurrentMonth = (): number => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
};

export const getUsageSummary = (projectId?: string): UsageSummary => {
  const policy = getUsagePolicy();
  const records = getUsageRecords().filter((record) =>
    record.timestamp >= startOfCurrentMonth() && (!projectId || record.projectId === projectId),
  );
  const byKind: UsageSummary['byKind'] = {
    chat: emptyKindSummary(),
    image: emptyKindSummary(),
    video: emptyKindSummary(),
    voice: emptyKindSummary(),
    cloud: emptyKindSummary(),
    export: emptyKindSummary(),
  };
  records.forEach((record) => {
    const bucket = byKind[record.kind];
    bucket.units += record.units;
    bucket.estimatedCostUsd += record.estimatedCostUsd;
    bucket.requests += 1;
  });
  const units = records.reduce((sum, record) => sum + record.units, 0);
  const estimatedCostUsd = records.reduce((sum, record) => sum + record.estimatedCostUsd, 0);
  return {
    units,
    estimatedCostUsd,
    successes: records.filter((record) => record.status === 'success').length,
    failures: records.filter((record) => record.status === 'failed').length,
    byKind,
    limit: policy.monthlyUnitLimit,
    percent: policy.monthlyUnitLimit > 0 ? Math.min(100, Math.round((units / policy.monthlyUnitLimit) * 100)) : 0,
  };
};

export const assertUsageAllowed = (): void => {
  const policy = getUsagePolicy();
  if (!policy.enforceLimit) return;
  const summary = getUsageSummary();
  if (summary.units >= policy.monthlyUnitLimit) {
    throw new Error('Đã chạm hạn mức sản xuất tháng. Hãy tăng hạn mức trong Trung tâm vận hành hoặc tắt chế độ chặn cứng.');
  }
};

const calculateUsage = (kind: UsageKind, inputSize = 0, durationSeconds = 0, modelId?: string) => {
  const policy = getUsagePolicy();
  const rates = { ...policy.rates, ...(modelId ? policy.modelRates?.[modelId] : undefined) };
  if (kind === 'chat') {
    return { units: Math.max(1, Math.ceil(inputSize / 4000)), estimatedCostUsd: (inputSize / 1_000_000) * rates.chatPerMillionCharacters };
  }
  if (kind === 'image') return { units: 5, estimatedCostUsd: rates.imagePerOutput };
  if (kind === 'video') return { units: Math.max(20, durationSeconds * 20), estimatedCostUsd: durationSeconds * rates.videoPerSecond };
  if (kind === 'voice') return { units: Math.max(1, Math.ceil(inputSize / 500)), estimatedCostUsd: (inputSize / 1000) * rates.voicePerThousandCharacters };
  return { units: 1, estimatedCostUsd: 0 };
};

export type TelemetryCloudStatus = 'synced' | 'local-only';

const postHostedUsage = async (record: UsageRecord): Promise<TelemetryCloudStatus> => {
  if (typeof window === 'undefined' || !window.location.hostname.endsWith('.chatgpt.site')) {
    return 'local-only';
  }
  const response = await fetch('/api/account/usage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
    keepalive: true,
  });
  if (!response.ok) throw new Error(`Telemetry cloud trả HTTP ${response.status}.`);
  return 'synced';
};

const syncHostedUsage = (record: UsageRecord): void => {
  void postHostedUsage(record).catch(() => undefined);
};

export const recordUsage = (input: {
  kind: UsageKind;
  providerId?: string;
  modelId?: string;
  resourceId?: string;
  inputSize?: number;
  durationSeconds?: number;
  durationMs?: number;
  status: UsageStatus;
  error?: string;
}): UsageRecord => {
  const calculated = input.status === 'success'
    ? calculateUsage(input.kind, input.inputSize, input.durationSeconds, input.modelId)
    : { units: 0, estimatedCostUsd: 0 };
  const record: UsageRecord = {
    id: `usage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    projectId: activeProjectId,
    kind: input.kind,
    providerId: input.providerId,
    modelId: input.modelId,
    resourceId: input.resourceId?.trim().slice(0, 240) || undefined,
    units: calculated.units,
    estimatedCostUsd: Number(calculated.estimatedCostUsd.toFixed(6)),
    durationMs: input.durationMs,
    status: input.status,
    error: input.error?.slice(0, 500),
  };
  const records = [record, ...readStoredUsageRecords()].slice(0, MAX_RECORDS);
  writeStoredUsageRecords(records);
  syncHostedUsage(record);
  return record;
};

export interface TelemetryDryRunReport {
  status: 'passed';
  recordId: string;
  checkedAt: number;
  localPersisted: true;
  cloud: TelemetryCloudStatus;
  estimatedCostUsd: 0;
  units: 0;
}

export interface TelemetryDryRunOptions {
  now?: () => number;
  projectId?: string;
  read?: () => UsageRecord[];
  write?: (records: UsageRecord[]) => void;
  sync?: (record: UsageRecord) => Promise<TelemetryCloudStatus>;
}

/**
 * Chạy xuyên đường ghi telemetry bằng một bản ghi 0đ, không gọi provider AI.
 *
 * Bản ghi có provider riêng và bị loại khỏi mọi thống kê usage/giá vốn. Trên
 * Sites, hàm còn đợi D1 xác nhận HTTP 2xx để biết đường cloud thật sự hoạt động.
 */
export const runUsageTelemetryDryRun = async (
  options: TelemetryDryRunOptions = {},
): Promise<TelemetryDryRunReport> => {
  const now = (options.now ?? Date.now)();
  const read = options.read ?? readStoredUsageRecords;
  const write = options.write ?? writeStoredUsageRecords;
  const record: UsageRecord = {
    id: `usage_dry_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: now,
    projectId: options.projectId ?? activeProjectId,
    kind: 'cloud',
    providerId: TELEMETRY_DRY_RUN_PROVIDER_ID,
    modelId: 'Egoric Telemetry Self-check',
    resourceId: 'telemetry-dry-run',
    units: 0,
    estimatedCostUsd: 0,
    durationMs: 0,
    status: 'success',
  };

  write([record, ...read()].slice(0, MAX_RECORDS));
  if (!read().some((item) => item.id === record.id && isTelemetryDryRunRecord(item))) {
    throw new Error('Telemetry không đọc lại được bản ghi local vừa tạo.');
  }

  const cloud = await (options.sync ?? postHostedUsage)(record);
  return {
    status: 'passed',
    recordId: record.id,
    checkedAt: now,
    localPersisted: true,
    cloud,
    estimatedCostUsd: 0,
    units: 0,
  };
};
