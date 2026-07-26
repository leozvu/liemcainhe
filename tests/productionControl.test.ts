import { describe, expect, it } from 'vitest';
import {
  addProductionTask,
  createProductionTask,
  getProductionControlSummary,
  initializeProductionControl,
  setProductionApprovalGate,
  updateProductionTask,
} from '../services/productionControlService';
import { createNewProjectState } from '../services/storageService';
import { createDefaultWorkflowState } from '../services/workflowService';

describe('Production Control', () => {
  it('khởi tạo checklist Egoric và nhập kế hoạch từ Đạo diễn AI mà không tạo trùng', () => {
    const project = createNewProjectState();
    project.creativeDirector = {
      ...project.creativeDirector!,
      plan: [{ id: 'plan_1', title: 'Tạo key visual chiến dịch', detail: 'Khóa một hướng hình ảnh', stage: 'assets', status: 'suggested' }],
      productionPlan: ['Duyệt bản phụ đề cuối'],
    };
    const initialized = initializeProductionControl(project);
    expect(initialized.workflow?.productionTasks).toHaveLength(12);
    expect(initialized.workflow?.productionTasks?.filter((task) => task.source === 'director')).toHaveLength(2);
    expect(initialized.workflow?.approvalGates).toHaveLength(5);

    const syncedAgain = initializeProductionControl(initialized);
    expect(syncedAgain.workflow?.productionTasks).toHaveLength(12);
  });

  it('chỉ mở cổng duyệt khi mọi công việc của công đoạn đã sẵn sàng', () => {
    let project = createNewProjectState();
    project.workflow = createDefaultWorkflowState();
    const taskA = createProductionTask({ title: 'Chốt hook', stage: 'script' });
    const taskB = createProductionTask({ title: 'Duyệt CTA', stage: 'script' });
    project = addProductionTask(addProductionTask(project, taskA), taskB);
    expect(() => setProductionApprovalGate(project, 'script', 'approved')).toThrow('chuyển toàn bộ công việc');

    project = updateProductionTask(project, taskA.id, { status: 'review' });
    project = updateProductionTask(project, taskB.id, { status: 'done' });
    expect(project.workflow?.productionTasks?.find((task) => task.id === taskA.id)?.assignee).toBe('Chưa phân công');
    expect(getProductionControlSummary(project).gates.find((gate) => gate.stage === 'script')?.status).toBe('ready');

    project = setProductionApprovalGate(project, 'script', 'approved', 'Producer');
    expect(project.workflow?.productionTasks?.every((task) => task.status === 'done')).toBe(true);
    expect(getProductionControlSummary(project).gates.find((gate) => gate.stage === 'script')?.status).toBe('approved');

    project = updateProductionTask(project, taskA.id, { status: 'in-progress' });
    expect(project.workflow?.approvalGates?.find((gate) => gate.stage === 'script')?.status).toBe('pending');
  });

  it('giữ nguyên người phụ trách khi chỉ đổi trạng thái', () => {
    let project = createNewProjectState();
    project.workflow = createDefaultWorkflowState();
    const task = createProductionTask({ title: 'Dựng bản nháp', stage: 'director', assignee: 'Huyền' });
    project = addProductionTask(project, task);
    project = updateProductionTask(project, task.id, { status: 'in-progress' });
    expect(project.workflow?.productionTasks?.[0].assignee).toBe('Huyền');
  });

  it('phát hiện bottleneck, quá hạn và việc chưa phân công', () => {
    let project = createNewProjectState();
    project.workflow = createDefaultWorkflowState();
    project = addProductionTask(project, createProductionTask({
      title: 'Sửa continuity',
      stage: 'director',
      status: 'blocked',
      assignee: '',
      dueAt: 1_700_000_000_000,
    }));
    const summary = getProductionControlSummary(project, 1_800_000_000_000);
    expect(summary.blockedTasks).toBe(1);
    expect(summary.overdueTasks).toBe(1);
    expect(summary.unassignedTasks).toBe(1);
    expect(summary.alerts).toHaveLength(3);
  });
});
