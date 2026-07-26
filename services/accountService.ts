import { getUsagePolicy, getUsageRecords, getUsageSummary, UsageRecord } from './usageService';

export interface SystemEvent {
  id: string;
  projectId?: string;
  severity: 'info' | 'warning' | 'error';
  source: string;
  message: string;
  createdAt: number;
}

export interface AccountProfile {
  email?: string;
  displayName: string;
  studioName: string;
  plan: string;
  monthlyUnitLimit: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface AccountOverview {
  profile: AccountProfile;
  monthlyUnits: number;
  estimatedCostUsd: number;
  recentEvents: UsageRecord[];
  systemEvents: SystemEvent[];
  hosted: boolean;
}

const PROFILE_KEY = 'egoric_account_profile_v1';

const localProfile = (): AccountProfile => {
  const policy = getUsagePolicy();
  try {
    return {
      displayName: 'Nhà sản xuất Egoric',
      studioName: 'Egoric Agency',
      plan: 'Bản thử Studio',
      monthlyUnitLimit: policy.monthlyUnitLimit,
      ...JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'),
    };
  } catch {
    return { displayName: 'Nhà sản xuất Egoric', studioName: 'Egoric Agency', plan: 'Bản thử Studio', monthlyUnitLimit: policy.monthlyUnitLimit };
  }
};

const isHosted = () => typeof window !== 'undefined' && window.location.hostname.endsWith('.chatgpt.site');

export const getAccountOverview = async (): Promise<AccountOverview> => {
  if (isHosted()) {
    try {
      const response = await fetch('/api/account');
      if (response.ok) return { ...(await response.json()), hosted: true };
    } catch {
      // Dùng bản local khi site tạm thời mất kết nối.
    }
  }
  const summary = getUsageSummary();
  return { profile: localProfile(), monthlyUnits: summary.units, estimatedCostUsd: summary.estimatedCostUsd, recentEvents: getUsageRecords().slice(0, 20), systemEvents: [], hosted: false };
};

export const saveAccountProfile = async (profile: AccountProfile): Promise<AccountProfile> => {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  if (isHosted()) {
    const response = await fetch('/api/account', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(profile),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Không thể lưu hồ sơ workspace');
    return (await response.json()).profile;
  }
  return profile;
};

export const recordSystemEvent = (input: {
  projectId?: string;
  severity: 'info' | 'warning' | 'error';
  source: string;
  message: string;
  detail?: Record<string, unknown>;
}): void => {
  if (!isHosted()) return;
  void fetch('/api/account/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    keepalive: true,
  }).catch(() => undefined);
};

export const exportAccountData = async (): Promise<void> => {
  const response = await fetch('/api/account/export');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Không thể xuất dữ liệu tài khoản');
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `egoric-account-export-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const deleteAccountData = async (): Promise<void> => {
  const response = await fetch('/api/account/data', {
    method: 'DELETE',
    headers: { 'x-egoric-confirm': 'DELETE_ACCOUNT_DATA' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Không thể xóa dữ liệu tài khoản');
};
