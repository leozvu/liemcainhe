import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clipboard,
  Cloud,
  Database,
  HardDrive,
  History,
  Laptop,
  Loader2,
  RefreshCw,
  ShieldCheck,
  WifiOff,
  X,
} from 'lucide-react';
import {
  fetchWorkspaceCloudHealth,
  getWorkspaceSyncState,
  inspectLocalWorkspace,
  isWorkspaceCloudHosted,
  requestWorkspaceSync,
  subscribeWorkspaceSync,
  WorkspaceCloudHealth,
  WorkspaceCollectionInspection,
  WorkspaceSyncRuntimePhase,
} from '../services/workspaceSyncCoordinatorService';
import { SyncOutcome, WorkspaceCollection } from '../services/workspaceSyncService';
import {
  acknowledgeWorkspaceFieldTest,
  createWorkspaceFieldTest,
  getWorkspaceDeviceIdentity,
  getWorkspaceFieldTest,
  loadActiveWorkspaceFieldTest,
  loadLatestVerifiedWorkspaceFieldTest,
  normalizeWorkspaceFieldTestCode,
  verifyWorkspaceFieldTest,
  WorkspaceFieldTestSession,
} from '../services/workspaceFieldTestService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const COLLECTION_LABELS: Record<WorkspaceCollection, string> = {
  agencyClients: 'Khách hàng & Brand Kit',
  agencyCampaigns: 'Chiến dịch',
  articleLibrary: 'Thư viện nội dung',
  publishLedger: 'Nhật ký đăng bài',
  managedAccounts: 'Tài khoản xuất bản',
  campaignZeroRuns: 'Campaign 0',
};

const PHASE_LABELS: Record<WorkspaceSyncRuntimePhase, string> = {
  idle: 'Chưa chạy',
  syncing: 'Đang kiểm tra',
  synced: 'Hoạt động tốt',
  offline: 'Đang ngoại tuyến',
  'local-only': 'Chỉ lưu trên máy',
  error: 'Cần xử lý',
};

const formatTime = (timestamp?: number): string => timestamp
  ? new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(timestamp)
  : 'Chưa có dữ liệu';

const outcomeFor = (outcomes: SyncOutcome[], collection: WorkspaceCollection): SyncOutcome | undefined =>
  outcomes.find((outcome) => outcome.collection === collection);

const WorkspaceSyncCenter: React.FC<Props> = ({ isOpen, onClose }) => {
  const [runtime, setRuntime] = useState(getWorkspaceSyncState);
  const [local, setLocal] = useState<WorkspaceCollectionInspection[]>([]);
  const [cloud, setCloud] = useState<WorkspaceCloudHealth | null>(null);
  const [cloudError, setCloudError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [fieldTest, setFieldTest] = useState<WorkspaceFieldTestSession>();
  const [fieldBusy, setFieldBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [fieldNotice, setFieldNotice] = useState('');

  useEffect(() => subscribeWorkspaceSync(setRuntime), []);

  const loadDiagnostics = useCallback(async (fullSync: boolean) => {
    setLoading(true);
    setCloudError('');
    setCopied(false);
    try {
      if (fullSync) await requestWorkspaceSync({ full: true });
      const localSnapshot = await inspectLocalWorkspace();
      setLocal(localSnapshot);

      if (!isWorkspaceCloudHosted()) {
        setCloud(null);
        setCloudError('Cloud chỉ hoạt động trên bản production. Dữ liệu local vẫn an toàn.');
        return;
      }

      try {
        setCloud(await fetchWorkspaceCloudHealth());
      } catch (error) {
        setCloud(null);
        setCloudError(error instanceof Error ? error.message : 'Không đọc được trạng thái cloud.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadDiagnostics(false);
    const device = getWorkspaceDeviceIdentity();
    setDeviceId(device.id);
    setDeviceLabel(device.label);
    setFieldError('');
    void (async () => {
      try {
        const active = await loadActiveWorkspaceFieldTest();
        setFieldTest(active || await loadLatestVerifiedWorkspaceFieldTest());
      } catch (error) {
        setFieldError(error instanceof Error ? error.message : 'Không tải được bằng chứng hai thiết bị.');
      }
    })();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, loadDiagnostics, onClose]);

  const localTotals = useMemo(() => local.reduce(
    (totals, item) => ({
      active: totals.active + item.active,
      tombstones: totals.tombstones + item.tombstones,
      pending: totals.pending + item.pending,
    }),
    { active: 0, tombstones: 0, pending: 0 },
  ), [local]);

  const cloudTotals = useMemo(() => (cloud?.collections || []).reduce(
    (totals, item) => ({
      active: totals.active + item.active,
      tombstones: totals.tombstones + item.tombstones,
    }),
    { active: 0, tombstones: 0 },
  ), [cloud]);

  const copyReport = async () => {
    const report = {
      capturedAt: Date.now(),
      page: typeof window === 'undefined' ? '' : window.location.hostname,
      runtime,
      local,
      cloud,
      cloudError: cloudError || undefined,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
    } catch {
      setCopied(false);
      setCloudError('Trình duyệt không cho sao chép. Hãy chạy lại kiểm tra rồi chụp màn hình bảng này.');
    }
  };

  const runFieldAction = async (operation: () => Promise<WorkspaceFieldTestSession>, notice: string) => {
    setFieldBusy(true);
    setFieldError('');
    setFieldNotice('');
    try {
      const session = await operation();
      setFieldTest(session);
      setJoinCode(session.code);
      setFieldNotice(notice);
      const device = getWorkspaceDeviceIdentity(deviceLabel);
      setDeviceId(device.id);
      setDeviceLabel(device.label);
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : 'Không hoàn tất được bài kiểm tra.');
    } finally {
      setFieldBusy(false);
    }
  };

  const createFieldTest = () => runFieldAction(
    () => createWorkspaceFieldTest(deviceLabel),
    'Đã tạo mã. Mở app trên thiết bị B và nhập mã này.',
  );

  const joinFieldTest = () => runFieldAction(
    () => acknowledgeWorkspaceFieldTest(joinCode, deviceLabel),
    'Thiết bị B đã được cloud ghi nhận. Quay lại thiết bị A để chốt bằng chứng.',
  );

  const refreshFieldTest = () => {
    if (!fieldTest?.code) return;
    void runFieldAction(() => getWorkspaceFieldTest(fieldTest.code), 'Đã đọc trạng thái mới nhất từ cloud.');
  };

  const verifyFieldTest = () => {
    if (!fieldTest?.code) return;
    void runFieldAction(() => verifyWorkspaceFieldTest(fieldTest.code, deviceLabel), 'Bằng chứng hai thiết bị đã được chốt và sẵn sàng cho Campaign 0.');
  };

  if (!isOpen) return null;

  const isBusy = loading || runtime.phase === 'syncing';
  const statusHealthy = runtime.phase === 'synced' && !cloudError;

  return (
    <div
      className="fixed inset-0 z-[340] flex items-center justify-center bg-black/80 p-3 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-sync-center-title"
    >
      <div className="eg-panel flex h-[min(92vh,920px)] w-full max-w-[1220px] flex-col overflow-hidden">
        <header className="flex items-start justify-between gap-4 border-b eg-divider px-5 py-5 md:px-7">
          <div className="min-w-0">
            <div className="eg-kicker">An toàn dữ liệu Egoric</div>
            <h2 id="workspace-sync-center-title" className="mt-1 text-xl font-semibold text-white">Trung tâm đồng bộ workspace</h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-500">Kiểm tra dữ liệu trên máy, bản cloud và từng nhóm lỗi trước khi team chuyển thiết bị.</p>
          </div>
          <button type="button" onClick={onClose} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center" aria-label="Đóng Trung tâm đồng bộ"><X className="h-4 w-4" /></button>
        </header>

        <div className="eg-safe-scroll flex-1 overflow-y-auto p-5 md:p-7">
          <section className="grid gap-3 lg:grid-cols-4" aria-label="Tổng quan đồng bộ">
            <article className={`rounded-2xl border p-4 ${statusHealthy ? 'border-emerald-300/20 bg-emerald-300/[.05]' : runtime.phase === 'error' ? 'border-rose-300/20 bg-rose-300/[.05]' : 'border-white/[.08] bg-white/[.025]'}`}>
              <div className="flex items-center justify-between gap-3"><ShieldCheck className={`h-5 w-5 ${statusHealthy ? 'text-emerald-200' : 'text-cyan-200'}`} /><span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">Trạng thái</span></div>
              <div className="mt-4 text-base font-semibold text-white">{PHASE_LABELS[runtime.phase]}</div>
              <p className="mt-2 text-[11px] leading-5 text-zinc-500">{runtime.summary}</p>
            </article>
            <article className="rounded-2xl border border-white/[.08] bg-white/[.025] p-4">
              <div className="flex items-center justify-between gap-3"><HardDrive className="h-5 w-5 text-cyan-200" /><span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">Trên thiết bị</span></div>
              <div className="mt-4 font-mono text-2xl font-semibold tabular-nums text-white">{localTotals.active}</div>
              <p className="mt-2 text-[11px] text-zinc-500">{localTotals.pending} thay đổi đang chờ · {localTotals.tombstones} dấu xóa</p>
            </article>
            <article className="rounded-2xl border border-white/[.08] bg-white/[.025] p-4">
              <div className="flex items-center justify-between gap-3"><Cloud className="h-5 w-5 text-cyan-200" /><span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">Cloud D1</span></div>
              <div className="mt-4 font-mono text-2xl font-semibold tabular-nums text-white">{cloud ? cloudTotals.active : '—'}</div>
              <p className={`mt-2 text-[11px] ${cloudError ? 'text-amber-200/80' : 'text-zinc-500'}`}>{cloudError || `${cloudTotals.tombstones} dấu xóa · phản hồi ${formatTime(cloud?.serverTime)}`}</p>
            </article>
            <article className={`rounded-2xl border p-4 ${cloud?.capabilities?.media ? 'border-emerald-300/20 bg-emerald-300/[.05]' : 'border-amber-300/20 bg-amber-300/[.05]'}`}>
              <div className="flex items-center justify-between gap-3"><ShieldCheck className={`h-5 w-5 ${cloud?.capabilities?.media ? 'text-emerald-200' : 'text-amber-200'}`} /><span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">Hạ tầng</span></div>
              <div className="mt-4 text-base font-semibold text-white">{cloud?.capabilities?.media ? 'Media sẵn sàng' : 'Thiếu kho media'}</div>
              <p className="mt-2 text-[11px] leading-5 text-zinc-500">R2 {cloud?.capabilities?.media ? 'đã bật' : 'chưa bật'} · Email mời {cloud?.capabilities?.inviteEmail ? 'đã bật' : 'dùng link thủ công'} · YouTube {cloud?.capabilities?.youtubePublishing ? 'sẵn sàng' : 'chưa cấu hình'} · TikTok {cloud?.capabilities?.tiktokPublishing ? 'sẵn sàng' : 'chưa cấu hình'}</p>
            </article>
          </section>

          <section className="mt-6 overflow-hidden rounded-2xl border border-white/[.08] bg-black/15">
            <div className="flex flex-col gap-4 border-b eg-divider px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
              <div><div className="eg-kicker">Sáu kho dữ liệu</div><h3 className="mt-1 text-sm font-semibold text-white">Đối chiếu local và cloud</h3></div>
              <button type="button" onClick={() => void loadDiagnostics(true)} disabled={isBusy} className="eg-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-5 text-xs font-bold disabled:cursor-wait disabled:opacity-50">{isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Kiểm tra và đồng bộ toàn bộ</button>
            </div>
            <div className="divide-y divide-white/[.06]">
              {(Object.keys(COLLECTION_LABELS) as WorkspaceCollection[]).map((collection) => {
                const localItem = local.find((item) => item.collection === collection);
                const cloudItem = cloud?.collections.find((item) => item.collection === collection);
                const outcome = outcomeFor(runtime.lastOutcomes, collection);
                const error = localItem?.error || outcome?.error;
                return (
                  <article key={collection} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(180px,1.3fr)_repeat(3,minmax(110px,.7fr))_minmax(160px,1fr)] md:items-center md:px-5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${error ? 'border-rose-300/20 bg-rose-300/[.05] text-rose-200' : 'border-white/[.08] bg-white/[.025] text-cyan-200'}`}>{error ? <AlertTriangle className="h-4 w-4" /> : <Database className="h-4 w-4" />}</span>
                      <div className="min-w-0"><h4 className="truncate text-xs font-semibold text-zinc-200">{COLLECTION_LABELS[collection]}</h4><p className="mt-1 font-mono text-[9px] text-zinc-700">{collection}</p></div>
                    </div>
                    <div><span className="block text-[9px] uppercase tracking-wider text-zinc-700">Local</span><strong className="mt-1 block font-mono text-sm tabular-nums text-white">{localItem?.active ?? '—'}</strong></div>
                    <div><span className="block text-[9px] uppercase tracking-wider text-zinc-700">Cloud</span><strong className="mt-1 block font-mono text-sm tabular-nums text-white">{cloudItem?.active ?? '—'}</strong></div>
                    <div><span className="block text-[9px] uppercase tracking-wider text-zinc-700">Chờ / xóa</span><strong className={`mt-1 block font-mono text-sm tabular-nums ${(localItem?.pending || localItem?.tombstones) ? 'text-amber-200' : 'text-zinc-400'}`}>{localItem?.pending ?? 0} / {localItem?.tombstones ?? 0}</strong></div>
                    <div className={`text-[10px] leading-4 ${error ? 'text-rose-200' : 'text-zinc-600'}`}>{error || (outcome ? `Lần cuối: lên ${outcome.pushed}, về ${outcome.pulled}, xóa ${outcome.deleted}` : `Mới nhất: ${formatTime(localItem?.newestAt || cloudItem?.newestAt)}`)}</div>
                  </article>
                );
              })}
            </div>
          </section>

          <div className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
            <section className="rounded-2xl border border-white/[.08] bg-white/[.025] p-5">
              <div className="flex items-start gap-3"><CheckCircle2 className={`mt-0.5 h-5 w-5 ${fieldTest?.status === 'verified' ? 'text-emerald-200' : 'text-cyan-200'}`} /><div><div className="eg-kicker">Field test không tốn credit</div><h3 className="mt-1 text-sm font-semibold text-white">Bằng chứng hai thiết bị</h3></div></div>
              <p className="mt-3 text-[11px] leading-5 text-zinc-500">Cloud chỉ chấp nhận khi một thiết bị tạo mã, thiết bị khác xác nhận và thiết bị đầu tiên chốt. Không gửi nội dung khách hàng hay gọi model AI.</p>

              <label className="mt-4 block text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Tên thiết bị này
                <input value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} maxLength={80} disabled={fieldBusy} className="eg-input mt-2 min-h-11 px-3 text-sm font-normal normal-case tracking-normal disabled:opacity-50" placeholder="Ví dụ: Laptop Account" />
              </label>

              {fieldTest && (
                <div className={`mt-4 rounded-xl border p-4 ${fieldTest.status === 'verified' ? 'border-emerald-300/20 bg-emerald-300/[.05]' : 'border-cyan-200/15 bg-cyan-200/[.035]'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><span className="block text-[9px] uppercase tracking-wider text-zinc-600">Mã kiểm tra</span><strong className="mt-1 block font-mono text-2xl tracking-[.18em] text-white">{fieldTest.code}</strong></div>
                    <span className={`rounded-full border px-3 py-1 text-[9px] font-semibold uppercase tracking-wider ${fieldTest.status === 'verified' ? 'border-emerald-300/20 text-emerald-200' : fieldTest.status === 'acknowledged' ? 'border-cyan-200/20 text-cyan-100' : 'border-amber-300/20 text-amber-200'}`}>{fieldTest.status === 'verified' ? 'Đã chốt' : fieldTest.status === 'acknowledged' ? 'B đã xác nhận' : 'Chờ thiết bị B'}</span>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-white/[.06] bg-black/15 p-3"><span className="text-[9px] uppercase tracking-wider text-zinc-700">Thiết bị A</span><p className="mt-1 text-[11px] text-zinc-300">{fieldTest.deviceA.label}</p></div>
                    <div className="rounded-lg border border-white/[.06] bg-black/15 p-3"><span className="text-[9px] uppercase tracking-wider text-zinc-700">Thiết bị B</span><p className="mt-1 text-[11px] text-zinc-300">{fieldTest.deviceB?.label || 'Chưa xác nhận'}</p></div>
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={refreshFieldTest} disabled={fieldBusy} className="eg-button-secondary inline-flex min-h-11 flex-1 items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-50">{fieldBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Đọc lại từ cloud</button>
                    {fieldTest.status === 'acknowledged' && fieldTest.deviceA.id === deviceId && <button type="button" onClick={verifyFieldTest} disabled={fieldBusy} className="eg-button-primary inline-flex min-h-11 flex-1 items-center justify-center gap-2 px-4 text-xs font-bold disabled:opacity-50"><ShieldCheck className="h-4 w-4" /> Chốt bằng chứng</button>}
                  </div>
                </div>
              )}

              {!fieldTest && <button type="button" onClick={createFieldTest} disabled={fieldBusy || !deviceLabel.trim()} className="eg-button-primary mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-xs font-bold disabled:opacity-50">{fieldBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Laptop className="h-4 w-4" />} Tạo mã trên thiết bị A</button>}

              <div className="mt-4 border-t border-white/[.06] pt-4">
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Nhập mã trên thiết bị B
                  <input value={joinCode} onChange={(event) => setJoinCode(normalizeWorkspaceFieldTestCode(event.target.value))} maxLength={8} disabled={fieldBusy} className="eg-input mt-2 min-h-11 px-3 font-mono text-base uppercase tracking-[.18em] disabled:opacity-50" placeholder="ABCD2345" />
                </label>
                <button type="button" onClick={joinFieldTest} disabled={fieldBusy || joinCode.length !== 8 || !deviceLabel.trim()} className="eg-button-secondary mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-50"><Cloud className="h-4 w-4" /> Xác nhận bằng thiết bị này</button>
              </div>

              <div aria-live="polite" className={`mt-3 min-h-5 text-[10px] leading-5 ${fieldError ? 'text-rose-200' : 'text-emerald-200/80'}`}>{fieldError || fieldNotice}</div>

              <details className="mt-3 rounded-xl border border-white/[.06] bg-black/10 p-3">
                <summary className="cursor-pointer text-[10px] font-semibold text-zinc-400">Kiểm tra thêm tạo, sửa và xóa dữ liệu thật</summary>
                <ol className="mt-3 space-y-2">
                  {[
                    'A tạo khách hàng thử; B đồng bộ và thấy bản ghi.',
                    'B đổi tên; A đồng bộ và thấy tên mới.',
                    'A xóa; B đồng bộ và xác nhận bản ghi không sống lại.',
                  ].map((step, index) => <li key={step} className="flex gap-2 text-[10px] leading-5 text-zinc-500"><span className="font-mono text-cyan-100">{index + 1}.</span><span>{step}</span></li>)}
                </ol>
              </details>
            </section>

            <section className="rounded-2xl border border-white/[.08] bg-white/[.025] p-5">
              <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><History className="mt-0.5 h-5 w-5 text-cyan-200" /><div><div className="eg-kicker">Lịch sử phiên</div><h3 className="mt-1 text-sm font-semibold text-white">Năm lần gần nhất</h3></div></div><button type="button" onClick={() => void copyReport()} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center" aria-label="Sao chép báo cáo chẩn đoán" title="Sao chép báo cáo">{copied ? <Check className="h-4 w-4 text-emerald-200" /> : <Clipboard className="h-4 w-4" />}</button></div>
              <div className="mt-5 space-y-2">
                {runtime.history.slice(0, 5).map((attempt) => <div key={attempt.id} className="flex items-start gap-3 rounded-xl border border-white/[.06] bg-black/15 p-3"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${attempt.phase === 'synced' ? 'bg-emerald-300' : attempt.phase === 'error' ? 'bg-rose-300' : 'bg-amber-300'}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] font-semibold text-zinc-300">{attempt.mode === 'full' ? 'Kiểm tra toàn bộ' : 'Đồng bộ tăng dần'}</span><span className="font-mono text-[9px] text-zinc-700">{formatTime(attempt.finishedAt)}</span></div><p className="mt-1 line-clamp-2 text-[9px] leading-4 text-zinc-600">{attempt.summary}</p></div></div>)}
                {!runtime.history.length && <div className="flex min-h-28 flex-col items-center justify-center text-center"><WifiOff className="h-6 w-6 text-zinc-700" /><p className="mt-3 text-[11px] text-zinc-600">Chưa có phiên đồng bộ trong lần mở app này.</p></div>}
              </div>
              <p className="mt-4 text-[10px] leading-4 text-zinc-600">Báo cáo sao chép chỉ chứa số lượng và lỗi kỹ thuật, không chứa API key hay nội dung khách hàng.</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceSyncCenter;
