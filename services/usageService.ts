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
    };
  } catch {
    return { ...DEFAULT_POLICY, rates: { ...DEFAULT_POLICY.rates } };
  }
};

export const saveUsagePolicy = (policy: UsagePolicy): void => {
  localStorage.setItem(POLICY_KEY, JSON.stringify(policy));
};

export const getUsageRecords = (): UsageRecord[] => {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]');
  } catch {
    return [];
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

const calculateUsage = (kind: UsageKind, inputSize = 0, durationSeconds = 0) => {
  const rates = getUsagePolicy().rates;
  if (kind === 'chat') {
    return { units: Math.max(1, Math.ceil(inputSize / 4000)), estimatedCostUsd: (inputSize / 1_000_000) * rates.chatPerMillionCharacters };
  }
  if (kind === 'image') return { units: 5, estimatedCostUsd: rates.imagePerOutput };
  if (kind === 'video') return { units: Math.max(20, durationSeconds * 20), estimatedCostUsd: durationSeconds * rates.videoPerSecond };
  if (kind === 'voice') return { units: Math.max(1, Math.ceil(inputSize / 500)), estimatedCostUsd: (inputSize / 1000) * rates.voicePerThousandCharacters };
  return { units: 1, estimatedCostUsd: 0 };
};

const syncHostedUsage = (record: UsageRecord): void => {
  if (typeof window === 'undefined' || !window.location.hostname.endsWith('.chatgpt.site')) return;
  void fetch('/api/account/usage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
    keepalive: true,
  }).catch(() => undefined);
};

export const recordUsage = (input: {
  kind: UsageKind;
  providerId?: string;
  modelId?: string;
  inputSize?: number;
  durationSeconds?: number;
  durationMs?: number;
  status: UsageStatus;
  error?: string;
}): UsageRecord => {
  const calculated = input.status === 'success'
    ? calculateUsage(input.kind, input.inputSize, input.durationSeconds)
    : { units: 0, estimatedCostUsd: 0 };
  const record: UsageRecord = {
    id: `usage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    projectId: activeProjectId,
    kind: input.kind,
    providerId: input.providerId,
    modelId: input.modelId,
    units: calculated.units,
    estimatedCostUsd: Number(calculated.estimatedCostUsd.toFixed(6)),
    durationMs: input.durationMs,
    status: input.status,
    error: input.error?.slice(0, 500),
  };
  const records = [record, ...getUsageRecords()].slice(0, MAX_RECORDS);
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  syncHostedUsage(record);
  window.dispatchEvent(new CustomEvent('egoric-usage-updated'));
  return record;
};
