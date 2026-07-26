import {
  AgencyCampaign,
  CoreStage,
  ProductionApprovalGate,
  ProductionApprovalStatus,
  ProductionTask,
  ProductionTaskPriority,
  ProductionTaskSource,
  ProductionTaskStatus,
  ProjectState,
} from '../types';
import { getAllAgencyCampaigns, saveAgencyCampaign } from './storageService';
import { createDefaultWorkflowState } from './workflowService';

export const PRODUCTION_STAGE_LABELS: Record<CoreStage, string> = {
  script: 'Kịch bản',
  assets: 'Tài nguyên',
  voice: 'Giọng thoại',
  director: 'Dựng cảnh',
  export: 'Xuất bản',
};

const CORE_STAGES: CoreStage[] = ['script', 'assets', 'voice', 'director', 'export'];
const createId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const normalizeTitle = (value: string): string => value.trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ');

const TASK_TEMPLATES: Array<Pick<ProductionTask, 'title' | 'detail' | 'stage' | 'priority' | 'requiresApproval'>> = [
  { title: 'Chốt creative direction', detail: 'Khóa insight, big idea, thông điệp và tone chính.', stage: 'script', priority: 'high', requiresApproval: true },
  { title: 'Duyệt kịch bản quay', detail: 'Kiểm tra hook, nhịp kể, CTA và thời lượng.', stage: 'script', priority: 'urgent', requiresApproval: true },
  { title: 'Khóa Visual Bible', detail: 'Chốt nhân vật, bối cảnh, palette và quy tắc continuity.', stage: 'assets', priority: 'high', requiresApproval: true },
  { title: 'Duyệt reference sản xuất', detail: 'Xác nhận reference đủ dùng trước khi tạo batch.', stage: 'assets', priority: 'normal', requiresApproval: true },
  { title: 'Casting và test giọng', detail: 'Chọn giọng, nhịp đọc và quy tắc phát âm.', stage: 'voice', priority: 'normal', requiresApproval: false },
  { title: 'Duyệt bản thoại cuối', detail: 'Nghe toàn bộ take đã chọn trước khi dựng.', stage: 'voice', priority: 'high', requiresApproval: true },
  { title: 'Khóa storyboard', detail: 'Chốt bố cục, chuyển động máy và nhịp từng cảnh.', stage: 'director', priority: 'high', requiresApproval: true },
  { title: 'Duyệt rough cut', detail: 'Kiểm tra continuity, nhịp dựng và lỗi media.', stage: 'director', priority: 'urgent', requiresApproval: true },
  { title: 'QC bản master', detail: 'Kiểm tra âm thanh, phụ đề, tỷ lệ và thông số xuất.', stage: 'export', priority: 'high', requiresApproval: true },
  { title: 'Phê duyệt bàn giao', detail: 'Xác nhận bản phát hành và gói file bàn giao.', stage: 'export', priority: 'urgent', requiresApproval: true },
];

export interface CreateProductionTaskInput {
  title: string;
  detail?: string;
  stage: CoreStage;
  status?: ProductionTaskStatus;
  priority?: ProductionTaskPriority;
  source?: ProductionTaskSource;
  assignee?: string;
  dueAt?: number;
  requiresApproval?: boolean;
}

export interface ProductionGateView {
  stage: CoreStage;
  label: string;
  status: ProductionApprovalStatus | 'ready' | 'locked';
  complete: number;
  total: number;
  reviewer?: string;
  note?: string;
}

export interface ProductionControlSummary {
  progress: number;
  totalTasks: number;
  completedTasks: number;
  activeTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  unassignedTasks: number;
  readyGates: number;
  approvedGates: number;
  gates: ProductionGateView[];
  alerts: string[];
}

export const createProductionTask = (input: CreateProductionTaskInput): ProductionTask => {
  const title = input.title.trim();
  if (!title) throw new Error('Tên công việc không được để trống.');
  const now = Date.now();
  return {
    id: createId('production_task'),
    title,
    detail: input.detail?.trim() || undefined,
    stage: input.stage,
    status: input.status || 'todo',
    priority: input.priority || 'normal',
    source: input.source || 'manual',
    assignee: input.assignee?.trim() || 'Chưa phân công',
    dueAt: input.dueAt,
    requiresApproval: input.requiresApproval ?? false,
    createdAt: now,
    updatedAt: now,
  };
};

const inferStage = (value: string): CoreStage => {
  const normalized = normalizeTitle(value);
  if (/(voice|giọng|thoại|thu âm|lồng tiếng)/.test(normalized)) return 'voice';
  if (/(storyboard|shot|cảnh quay|dựng|rough cut|camera|video)/.test(normalized)) return 'director';
  if (/(visual|moodboard|reference|nhân vật|bối cảnh|hình ảnh|asset)/.test(normalized)) return 'assets';
  if (/(export|xuất|master|qc|bàn giao|phụ đề)/.test(normalized)) return 'export';
  return 'script';
};

const createDefaultGates = (current: ProductionApprovalGate[] = []): ProductionApprovalGate[] => CORE_STAGES.map((stage) => (
  current.find((gate) => gate.stage === stage) || { stage, status: 'pending', updatedAt: Date.now() }
));

export const initializeProductionControl = (project: ProjectState, defaultAssignee = 'Egoric Team'): ProjectState => {
  const workflow = project.workflow || createDefaultWorkflowState();
  const existing = workflow.productionTasks || [];
  const titles = new Set(existing.map((task) => normalizeTitle(task.title)));
  const generated: ProductionTask[] = [];

  const append = (input: CreateProductionTaskInput) => {
    const key = normalizeTitle(input.title);
    if (!key || titles.has(key)) return;
    titles.add(key);
    generated.push(createProductionTask({ ...input, assignee: input.assignee || defaultAssignee }));
  };

  TASK_TEMPLATES.forEach((template) => append({ ...template, source: 'template' }));
  (project.creativeDirector?.plan || []).forEach((step) => append({
    title: step.title,
    detail: step.detail,
    stage: step.stage,
    status: step.status === 'blocked' ? 'blocked' : 'todo',
    priority: step.status === 'blocked' ? 'high' : 'normal',
    source: 'director',
  }));
  (project.creativeDirector?.productionPlan || []).forEach((item) => append({
    title: item,
    stage: inferStage(item),
    priority: 'normal',
    source: 'director',
  }));

  return {
    ...project,
    lastModified: Date.now(),
    workflow: {
      ...workflow,
      productionTasks: [...existing, ...generated],
      approvalGates: createDefaultGates(workflow.approvalGates),
    },
  };
};

export const addProductionTask = (project: ProjectState, task: ProductionTask): ProjectState => {
  const workflow = project.workflow || createDefaultWorkflowState();
  return {
    ...project,
    lastModified: Date.now(),
    workflow: {
      ...workflow,
      productionTasks: [...(workflow.productionTasks || []), task],
      approvalGates: createDefaultGates(workflow.approvalGates),
    },
  };
};

export const updateProductionTask = (
  project: ProjectState,
  taskId: string,
  updates: Partial<Omit<ProductionTask, 'id' | 'createdAt' | 'updatedAt'>>,
): ProjectState => {
  const workflow = project.workflow || createDefaultWorkflowState();
  const current = (workflow.productionTasks || []).find((task) => task.id === taskId);
  if (!current) return project;
  const materialChange = (
    (updates.status !== undefined && updates.status !== current.status)
    || (updates.stage !== undefined && updates.stage !== current.stage)
    || (updates.title !== undefined && updates.title.trim() !== current.title)
    || (updates.detail !== undefined && updates.detail.trim() !== (current.detail || ''))
    || (updates.requiresApproval !== undefined && updates.requiresApproval !== current.requiresApproval)
  );
  const affectedStages = new Set<CoreStage>([current.stage, updates.stage || current.stage]);
  const gates = createDefaultGates(workflow.approvalGates).map((gate) => (
    materialChange && affectedStages.has(gate.stage) && gate.status === 'approved'
      ? { ...gate, status: 'pending' as const, reviewer: undefined, note: 'Cổng duyệt được mở lại vì công việc đã thay đổi.', updatedAt: Date.now() }
      : gate
  ));
  return {
    ...project,
    lastModified: Date.now(),
    workflow: {
      ...workflow,
      productionTasks: (workflow.productionTasks || []).map((task) => task.id === taskId
        ? {
            ...task,
            ...updates,
            title: updates.title?.trim() || task.title,
            assignee: updates.assignee !== undefined ? updates.assignee.trim() || 'Chưa phân công' : task.assignee,
            updatedAt: Date.now(),
          }
        : task),
      approvalGates: gates,
    },
  };
};

export const deleteProductionTask = (project: ProjectState, taskId: string): ProjectState => {
  const workflow = project.workflow || createDefaultWorkflowState();
  const task = (workflow.productionTasks || []).find((item) => item.id === taskId);
  if (!task) return project;
  return {
    ...project,
    lastModified: Date.now(),
    workflow: {
      ...workflow,
      productionTasks: (workflow.productionTasks || []).filter((item) => item.id !== taskId),
      approvalGates: createDefaultGates(workflow.approvalGates).map((gate) => gate.stage === task.stage
        ? { ...gate, status: 'pending' as const, reviewer: undefined, updatedAt: Date.now() }
        : gate),
    },
  };
};

export const getProductionControlSummary = (project: ProjectState, now = Date.now()): ProductionControlSummary => {
  const tasks = project.workflow?.productionTasks || [];
  const approvals = createDefaultGates(project.workflow?.approvalGates);
  const gates: ProductionGateView[] = CORE_STAGES.map((stage) => {
    const stageTasks = tasks.filter((task) => task.stage === stage);
    const approval = approvals.find((gate) => gate.stage === stage)!;
    const complete = stageTasks.filter((task) => ['review', 'done'].includes(task.status)).length;
    const ready = stageTasks.length > 0 && complete === stageTasks.length;
    return {
      stage,
      label: PRODUCTION_STAGE_LABELS[stage],
      status: approval.status === 'approved' || approval.status === 'changes-requested'
        ? approval.status
        : ready ? 'ready' : 'locked',
      complete,
      total: stageTasks.length,
      reviewer: approval.reviewer,
      note: approval.note,
    };
  });
  const statusWeight: Record<ProductionTaskStatus, number> = { todo: 0, 'in-progress': 40, blocked: 15, review: 80, done: 100 };
  const completedTasks = tasks.filter((task) => task.status === 'done').length;
  const activeTasks = tasks.filter((task) => ['in-progress', 'review'].includes(task.status)).length;
  const overdueTasks = tasks.filter((task) => task.dueAt && task.dueAt < now && task.status !== 'done').length;
  const blockedTasks = tasks.filter((task) => task.status === 'blocked').length;
  const unassignedTasks = tasks.filter((task) => !task.assignee.trim() || task.assignee === 'Chưa phân công').length;
  const readyGates = gates.filter((gate) => gate.status === 'ready').length;
  const approvedGates = gates.filter((gate) => gate.status === 'approved').length;
  const alerts: string[] = [];
  if (blockedTasks) alerts.push(`${blockedTasks} công việc đang bị chặn.`);
  if (overdueTasks) alerts.push(`${overdueTasks} công việc đã quá deadline.`);
  if (unassignedTasks) alerts.push(`${unassignedTasks} công việc chưa có người phụ trách.`);
  if (readyGates) alerts.push(`${readyGates} công đoạn đã sẵn sàng để duyệt.`);
  return {
    progress: tasks.length ? Math.round(tasks.reduce((sum, task) => sum + statusWeight[task.status], 0) / tasks.length) : 0,
    totalTasks: tasks.length,
    completedTasks,
    activeTasks,
    overdueTasks,
    blockedTasks,
    unassignedTasks,
    readyGates,
    approvedGates,
    gates,
    alerts,
  };
};

export const setProductionApprovalGate = (
  project: ProjectState,
  stage: CoreStage,
  status: ProductionApprovalStatus,
  reviewer = 'Egoric Team',
  note?: string,
): ProjectState => {
  const workflow = project.workflow || createDefaultWorkflowState();
  const tasks = workflow.productionTasks || [];
  const stageTasks = tasks.filter((task) => task.stage === stage);
  if (status === 'approved' && (!stageTasks.length || stageTasks.some((task) => !['review', 'done'].includes(task.status)))) {
    throw new Error(`Hãy hoàn tất hoặc chuyển toàn bộ công việc ${PRODUCTION_STAGE_LABELS[stage]} sang chờ duyệt trước.`);
  }
  const now = Date.now();
  const gates = createDefaultGates(workflow.approvalGates).map((gate) => gate.stage === stage
    ? { ...gate, status, reviewer: reviewer.trim() || 'Egoric Team', note: note?.trim() || undefined, updatedAt: now }
    : gate);
  return {
    ...project,
    lastModified: now,
    workflow: {
      ...workflow,
      productionTasks: tasks.map((task) => {
        if (task.stage !== stage) return task;
        if (status === 'approved' && task.status === 'review') return { ...task, status: 'done' as const, updatedAt: now };
        if (status === 'changes-requested' && task.status === 'review') return { ...task, status: 'in-progress' as const, updatedAt: now };
        return task;
      }),
      approvalGates: gates,
    },
  };
};

const deriveCampaignStatus = (campaign: AgencyCampaign): AgencyCampaign['status'] => {
  if (campaign.status === 'paused') return 'paused';
  if (campaign.deliverables.every((item) => item.status === 'delivered')) return 'delivered';
  if (campaign.deliverables.some((item) => ['review', 'approved'].includes(item.status))) return 'review';
  if (campaign.deliverables.some((item) => item.status === 'in-progress')) return 'production';
  return campaign.status === 'brief' ? 'planning' : campaign.status;
};

export const syncLinkedCampaignFromProject = async (project: ProjectState): Promise<void> => {
  if (!project.campaignId || !project.deliverableId) return;
  const tasks = project.workflow?.productionTasks || [];
  if (!tasks.length || !tasks.some((task) => ['in-progress', 'review', 'done'].includes(task.status))) return;
  const campaigns = await getAllAgencyCampaigns();
  const campaign = campaigns.find((item) => item.id === project.campaignId);
  if (!campaign) return;
  const summary = getProductionControlSummary(project);
  const relevantGates = summary.gates.filter((gate) => gate.total > 0);
  const allApproved = relevantGates.length > 0 && relevantGates.every((gate) => gate.status === 'approved');
  const hasReview = tasks.some((task) => task.status === 'review') || summary.readyGates > 0;
  const nextDeliverableStatus = allApproved ? 'approved' : hasReview ? 'review' : 'in-progress';
  const deliverables = campaign.deliverables.map((deliverable) => deliverable.id === project.deliverableId && deliverable.status !== 'delivered'
    ? { ...deliverable, status: nextDeliverableStatus as AgencyCampaign['deliverables'][number]['status'] }
    : deliverable);
  const nextCampaign: AgencyCampaign = { ...campaign, deliverables, updatedAt: Date.now() };
  nextCampaign.status = deriveCampaignStatus(nextCampaign);
  if (JSON.stringify(nextCampaign.deliverables) === JSON.stringify(campaign.deliverables) && nextCampaign.status === campaign.status) return;
  await saveAgencyCampaign(nextCampaign);
};
