import { describe, expect, it } from 'vitest';
import { AgencyCampaign, AgencyClient } from '../types';
import {
  AgencyEconomicsWorkspace,
  analyzeAgencyEconomics,
  CampaignFinancialProfile,
  EconomicsProjectRef,
} from '../services/agencyEconomicsService';
import { TELEMETRY_DRY_RUN_PROVIDER_ID, UsageRecord } from '../services/usageService';

const campaign = (id: string, clientId: string, name: string) => ({
  id, clientId, name, createdAt: 1, updatedAt: 1,
}) as AgencyCampaign;

const client = (id: string, brandName: string) => ({
  id, name: brandName, brandName, createdAt: 1, updatedAt: 1,
}) as AgencyClient;

const project = (
  projectId: string,
  campaignId: string,
  acceptedShotIds: string[],
): EconomicsProjectRef => ({
  projectId,
  title: `Project ${projectId}`,
  campaignId,
  approved: acceptedShotIds.length > 0,
  acceptedShotIds,
  shots: [
    { id: 'shot_1', label: 'Cảnh 01', actionSummary: 'Hero shot' },
    { id: 'shot_2', label: 'Cảnh 02', actionSummary: 'CTA' },
    { id: 'shot_3', label: 'Cảnh 03', actionSummary: 'Cutdown' },
  ],
  updatedAt: 1,
});

const usage = (input: Partial<UsageRecord> & Pick<UsageRecord, 'id' | 'timestamp' | 'projectId' | 'kind' | 'status'>): UsageRecord => ({
  units: input.status === 'success' ? 5 : 0,
  estimatedCostUsd: 0,
  ...input,
});

const financial: CampaignFinancialProfile = {
  campaignId: 'campaign_1',
  campaignName: 'Ra mắt sản phẩm',
  clientName: 'Lumière',
  quotedRevenueVnd: 10_000_000,
  laborHours: 4,
  laborHourlyRateVnd: 250_000,
  otherCostVnd: 500_000,
  exchangeRateVndPerUsd: 25_000,
  createdAt: 1,
  updatedAt: 1,
};

const workspace = (): AgencyEconomicsWorkspace => ({
  hosted: false,
  campaigns: [campaign('campaign_1', 'client_1', 'Ra mắt sản phẩm'), campaign('campaign_2', 'client_2', 'Cutdown')],
  clients: [client('client_1', 'Lumière'), client('client_2', 'Orbit')],
  projects: [project('project_1', 'campaign_1', ['shot_1']), project('project_2', 'campaign_2', ['shot_3'])],
  financials: [financial],
  usage: [
    usage({ id: 'u1', timestamp: 10, projectId: 'project_1', resourceId: 'shot_1:keyframe:start', kind: 'image', providerId: 'replicate', modelId: 'draft-image', status: 'success', estimatedCostUsd: 0.1 }),
    usage({ id: 'u2', timestamp: 20, projectId: 'project_1', resourceId: 'shot_1:keyframe:start', kind: 'image', providerId: 'kie', modelId: 'final-image', status: 'success', estimatedCostUsd: 0.1 }),
    usage({ id: 'u3', timestamp: 30, projectId: 'project_1', resourceId: 'shot_1:video', kind: 'video', providerId: 'kie', modelId: 'veo', status: 'success', estimatedCostUsd: 0.8 }),
    usage({ id: 'u4', timestamp: 40, projectId: 'project_1', resourceId: 'shot_1:voice', kind: 'voice', providerId: 'elevenlabs', modelId: 'ElevenLabs', status: 'success', estimatedCostUsd: 0.05 }),
    usage({ id: 'u5', timestamp: 50, projectId: 'project_1', resourceId: 'shot_2:keyframe:start', kind: 'image', providerId: 'replicate', modelId: 'draft-image', status: 'failed' }),
    usage({ id: 'u6', timestamp: 60, projectId: 'project_1', resourceId: 'shot_2:keyframe:start', kind: 'image', providerId: 'replicate', modelId: 'draft-image', status: 'success', estimatedCostUsd: 0.2 }),
    usage({ id: 'u7', timestamp: 70, projectId: 'project_2', resourceId: 'shot_3:keyframe:start', kind: 'image', providerId: 'kie', modelId: 'final-image', status: 'success', estimatedCostUsd: 0.3 }),
  ],
});

describe('Agency economics', () => {
  it('tính giá vốn và lợi nhuận theo campaign', () => {
    const report = analyzeAgencyEconomics(workspace(), 'campaign_1');
    const row = report.campaigns[0];
    expect(row.apiCostUsd).toBe(1.25);
    expect(row.apiCostVnd).toBe(31_250);
    expect(row.totalCostVnd).toBe(1_531_250);
    expect(row.profitVnd).toBe(8_468_750);
    expect(row.marginPercent).toBe(84.7);
    expect(report.totals.requests).toBe(6);
    expect(report.totals.failures).toBe(1);
    expect(report.totals.regenerateCount).toBe(2);
  });

  it('chỉ tính output cuối cùng của resource được duyệt cho provider', () => {
    const report = analyzeAgencyEconomics(workspace(), 'campaign_1');
    const draft = report.providers.find((row) => row.providerId === 'replicate' && row.kind === 'image');
    const final = report.providers.find((row) => row.providerId === 'kie' && row.kind === 'image');
    expect(draft?.successes).toBe(2);
    expect(draft?.acceptedOutputs).toBe(0);
    expect(final?.successes).toBe(1);
    expect(final?.acceptedOutputs).toBe(1);
    expect(final?.approvalRate).toBe(100);
  });

  it('không coi image, video và voice bình thường là regenerate của cùng một shot', () => {
    const report = analyzeAgencyEconomics(workspace(), 'campaign_1');
    const hero = report.resources.find((row) => row.resourceId === 'shot_1');
    const cta = report.resources.find((row) => row.resourceId === 'shot_2');
    expect(hero?.requests).toBe(4);
    expect(hero?.regenerateCount).toBe(1);
    expect(hero?.accepted).toBe(true);
    expect(cta?.regenerateCount).toBe(1);
    expect(cta?.accepted).toBe(false);
  });

  it('lọc khoảng thời gian mà không lẫn usage cũ', () => {
    const report = analyzeAgencyEconomics(workspace(), 'campaign_1', 45);
    expect(report.totals.requests).toBe(2);
    expect(report.totals.apiCostVnd).toBe(5_000);
  });

  it('không tính bản ghi dry-run vào request hoặc giá vốn', () => {
    const input = workspace();
    input.usage.push(usage({
      id: 'dry_1',
      timestamp: 80,
      projectId: 'project_1',
      resourceId: 'telemetry-dry-run',
      kind: 'cloud',
      providerId: TELEMETRY_DRY_RUN_PROVIDER_ID,
      status: 'success',
      estimatedCostUsd: 999,
    }));

    const report = analyzeAgencyEconomics(input, 'campaign_1');
    expect(report.totals.requests).toBe(6);
    expect(report.campaigns[0].apiCostUsd).toBe(1.25);
    expect(report.providers.some((row) => row.providerId === TELEMETRY_DRY_RUN_PROVIDER_ID)).toBe(false);
  });
});
