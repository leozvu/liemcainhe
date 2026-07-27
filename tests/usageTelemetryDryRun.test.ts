import { describe, expect, it, vi } from 'vitest';
import {
  TELEMETRY_DRY_RUN_PROVIDER_ID,
  UsageRecord,
  isTelemetryDryRunRecord,
  runUsageTelemetryDryRun,
} from '../services/usageService';

const memory = () => {
  let rows: UsageRecord[] = [];
  return {
    read: () => [...rows],
    write: (next: UsageRecord[]) => { rows = [...next]; },
    get rows() { return rows; },
  };
};

describe('dry-run telemetry không tiêu credit', () => {
  it('ghi rồi đọc lại đúng bản ghi 0đ và đợi cloud xác nhận', async () => {
    const store = memory();
    const sync = vi.fn(async () => 'synced' as const);
    const report = await runUsageTelemetryDryRun({
      now: () => 500,
      projectId: 'campaign_0',
      read: store.read,
      write: store.write,
      sync,
    });

    expect(report).toMatchObject({
      status: 'passed',
      checkedAt: 500,
      localPersisted: true,
      cloud: 'synced',
      estimatedCostUsd: 0,
      units: 0,
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      projectId: 'campaign_0',
      providerId: TELEMETRY_DRY_RUN_PROVIDER_ID,
      resourceId: 'telemetry-dry-run',
      status: 'success',
      estimatedCostUsd: 0,
      units: 0,
    });
    expect(sync).toHaveBeenCalledOnce();
  });

  it('nhận diện riêng để dashboard không tính vào giá vốn', () => {
    expect(isTelemetryDryRunRecord({ providerId: TELEMETRY_DRY_RUN_PROVIDER_ID })).toBe(true);
    expect(isTelemetryDryRunRecord({ providerId: 'kie' })).toBe(false);
  });

  it('dừng và báo lỗi nếu lớp lưu trữ không đọc lại được', async () => {
    const sync = vi.fn(async () => 'synced' as const);
    await expect(runUsageTelemetryDryRun({
      read: () => [],
      write: () => undefined,
      sync,
    })).rejects.toThrow(/không đọc lại/);
    expect(sync).not.toHaveBeenCalled();
  });
});
