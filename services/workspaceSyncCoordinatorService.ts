import {
  WORKSPACE_DATA_CHANGED_EVENT,
} from './storageService';
import {
  cloudTransport,
  describeSyncOutcomes,
  indexedDbSyncStore,
  SyncOutcome,
  syncAllCollections,
  WorkspaceCollection,
} from './workspaceSyncService';

export const WORKSPACE_SYNC_APPLIED_EVENT = 'egoric:workspace-sync-applied';

export type WorkspaceSyncRuntimePhase =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'local-only'
  | 'error';

export interface WorkspaceSyncRuntimeState {
  phase: WorkspaceSyncRuntimePhase;
  summary: string;
  lastSyncedAt?: number;
  lastAttemptAt?: number;
  pendingCollections: number;
  pulled: number;
  pushed: number;
  deleted: number;
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
};

export const createWorkspaceSyncController = (
  dependencies: WorkspaceSyncControllerDependencies,
): WorkspaceSyncController => {
  let state = { ...INITIAL_STATE };
  let active: Promise<WorkspaceSyncRuntimeState> | undefined;
  let rerunRequested = false;
  let fullRequested = false;
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
    if (!dependencies.hosted()) {
      publish({
        ...state,
        phase: 'local-only',
        summary: 'Bản local đang an toàn. Cloud hoạt động trên bản production.',
        lastAttemptAt: attemptedAt,
      });
      return;
    }
    if (!dependencies.online()) {
      publish({
        ...state,
        phase: 'offline',
        summary: 'Đang mất mạng. Thay đổi được giữ trên máy và sẽ tự thử lại.',
        lastAttemptAt: attemptedAt,
      });
      return;
    }

    publish({ ...state, phase: 'syncing', summary: 'Đang hợp nhất dữ liệu workspace…', lastAttemptAt: attemptedAt });
    try {
      const outcomes = await dependencies.sync(full);
      const failed = outcomes.filter((outcome) => outcome.error);
      const pulled = outcomes.reduce((total, outcome) => total + outcome.pulled, 0);
      const pushed = outcomes.reduce((total, outcome) => total + outcome.pushed, 0);
      const deleted = outcomes.reduce((total, outcome) => total + outcome.deleted, 0);
      if (pulled || deleted) dependencies.onApplied?.(outcomes);
      publish({
        phase: failed.length ? 'error' : 'synced',
        summary: describeSyncOutcomes(outcomes),
        lastSyncedAt: failed.length === outcomes.length ? state.lastSyncedAt : now(),
        lastAttemptAt: attemptedAt,
        pendingCollections: failed.length,
        pulled,
        pushed,
        deleted,
      });
    } catch (error) {
      publish({
        ...state,
        phase: 'error',
        summary: `${error instanceof Error ? error.message : 'Không đồng bộ được.'} Dữ liệu vẫn an toàn trên máy này.`,
        lastAttemptAt: attemptedAt,
        pendingCollections: 1,
      });
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

const hosted = (): boolean => typeof window !== 'undefined'
  && window.location.hostname.endsWith('.chatgpt.site');

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
