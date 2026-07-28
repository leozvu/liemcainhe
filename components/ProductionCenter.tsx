import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArchiveRestore,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Cloud,
  CloudUpload,
  Cpu,
  DatabaseBackup,
  Gauge,
  History,
  Loader2,
  Layers3,
  ListTodo,
  MessageSquareText,
  PackageCheck,
  Play,
  RotateCcw,
  ScanSearch,
  Scissors,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
  XCircle,
} from 'lucide-react';
import { CoreStage, ProductionJobStatus, ProjectState } from '../types';
import {
  addProductionJob,
  clearFinishedJobs,
  createProductionJob,
  createProjectCheckpoint,
  deleteProjectCheckpoint,
  getPreflightItems,
  getWorkflowReadiness,
  patchProductionJob,
  resolveInterruptedProductionJob,
  restoreProjectCheckpoint,
  setProductionJobStatus,
} from '../services/workflowService';
import { syncProjectToCloud } from '../services/cloudSyncService';
import { clearFinishedDurableJobs, syncDurableJobs } from '../services/durableJobService';
import { useAlert } from './GlobalAlert';
import ProductionControlBoard from './ProductionControlBoard';
import ClientReviewManager from './ClientReviewManager';
import VideoFactory from './VideoFactory';
import AISupervisor from './AISupervisor';
import AutoEditor from './AutoEditor';
import DistributionGateway from './DistributionGateway';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((previous: ProjectState) => ProjectState)) => void;
  initialTab?: 'overview' | 'board' | 'factory' | 'supervisor' | 'editor' | 'review' | 'distribution';
  setStage: (stage: CoreStage) => void;
  onClose: () => void;
  onShowModelConfig: () => void;
}

type CenterTab = 'overview' | 'board' | 'factory' | 'supervisor' | 'editor' | 'review' | 'distribution' | 'jobs' | 'history';

const STATUS_META: Record<ProductionJobStatus, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  queued: { label: 'Đang chờ', className: 'border-sky-200/20 bg-sky-200/[.07] text-sky-100', icon: CircleDashed },
  running: { label: 'Đang chạy', className: 'border-cyan-200/25 bg-cyan-200/[.09] text-cyan-100', icon: Loader2 },
  completed: { label: 'Hoàn tất', className: 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100', icon: Check },
  failed: { label: 'Thất bại', className: 'border-rose-200/20 bg-rose-200/[.07] text-rose-100', icon: XCircle },
  interrupted: { label: 'Gián đoạn', className: 'border-amber-200/20 bg-amber-200/[.07] text-amber-100', icon: AlertTriangle },
  cancelled: { label: 'Đã hủy', className: 'border-white/10 bg-white/[.04] text-zinc-400', icon: X },
};

const formatTime = (timestamp?: number) => timestamp
  ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(timestamp)
  : 'Chưa đồng bộ';

const ProductionCenter: React.FC<Props> = ({
  project,
  updateProject,
  initialTab = 'overview',
  setStage,
  onClose,
  onShowModelConfig,
}) => {
  const { showAlert } = useAlert();
  const [activeTab, setActiveTab] = useState<CenterTab>(initialTab);
  const [syncing, setSyncing] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const readiness = useMemo(() => getWorkflowReadiness(project), [project]);
  const preflight = useMemo(() => getPreflightItems(project), [project]);
  const workflow = project.workflow || { jobs: [], checkpoints: [] };
  const productionTasks = workflow.productionTasks || [];
  const teamAttentionCount = productionTasks.filter((task) => ['in-progress', 'review', 'blocked'].includes(task.status)).length;
  const activeJobs = workflow.jobs.filter((job) => ['queued', 'running'].includes(job.status));
  const failedJobs = workflow.jobs.filter((job) => ['failed', 'interrupted'].includes(job.status));
  const hosted = typeof window !== 'undefined' && window.location.hostname.endsWith('.chatgpt.site');

  useEffect(() => {
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const goToStage = (stage: CoreStage) => {
    setStage(stage);
    onClose();
  };

  const createCheckpoint = () => {
    updateProject((previous) => createProjectCheckpoint(previous, `Checkpoint thủ công · ${formatTime(Date.now())}`));
    showAlert('Đã tạo checkpoint. Hệ thống giữ tối đa ba phiên bản gần nhất trên thiết bị.', { type: 'success' });
  };

  const restoreCheckpoint = (checkpointId: string, label: string) => {
    showAlert(`Khôi phục “${label}”? Trạng thái hiện tại sẽ được thay bằng phiên bản này.`, {
      type: 'warning',
      showCancel: true,
      onConfirm: () => {
        updateProject((previous) => restoreProjectCheckpoint(previous, checkpointId));
        showAlert('Đã khôi phục checkpoint.', { type: 'success' });
      },
    });
  };

  const removeCheckpoint = (checkpointId: string, label: string) => {
    showAlert(`Xóa checkpoint “${label}”?`, {
      type: 'warning',
      showCancel: true,
      onConfirm: () => updateProject((previous) => deleteProjectCheckpoint(previous, checkpointId)),
    });
  };

  const syncCloud = async () => {
    if (syncing) return;
    if (!hosted) {
      showAlert('Sao lưu cloud chỉ hoạt động trên bản đã deploy và đăng nhập ChatGPT. Bản local vẫn tự lưu trên thiết bị.', { type: 'info' });
      return;
    }

    const job = createProductionJob({
      kind: 'cloud-sync',
      stage: 'export',
      label: 'Sao lưu dự án và media',
      totalUnits: 100,
      detail: 'Đồng bộ D1/R2 theo tài khoản ChatGPT hiện tại.',
    });
    setSyncing(true);
    updateProject((previous) => {
      const next = setProductionJobStatus(addProductionJob(previous, job), job.id, 'running');
      return {
        ...next,
        workflow: { ...next.workflow!, cloudSyncStatus: 'syncing', cloudSyncError: undefined },
      };
    });

    try {
      const cloudProject = await syncProjectToCloud(project, (progress, detail) => {
        updateProject((previous) => patchProductionJob(previous, job.id, {
          progress,
          completedUnits: progress,
          detail,
        }));
      });
      updateProject((previous) => {
        const finished = setProductionJobStatus(previous, job.id, 'completed');
        return {
          ...cloudProject,
          workflow: {
            ...(finished.workflow || { jobs: [], checkpoints: [] }),
            checkpoints: previous.workflow?.checkpoints || [],
            lastCloudSyncAt: Date.now(),
            cloudSyncStatus: 'synced',
            cloudSyncError: undefined,
          },
        };
      });
      showAlert('Đã sao lưu trạng thái dự án và media lên cloud.', { type: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể đồng bộ cloud';
      updateProject((previous) => {
        const failed = setProductionJobStatus(previous, job.id, 'failed', message);
        return {
          ...failed,
          workflow: { ...failed.workflow!, cloudSyncStatus: 'error', cloudSyncError: message },
        };
      });
      showAlert(`${message}. Dữ liệu cục bộ vẫn an toàn trên thiết bị này.`, { type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const handlePreflightAction = (action?: 'models' | 'voice' | 'cloud') => {
    if (action === 'models') {
      onShowModelConfig();
      return;
    }
    if (action === 'voice') {
      goToStage('voice');
      return;
    }
    if (action === 'cloud') void syncCloud();
  };

  const clearFinished = () => {
    updateProject(clearFinishedJobs);
    void clearFinishedDurableJobs(project.id);
  };

  const reconcileInterrupted = (jobId: string, stage: CoreStage) => {
    showAlert('Chỉ mở khóa sau khi bạn đã kiểm tra dashboard của provider và xác nhận tác vụ cũ không còn kết quả cần thu hồi. Chạy lại có thể tốn thêm credit. Tiếp tục?', {
      type: 'warning',
      showCancel: true,
      onConfirm: async () => {
        const resolved = resolveInterruptedProductionJob(project, jobId);
        const resolvedJob = resolved.workflow?.jobs.find((job) => job.id === jobId);
        if (resolvedJob) {
          try {
            await syncDurableJobs(project.id, [resolvedJob]);
          } catch (error) {
            showAlert(error instanceof Error ? error.message : 'Không thể mở khóa job trên cloud.', { type: 'error' });
            return;
          }
        }
        updateProject(resolved);
        goToStage(stage);
      },
    });
  };

  return (
    <div className="fixed inset-0 z-[120] flex bg-black/80 backdrop-blur-xl" role="dialog" aria-modal="true" aria-labelledby="production-center-title">
      <div className="flex h-full w-full flex-col bg-[var(--eg-canvas)] text-[var(--eg-text)]">
        <header className="flex min-h-20 items-center justify-between gap-4 border-b eg-divider bg-[rgba(7,9,12,.92)] px-4 py-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-200/10 text-cyan-100">
              <Gauge className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="eg-kicker">Quy trình V2 · Điều phối sản xuất</div>
              <h1 id="production-center-title" ref={titleRef} tabIndex={-1} className="truncate text-lg font-semibold tracking-tight text-white outline-none md:text-2xl">Trung tâm sản xuất</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void syncCloud()} disabled={syncing} className="eg-button-secondary hidden items-center justify-center gap-2 px-4 text-xs font-semibold sm:inline-flex">
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
              {syncing ? 'Đang sao lưu…' : 'Sao lưu cloud'}
            </button>
            <button type="button" onClick={onClose} className="eg-icon-button flex h-11 w-11 items-center justify-center" aria-label="Đóng Trung tâm sản xuất">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="border-b eg-divider bg-white/[.02] px-4 md:px-8">
          <nav className="mx-auto flex max-w-[1520px] gap-1 overflow-x-auto" aria-label="Khu vực Trung tâm sản xuất">
            {([
              { id: 'overview' as const, label: 'Tổng quan', icon: Gauge },
              { id: 'board' as const, label: `Bảng team${teamAttentionCount ? ` · ${teamAttentionCount}` : ''}`, icon: UsersRound },
              { id: 'factory' as const, label: 'Video Factory', icon: Layers3 },
              { id: 'supervisor' as const, label: 'AI Supervisor', icon: ScanSearch },
              { id: 'editor' as const, label: 'Auto Editor', icon: Scissors },
              { id: 'review' as const, label: 'Duyệt khách hàng', icon: MessageSquareText },
              { id: 'distribution' as const, label: 'Phân phối', icon: PackageCheck },
              { id: 'jobs' as const, label: `Tác vụ ${activeJobs.length ? `· ${activeJobs.length}` : ''}`, icon: ListTodo },
              { id: 'history' as const, label: `Checkpoint · ${workflow.checkpoints.length}`, icon: History },
            ]).map((tab) => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-4 text-xs font-semibold transition-colors ${activeTab === tab.id ? 'border-cyan-200 text-cyan-100' : 'border-transparent text-zinc-500 hover:text-white'}`} aria-current={activeTab === tab.id ? 'page' : undefined}>
                <tab.icon className="h-4 w-4" /> {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <main className="eg-safe-scroll flex-1 overflow-y-auto p-4 pb-24 md:p-8">
          <div className="mx-auto max-w-[1520px]">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <section className="eg-panel relative overflow-hidden p-5 md:p-8">
                  <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-cyan-300/[.08] blur-[100px]" />
                  <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="eg-chip border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100"><ShieldCheck className="h-3 w-3" /> Trạng thái trực tiếp</span>
                        {failedJobs.length > 0 && <span className="eg-chip border-amber-200/20 bg-amber-200/[.07] text-amber-100"><AlertTriangle className="h-3 w-3" /> {failedJobs.length} tác vụ cần xem</span>}
                      </div>
                      <h2 className="mt-5 max-w-3xl text-2xl font-semibold tracking-[-.03em] text-white md:text-4xl">{readiness.nextLabel}</h2>
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Hệ thống đã kiểm tra toàn bộ chuỗi kịch bản, tài nguyên, thoại và video. Bạn có thể đi thẳng đến việc tạo ra giá trị tiếp theo.</p>
                    </div>
                    <button type="button" onClick={() => goToStage(readiness.nextStage)} className="eg-button-primary inline-flex min-w-52 items-center justify-center gap-2 px-6 text-sm font-bold">
                      <Play className="h-4 w-4 fill-current" /> {readiness.nextLabel} <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="relative mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {[
                      { label: 'Tiến độ tổng', value: `${readiness.overallPercent}%` },
                      { label: 'Điểm cần xử lý', value: readiness.blockingCount },
                      { label: 'Tác vụ có thể tính phí', value: readiness.chargeableOperations },
                      { label: 'Sao lưu gần nhất', value: formatTime(workflow.lastCloudSyncAt) },
                    ].map((item) => (
                      <div key={item.label} className="rounded-2xl border border-white/[.07] bg-black/20 p-4">
                        <div className="font-mono text-[9px] uppercase tracking-[.16em] text-zinc-600">{item.label}</div>
                        <div className="mt-2 text-xl font-semibold text-white">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div><div className="eg-kicker">Chuỗi sản xuất</div><h2 className="mt-1 text-lg font-semibold text-white">Readiness theo công đoạn</h2></div>
                    <span className="hidden text-xs text-zinc-600 md:block">Nhấn một công đoạn để mở không gian làm việc tương ứng</span>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-5">
                    {readiness.stages.map((stage, index) => (
                      <button key={stage.id} type="button" onClick={() => goToStage(stage.id)} className="eg-card group min-h-52 p-5 text-left hover:border-cyan-200/25">
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-mono text-[9px] uppercase tracking-[.16em] text-zinc-600">0{index + 1}</span>
                          <span className={`eg-chip ${stage.status === 'ready' ? 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' : stage.status === 'blocked' ? 'border-rose-200/20 bg-rose-200/[.07] text-rose-100' : 'border-amber-200/20 bg-amber-200/[.07] text-amber-100'}`}>
                            {stage.status === 'ready' ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
                            {stage.status === 'ready' ? 'Sẵn sàng' : stage.status === 'blocked' ? 'Bị chặn' : 'Cần xử lý'}
                          </span>
                        </div>
                        <h3 className="mt-7 text-base font-semibold text-white">{stage.label}</h3>
                        <p className="mt-1 min-h-10 text-[11px] leading-5 text-zinc-500">{stage.description}</p>
                        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[var(--eg-accent)] transition-[width] duration-300" style={{ width: `${stage.percent}%` }} /></div>
                        <div className="mt-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-zinc-600"><span>{stage.complete}/{stage.total}</span><span>{stage.percent}%</span></div>
                        {stage.blockers[0] && <p className="mt-4 text-[10px] leading-4 text-amber-100/70">{stage.blockers[0]}</p>}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="grid gap-5 xl:grid-cols-[1.3fr_.7fr]">
                  <div className="eg-panel p-5 md:p-6">
                    <div className="flex items-center justify-between gap-3"><div><div className="eg-kicker">Preflight</div><h2 className="mt-1 text-lg font-semibold text-white">Sẵn sàng trước khi gọi API</h2></div><Cpu className="h-5 w-5 text-cyan-200/60" /></div>
                    <div className="mt-5 grid gap-2 sm:grid-cols-2">
                      {preflight.map((item) => (
                        <button key={item.id} type="button" onClick={() => handlePreflightAction(item.action)} className="flex min-h-20 items-start gap-3 rounded-2xl border border-white/[.07] bg-black/15 p-4 text-left hover:border-cyan-200/20">
                          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${item.status === 'ready' ? 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-200' : item.status === 'blocked' ? 'border-rose-200/20 bg-rose-200/[.07] text-rose-200' : 'border-amber-200/20 bg-amber-200/[.07] text-amber-200'}`}>
                            {item.status === 'ready' ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                          </span>
                          <span><span className="block text-xs font-semibold text-zinc-200">{item.label}</span><span className="mt-1 block text-[10px] leading-4 text-zinc-600">{item.detail}</span></span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="eg-panel p-5 md:p-6">
                    <div className="flex items-center justify-between gap-3"><div><div className="eg-kicker">An toàn dữ liệu</div><h2 className="mt-1 text-lg font-semibold text-white">Checkpoint & cloud</h2></div><DatabaseBackup className="h-5 w-5 text-amber-200/60" /></div>
                    <p className="mt-4 text-xs leading-5 text-zinc-500">Checkpoint giữ ba phiên bản gần nhất trên thiết bị. Cloud lưu trạng thái hiện tại và media trên tài khoản đã đăng nhập.</p>
                    <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                      <button type="button" onClick={createCheckpoint} className="eg-button-secondary inline-flex items-center justify-center gap-2 px-4 text-xs font-semibold"><ArchiveRestore className="h-4 w-4" /> Tạo checkpoint</button>
                      <button type="button" onClick={() => void syncCloud()} disabled={syncing} className="eg-button-primary inline-flex items-center justify-center gap-2 px-4 text-xs font-bold">{syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />} {syncing ? 'Đang sao lưu…' : 'Sao lưu cloud'}</button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'board' && (
              <ProductionControlBoard project={project} updateProject={updateProject} />
            )}

            {activeTab === 'factory' && (
              <VideoFactory
                project={project}
                updateProject={updateProject}
                onOpenDirector={() => goToStage('director')}
                onShowModelConfig={onShowModelConfig}
              />
            )}

            {activeTab === 'supervisor' && (
              <AISupervisor
                project={project}
                updateProject={updateProject}
                onOpenDirector={() => goToStage('director')}
                onShowModelConfig={onShowModelConfig}
              />
            )}

            {activeTab === 'editor' && (
              <AutoEditor
                project={project}
                updateProject={updateProject}
                onOpenExport={() => goToStage('export')}
                onOpenReview={() => setActiveTab('review')}
              />
            )}

            {activeTab === 'review' && (
              <ClientReviewManager project={project} updateProject={updateProject} onOpenDistribution={() => setActiveTab('distribution')} />
            )}

            {activeTab === 'distribution' && (
              <DistributionGateway project={project} onOpenReview={() => setActiveTab('review')} />
            )}

            {activeTab === 'jobs' && (
              <section>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div><div className="eg-kicker">Hàng đợi sản xuất</div><h2 className="mt-1 text-2xl font-semibold text-white">Lịch sử tác vụ</h2><p className="mt-2 text-xs text-zinc-500">Mọi tác vụ hàng loạt sẽ được ghi lại, kể cả lỗi hoặc phiên làm việc bị gián đoạn.</p></div>
                  <button type="button" onClick={clearFinished} className="eg-button-secondary inline-flex items-center justify-center gap-2 px-4 text-xs font-semibold"><Trash2 className="h-4 w-4" /> Dọn tác vụ hoàn tất</button>
                </div>
                <div className="mt-6 space-y-3">
                  {workflow.jobs.length === 0 ? (
                    <div className="eg-panel flex min-h-72 flex-col items-center justify-center p-8 text-center"><ListTodo className="h-10 w-10 text-zinc-700" /><h3 className="mt-4 text-sm font-semibold text-zinc-300">Chưa có tác vụ sản xuất</h3><p className="mt-2 max-w-md text-xs leading-5 text-zinc-600">Tạo batch ảnh, voice, video hoặc sao lưu cloud để theo dõi tiến độ tại đây.</p></div>
                  ) : workflow.jobs.map((job) => {
                    const meta = STATUS_META[job.status];
                    const Icon = meta.icon;
                    return (
                      <div key={job.id} className="eg-card p-4 md:p-5">
                        <div className="flex flex-col gap-4 md:flex-row md:items-center">
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${meta.className}`}><Icon className={`h-4 w-4 ${job.status === 'running' ? 'animate-spin' : ''}`} /></div>
                          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-semibold text-white">{job.label}</h3><span className={`eg-chip ${meta.className}`}>{meta.label}</span></div><p className="mt-1 text-[10px] leading-4 text-zinc-600">{job.error || job.detail || `${job.stage} · ${formatTime(job.updatedAt)}`}</p></div>
                          <div className="w-full md:w-56"><div className="flex justify-between font-mono text-[9px] uppercase tracking-wider text-zinc-600"><span>{job.completedUnits || 0}/{job.totalUnits || 100}</span><span>{job.progress}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className={`h-full rounded-full ${job.status === 'failed' ? 'bg-rose-300' : job.status === 'interrupted' ? 'bg-amber-300' : 'bg-[var(--eg-accent)]'}`} style={{ width: `${job.progress}%` }} /></div></div>
                          {job.status === 'failed' && <button type="button" onClick={() => goToStage(job.stage)} className="eg-button-secondary inline-flex shrink-0 items-center justify-center gap-2 px-4 text-xs font-semibold"><RotateCcw className="h-4 w-4" /> Mở để chạy lại</button>}
                          {job.status === 'interrupted' && <button type="button" onClick={() => reconcileInterrupted(job.id, job.stage)} className="eg-button-secondary inline-flex shrink-0 items-center justify-center gap-2 px-4 text-xs font-semibold"><ShieldCheck className="h-4 w-4" /> Đã đối chiếu, mở khóa</button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {activeTab === 'history' && (
              <section>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div><div className="eg-kicker">An toàn phiên bản</div><h2 className="mt-1 text-2xl font-semibold text-white">Điểm khôi phục dự án</h2><p className="mt-2 text-xs text-zinc-500">Tạo điểm quay lại trước khi phân tích hoặc tạo lại nội dung hàng loạt.</p></div>
                  <button type="button" onClick={createCheckpoint} className="eg-button-primary inline-flex items-center justify-center gap-2 px-5 text-xs font-bold"><ArchiveRestore className="h-4 w-4" /> Tạo checkpoint mới</button>
                </div>
                <div className="mt-6 grid gap-3 lg:grid-cols-3">
                  {workflow.checkpoints.length === 0 ? (
                    <div className="eg-panel col-span-full flex min-h-72 flex-col items-center justify-center p-8 text-center"><History className="h-10 w-10 text-zinc-700" /><h3 className="mt-4 text-sm font-semibold text-zinc-300">Chưa có checkpoint</h3><p className="mt-2 max-w-md text-xs leading-5 text-zinc-600">Hệ thống cũng sẽ tự tạo checkpoint trước các thao tác ghi đè quan trọng.</p></div>
                  ) : workflow.checkpoints.map((checkpoint) => (
                    <article key={checkpoint.id} className="eg-card p-5">
                      <div className="flex items-start justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-200/20 bg-amber-200/[.07] text-amber-100"><ArchiveRestore className="h-4 w-4" /></div><button type="button" onClick={() => removeCheckpoint(checkpoint.id, checkpoint.label)} className="eg-icon-button flex h-11 w-11 items-center justify-center text-zinc-600 hover:text-rose-200" aria-label={`Xóa ${checkpoint.label}`}><Trash2 className="h-4 w-4" /></button></div>
                      <h3 className="mt-5 text-sm font-semibold text-white">{checkpoint.label}</h3>
                      <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-zinc-600">{formatTime(checkpoint.createdAt)} · {checkpoint.stage}</p>
                      <div className="mt-5 grid grid-cols-2 gap-2 text-[10px] text-zinc-500"><div className="rounded-xl border border-white/[.06] bg-black/15 p-3"><span className="block font-mono text-[9px] uppercase text-zinc-700">Cảnh</span><strong className="mt-1 block text-sm text-zinc-300">{checkpoint.snapshot.shots.length}</strong></div><div className="rounded-xl border border-white/[.06] bg-black/15 p-3"><span className="block font-mono text-[9px] uppercase text-zinc-700">Bản thoại</span><strong className="mt-1 block text-sm text-zinc-300">{checkpoint.snapshot.voiceStudio?.takes.length || 0}</strong></div></div>
                      <button type="button" onClick={() => restoreCheckpoint(checkpoint.id, checkpoint.label)} className="eg-button-secondary mt-5 inline-flex w-full items-center justify-center gap-2 px-4 text-xs font-semibold"><RotateCcw className="h-4 w-4" /> Khôi phục phiên bản này</button>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default ProductionCenter;
