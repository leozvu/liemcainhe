import {
  WORKSPACE_DATA_CHANGED_EVENT,
} from './storageService';
import {
  changedSince,
  cloudTransport,
  describeSyncOutcomes,
  getSyncMark,
  indexedDbSyncStore,
  SyncOutcome,
  syncAllCollections,
  WORKSPACE_COLLECTIONS,
  WorkspaceCollection,
} from './workspaceSyncService';
import { isHostedRuntime } from './hostedRuntime';

export const WORKSPACE_SYNC_APPLIED_EVENT = 'egoric:workspace-sync-applied';

export type WorkspaceSyncRuntimePhase =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'local-only'
  | 'error';

export type WorkspaceSyncMode = 'full' | 'incremental';

export interface WorkspaceSyncAttempt {
  id: string;
  mode: WorkspaceSyncMode;
  startedAt: number;
  finishedAt: number;
  phase: Exclude<WorkspaceSyncRuntimePhase, 'idle' | 'syncing'>;
  summary: string;
  outcomes: SyncOutcome[];
}

export interface WorkspaceSyncRuntimeState {
  phase: WorkspaceSyncRuntimePhase;
  summary: string;
  lastSyncedAt?: number;
  lastAttemptAt?: number;
  pendingCollections: number;
  pulled: number;
  pushed: number;
  deleted: number;
  currentMode?: WorkspaceSyncMode;
  lastOutcomes: SyncOutcome[];
  history: WorkspaceSyncAttempt[];
}

export interface WorkspaceCollectionInspection {
  collection: WorkspaceCollection;
  active: number;
  tombstones: number;
  pending: number;
  newestAt?: number;
  syncMark: number;
  error?: string;
}

export interface WorkspaceCloudCollectionHealth {
  collection: WorkspaceCollection;
  active: number;
  tombstones: number;
  newestAt?: number;
}

export interface WorkspaceCloudHealth {
  ok: true;
  serverTime: number;
  collections: WorkspaceCloudCollectionHealth[];
  capabilities?: {
    database: boolean;
    media: boolean;
    inviteEmail: boolean;
    youtubePublishing: boolean;
    tiktokPublishing: boolean;
  };
}

export interface WorkspaceSyncController {
  getState: () => WorkspaceSyncRuntimeState;
  subscribe: (listener: (state: WorkspaceSyncRuntimeState) => void) => () => void;
  run: (options?: { full?: boolean }) => Promise<WorkspaceSyncRuntimeState>;
}

interface WorkspaceSyncControllerDependencies {
  hosted: () => boolean;
  online: () => boolean;
  sync: (full: boolean) => Promise<SyncOutcome[]>;
  now?: () => number;
  onApplied?: (outcomes: SyncOutcome[]) => void;
}

const INITIAL_STATE: WorkspaceSyncRuntimeState = {
  phase: 'idle',
  summary: 'Chưa đồng bộ workspace.',
  pendingCollections: 0,
  pulled: 0,
  pushed: 0,
  deleted: 0,
  lastOutcomes: [],
  history: [],
};

export const createWorkspaceSyncController = (
  dependencies: WorkspaceSyncControllerDependencies,
): WorkspaceSyncController => {
  let state = { ...INITIAL_STATE };
  let active: Promise<WorkspaceSyncRuntimeState> | undefined;
  let rerunRequested = false;
  let fullRequested = false;
  let attemptSequence = 0;
  const listeners = new Set<(next: WorkspaceSyncRuntimeState) => void>();
  const now = dependencies.now ?? Date.now;

  const publish = (next: WorkspaceSyncRuntimeState): WorkspaceSyncRuntimeState => {
    state = next;
    listeners.forEach((listener) => {
      try { listener(state); } catch { /* Một listener lỗi không được chặn sync. */ }
    });
    return state;
  };

  const runOnce = async (full: boolean): Promise<void> => {
    const attemptedAt = now();
    const mode: WorkspaceSyncMode = full ? 'full' : 'incremental';
    const complete = (
      phase: WorkspaceSyncAttempt['phase'],
      summary: string,
      outcomes: SyncOutcome[] = [],
      overrides: Partial<WorkspaceSyncRuntimeState> = {},
    ): WorkspaceSyncRuntimeState => {
      const finishedAt = now();
      const attempt: WorkspaceSyncAttempt = {
        id: `workspace-sync-${attemptedAt}-${attemptSequence += 1}`,
        mode,
        startedAt: attemptedAt,
        finishedAt,
        phase,
        summary,
        outcomes,
      };
      return publish({
        ...state,
        phase,
        summary,
        lastAttemptAt: attemptedAt,
        currentMode: undefined,
        lastOutcomes: outcomes,
        history: [attempt, ...state.history].slice(0, 12),
        ...overrides,
      });
    };

    if (!dependencies.hosted()) {
      complete('local-only', 'Bản local đang an toàn. Cloud hoạt động trên bản production.', [], {
        pendingCollections: 0,
        pulled: 0,
        pushed: 0,
        deleted: 0,
      });
      return;
    }
    if (!dependencies.online()) {
      complete('offline', 'Đang mất mạng. Thay đổi được giữ trên máy và sẽ tự thử lại.', [], {
        pulled: 0,
        pushed: 0,
        deleted: 0,
      });
      return;
    }

    publish({
      ...state,
      phase: 'syncing',
      summary: full ? 'Đang kiểm tra toàn bộ workspace…' : 'Đang hợp nhất dữ liệu workspace…',
      lastAttemptAt: attemptedAt,
      currentMode: mode,
    });
    try {
      const outcomes = await dependencies.sync(full);
      const failed = outcomes.filter((outcome) => outcome.error);
      const pulled = outcomes.reduce((total, outcome) => total + outcome.pulled, 0);
      const pushed = outcomes.reduce((total, outcome) => total + outcome.pushed, 0);
      const deleted = outcomes.reduce((total, outcome) => total + outcome.deleted, 0);
      if (pulled || deleted) dependencies.onApplied?.(outcomes);
      const phase = failed.length ? 'error' : 'synced';
      const summary = describeSyncOutcomes(outcomes);
      complete(phase, summary, outcomes, {
        lastSyncedAt: failed.length === outcomes.length ? state.lastSyncedAt : now(),
        pendingCollections: failed.length,
        pulled,
        pushed,
        deleted,
      });
    } catch (error) {
      complete(
        'error',
        `${error instanceof Error ? error.message : 'Không đồng bộ được.'} Dữ liệu vẫn an toàn trên máy này.`,
        [],
        {
        pendingCollections: 1,
          pulled: 0,
          pushed: 0,
          deleted: 0,
        },
      );
    }
  };

  const run = (options: { full?: boolean } = {}): Promise<WorkspaceSyncRuntimeState> => {
    fullRequested ||= Boolean(options.full);
    if (active) {
      rerunRequested = true;
      return active;
    }

    active = (async () => {
      do {
        const full = fullRequested;
        fullRequested = false;
        rerunRequested = false;
        await runOnce(full);
      } while (rerunRequested);
      return state;
    })().finally(() => {
      active = undefined;
    });
    return active;
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    run,
  };
};

const hosted = isHostedRuntime;

const online = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;

const runtimeController = createWorkspaceSyncController({
  hosted,
  online,
  sync: (full) => syncAllCollections(
    indexedDbSyncStore,
    cloudTransport,
    full ? { since: 0 } : {},
  ),
  onApplied: (outcomes) => {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
    const collections = outcomes
      .filter((outcome) => outcome.pulled || outcome.deleted)
      .map((outcome) => outcome.collection);
    window.dispatchEvent(new CustomEvent(WORKSPACE_SYNC_APPLIED_EVENT, { detail: { collections, outcomes } }));
  },
});

export const getWorkspaceSyncState = (): WorkspaceSyncRuntimeState => runtimeController.getState();
export const subscribeWorkspaceSync = (listener: (state: WorkspaceSyncRuntimeState) => void): (() => void) =>
  runtimeController.subscribe(listener);
export const requestWorkspaceSync = (options: { full?: boolean } = {}): Promise<WorkspaceSyncRuntimeState> =>
  runtimeController.run(options);

export const isWorkspaceCloudHosted = (): boolean => hosted();

/** Đếm dữ liệu local mà không sửa bất kỳ bản ghi nào. */
export const inspectLocalWorkspace = async (): Promise<WorkspaceCollectionInspection[]> =>
  Promise.all(WORKSPACE_COLLECTIONS.map(async (collection) => {
    const syncMark = getSyncMark(collection);
    try {
      const records = await indexedDbSyncStore.readAll(collection);
      const active = records.filter((record) => !record.deletedAt).length;
      const tombstones = records.length - active;
      const newestAt = records.reduce(
        (latest, record) => Math.max(latest, record.updatedAt, record.deletedAt ?? 0),
        0,
      ) || undefined;
      return {
        collection,
        active,
        tombstones,
        pending: changedSince(records, syncMark).length,
        newestAt,
        syncMark,
      };
    } catch (error) {
      return {
        collection,
        active: 0,
        tombstones: 0,
        pending: 0,
        syncMark,
        error: error instanceof Error ? error.message : 'Không đọc được kho local.',
      };
    }
  }));

/** Kiểm tra D1 và trả số lượng từng kho, không tải payload hay phát sinh phí AI. */
export const fetchWorkspaceCloudHealth = async (
  fetchImpl: typeof fetch = fetch,
): Promise<WorkspaceCloudHealth> => {
  const response = await fetchImpl('/api/cloud/workspace/health', {
    headers: { Accept: 'application/json' },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Không kiểm tra được cloud (HTTP ${response.status}).`);
  }
  if (!data?.ok || !Array.isArray(data.collections)) {
    throw new Error('Cloud trả dữ liệu chẩn đoán không hợp lệ.');
  }
  return data as WorkspaceCloudHealth;
};

/**
 * Bật đồng bộ nền đúng một lần ở App root.
 *
 * - full pull khi mở app, có mạng trở lại hoặc quay lại tab sau một phút;
 * - debounce sau mỗi lần dữ liệu workspace được ghi;
 * - incremental heartbeat mỗi phút;
 * - controller tự gộp các yêu cầu đến cùng lúc, không chạy chồng request.
 */
export const startWorkspaceAutoSync = (): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;
  let debounceTimer: number | undefined;

  const request = (full = false) => { void requestWorkspaceSync({ full }); };
  const schedule = () => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => request(false), 1200);
  };
  const refreshIfStale = () => {
    const last = getWorkspaceSyncState().lastSyncedAt ?? 0;
    if (Date.now() - last > 60_000) request(true);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') refreshIfStale();
  };
  const onOnline = () => request(true);

  window.addEventListener(WORKSPACE_DATA_CHANGED_EVENT, schedule);
  window.addEventListener('online', onOnline);
  window.addEventListener('focus', refreshIfStale);
  document.addEventListener('visibilitychange', onVisibility);
  const heartbeat = window.setInterval(() => request(false), 60_000);
  request(true);

  return () => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    window.clearInterval(heartbeat);
    window.removeEventListener(WORKSPACE_DATA_CHANGED_EVENT, schedule);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('focus', refreshIfStale);
    document.removeEventListener('visibilitychange', onVisibility);
  };
};

export interface WorkspaceSyncAppliedDetail {
  collections: WorkspaceCollection[];
  outcomes: SyncOutcome[];
}
