import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  CircleDollarSign,
  Clapperboard,
  Eye,
  EyeOff,
  Gauge,
  ImageOff,
  Loader2,
  Play,
  RotateCcw,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  XCircle,
} from 'lucide-react';
import { AISupervisorIssue, AISupervisorShotReport, ProjectState } from '../types';
import {
  cancelSupervisorRepair,
  executeSupervisorRepair,
  estimateVisionAuditCost,
  getAISupervisorGate,
  getAISupervisorSummary,
  getSupervisorRepairPlan,
  normalizeAISupervisorState,
  queueSupervisorRepair,
  runLocalSupervisorAudit,
  runSupervisorVisionAudit,
  setSupervisorIssueStatus,
  updateAISupervisorPolicy,
} from '../services/aiSupervisorService';
import { useAlert } from './GlobalAlert';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((previous: ProjectState) => ProjectState)) => void;
  onOpenDirector: () => void;
  onShowModelConfig: () => void;
}

type ReportFilter = 'all' | 'fail' | 'warning' | 'pass' | 'vision';

const STATUS_META: Record<AISupervisorShotReport['status'], { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  fail: { label: 'Cần chặn', className: 'border-rose-200/20 bg-rose-200/[.07] text-rose-100', icon: ShieldAlert },
  warning: { label: 'Cần xem', className: 'border-amber-200/20 bg-amber-200/[.07] text-amber-100', icon: AlertTriangle },
  pass: { label: 'Đạt local', className: 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100', icon: BadgeCheck },
};

const ISSUE_KIND_LABEL: Record<AISupervisorIssue['kind'], string> = {
  'missing-media': 'Media',
  'stale-media': 'Phiên bản',
  face: 'Khuôn mặt',
  hands: 'Bàn tay',
  logo: 'Logo',
  product: 'Sản phẩm',
  continuity: 'Continuity',
  'dialogue-overrun': 'Lời thoại',
  'safe-zone': 'Safe zone',
  brand: 'Brand Guard',
  cta: 'CTA',
};

const formatUsd = (value: number): string => `$${Number(value || 0).toFixed(value >= 1 ? 2 : 3)}`;
const formatTime = (value?: number): string => value
  ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(value)
  : 'Chưa chạy';

const AISupervisor: React.FC<Props> = ({ project, updateProject, onOpenDirector, onShowModelConfig }) => {
  const { showAlert } = useAlert();
  const state = useMemo(() => normalizeAISupervisorState(project.aiSupervisor), [project.aiSupervisor]);
  const summary = useMemo(() => getAISupervisorSummary(project), [project]);
  const gate = useMemo(() => getAISupervisorGate(project), [project]);
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [visionShotId, setVisionShotId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [repairShotId, setRepairShotId] = useState<string | null>(null);

  const reports = useMemo(() => state.reports.filter((report) => {
    if (filter === 'all') return true;
    if (filter === 'vision') return report.visionStatus !== 'complete';
    return report.status === filter;
  }), [filter, state.reports]);

  const localAudit = () => {
    updateProject(runLocalSupervisorAudit);
    showAlert(`Đã kiểm tra miễn phí ${project.shots.length} shot. Không gọi API.`, { type: 'success' });
  };

  const scanOne = async (shotId: string) => {
    if (visionShotId || batchRunning) return;
    const estimated = estimateVisionAuditCost(1);
    if (!window.confirm(`AI Vision sẽ gọi model hội thoại có thị giác và dự toán ${formatUsd(estimated)}. Tiếp tục kiểm tra shot này?`)) return;
    setVisionShotId(shotId);
    try {
      const next = await runSupervisorVisionAudit(project, shotId);
      updateProject(next);
      showAlert('AI Vision đã kiểm tra khung hình của shot.', { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể chạy AI Vision.', { type: 'error' });
    } finally {
      setVisionShotId(null);
    }
  };

  const scanBatch = async () => {
    if (visionShotId || batchRunning) return;
    let working = project.aiSupervisor?.lastLocalAuditAt ? project : runLocalSupervisorAudit(project);
    const supervisor = normalizeAISupervisorState(working.aiSupervisor);
    const eligible = supervisor.reports
      .filter((report) => report.visionStatus !== 'complete')
      .filter((report) => working.shots.find((shot) => shot.id === report.shotId)?.keyframes.some((frame) => Boolean(frame.imageUrl)))
      .sort((left, right) => ({ fail: 0, warning: 1, pass: 2 }[left.status] - { fail: 0, warning: 1, pass: 2 }[right.status]))
      .slice(0, supervisor.policy.maxVisionShotsPerRun);
    if (!eligible.length) {
      showAlert('Không còn shot có keyframe cần quét thị giác.', { type: 'info' });
      return;
    }
    const estimate = estimateVisionAuditCost(eligible.length);
    if (!window.confirm(`Quét tối đa ${eligible.length} shot bằng AI Vision. Dự toán ${formatUsd(estimate)} và hệ thống sẽ dừng nếu chạm ngân sách. Tiếp tục?`)) return;
    setBatchRunning(true);
    setBatchProgress({ current: 0, total: eligible.length });
    try {
      updateProject(working);
      for (let index = 0; index < eligible.length; index += 1) {
        working = await runSupervisorVisionAudit(working, eligible[index].shotId);
        updateProject(working);
        setBatchProgress({ current: index + 1, total: eligible.length });
      }
      showAlert(`Đã kiểm tra thị giác ${eligible.length} shot trong ngân sách.`, { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Batch AI Vision bị gián đoạn.', { type: 'error' });
    } finally {
      setBatchRunning(false);
    }
  };

  const queueRepair = (shotId: string) => {
    try {
      updateProject((current) => queueSupervisorRepair(current, shotId));
      showAlert('Đã xếp đúng shot lỗi vào hàng sửa. Chưa gọi API.', { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể xếp hàng sửa shot.', { type: 'error' });
    }
  };

  const runRepair = async (shotId: string) => {
    if (repairShotId) return;
    try {
      const plan = getSupervisorRepairPlan(project, shotId, ['queued']);
      if (state.policy.requireHumanApproval && !window.confirm(
        `Chạy ${plan.actions.length} bước sửa cho đúng shot này? Dự toán đã khóa: ${formatUsd(plan.estimatedCostUsd)}.`,
      )) return;
      setRepairShotId(shotId);
      const next = await executeSupervisorRepair(project, shotId, { onProjectUpdate: updateProject });
      updateProject(next);
      showAlert('Đã sửa chọn lọc và kiểm tra lại shot.', { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể thực thi kế hoạch sửa.', { type: 'error' });
    } finally {
      setRepairShotId(null);
    }
  };

  const cancelRepair = (shotId: string) => {
    try {
      updateProject((current) => cancelSupervisorRepair(current, shotId));
      showAlert('Đã hủy kế hoạch sửa và hoàn lại phần ngân sách cam kết.', { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể hủy kế hoạch sửa.', { type: 'error' });
    }
  };

  const toggleIgnored = (shotId: string, issue: AISupervisorIssue) => {
    updateProject((current) => setSupervisorIssueStatus(current, shotId, issue.id, issue.status === 'ignored' ? 'open' : 'ignored'));
  };

  const visionBusy = Boolean(visionShotId) || batchRunning || Boolean(repairShotId);
  const repairPercent = state.policy.repairBudgetUsd > 0
    ? Math.min(100, (state.repairCommittedCostUsd / state.policy.repairBudgetUsd) * 100)
    : state.repairCommittedCostUsd > 0 ? 100 : 0;

  return (
    <div className="space-y-5">
      <section className="eg-panel relative overflow-hidden p-5 md:p-7">
        <div className="pointer-events-none absolute -right-14 -top-24 h-72 w-72 rounded-full bg-emerald-300/[.08] blur-[100px]" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eg-chip border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100"><ShieldCheck className="h-3 w-3" /> Cổng chất lượng</span>
              <span className="eg-chip border-white/[.08] bg-white/[.03] text-zinc-400">Sửa có kiểm soát ngân sách</span>
            </div>
            <h2 className="mt-5 text-2xl font-semibold tracking-[-.03em] text-white md:text-4xl">AI Supervisor</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Chấm từng shot, đối chiếu Brand Kit và continuity, phát hiện media lỗi thời, thoại quá dài và lỗi thị giác. Mọi lệnh sửa đều bị khóa theo shot và ngân sách.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={localAudit} disabled={!project.shots.length || visionBusy} className="eg-button-secondary inline-flex min-h-12 items-center justify-center gap-2 px-5 text-xs font-semibold disabled:opacity-40"><ScanSearch className="h-4 w-4" /> Quét miễn phí</button>
            <button type="button" onClick={() => void scanBatch()} disabled={!project.shots.length || visionBusy} aria-live="polite" className="eg-button-primary inline-flex min-h-12 items-center justify-center gap-2 px-5 text-xs font-bold disabled:opacity-40">
              {batchRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              {batchRunning ? `Đang quét ${batchProgress.current}/${batchProgress.total}` : 'Quét AI Vision'}
            </button>
          </div>
        </div>

        <div className="relative mt-7 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: 'Shot đạt', value: `${summary.passedShots}/${summary.auditedShots || project.shots.length}`, tone: 'text-emerald-100' },
            { label: 'Shot bị chặn', value: summary.failedShots, tone: summary.failedShots ? 'text-rose-100' : 'text-white' },
            { label: 'Lỗi nghiêm trọng', value: summary.criticalIssues, tone: summary.criticalIssues ? 'text-rose-100' : 'text-white' },
            { label: 'Chờ Vision', value: summary.visionPendingShots, tone: 'text-amber-100' },
            { label: 'Còn ngân sách sửa', value: formatUsd(summary.repairRemainingUsd), tone: 'text-cyan-100' },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/[.07] bg-black/20 p-4">
              <div className="font-mono text-[9px] uppercase tracking-[.16em] text-zinc-600">{item.label}</div>
              <div className={`mt-2 text-xl font-semibold ${item.tone}`}>{item.value}</div>
            </div>
          ))}
        </div>

        <div
          role="status"
          aria-live="polite"
          className={`relative mt-4 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
            gate.status === 'blocked'
              ? 'border-rose-200/20 bg-rose-200/[.05]'
              : gate.status === 'review'
                ? 'border-amber-200/20 bg-amber-200/[.05]'
                : 'border-emerald-200/20 bg-emerald-200/[.05]'
          }`}
        >
          <div className="flex items-start gap-3">
            {gate.status === 'blocked'
              ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-200" />
              : gate.status === 'review'
                ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
                : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-200" />}
            <div>
              <h3 className="text-sm font-semibold text-white">Release Gate · {gate.label}</h3>
              <p className="mt-1 text-[11px] leading-5 text-zinc-400">{gate.reasons.join(' · ')}</p>
            </div>
          </div>
          <span className={`eg-chip shrink-0 ${gate.canRelease ? 'border-emerald-200/20 bg-emerald-200/[.08] text-emerald-100' : 'border-rose-200/20 bg-rose-200/[.08] text-rose-100'}`}>
            {gate.canRelease ? 'Cho phép chuyển duyệt' : 'Đang khóa đầu ra'}
          </span>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="eg-panel p-5 md:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div><div className="eg-kicker">Quality queue</div><h3 className="mt-1 text-lg font-semibold text-white">Báo cáo theo shot</h3><p className="mt-1 text-xs text-zinc-600">Local audit: {formatTime(state.lastLocalAuditAt)} · Vision: {formatTime(state.lastVisionAuditAt)}</p></div>
            <div className="flex max-w-full gap-1 overflow-x-auto pb-1">
              {([
                ['all', 'Tất cả'], ['fail', 'Bị chặn'], ['warning', 'Cảnh báo'], ['pass', 'Đạt'], ['vision', 'Chờ Vision'],
              ] as Array<[ReportFilter, string]>).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={filter === id} className={`min-h-11 shrink-0 rounded-xl border px-3 text-[10px] font-semibold ${filter === id ? 'border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100' : 'border-white/[.07] text-zinc-500'}`}>{label}</button>
              ))}
            </div>
          </div>

          {reports.length ? (
            <div className="mt-5 space-y-3">
              {reports.map((report) => {
                const shot = project.shots.find((item) => item.id === report.shotId);
                if (!shot) return null;
                const meta = STATUS_META[report.status];
                const Icon = meta.icon;
                const preview = shot.keyframes.find((frame) => frame.type === 'start')?.imageUrl || shot.keyframes.find((frame) => frame.imageUrl)?.imageUrl;
                const activeIssues = report.issues.filter((issue) => !['resolved'].includes(issue.status));
                const queuedIssues = report.issues.filter((issue) => issue.status === 'queued');
                const automatedActionable = report.issues.some((issue) => issue.status === 'open' && ['voice', 'keyframes', 'video'].includes(issue.repairTarget));
                const manualIssues = report.issues.filter((issue) => issue.status === 'open' && ['script', 'none'].includes(issue.repairTarget));
                const targetedFrames = Array.from(new Set(report.issues.flatMap((issue) => issue.frameTargets || [])));
                return (
                  <article key={report.shotId} className="rounded-2xl border border-white/[.075] bg-black/15 p-4 md:p-5">
                    <div className="grid gap-4 md:grid-cols-[152px_1fr]">
                      <div className="relative aspect-video overflow-hidden rounded-xl border border-white/[.08] bg-black/30">
                        {preview ? <img src={preview} alt={`Keyframe ${shot.actionSummary}`} loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><ImageOff className="h-7 w-7 text-zinc-700" /></div>}
                        {shot.factory?.aspectRatio === '9:16' && <div className="pointer-events-none absolute inset-x-[8%] bottom-[14%] top-[7%] rounded border border-dashed border-cyan-200/60" aria-hidden="true" />}
                        <div className="absolute bottom-2 left-2 rounded-lg border border-white/10 bg-black/75 px-2 py-1 font-mono text-[9px] text-white">{shot.factory?.aspectRatio || 'master'}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`eg-chip ${meta.className}`}><Icon className="h-3 w-3" /> {meta.label}</span><span className={`eg-chip ${report.visionStatus === 'complete' ? 'border-violet-200/20 bg-violet-200/[.07] text-violet-100' : 'border-white/[.08] bg-white/[.03] text-zinc-500'}`}>{report.visionStatus === 'complete' ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />} {report.visionStatus === 'complete' ? 'Vision đã quét' : 'Chờ Vision'}</span></div><h4 className="mt-3 line-clamp-2 text-sm font-semibold text-white">{shot.actionSummary}</h4></div>
                          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full border font-mono text-base font-bold ${report.score >= 80 ? 'border-emerald-200/20 bg-emerald-200/[.06] text-emerald-100' : report.score >= 60 ? 'border-amber-200/20 bg-amber-200/[.06] text-amber-100' : 'border-rose-200/20 bg-rose-200/[.06] text-rose-100'}`} aria-label={`Điểm chất lượng ${report.score} trên 100`}>{report.score}</div>
                        </div>

                        <div className="mt-4 space-y-2">
                          {activeIssues.length ? activeIssues.map((issue) => (
                            <div key={issue.id} className={`flex min-h-14 items-start gap-3 rounded-xl border p-3 ${issue.status === 'ignored' ? 'border-white/[.05] bg-white/[.015] opacity-50' : issue.severity === 'critical' ? 'border-rose-200/15 bg-rose-200/[.035]' : issue.severity === 'warning' ? 'border-amber-200/15 bg-amber-200/[.03]' : 'border-white/[.06] bg-white/[.02]'}`}>
                              <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${issue.severity === 'critical' ? 'bg-rose-300' : issue.severity === 'warning' ? 'bg-amber-300' : 'bg-zinc-500'}`} />
                              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-[11px] text-zinc-200">{issue.title}</strong><span className="font-mono text-[8px] uppercase tracking-wider text-zinc-600">{ISSUE_KIND_LABEL[issue.kind]} · {issue.source === 'ai-vision' ? `AI ${Math.round((issue.confidence || 0) * 100)}%` : 'Local'}{issue.status === 'queued' ? ' · Đã xếp hàng' : ''}</span></div><p className="mt-1 text-[10px] leading-4 text-zinc-600">{issue.detail}</p></div>
                              {issue.status !== 'queued' && <button type="button" onClick={() => toggleIgnored(shot.id, issue)} className="min-h-8 shrink-0 rounded-lg px-2 text-[9px] font-semibold text-zinc-600 hover:bg-white/[.04] hover:text-zinc-300">{issue.status === 'ignored' ? 'Mở lại' : 'Bỏ qua'}</button>}
                            </div>
                          )) : <div className="flex min-h-14 items-center gap-3 rounded-xl border border-emerald-200/15 bg-emerald-200/[.035] p-3 text-[11px] text-emerald-100"><CheckCircle2 className="h-4 w-4" /> Không có lỗi mở trong lần kiểm tra hiện tại.</div>}
                        </div>

                        {(targetedFrames.length > 0 || manualIssues.length > 0) && (
                          <div className="mt-4 flex flex-wrap items-center gap-2 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                            {targetedFrames.map((frame) => <span key={frame} className="eg-chip border-cyan-200/15 bg-cyan-200/[.04] text-cyan-100">Sửa khung {frame === 'start' ? 'đầu' : 'cuối'}</span>)}
                            {manualIssues.length > 0 && <span className="eg-chip border-amber-200/15 bg-amber-200/[.04] text-amber-100">{manualIssues.length} mục cần producer sửa tay</span>}
                          </div>
                        )}

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button type="button" onClick={() => void scanOne(shot.id)} disabled={!preview || visionBusy} className="eg-button-secondary inline-flex min-h-11 flex-1 items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-40">{visionShotId === shot.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Quét Vision · {formatUsd(estimateVisionAuditCost(1))}</button>
                          {queuedIssues.length > 0 ? (
                            <>
                              <button type="button" onClick={() => void runRepair(shot.id)} disabled={Boolean(repairShotId)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-200/20 bg-emerald-200/[.07] px-4 text-xs font-semibold text-emerald-100 disabled:opacity-35">
                                {repairShotId === shot.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {repairShotId === shot.id ? 'Đang sửa shot…' : `Chạy sửa · ${formatUsd(report.repairEstimatedCostUsd || 0)}`}
                              </button>
                              <button type="button" onClick={() => cancelRepair(shot.id)} disabled={Boolean(repairShotId)} aria-label="Hủy kế hoạch sửa" className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-35"><XCircle className="h-4 w-4" /> Hủy</button>
                            </>
                          ) : (
                            <button type="button" onClick={() => queueRepair(shot.id)} disabled={!automatedActionable || visionBusy} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-amber-200/20 bg-amber-200/[.06] px-4 text-xs font-semibold text-amber-100 disabled:opacity-35"><WandSparkles className="h-4 w-4" /> Xếp sửa · {formatUsd(report.repairEstimatedCostUsd || 0)}</button>
                          )}
                          <button type="button" onClick={onOpenDirector} className="eg-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-bold"><Clapperboard className="h-4 w-4" /> Mở shot</button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[.08] px-6 text-center">
              <ScanSearch className="h-10 w-10 text-zinc-700" />
              <h4 className="mt-4 text-sm font-semibold text-zinc-300">Chưa có báo cáo phù hợp</h4>
              <p className="mt-2 max-w-md text-xs leading-5 text-zinc-600">Bấm “Quét miễn phí” để kiểm tra workflow, thoại, Brand Kit, CTA và continuity metadata trước khi trả tiền cho AI Vision.</p>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <section className="eg-panel p-5">
            <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100"><CircleDollarSign className="h-4 w-4" /></div><div><div className="eg-kicker">Budget Guard</div><h3 className="mt-1 text-sm font-semibold text-white">Trần kiểm định & sửa</h3></div></div>
            <div className="mt-5 space-y-4">
              <div><label htmlFor="supervisor-repair-budget" className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ngân sách sửa USD</label><input id="supervisor-repair-budget" type="number" min="0" step="0.1" value={state.policy.repairBudgetUsd} onChange={(event) => updateProject((current) => updateAISupervisorPolicy(current, { ...state.policy, repairBudgetUsd: Number(event.target.value) }))} className="eg-input mt-2 min-h-11 px-3 font-mono text-xs normal-case tracking-normal" /></div>
              <div><label htmlFor="supervisor-vision-budget" className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ngân sách AI Vision USD</label><input id="supervisor-vision-budget" type="number" min="0" step="0.05" value={state.policy.visionBudgetUsd} onChange={(event) => updateProject((current) => updateAISupervisorPolicy(current, { ...state.policy, visionBudgetUsd: Number(event.target.value) }))} className="eg-input mt-2 min-h-11 px-3 font-mono text-xs normal-case tracking-normal" /></div>
              <div><label htmlFor="supervisor-batch-size" className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tối đa shot mỗi batch</label><input id="supervisor-batch-size" type="number" min="1" max="30" value={state.policy.maxVisionShotsPerRun} onChange={(event) => updateProject((current) => updateAISupervisorPolicy(current, { ...state.policy, maxVisionShotsPerRun: Number(event.target.value) }))} className="eg-input mt-2 min-h-11 px-3 font-mono text-xs normal-case tracking-normal" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label htmlFor="supervisor-confidence" className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tin cậy tối thiểu %</label><input id="supervisor-confidence" type="number" min="0" max="100" step="1" value={Math.round(state.policy.minimumVisionConfidence * 100)} onChange={(event) => updateProject((current) => updateAISupervisorPolicy(current, { ...state.policy, minimumVisionConfidence: Number(event.target.value) / 100 }))} className="eg-input mt-2 min-h-11 px-3 font-mono text-xs normal-case tracking-normal" /></div>
                <div><label htmlFor="supervisor-critical-confidence" className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ngưỡng chặn %</label><input id="supervisor-critical-confidence" type="number" min="0" max="100" step="1" value={Math.round(state.policy.criticalVisionConfidence * 100)} onChange={(event) => updateProject((current) => updateAISupervisorPolicy(current, { ...state.policy, criticalVisionConfidence: Number(event.target.value) / 100 }))} className="eg-input mt-2 min-h-11 px-3 font-mono text-xs normal-case tracking-normal" /></div>
              </div>
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-black/20 px-3 text-[10px] font-semibold text-zinc-400"><span>Bắt buộc Vision trước khi release</span><input type="checkbox" checked={state.policy.requireVisionForRelease} onChange={(event) => updateProject((current) => updateAISupervisorPolicy(current, { ...state.policy, requireVisionForRelease: event.target.checked }))} className="h-4 w-4 accent-cyan-300" /></label>
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-black/20 px-3 text-[10px] font-semibold text-zinc-400"><span>Xác nhận trước khi gọi API sửa</span><input type="checkbox" checked={state.policy.requireHumanApproval} onChange={(event) => updateProject((current) => updateAISupervisorPolicy(current, { ...state.policy, requireHumanApproval: event.target.checked }))} className="h-4 w-4 accent-cyan-300" /></label>
            </div>
            <div className="mt-5 rounded-xl border border-white/[.07] bg-black/20 p-4">
              <div className="flex justify-between text-[10px]"><span className="text-zinc-600">Đã cam kết sửa</span><strong className="font-mono text-white">{formatUsd(state.repairCommittedCostUsd)} / {formatUsd(state.policy.repairBudgetUsd)}</strong></div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className={`h-full rounded-full ${repairPercent >= 90 ? 'bg-rose-300' : repairPercent >= 70 ? 'bg-amber-300' : 'bg-[var(--eg-accent)]'}`} style={{ width: `${repairPercent}%` }} /></div>
              <div className="mt-3 flex justify-between text-[10px]"><span className="text-zinc-600">Vision đã dùng</span><strong className="font-mono text-white">{formatUsd(state.visionSpentUsd)} / {formatUsd(state.policy.visionBudgetUsd)}</strong></div>
            </div>
            <button type="button" onClick={onShowModelConfig} className="eg-button-secondary mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-xs font-semibold"><Sparkles className="h-4 w-4" /> Chọn model Vision</button>
            <p className="mt-3 text-[10px] leading-4 text-zinc-600">Supervisor dùng model hội thoại đang chọn. Model đó phải hỗ trợ ảnh; nếu không, hãy chọn Gemini/GPT/Claude có vision.</p>
          </section>

          <section className="eg-panel p-5">
            <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100"><ShieldCheck className="h-4 w-4" /></div><div><div className="eg-kicker">Safety contract</div><h3 className="mt-1 text-sm font-semibold text-white">Không sửa vượt quyền</h3></div></div>
            <div className="mt-4 space-y-3 text-[10px] leading-4 text-zinc-500">
              <p>• Local audit luôn miễn phí và không gửi media ra ngoài.</p>
              <p>• Vision chỉ chạy sau hộp xác nhận có dự toán.</p>
              <p>• Xếp sửa chỉ khóa ngân sách; nút “Chạy sửa” mới gọi API.</p>
              <p>• Chỉ tạo lại khung đầu/cuối bị lỗi rồi dựng lại đúng video đó.</p>
              <p>• Lỗi thoại, Brand Kit hoặc cấu hình phải được producer sửa thủ công.</p>
              <p>• Lệnh bị chặn ngay khi vượt ngân sách còn lại.</p>
            </div>
          </section>
        </aside>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="eg-card p-4"><Gauge className="h-4 w-4 text-cyan-100/70" /><h4 className="mt-3 text-xs font-semibold text-white">QC hai tầng</h4><p className="mt-2 text-[10px] leading-4 text-zinc-600">Rule engine bắt lỗi chắc chắn trước; AI Vision chỉ xử lý phần cần nhìn ảnh.</p></div>
        <div className="eg-card p-4"><RotateCcw className="h-4 w-4 text-amber-100/70" /><h4 className="mt-3 text-xs font-semibold text-white">Selective regenerate</h4><p className="mt-2 text-[10px] leading-4 text-zinc-600">Không chạy lại campaign hay variant. Vision chỉ định đúng khung lỗi; Supervisor tạo lại khung đó rồi dựng lại video của shot.</p></div>
        <div className="eg-card p-4"><ShieldCheck className="h-4 w-4 text-emerald-100/70" /><h4 className="mt-3 text-xs font-semibold text-white">Media-aware</h4><p className="mt-2 text-[10px] leading-4 text-zinc-600">Khi keyframe/video đổi, kết quả Vision cũ tự mất hiệu lực để tránh duyệt nhầm.</p></div>
      </section>
    </div>
  );
};

export default AISupervisor;
