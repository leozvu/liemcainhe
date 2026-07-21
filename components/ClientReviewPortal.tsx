import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Film,
  Loader2,
  LockKeyhole,
  MessageSquarePlus,
  MessageSquareText,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { ClientReviewDecisionStatus, ClientReviewPortal as ClientReviewPortalData } from '../types';
import {
  createPublicReviewComment,
  formatReviewTimecode,
  getPublicClientReview,
  submitPublicReviewDecision,
} from '../services/clientReviewService';

interface Props {
  token: string;
}

const formatDate = (timestamp?: number) => timestamp
  ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp)
  : 'Không giới hạn';

const ClientReviewPortal: React.FC<Props> = ({ token }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [portal, setPortal] = useState<ClientReviewPortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [selectedClipId, setSelectedClipId] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [authorName, setAuthorName] = useState(() => sessionStorage.getItem('egoric-reviewer-name') || '');
  const [authorEmail, setAuthorEmail] = useState(() => sessionStorage.getItem('egoric-reviewer-email') || '');
  const [commentBody, setCommentBody] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [formMessage, setFormMessage] = useState('');
  const [decisionDraft, setDecisionDraft] = useState<Exclude<ClientReviewDecisionStatus, 'pending'> | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getPublicClientReview(token)
      .then((nextPortal) => {
        if (!active) return;
        setPortal(nextPortal);
        const latest = nextPortal.versions.at(-1);
        setSelectedVersionId(latest?.id || '');
        setSelectedClipId(latest?.clips[0]?.id || '');
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : 'Không thể mở bản duyệt.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  const selectedVersion = useMemo(
    () => portal?.versions.find((version) => version.id === selectedVersionId) || portal?.versions.at(-1),
    [portal, selectedVersionId],
  );
  const selectedClip = useMemo(
    () => selectedVersion?.clips.find((clip) => clip.id === selectedClipId) || selectedVersion?.clips[0],
    [selectedVersion, selectedClipId],
  );
  const clipIndex = selectedVersion?.clips.findIndex((clip) => clip.id === selectedClip?.id) ?? -1;
  const comments = (portal?.comments || []).filter((comment) => comment.versionId === selectedVersion?.id && comment.clipId === selectedClip?.id);
  const locked = portal?.decision === 'approved';
  const latestVersion = portal?.versions.at(-1);
  const isLatestVersion = Boolean(selectedVersion && selectedVersion.id === latestVersion?.id);
  const interactionLocked = locked || !isLatestVersion;

  useEffect(() => {
    if (!selectedVersion?.clips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(selectedVersion?.clips[0]?.id || '');
    }
  }, [selectedVersion?.id]);

  const changeClip = (nextIndex: number) => {
    const clip = selectedVersion?.clips[nextIndex];
    if (!clip) return;
    setSelectedClipId(clip.id);
    setCurrentTime(0);
  };

  const seekTo = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = seconds;
    videoRef.current.focus();
    void videoRef.current.play().catch(() => undefined);
  };

  const submitComment = async () => {
    if (!portal || !selectedVersion || !selectedClip || commentBusy) return;
    if (interactionLocked) {
      setFormMessage(locked ? 'Phiên bản đã nghiệm thu.' : 'Phiên bản cũ chỉ dùng để đối chiếu.');
      return;
    }
    if (authorName.trim().length < 2) {
      setFormMessage('Hãy nhập tên người góp ý.');
      return;
    }
    if (!commentBody.trim()) {
      setFormMessage('Hãy nhập nội dung cần chỉnh sửa.');
      return;
    }
    setCommentBusy(true);
    setFormMessage('');
    try {
      const comment = await createPublicReviewComment(token, {
        versionId: selectedVersion.id,
        clipId: selectedClip.id,
        authorName: authorName.trim(),
        authorEmail: authorEmail.trim() || undefined,
        body: commentBody.trim(),
        timecodeSeconds: currentTime,
      });
      sessionStorage.setItem('egoric-reviewer-name', authorName.trim());
      if (authorEmail.trim()) sessionStorage.setItem('egoric-reviewer-email', authorEmail.trim());
      setPortal({ ...portal, comments: [comment, ...portal.comments] });
      setCommentBody('');
      setFormMessage(`Đã gửi góp ý tại ${formatReviewTimecode(comment.timecodeSeconds)}.`);
    } catch (reason) {
      setFormMessage(reason instanceof Error ? reason.message : 'Không thể gửi góp ý.');
    } finally {
      setCommentBusy(false);
    }
  };

  const submitDecision = async () => {
    if (!portal || !decisionDraft || decisionBusy) return;
    if (!isLatestVersion) {
      setFormMessage('Chỉ phiên bản mới nhất mới được phê duyệt.');
      return;
    }
    if (authorName.trim().length < 2) {
      setFormMessage('Hãy nhập tên người duyệt trước khi xác nhận.');
      return;
    }
    setDecisionBusy(true);
    setFormMessage('');
    try {
      const updated = await submitPublicReviewDecision(token, {
        decision: decisionDraft,
        versionId: selectedVersion?.id || '',
        reviewerName: authorName.trim(),
        reviewerEmail: authorEmail.trim() || undefined,
        note: decisionNote.trim() || undefined,
      });
      sessionStorage.setItem('egoric-reviewer-name', authorName.trim());
      if (authorEmail.trim()) sessionStorage.setItem('egoric-reviewer-email', authorEmail.trim());
      setPortal(updated);
      setDecisionDraft(null);
      setDecisionNote('');
    } catch (reason) {
      setFormMessage(reason instanceof Error ? reason.message : 'Không thể gửi quyết định duyệt.');
    } finally {
      setDecisionBusy(false);
    }
  };

  if (loading) return <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--eg-canvas)] text-sm text-zinc-500"><Loader2 className="mr-3 h-5 w-5 animate-spin text-cyan-200" /> Đang mở phòng duyệt…</div>;

  if (error || !portal) return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--eg-canvas)] p-5 text-center text-white">
      <div className="eg-panel w-full max-w-lg p-8"><XCircle className="mx-auto h-10 w-10 text-rose-200" /><h1 className="mt-5 text-xl font-semibold">Không thể mở bản duyệt</h1><p className="mt-3 text-sm leading-6 text-zinc-500">{error || 'Link không tồn tại hoặc đã hết hạn.'}</p><a href="/" className="eg-button-secondary mt-6 inline-flex min-h-11 items-center justify-center px-5 text-xs font-semibold">Về trang Egoric</a></div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-[var(--eg-canvas)] text-[var(--eg-text)]">
      <header className="border-b eg-divider bg-[rgba(7,9,12,.92)] px-4 py-4 backdrop-blur-xl md:px-8">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3"><img src="/egoric-agency-icon.png" alt="Egoric Agency" className="h-11 w-11 shrink-0 rounded-xl object-cover" /><div className="min-w-0"><div className="eg-kicker">Egoric Agency · Client Review</div><h1 className="truncate text-base font-semibold text-white md:text-xl">{portal.title}</h1></div></div>
          <span className={`eg-chip shrink-0 ${locked ? 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' : 'border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100'}`}>{locked ? <LockKeyhole className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}{locked ? 'Đã nghiệm thu' : 'Link bảo mật'}</span>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-6 pb-20 md:px-8 md:py-8">
        <section className="mb-6 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div><div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-600"><span>{portal.clientName}</span>{portal.campaignName && <><span>·</span><span>{portal.campaignName}</span></>}<span>·</span><span>Hết hạn {formatDate(portal.expiresAt)}</span></div><h2 className="mt-3 text-2xl font-semibold tracking-[-.03em] text-white md:text-4xl">{portal.deliverableTitle || portal.title}</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">Chọn phiên bản và cảnh cần xem. Khi góp ý, hệ thống tự gắn đúng timecode hiện tại.</p></div>
          <div className="flex items-end gap-2"><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Phiên bản<select value={selectedVersion?.id || ''} onChange={(event) => { setSelectedVersionId(event.target.value); setCurrentTime(0); }} className="eg-input mt-2 min-w-60 px-3 text-sm font-normal normal-case tracking-normal">{[...portal.versions].reverse().map((version) => <option key={version.id} value={version.id}>V{version.number} · {version.label}</option>)}</select></label>{!isLatestVersion && <span className="eg-chip mb-1 border-amber-200/20 bg-amber-200/[.07] text-amber-100"><LockKeyhole className="h-3 w-3" /> Chỉ xem</span>}</div>
        </section>

        {selectedVersion && selectedClip ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,.45fr)]">
            <section className="min-w-0">
              <div className="overflow-hidden rounded-3xl border border-white/[.08] bg-black shadow-2xl shadow-black/30">
                <div className="relative aspect-video bg-black">
                  <video key={selectedClip.id} ref={videoRef} src={selectedClip.videoUrl} poster={selectedClip.posterUrl} controls playsInline preload="metadata" onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} className="h-full w-full object-contain" aria-label={`${selectedClip.title}: ${selectedClip.actionSummary}`} />
                  <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-white/10 bg-black/65 px-3 py-2 font-mono text-[11px] text-white backdrop-blur-md">{formatReviewTimecode(currentTime)}</div>
                </div>
                <div className="flex flex-col gap-4 border-t border-white/[.07] p-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
                  <div className="min-w-0"><div className="flex items-center gap-2"><span className="eg-chip">V{selectedVersion.number}</span><h3 className="truncate text-sm font-semibold text-white">{selectedClip.title}</h3></div><p className="mt-2 line-clamp-2 text-[11px] leading-5 text-zinc-500">{selectedClip.actionSummary || 'Cảnh video cần duyệt.'}</p></div>
                  <div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => changeClip(clipIndex - 1)} disabled={clipIndex <= 0} className="eg-icon-button flex h-11 w-11 items-center justify-center disabled:cursor-not-allowed disabled:opacity-30" aria-label="Cảnh trước"><ChevronLeft className="h-4 w-4" /></button><span className="min-w-16 text-center font-mono text-[10px] text-zinc-500">{clipIndex + 1}/{selectedVersion.clips.length}</span><button type="button" onClick={() => changeClip(clipIndex + 1)} disabled={clipIndex >= selectedVersion.clips.length - 1} className="eg-icon-button flex h-11 w-11 items-center justify-center disabled:cursor-not-allowed disabled:opacity-30" aria-label="Cảnh tiếp theo"><ChevronRight className="h-4 w-4" /></button></div>
                </div>
              </div>

              <div className="mt-4 flex gap-3 overflow-x-auto pb-2" aria-label="Danh sách cảnh trong phiên bản">
                {selectedVersion.clips.map((clip, index) => <button key={clip.id} type="button" onClick={() => changeClip(index)} className={`w-40 shrink-0 overflow-hidden rounded-2xl border text-left transition-colors ${clip.id === selectedClip.id ? 'border-cyan-200/40 bg-cyan-200/[.07]' : 'border-white/[.07] bg-white/[.025] hover:border-white/15'}`} aria-current={clip.id === selectedClip.id ? 'true' : undefined}><div className="relative aspect-video bg-black/60">{clip.posterUrl ? <img src={clip.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="flex h-full items-center justify-center"><Film className="h-5 w-5 text-zinc-700" /></span>}<span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-1 font-mono text-[8px] text-white">{Math.round(clip.duration)}s</span></div><span className="block truncate px-3 py-2 text-[10px] font-semibold text-zinc-300">{clip.title}</span></button>)}
              </div>

              {selectedVersion.note && <div className="mt-4 rounded-2xl border border-white/[.07] bg-white/[.025] p-4"><div className="eg-kicker">Ghi chú phiên bản</div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-400">{selectedVersion.note}</p></div>}
            </section>

            <aside className="space-y-5">
              <section className="eg-panel p-5">
                <div className="flex items-start gap-3"><MessageSquarePlus className="mt-0.5 h-5 w-5 text-cyan-200" /><div><h3 className="text-sm font-semibold text-white">Góp ý tại timecode</h3><p className="mt-1 text-[11px] leading-5 text-zinc-500">Đang đánh dấu <span className="font-mono text-cyan-100">{formatReviewTimecode(currentTime)}</span> trong {selectedClip.title}.</p></div></div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Tên người góp ý *<input value={authorName} onChange={(event) => setAuthorName(event.target.value)} disabled={interactionLocked} autoComplete="name" className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal disabled:opacity-50" placeholder="Nguyễn Minh" /></label><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Email<input type="email" value={authorEmail} onChange={(event) => setAuthorEmail(event.target.value)} disabled={interactionLocked} autoComplete="email" className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal disabled:opacity-50" placeholder="minh@congty.vn" /></label></div>
                <label className="mt-4 block text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Nội dung cần chỉnh *<textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} disabled={interactionLocked} maxLength={2000} rows={5} className="eg-input mt-2 min-h-28 resize-y px-4 py-3 text-sm font-normal leading-5 normal-case tracking-normal disabled:opacity-50" placeholder="Ví dụ: chữ CTA xuất hiện sớm hơn 1 giây…" /></label>
                <button type="button" onClick={() => void submitComment()} disabled={interactionLocked || commentBusy || !commentBody.trim() || authorName.trim().length < 2} className="eg-button-primary mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 px-5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40">{commentBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Gửi góp ý</button>
                {!isLatestVersion && <p className="mt-3 text-[11px] leading-5 text-amber-100/70">Phiên bản cũ được giữ để đối chiếu nhưng đã khóa góp ý. Hãy chọn version mới nhất để phản hồi.</p>}
                {formMessage && <p className="mt-3 text-[11px] leading-5 text-cyan-100" role="status">{formMessage}</p>}
              </section>

              <section className="eg-panel overflow-hidden"><div className="flex items-center justify-between gap-3 border-b eg-divider px-5 py-4"><div><div className="eg-kicker">Phản hồi cảnh này</div><h3 className="mt-1 text-sm font-semibold text-white">{comments.length} góp ý</h3></div><MessageSquareText className="h-4 w-4 text-cyan-200/70" /></div><div className="max-h-[420px] divide-y divide-white/[.06] overflow-y-auto">{comments.map((comment) => <button key={comment.id} type="button" onClick={() => seekTo(comment.timecodeSeconds)} className="block min-h-24 w-full p-5 text-left hover:bg-white/[.025]"><div className="flex items-center justify-between gap-3"><span className="font-mono text-[10px] text-cyan-100">{formatReviewTimecode(comment.timecodeSeconds)}</span><span className="text-[9px] text-zinc-700">{formatDate(comment.createdAt)}</span></div><p className="mt-2 text-xs font-semibold text-zinc-300">{comment.authorName}</p><p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-zinc-500">{comment.body}</p></button>)}{!comments.length && <div className="flex min-h-40 flex-col items-center justify-center p-6 text-center"><Play className="h-6 w-6 text-zinc-700" /><p className="mt-3 text-[11px] leading-5 text-zinc-600">Phát video, dừng đúng chỗ rồi gửi góp ý.</p></div>}</div></section>
            </aside>
          </div>
        ) : <div className="eg-panel flex min-h-72 items-center justify-center p-8 text-center text-sm text-zinc-500">Phiên bản này chưa có video khả dụng.</div>}

        <section className={`mt-8 rounded-3xl border p-5 md:p-7 ${locked ? 'border-emerald-200/20 bg-emerald-200/[.045]' : !isLatestVersion || portal.decision === 'changes-requested' ? 'border-amber-200/20 bg-amber-200/[.045]' : 'border-white/[.08] bg-white/[.025]'}`}>
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="flex items-start gap-4"><span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${locked ? 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' : 'border-white/[.08] bg-black/20 text-zinc-400'}`}>{locked ? <CheckCircle2 className="h-5 w-5" /> : !isLatestVersion ? <LockKeyhole className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}</span><div><div className="eg-kicker">Quyết định cuối vòng</div><h3 className="mt-1 text-lg font-semibold text-white">{locked ? 'Phiên bản đã được nghiệm thu' : !isLatestVersion ? 'Phiên bản cũ chỉ để đối chiếu' : portal.decision === 'changes-requested' ? 'Đã gửi yêu cầu chỉnh sửa' : 'Sẵn sàng chốt vòng duyệt?'}</h3><p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-500">{locked ? `${portal.reviewerName || 'Khách hàng'} đã duyệt lúc ${formatDate(portal.decidedAt)}. Phiên được khóa để bảo toàn phạm vi nghiệm thu.` : !isLatestVersion ? 'Mọi góp ý và quyết định mới phải thực hiện trên version mới nhất để tránh lẫn phạm vi chỉnh sửa.' : '“Yêu cầu chỉnh sửa” gửi brief sửa lại cho team. “Phê duyệt” khóa phiên và xác nhận nghiệm thu.'}</p>{portal.decisionNote && <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-zinc-300">{portal.decisionNote}</p>}</div></div>
            {!locked && isLatestVersion && <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[360px]"><button type="button" onClick={() => setDecisionDraft('changes-requested')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-200/20 bg-amber-200/[.055] px-5 text-xs font-semibold text-amber-100"><RefreshCw className="h-4 w-4" /> Yêu cầu chỉnh sửa</button><button type="button" onClick={() => setDecisionDraft('approved')} className="eg-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-5 text-xs font-bold"><CheckCircle2 className="h-4 w-4" /> Phê duyệt bản này</button></div>}
          </div>
        </section>
      </main>

      <footer className="border-t eg-divider px-4 py-6 text-center text-[10px] text-zinc-700"><p>Phòng duyệt bảo mật bởi Egoric Agency · Không chia sẻ link ra ngoài nhóm dự án.</p><div className="mt-2 flex justify-center gap-4"><a href="/privacy.html" target="_blank" rel="noreferrer" className="min-h-11 inline-flex items-center hover:text-zinc-400">Quyền riêng tư</a><a href="/terms.html" target="_blank" rel="noreferrer" className="min-h-11 inline-flex items-center hover:text-zinc-400">Điều khoản</a></div></footer>

      {decisionDraft && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/75 p-4 backdrop-blur-xl" role="dialog" aria-modal="true" aria-labelledby="decision-title" onClick={() => !decisionBusy && setDecisionDraft(null)}>
          <div className="eg-panel w-full max-w-xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-4 border-b eg-divider p-5 md:p-6"><div><div className="eg-kicker">Xác nhận quyết định</div><h2 id="decision-title" className="mt-1 text-lg font-semibold text-white">{decisionDraft === 'approved' ? 'Phê duyệt và khóa phiên bản?' : 'Gửi yêu cầu chỉnh sửa?'}</h2><p className="mt-2 text-xs leading-5 text-zinc-500">{decisionDraft === 'approved' ? 'Sau khi xác nhận, cổng góp ý sẽ bị khóa. Team Egoric có thể mở vòng duyệt mới khi cần.' : 'Team Egoric sẽ nhận ghi chú này làm brief cho vòng sửa tiếp theo.'}</p></div><button type="button" onClick={() => setDecisionDraft(null)} disabled={decisionBusy} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center" aria-label="Đóng xác nhận"><X className="h-4 w-4" /></button></header>
            <div className="p-5 md:p-6"><div className="grid gap-3 sm:grid-cols-2"><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Tên người duyệt *<input value={authorName} onChange={(event) => setAuthorName(event.target.value)} autoComplete="name" className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal" /></label><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Email<input type="email" value={authorEmail} onChange={(event) => setAuthorEmail(event.target.value)} autoComplete="email" className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal" /></label></div><label className="mt-4 block text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Ghi chú quyết định<textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} maxLength={1000} rows={5} className="eg-input mt-2 min-h-28 resize-y px-4 py-3 text-sm font-normal leading-5 normal-case tracking-normal" placeholder={decisionDraft === 'approved' ? 'Ví dụ: Đã duyệt để chạy quảng cáo…' : 'Tóm tắt các thay đổi bắt buộc ở vòng tiếp theo…'} /></label>{formMessage && <p className="mt-3 text-[11px] text-amber-100" role="alert">{formMessage}</p>}</div>
            <footer className="grid grid-cols-[auto_1fr] gap-3 border-t eg-divider bg-black/15 p-4 md:px-6"><button type="button" onClick={() => setDecisionDraft(null)} disabled={decisionBusy} className="eg-button-secondary px-5 text-xs font-semibold">Hủy</button><button type="button" onClick={() => void submitDecision()} disabled={decisionBusy || authorName.trim().length < 2} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-xs font-bold disabled:opacity-40 ${decisionDraft === 'approved' ? 'eg-button-primary' : 'border border-amber-200/20 bg-amber-200/[.07] text-amber-100'}`}>{decisionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : decisionDraft === 'approved' ? <CheckCircle2 className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />} {decisionDraft === 'approved' ? 'Xác nhận nghiệm thu' : 'Gửi yêu cầu sửa'}</button></footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientReviewPortal;
