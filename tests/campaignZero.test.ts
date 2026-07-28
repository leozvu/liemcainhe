import { describe, expect, it } from 'vitest';
import { AgencyCampaign, AgencyClient, ProjectState } from '../types';
import {
  attachCampaignZeroTelemetry,
  attachCampaignZeroWorkspaceProof,
  buildCampaignZeroPaidPreflight,
  buildCampaignZeroSnapshot,
  CampaignZeroTelemetryReport,
  completeCampaignZeroRun,
  createCampaignZeroRun,
  setCampaignZeroClientProxy,
  setCampaignZeroProviderBalanceBefore,
  setCampaignZeroProviderBalances,
  startCampaignZeroWorkSession,
  stopCampaignZeroWorkSession,
  syncCampaignZeroRuns,
} from '../services/campaignZeroService';
import { createAgencyCampaign, createAgencyClient, createCampaignDeliverable } from '../services/campaignService';
import { createNewProjectState } from '../services/storageService';
import { UsageRecord } from '../services/usageService';
import { LocalStore, SyncTransport } from '../services/workspaceSyncService';
import { WorkspaceFieldTestEvidence } from '../services/workspaceFieldTestService';

const createReadyClient = (): AgencyClient => {
  const client = createAgencyClient({ name: 'Egoric Agency', brandName: 'Egoric', industry: 'Creative Agency' });
  return {
    ...client,
    brandKit: {
      colors: [{ id: 'cyan', name: 'Egoric Cyan', hex: '#79E6DF' }],
      fonts: ['Manrope'],
      assets: [
        { id: 'logo', type: 'logo', name: 'Logo Egoric', url: 'data:image/png;base64,logo' },
        { id: 'product', type: 'product', name: 'Egoric Film Studio', url: 'data:image/png;base64,product' },
      ],
      voiceProfile: { name: 'Giọng nam miền Nam', language: 'vi-VN' },
      toneOfVoice: 'Sắc sảo, thực tế, sang trọng và luôn ưu tiên hiệu quả kinh doanh.',
      mandatoryTerms: ['Egoric'],
      forbiddenTerms: ['giá rẻ nhất'],
      ctas: ['Bắt đầu cùng Egoric'],
      approvedExamples: ['Từ ý tưởng đến video có thể chạy quảng cáo.'],
      platformRules: [{ platform: 'tiktok', safeZone: 'Chừa 14% cạnh dưới' }],
      updatedAt: 1,
    },
  };
};

const createReadyCampaign = (clientId: string): AgencyCampaign => createAgencyCampaign({
  clientId,
  name: 'Campaign 0 Egoric',
  objective: 'conversion',
  brief: 'Chứng minh Egoric Film Studio giúp agency biến brief thành video có thể duyệt, bàn giao và đo giá vốn trong một workflow duy nhất.',
  product: 'Egoric Film Studio',
  targetAudience: 'Chủ doanh nghiệp và đội marketing cần sản xuất video quảng cáo liên tục',
  offer: 'Đăng ký một buổi audit workflow miễn phí',
  contentPillars: ['Workflow agency', 'Video marketing'],
  owner: 'Egoric Team',
  budget: 5_000_000,
  currency: 'VND',
  deadline: new Date('2026-08-15T12:00:00Z').getTime(),
  deliverables: [createCampaignDeliverable({ id: 'deliverable_0', title: 'TikTok Golden Run', status: 'delivered' })],
});

const createApprovedProject = (campaign: AgencyCampaign): ProjectState => {
  const project = createNewProjectState();
  project.id = 'project_0';
  project.campaignId = campaign.id;
  project.deliverableId = campaign.deliverables[0].id;
  project.agencyReview = {
    activeRoundId: 'round_0',
    updatedAt: 900,
    rounds: [{
      id: 'round_0',
      label: 'Golden master',
      status: 'approved',
      sourceSignature: 'source_0',
      shotIds: ['shot_0'],
      portalId: 'portal_0',
      versionId: 'version_0',
      clientDecisionAt: 900,
      gates: ['director', 'editor', 'account'].map((role) => ({
        role: role as 'director' | 'editor' | 'account',
        status: 'approved' as const,
        reviewer: `Reviewer ${role}`,
        updatedAt: 800,
      })),
      createdAt: 700,
      updatedAt: 900,
    }],
  };
  return project;
};

const usage = (projectId: string): UsageRecord[] => (['chat', 'image', 'video'] as const).map((kind, index) => ({
  id: `usage_${kind}`,
  timestamp: 1000 + index,
  projectId,
  kind,
  providerId: 'kie',
  modelId: `model_${kind}`,
  resourceId: `resource_${kind}`,
  units: 1,
  estimatedCostUsd: index + 1,
  status: 'success',
}));

const telemetry: CampaignZeroTelemetryReport = {
  status: 'passed',
  recordId: 'usage_dry_0',
  checkedAt: 500,
  localPersisted: true,
  cloud: 'synced',
  estimatedCostUsd: 0,
  units: 0,
  lifecycle: {
    status: 'passed',
    checkedAt: 500,
    recordIds: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'],
    phases: ['preflight-passed', 'submitted', 'provider-accepted', 'provider-task', 'output-committed', 'completed'],
    localPersisted: true,
    cloud: 'synced',
    estimatedCostUsd: 0,
    units: 0,
  },
};

const emptyBillable = {
  attempts: 0,
  submitted: 0,
  providerAccepted: 0,
  completed: 0,
  matched: 0,
  interrupted: 0,
  failed: 0,
  deduplicated: 0,
  completedWithoutUsage: 0,
  usageWithoutJob: 0,
  acceptedFailures: 0,
  riskCount: 0,
  estimatedCostUsd: 0,
  issues: [],
};

const workspaceProof: WorkspaceFieldTestEvidence = {
  version: 1,
  id: 'ABCD2345',
  code: 'ABCD2345',
  status: 'verified',
  deviceA: { id: 'device_a_123', label: 'Laptop Account' },
  deviceB: { id: 'device_b_456', label: 'Máy dựng' },
  createdAt: 100,
  acknowledgedAt: 200,
  verifiedAt: 300,
  updatedAt: 300,
  expiresAt: 10_000,
};

describe('Campaign 0 Golden Run', () => {
  it('bắt đầu run ở trạng thái running và không tự tạo API usage', () => {
    expect(createCampaignZeroRun('campaign_0', 100)).toEqual({
      version: 1,
      campaignId: 'campaign_0',
      status: 'running',
      workSessions: [],
      startedAt: 100,
      updatedAt: 100,
    });
  });

  it('ghi một phiên nhân sự và không cho chạy hai đồng hồ cùng lúc', () => {
    const run = startCampaignZeroWorkSession(createCampaignZeroRun('campaign_0', 100), 'production', 200);
    expect(() => startCampaignZeroWorkSession(run, 'review', 250)).toThrow(/kết thúc phiên/);
    const stopped = stopCampaignZeroWorkSession(run, 3200);
    expect(stopped.workSessions[0]).toMatchObject({ stage: 'production', startedAt: 200, endedAt: 3200 });
  });

  it('chặn số dư sau lớn hơn số dư trước', () => {
    const run = createCampaignZeroRun('campaign_0', 100);
    expect(() => setCampaignZeroProviderBalances(run, 10, 12)).toThrow(/không thể lớn hơn/);
  });

  it('cho chốt riêng số dư trước để mở preflight nhưng xóa số dư sau cũ', () => {
    const reconciled = setCampaignZeroProviderBalances(createCampaignZeroRun('campaign_0', 100), 10, 9, 150);
    expect(setCampaignZeroProviderBalanceBefore(reconciled, 8, 200)).toMatchObject({
      providerBalanceBeforeUsd: 8,
      providerBalanceAfterUsd: undefined,
    });
  });

  it('chỉ chấp nhận telemetry đã được cloud xác nhận', () => {
    const client = createReadyClient();
    const campaign = createReadyCampaign(client.id);
    const localOnly = attachCampaignZeroTelemetry(createCampaignZeroRun(campaign.id, 100), { ...telemetry, cloud: 'local-only' }, 200);
    const snapshot = buildCampaignZeroSnapshot({ campaign, client, projects: [], run: localOnly, usageRecords: [], now: 300 });
    expect(snapshot.gates.find((gate) => gate.id === 'telemetry')?.complete).toBe(false);
  });

  it('không mở cổng khi usage cloud xanh nhưng thiếu lifecycle dry-run', () => {
    const client = createReadyClient();
    const campaign = createReadyCampaign(client.id);
    const legacyTelemetry = { ...telemetry, lifecycle: undefined };
    const run = attachCampaignZeroTelemetry(createCampaignZeroRun(campaign.id, 100), legacyTelemetry, 200);
    const snapshot = buildCampaignZeroSnapshot({ campaign, client, projects: [], run, usageRecords: [], now: 300 });
    expect(snapshot.gates.find((gate) => gate.id === 'telemetry')?.complete).toBe(false);
  });

  it('tổng hợp đủ 14 cổng, chi phí và chênh lệch provider', () => {
    const client = createReadyClient();
    let campaign = createReadyCampaign(client.id);
    const project = createApprovedProject(campaign);
    campaign = {
      ...campaign,
      projectIds: [project.id],
      deliverables: campaign.deliverables.map((deliverable) => ({ ...deliverable, projectId: project.id })),
    };
    let run = createCampaignZeroRun(campaign.id, 100);
    run = setCampaignZeroClientProxy(run, 'Nguyễn Minh Anh', 150);
    run = attachCampaignZeroTelemetry(run, telemetry, 200);
    run = attachCampaignZeroWorkspaceProof(run, workspaceProof, 250);
    run = startCampaignZeroWorkSession(run, 'production', 300);
    run = stopCampaignZeroWorkSession(run, 60_300);
    run = setCampaignZeroProviderBalances(run, 20, 13.5, 700);
    const snapshot = buildCampaignZeroSnapshot({ campaign, client, projects: [project], run, usageRecords: usage(project.id), now: 800 });

    expect(snapshot.totalGates).toBe(14);
    expect(snapshot.completedGates).toBe(14);
    expect(snapshot.progress).toBe(100);
    expect(snapshot.nextGate).toBeUndefined();
    expect(snapshot.estimatedCostUsd).toBe(6);
    expect(snapshot.actualProviderSpendUsd).toBe(6.5);
    expect(snapshot.costVarianceUsd).toBe(0.5);
    expect(snapshot.workMinutes).toBe(1);
  });

  it('chỉ hoàn tất cổng đồng bộ với bằng chứng đã chốt và còn hạn', () => {
    const client = createReadyClient();
    const campaign = createReadyCampaign(client.id);
    const withoutProof = buildCampaignZeroSnapshot({ campaign, client, projects: [], run: createCampaignZeroRun(campaign.id, 100), now: 400 });
    expect(withoutProof.gates.find((gate) => gate.id === 'workspace-sync')?.complete).toBe(false);

    const run = attachCampaignZeroWorkspaceProof(createCampaignZeroRun(campaign.id, 100), workspaceProof, 350);
    const verified = buildCampaignZeroSnapshot({ campaign, client, projects: [], run, now: 400 });
    const expired = buildCampaignZeroSnapshot({ campaign, client, projects: [], run, now: 10_001 });
    expect(verified.gates.find((gate) => gate.id === 'workspace-sync')?.complete).toBe(true);
    expect(expired.gates.find((gate) => gate.id === 'workspace-sync')?.complete).toBe(false);
  });

  it('không cho đóng run khi còn thiếu bằng chứng', () => {
    const client = createReadyClient();
    const campaign = createReadyCampaign(client.id);
    const run = createCampaignZeroRun(campaign.id, 100);
    const snapshot = buildCampaignZeroSnapshot({ campaign, client, projects: [], run, usageRecords: [], now: 200 });
    expect(() => completeCampaignZeroRun(run, snapshot, 300)).toThrow(/cổng chưa hoàn tất/);
  });

  it('đóng run khi đủ bằng chứng và không còn đồng hồ đang chạy', () => {
    const run = createCampaignZeroRun('campaign_0', 100);
    const completed = completeCampaignZeroRun(run, {
      gates: [],
      completedGates: 14,
      totalGates: 14,
      progress: 100,
      projectCount: 1,
      requestCount: 3,
      failureCount: 0,
      estimatedCostUsd: 1,
      workMinutes: 10,
      billable: emptyBillable,
    }, 500);
    expect(completed).toMatchObject({ status: 'completed', completedAt: 500, updatedAt: 500 });
  });

  it('paid smoke test chỉ mở khi đủ telemetry, balance, budget, provider và không có job mất dấu', () => {
    const client = createReadyClient();
    const campaign = createReadyCampaign(client.id);
    const run = setCampaignZeroProviderBalanceBefore(
      attachCampaignZeroTelemetry(createCampaignZeroRun(campaign.id, 100), telemetry, 150),
      10,
      200,
    );
    const snapshot = {
      ...buildCampaignZeroSnapshot({ campaign, client, projects: [], run, now: 300 }),
      projectCount: 1,
      billable: emptyBillable,
    };
    const ready = buildCampaignZeroPaidPreflight({ campaign, run, snapshot, hasConfiguredVoiceProvider: true });
    expect(ready.ready).toBe(true);

    const blocked = buildCampaignZeroPaidPreflight({
      campaign,
      run,
      snapshot: { ...snapshot, billable: { ...emptyBillable, riskCount: 1 } },
      hasConfiguredVoiceProvider: true,
    });
    expect(blocked.ready).toBe(false);
    expect(blocked.blockers.map((check) => check.id)).toContain('unresolved-jobs');
  });

  it('không gọi cloud khi app đang chạy local', async () => {
    let called = false;
    const transport: SyncTransport = {
      pull: async () => { called = true; return []; },
      push: async () => { called = true; },
    };
    const report = await syncCampaignZeroRuns({ hosted: false, transport });
    expect(report.phase).toBe('local-only');
    expect(called).toBe(false);
  });

  it('trả trạng thái lỗi nhưng không ném khi cloud tạm mất kết nối', async () => {
    const store: LocalStore = {
      readAll: async () => [],
      write: async () => undefined,
      remove: async () => undefined,
    };
    const transport: SyncTransport = {
      pull: async () => { throw new Error('mất kết nối'); },
      push: async () => undefined,
    };
    const report = await syncCampaignZeroRuns({ hosted: true, store, transport });
    expect(report).toMatchObject({ phase: 'error', error: 'mất kết nối' });
  });

  it('kéo toàn bộ lịch sử khi người dùng yêu cầu đồng bộ lại', async () => {
    let pulledSince = -1;
    const store: LocalStore = {
      readAll: async () => [],
      write: async () => undefined,
      remove: async () => undefined,
    };
    const transport: SyncTransport = {
      pull: async (_collection, since) => { pulledSince = since; return []; },
      push: async () => undefined,
    };
    const report = await syncCampaignZeroRuns({ hosted: true, full: true, store, transport });
    expect(report.phase).toBe('synced');
    expect(pulledSince).toBe(0);
  });
});
