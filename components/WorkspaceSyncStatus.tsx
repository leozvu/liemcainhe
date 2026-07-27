import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  CloudUpload,
  Loader2,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import {
  getWorkspaceSyncState,
  requestWorkspaceSync,
  subscribeWorkspaceSync,
  WorkspaceSyncRuntimePhase,
} from '../services/workspaceSyncCoordinatorService';

interface Props {
  variant?: 'header' | 'sidebar';
}

const META: Record<WorkspaceSyncRuntimePhase, {
  label: string;
  icon: typeof CloudUpload;
  tone: string;
}> = {
  idle: { label: 'Chờ đồng bộ', icon: CloudUpload, tone: 'text-zinc-500' },
  syncing: { label: 'Đang đồng bộ', icon: Loader2, tone: 'text-cyan-100' },
  synced: { label: 'Workspace đã lưu', icon: CheckCircle2, tone: 'text-emerald-200' },
  offline: { label: 'Mất mạng · đã lưu local', icon: WifiOff, tone: 'text-amber-200' },
  'local-only': { label: 'Chỉ lưu trên máy', icon: CloudOff, tone: 'text-amber-200' },
  error: { label: 'Còn lỗi đồng bộ', icon: AlertTriangle, tone: 'text-rose-200' },
};

const formatSyncTime = (timestamp?: number): string => timestamp
  ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(timestamp)
  : 'chưa có';

const WorkspaceSyncStatus: React.FC<Props> = ({ variant = 'header' }) => {
  const [state, setState] = useState(getWorkspaceSyncState);

  useEffect(() => subscribeWorkspaceSync(setState), []);

  const meta = META[state.phase];
  const Icon = meta.icon;
  const title = useMemo(
    () => `${meta.label}. ${state.summary} Đồng bộ thành công gần nhất: ${formatSyncTime(state.lastSyncedAt)}. Bấm để thử đồng bộ toàn bộ.`,
    [meta.label, state.lastSyncedAt, state.summary],
  );
  const busy = state.phase === 'syncing';

  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        onClick={() => void requestWorkspaceSync({ full: true })}
        disabled={busy}
        className={`eg-sidebar-tool flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-white/[.035] disabled:cursor-wait ${meta.tone}`}
        title={title}
        aria-label={title}
      >
        <Icon className={`h-4 w-4 shrink-0 ${busy ? 'animate-spin' : ''}`} />
        <span className="eg-sidebar-copy min-w-0 flex-1 truncate text-[11px] font-medium">{meta.label}</span>
        {state.pendingCollections > 0 && <span className="eg-sidebar-copy font-mono text-[9px]">{state.pendingCollections}</span>}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void requestWorkspaceSync({ full: true })}
      disabled={busy}
      className={`eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-3 text-[10px] font-semibold disabled:cursor-wait ${meta.tone}`}
      title={title}
      aria-label={title}
    >
      <Icon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
      <span className="hidden xl:inline">{meta.label}</span>
      {!busy && state.phase !== 'synced' && <RefreshCw className="hidden h-3 w-3 sm:block" />}
      {state.pendingCollections > 0 && <span className="font-mono text-[9px]">{state.pendingCollections}</span>}
    </button>
  );
};

export default WorkspaceSyncStatus;
