import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  AudioLines,
  BadgeDollarSign,
  Captions,
  Check,
  CheckCircle2,
  ChevronRight,
  Clapperboard,
  Clock3,
  Download,
  Film,
  Image,
  Layers3,
  Loader2,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  ShieldCheck,
  Sparkles,
  Upload,
  WandSparkles,
  XCircle,
} from 'lucide-react';
import {
  AspectRatio,
  AutoEditorCaptionStyle,
  AutoEditorColorPreset,
  AutoEditorLogoPosition,
  AutoEditorOutputStatus,
  AutoEditorTransition,
  ProjectState,
} from '../types';
import {
  createAutoEditorPlan,
  downloadAutoEditorSrt,
  failAutoEditorRender,
  finishAutoEditorRender,
  getAutoEditorSources,
  getAutoEditorSummary,
  normalizeAutoEditorState,
  startAutoEditorRender,
  updateAutoEditorSettings,
} from '../services/autoEditorService';
import { cancelAutoEditorRender, renderAutoEditorOutputInBrowser } from '../services/autoEditorRenderService';
import { useAlert } from './GlobalAlert';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((previous: ProjectState) => ProjectState)) => void;
  onOpenExport: () => void;
}

const RATIO_OPTIONS: Array<{ id: AspectRatio; label: string; detail: string }> = [
  { id: '9:16', label: 'Dọc 9:16', detail: 'TikTok · Reel · Short' },
  { id: '1:1', label: 'Vuông 1:1', detail: 'Feed · quảng cáo' },
  { id: '16:9', label: 'Ngang 16:9', detail: 'YouTube · TVC · web' },
];

const CAPTION_STYLES: Array<{ id: AutoEditorCaptionStyle; label: string }> = [
  { id: 'clean', label: 'Tinh gọn' },
  { id: 'bold', label: 'Hook mạnh' },
  { id: 'boxed', label: 'Hộp nền' },
];

const COLOR_PRESETS: Array<{ id: AutoEditorColorPreset; label: string }> = [
  { id: 'natural', label: 'Tự nhiên' },
  { id: 'cinematic', label: 'Điện ảnh' },
  { id: 'warm', label: 'Ấm' },
  { id: 'cool', label: 'Lạnh' },
  { id: 'contrast', label: 'Tương phản' },
];

const LOGO_POSITIONS: Array<{ id: AutoEditorLogoPosition; label: string }> = [
  { id: 'top-left', label: 'Trên trái' },
  { id: 'top-right', label: 'Trên phải' },
  { id: 'bottom-left', label: 'Dưới trái' },
  { id: 'bottom-right', label: 'Dưới phải' },
];

const OUTPUT_META: Record<AutoEditorOutputStatus, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  planned: { label: 'Chờ render', className: 'border-white/10 bg-white/[.04] text-zinc-400', icon: Clock3 },
  rendering: { label: 'Đang render', className: 'border-cyan-200/25 bg-cyan-200/[.08] text-cyan-100', icon: Loader2 },
  ready: { label: 'Đã xuất', className: 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100', icon: CheckCircle2 },
  failed: { label: 'Lỗi render', className: 'border-rose-200/20 bg-rose-200/[.07] text-rose-100', icon: XCircle },
};

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
};

const fileToDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Không thể đọc tệp nhạc.'));
  reader.readAsDataURL(file);
});

const AutoEditor: React.FC<Props> = ({ project, updateProject, onOpenExport }) => {
  const { showAlert } = useAlert();
  const state = useMemo(() => normalizeAutoEditorState(project.autoEditor, project), [project.autoEditor, project.brandKitSnapshot]);
  const summary = useMemo(() => getAutoEditorSummary(project), [project]);
  const sources = useMemo(() => getAutoEditorSources(project), [project]);
  const logoAssets = project.brandKitSnapshot?.assets.filter((asset) => asset.type === 'logo' && asset.url) || [];
  const musicInputRef = useRef<HTMLInputElement>(null);
  const [renderingId, setRenderingId] = useState<string>();
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderPhase, setRenderPhase] = useState('');
  const [uploadingMusic, setUploadingMusic] = useState(false);

  const patchSettings = (updates: Parameters<typeof updateAutoEditorSettings>[1]) => {
    updateProject((previous) => updateAutoEditorSettings(previous, updates));
  };

  const toggleRatio = (ratio: AspectRatio) => {
    const current = state.settings.aspectRatios;
    const next = current.includes(ratio) ? current.filter((item) => item !== ratio) : [...current, ratio];
    if (!next.length) {
      showAlert('Cần giữ ít nhất một tỷ lệ đầu ra.', { type: 'warning' });
      return;
    }
    patchSettings({ aspectRatios: next });
  };

  const handlePlan = () => {
    try {
      updateProject((previous) => createAutoEditorPlan(previous));
      showAlert('Đã lập timeline, phụ đề và đầu ra. Thao tác này không gọi API.', { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể lập timeline.', { type: 'error' });
    }
  };

  const handleMusicUpload = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      showAlert('Hãy chọn tệp âm thanh hợp lệ.', { type: 'warning' });
      return;
    }
    if (file.size > 40 * 1024 * 1024) {
      showAlert('Tệp nhạc vượt 40 MB. Hãy nén nhạc trước khi tải lên.', { type: 'warning' });
      return;
    }
    setUploadingMusic(true);
    try {
      const musicUrl = await fileToDataUrl(file);
      patchSettings({ musicEnabled: true, musicUrl, musicName: file.name });
      showAlert('Đã thêm nhạc nền. Khi sao lưu cloud, tệp sẽ được chuyển vào kho media.', { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể tải nhạc.', { type: 'error' });
    } finally {
      setUploadingMusic(false);
      if (musicInputRef.current) musicInputRef.current.value = '';
    }
  };

  const handleRender = async (outputId: string) => {
    if (renderingId) return;
    let renderProject: ProjectState;
    try {
      renderProject = startAutoEditorRender(project, outputId);
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Chưa thể render đầu ra.', { type: 'warning' });
      return;
    }
    updateProject(() => renderProject);
    setRenderingId(outputId);
    setRenderProgress(0);
    setRenderPhase('Đang chuẩn bị…');
    try {
      await renderAutoEditorOutputInBrowser(renderProject, outputId, ({ phase, progress }) => {
        setRenderPhase(phase);
        setRenderProgress(progress);
      });
      updateProject((previous) => finishAutoEditorRender(previous, outputId));
      showAlert('Đã render và tải MP4. Chi phí API: $0.', { type: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lỗi render không xác định.';
      updateProject((previous) => failAutoEditorRender(previous, outputId, message));
      showAlert(`Render thất bại: ${message}`, { type: 'error' });
    } finally {
      setRenderingId(undefined);
      setRenderProgress(0);
      setRenderPhase('');
    }
  };

  const handleCancel = () => {
    if (!renderingId) return;
    cancelAutoEditorRender();
    updateProject((previous) => failAutoEditorRender(previous, renderingId, 'Đã hủy render theo yêu cầu.'));
    setRenderingId(undefined);
    setRenderProgress(0);
    setRenderPhase('');
    showAlert('Đã hủy render.', { type: 'info' });
  };

  const handleDownloadSrt = () => {
    try {
      downloadAutoEditorSrt(project);
      showAlert('Đã tải phụ đề tiếng Việt dạng SRT.', { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể tải phụ đề.', { type: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      <section className="eg-panel relative overflow-hidden p-5 md:p-8">
        <div className="pointer-events-none absolute right-0 top-0 h-80 w-80 rounded-full bg-cyan-300/[.08] blur-[110px]" />
        <div className="relative grid gap-6 xl:grid-cols-[1fr_auto] xl:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="eg-chip border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100"><Scissors className="h-3 w-3" /> Dựng tự động</span>
              <span className="eg-chip border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100"><BadgeDollarSign className="h-3 w-3" /> $0 API khi render</span>
              {summary.stale && state.timeline.length > 0 && <span className="eg-chip border-amber-200/20 bg-amber-200/[.07] text-amber-100"><RefreshCw className="h-3 w-3" /> Timeline cần cập nhật</span>}
            </div>
            <h2 className="mt-5 max-w-4xl text-2xl font-semibold tracking-[-.03em] text-white md:text-4xl">Biến media đã duyệt thành video sẵn sàng chạy quảng cáo.</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">Auto Editor ghép clip theo storyboard, căn voice, tạo caption tiếng Việt, ducking nhạc nền, đóng logo và xuất nhiều tỷ lệ ngay trên thiết bị.</p>
          </div>
          <button type="button" onClick={handlePlan} disabled={Boolean(renderingId)} className="eg-button-primary inline-flex min-h-12 min-w-52 items-center justify-center gap-2 px-6 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40">
            <WandSparkles className="h-4 w-4" /> {state.timeline.length ? 'Lập lại timeline' : 'Lập timeline tự động'}
          </button>
        </div>
        <div className="relative mt-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: 'Thời lượng', value: formatDuration(summary.totalDuration), icon: Clock3 },
            { label: 'Clip sẵn sàng', value: `${summary.readyClips}/${state.timeline.length}`, icon: Film },
            { label: 'Caption', value: state.captions.length, icon: Captions },
            { label: 'Đầu ra', value: state.outputs.length, icon: Layers3 },
            { label: 'Chi phí render', value: '$0', icon: BadgeDollarSign },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/[.07] bg-black/20 p-4">
              <div className="flex items-center justify-between gap-2"><span className="font-mono text-[9px] uppercase tracking-[.16em] text-zinc-600">{item.label}</span><item.icon className="h-4 w-4 text-zinc-700" /></div>
              <div className="mt-2 text-xl font-semibold tabular-nums text-white">{item.value}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
        <div className="space-y-5">
          <section className="eg-panel p-5 md:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div><div className="eg-kicker">01 · Nguồn dựng</div><h3 className="mt-1 text-lg font-semibold text-white">Chọn bản cần dựng</h3><p className="mt-1 text-xs leading-5 text-zinc-500">Bản chính hoặc một biến thể đã tạo trong Video Factory.</p></div>
              <span className="eg-chip border-white/10 bg-white/[.03] text-zinc-400">{sources.length} nguồn</span>
            </div>
            <div className="mt-5 grid gap-2 md:grid-cols-2">
              {sources.map((source) => {
                const selected = state.settings.sourceId === source.id;
                return (
                  <button key={source.id} type="button" onClick={() => patchSettings({ sourceId: source.id })} aria-pressed={selected} className={`min-h-24 rounded-2xl border p-4 text-left transition-colors ${selected ? 'border-cyan-200/35 bg-cyan-200/[.08]' : 'border-white/[.07] bg-black/15 hover:border-white/15'}`}>
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-semibold text-white">{source.label}</div><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">{source.detail}</p></div>{selected && <Check className="h-4 w-4 shrink-0 text-cyan-200" />}</div>
                    <div className="mt-3 font-mono text-[9px] uppercase tracking-wider text-zinc-600">{source.readyCount}/{source.shotCount} video sẵn sàng</div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="eg-panel p-5 md:p-6">
            <div><div className="eg-kicker">02 · Định dạng</div><h3 className="mt-1 text-lg font-semibold text-white">Đầu ra đa nền tảng</h3></div>
            <div className="mt-5 grid gap-2 md:grid-cols-3">
              {RATIO_OPTIONS.map((ratio) => {
                const selected = state.settings.aspectRatios.includes(ratio.id);
                return (
                  <button key={ratio.id} type="button" onClick={() => toggleRatio(ratio.id)} aria-pressed={selected} className={`min-h-24 rounded-2xl border p-4 text-left transition-colors ${selected ? 'border-cyan-200/35 bg-cyan-200/[.08]' : 'border-white/[.07] bg-black/15 hover:border-white/15'}`}>
                    <div className="flex items-center justify-between gap-3"><strong className="text-sm text-white">{ratio.label}</strong>{selected && <Check className="h-4 w-4 text-cyan-200" />}</div>
                    <p className="mt-2 text-[10px] leading-4 text-zinc-500">{ratio.detail}</p>
                  </button>
                );
              })}
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Chuyển cảnh</span><select value={state.settings.transition} onChange={(event) => patchSettings({ transition: event.target.value as AutoEditorTransition })} className="eg-input min-h-12 w-full px-4 text-sm"><option value="cut">Hard cut</option><option value="crossfade">Fade mềm</option></select></label>
              <label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Color matching</span><select value={state.settings.colorPreset} onChange={(event) => patchSettings({ colorPreset: event.target.value as AutoEditorColorPreset })} className="eg-input min-h-12 w-full px-4 text-sm">{COLOR_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
            </div>
          </section>

          <section className="eg-panel p-5 md:p-6">
            <div><div className="eg-kicker">03 · Voice & caption</div><h3 className="mt-1 text-lg font-semibold text-white">Âm thanh và phụ đề tiếng Việt</h3></div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <button type="button" onClick={() => patchSettings({ includeVoice: !state.settings.includeVoice })} aria-pressed={state.settings.includeVoice} className={`min-h-24 rounded-2xl border p-4 text-left ${state.settings.includeVoice ? 'border-cyan-200/30 bg-cyan-200/[.07]' : 'border-white/[.07] bg-black/15'}`}>
                <div className="flex items-center justify-between gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[.08] bg-black/20"><AudioLines className="h-4 w-4 text-cyan-100" /></span><span className={`eg-chip ${state.settings.includeVoice ? 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' : 'border-white/10 bg-white/[.03] text-zinc-500'}`}>{state.settings.includeVoice ? 'Bật' : 'Tắt'}</span></div>
                <strong className="mt-4 block text-sm text-white">Căn voice theo shot</strong><p className="mt-1 text-[10px] leading-4 text-zinc-500">Dùng take đã chọn trong Voice Studio và chuẩn hóa loudness.</p>
              </button>
              <button type="button" onClick={() => patchSettings({ captionsEnabled: !state.settings.captionsEnabled })} aria-pressed={state.settings.captionsEnabled} className={`min-h-24 rounded-2xl border p-4 text-left ${state.settings.captionsEnabled ? 'border-cyan-200/30 bg-cyan-200/[.07]' : 'border-white/[.07] bg-black/15'}`}>
                <div className="flex items-center justify-between gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[.08] bg-black/20"><Captions className="h-4 w-4 text-cyan-100" /></span><span className={`eg-chip ${state.settings.captionsEnabled ? 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' : 'border-white/10 bg-white/[.03] text-zinc-500'}`}>{state.settings.captionsEnabled ? 'Bật' : 'Tắt'}</span></div>
                <strong className="mt-4 block text-sm text-white">Auto caption</strong><p className="mt-1 text-[10px] leading-4 text-zinc-500">Chia câu theo nhịp đọc và giữ vùng an toàn nền tảng.</p>
              </button>
            </div>
            {state.settings.captionsEnabled && <div className="mt-4"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Phong cách caption</span><div className="grid grid-cols-3 gap-2">{CAPTION_STYLES.map((style) => <button key={style.id} type="button" onClick={() => patchSettings({ captionStyle: style.id })} aria-pressed={state.settings.captionStyle === style.id} className={`min-h-11 rounded-xl border px-3 text-xs font-semibold ${state.settings.captionStyle === style.id ? 'border-cyan-200/35 bg-cyan-200/[.08] text-cyan-100' : 'border-white/[.07] bg-black/15 text-zinc-500 hover:text-white'}`}>{style.label}</button>)}</div></div>}
          </section>

          <section className="eg-panel p-5 md:p-6">
            <div><div className="eg-kicker">04 · Âm nhạc & thương hiệu</div><h3 className="mt-1 text-lg font-semibold text-white">Ducking, logo và lớp nhận diện</h3></div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/[.07] bg-black/15 p-4">
                <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[.08] bg-white/[.03]"><Music2 className="h-4 w-4 text-cyan-100" /></span><div><strong className="block text-sm text-white">Nhạc nền</strong><span className="text-[10px] text-zinc-600">Tự hạ khi có voice</span></div></div><button type="button" onClick={() => patchSettings({ musicEnabled: !state.settings.musicEnabled })} aria-pressed={state.settings.musicEnabled} className={`min-h-11 rounded-xl border px-4 text-xs font-semibold ${state.settings.musicEnabled ? 'border-cyan-200/30 bg-cyan-200/[.08] text-cyan-100' : 'border-white/[.08] text-zinc-500'}`}>{state.settings.musicEnabled ? 'Đang bật' : 'Đang tắt'}</button></div>
                <input ref={musicInputRef} type="file" accept="audio/*" className="sr-only" onChange={(event) => void handleMusicUpload(event.target.files?.[0])} />
                <button type="button" onClick={() => musicInputRef.current?.click()} disabled={uploadingMusic} className="eg-button-secondary mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-40">{uploadingMusic ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {state.settings.musicName || 'Tải nhạc lên'}</button>
                <label className="mt-4 block"><span className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500"><span>Âm lượng nhạc</span><span>{Math.round(state.settings.musicVolume * 100)}%</span></span><input type="range" min="0" max="0.5" step="0.01" value={state.settings.musicVolume} onChange={(event) => patchSettings({ musicVolume: Number(event.target.value) })} className="mt-3 w-full accent-cyan-200" /></label>
              </div>
              <div className="rounded-2xl border border-white/[.07] bg-black/15 p-4">
                <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[.08] bg-white/[.03]"><Image className="h-4 w-4 text-cyan-100" /></span><div><strong className="block text-sm text-white">Logo Brand Kit</strong><span className="text-[10px] text-zinc-600">Đóng dấu vào mọi đầu ra</span></div></div><button type="button" onClick={() => patchSettings({ logoEnabled: !state.settings.logoEnabled })} aria-pressed={state.settings.logoEnabled} className={`min-h-11 rounded-xl border px-4 text-xs font-semibold ${state.settings.logoEnabled ? 'border-cyan-200/30 bg-cyan-200/[.08] text-cyan-100' : 'border-white/[.08] text-zinc-500'}`}>{state.settings.logoEnabled ? 'Đang bật' : 'Đang tắt'}</button></div>
                <label className="mt-4 block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Logo sử dụng</span><select value={state.settings.logoAssetId || ''} onChange={(event) => patchSettings({ logoAssetId: event.target.value || undefined })} className="eg-input min-h-11 w-full px-3 text-xs"><option value="">Tự chọn logo đầu tiên</option>{logoAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
                <label className="mt-3 block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Vị trí</span><select value={state.settings.logoPosition} onChange={(event) => patchSettings({ logoPosition: event.target.value as AutoEditorLogoPosition })} className="eg-input min-h-11 w-full px-3 text-xs">{LOGO_POSITIONS.map((position) => <option key={position.id} value={position.id}>{position.label}</option>)}</select></label>
              </div>
            </div>
          </section>

          <section className="eg-panel overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-white/[.07] p-5 md:flex-row md:items-end md:justify-between md:p-6"><div><div className="eg-kicker">Timeline</div><h3 className="mt-1 text-lg font-semibold text-white">Nhịp dựng theo storyboard</h3></div>{state.captions.length > 0 && <button type="button" onClick={handleDownloadSrt} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold"><Download className="h-4 w-4" /> Tải SRT</button>}</div>
            {state.timeline.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center"><Clapperboard className="h-10 w-10 text-zinc-700" /><h4 className="mt-4 text-sm font-semibold text-zinc-300">Timeline chưa được lập</h4><p className="mt-2 max-w-md text-xs leading-5 text-zinc-600">Chọn nguồn và định dạng, sau đó nhấn “Lập timeline tự động”.</p></div>
            ) : (
              <div className="divide-y divide-white/[.06]">
                {state.timeline.map((clip, index) => (
                  <div key={clip.id} className="grid gap-3 p-4 md:grid-cols-[48px_84px_1fr_auto] md:items-center md:px-6">
                    <span className="font-mono text-[10px] text-zinc-600">{String(index + 1).padStart(2, '0')}</span>
                    <div className="relative aspect-video overflow-hidden rounded-xl border border-white/[.08] bg-black/30">{clip.videoUrl ? <video src={clip.videoUrl} className="h-full w-full object-cover" muted preload="metadata" /> : <div className="flex h-full items-center justify-center"><Film className="h-4 w-4 text-zinc-700" /></div>}<span className={`absolute bottom-1 right-1 h-2 w-2 rounded-full ${clip.videoUrl ? 'bg-emerald-300' : 'bg-rose-300'}`} /></div>
                    <div className="min-w-0"><div className="truncate text-xs font-semibold text-zinc-200">{project.shots.find((shot) => shot.id === clip.shotId)?.actionSummary || `Cảnh ${index + 1}`}</div><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-600">{clip.dialogue || 'Không có thoại'}</p></div>
                    <div className="flex items-center gap-2 md:justify-end"><span className={`eg-chip ${clip.voiceTakeId ? 'border-cyan-200/20 bg-cyan-200/[.06] text-cyan-100' : 'border-white/10 bg-white/[.03] text-zinc-600'}`}><AudioLines className="h-3 w-3" /> {clip.voiceTakeId ? 'Voice' : 'Silent'}</span><span className="font-mono text-[10px] tabular-nums text-zinc-500">{clip.offset.toFixed(1)}s → {(clip.offset + clip.duration).toFixed(1)}s</span></div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-5">
          <section className="eg-panel p-5">
            <div className="flex items-center justify-between gap-3"><div><div className="eg-kicker">Preflight</div><h3 className="mt-1 text-base font-semibold text-white">Kiểm tra đầu vào</h3></div><ShieldCheck className="h-5 w-5 text-cyan-200/70" /></div>
            <div className="mt-4 flex gap-2"><span className={`eg-chip ${summary.blocked ? 'border-rose-200/20 bg-rose-200/[.07] text-rose-100' : 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100'}`}>{summary.blocked ? <XCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}{summary.blocked} lỗi chặn</span><span className="eg-chip border-amber-200/20 bg-amber-200/[.07] text-amber-100"><AlertTriangle className="h-3 w-3" /> {summary.warnings} cảnh báo</span></div>
            <div className="mt-4 space-y-2">
              {summary.issues.length === 0 ? <div className="rounded-2xl border border-emerald-200/15 bg-emerald-200/[.05] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-emerald-100"><CheckCircle2 className="h-4 w-4" /> Sẵn sàng render</div><p className="mt-2 text-[10px] leading-4 text-emerald-100/60">Không phát hiện lỗi chặn trong timeline hiện tại.</p></div> : summary.issues.slice(0, 8).map((issue) => <div key={issue.id} className={`rounded-xl border p-3 ${issue.severity === 'blocked' ? 'border-rose-200/15 bg-rose-200/[.05]' : 'border-amber-200/15 bg-amber-200/[.05]'}`}><div className={`flex items-center gap-2 text-[11px] font-semibold ${issue.severity === 'blocked' ? 'text-rose-100' : 'text-amber-100'}`}><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {issue.label}</div><p className="mt-1 text-[10px] leading-4 text-zinc-600">{issue.detail}</p></div>)}
              {summary.issues.length > 8 && <p className="text-center text-[10px] text-zinc-600">Còn {summary.issues.length - 8} mục khác</p>}
            </div>
          </section>

          <section className="eg-panel p-5">
            <div className="flex items-center justify-between gap-3"><div><div className="eg-kicker">Render queue</div><h3 className="mt-1 text-base font-semibold text-white">Master & biến thể</h3></div><Sparkles className="h-5 w-5 text-amber-200/70" /></div>
            <div className="mt-4 space-y-3">
              {state.outputs.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-xs leading-5 text-zinc-600">Lập timeline để tạo danh sách đầu ra.</div> : state.outputs.map((output) => {
                const meta = OUTPUT_META[output.status];
                const StatusIcon = meta.icon;
                const active = renderingId === output.id;
                return (
                  <article key={output.id} className="rounded-2xl border border-white/[.07] bg-black/15 p-4">
                    <div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold text-white">{output.name}</h4><p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-zinc-600">{output.fileName}</p></div><span className={`eg-chip ${meta.className}`}><StatusIcon className={`h-3 w-3 ${active ? 'animate-spin' : ''}`} /> {meta.label}</span></div>
                    <div className="mt-4 flex items-center justify-between text-[10px] text-zinc-500"><span>Ước tính {output.estimatedRenderMinutes} phút</span><strong className="text-emerald-200">$0 API</strong></div>
                    {active && <div className="mt-4" aria-live="polite"><div className="flex items-center justify-between gap-3 text-[10px] text-cyan-100"><span className="truncate">{renderPhase}</span><span className="font-mono tabular-nums">{renderProgress}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-cyan-200 transition-[width] duration-300" style={{ width: `${renderProgress}%` }} /></div></div>}
                    {output.error && output.status === 'failed' && <p role="alert" className="mt-3 text-[10px] leading-4 text-rose-200/70">{output.error}</p>}
                    <button type="button" onClick={active ? handleCancel : () => void handleRender(output.id)} disabled={Boolean(renderingId && !active) || summary.stale || summary.blocked > 0} className={`mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${active ? 'border-rose-200/25 bg-rose-200/[.07] text-rose-100' : 'border-cyan-200/30 bg-cyan-200/[.09] text-cyan-50 hover:bg-cyan-200/[.14]'}`}>{active ? <><Pause className="h-4 w-4" /> Hủy render</> : <><Play className="h-4 w-4 fill-current" /> Render MP4</>}</button>
                  </article>
                );
              })}
            </div>
            {(summary.stale || summary.blocked > 0) && <p className="mt-4 text-[10px] leading-4 text-amber-100/65">{summary.stale ? 'Hãy lập lại timeline sau khi thay đổi cấu hình hoặc media.' : 'Xử lý lỗi chặn trong Preflight trước khi render.'}</p>}
          </section>

          <section className="rounded-3xl border border-cyan-200/15 bg-cyan-200/[.05] p-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-50"><BadgeDollarSign className="h-4 w-4" /> Cam kết kiểm soát chi phí</div>
            <p className="mt-3 text-[10px] leading-5 text-cyan-50/60">Lập timeline và render đều chạy cục bộ. Auto Editor không gọi model ảnh, video, voice hay Vision. Chỉ media đã có sẵn được sử dụng.</p>
            <button type="button" onClick={onOpenExport} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-cyan-200/20 bg-black/15 px-4 text-xs font-semibold text-cyan-100 hover:bg-black/25">Mở khu vực Xuất bản <ChevronRight className="h-4 w-4" /></button>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default AutoEditor;
