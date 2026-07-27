import { describe, expect, it } from 'vitest';
import {
  createWorkspaceSyncController,
  WorkspaceSyncRuntimeState,
} from '../services/workspaceSyncCoordinatorService';
import { SyncOutcome } from '../services/workspaceSyncService';

const outcome = (overrides: Partial<SyncOutcome> = {}): SyncOutcome => ({
  collection: 'agencyClients',
  pulled: 0,
  pushed: 0,
  deleted: 0,
  ...overrides,
});

describe('điều phối đồng bộ workspace', () => {
  it('không gọi cloud ở bản local và nói rõ dữ liệu đang nằm trên máy', async () => {
    let calls = 0;
    const controller = createWorkspaceSyncController({
      hosted: () => false,
      online: () => true,
      sync: async () => { calls += 1; return []; },
    });
    const state = await controller.run({ full: true });
    expect(state.phase).toBe('local-only');
    expect(state.summary).toContain('Bản local');
    expect(calls).toBe(0);
  });

  it('giữ trạng thái offline và không thử request vô ích', async () => {
    let calls = 0;
    const controller = createWorkspaceSyncController({
      hosted: () => true,
      online: () => false,
      sync: async () => { calls += 1; return []; },
    });
    const state = await controller.run();
    expect(state.phase).toBe('offline');
    expect(state.summary).toContain('giữ trên máy');
    expect(calls).toBe(0);
  });

  it('tổng hợp số bản ghi và phát tín hiệu khi cloud kéo dữ liệu mới về', async () => {
    const applied: SyncOutcome[][] = [];
    let full = false;
    const controller = createWorkspaceSyncController({
      hosted: () => true,
      online: () => true,
      now: () => 123,
      sync: async (requestedFull) => {
        full = requestedFull;
        return [outcome({ pulled: 2, pushed: 1, deleted: 1 })];
      },
      onApplied: (outcomes) => applied.push(outcomes),
    });
    const states: WorkspaceSyncRuntimeState[] = [];
    controller.subscribe((state) => states.push({ ...state }));
    const state = await controller.run({ full: true });
    expect(full).toBe(true);
    expect(state).toMatchObject({ phase: 'synced', pulled: 2, pushed: 1, deleted: 1, lastSyncedAt: 123 });
    expect(states.some((item) => item.phase === 'syncing')).toBe(true);
    expect(applied).toHaveLength(1);
  });

  it('lỗi một nhóm không che mất phần đã đồng bộ thành công', async () => {
    const controller = createWorkspaceSyncController({
      hosted: () => true,
      online: () => true,
      sync: async () => [outcome({ pushed: 2 }), outcome({ collection: 'agencyCampaigns', error: 'HTTP 503' })],
    });
    const state = await controller.run();
    expect(state).toMatchObject({ phase: 'error', pushed: 2, pendingCollections: 1 });
    expect(state.summary).toContain('sẽ thử lại');
  });

  it('không chạy chồng; yêu cầu đến giữa lượt được gộp thành đúng một lượt sau', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstRun = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const requestedModes: boolean[] = [];
    const controller = createWorkspaceSyncController({
      hosted: () => true,
      online: () => true,
      sync: async (full) => {
        requestedModes.push(full);
        if (requestedModes.length === 1) await firstRun;
        return [outcome()];
      },
    });
    const first = controller.run();
    const queued = controller.run({ full: true });
    releaseFirst?.();
    await Promise.all([first, queued]);
    expect(requestedModes).toEqual([false, true]);
  });
});
