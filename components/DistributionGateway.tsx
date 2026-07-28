import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  Facebook,
  Fingerprint,
  Instagram,
  Loader2,
  LockKeyhole,
  Music2,
  PackageCheck,
  RadioTower,
  ShieldCheck,
  Youtube,
} from 'lucide-react';
import { ClientReviewPortal, DistributionPackage, DistributionPlatform, ProjectState } from '../types';
import { getClientReviewWorkspace, formatArtifactFingerprint } from '../services/clientReviewService';
import {
  createDistributionPackage,
  DISTRIBUTION_PLATFORM_META,
  getCompatibleDistributionPlatforms,
  getDistributionEligibility,
  getDistributionWorkspace,
  isDistributionPackageCurrent,
  serializeDistributionManifest,
} from '../services/distributionGatewayService';
import { useAlert } from './GlobalAlert';

interface Props {
  project: ProjectState;
  onOpenReview: () => void;
}

const PLATFORM_ICONS = {
  tiktok: Music2,
  youtube: Youtube,
  'instagram-reels': Instagram,
  'facebook-reels': Facebook,
} as const;

const formatDate = (value?: number) => value
  ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
  : 'Chưa xác định';

const formatBytes = (value?: number) => !value
  ? 'Chưa rõ dung lượng'
  : `${(value / (1024 * 1024)).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MB`;

const DistributionGateway: React.FC<Props> = ({ project, onOpenReview }) => {
  const { showAlert } = useAlert();
  const [portals, setPortals] = useState<ClientReviewPortal[]>([]);
  const [packages, setPackages] = useState<DistributionPackage[]>([]);
  const [hosted, setHosted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<DistributionPlatform[]>([]);
  const [name, setName] = useState('Gói phát hành chính');
  const [title, setTitle] = useState(project.title);
  const [caption, setCaption] = useState('');

  const eligibility = useMemo(() => getDistributionEligibility(project, portals), [project, portals]);
  const compatiblePlatforms = useMemo(
    () => getCompatibleDistributionPlatforms(eligibility.source?.master.aspectRatio),
    [eligibility.source?.master.aspectRatio],
  );

  const loadWorkspace = async () => {
    setLoading(true);
    try {
      const [reviewWorkspace, distributionWorkspace] = await Promise.all([
        getClientReviewWorkspace(project.id),
        getDistributionWorkspace(project.id),
      ]);
      setPortals(reviewWorkspace.portals);
      setPackages(distributionWorkspace.packages);
      setHosted(reviewWorkspace.hosted && distributionWorkspace.hosted);
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể tải cổng phân phối.', { type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadWorkspace(); }, [project.id]);

  useEffect(() => {
    setSelectedPlatforms((current) => {
      const stillCompatible = current.filter((platform) => compatiblePlatforms.includes(platform));
      if (stillCompatible.length) return stillCompatible;
      return compatiblePlatforms.slice(0, 1);
    });
  }, [compatiblePlatforms.join('|')]);

  const togglePlatform = (platform: DistributionPlatform) => {
    if (!compatiblePlatforms.includes(platform)) return;
    setSelectedPlatforms((current) => current.includes(platform)
      ? current.filter((item) => item !== platform)
      : [...current, platform]);
  };

  const createPackage = async () => {
    const source = eligibility.source;
    if (!hosted) {
      showAlert('Gói phát hành có chữ ký chỉ được tạo trên bản production đã đăng nhập.', { type: 'info' });
      return;
    }
    if (!eligibility.eligible || !source) {
      showAlert(eligibility.blockers[0]?.detail || 'Master chưa đủ điều kiện phân phối.', { type: 'warning' });
      return;
    }
    if (!selectedPlatforms.length) {
      showAlert('Hãy chọn ít nhất một nền tảng tương thích với tỷ lệ master.', { type: 'warning' });
      return;
    }
    if (!name.trim() || !title.trim()) {
      showAlert('Tên package và tiêu đề phát hành là bắt buộc.', { type: 'warning' });
      return;
    }
    setCreating(true);
    try {
      const item = await createDistributionPackage(project.id, {
        name: name.trim(),
        title: title.trim(),
        caption: caption.trim() || undefined,
        platforms: selectedPlatforms,
        reviewRoundId: source.round.id,
        reviewPortalId: source.portal.id,
        reviewVersionId: source.version.id,
        masterOutputId: source.master.id,
      });
      setPackages((current) => [item, ...current.filter((candidate) => candidate.id !== item.id)]);
      showAlert('Đã tạo package bất biến. Adapter chỉ được nhận đúng artifact có fingerprint này.', { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể tạo package phân phối.', { type: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const copyMasterUrl = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showAlert('Đã sao chép URL master có kiểm soát truy cập.', { type: 'success' });
    } catch {
      showAlert('Trình duyệt không cho phép sao chép tự động.', { type: 'warning' });
    }
  };

  const downloadManifest = (item: DistributionPackage) => {
    const blob = new Blob([serializeDistributionManifest(item)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${item.id}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (loading) {
    return <div className="flex min-h-[440px] items-center justify-center gap-3 text-sm text-zinc-500"><Loader2 className="h-5 w-5 animate-spin text-cyan-200" /> Đang kiểm tra chữ ký phát hành…</div>;
  }

  const source = eligibility.source;

  return (
    <div className="space-y-6">
      <section className="eg-panel relative overflow-hidden p-5 md:p-8">
        <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-emerald-300/[.07] blur-[100px]" />
        <div className="relative grid gap-6 xl:grid-cols-[1fr_430px] xl:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`eg-chip ${eligibility.eligible ? 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' : 'border-amber-200/20 bg-amber-200/[.07] text-amber-100'}`}>
                {eligibility.eligible ? <ShieldCheck className="h-3 w-3" /> : <LockKeyhole className="h-3 w-3" />}
                {eligibility.eligible ? 'Release gate đã mở' : 'Release gate đang khóa'}
              </span>
              <span className="eg-chip border-white/[.08] bg-black/20 text-zinc-400"><Cloud className="h-3 w-3" /> Server verified</span>
            </div>
            <div className="eg-kicker mt-5">Distribution Gateway</div>
            <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-[-.03em] text-white md:text-4xl">Một master. Một fingerprint. Không phát hành nhầm bản.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Server kiểm lại toàn bộ chuỗi Director → Editor → Account → khách hàng trước khi tạo manifest. TikTok, YouTube và Reels không được nhận URL video trực tiếp từ project.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Gate', value: eligibility.eligible ? 'PASS' : 'LOCK' },
              { label: 'Package', value: packages.length },
              { label: 'Nền tảng', value: compatiblePlatforms.length },
            ].map((item) => <div key={item.label} className="rounded-2xl border border-white/[.07] bg-black/20 p-4"><div className="font-mono text-[9px] uppercase tracking-[.16em] text-zinc-600">{item.label}</div><div className="mt-2 font-mono text-lg font-semibold text-white">{item.value}</div></div>)}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <div className="eg-panel p-5 md:p-6">
          <div className="flex items-start justify-between gap-4"><div><div className="eg-kicker">Artifact đã nghiệm thu</div><h3 className="mt-1 text-lg font-semibold text-white">Nguồn phát hành duy nhất</h3></div><Fingerprint className="h-5 w-5 text-cyan-200/60" /></div>
          {source ? (
            <div className="mt-5 rounded-2xl border border-emerald-200/15 bg-emerald-200/[.045] p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100"><CheckCircle2 className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h4 className="truncate text-sm font-semibold text-white">{source.master.name}</h4><span className="eg-chip border-white/[.08] bg-black/20 text-zinc-400">{source.master.aspectRatio}</span><span className="eg-chip border-white/[.08] bg-black/20 text-zinc-400">{formatBytes(source.master.bytes)}</span></div>
                  <p className="mt-2 text-[11px] leading-5 text-zinc-500">{source.version.label} · khách duyệt {formatDate(source.portal.decidedAt)}</p>
                  <p className="mt-3 flex items-center gap-2 break-all font-mono text-[10px] text-emerald-100/80"><Fingerprint className="h-3.5 w-3.5 shrink-0" /> {formatArtifactFingerprint(source.artifactSignature)}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void copyMasterUrl(source.master.videoUrl!)} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold"><Copy className="h-4 w-4" /> Sao chép URL</button>
                    <a href={source.master.videoUrl} target="_blank" rel="noreferrer" className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold"><ExternalLink className="h-4 w-4" /> Mở master</a>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-amber-200/15 bg-amber-200/[.045] p-5"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" /><div><h4 className="text-sm font-semibold text-white">Chưa có nguồn đủ điều kiện</h4><p className="mt-2 text-xs leading-5 text-zinc-500">Mở lại tab duyệt để đồng bộ quyết định mới nhất của khách hàng.</p><button type="button" onClick={onOpenReview} className="eg-button-secondary mt-4 inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold"><LockKeyhole className="h-4 w-4" /> Mở cổng duyệt</button></div></div></div>
          )}
        </div>

        <div className="eg-panel p-5 md:p-6">
          <div className="flex items-start justify-between gap-4"><div><div className="eg-kicker">Preflight bất biến</div><h3 className="mt-1 text-lg font-semibold text-white">Chuỗi bằng chứng</h3></div><ShieldCheck className="h-5 w-5 text-emerald-200/60" /></div>
          <div className="mt-5 space-y-2">
            {(eligibility.eligible ? [
              { id: 'internal', label: 'Ba chữ ký nội bộ hợp lệ', detail: 'Director → Editor → Account cùng một round.' },
              { id: 'client', label: 'Khách duyệt đúng version', detail: 'Decision fingerprint trùng artifact signature.' },
              { id: 'master', label: 'Master cloud còn nguyên', detail: 'Output ID, checksum và source signature không đổi.' },
            ] : eligibility.blockers).map((item) => (
              <div key={item.id} className={`flex min-h-16 items-start gap-3 rounded-2xl border p-4 ${eligibility.eligible ? 'border-emerald-200/15 bg-emerald-200/[.035]' : 'border-amber-200/15 bg-amber-200/[.035]'}`}>
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${eligibility.eligible ? 'border-emerald-200/20 text-emerald-100' : 'border-amber-200/20 text-amber-100'}`}>{eligibility.eligible ? <Check className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}</span>
                <span><strong className="block text-xs text-zinc-200">{item.label}</strong><span className="mt-1 block text-[10px] leading-4 text-zinc-600">{item.detail}</span></span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="eg-panel p-5 md:p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><div className="eg-kicker">Target adapters</div><h3 className="mt-1 text-lg font-semibold text-white">Chọn điểm đến tương thích</h3><p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-500">Gateway chỉ chuẩn bị package đã ký. Upload tự động sẽ được bật theo từng adapter sau khi OAuth và app review hoàn tất.</p></div><span className="eg-chip w-fit border-white/[.08] bg-black/20 text-zinc-400"><RadioTower className="h-3 w-3" /> Không gọi API nền tảng ở bước này</span></div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(DISTRIBUTION_PLATFORM_META) as DistributionPlatform[]).map((platform) => {
            const meta = DISTRIBUTION_PLATFORM_META[platform];
            const Icon = PLATFORM_ICONS[platform];
            const compatible = compatiblePlatforms.includes(platform);
            const selected = selectedPlatforms.includes(platform);
            return <button key={platform} type="button" disabled={!compatible} onClick={() => togglePlatform(platform)} aria-pressed={selected} className={`min-h-36 rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'border-cyan-200/30 bg-cyan-200/[.07]' : 'border-white/[.07] bg-black/15 hover:border-cyan-200/20'}`}><div className="flex items-start justify-between gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${selected ? 'border-cyan-200/25 text-cyan-100' : 'border-white/[.08] text-zinc-500'}`}><Icon className="h-4 w-4" /></span><span className={`eg-chip ${compatible ? 'border-emerald-200/15 bg-emerald-200/[.05] text-emerald-100' : 'border-amber-200/15 bg-amber-200/[.05] text-amber-100'}`}>{compatible ? 'Tương thích' : `Cần ${meta.allowedAspectRatios.join(' / ')}`}</span></div><strong className="mt-4 block text-sm text-white">{meta.label}</strong><span className="mt-1 block text-[10px] leading-4 text-zinc-600">{meta.detail}</span></button>;
          })}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
        <div className="eg-panel p-5 md:p-6">
          <div className="eg-kicker">Package metadata</div><h3 className="mt-1 text-lg font-semibold text-white">Thông tin bàn giao</h3>
          <div className="mt-5 space-y-4">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tên package *<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="eg-input mt-2 min-h-11 px-3 text-sm font-normal normal-case tracking-normal" /></label>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tiêu đề phát hành *<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} className="eg-input mt-2 min-h-11 px-3 text-sm font-normal normal-case tracking-normal" /></label>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Caption<textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={2200} rows={5} className="eg-input mt-2 min-h-28 resize-y px-3 py-3 text-sm font-normal normal-case leading-6 tracking-normal" placeholder="Nội dung đăng kèm, hashtag và CTA…" /></label>
          </div>
          <button type="button" onClick={() => void createPackage()} disabled={creating || !hosted || !eligibility.eligible || !selectedPlatforms.length || !name.trim() || !title.trim()} className="eg-button-primary mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 px-5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40">{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} {creating ? 'Đang ký package…' : 'Tạo package đã ký'}</button>
          {!hosted && <p className="mt-3 text-[10px] leading-4 text-zinc-600">Bản local chỉ kiểm tra giao diện; server production mới được quyền phát hành manifest.</p>}
        </div>

        <div className="eg-panel p-5 md:p-6">
          <div className="flex items-start justify-between gap-4"><div><div className="eg-kicker">Release ledger</div><h3 className="mt-1 text-lg font-semibold text-white">Package đã khóa</h3></div><PackageCheck className="h-5 w-5 text-cyan-200/60" /></div>
          <div className="mt-5 space-y-3">
            {packages.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[.08] p-8 text-center"><PackageCheck className="h-9 w-9 text-zinc-700" /><h4 className="mt-4 text-sm font-semibold text-zinc-300">Chưa có package phân phối</h4><p className="mt-2 max-w-sm text-xs leading-5 text-zinc-600">Package đầu tiên sẽ giữ fingerprint, version duyệt và danh sách adapter đích.</p></div> : packages.map((item) => {
              const current = isDistributionPackageCurrent(project, item);
              return <article key={item.id} className="rounded-2xl border border-white/[.07] bg-black/15 p-4 md:p-5"><div className="flex flex-col gap-4 md:flex-row md:items-start"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${current ? 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' : 'border-amber-200/20 bg-amber-200/[.07] text-amber-100'}`}>{current ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold text-white">{item.name}</h4><span className={`eg-chip ${current ? 'border-emerald-200/15 bg-emerald-200/[.05] text-emerald-100' : 'border-amber-200/15 bg-amber-200/[.05] text-amber-100'}`}>{current ? 'Artifact còn khớp' : 'Artifact đã đổi'}</span></div><p className="mt-1 text-[10px] text-zinc-600">{formatDate(item.createdAt)} · {item.targets.map((target) => DISTRIBUTION_PLATFORM_META[target.platform].shortLabel).join(' · ')}</p><p className="mt-3 flex items-center gap-2 break-all font-mono text-[9px] text-zinc-500"><Fingerprint className="h-3.5 w-3.5 shrink-0" /> {formatArtifactFingerprint(item.approvalFingerprint)}</p></div><button type="button" onClick={() => downloadManifest(item)} className="eg-button-secondary inline-flex min-h-11 shrink-0 items-center justify-center gap-2 px-4 text-xs font-semibold"><Download className="h-4 w-4" /> Manifest JSON</button></div></article>;
            })}
          </div>
        </div>
      </section>
    </div>
  );
};

export default DistributionGateway;
