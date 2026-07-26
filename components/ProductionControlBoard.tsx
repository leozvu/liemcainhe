import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
  XCircle,
} from 'lucide-react';
import {
  CoreStage,
  ProductionApprovalStatus,
  ProductionTaskPriority,
  ProductionTaskStatus,
  ProjectState,
} from '../types';
import {
  addProductionTask,
  createProductionTask,
  deleteProductionTask,
  getProductionControlSummary,
  initializeProductionControl,
  PRODUCTION_STAGE_LABELS,
  setProductionApprovalGate,
  updateProductionTask,
} from '../services/productionControlService';
import { useAlert } from './GlobalAlert';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((previous: ProjectState) => ProjectState)) => void;
}

const STATUS_COLUMNS: Array<{ id: ProductionTaskStatus; label: string; detail: string }> = [
  { id: 'todo', label: 'Chờ làm', detail: 'Chưa bắt đầu' },
  { id: 'in-progress', label: 'Đang làm', detail: 'Team đang thực thi' },
  { id: 'review', label: 'Chờ duyệt', detail: 'Sẵn sàng kiểm tra' },
  { id: 'done', label: 'Hoàn tất', detail: 'Đã qua cổng duyệt' },
  { id: 'blocked', label: 'Bị chặn', detail: 'Cần producer xử lý' },
];

const PRIORITY_LABELS: Record<ProductionTaskPriority, string> = {
  low: 'Thấp',
  normal: 'Bình thường',
  high: 'Cao',
  urgent: 'Khẩn cấp',
};

const SOURCE_LABELS = { template: 'Quy trình Egoric', director: 'Đạo diễn AI', manual: 'Thủ công' } as const;

const toDateInput = (timestamp?: number): string => timestamp ? new Date(timestamp).toISOString().slice(0, 10) : '';
const parseDateInput = (value: string): number | undefined => value ? new Date(`${value}T18:00:00`).getTime() : undefined;

const gateMeta = (status: ReturnType<typeof getProductionControlSummary>['gates'][number]['status']) => ({
  locked: { label: 'Đang khóa', icon: LockKeyhole, tone: 'border-white/[.08] bg-white/[.025] text-zinc-500' },
  ready: { label: 'Sẵn sàng duyệt', icon: ClipboardCheck, tone: 'border-cyan-200/20 bg-cyan-200/[.06] text-cyan-100' },
  pending: { label: 'Chờ hoàn thiện', icon: CircleDashed, tone: 'border-white/[.08] bg-white/[.025] text-zinc-500' },
  approved: { label: 'Đã phê duyệt', icon: CheckCircle2, tone: 'border-emerald-200/20 bg-emerald-200/[.06] text-emerald-100' },
  'changes-requested': { label: 'Cần chỉnh sửa', icon: AlertTriangle, tone: 'border-amber-200/20 bg-amber-200/[.06] text-amber-100' },
}[status]);

const emptyDraft = () => ({
  title: '',
  detail: '',
  stage: 'script' as CoreStage,
  priority: 'normal' as ProductionTaskPriority,
  assignee: 'Egoric Team',
  dueAt: '',
  requiresApproval: true,
});

const ProductionControlBoard: React.FC<Props> = ({ project, updateProject }) => {
  const { showAlert } = useAlert();
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [formError, setFormError] = useState('');
  const tasks = project.workflow?.productionTasks || [];
  const summary = useMemo(() => getProductionControlSummary(project), [project]);

  const syncPlan = () => {
    const previousCount = tasks.length;
    updateProject((current) => initializeProductionControl(current));
    const directorItems = (project.creativeDirector?.plan?.length || 0) + (project.creativeDirector?.productionPlan?.length || 0);
    showAlert(previousCount
      ? `Đã đồng bộ lại bảng team${directorItems ? ' với kế hoạch mới từ Đạo diễn AI' : ''}.`
      : 'Đã tạo bảng production chuẩn Egoric cho dự án.', { type: 'success' });
  };

  const submitTask = () => {
    setFormError('');
    try {
      const task = createProductionTask({
        title: draft.title,
        detail: draft.detail,
        stage: draft.stage,
        priority: draft.priority,
        assignee: draft.assignee,
        dueAt: parseDateInput(draft.dueAt),
        requiresApproval: draft.requiresApproval,
      });
      updateProject((current) => addProductionTask(current, task));
      setDraft(emptyDraft());
      setShowTaskForm(false);
      showAlert('Đã thêm công việc vào bảng production.', { type: 'success' });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể thêm công việc.');
    }
  };

  const changeGate = (stage: CoreStage, status: ProductionApprovalStatus) => {
    try {
      const next = setProductionApprovalGate(project, stage, status);
      updateProject(next);
      showAlert(status === 'approved'
        ? `Đã phê duyệt công đoạn ${PRODUCTION_STAGE_LABELS[stage]}.`
        : status === 'changes-requested'
          ? `Đã trả công đoạn ${PRODUCTION_STAGE_LABELS[stage]} về team chỉnh sửa.`
          : `Đã mở lại cổng duyệt ${PRODUCTION_STAGE_LABELS[stage]}.`, { type: status === 'changes-requested' ? 'warning' : 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể cập nhật cổng duyệt.', { type: 'warning' });
    }
  };

  const removeTask = (taskId: string, title: string) => {
    showAlert(`Xóa công việc “${title}” khỏi bảng production?`, {
      type: 'warning',
      showCancel: true,
      onConfirm: () => updateProject((current) => deleteProductionTask(current, taskId)),
    });
  };

  return (
    <div className="space-y-6">
      <section className="eg-panel relative overflow-hidden p-5 md:p-7">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-cyan-200/[.07] blur-3xl" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap gap-2">
              <span className="eg-chip border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100"><UsersRound className="h-3 w-3" /> Production Control</span>
              {summary.blockedTasks > 0 && <span className="eg-chip border-rose-200/20 bg-rose-200/[.07] text-rose-100"><XCircle className="h-3 w-3" /> {summary.blockedTasks} việc bị chặn</span>}
              {summary.overdueTasks > 0 && <span className="eg-chip border-amber-200/20 bg-amber-200/[.07] text-amber-100"><Clock3 className="h-3 w-3" /> {summary.overdueTasks} quá hạn</span>}
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-.03em] text-white md:text-3xl">Bảng điều phối team sản xuất</h2>
            <p className="mt-3 max-w-2xl text-xs leading-6 text-zinc-400">Giao việc, theo dõi bottleneck và khóa từng công đoạn trước khi team phát sinh chi phí ở bước tiếp theo.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={syncPlan} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold"><RefreshCw className="h-4 w-4" /> {tasks.length ? 'Đồng bộ kế hoạch AI' : 'Khởi tạo bảng team'}</button>
            <button type="button" onClick={() => setShowTaskForm((value) => !value)} className="eg-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-bold"><Plus className="h-4 w-4" /> Thêm công việc</button>
          </div>
        </div>
        <div className="relative mt-7 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ['Tiến độ team', `${summary.progress}%`],
            ['Đang xử lý', summary.activeTasks],
            ['Hoàn tất', `${summary.completedTasks}/${summary.totalTasks}`],
            ['Cổng sẵn sàng', summary.readyGates],
            ['Cổng đã duyệt', `${summary.approvedGates}/5`],
          ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-white/[.07] bg-black/20 p-4"><div className="font-mono text-xl font-semibold tabular-nums text-white">{value}</div><p className="mt-1 text-[10px] text-zinc-600">{label}</p></div>)}
        </div>
        {summary.alerts.length > 0 && <div className="relative mt-4 flex flex-wrap gap-2">{summary.alerts.map((alert) => <span key={alert} className="inline-flex items-center gap-2 rounded-full border border-amber-200/15 bg-amber-200/[.045] px-3 py-2 text-[10px] text-amber-50/70"><AlertTriangle className="h-3 w-3" /> {alert}</span>)}</div>}
      </section>

      {showTaskForm && (
        <section className="eg-panel p-5 md:p-6" aria-labelledby="new-production-task-title">
          <div className="flex items-start justify-between gap-3"><div><div className="eg-kicker">New task</div><h3 id="new-production-task-title" className="mt-1 text-base font-semibold text-white">Thêm công việc production</h3></div><button type="button" onClick={() => { setShowTaskForm(false); setFormError(''); }} className="eg-icon-button flex h-11 w-11 items-center justify-center" aria-label="Đóng form thêm công việc"><XCircle className="h-4 w-4" /></button></div>
          {formError && <p role="alert" className="mt-4 rounded-xl border border-rose-200/20 bg-rose-200/[.06] p-3 text-xs text-rose-100">{formError}</p>}
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 xl:col-span-2">Tên công việc *<input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal" placeholder="Ví dụ: Duyệt hook kịch bản V2" /></label>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Công đoạn<select value={draft.stage} onChange={(event) => setDraft((current) => ({ ...current, stage: event.target.value as CoreStage }))} className="eg-input mt-2 px-3 text-xs normal-case tracking-normal">{(Object.keys(PRODUCTION_STAGE_LABELS) as CoreStage[]).map((stage) => <option key={stage} value={stage}>{PRODUCTION_STAGE_LABELS[stage]}</option>)}</select></label>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ưu tiên<select value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as ProductionTaskPriority }))} className="eg-input mt-2 px-3 text-xs normal-case tracking-normal">{(Object.keys(PRIORITY_LABELS) as ProductionTaskPriority[]).map((priority) => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}</select></label>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 xl:col-span-2">Mô tả<textarea value={draft.detail} onChange={(event) => setDraft((current) => ({ ...current, detail: event.target.value }))} rows={3} className="eg-input mt-2 min-h-24 resize-y px-4 py-3 text-sm font-normal leading-5 normal-case tracking-normal" /></label>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Người phụ trách<input value={draft.assignee} onChange={(event) => setDraft((current) => ({ ...current, assignee: event.target.value }))} className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal" /></label>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Deadline<input type="date" value={draft.dueAt} onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))} className="eg-input mt-2 px-3 text-xs normal-case tracking-normal" /></label>
          </div>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><label className="flex min-h-11 items-center gap-3 text-xs text-zinc-400"><input type="checkbox" checked={draft.requiresApproval} onChange={(event) => setDraft((current) => ({ ...current, requiresApproval: event.target.checked }))} className="accent-cyan-200" /> Công việc cần producer duyệt</label><button type="button" onClick={submitTask} className="eg-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-6 text-xs font-bold"><Plus className="h-4 w-4" /> Lưu công việc</button></div>
        </section>
      )}

      <section>
        <div className="mb-3"><div className="eg-kicker">Approval gates</div><h2 className="mt-1 text-lg font-semibold text-white">Cổng duyệt theo công đoạn</h2><p className="mt-2 text-xs text-zinc-600">Cổng chỉ mở khi mọi công việc trong công đoạn đã hoàn tất hoặc chuyển sang chờ duyệt.</p></div>
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-5">
          {summary.gates.map((gate) => {
            const meta = gateMeta(gate.status);
            const Icon = meta.icon;
            return <article key={gate.stage} className={`rounded-2xl border p-4 ${meta.tone}`}>
              <div className="flex items-start justify-between gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-current/15 bg-black/10"><Icon className="h-4 w-4" /></span><span className="font-mono text-[9px] tabular-nums opacity-60">{gate.complete}/{gate.total}</span></div>
              <h3 className="mt-4 text-xs font-semibold text-white">{gate.label}</h3><p className="mt-1 text-[10px] opacity-70">{meta.label}</p>
              {gate.reviewer && <p className="mt-2 flex items-center gap-1.5 text-[9px] opacity-60"><UserRound className="h-3 w-3" /> {gate.reviewer}</p>}
              <div className="mt-4 grid gap-2">
                {gate.status === 'ready' && <><button type="button" onClick={() => changeGate(gate.stage, 'approved')} className="min-h-11 rounded-xl border border-emerald-200/20 bg-emerald-200/[.08] px-3 text-[10px] font-semibold text-emerald-50"><Check className="mr-1.5 inline h-3.5 w-3.5" /> Phê duyệt</button><button type="button" onClick={() => changeGate(gate.stage, 'changes-requested')} className="min-h-11 rounded-xl border border-white/10 px-3 text-[10px] font-semibold">Yêu cầu sửa</button></>}
                {gate.status === 'changes-requested' && <button type="button" onClick={() => changeGate(gate.stage, 'pending')} className="min-h-11 rounded-xl border border-white/10 px-3 text-[10px] font-semibold">Gửi lại cổng duyệt</button>}
                {gate.status === 'approved' && <button type="button" onClick={() => changeGate(gate.stage, 'pending')} className="min-h-11 rounded-xl border border-white/10 px-3 text-[10px] font-semibold opacity-70">Mở lại duyệt</button>}
                {(gate.status === 'locked' || gate.status === 'pending') && <button type="button" disabled className="min-h-11 cursor-not-allowed rounded-xl border border-white/[.06] px-3 text-[10px] font-semibold opacity-40">{gate.total ? 'Chưa đủ điều kiện' : 'Chưa có công việc'}</button>}
              </div>
            </article>;
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><div className="eg-kicker">Team workload</div><h2 className="mt-1 text-lg font-semibold text-white">Luồng công việc</h2></div><span className="text-[10px] text-zinc-600">Cập nhật bằng trạng thái, không cần kéo thả</span></div>
        {tasks.length === 0 ? (
          <div className="eg-panel flex min-h-72 flex-col items-center justify-center p-8 text-center"><UsersRound className="h-10 w-10 text-zinc-700" /><h3 className="mt-4 text-sm font-semibold text-zinc-300">Chưa có bảng công việc</h3><p className="mt-2 max-w-md text-xs leading-5 text-zinc-600">Khởi tạo quy trình Egoric để nhận checklist chuẩn và nhập kế hoạch từ Đạo diễn AI.</p><button type="button" onClick={syncPlan} className="eg-button-primary mt-5 inline-flex min-h-11 items-center justify-center gap-2 px-5 text-xs font-bold"><RefreshCw className="h-4 w-4" /> Khởi tạo bảng team</button></div>
        ) : (
          <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5" aria-label="Bảng công việc production">
            {STATUS_COLUMNS.map((column) => {
              const columnTasks = tasks.filter((task) => task.status === column.id);
              return <section key={column.id} className="min-w-0 rounded-2xl border border-white/[.07] bg-white/[.018] p-3" aria-labelledby={`production-column-${column.id}`}>
                <header className="flex min-h-14 items-start justify-between gap-3 px-1 pb-3"><div><h3 id={`production-column-${column.id}`} className="text-xs font-semibold text-zinc-200">{column.label}</h3><p className="mt-1 text-[9px] text-zinc-700">{column.detail}</p></div><span className="flex h-7 min-w-7 items-center justify-center rounded-lg border border-white/[.08] bg-black/20 px-2 font-mono text-[9px] text-zinc-500">{columnTasks.length}</span></header>
                <div className="space-y-3">{columnTasks.map((task) => {
                  const overdue = Boolean(task.dueAt && task.dueAt < Date.now() && task.status !== 'done');
                  return <article key={task.id} className="eg-card p-4">
                    <div className="flex items-start justify-between gap-3"><div className="flex flex-wrap gap-1.5"><span className="eg-chip border-white/[.08] bg-white/[.035] text-zinc-400">{PRODUCTION_STAGE_LABELS[task.stage]}</span>{task.priority !== 'normal' && <span className={`eg-chip ${task.priority === 'urgent' ? 'border-rose-200/20 bg-rose-200/[.06] text-rose-100' : task.priority === 'high' ? 'border-amber-200/20 bg-amber-200/[.06] text-amber-100' : 'text-zinc-500'}`}>{PRIORITY_LABELS[task.priority]}</span>}</div><button type="button" onClick={() => removeTask(task.id, task.title)} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center text-zinc-700 hover:text-rose-200" aria-label={`Xóa công việc ${task.title}`}><Trash2 className="h-4 w-4" /></button></div>
                    <h4 className="mt-3 text-sm font-semibold leading-5 text-white">{task.title}</h4>{task.detail && <p className="mt-2 text-[10px] leading-4 text-zinc-600">{task.detail}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[9px] text-zinc-700"><span>{SOURCE_LABELS[task.source]}</span>{task.requiresApproval && <span className="inline-flex items-center gap-1 text-cyan-100/60"><ShieldCheck className="h-3 w-3" /> Cần duyệt</span>}</div>
                    <label className="mt-4 block text-[9px] font-semibold uppercase tracking-wider text-zinc-600">Trạng thái<select value={task.status} onChange={(event) => updateProject((current) => updateProductionTask(current, task.id, { status: event.target.value as ProductionTaskStatus }))} className="eg-input mt-2 px-3 text-xs normal-case tracking-normal">{STATUS_COLUMNS.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select></label>
                    <label className="mt-3 block text-[9px] font-semibold uppercase tracking-wider text-zinc-600">Phụ trách<input defaultValue={task.assignee} onBlur={(event) => updateProject((current) => updateProductionTask(current, task.id, { assignee: event.target.value }))} className="eg-input mt-2 px-3 text-xs font-normal normal-case tracking-normal" aria-label={`Người phụ trách ${task.title}`} /></label>
                    <label className={`mt-3 block text-[9px] font-semibold uppercase tracking-wider ${overdue ? 'text-rose-200' : 'text-zinc-600'}`}>Deadline<input type="date" value={toDateInput(task.dueAt)} onChange={(event) => updateProject((current) => updateProductionTask(current, task.id, { dueAt: parseDateInput(event.target.value) }))} className="eg-input mt-2 px-3 text-xs font-normal normal-case tracking-normal" aria-label={`Deadline ${task.title}`} /></label>
                  </article>;
                })}{columnTasks.length === 0 && <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-white/[.06] px-3 text-center text-[9px] leading-4 text-zinc-700">Chưa có công việc</div>}</div>
              </section>;
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default ProductionControlBoard;
