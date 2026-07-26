import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clapperboard,
  CopyPlus,
  Layers3,
  Mic2,
  Play,
  ShieldCheck,
  Sparkles,
  Trash2,
  VolumeX,
} from 'lucide-react';
import {
  AspectRatio,
  ProjectState,
  VideoFactoryPolicy,
  VideoFactoryVariant,
  VideoFactoryVoiceMode,
} from '../types';
import { getApiKeyForModel, getModels } from '../services/modelRegistry';
import {
  approveVideoFactoryVariant,
  createDefaultVideoFactoryState,
  createVideoFactoryPlan,
  getVideoFactoryRuntimeState,
  getVideoFactorySummary,
  materializeVideoFactoryVariant,
  removeVideoFactoryVariant,
} from '../services/videoFactoryService';
import { useAlert } from './GlobalAlert';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((previous: ProjectState) => ProjectState)) => void;
  onOpenDirector: () => void;
  onShowModelConfig: () => void;
}

const splitLines = (value: string): string[] => value.split('\n').map((item) => item.trim()).filter(Boolean);
const joinLines = (items: string[]): string => items.join('\n');
const formatUsd = (value: number): string => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);

const STATUS_META: Record<VideoFactoryVariant['status'], { label: string; className: string }> = {
  planned: { label: 'Đã lên ma trận', className: 'border-white/10 bg-white/[.04] text-zinc-400' },
  materialized: { label: 'Draft sẵn sàng', className: 'border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100' },
  approved: { label: 'Đã duyệt final', className: 'border-amber-200/20 bg-amber-200/[.07] text-amber-100' },
  ready: { label: 'Đã có video', className: 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' },
  failed: { label: 'Cần xử lý', className: 'border-rose-200/20 bg-rose-200/[.07] text-rose-100' },
};

const extractAudience = (rawScript: string): string => rawScript.match(/KHÁCH HÀNG MỤC TIÊU:\s*(.+)/i)?.[1]?.trim() || '';

const VideoFactory: React.FC<Props> = ({ project, updateProject, onOpenDirector, onShowModelConfig }) => {
  const { showAlert } = useAlert();
  const factory = useMemo(() => getVideoFactoryRuntimeState(project), [project]);
  const defaults = useMemo(() => createDefaultVideoFactoryState(), []);
  const summary = useMemo(() => getVideoFactorySummary(project), [project]);
  const imageModels = useMemo(() => getModels('image').filter((model) => model.isEnabled), []);
  const videoModels = useMemo(() => getModels('video').filter((model) => model.isEnabled), []);
  const sourceShots = project.shots.filter((shot) => !shot.factory);
  const [hooks, setHooks] = useState(() => joinLines(factory.hooks.length ? factory.hooks : [sourceShots[0]?.actionSummary || '']));
  const [ctas, setCtas] = useState(() => joinLines(factory.ctas.length ? factory.ctas : project.brandKitSnapshot?.ctas || []));
  const [audiences, setAudiences] = useState(() => joinLines(factory.audiences.length ? factory.audiences : [extractAudience(project.rawScript)]));
  const [ratios, setRatios] = useState<AspectRatio[]>(factory.aspectRatios);
  const [durations, setDurations] = useState<number[]>(factory.durations);
  const [voiceModes, setVoiceModes] = useState<VideoFactoryVoiceMode[]>(factory.voiceModes);
  const [policy, setPolicy] = useState<VideoFactoryPolicy>({ ...defaults.policy, ...factory.policy });
  const [statusFilter, setStatusFilter] = useState<'all' | VideoFactoryVariant['status']>('all');

  const estimatedCombinations = Math.max(1, splitLines(hooks).length)
    * Math.max(1, splitLines(ctas).length)
    * Math.max(1, splitLines(audiences).length)
    * ratios.length * durations.length * voiceModes.length;

  const toggle = <T,>(items: T[], value: T, setter: (next: T[]) => void) => setter(items.includes(value)
    ? items.filter((item) => item !== value)
    : [...items, value]);

  const createPlan = () => {
    try {
      updateProject((previous) => createVideoFactoryPlan(previous, {
        hooks: splitLines(hooks),
        ctas: splitLines(ctas),
        audiences: splitLines(audiences),
        aspectRatios: ratios,
        durations,
        voiceModes,
        policy,
      }));
      showAlert('Đã tạo ma trận biến thể. Chưa có API media nào được gọi.', { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể tạo ma trận biến thể.', { type: 'error' });
    }
  };

  const materialize = (variant: VideoFactoryVariant) => {
    try {
      updateProject((previous) => materializeVideoFactoryVariant(previous, variant.id));
      showAlert('Đã tạo shot draft và xếp tác vụ. Chưa phát sinh chi phí API.', { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể tạo shot draft.', { type: 'error' });
    }
  };

  const approve = (variant: VideoFactoryVariant) => {
    showAlert(`Duyệt “${variant.name}” để chuyển sang model final? Các khung/video draft sẽ được giữ trong checkpoint và đánh dấu tạo lại.`, {
      type: 'warning',
      showCancel: true,
      onConfirm: () => {
        try {
          updateProject((previous) => approveVideoFactoryVariant(previous, variant.id));
          showAlert('Biến thể đã qua cổng duyệt và được phép dùng model final.', { type: 'success' });
        } catch (error) {
          showAlert(error instanceof Error ? error.message : 'Không thể duyệt biến thể.', { type: 'error' });
        }
      },
    });
  };

  const remove = (variant: VideoFactoryVariant) => {
    showAlert(`Xóa “${variant.name}”${variant.shotIds.length ? ' và toàn bộ shot biến thể đã tạo' : ''}?`, {
      type: 'warning',
      showCancel: true,
      onConfirm: () => updateProject((previous) => removeVideoFactoryVariant(previous, variant.id)),
    });
  };

  const filtered = factory.variants.filter((variant) => statusFilter === 'all' || variant.status === statusFilter);
  const budgetPercent = policy.budgetLimitUsd > 0 ? Math.min(100, Math.round((summary.committedCostUsd / policy.budgetLimitUsd) * 100)) : 0;

  return (
    <div className="space-y-6">
      <section className="eg-panel relative overflow-hidden p-5 md:p-7">
        <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-cyan-200/[.07] blur-[100px]" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl"><div className="eg-kicker">Epic 05 · Video Factory</div><h2 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-white md:text-4xl">Một concept, nhiều phiên bản có kiểm soát</h2><p className="mt-3 text-sm leading-6 text-zinc-400">Tạo ma trận hook × CTA × tỷ lệ × thời lượng × voice × audience. Hệ thống chỉ lập kế hoạch và tạo shot; API media chỉ chạy khi team chủ động mở Xưởng dựng.</p></div>
          <button type="button" onClick={onOpenDirector} disabled={summary.materialized + summary.approved === 0} className="eg-button-primary inline-flex min-h-12 items-center justify-center gap-2 px-6 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"><Play className="h-4 w-4 fill-current" /> Mở Xưởng dựng <ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="relative mt-7 grid grid-cols-2 gap-3 lg:grid-cols-5">{[
          { label: 'Biến thể', value: summary.total },
          { label: 'Draft', value: summary.materialized },
          { label: 'Đã duyệt final', value: summary.approved },
          { label: 'Đã có video', value: summary.ready },
          { label: 'Chi phí đã cam kết', value: formatUsd(summary.committedCostUsd) },
        ].map((item) => <div key={item.label} className="rounded-2xl border border-white/[.07] bg-black/20 p-4"><span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">{item.label}</span><strong className="mt-2 block text-xl text-white">{item.value}</strong></div>)}</div>
      </section>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="eg-panel p-5 md:p-6">
          <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-200/15 bg-cyan-200/[.06] text-cyan-100"><Layers3 className="h-4 w-4" /></span><div><h3 className="text-base font-semibold text-white">Ma trận nội dung</h3><p className="mt-1 text-[10px] leading-4 text-zinc-600">Mỗi dòng là một lựa chọn. Factory lấy tổ hợp đa dạng và giới hạn theo mức anh đặt.</p></div></div>
          <div className="mt-5 grid gap-4 xl:grid-cols-3"><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Hook<textarea value={hooks} onChange={(event) => setHooks(event.target.value)} rows={8} className="eg-input mt-2 min-h-48 resize-y px-4 py-3 text-sm font-normal normal-case leading-6 tracking-normal" placeholder={'Hook 1\nHook 2\nHook 3'} /></label><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">CTA<textarea value={ctas} onChange={(event) => setCtas(event.target.value)} rows={8} className="eg-input mt-2 min-h-48 resize-y px-4 py-3 text-sm font-normal normal-case leading-6 tracking-normal" placeholder={'Khám phá ngay\nĐăng ký tư vấn'} /></label><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Nhóm khách hàng<textarea value={audiences} onChange={(event) => setAudiences(event.target.value)} rows={8} className="eg-input mt-2 min-h-48 resize-y px-4 py-3 text-sm font-normal normal-case leading-6 tracking-normal" placeholder={'Gen Z thành thị\nMẹ bỉm bận rộn'} /></label></div>
          <div className="mt-6 grid gap-5 lg:grid-cols-3"><fieldset><legend className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tỷ lệ</legend><div className="mt-3 flex flex-wrap gap-2">{(['9:16', '1:1', '16:9'] as AspectRatio[]).map((ratio) => <button key={ratio} type="button" onClick={() => toggle(ratios, ratio, setRatios)} aria-pressed={ratios.includes(ratio)} className={`min-h-11 rounded-xl border px-4 font-mono text-xs ${ratios.includes(ratio) ? 'border-cyan-200/25 bg-cyan-200/[.08] text-cyan-100' : 'border-white/[.08] text-zinc-500'}`}>{ratio}</button>)}</div></fieldset><fieldset><legend className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Thời lượng master</legend><div className="mt-3 flex flex-wrap gap-2">{[15, 30, 45].map((duration) => <button key={duration} type="button" onClick={() => toggle(durations, duration, setDurations)} aria-pressed={durations.includes(duration)} className={`min-h-11 rounded-xl border px-4 font-mono text-xs ${durations.includes(duration) ? 'border-cyan-200/25 bg-cyan-200/[.08] text-cyan-100' : 'border-white/[.08] text-zinc-500'}`}>{duration}s</button>)}</div></fieldset><fieldset><legend className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Âm thanh</legend><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => toggle(voiceModes, 'with-voice', setVoiceModes)} aria-pressed={voiceModes.includes('with-voice')} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-xs ${voiceModes.includes('with-voice') ? 'border-cyan-200/25 bg-cyan-200/[.08] text-cyan-100' : 'border-white/[.08] text-zinc-500'}`}><Mic2 className="h-4 w-4" /> Có voice</button><button type="button" onClick={() => toggle(voiceModes, 'no-voice', setVoiceModes)} aria-pressed={voiceModes.includes('no-voice')} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-xs ${voiceModes.includes('no-voice') ? 'border-cyan-200/25 bg-cyan-200/[.08] text-cyan-100' : 'border-white/[.08] text-zinc-500'}`}><VolumeX className="h-4 w-4" /> Không voice</button></div></fieldset></div>
        </section>

        <aside className="eg-panel p-5 md:p-6">
          <div className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-cyan-100/70" /><div><h3 className="text-base font-semibold text-white">Routing & ngân sách</h3><p className="mt-1 text-[10px] text-zinc-600">Draft rẻ, final chỉ sau cổng duyệt</p></div></div>
          <div className="mt-5 space-y-4"><label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Model ảnh draft<select value={policy.draftImageModelId || ''} onChange={(event) => setPolicy((current) => ({ ...current, draftImageModelId: event.target.value }))} className="eg-input mt-2 min-h-11 px-3 text-xs normal-case tracking-normal">{imageModels.map((model) => <option key={model.id} value={model.id}>{model.name}{getApiKeyForModel(model.id) ? '' : ' · chưa có key'}</option>)}</select></label><label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Model video draft<select value={policy.draftVideoModelId || ''} onChange={(event) => setPolicy((current) => ({ ...current, draftVideoModelId: event.target.value }))} className="eg-input mt-2 min-h-11 px-3 text-xs normal-case tracking-normal">{videoModels.map((model) => <option key={model.id} value={model.id}>{model.name}{getApiKeyForModel(model.id) ? '' : ' · chưa có key'}</option>)}</select></label><label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Model ảnh final<select value={policy.finalImageModelId || ''} onChange={(event) => setPolicy((current) => ({ ...current, finalImageModelId: event.target.value }))} className="eg-input mt-2 min-h-11 px-3 text-xs normal-case tracking-normal">{imageModels.map((model) => <option key={model.id} value={model.id}>{model.name}{getApiKeyForModel(model.id) ? '' : ' · chưa có key'}</option>)}</select></label><label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Model video final<select value={policy.finalVideoModelId || ''} onChange={(event) => setPolicy((current) => ({ ...current, finalVideoModelId: event.target.value }))} className="eg-input mt-2 min-h-11 px-3 text-xs normal-case tracking-normal">{videoModels.map((model) => <option key={model.id} value={model.id}>{model.name}{getApiKeyForModel(model.id) ? '' : ' · chưa có key'}</option>)}</select></label></div>
          {(!imageModels.length || !videoModels.length) && <button type="button" onClick={onShowModelConfig} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-200/20 bg-amber-200/[.06] px-4 text-xs font-semibold text-amber-100"><AlertTriangle className="h-4 w-4" /> Cấu hình model</button>}
          <div className="mt-5 grid grid-cols-2 gap-3"><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Giới hạn biến thể<input type="number" min="1" max="120" value={policy.maxVariants} onChange={(event) => setPolicy((current) => ({ ...current, maxVariants: Number(event.target.value) }))} className="eg-input mt-2 min-h-11 px-3 font-mono text-xs normal-case tracking-normal" /></label><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Trần chi phí USD<input type="number" min="0" step="0.5" value={policy.budgetLimitUsd} onChange={(event) => setPolicy((current) => ({ ...current, budgetLimitUsd: Number(event.target.value) }))} className="eg-input mt-2 min-h-11 px-3 font-mono text-xs normal-case tracking-normal" /></label></div>
          <label className="mt-4 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-white/[.08] bg-white/[.025] px-4 text-xs text-zinc-300"><input type="checkbox" checked={policy.reuseAssets} onChange={(event) => setPolicy((current) => ({ ...current, reuseAssets: event.target.checked }))} className="h-4 w-4 accent-cyan-300" /> Tái sử dụng nhân vật, bối cảnh và Brand Kit</label>
          <div className="mt-5 rounded-xl border border-white/[.07] bg-black/20 p-4"><div className="flex items-center justify-between text-[10px]"><span className="text-zinc-600">Đã cam kết</span><strong className="font-mono text-white">{formatUsd(summary.committedCostUsd)} / {formatUsd(policy.budgetLimitUsd)}</strong></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className={`h-full rounded-full ${budgetPercent >= 90 ? 'bg-rose-300' : budgetPercent >= 70 ? 'bg-amber-300' : 'bg-[var(--eg-accent)]'}`} style={{ width: `${budgetPercent}%` }} /></div></div>
          <button type="button" onClick={createPlan} disabled={!sourceShots.length || !ratios.length || !durations.length || !voiceModes.length} className="eg-button-primary mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 px-5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40"><Sparkles className="h-4 w-4" /> Tạo tối đa {Math.min(estimatedCombinations, policy.maxVariants)} biến thể</button>
          <p className="mt-3 text-[10px] leading-4 text-zinc-600">Tạo ma trận không gọi API. Chi phí chỉ phát sinh khi team chạy từng shot trong Xưởng dựng.</p>
        </aside>
      </div>

      <section className="eg-panel p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="eg-kicker">Variant queue</div><h3 className="mt-1 text-lg font-semibold text-white">Danh sách biến thể</h3><p className="mt-1 text-xs text-zinc-600">{summary.plannedCostUsd ? `Ước tính toàn bộ ma trận: ${formatUsd(summary.plannedCostUsd)}` : 'Chưa có ma trận.'}</p></div><div className="flex flex-wrap gap-2">{(['all', 'planned', 'materialized', 'approved', 'ready'] as const).map((status) => <button key={status} type="button" onClick={() => setStatusFilter(status)} aria-pressed={statusFilter === status} className={`min-h-11 rounded-xl border px-4 text-[10px] font-semibold ${statusFilter === status ? 'border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100' : 'border-white/[.07] text-zinc-500'}`}>{status === 'all' ? 'Tất cả' : STATUS_META[status].label}</button>)}</div></div>
        {filtered.length ? <div className="mt-5 grid gap-3 xl:grid-cols-2">{filtered.map((variant) => {
          const meta = STATUS_META[variant.status];
          return <article key={variant.id} className="rounded-2xl border border-white/[.075] bg-black/15 p-4 md:p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`eg-chip ${meta.className}`}>{meta.label}</span><span className="font-mono text-[9px] uppercase tracking-wider text-zinc-700">{variant.tier}</span></div><h4 className="mt-3 text-sm font-semibold text-white">{variant.name}</h4><p className="mt-2 line-clamp-2 text-[11px] leading-5 text-zinc-500"><strong className="text-zinc-300">Hook:</strong> {variant.hook}</p></div><button type="button" onClick={() => remove(variant)} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center text-zinc-700 hover:text-rose-200" aria-label={`Xóa ${variant.name}`}><Trash2 className="h-4 w-4" /></button></div><div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-white/[.05] bg-black/20 p-3"><div><span className="text-[8px] uppercase tracking-wider text-zinc-700">Định dạng</span><strong className="mt-1 block font-mono text-[10px] text-zinc-300">{variant.aspectRatio} · {variant.duration}s</strong></div><div><span className="text-[8px] uppercase tracking-wider text-zinc-700">Audience</span><strong className="mt-1 line-clamp-1 block text-[10px] text-zinc-300">{variant.audience}</strong></div><div><span className="text-[8px] uppercase tracking-wider text-zinc-700">Ước tính</span><strong className="mt-1 block font-mono text-[10px] text-zinc-300">{formatUsd(variant.estimatedCostUsd)}</strong></div></div><p className="mt-3 line-clamp-1 text-[10px] text-zinc-600"><strong className="text-zinc-400">CTA:</strong> {variant.cta}</p><div className="mt-4 flex flex-wrap gap-2">{variant.status === 'planned' && <button type="button" onClick={() => materialize(variant)} className="eg-button-secondary inline-flex min-h-11 flex-1 items-center justify-center gap-2 px-4 text-xs font-semibold"><CopyPlus className="h-4 w-4" /> Tạo shot draft</button>}{variant.status === 'materialized' && <button type="button" onClick={() => approve(variant)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-amber-200/20 bg-amber-200/[.06] px-4 text-xs font-semibold text-amber-100"><CheckCircle2 className="h-4 w-4" /> Duyệt lên final</button>}{['materialized', 'approved', 'ready'].includes(variant.status) && <button type="button" onClick={onOpenDirector} className="eg-button-primary inline-flex min-h-11 flex-1 items-center justify-center gap-2 px-4 text-xs font-bold"><Clapperboard className="h-4 w-4" /> Mở shot</button>}</div></article>;
        })}</div> : <div className="mt-5 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[.08] text-center"><Layers3 className="h-9 w-9 text-zinc-700" /><h4 className="mt-4 text-sm font-semibold text-zinc-300">Chưa có biến thể trong bộ lọc này</h4><p className="mt-2 max-w-sm text-xs leading-5 text-zinc-600">Thiết lập ma trận ở trên để tạo queue. Factory không tự gọi API nên anh luôn kiểm soát được credit.</p></div>}
      </section>

      <section className="grid gap-3 md:grid-cols-3"><div className="eg-card p-4"><CopyPlus className="h-4 w-4 text-cyan-100/70" /><h4 className="mt-3 text-xs font-semibold text-white">Tái sử dụng asset</h4><p className="mt-2 text-[10px] leading-4 text-zinc-600">Shot biến thể giữ nguyên ID nhân vật, bối cảnh và reference trong Brand Kit.</p></div><div className="eg-card p-4"><CircleDollarSign className="h-4 w-4 text-amber-100/70" /><h4 className="mt-3 text-xs font-semibold text-white">Không đốt credit ngầm</h4><p className="mt-2 text-[10px] leading-4 text-zinc-600">Lập ma trận và tạo shot đều là thao tác local; chỉ nút chạy media mới phát sinh phí.</p></div><div className="eg-card p-4"><ShieldCheck className="h-4 w-4 text-emerald-100/70" /><h4 className="mt-3 text-xs font-semibold text-white">Cổng duyệt model final</h4><p className="mt-2 text-[10px] leading-4 text-zinc-600">Model final chỉ được route sau khi producer bấm duyệt; hệ thống tạo checkpoint trước khi làm mới draft.</p></div></section>
    </div>
  );
};

export default VideoFactory;
