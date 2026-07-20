import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AudioLines,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  CircleDollarSign,
  Cloud,
  Cpu,
  Download,
  Gauge,
  KeyRound,
  Loader2,
  MessageSquareText,
  PlayCircle,
  RefreshCw,
  Route,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { CoreStage, ProjectState, VoiceStudioState } from '../types';
import { ModelType } from '../types/model';
import GlobalSettings from './ModelConfig/GlobalSettings';
import { getModels } from '../services/modelRegistry';
import { getModelRoutingPolicy, ModelRoutingPolicy, saveModelRoutingPolicy } from '../services/modelRoutingService';
import { getUsagePolicy, getUsageSummary, saveUsagePolicy, UsagePolicy } from '../services/usageService';
import { deleteAccountData, exportAccountData, getAccountOverview, AccountOverview, AccountProfile, saveAccountProfile } from '../services/accountService';
import { runWorkflowDiagnostics, WorkflowDiagnosticReport } from '../services/workflowDiagnosticsService';
import { VOICE_PROVIDERS, isVoiceProviderConfigured } from '../services/voiceRegistry';
import { createDefaultVoiceStudioState } from '../services/storageService';
import {
  ApprovalStatus,
  createReviewNote,
  getReviewWorkspace,
  ReviewWorkspace,
  saveStageApproval,
  setReviewNoteStatus,
} from '../services/reviewService';
import { getCredentialVaultStatus } from '../services/credentialVault';

type TabId = 'api' | 'voice' | 'workflow' | 'review' | 'workspace';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  project?: ProjectState | null;
  updateProject?: (updates: Partial<ProjectState> | ((previous: ProjectState) => ProjectState)) => void;
  onOpenModelCatalog?: () => void;
  onOpenVoiceStudio?: () => void;
  onCreateDemo?: () => void;
}

const TAB_META = [
  { id: 'api' as const, label: 'API & định tuyến', icon: KeyRound },
  { id: 'voice' as const, label: 'Voice tiếng Việt', icon: AudioLines },
  { id: 'workflow' as const, label: 'Kiểm thử workflow', icon: Activity },
  { id: 'review' as const, label: 'Duyệt & bàn giao', icon: ClipboardCheck },
  { id: 'workspace' as const, label: 'Workspace & hạn mức', icon: Gauge },
];

const TYPE_LABELS: Record<ModelType, string> = { chat: 'Kịch bản', image: 'Hình ảnh', video: 'Video' };
const REVIEW_STAGE_LABELS: Record<CoreStage, string> = { script: 'Kịch bản', assets: 'Tài nguyên', voice: 'Giọng thoại', director: 'Dựng cảnh', export: 'Xuất bản' };

const statusTone = (status: 'pass' | 'warning' | 'fail') => status === 'pass'
  ? 'border-emerald-300/20 bg-emerald-300/[.06] text-emerald-100'
  : status === 'warning'
    ? 'border-amber-300/20 bg-amber-300/[.06] text-amber-100'
    : 'border-rose-300/20 bg-rose-300/[.06] text-rose-100';

const OperationsHub: React.FC<Props> = ({
  isOpen,
  onClose,
  project,
  updateProject,
  onOpenModelCatalog,
  onOpenVoiceStudio,
  onCreateDemo,
}) => {
  const [tab, setTab] = useState<TabId>('api');
  const [routing, setRouting] = useState<ModelRoutingPolicy>(() => getModelRoutingPolicy());
  const [usagePolicy, setUsagePolicy] = useState<UsagePolicy>(() => getUsagePolicy());
  const [report, setReport] = useState<WorkflowDiagnosticReport>(() => runWorkflowDiagnostics(project || undefined));
  const [account, setAccount] = useState<AccountOverview | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [review, setReview] = useState<ReviewWorkspace>({ notes: [], approvals: [], hosted: false });
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewStage, setReviewStage] = useState<CoreStage>('script');
  const [reviewShotId, setReviewShotId] = useState('');
  const [reviewBody, setReviewBody] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [dataActionBusy, setDataActionBusy] = useState(false);
  const [, forceRefresh] = useState(0);

  const usage = useMemo(() => getUsageSummary(project?.id), [project?.id, isOpen, tab, savedMessage]);
  const modelsByType = useMemo(() => Object.fromEntries(
    (['chat', 'image', 'video'] as ModelType[]).map((type) => [type, getModels(type).filter((model) => model.isEnabled)]),
  ) as Record<ModelType, ReturnType<typeof getModels>>, [isOpen, tab]);

  useEffect(() => {
    if (!isOpen) return;
    setRouting(getModelRoutingPolicy());
    setUsagePolicy(getUsagePolicy());
    setReport(runWorkflowDiagnostics(project || undefined));
    setSavedMessage('');
  }, [isOpen, project?.id]);

  useEffect(() => {
    if (!isOpen || tab !== 'workspace') return;
    setLoadingAccount(true);
    getAccountOverview()
      .then((overview) => { setAccount(overview); setProfile(overview.profile); })
      .finally(() => setLoadingAccount(false));
  }, [isOpen, tab]);

  useEffect(() => {
    if (!isOpen || tab !== 'review' || !project) return;
    setReviewLoading(true);
    getReviewWorkspace(project.id).then(setReview).finally(() => setReviewLoading(false));
  }, [isOpen, tab, project?.id]);

  if (!isOpen) return null;

  const updateFallback = (type: ModelType, index: number, modelId: string) => {
    const next = [...routing.fallbackModelIds[type]];
    next[index] = modelId;
    setRouting({ ...routing, fallbackModelIds: { ...routing.fallbackModelIds, [type]: next.filter(Boolean) } });
    setSavedMessage('');
  };

  const saveRouting = () => {
    saveModelRoutingPolicy(routing);
    setSavedMessage('Đã lưu chính sách định tuyến.');
    setReport(runWorkflowDiagnostics(project || undefined));
  };

  const studio: VoiceStudioState = project?.voiceStudio || createDefaultVoiceStudioState();
  const configuredVoiceProviders = VOICE_PROVIDERS.filter((provider) => isVoiceProviderConfigured(provider.id)).length;

  const saveWorkspace = async () => {
    if (!profile) return;
    setSavingAccount(true);
    setSavedMessage('');
    try {
      const nextPolicy = { ...usagePolicy, monthlyUnitLimit: profile.monthlyUnitLimit };
      saveUsagePolicy(nextPolicy);
      setUsagePolicy(nextPolicy);
      const saved = await saveAccountProfile(profile);
      setProfile(saved);
      setSavedMessage('Đã lưu hồ sơ, hạn mức và cảnh báo vận hành.');
    } catch (error) {
      setSavedMessage(error instanceof Error ? error.message : 'Không thể lưu workspace.');
    } finally {
      setSavingAccount(false);
    }
  };

  const submitReviewNote = async () => {
    if (!project || !reviewBody.trim()) return;
    setReviewBusy(true);
    try {
      const note = await createReviewNote(project.id, { stage: reviewStage, shotId: reviewShotId || undefined, body: reviewBody.trim() });
      setReview((current) => ({ ...current, hosted: true, notes: [note, ...current.notes] }));
      setReviewBody('');
      setSavedMessage('Đã thêm ghi chú vào sổ duyệt production.');
    } catch (error) {
      setSavedMessage(error instanceof Error ? error.message : 'Không thể thêm ghi chú duyệt.');
    } finally {
      setReviewBusy(false);
    }
  };

  const updateApproval = async (stage: CoreStage, status: ApprovalStatus) => {
    if (!project) return;
    setReviewBusy(true);
    try {
      const approval = await saveStageApproval(project.id, { stage, status });
      setReview((current) => ({ ...current, approvals: [approval, ...current.approvals.filter((item) => item.stage !== stage)] }));
      setSavedMessage(`Đã cập nhật trạng thái ${REVIEW_STAGE_LABELS[stage].toLowerCase()}.`);
    } catch (error) {
      setSavedMessage(error instanceof Error ? error.message : 'Không thể lưu trạng thái duyệt.');
    } finally {
      setReviewBusy(false);
    }
  };

  const toggleReviewNote = async (id: string, status: 'open' | 'resolved') => {
    if (!project) return;
    await setReviewNoteStatus(project.id, id, status);
    setReview((current) => ({ ...current, notes: current.notes.map((note) => note.id === id ? { ...note, status, updatedAt: Date.now() } : note) }));
  };

  const exportWorkspaceData = async () => {
    setDataActionBusy(true);
    try {
      await exportAccountData();
      setSavedMessage('Đã tạo gói xuất dữ liệu workspace.');
    } catch (error) {
      setSavedMessage(error instanceof Error ? error.message : 'Không thể xuất dữ liệu workspace.');
    } finally {
      setDataActionBusy(false);
    }
  };

  const removeWorkspaceData = async () => {
    if (deleteConfirm !== 'XÓA DỮ LIỆU') return;
    setDataActionBusy(true);
    try {
      await deleteAccountData();
      setDeleteConfirm('');
      setSavedMessage('Đã xóa dữ liệu cloud của tài khoản. Dự án cục bộ trên thiết bị không bị ảnh hưởng.');
      setAccount(null);
    } catch (error) {
      setSavedMessage(error instanceof Error ? error.message : 'Không thể xóa dữ liệu cloud.');
    } finally {
      setDataActionBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/75 p-3 backdrop-blur-xl" role="dialog" aria-modal="true" aria-labelledby="operations-title">
      <div className="eg-panel flex h-[min(92vh,940px)] w-full max-w-[1480px] overflow-hidden">
        <aside className="hidden w-72 shrink-0 border-r eg-divider bg-black/15 p-4 lg:flex lg:flex-col">
          <div className="px-3 pb-6 pt-2">
            <div className="eg-kicker">Phòng điều hành Egoric</div>
            <h2 id="operations-title" className="mt-2 text-xl font-semibold text-white">Trung tâm vận hành</h2>
            <p className="mt-2 text-xs leading-5 text-zinc-600">Kết nối, kiểm thử, ngân sách và trạng thái production trong một nơi.</p>
          </div>
          <nav className="space-y-2" aria-label="Nhóm cài đặt vận hành">
            {TAB_META.map((item) => (
              <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left transition-colors ${tab === item.id ? 'border-cyan-200/30 bg-cyan-200/[.09] text-white' : 'border-transparent text-zinc-500 hover:border-white/[.08] hover:bg-white/[.035] hover:text-white'}`}>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[.08] bg-black/20"><item.icon className="h-4 w-4" /></span>
                <span className="text-xs font-semibold">{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="mt-auto rounded-2xl border border-white/[.08] bg-white/[.025] p-4">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-600"><span>Tháng này</span><span className="font-mono">{usage.percent}%</span></div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-cyan-200" style={{ width: `${usage.percent}%` }} /></div>
            <p className="mt-3 text-[11px] text-zinc-500">{usage.units}/{usage.limit} đơn vị · ~${usage.estimatedCostUsd.toFixed(2)}</p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-start justify-between gap-4 border-b eg-divider px-5 py-5 md:px-7">
            <div>
              <div className="eg-kicker">{TAB_META.find((item) => item.id === tab)?.label}</div>
              <h2 className="mt-1 text-xl font-semibold text-white">{tab === 'api' ? 'Tuyến AI không phụ thuộc một cổng' : tab === 'voice' ? 'Voice tiếng Việt nhất quán' : tab === 'workflow' ? 'Chẩn đoán trước khi phát sinh phí' : tab === 'review' ? 'Sổ duyệt và bàn giao production' : 'Workspace sẵn sàng vận hành'}</h2>
            </div>
            <button type="button" onClick={onClose} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center" aria-label="Đóng Trung tâm vận hành"><X className="h-4 w-4" /></button>
          </header>

          <div className="border-b eg-divider p-3 lg:hidden">
            <select value={tab} onChange={(event) => setTab(event.target.value as TabId)} className="eg-input px-3 text-sm" aria-label="Chọn nhóm vận hành">
              {TAB_META.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>

          <div className="eg-safe-scroll flex-1 overflow-y-auto p-5 md:p-7">
            {tab === 'api' && (
              <div className="space-y-7">
                <section className="eg-panel p-5 md:p-6">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-3"><Route className="mt-0.5 h-5 w-5 text-cyan-200" /><div><h3 className="text-sm font-semibold text-white">Fallback tự động</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">Nếu model chính lỗi mạng, hết hạn mức hoặc nhà cung cấp gián đoạn, app thử tuyến kế tiếp đã có khóa.</p></div></div>
                    <label className="flex min-h-11 items-center gap-3 rounded-xl border border-white/[.08] px-3 text-xs text-zinc-300"><input type="checkbox" checked={routing.enabled} onChange={(event) => setRouting({ ...routing, enabled: event.target.checked })} className="accent-cyan-200" /> Bật định tuyến dự phòng</label>
                  </div>
                  <div className="mt-5 grid gap-4 xl:grid-cols-3">
                    {(Object.keys(TYPE_LABELS) as ModelType[]).map((type) => (
                      <div key={type} className="rounded-2xl border border-white/[.08] bg-black/15 p-4">
                        <div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold text-white">{TYPE_LABELS[type]}</span><span className="font-mono text-[9px] text-zinc-700">2 TUYẾN</span></div>
                        {[0, 1].map((index) => <label key={index} className="mb-3 block text-[10px] uppercase tracking-wider text-zinc-600">Tuyến {index + 1}<select value={routing.fallbackModelIds[type][index] || ''} onChange={(event) => updateFallback(type, index, event.target.value)} className="eg-input mt-2 px-3 text-xs normal-case tracking-normal"><option value="">Không dùng</option>{modelsByType[type].map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>)}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><label className="text-xs text-zinc-500">Số tuyến tối đa <input type="number" min="1" max="5" value={routing.maxAttempts} onChange={(event) => setRouting({ ...routing, maxAttempts: Math.max(1, Math.min(5, Number(event.target.value) || 1)) })} className="ml-2 h-11 w-20 rounded-xl border border-white/[.08] bg-black/20 px-3 font-mono text-white" /></label><button type="button" onClick={saveRouting} className="eg-button-primary inline-flex items-center justify-center gap-2 px-5 text-xs font-bold"><Save className="h-4 w-4" /> Lưu định tuyến</button></div>
                </section>

                <GlobalSettings onRefresh={() => forceRefresh((value) => value + 1)} />
                {onOpenModelCatalog && <button type="button" onClick={onOpenModelCatalog} className="eg-button-secondary inline-flex items-center gap-2 px-5 text-xs font-semibold"><Cpu className="h-4 w-4" /> Mở danh mục và tham số model</button>}
              </div>
            )}

            {tab === 'voice' && (
              <div className="space-y-6">
                <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {VOICE_PROVIDERS.map((provider) => {
                    const ready = isVoiceProviderConfigured(provider.id);
                    return <div key={provider.id} className={`rounded-2xl border p-4 ${ready ? 'border-emerald-300/15 bg-emerald-300/[.045]' : 'border-white/[.08] bg-white/[.025]'}`}><div className="flex items-center justify-between"><AudioLines className={`h-4 w-4 ${ready ? 'text-emerald-200' : 'text-zinc-700'}`} />{ready ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertCircle className="h-4 w-4 text-zinc-700" />}</div><h3 className="mt-4 text-xs font-semibold text-white">{provider.shortName}</h3><p className="mt-1 text-[10px] text-zinc-600">{provider.id === 'human' ? 'Bản thu thật' : ready ? 'Đã cấu hình' : 'Chưa có khóa'}</p></div>;
                  })}
                </section>
                <section className="eg-panel p-5 md:p-6">
                  <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-cyan-200" /><div><h3 className="text-sm font-semibold text-white">Chống đọc sai và đổi giọng</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-500">Mỗi nhân vật giữ Voice ID ElevenLabs, sắc thái và preset riêng. Hash từng câu giúp app chỉ tạo lại câu có nội dung hoặc preset thay đổi.</p></div></div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="eg-card p-4"><div className="font-mono text-2xl text-white">{configuredVoiceProviders}/{VOICE_PROVIDERS.length}</div><p className="mt-1 text-[11px] text-zinc-600">Nguồn giọng sẵn sàng</p></div><div className="eg-card p-4"><div className="font-mono text-2xl text-white">{studio.profiles.length}</div><p className="mt-1 text-[11px] text-zinc-600">Hồ sơ casting</p></div><div className="eg-card p-4"><div className="font-mono text-2xl text-white">{studio.pronunciationDictionary.length}</div><p className="mt-1 text-[11px] text-zinc-600">Quy tắc phát âm</p></div></div>
                  {project && updateProject && <label className="mt-5 block text-xs font-semibold text-zinc-300">Câu thử giọng<input value={studio.previewText} onChange={(event) => updateProject((previous) => ({ ...previous, voiceStudio: { ...(previous.voiceStudio || createDefaultVoiceStudioState()), previewText: event.target.value } }))} className="eg-input mt-2 px-4 text-sm" placeholder="Nhập câu thử giọng tiếng Việt" /></label>}
                  <div className="mt-5 flex flex-wrap gap-3">{onOpenVoiceStudio && <button type="button" onClick={onOpenVoiceStudio} className="eg-button-primary inline-flex items-center gap-2 px-5 text-xs font-bold"><PlayCircle className="h-4 w-4" /> Mở Xưởng giọng Việt</button>}<p className="flex items-center text-[11px] text-zinc-600">Muốn giọng hoàn toàn tự nhiên: chọn “Diễn viên lồng tiếng” và nhập từng bản thu người thật.</p></div>
                </section>
              </div>
            )}

            {tab === 'workflow' && (
              <div className="space-y-6">
                <section className="eg-panel p-5 md:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-end gap-3"><span className="font-mono text-4xl font-semibold text-white">{report.score}</span><span className="pb-1 text-xs text-zinc-600">/100 điểm sẵn sàng</span></div><p className="mt-2 text-xs text-zinc-500">{report.summary}</p></div><button type="button" onClick={() => setReport(runWorkflowDiagnostics(project || undefined))} className="eg-button-primary inline-flex items-center justify-center gap-2 px-5 text-xs font-bold"><RefreshCw className="h-4 w-4" /> Chạy lại chẩn đoán</button></div></section>
                <div className="grid gap-3 xl:grid-cols-2">{report.items.map((item) => <article key={item.id} className={`rounded-2xl border p-4 ${statusTone(item.status)}`}><div className="flex items-start gap-3">{item.status === 'pass' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}<div><h3 className="text-xs font-semibold">{item.label}</h3><p className="mt-1 text-[11px] leading-5 opacity-70">{item.detail}</p>{item.action && <p className="mt-2 text-[10px] font-semibold">Gợi ý: {item.action}</p>}</div></div></article>)}</div>
                {!project && onCreateDemo && <section className="rounded-3xl border border-cyan-200/20 bg-cyan-200/[.055] p-6"><Sparkles className="h-5 w-5 text-cyan-200" /><h3 className="mt-4 text-base font-semibold text-white">Dùng dự án demo production</h3><p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-500">Demo Mưa Neon có sẵn nhân vật, bối cảnh, cảnh quay và lời thoại để kiểm tra từ API đến gói xuất mà không phải viết kịch bản từ đầu.</p><button type="button" onClick={onCreateDemo} className="eg-button-primary mt-5 inline-flex items-center gap-2 px-5 text-xs font-bold"><PlayCircle className="h-4 w-4" /> Tạo và mở demo</button></section>}
              </div>
            )}

            {tab === 'review' && (
              !project ? <div className="eg-panel flex min-h-72 flex-col items-center justify-center p-8 text-center"><ClipboardCheck className="h-9 w-9 text-zinc-700" /><h3 className="mt-4 text-sm font-semibold text-white">Mở một dự án để bắt đầu duyệt</h3><p className="mt-2 max-w-md text-xs leading-5 text-zinc-500">Trạng thái từng công đoạn và ghi chú theo cảnh sẽ được lưu trong workspace.</p></div> : reviewLoading ? <div className="flex min-h-72 items-center justify-center gap-3 text-xs text-zinc-500"><Loader2 className="h-5 w-5 animate-spin text-cyan-200" /> Đang tải sổ duyệt…</div> : (
                <div className="space-y-6">
                  <section className="grid gap-3 md:grid-cols-5">
                    {(Object.keys(REVIEW_STAGE_LABELS) as CoreStage[]).map((stage) => {
                      const approval = review.approvals.find((item) => item.stage === stage);
                      const status = approval?.status || 'pending';
                      return <article key={stage} className={`rounded-2xl border p-4 ${status === 'approved' ? 'border-emerald-300/15 bg-emerald-300/[.04]' : status === 'changes-requested' ? 'border-amber-300/15 bg-amber-300/[.04]' : 'border-white/[.08] bg-white/[.025]'}`}><div className="flex items-center justify-between"><span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">{REVIEW_STAGE_LABELS[stage]}</span>{status === 'approved' ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <ClipboardCheck className="h-4 w-4 text-zinc-700" />}</div><p className="mt-4 text-xs font-semibold text-white">{status === 'approved' ? 'Đã duyệt' : status === 'changes-requested' ? 'Cần chỉnh sửa' : 'Chờ duyệt'}</p><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={reviewBusy} onClick={() => void updateApproval(stage, 'changes-requested')} className="min-h-11 rounded-xl border border-white/[.08] px-2 text-[10px] font-semibold text-zinc-400 hover:text-amber-100">Yêu cầu sửa</button><button type="button" disabled={reviewBusy} onClick={() => void updateApproval(stage, 'approved')} className="min-h-11 rounded-xl border border-emerald-300/15 bg-emerald-300/[.05] px-2 text-[10px] font-semibold text-emerald-100">Phê duyệt</button></div></article>;
                    })}
                  </section>

                  <section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
                    <div className="eg-panel p-5 md:p-6"><div className="flex items-start gap-3"><MessageSquareText className="mt-0.5 h-5 w-5 text-cyan-200" /><div><h3 className="text-sm font-semibold text-white">Thêm ghi chú duyệt</h3><p className="mt-1 text-[11px] leading-5 text-zinc-500">Gắn phản hồi vào công đoạn hoặc một cảnh cụ thể.</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Công đoạn<select value={reviewStage} onChange={(event) => setReviewStage(event.target.value as CoreStage)} className="eg-input mt-2 px-3 text-xs normal-case tracking-normal">{(Object.keys(REVIEW_STAGE_LABELS) as CoreStage[]).map((stage) => <option key={stage} value={stage}>{REVIEW_STAGE_LABELS[stage]}</option>)}</select></label><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Cảnh liên quan<select value={reviewShotId} onChange={(event) => setReviewShotId(event.target.value)} className="eg-input mt-2 px-3 text-xs normal-case tracking-normal"><option value="">Toàn công đoạn</option>{project.shots.map((shot, index) => <option key={shot.id} value={shot.id}>Cảnh {index + 1} · {shot.actionSummary.slice(0, 48)}</option>)}</select></label></div><label className="mt-4 block text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Nội dung<textarea value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} rows={5} maxLength={2000} className="eg-input mt-2 min-h-28 resize-y px-4 py-3 text-sm font-normal normal-case tracking-normal" placeholder="Ví dụ: giảm nhịp máy ở cảnh 04 và giữ tiếng mưa xuyên suốt…" /></label><button type="button" onClick={() => void submitReviewNote()} disabled={reviewBusy || !reviewBody.trim() || !review.hosted} className="eg-button-primary mt-4 inline-flex w-full items-center justify-center gap-2 px-5 text-xs font-bold">{reviewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Gửi vào sổ duyệt</button>{!review.hosted && <p className="mt-3 text-[10px] leading-4 text-amber-100/70">Sổ duyệt cloud hoạt động trên bản Sites đã đăng nhập.</p>}</div>

                    <div className="eg-panel overflow-hidden"><div className="border-b eg-divider px-5 py-4"><div className="eg-kicker">Phản hồi gần đây</div><h3 className="mt-1 text-sm font-semibold text-white">{review.notes.filter((note) => note.status === 'open').length} ghi chú đang mở</h3></div><div className="max-h-[520px] divide-y divide-white/[.06] overflow-y-auto">{review.notes.map((note) => { const shotIndex = note.shotId ? project.shots.findIndex((shot) => shot.id === note.shotId) : -1; return <article key={note.id} className={`p-5 ${note.status === 'resolved' ? 'opacity-55' : ''}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="eg-chip border-white/[.08] bg-white/[.035] text-zinc-400">{REVIEW_STAGE_LABELS[note.stage]}{shotIndex >= 0 ? ` · Cảnh ${shotIndex + 1}` : ''}</span><span className="font-mono text-[9px] text-zinc-700">{new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(note.updatedAt)}</span></div><p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-zinc-300">{note.body}</p><button type="button" onClick={() => void toggleReviewNote(note.id, note.status === 'open' ? 'resolved' : 'open')} className="mt-3 min-h-11 text-[10px] font-semibold text-cyan-200 hover:text-cyan-100">{note.status === 'open' ? 'Đánh dấu đã xử lý' : 'Mở lại ghi chú'}</button></article>; })}{!review.notes.length && <div className="flex min-h-52 flex-col items-center justify-center p-8 text-center"><MessageSquareText className="h-8 w-8 text-zinc-700" /><p className="mt-3 text-xs text-zinc-600">Chưa có phản hồi trong dự án này.</p></div>}</div></div>
                  </section>
                </div>
              )
            )}

            {tab === 'workspace' && (
              loadingAccount || !profile ? <div className="flex min-h-72 items-center justify-center gap-3 text-xs text-zinc-500"><Loader2 className="h-5 w-5 animate-spin text-cyan-200" /> Đang tải workspace…</div> : (
                <div className="space-y-6">
                  <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
                    { label: 'Gói hiện tại', value: profile.plan, icon: UserRound },
                    { label: 'Đơn vị tháng', value: `${account?.monthlyUnits ?? usage.units}/${profile.monthlyUnitLimit}`, icon: Gauge },
                    { label: 'Chi phí nội bộ', value: `$${Number(account?.estimatedCostUsd ?? usage.estimatedCostUsd).toFixed(2)}`, icon: CircleDollarSign },
                    { label: 'Lưu trữ', value: account?.hosted ? 'Cloud D1/R2' : 'Thiết bị', icon: Cloud },
                  ].map((item) => <div key={item.label} className="eg-card p-4"><item.icon className="h-4 w-4 text-cyan-200" /><div className="mt-4 font-mono text-lg font-semibold text-white">{item.value}</div><p className="mt-1 text-[11px] text-zinc-600">{item.label}</p></div>)}</section>
                  <section className="eg-panel p-5 md:p-6"><div className="grid gap-5 md:grid-cols-2"><label className="text-xs font-semibold text-zinc-300">Tên hiển thị<input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} className="eg-input mt-2 px-4 text-sm" /></label><label className="text-xs font-semibold text-zinc-300">Tên studio<input value={profile.studioName} onChange={(event) => setProfile({ ...profile, studioName: event.target.value })} className="eg-input mt-2 px-4 text-sm" /></label><label className="text-xs font-semibold text-zinc-300">Hạn mức đơn vị/tháng<input type="number" min="10" max="1000000" value={profile.monthlyUnitLimit} onChange={(event) => setProfile({ ...profile, monthlyUnitLimit: Math.max(10, Number(event.target.value) || 10) })} className="eg-input mt-2 px-4 font-mono text-sm" /></label><label className="text-xs font-semibold text-zinc-300">Cảnh báo khi dùng (%)<input type="number" min="10" max="100" value={usagePolicy.warnAtPercent} onChange={(event) => setUsagePolicy({ ...usagePolicy, warnAtPercent: Math.max(10, Math.min(100, Number(event.target.value) || 80)) })} className="eg-input mt-2 px-4 font-mono text-sm" /></label></div><label className="mt-5 flex min-h-11 items-center gap-3 rounded-xl border border-white/[.08] px-4 text-xs text-zinc-400"><input type="checkbox" checked={usagePolicy.enforceLimit} onChange={(event) => setUsagePolicy({ ...usagePolicy, enforceLimit: event.target.checked })} className="accent-cyan-200" /> Chặn tác vụ mới khi chạm hạn mức</label><div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-[11px] text-zinc-600">Chi phí là ước tính nội bộ có thể chỉnh theo hợp đồng từng nhà cung cấp.</p><button type="button" onClick={() => void saveWorkspace()} disabled={savingAccount} className="eg-button-primary inline-flex items-center justify-center gap-2 px-5 text-xs font-bold">{savingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Lưu workspace</button></div></section>
                  <section className="eg-panel p-5 md:p-6"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-cyan-200" /><div><div className="eg-kicker">Quyền dữ liệu</div><h3 className="mt-1 text-sm font-semibold text-white">Xuất hoặc xóa dữ liệu cloud</h3><p className="mt-2 max-w-3xl text-[11px] leading-5 text-zinc-500">Gói xuất gồm dự án, lịch sử tác vụ, usage, media metadata và sổ duyệt; tuyệt đối không chứa khóa API. Xóa cloud không đụng đến dự án cục bộ trong trình duyệt này.</p></div></div><div className="mt-5 grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto]"><button type="button" onClick={() => void exportWorkspaceData()} disabled={dataActionBusy || !account?.hosted} className="eg-button-secondary inline-flex items-center justify-center gap-2 px-4 text-xs font-semibold"><Download className="h-4 w-4" /> Xuất JSON</button><input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} className="eg-input px-4 text-sm" placeholder="Nhập XÓA DỮ LIỆU để xác nhận" aria-label="Xác nhận xóa dữ liệu cloud" /><button type="button" onClick={() => void removeWorkspaceData()} disabled={dataActionBusy || deleteConfirm !== 'XÓA DỮ LIỆU' || !account?.hosted} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/20 bg-rose-300/[.055] px-4 text-xs font-semibold text-rose-100 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-4 w-4" /> Xóa cloud</button></div><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px]"><a href="/privacy.html" target="_blank" rel="noreferrer" className="min-h-11 inline-flex items-center text-cyan-200 hover:text-cyan-100">Chính sách quyền riêng tư</a><a href="/terms.html" target="_blank" rel="noreferrer" className="min-h-11 inline-flex items-center text-cyan-200 hover:text-cyan-100">Điều khoản sử dụng</a></div></section>
                  <section className="eg-panel overflow-hidden"><div className="border-b eg-divider px-5 py-4"><div className="eg-kicker">Sẵn sàng bán · khách dùng khóa riêng</div><h3 className="mt-1 text-sm font-semibold text-white">Danh sách kiểm tra thương mại</h3></div><div className="grid gap-3 p-5 md:grid-cols-2">{[
                    ['Danh tính workspace', Boolean(profile.email || account?.hosted), 'Tách dữ liệu theo tài khoản ChatGPT.'],
                    ['Hạn mức và chi phí', true, 'Theo dõi đơn vị, chi phí ước tính và chặn cứng.'],
                    ['Nhật ký lỗi', Boolean(account?.hosted), 'Ghi lỗi runtime và usage trên D1.'],
                    ['Dữ liệu dự án', Boolean(account?.hosted), 'D1 cho trạng thái, R2 cho media.'],
                    ['Khóa API khách hàng', getCredentialVaultStatus().providerCount > 0, `${getCredentialVaultStatus().providerCount} nhà cung cấp đang có khóa trong phiên.`],
                    ['Tên miền riêng', !window.location.hostname.endsWith('.chatgpt.site'), window.location.hostname],
                  ].map(([label, ready, detail]) => <div key={String(label)} className={`rounded-xl border p-4 ${ready ? 'border-emerald-300/15 bg-emerald-300/[.04]' : 'border-amber-300/15 bg-amber-300/[.04]'}`}><div className="flex items-center gap-2 text-xs font-semibold text-white">{ready ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertCircle className="h-4 w-4 text-amber-300" />}{String(label)}</div><p className="mt-2 text-[10px] leading-4 text-zinc-600">{String(detail)}</p></div>)}</div></section>
                  <section className="eg-panel overflow-hidden">
                    <div className="flex items-center gap-3 border-b eg-divider px-5 py-4"><BarChart3 className="h-4 w-4 text-cyan-200" /><div><div className="eg-kicker">Quan sát hệ thống</div><h3 className="mt-1 text-sm font-semibold text-white">Nhật ký vận hành gần đây</h3></div></div>
                    <div className="divide-y divide-white/[.06]">
                      {[...(account?.recentEvents || []).map((event) => ({ id: event.id, timestamp: event.timestamp, label: `${event.kind.toUpperCase()} · ${event.modelId || event.providerId || 'Tác vụ'}`, detail: event.status === 'success' ? `${event.units} đơn vị · $${Number(event.estimatedCostUsd).toFixed(4)}` : event.error || 'Tác vụ thất bại', error: event.status === 'failed' })), ...(account?.systemEvents || []).map((event) => ({ id: event.id, timestamp: event.createdAt, label: `${event.source} · ${event.severity}`, detail: event.message, error: event.severity === 'error' }))]
                        .sort((a, b) => b.timestamp - a.timestamp)
                        .slice(0, 12)
                        .map((event) => <div key={event.id} className="flex items-start gap-3 px-5 py-3"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${event.error ? 'bg-rose-300' : 'bg-emerald-300'}`} /><div className="min-w-0 flex-1"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><span className="truncate text-[11px] font-semibold text-zinc-300">{event.label}</span><span className="font-mono text-[9px] text-zinc-700">{new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(event.timestamp)}</span></div><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-600">{event.detail}</p></div></div>)}
                      {!account?.recentEvents?.length && !account?.systemEvents?.length && <div className="px-5 py-8 text-center text-xs text-zinc-600">Chưa có sự kiện. Nhật ký sẽ xuất hiện sau lần chạy tác vụ đầu tiên.</div>}
                    </div>
                  </section>
                </div>
              )
            )}
          </div>

          {savedMessage && <div className="border-t eg-divider px-5 py-3 text-xs text-cyan-100" role="status">{savedMessage}</div>}
        </div>
      </div>
    </div>
  );
};

export default OperationsHub;
