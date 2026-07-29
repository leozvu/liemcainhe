import { AgencyCampaign, AgencyClient, ProjectState } from '../types';
import { getAllAgencyCampaigns, getAllAgencyClients, getAllProjectsMetadata } from './storageService';
import { getUsageRecords, isTelemetryDryRunRecord, UsageKind, UsageRecord } from './usageService';
import { isHostedRuntime } from './hostedRuntime';

export interface CampaignFinancialProfile {
  campaignId: string;
  campaignName: string;
  clientName?: string;
  quotedRevenueVnd: number;
  laborHours: number;
  laborHourlyRateVnd: number;
  otherCostVnd: number;
  exchangeRateVndPerUsd: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface EconomicsProjectRef {
  projectId: string;
  title: string;
  campaignId?: string;
  clientId?: string;
  deliverableId?: string;
  approved: boolean;
  acceptedShotIds: string[];
  shots: Array<{ id: string; label: string; actionSummary?: string }>;
  updatedAt: number;
}

export interface AgencyEconomicsWorkspace {
  usage: UsageRecord[];
  financials: CampaignFinancialProfile[];
  projects: EconomicsProjectRef[];
  campaigns: AgencyCampaign[];
  clients: AgencyClient[];
  hosted: boolean;
}

export interface CampaignEconomicsRow {
  campaignId: string;
  campaignName: string;
  clientName: string;
  projectCount: number;
  requestCount: number;
  regenerateCount: number;
  apiCostUsd: number;
  apiCostVnd: number;
  laborCostVnd: number;
  otherCostVnd: number;
  totalCostVnd: number;
  quotedRevenueVnd: number;
  profitVnd: number;
  marginPercent: number;
  approvedProjects: number;
  profile: CampaignFinancialProfile;
}

export interface ProviderEconomicsRow {
  id: string;
  providerId: string;
  modelId: string;
  kind: UsageKind;
  requests: number;
  successes: number;
  failures: number;
  acceptedOutputs: number;
  approvalRate: number;
  successRate: number;
  costUsd: number;
  costPerApprovedUsd: number;
}

export interface ResourceEconomicsRow {
  id: string;
  projectId: string;
  projectTitle: string;
  resourceId: string;
  label: string;
  requests: number;
  successes: number;
  failures: number;
  regenerateCount: number;
  costUsd: number;
  accepted: boolean;
  providerModels: string[];
}

export interface AgencyEconomicsReport {
  campaigns: CampaignEconomicsRow[];
  providers: ProviderEconomicsRow[];
  resources: ResourceEconomicsRow[];
  totals: {
    quotedRevenueVnd: number;
    apiCostVnd: number;
    laborCostVnd: number;
    otherCostVnd: number;
    totalCostVnd: number;
    profitVnd: number;
    marginPercent: number;
    requests: number;
    failures: number;
    regenerateCount: number;
  };
}

const FINANCIALS_KEY = 'egoric_campaign_financials_v1';
const hosted = isHostedRuntime;
const clampAmount = (value: number, max = 1_000_000_000_000): number => Math.max(0, Math.min(max, Number(value) || 0));

const parseFinancials = (): CampaignFinancialProfile[] => {
  try {
    const value = JSON.parse(localStorage.getItem(FINANCIALS_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
};

const persistFinancials = (financials: CampaignFinancialProfile[]): void => {
  localStorage.setItem(FINANCIALS_KEY, JSON.stringify(financials.slice(0, 1000)));
};

const projectRefFromState = (project: ProjectState): EconomicsProjectRef => {
  const acceptedShotIds = Array.from(new Set((project.agencyReview?.rounds || [])
    .filter((round) => round.status === 'approved')
    .flatMap((round) => round.shotIds)));
  return {
    projectId: project.id,
    title: project.title,
    campaignId: project.campaignId,
    clientId: project.clientId,
    deliverableId: project.deliverableId,
    approved: acceptedShotIds.length > 0,
    acceptedShotIds,
    shots: project.shots.map((shot, index) => ({
      id: shot.id,
      label: `Cảnh ${String(index + 1).padStart(2, '0')}`,
      actionSummary: shot.actionSummary,
    })),
    updatedAt: project.lastModified,
  };
};

const mergeById = <T,>(local: T[], remote: T[], id: (value: T) => string, timestamp: (value: T) => number): T[] => {
  const map = new Map<string, T>();
  [...remote, ...local].forEach((value) => {
    const current = map.get(id(value));
    if (!current || timestamp(value) >= timestamp(current)) map.set(id(value), value);
  });
  return Array.from(map.values());
};

export const getAgencyEconomicsWorkspace = async (): Promise<AgencyEconomicsWorkspace> => {
  const [projects, campaigns, clients] = await Promise.all([
    getAllProjectsMetadata(),
    getAllAgencyCampaigns(),
    getAllAgencyClients(),
  ]);
  const localUsage = getUsageRecords();
  const localFinancials = parseFinancials();
  const localProjects = projects.map(projectRefFromState);
  if (!hosted()) return { usage: localUsage, financials: localFinancials, projects: localProjects, campaigns, clients, hosted: false };
  try {
    const response = await fetch('/api/agency-economics');
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Không thể tải dữ liệu tài chính cloud.');
    const financials = mergeById(localFinancials, payload.financials || [], (item) => item.campaignId, (item) => Number(item.updatedAt) || 0);
    persistFinancials(financials);
    return {
      usage: mergeById(localUsage, payload.usage || [], (item) => item.id, (item) => Number(item.timestamp) || 0),
      financials,
      projects: mergeById(localProjects, payload.projects || [], (item) => item.projectId, (item) => Number(item.updatedAt) || 0),
      campaigns,
      clients,
      hosted: true,
    };
  } catch {
    return { usage: localUsage, financials: localFinancials, projects: localProjects, campaigns, clients, hosted: false };
  }
};

export const createCampaignFinancialProfile = (
  campaignId: string,
  campaignName: string,
  clientName?: string,
): CampaignFinancialProfile => {
  const timestamp = Date.now();
  return {
    campaignId,
    campaignName,
    clientName,
    quotedRevenueVnd: 0,
    laborHours: 0,
    laborHourlyRateVnd: 0,
    otherCostVnd: 0,
    exchangeRateVndPerUsd: 26000,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const normalizeCampaignFinancialProfile = (profile: CampaignFinancialProfile): CampaignFinancialProfile => ({
  ...profile,
  campaignName: profile.campaignName.trim().slice(0, 240) || 'Chiến dịch chưa đặt tên',
  clientName: profile.clientName?.trim().slice(0, 200) || undefined,
  quotedRevenueVnd: clampAmount(profile.quotedRevenueVnd),
  laborHours: clampAmount(profile.laborHours, 100_000),
  laborHourlyRateVnd: clampAmount(profile.laborHourlyRateVnd),
  otherCostVnd: clampAmount(profile.otherCostVnd),
  exchangeRateVndPerUsd: Math.max(1, Math.min(1_000_000, Number(profile.exchangeRateVndPerUsd) || 26000)),
  notes: profile.notes?.trim().slice(0, 2000) || undefined,
  createdAt: Number(profile.createdAt) || Date.now(),
  updatedAt: Date.now(),
});

export const saveCampaignFinancialProfile = async (input: CampaignFinancialProfile): Promise<CampaignFinancialProfile> => {
  const profile = normalizeCampaignFinancialProfile(input);
  const local = parseFinancials();
  persistFinancials([profile, ...local.filter((item) => item.campaignId !== profile.campaignId)]);
  if (!hosted()) return profile;
  const response = await fetch('/api/agency-economics', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Không thể lưu dữ liệu tài chính chiến dịch.');
  const saved = payload.financial as CampaignFinancialProfile;
  persistFinancials([saved, ...local.filter((item) => item.campaignId !== saved.campaignId)]);
  return saved;
};

const baseResourceId = (resourceId?: string): string => {
  if (!resourceId) return 'unattributed';
  if (resourceId.startsWith('asset:')) return resourceId;
  return resourceId.split(':')[0] || resourceId;
};

const round = (value: number, decimals = 4): number => Number(value.toFixed(decimals));

export const analyzeAgencyEconomics = (
  workspace: AgencyEconomicsWorkspace,
  campaignFilter = 'all',
  since?: number,
): AgencyEconomicsReport => {
  const projectMap = new Map(workspace.projects.map((project) => [project.projectId, project]));
  const clientMap = new Map(workspace.clients.map((client) => [client.id, client]));
  const campaignMap = new Map(workspace.campaigns.map((campaign) => [campaign.id, campaign]));
  const financeMap = new Map(workspace.financials.map((profile) => [profile.campaignId, profile]));
  const usage = workspace.usage.filter((record) => {
    if (isTelemetryDryRunRecord(record)) return false;
    if (since && record.timestamp < since) return false;
    const campaignId = record.projectId ? projectMap.get(record.projectId)?.campaignId : undefined;
    return campaignFilter === 'all' || campaignId === campaignFilter;
  });

  const campaignIds = new Set<string>();
  workspace.campaigns.forEach((campaign) => {
    if (campaignFilter === 'all' || campaign.id === campaignFilter) campaignIds.add(campaign.id);
  });
  workspace.financials.forEach((profile) => {
    if (campaignFilter === 'all' || profile.campaignId === campaignFilter) campaignIds.add(profile.campaignId);
  });
  workspace.projects.forEach((project) => {
    if (project.campaignId && (campaignFilter === 'all' || project.campaignId === campaignFilter)) campaignIds.add(project.campaignId);
  });

  const campaignRows = Array.from(campaignIds).map((campaignId): CampaignEconomicsRow => {
    const campaign = campaignMap.get(campaignId);
    const client = campaign ? clientMap.get(campaign.clientId) : undefined;
    const profile = financeMap.get(campaignId) || createCampaignFinancialProfile(campaignId, campaign?.name || `Chiến dịch ${campaignId}`, client?.brandName || client?.name);
    const projectIds = workspace.projects.filter((project) => project.campaignId === campaignId).map((project) => project.projectId);
    const campaignUsage = usage.filter((record) => record.projectId && projectIds.includes(record.projectId));
    const apiCostUsd = campaignUsage.reduce((sum, record) => sum + record.estimatedCostUsd, 0);
    const apiCostVnd = apiCostUsd * profile.exchangeRateVndPerUsd;
    const laborCostVnd = profile.laborHours * profile.laborHourlyRateVnd;
    const totalCostVnd = apiCostVnd + laborCostVnd + profile.otherCostVnd;
    const profitVnd = profile.quotedRevenueVnd - totalCostVnd;
    const resourceAttempts = new Map<string, number>();
    campaignUsage.forEach((record) => {
      const key = `${record.projectId || 'workspace'}:${baseResourceId(record.resourceId)}:${record.kind}`;
      resourceAttempts.set(key, (resourceAttempts.get(key) || 0) + 1);
    });
    const regenerateCount = Array.from(resourceAttempts.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    return {
      campaignId,
      campaignName: campaign?.name || profile.campaignName,
      clientName: client?.brandName || client?.name || profile.clientName || 'Chưa gắn khách hàng',
      projectCount: projectIds.length,
      requestCount: campaignUsage.length,
      regenerateCount,
      apiCostUsd: round(apiCostUsd, 6),
      apiCostVnd: round(apiCostVnd, 0),
      laborCostVnd: round(laborCostVnd, 0),
      otherCostVnd: round(profile.otherCostVnd, 0),
      totalCostVnd: round(totalCostVnd, 0),
      quotedRevenueVnd: round(profile.quotedRevenueVnd, 0),
      profitVnd: round(profitVnd, 0),
      marginPercent: profile.quotedRevenueVnd > 0 ? round((profitVnd / profile.quotedRevenueVnd) * 100, 1) : 0,
      approvedProjects: workspace.projects.filter((project) => projectIds.includes(project.projectId) && project.approved).length,
      profile,
    };
  }).sort((left, right) => right.quotedRevenueVnd - left.quotedRevenueVnd || right.totalCostVnd - left.totalCostVnd);

  const acceptedUsageIds = new Set<string>();
  const latestAcceptedOutput = new Map<string, UsageRecord>();
  usage.forEach((record) => {
    if (record.status !== 'success' || !record.projectId) return;
    const project = projectMap.get(record.projectId);
    const resource = baseResourceId(record.resourceId);
    const accepted = Boolean(project?.approved && (
      resource === 'unattributed'
      || project.acceptedShotIds.includes(resource)
      || resource.startsWith('asset:')
    ));
    if (!accepted) return;
    const key = `${record.projectId}:${resource}:${record.kind}`;
    const current = latestAcceptedOutput.get(key);
    if (!current || record.timestamp > current.timestamp) latestAcceptedOutput.set(key, record);
  });
  latestAcceptedOutput.forEach((record) => acceptedUsageIds.add(record.id));

  const providers = new Map<string, ProviderEconomicsRow>();
  usage.forEach((record) => {
    const providerId = record.providerId || (record.kind === 'voice' ? 'voice' : 'internal');
    const modelId = record.modelId || 'Không rõ model';
    const key = `${providerId}:${modelId}:${record.kind}`;
    const row = providers.get(key) || {
      id: key, providerId, modelId, kind: record.kind, requests: 0, successes: 0, failures: 0,
      acceptedOutputs: 0, approvalRate: 0, successRate: 0, costUsd: 0, costPerApprovedUsd: 0,
    };
    row.requests += 1;
    row.costUsd += record.estimatedCostUsd;
    if (record.status === 'success') {
      row.successes += 1;
      if (acceptedUsageIds.has(record.id)) row.acceptedOutputs += 1;
    } else row.failures += 1;
    providers.set(key, row);
  });
  const providerRows = Array.from(providers.values()).map((row) => ({
    ...row,
    costUsd: round(row.costUsd, 6),
    successRate: row.requests ? round((row.successes / row.requests) * 100, 1) : 0,
    approvalRate: row.successes ? round((row.acceptedOutputs / row.successes) * 100, 1) : 0,
    costPerApprovedUsd: row.acceptedOutputs ? round(row.costUsd / row.acceptedOutputs, 4) : 0,
  })).sort((left, right) => right.costUsd - left.costUsd);

  const resources = new Map<string, ResourceEconomicsRow>();
  const resourceKindAttempts = new Map<string, number>();
  usage.forEach((record) => {
    if (!record.projectId) return;
    const project = projectMap.get(record.projectId);
    const resourceId = baseResourceId(record.resourceId);
    const key = `${record.projectId}:${resourceId}`;
    const kindKey = `${key}:${record.kind}`;
    resourceKindAttempts.set(kindKey, (resourceKindAttempts.get(kindKey) || 0) + 1);
    const shot = project?.shots.find((item) => item.id === resourceId);
    const row = resources.get(key) || {
      id: key,
      projectId: record.projectId,
      projectTitle: project?.title || record.projectId,
      resourceId,
      label: resourceId === 'unattributed'
        ? 'Tác vụ cũ chưa gắn resource'
        : shot ? `${shot.label} · ${shot.actionSummary || shot.id}` : resourceId.replaceAll(':', ' · '),
      requests: 0,
      successes: 0,
      failures: 0,
      regenerateCount: 0,
      costUsd: 0,
      accepted: Boolean(project?.approved && (resourceId === 'unattributed' || project.acceptedShotIds.includes(resourceId) || resourceId.startsWith('asset:'))),
      providerModels: [],
    };
    row.requests += 1;
    row.successes += record.status === 'success' ? 1 : 0;
    row.failures += record.status === 'failed' ? 1 : 0;
    row.costUsd += record.estimatedCostUsd;
    const providerModel = `${record.providerId || 'internal'} · ${record.modelId || record.kind}`;
    if (!row.providerModels.includes(providerModel)) row.providerModels.push(providerModel);
    resources.set(key, row);
  });
  const resourceRows = Array.from(resources.values()).map((row) => ({
    ...row,
    regenerateCount: Array.from(resourceKindAttempts.entries())
      .filter(([key]) => key.startsWith(`${row.id}:`))
      .reduce((sum, [, count]) => sum + Math.max(0, count - 1), 0),
    costUsd: round(row.costUsd, 6),
  })).sort((left, right) => right.costUsd - left.costUsd || right.regenerateCount - left.regenerateCount);

  const totals = campaignRows.reduce((result, row) => ({
    quotedRevenueVnd: result.quotedRevenueVnd + row.quotedRevenueVnd,
    apiCostVnd: result.apiCostVnd + row.apiCostVnd,
    laborCostVnd: result.laborCostVnd + row.laborCostVnd,
    otherCostVnd: result.otherCostVnd + row.otherCostVnd,
    totalCostVnd: result.totalCostVnd + row.totalCostVnd,
    profitVnd: result.profitVnd + row.profitVnd,
    marginPercent: 0,
    requests: result.requests + row.requestCount,
    failures: result.failures,
    regenerateCount: result.regenerateCount + row.regenerateCount,
  }), { quotedRevenueVnd: 0, apiCostVnd: 0, laborCostVnd: 0, otherCostVnd: 0, totalCostVnd: 0, profitVnd: 0, marginPercent: 0, requests: 0, failures: 0, regenerateCount: 0 });
  totals.failures = usage.filter((record) => record.status === 'failed').length;
  totals.marginPercent = totals.quotedRevenueVnd > 0 ? round((totals.profitVnd / totals.quotedRevenueVnd) * 100, 1) : 0;

  return { campaigns: campaignRows, providers: providerRows, resources: resourceRows, totals };
};

export const exportAgencyEconomicsCsv = (report: AgencyEconomicsReport): void => {
  const rows = [
    ['Campaign', 'Khách hàng', 'Doanh thu VND', 'API VND', 'Nhân sự VND', 'Chi phí khác VND', 'Tổng giá vốn VND', 'Lợi nhuận VND', 'Biên lợi nhuận %', 'Regenerate'],
    ...report.campaigns.map((row) => [row.campaignName, row.clientName, row.quotedRevenueVnd, row.apiCostVnd, row.laborCostVnd, row.otherCostVnd, row.totalCostVnd, row.profitVnd, row.marginPercent, row.regenerateCount]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `egoric-cost-profit-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};
