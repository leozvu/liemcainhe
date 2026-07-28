import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Facebook,
  Instagram,
  Link2,
  Loader2,
  Music2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Unplug,
  UploadCloud,
  Youtube,
} from 'lucide-react';
import {
  DistributionAdapterReadiness,
  DistributionConnection,
  DistributionPackage,
  DistributionPlatform,
  DistributionPublishJob,
  DistributionVisibility,
} from '../types';
import {
  advanceDistributionJob,
  disconnectDistributionConnection,
  formatDistributionProgress,
  getDistributionOperations,
  isDistributionJobActive,
  queueDistributionJob,
  startDistributionOAuth,
} from '../services/distributionPublishingService';
import { DISTRIBUTION_PLATFORM_META } from '../services/distributionGatewayService';
import { useAlert } from './GlobalAlert';

interface Props {
  projectId: string;
  packages: DistributionPackage[];
  onPackageUpdate: (item: DistributionPackage) => void;
}

const PLATFORM_ICONS = {
  tiktok: Music2,
  youtube: Youtube,
  'instagram-reels': Instagram,
  'facebook-reels': Facebook,
} as const;

const STATUS_STYLE: Record<DistributionPublishJob['status'], string> = {
  queued: 'border-sky-200/20 bg-sky-200/[.06] text-sky-100',
  uploading: 'border-cyan-200/20 bg-cyan-200/[.06] text-cyan-100',
  processing: 'border-violet-200/20 bg-violet-200/[.06] text-violet-100',
  'awaiting-user': 'border-amber-200/20 bg-amber-200/[.06] text-amber-100',
  published: 'border-emerald-200/20 bg-emerald-200/[.06] text-emerald-100',
  failed: 'border-rose-200/20 bg-rose-200/[.06] text-rose-100',
  indeterminate: 'border-orange-200/20 bg-orange-200/[.06] text-orange-100',
  cancelled: 'border-white/[.08] bg-white/[.03] text-zinc-400',
};

const QueueStatusIcon: React.FC<{ status: DistributionPublishJob['status']; className?: string }> = ({ status, className = 'h-4 w-4' }) => {
  if (status === 'published') return <CheckCircle2 className={className} />;
  if (status === 'failed' || status === 'indeterminate') return <AlertTriangle className={className} />;
  if (status === 'uploading' || status === 'processing') return <Loader2 className={`${className} animate-spin`} />;
  return <CircleDashed className={className} />;
};

const DistributionPublishingQueue: React.FC<Props> = ({ projectId, packages, onPackageUpdate }) => {
  const { showAlert } = useAlert();
  const [connections, setConnections] = useState<DistributionConnection[]>([]);
  const [jobs, setJobs] = useState<DistributionPublishJob[]>([]);
  const [adapters, setAdapters] = useState<DistributionAdapterReadiness[]>([]);
  const [hosted, setHosted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string>();
  const [selectedConnections, setSelectedConnections] = useState<Record<string, string>>({});
  const [visibility, setVisibility] = useState<Record<string, DistributionVisibility>>({});

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const workspace = await getDistributionOperations(projectId);
      setConnections(workspace.connections);
      setJobs(workspace.jobs);
      setAdapters(workspace.adapters);
      setHosted(workspace.hosted);
      setSelectedConnections((current) => {
        const next = { ...current };
        workspace.connections.forEach((item) => {
          if (!next[item.platform] && item.status === 'connected') next[item.platform] = item.id;
        });
        return next;
      });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể tải hàng đợi xuất bản.', { type: 'error' });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [projectId, showAlert]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onFocus = () => { void load(true); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'egoric:distribution-oauth') return;
      if (event.data.result === 'success') showAlert(`Đã kết nối ${event.data.platform}.`, { type: 'success' });
      else if (event.data.result === 'cancelled') showAlert('Bạn chưa cấp quyền cho tài khoản nền tảng.', { type: 'info' });
      else showAlert(event.data.detail || 'Kết nối OAuth thất bại.', { type: 'error' });
      void load(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [load, showAlert]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get('distributionOAuth');
    if (!result) return;
    const platform = url.searchParams.get('platform') || 'nền tảng';
    const detail = url.searchParams.get('detail');
    if (result === 'success') showAlert(`Đã kết nối ${platform}.`, { type: 'success' });
    else if (result === 'cancelled') showAlert('Bạn chưa cấp quyền cho tài khoản nền tảng.', { type: 'info' });
    else showAlert(detail || 'Kết nối OAuth thất bại.', { type: 'error' });
    ['distributionOAuth', 'platform', 'detail'].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    void load(true);
  }, [load, showAlert]);

  const connectionsByPlatform = useMemo(() => connections.reduce<Record<string, DistributionConnection[]>>((result, item) => {
    (result[item.platform] ||= []).push(item);
    return result;
  }, {}), [connections]);

  const latestJob = (packageId: string, platform: DistributionPlatform) => jobs.find(
    (item) => item.packageId === packageId && item.platform === platform,
  );

  const mergeResult = (job: DistributionPublishJob, updatedPackage?: DistributionPackage) => {
    setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    if (updatedPackage) onPackageUpdate(updatedPackage);
  };

  const connect = async (platform: DistributionPlatform) => {
    setBusyKey(`connect:${platform}`);
    try {
      const authorizeUrl = await startDistributionOAuth(projectId, platform);
      const popup = window.open(authorizeUrl, 'egoric_distribution_oauth', 'popup,width=620,height=780');
      if (!popup) throw new Error('Trình duyệt đang chặn cửa sổ OAuth. Hãy cho phép popup rồi thử lại.');
      showAlert('Hoàn tất cấp quyền trong cửa sổ vừa mở. Danh sách sẽ tự đồng bộ khi bạn quay lại.', { type: 'info' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể mở OAuth.', { type: 'error' });
    } finally {
      setBusyKey(undefined);
    }
  };

  const disconnect = async (item: DistributionConnection) => {
    if (!window.confirm(`Ngắt kết nối “${item.displayName}”? Job đang chạy sẽ chặn thao tác này.`)) return;
    setBusyKey(`disconnect:${item.id}`);
    try {
      await disconnectDistributionConnection(item.id);
      setConnections((current) => current.filter((connection) => connection.id !== item.id));
      showAlert('Đã thu hồi kết nối trong Egoric. Bạn vẫn nên kiểm tra quyền ứng dụng ở nền tảng.', { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể ngắt kết nối.', { type: 'error' });
    } finally {
      setBusyKey(undefined);
    }
  };

  const advance = async (initialJob: DistributionPublishJob, steps = 6, reconcile = false) => {
    let current = initialJob;
    for (let index = 0; index < steps; index += 1) {
      const result = await advanceDistributionJob(projectId, current.id, reconcile && index === 0);
      current = result.job;
      mergeResult(current, result.package);
      if (!isDistributionJobActive(current)) break;
    }
    return current;
  };

  const queue = async (item: DistributionPackage, platform: DistributionPlatform) => {
    const key = `${item.id}:${platform}`;
    const connectionId = selectedConnections[platform];
    if (!connectionId) {
      showAlert('Hãy kết nối và chọn một tài khoản đích trước.', { type: 'warning' });
      return;
    }
    if (platform === 'youtube' && visibility[key] === 'public'
      && !window.confirm('Video sẽ có thể công khai ngay sau khi YouTube xử lý xong. Tiếp tục?')) return;
    setBusyKey(key);
    try {
      const result = await queueDistributionJob(projectId, {
        packageId: item.id,
        platform,
        connectionId,
        visibility: platform === 'youtube' ? (visibility[key] || 'private') : undefined,
      });
      mergeResult(result.job, result.package);
      const finalJob = await advance(result.job);
      if (finalJob.status === 'uploading') showAlert('Đã lưu tiến độ upload. Bấm “Tiếp tục” để gửi các chunk kế tiếp.', { type: 'info' });
      else if (finalJob.status === 'awaiting-user') showAlert('Video đã vào hộp thư TikTok. Creator cần mở TikTok để hoàn tất bài đăng.', { type: 'success' });
      else if (finalJob.status === 'processing') showAlert('Nền tảng đã nhận đủ video và đang xử lý.', { type: 'success' });
      else if (finalJob.status === 'published') showAlert('Nền tảng xác nhận video đã xuất bản.', { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể xếp hàng xuất bản.', { type: 'error' });
    } finally {
      setBusyKey(undefined);
    }
  };

  const continueJob = async (job: DistributionPublishJob, reconcile = false) => {
    setBusyKey(job.id);
    try {
      const result = await advance(job, isDistributionJobActive(job) ? 6 : 1, reconcile);
      if (result.status === 'indeterminate') showAlert('Vẫn chưa xác định được kết quả. Egoric không upload lại để tránh đăng trùng.', { type: 'warning' });
      else if (result.status === 'published') showAlert('Đã đối soát: video được xác nhận đã xuất bản.', { type: 'success' });
      else if (result.status === 'awaiting-user') showAlert('TikTok đang chờ creator hoàn tất trong ứng dụng.', { type: 'info' });
      else if (result.status === 'processing') showAlert('Video vẫn đang được nền tảng xử lý.', { type: 'info' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể tiếp tục job.', { type: 'error' });
    } finally {
      setBusyKey(undefined);
    }
  };

  if (loading) return <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-zinc-500"><Loader2 className="h-5 w-5 animate-spin text-cyan-200" /> Đang tải Publishing Queue…</div>;

  return (
    <div className="space-y-5">
      <section className="eg-panel p-5 md:p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div><div className="eg-kicker">Connected destinations</div><h3 className="mt-1 text-lg font-semibold text-white">Tài khoản nền tảng</h3><p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-500">OAuth chạy ở server; access token và refresh token không bao giờ đi vào trình duyệt hay file project.</p></div>
          <button type="button" onClick={() => void load()} className="eg-button-secondary inline-flex min-h-11 w-fit items-center justify-center gap-2 px-4 text-xs font-semibold"><RefreshCw className="h-4 w-4" /> Làm mới</button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(DISTRIBUTION_PLATFORM_META) as DistributionPlatform[]).map((platform) => {
            const readiness = adapters.find((item) => item.platform === platform);
            const platformConnections = connectionsByPlatform[platform] || [];
            const Icon = PLATFORM_ICONS[platform];
            const canConnect = hosted && readiness?.configured && ['youtube', 'tiktok'].includes(platform);
            return <article key={platform} className="rounded-2xl border border-white/[.07] bg-black/15 p-4"><div className="flex items-start justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[.08] text-zinc-300"><Icon className="h-4 w-4" /></span><span className={`eg-chip ${readiness?.configured ? 'border-emerald-200/15 bg-emerald-200/[.05] text-emerald-100' : 'border-amber-200/15 bg-amber-200/[.05] text-amber-100'}`}>{readiness?.configured ? 'OAuth sẵn sàng' : 'Chưa cấu hình'}</span></div><h4 className="mt-4 text-sm font-semibold text-white">{DISTRIBUTION_PLATFORM_META[platform].label}</h4><p className="mt-1 min-h-10 text-[10px] leading-4 text-zinc-600">{readiness?.blocker || `${platformConnections.length} tài khoản đã kết nối · ${readiness?.mode}`}</p><button type="button" disabled={!canConnect || busyKey === `connect:${platform}`} onClick={() => void connect(platform)} className="eg-button-secondary mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40">{busyKey === `connect:${platform}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Kết nối tài khoản</button>{platformConnections.map((connection) => <div key={connection.id} className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200/10 bg-emerald-200/[.035] p-3"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-100" /><div className="min-w-0 flex-1"><strong className="block truncate text-[11px] text-zinc-200">{connection.displayName}</strong><span className="block truncate text-[9px] text-zinc-600">{connection.externalAccountId}</span></div><button type="button" aria-label={`Ngắt kết nối ${connection.displayName}`} disabled={busyKey === `disconnect:${connection.id}`} onClick={() => void disconnect(connection)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[.07] text-zinc-500 transition-colors hover:text-rose-200 disabled:opacity-40"><Unplug className="h-4 w-4" /></button></div>)}</article>;
          })}
        </div>
      </section>

      <section className="eg-panel p-5 md:p-6">
        <div className="flex items-start justify-between gap-4"><div><div className="eg-kicker">Durable publishing queue</div><h3 className="mt-1 text-lg font-semibold text-white">Upload có thể tiếp tục và đối soát</h3><p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-500">Mỗi lần gửi tối đa sáu chunk rồi lưu offset. Nếu mạng rớt giữa request, job chuyển sang chưa xác định và bắt buộc hỏi nền tảng trước khi gửi tiếp.</p></div><UploadCloud className="h-5 w-5 text-cyan-200/60" /></div>
        {packages.length === 0 ? <div className="mt-5 flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[.08] p-8 text-center"><UploadCloud className="h-9 w-9 text-zinc-700" /><h4 className="mt-4 text-sm font-semibold text-zinc-300">Chưa có package để xuất bản</h4><p className="mt-2 text-xs text-zinc-600">Tạo package đã ký ở phía trên trước.</p></div> : <div className="mt-5 space-y-4">{packages.map((item) => <article key={item.id} className="rounded-2xl border border-white/[.07] bg-black/15 p-4 md:p-5"><div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"><div><h4 className="text-sm font-semibold text-white">{item.name}</h4><p className="mt-1 text-[10px] text-zinc-600">{item.title} · {item.aspectRatio}</p></div><span className="eg-chip w-fit border-white/[.08] bg-black/20 text-zinc-400">{item.targets.length} điểm đến</span></div><div className="mt-4 grid gap-3 xl:grid-cols-2">{item.targets.map((target) => {
            const platform = target.platform;
            const job = latestJob(item.id, platform);
            const platformConnections = (connectionsByPlatform[platform] || []).filter((connection) => connection.status === 'connected');
            const key = `${item.id}:${platform}`;
            const Icon = PLATFORM_ICONS[platform];
            const queueBusy = busyKey === key || busyKey === job?.id;
            return <div key={platform} className="rounded-2xl border border-white/[.07] bg-white/[.018] p-4"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[.08] text-zinc-400"><Icon className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-xs text-zinc-200">{DISTRIBUTION_PLATFORM_META[platform].label}</strong>{job && <span className={`eg-chip ${STATUS_STYLE[job.status]}`}><QueueStatusIcon status={job.status} className="h-3 w-3" /> {formatDistributionProgress(job)}</span>}</div>{job ? <><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.06]" role="progressbar" aria-label={`Tiến độ ${DISTRIBUTION_PLATFORM_META[platform].label}`} aria-valuenow={Math.round(job.progress)} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-cyan-200 transition-[width] duration-200" style={{ width: `${Math.max(2, Math.min(100, job.progress))}%` }} /></div><p className="mt-2 text-[10px] leading-4 text-zinc-600">{job.connectionLabel} · lần {job.attempt}{job.error ? ` · ${job.error}` : ''}</p></> : <p className="mt-2 text-[10px] leading-4 text-zinc-600">Chưa có job. Chọn đúng tài khoản sở hữu kênh trước khi upload.</p>}</div></div>{!job && <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><label className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">Tài khoản<select value={selectedConnections[platform] || ''} onChange={(event) => setSelectedConnections((current) => ({ ...current, [platform]: event.target.value }))} className="eg-input mt-2 min-h-11 px-3 text-xs font-normal normal-case tracking-normal"><option value="">Chọn tài khoản…</option>{platformConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.displayName}</option>)}</select></label>{platform === 'youtube' && <label className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">Quyền riêng tư<select value={visibility[key] || 'private'} onChange={(event) => setVisibility((current) => ({ ...current, [key]: event.target.value as DistributionVisibility }))} className="eg-input mt-2 min-h-11 px-3 text-xs font-normal normal-case tracking-normal"><option value="private">Riêng tư</option><option value="unlisted">Không công khai</option><option value="public">Công khai</option></select></label>}</div>}<div className="mt-4 flex flex-wrap gap-2">{!job ? <button type="button" disabled={!platformConnections.length || queueBusy || !hosted} onClick={() => void queue(item, platform)} className="eg-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40">{queueBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Xếp hàng và upload</button> : job.status === 'indeterminate' ? <button type="button" disabled={queueBusy} onClick={() => void continueJob(job, true)} className="eg-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-bold disabled:opacity-40">{queueBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />} Đối soát trước khi tiếp tục</button> : ['queued', 'uploading', 'processing', 'awaiting-user'].includes(job.status) ? <button type="button" disabled={queueBusy} onClick={() => void continueJob(job)} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-40">{queueBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {isDistributionJobActive(job) ? 'Tiếp tục upload' : 'Kiểm tra trạng thái'}</button> : job.status === 'failed' && job.retrySafe ? <button type="button" disabled={queueBusy} onClick={() => void continueJob(job)} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-40">{queueBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Thử lại an toàn</button> : null}{job?.publishedUrl && <a href={job.publishedUrl} target="_blank" rel="noreferrer" className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold"><ExternalLink className="h-4 w-4" /> Mở bài đăng</a>}</div></div>;
          })}</div></article>)}</div>}
      </section>
    </div>
  );
};

export default DistributionPublishingQueue;
