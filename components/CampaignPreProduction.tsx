import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Film,
  Lightbulb,
  Loader2,
  Palette,
  PanelsTopLeft,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { AgencyCampaign, AgencyClient, CampaignDeliverable } from '../types';
import { getCampaignBriefReadiness } from '../services/campaignService';

interface CampaignPreProductionProps {
  isOpen: boolean;
  campaign: AgencyCampaign;
  client: AgencyClient;
  launchingDeliverableId: string | null;
  onClose: () => void;
  onLaunch: (deliverable: CampaignDeliverable) => void;
}

const PHASES = [
  { label: 'Chiến lược', detail: 'Insight, big idea và thông điệp', icon: Lightbulb },
  { label: 'Kịch bản', detail: 'Hook, nhịp kể và CTA', icon: FileText },
  { label: 'Storyboard', detail: 'Cấu trúc cảnh và nhịp hình', icon: PanelsTopLeft },
  { label: 'Visual Bible', detail: 'Moodboard và luật hình ảnh', icon: Palette },
];

const CampaignPreProduction: React.FC<CampaignPreProductionProps> = ({
  isOpen,
  campaign,
  client,
  launchingDeliverableId,
  onClose,
  onLaunch,
}) => {
  const [selectedDeliverableId, setSelectedDeliverableId] = useState(campaign.deliverables[0]?.id || '');
  const readiness = useMemo(() => getCampaignBriefReadiness(campaign, client), [campaign, client]);
  const selectedDeliverable = campaign.deliverables.find((item) => item.id === selectedDeliverableId)
    || campaign.deliverables[0];

  useEffect(() => {
    setSelectedDeliverableId(campaign.deliverables[0]?.id || '');
  }, [campaign.id]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !launchingDeliverableId) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, launchingDeliverableId, onClose]);

  if (!isOpen) return null;

  const scoreTone = readiness.score >= 75
    ? 'text-emerald-100'
    : readiness.score >= 50 ? 'text-amber-100' : 'text-rose-100';

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/80 p-3 backdrop-blur-xl" onClick={launchingDeliverableId ? undefined : onClose}>
      <div className="eg-panel flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="preproduction-title" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b eg-divider p-5 md:px-7 md:py-6">
          <div className="min-w-0">
            <div className="eg-kicker">Egoric pre-production room</div>
            <h2 id="preproduction-title" className="mt-2 text-xl font-semibold tracking-[-.02em] text-white md:text-2xl">Phòng tiền kỳ chiến dịch</h2>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-500">Kiểm tra brief, chọn đầu ra và bàn giao toàn bộ ngữ cảnh cho Trợ lý Đạo diễn trong một lần.</p>
          </div>
          <button type="button" onClick={onClose} disabled={Boolean(launchingDeliverableId)} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40" aria-label="Đóng phòng tiền kỳ"><X className="h-4 w-4" /></button>
        </header>

        <div className="eg-safe-scroll flex-1 overflow-y-auto p-5 md:p-7">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
              <section className="relative overflow-hidden rounded-2xl border border-cyan-200/[.13] bg-[linear-gradient(125deg,rgba(29,43,54,.78),rgba(8,13,18,.88))] p-5 md:p-6">
                <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-cyan-200/[.08] blur-3xl" />
                <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
                  <div className="relative flex h-28 w-28 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(var(--eg-accent) ${readiness.score * 3.6}deg, rgba(255,255,255,.065) 0deg)` }} aria-label={`Brief sẵn sàng ${readiness.score}%`}>
                    <div className="flex h-[92px] w-[92px] flex-col items-center justify-center rounded-full bg-[#0b1016]">
                      <strong className={`font-mono text-2xl tabular-nums ${scoreTone}`}>{readiness.score}%</strong>
                      <span className="mt-1 text-[9px] uppercase tracking-wider text-zinc-600">sẵn sàng</span>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="eg-chip border-cyan-200/15 bg-cyan-200/[.055] text-cyan-50"><ClipboardCheck className="h-3 w-3" /> Brief health check</span>
                    <h3 className="mt-3 text-lg font-semibold text-white">{campaign.name}</h3>
                    <p className="mt-1 text-xs text-zinc-500">{client.brandName} · {readiness.readyCount}/{readiness.totalCount} hạng mục đã chốt</p>
                    <p className="mt-3 text-xs leading-5 text-zinc-400">
                      {readiness.missing.length
                        ? `Đạo diễn AI sẽ đánh dấu giả định và giúp account làm rõ: ${readiness.missing.join(', ')}.`
                        : 'Brief đã đủ dữ kiện nền tảng để phát triển creative direction và kế hoạch tiền kỳ.'}
                    </p>
                  </div>
                </div>
              </section>

              <section className="eg-card p-5 md:p-6">
                <div className="flex items-end justify-between gap-3">
                  <div><div className="eg-kicker">Pre-production pipeline</div><h3 className="mt-1 text-base font-semibold text-white">Bốn lớp cần được duyệt</h3></div>
                  <span className="hidden text-[10px] text-zinc-600 sm:block">Chưa phát sinh media</span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {PHASES.map((phase, index) => (
                    <article key={phase.label} className="rounded-2xl border border-white/[.07] bg-black/15 p-4">
                      <div className="flex items-center justify-between"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[.08] bg-white/[.035] text-cyan-100"><phase.icon className="h-4 w-4" /></span><span className="font-mono text-[9px] text-zinc-700">0{index + 1}</span></div>
                      <h4 className="mt-4 text-xs font-semibold text-zinc-200">{phase.label}</h4>
                      <p className="mt-1 text-[10px] leading-4 text-zinc-600">{phase.detail}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="eg-card p-5 md:p-6">
                <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-white">Checklist brief</h3><span className="font-mono text-[10px] tabular-nums text-zinc-500">{readiness.readyCount}/{readiness.totalCount}</span></div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {readiness.checks.map((check) => (
                    <div key={check.id} className="flex min-h-16 items-start gap-3 rounded-xl border border-white/[.06] bg-black/15 p-3">
                      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${check.complete ? 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' : 'border-amber-200/20 bg-amber-200/[.06] text-amber-100'}`}>
                        {check.complete ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                      </span>
                      <div><p className="text-[11px] font-medium text-zinc-300">{check.label}</p><p className="mt-1 text-[9px] leading-4 text-zinc-600">{check.detail}</p></div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <aside className="h-fit rounded-2xl border border-white/[.08] bg-black/20 p-5 lg:sticky lg:top-0">
              <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-200/15 bg-cyan-200/[.055] text-cyan-100"><Film className="h-4 w-4" /></span><div><h3 className="text-sm font-semibold text-white">Chọn đầu ra tiền kỳ</h3><p className="mt-1 text-[10px] text-zinc-600">Mỗi đầu ra có một project riêng</p></div></div>
              <label htmlFor="preproduction-deliverable" className="mt-5 block text-[9px] font-semibold uppercase tracking-wider text-zinc-600">Đầu ra</label>
              <select id="preproduction-deliverable" value={selectedDeliverable?.id || ''} onChange={(event) => setSelectedDeliverableId(event.target.value)} className="eg-input mt-2 px-3 text-xs">
                {campaign.deliverables.map((deliverable) => <option key={deliverable.id} value={deliverable.id}>{deliverable.title}</option>)}
              </select>

              {selectedDeliverable && (
                <div className="mt-4 space-y-3 rounded-xl border border-white/[.06] bg-white/[.018] p-4 text-[10px]">
                  <div className="flex items-center justify-between gap-3"><span className="text-zinc-600">Định dạng</span><strong className="font-mono text-zinc-300">{selectedDeliverable.aspectRatio}</strong></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-zinc-600">Thời lượng</span><strong className="font-mono text-zinc-300">{selectedDeliverable.duration}s</strong></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-zinc-600">Phiên bản</span><strong className="font-mono text-zinc-300">{selectedDeliverable.quantity}</strong></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-zinc-600">Project</span><strong className={selectedDeliverable.projectId ? 'text-emerald-100' : 'text-zinc-500'}>{selectedDeliverable.projectId ? 'Đã liên kết' : 'Sẽ tạo mới'}</strong></div>
                </div>
              )}

              <div className="mt-5 rounded-xl border border-emerald-200/15 bg-emerald-200/[.045] p-4">
                <div className="flex items-center gap-2 text-[10px] font-semibold text-emerald-100"><ShieldCheck className="h-4 w-4" /> Kiểm soát chi phí</div>
                <p className="mt-2 text-[10px] leading-5 text-emerald-50/55">Lượt đầu chỉ dùng mô hình hội thoại để phân tích. Ảnh, video và voice chỉ chạy sau khi team duyệt kế hoạch.</p>
              </div>

              <button type="button" onClick={() => selectedDeliverable && onLaunch(selectedDeliverable)} disabled={!selectedDeliverable || Boolean(launchingDeliverableId)} className="eg-button-primary mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 px-4 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50">
                {launchingDeliverableId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {launchingDeliverableId ? 'Đang bàn giao brief…' : selectedDeliverable?.projectId ? 'Tiếp tục với Đạo diễn AI' : 'Bắt đầu tiền kỳ'}
                {!launchingDeliverableId && <ArrowRight className="h-4 w-4" />}
              </button>
              <div className="mt-3 flex items-center justify-center gap-2 text-[9px] text-zinc-600"><CheckCircle2 className="h-3 w-3" /> 1 lượt AI văn bản · Không tạo media</div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CampaignPreProduction;
