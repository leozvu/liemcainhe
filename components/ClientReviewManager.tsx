import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clipboard,
  Clock3,
  CloudUpload,
  ExternalLink,
  FileCheck2,
  Link2,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Video,
  XCircle,
} from 'lucide-react';
import { AgencyCampaign, AgencyClient, ClientReviewPortal, ProjectState } from '../types';
import {
  getClientReviewSummary,
  getClientReviewWorkspace,
  publishClientReview,
  syncClientReviewDecisionToCampaign,
  updateClientReviewPortal,
} from '../services/clientReviewService';
import { syncProjectToCloud } from '../services/cloudSyncService';
import { getAllAgencyCampaigns, getAllAgencyClients } from '../services/storageService';
import { useAlert } from './GlobalAlert';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((previous: ProjectState) => ProjectState)) => void;
}

const formatDate = (timestamp?: number) => timestamp
  ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp)
  : 'Không giới hạn';

const DECISION_META = {
  pending: { label: 'Đang chờ khách duyệt', icon: Clock3, className: 'border-sky-200/20 bg-sky-200/[.07] text-sky-100' },
  'changes-requested': { label: 'Khách yêu cầu chỉnh sửa', icon: RefreshCw, className: 'border-amber-200/20 bg-amber-200/[.07] text-amber-100' },
  approved: { label: 'Đã nghiệm thu', icon: CheckCircle2, className: 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' },
} as const;

const ClientReviewManager: React.FC<Props> = ({ project, updateProject }) => {
  const { showAlert } = useAlert();
  const [portals, setPortals] = useState<ClientReviewPortal[]>([]);
  const [selectedPortalId, setSelectedPortalId] = useState<string | null>(null);
  const [hosted, setHosted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressDetail, setProgressDetail] = useState('');
  const [client, setClient] = useState<AgencyClient | undefined>();
  const [campaign, setCampaign] = useState<AgencyCampaign | undefined>();
  const [versionLabel, setVersionLabel] = useState('');
  const [versionNote, setVersionNote] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(30);

  const completedClips = project.shots.filter((shot) => Boolean(shot.interval?.videoUrl));
  const selectedPortal = portals.find((portal) => portal.id === selectedPortalId) || portals[0];
  const summary = getClientReviewSummary(selectedPortal);
  const decisionVersion = selectedPortal?.versions.find((version) => version.id === selectedPortal.decisionVersionId);

  const deliverable = useMemo(
    () => campaign?.deliverables.find((item) => item.id === project.deliverableId),
    [campaign, project.deliverableId],
  );

  const loadWorkspace = async () => {
    setLoading(true);
    try {
      const [workspace, clients, campaigns] = await Promise.all([
        getClientReviewWorkspace(project.id),
        getAllAgencyClients(),
        getAllAgencyCampaigns(),
      ]);
      const nextClient = clients.find((item) => item.id === project.clientId);
      const nextCampaign = campaigns.find((item) => item.id === project.campaignId);
      setClient(nextClient);
      setCampaign(nextCampaign);
      setHosted(workspace.hosted);
      setPortals(workspace.portals);
      setSelectedPortalId((current) => current && workspace.portals.some((portal) => portal.id === current)
        ? current
        : workspace.portals[0]?.id || null);
      const nextVersion = (workspace.portals[0]?.versions.at(-1)?.number || 0) + 1;
      setVersionLabel((current) => current || `Bản duyệt V${nextVersion}`);
      await syncClientReviewDecisionToCampaign(project, workspace.portals[0]);
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể tải cổng duyệt.', { type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadWorkspace(); }, [project.id]);

  const copyLink = async (portal: ClientReviewPortal) => {
    if (!portal.shareUrl) return;
    try {
      await navigator.clipboard.writeText(portal.shareUrl);
      showAlert('Đã sao chép link duyệt cho khách hàng.', { type: 'success' });
    } catch {
      showAlert('Trình duyệt không cho phép sao chép tự động. Hãy mở link và sao chép trên thanh địa chỉ.', { type: 'warning' });
    }
  };

  const publish = async () => {
    if (publishing) return;
    if (!hosted) {
      showAlert('Link public chỉ được phát hành trên bản Sites đã deploy và đăng nhập. Bản local không tạo link giả.', { type: 'info' });
      return;
    }
    if (!completedClips.length) {
      showAlert('Dự án chưa có clip video hoàn tất để gửi duyệt.', { type: 'warning' });
      return;
    }
    setPublishing(true);
    setProgress(2);
    setProgressDetail('Đang chuẩn bị bản duyệt…');
    try {
      const cloudProject = await syncProjectToCloud(project, (nextProgress, detail) => {
        setProgress(Math.min(88, Math.round(nextProgress * 0.88)));
        setProgressDetail(detail);
      });
      updateProject((previous) => ({
        ...cloudProject,
        workflow: {
          ...(cloudProject.workflow || { jobs: [], checkpoints: [] }),
          checkpoints: previous.workflow?.checkpoints || [],
        },
      }));
      setProgress(92);
      setProgressDetail('Đang đóng gói phiên bản và tạo link an toàn…');
      const portal = await publishClientReview(project.id, {
        title: deliverable?.title || project.title,
        clientName: client?.brandName || client?.name || 'Khách hàng',
        campaignName: campaign?.name,
        deliverableTitle: deliverable?.title,
        versionLabel: versionLabel.trim() || `Bản duyệt V${(summary.latestVersion?.number || 0) + 1}`,
        versionNote: versionNote.trim() || undefined,
        expiresInDays,
      });
      setPortals((current) => [portal, ...current.filter((item) => item.id !== portal.id)]);
      setSelectedPortalId(portal.id);
      setVersionLabel(`Bản duyệt V${(portal.versions.at(-1)?.number || 0) + 1}`);
      setVersionNote('');
      setProgress(100);
      setProgressDetail('Đã phát hành bản duyệt.');
      await syncClientReviewDecisionToCampaign(project, portal);
      await copyLink(portal);
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể phát hành bản duyệt.', { type: 'error' });
    } finally {
      setPublishing(false);
      window.setTimeout(() => { setProgress(0); setProgressDetail(''); }, 1000);
    }
  };

  const patchPortal = async (portal: ClientReviewPortal, input: Parameters<typeof updateClientReviewPortal>[1]) => {
    setBusyAction(input.commentId || portal.id);
    try {
      const updated = await updateClientReviewPortal(project.id, input);
      setPortals((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể cập nhật cổng duyệt.', { type: 'error' });
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return <div className="flex min-h-[440px] items-center justify-center gap-3 text-sm text-zinc-500"><Loader2 className="h-5 w-5 animate-spin text-cyan-200" /> Đang tải phòng duyệt khách hàng…</div>;
  }

  const decisionMeta = selectedPortal ? DECISION_META[selectedPortal.decision] : DECISION_META.pending;
  const DecisionIcon = decisionMeta.icon;

  return (
    <div className="space-y-6">
      <section className="eg-panel relative overflow-hidden p-5 md:p-8">
        <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-cyan-300/[.07] blur-[100px]" />
        <div className="relative grid gap-6 xl:grid-cols-[1fr_420px] xl:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="eg-chip border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100"><ShieldCheck className="h-3 w-3" /> Review Portal</span>
              <span className={`eg-chip ${hosted ? 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' : 'border-amber-200/20 bg-amber-200/[.07] text-amber-100'}`}>
                {hosted ? <CloudUpload className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {hosted ? 'Cloud review sẵn sàng' : 'Chỉ xem cấu hình trên local'}
              </span>
            </div>
            <h2 className="mt-5 max-w-3xl text-2xl font-semibold tracking-[-.03em] text-white md:text-4xl">Duyệt đúng khung hình. Chốt đúng phiên bản.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Khách chỉ thấy video, timecode và quyết định duyệt. Toàn bộ API, prompt, chi phí và quy trình nội bộ được giữ kín.</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Clip sẵn sàng', value: completedClips.length, icon: Video },
              { label: 'Phiên bản', value: summary.versionCount, icon: FileCheck2 },
              { label: 'Góp ý mở', value: summary.openComments, icon: MessageSquareText },
            ].map((item) => <div key={item.label} className="rounded-2xl border border-white/[.07] bg-black/20 p-4"><item.icon className="h-4 w-4 text-cyan-100/70" /><strong className="mt-4 block font-mono text-xl text-white">{item.value}</strong><span className="mt-1 block text-[10px] leading-4 text-zinc-600">{item.label}</span></div>)}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[.82fr_1.18fr]">
        <div className="eg-panel p-5 md:p-6">
          <div className="flex items-start gap-3"><Send className="mt-0.5 h-5 w-5 text-cyan-200" /><div><div className="eg-kicker">Phát hành phiên bản</div><h3 className="mt-1 text-base font-semibold text-white">Đồng bộ và gửi khách duyệt</h3><p className="mt-2 text-[11px] leading-5 text-zinc-500">Mỗi lần phát hành tạo một version mới nhưng giữ nguyên link, lịch sử và góp ý cũ.</p></div></div>
          <div className="mt-5 space-y-4">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tên phiên bản *<input value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} maxLength={120} className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal" placeholder="Ví dụ: Bản duyệt V2 · sửa CTA" /></label>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ghi chú thay đổi<textarea value={versionNote} onChange={(event) => setVersionNote(event.target.value)} maxLength={1000} rows={4} className="eg-input mt-2 min-h-24 resize-y px-4 py-3 text-sm font-normal leading-5 normal-case tracking-normal" placeholder="Đã sửa nhịp dựng, màu và CTA cuối video…" /></label>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Link hết hạn sau<select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} className="eg-input mt-2 px-3 text-sm font-normal normal-case tracking-normal"><option value={7}>7 ngày</option><option value={14}>14 ngày</option><option value={30}>30 ngày</option><option value={60}>60 ngày</option><option value={90}>90 ngày</option></select></label>
          </div>
          {publishing && <div className="mt-5 rounded-2xl border border-cyan-200/15 bg-cyan-200/[.045] p-4" aria-live="polite"><div className="flex items-center justify-between gap-3 text-[10px] text-cyan-100"><span>{progressDetail}</span><span className="font-mono">{progress}%</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full bg-[var(--eg-accent)] transition-[width] duration-300" style={{ width: `${progress}%` }} /></div></div>}
          <button type="button" onClick={() => void publish()} disabled={publishing || !hosted || !completedClips.length || !versionLabel.trim()} className="eg-button-primary mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 px-5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40">{publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />} {portals.length ? 'Phát hành version mới' : 'Tạo link và gửi duyệt'}</button>
          {!hosted && <p className="mt-3 text-[10px] leading-4 text-amber-100/70">Bản local không tạo link giả. Sau khi deploy Sites, dự án và media sẽ được đồng bộ lên D1/R2 trước khi phát hành.</p>}
          {hosted && <p className="mt-3 text-[10px] leading-4 text-zinc-600">Khách ngoài workspace chỉ mở được link sau khi quyền truy cập Sites được bật công khai. Dashboard nội bộ vẫn được server chặn nếu không đăng nhập.</p>}
        </div>

        <div className="eg-panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b eg-divider px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="eg-kicker">Link đang vận hành</div><h3 className="mt-1 text-base font-semibold text-white">{selectedPortal ? selectedPortal.title : 'Chưa có bản duyệt'}</h3></div>
            {selectedPortal && <span className={`eg-chip ${decisionMeta.className}`}><DecisionIcon className="h-3 w-3" /> {decisionMeta.label}</span>}
          </div>
          {!selectedPortal ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center"><Link2 className="h-10 w-10 text-zinc-700" /><h4 className="mt-4 text-sm font-semibold text-zinc-300">Chưa phát hành link duyệt</h4><p className="mt-2 max-w-md text-xs leading-5 text-zinc-600">Hoàn tất ít nhất một clip, điền tên version và phát hành. Link sẽ tự được sao chép.</p></div>
          ) : (
            <div className="p-5 md:p-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="eg-card p-4"><span className="text-[9px] uppercase tracking-wider text-zinc-600">Khách hàng</span><strong className="mt-2 block text-sm text-white">{selectedPortal.clientName}</strong></div>
                <div className="eg-card p-4"><span className="text-[9px] uppercase tracking-wider text-zinc-600">Version mới nhất</span><strong className="mt-2 block text-sm text-white">{summary.latestVersion?.label || 'Chưa có'}</strong></div>
                <div className="eg-card p-4"><span className="text-[9px] uppercase tracking-wider text-zinc-600">Hết hạn</span><strong className="mt-2 block text-sm text-white">{formatDate(selectedPortal.expiresAt)}</strong></div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <button type="button" onClick={() => void copyLink(selectedPortal)} className="eg-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-bold"><Clipboard className="h-4 w-4" /> Sao chép link</button>
                <a href={selectedPortal.shareUrl} target="_blank" rel="noreferrer" className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold"><ExternalLink className="h-4 w-4" /> Xem như khách</a>
                {selectedPortal.status === 'active' ? <button type="button" onClick={() => void patchPortal(selectedPortal, { portalId: selectedPortal.id, status: 'closed' })} disabled={busyAction === selectedPortal.id} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-40"><LockKeyhole className="h-4 w-4" /> Đóng link</button> : <button type="button" onClick={() => void patchPortal(selectedPortal, { portalId: selectedPortal.id, status: 'active' })} disabled={busyAction === selectedPortal.id} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-40"><Link2 className="h-4 w-4" /> Mở link</button>}
                {selectedPortal.decision === 'approved' && <button type="button" onClick={() => void patchPortal(selectedPortal, { portalId: selectedPortal.id, resetDecision: true })} disabled={busyAction === selectedPortal.id} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-200/20 bg-amber-200/[.055] px-4 text-xs font-semibold text-amber-100 disabled:opacity-40"><RotateCcw className="h-4 w-4" /> Mở vòng sửa</button>}
              </div>
              {selectedPortal.decision !== 'pending' && <div className={`mt-4 rounded-2xl border p-4 ${decisionMeta.className}`}><div className="flex items-start gap-3"><DecisionIcon className="mt-0.5 h-4 w-4 shrink-0" /><div><strong className="block text-xs">{decisionMeta.label}{decisionVersion ? ` · V${decisionVersion.number}` : ''}</strong><p className="mt-1 text-[11px] leading-5 opacity-75">{selectedPortal.reviewerName || 'Khách hàng'} · {formatDate(selectedPortal.decidedAt)}</p>{selectedPortal.decisionNote && <p className="mt-3 whitespace-pre-wrap text-xs leading-5">{selectedPortal.decisionNote}</p>}</div></div></div>}
            </div>
          )}
        </div>
      </section>

      {selectedPortal && (
        <section className="grid gap-5 xl:grid-cols-[.72fr_1.28fr]">
          <div className="eg-panel overflow-hidden"><div className="border-b eg-divider px-5 py-4"><div className="eg-kicker">Lịch sử phát hành</div><h3 className="mt-1 text-sm font-semibold text-white">{selectedPortal.versions.length} phiên bản</h3></div><div className="divide-y divide-white/[.06]">{[...selectedPortal.versions].reverse().map((version) => <article key={version.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><span className="font-mono text-[9px] uppercase tracking-wider text-cyan-100/70">V{version.number}</span><h4 className="mt-1 text-sm font-semibold text-white">{version.label}</h4></div><span className="eg-chip">{version.clips.length} clip</span></div>{version.note && <p className="mt-3 whitespace-pre-wrap text-[11px] leading-5 text-zinc-500">{version.note}</p>}<p className="mt-3 font-mono text-[9px] text-zinc-700">{formatDate(version.createdAt)}</p></article>)}</div></div>
          <div className="eg-panel overflow-hidden"><div className="flex items-center justify-between gap-3 border-b eg-divider px-5 py-4"><div><div className="eg-kicker">Feedback theo timecode</div><h3 className="mt-1 text-sm font-semibold text-white">{summary.openComments} góp ý đang mở</h3></div><MessageSquareText className="h-5 w-5 text-cyan-200/70" /></div><div className="max-h-[620px] divide-y divide-white/[.06] overflow-y-auto">{selectedPortal.comments.map((comment) => { const version = selectedPortal.versions.find((item) => item.id === comment.versionId); const clip = version?.clips.find((item) => item.id === comment.clipId); return <article key={comment.id} className={`p-5 ${comment.status === 'resolved' ? 'opacity-50' : ''}`}><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><span className="eg-chip border-white/[.08] bg-white/[.035] text-zinc-400">V{version?.number || '?'} · {clip?.title || 'Clip'}</span><span className="font-mono text-[10px] text-cyan-100">{Math.floor(comment.timecodeSeconds / 60).toString().padStart(2, '0')}:{Math.floor(comment.timecodeSeconds % 60).toString().padStart(2, '0')}</span></div><span className="font-mono text-[9px] text-zinc-700">{formatDate(comment.updatedAt)}</span></div><p className="mt-3 text-xs font-semibold text-zinc-300">{comment.authorName}</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-400">{comment.body}</p><button type="button" onClick={() => void patchPortal(selectedPortal, { portalId: selectedPortal.id, commentId: comment.id, commentStatus: comment.status === 'open' ? 'resolved' : 'open' })} disabled={busyAction === comment.id} className="mt-3 inline-flex min-h-11 items-center gap-2 text-[10px] font-semibold text-cyan-200 hover:text-cyan-100 disabled:opacity-40">{busyAction === comment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : comment.status === 'open' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />} {comment.status === 'open' ? 'Đánh dấu đã xử lý' : 'Mở lại góp ý'}</button></article>; })}{!selectedPortal.comments.length && <div className="flex min-h-56 flex-col items-center justify-center p-8 text-center"><MessageSquareText className="h-8 w-8 text-zinc-700" /><p className="mt-3 text-xs text-zinc-600">Chưa có góp ý từ khách hàng.</p></div>}</div></div>
        </section>
      )}
    </div>
  );
};

export default ClientReviewManager;
