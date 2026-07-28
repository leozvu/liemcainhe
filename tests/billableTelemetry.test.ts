import { describe, expect, it, vi } from 'vitest';
import { ProjectState, ProductionJob } from '../types';
import { createNewProjectState } from '../services/storageService';
import {
  BillableLifecycleEvent,
  buildBillableReconciliation,
  runBillableLifecycleDryRun,
} from '../services/billableTelemetryService';
import { UsageRecord } from '../services/usageService';

const job = (input: Partial<ProductionJob> & Pick<ProductionJob, 'id' | 'kind' | 'status' | 'resourceId'>): ProductionJob => ({
  stage: 'director',
  label: input.id,
  progress: input.status === 'completed' ? 100 : 40,
  attempts: 1,
  createdAt: 100,
  updatedAt: 200,
  ...input,
});

const lifecycle = (input: Partial<BillableLifecycleEvent> & Pick<BillableLifecycleEvent, 'id' | 'jobId' | 'phase'>): BillableLifecycleEvent => ({
  timestamp: 100,
  projectId: 'project_billable',
  kind: 'voice',
  resourceId: 'voice_1',
  ...input,
});

const usage = (input: Partial<UsageRecord> & Pick<UsageRecord, 'id' | 'kind' | 'resourceId'>): UsageRecord => ({
  timestamp: 200,
  projectId: 'project_billable',
  providerId: 'kie',
  modelId: 'test-model',
  units: 1,
  estimatedCostUsd: 0.1,
  status: 'success',
  ...input,
});

describe('billable lifecycle telemetry', () => {
  it('dry-run ghi đủ 6 pha theo thứ tự, sync cloud và luôn có chi phí 0', async () => {
    let events: BillableLifecycleEvent[] = [];
    const sync = vi.fn().mockResolvedValue('synced');
    const report = await runBillableLifecycleDryRun({
      now: () => 1_000,
      projectId: 'campaign_0',
      read: () => events,
      write: (next) => { events = next; },
      sync,
    });

    expect(report).toMatchObject({ status: 'passed', cloud: 'synced', estimatedCostUsd: 0, units: 0 });
    expect(report.phases).toEqual([
      'preflight-passed',
      'submitted',
      'provider-accepted',
      'provider-task',
      'output-committed',
      'completed',
    ]);
    expect(sync).toHaveBeenCalledTimes(6);
    expect(events).toHaveLength(6);
    expect(events.every((event) => event.dryRun)).toBe(true);
  });

  it('đối chiếu được job khớp usage và chỉ ra ba loại rủi ro giá vốn', () => {
    const project: ProjectState = {
      ...createNewProjectState(),
      id: 'project_billable',
      workflow: {
        ...createNewProjectState().workflow!,
        jobs: [
          job({ id: 'job_image', kind: 'asset-image', status: 'completed', resourceId: 'character:image_1' }),
          job({ id: 'job_video', kind: 'video', status: 'interrupted', resourceId: 'video_1', providerTaskId: 'provider_video_1' }),
          job({ id: 'job_voice', kind: 'voice', status: 'failed', resourceId: 'voice_1' }),
        ],
      },
    };
    const report = buildBillableReconciliation({
      projects: [project],
      usageRecords: [
        usage({ id: 'usage_image', kind: 'image', resourceId: 'asset:character:image_1' }),
        usage({ id: 'usage_orphan', kind: 'video', resourceId: 'orphan_video' }),
      ],
      lifecycleEvents: [
        lifecycle({ id: 'life_image_submit', jobId: 'job_image', kind: 'asset-image', resourceId: 'character:image_1', phase: 'submitted' }),
        lifecycle({ id: 'life_image_accept', jobId: 'job_image', kind: 'asset-image', resourceId: 'character:image_1', phase: 'provider-accepted' }),
        lifecycle({ id: 'life_voice_submit', jobId: 'job_voice', phase: 'submitted' }),
        lifecycle({ id: 'life_voice_accept', jobId: 'job_voice', phase: 'provider-accepted' }),
        lifecycle({ id: 'life_dedupe', jobId: 'job_image', kind: 'asset-image', resourceId: 'character:image_1', phase: 'deduplicated' }),
      ],
    });

    expect(report).toMatchObject({
      attempts: 3,
      matched: 1,
      interrupted: 1,
      acceptedFailures: 1,
      usageWithoutJob: 1,
      completedWithoutUsage: 0,
      deduplicated: 1,
      riskCount: 3,
    });
    expect(report.issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining([
      'interrupted',
      'accepted-failure',
      'usage-without-job',
    ]));
  });

  it('đánh dấu job completed thiếu usage là khoảng trống telemetry', () => {
    const project = createNewProjectState();
    project.id = 'project_billable';
    project.workflow!.jobs = [job({ id: 'job_video_done', kind: 'video', status: 'completed', resourceId: 'video_done' })];
    const report = buildBillableReconciliation({ projects: [project], usageRecords: [], lifecycleEvents: [] });
    expect(report.completedWithoutUsage).toBe(1);
    expect(report.issues[0]).toMatchObject({ kind: 'job-without-usage', jobId: 'job_video_done' });
  });
});
