import { ProjectState } from '../types';
import { getPreflightItems, getWorkflowReadiness } from './workflowService';
import { getUsagePolicy, getUsageSummary } from './usageService';
import { getModelRoutingPolicy } from './modelRoutingService';

export type DiagnosticStatus = 'pass' | 'warning' | 'fail';

export interface WorkflowDiagnostic {
  id: string;
  label: string;
  detail: string;
  status: DiagnosticStatus;
  action?: string;
}

export interface WorkflowDiagnosticReport {
  score: number;
  generatedAt: number;
  items: WorkflowDiagnostic[];
  summary: string;
}

export const runWorkflowDiagnostics = (project?: ProjectState): WorkflowDiagnosticReport => {
  const items: WorkflowDiagnostic[] = [];
  const routing = getModelRoutingPolicy();
  const usage = getUsageSummary(project?.id);
  const policy = getUsagePolicy();

  items.push({
    id: 'routing',
    label: 'Định tuyến dự phòng',
    detail: routing.enabled ? `Đang bật, tối đa ${routing.maxAttempts} tuyến cho mỗi yêu cầu.` : 'Đang tắt; lỗi một model sẽ dừng toàn bộ tác vụ.',
    status: routing.enabled ? 'pass' : 'warning',
    action: routing.enabled ? undefined : 'Bật fallback trong tab API.',
  });
  items.push({
    id: 'limit',
    label: 'Hạn mức vận hành',
    detail: `${usage.units}/${policy.monthlyUnitLimit} đơn vị trong tháng · cảnh báo tại ${policy.warnAtPercent}%.`,
    status: usage.percent >= 100 ? 'fail' : usage.percent >= policy.warnAtPercent ? 'warning' : 'pass',
    action: usage.percent >= policy.warnAtPercent ? 'Kiểm tra ngân sách hoặc tăng hạn mức.' : undefined,
  });

  if (project) {
    const readiness = getWorkflowReadiness(project);
    getPreflightItems(project).forEach((item) => items.push({
      id: `preflight-${item.id}`,
      label: item.label,
      detail: item.detail,
      status: item.status === 'ready' ? 'pass' : item.status === 'warning' ? 'warning' : 'fail',
      action: item.status === 'blocked' ? 'Mở đúng phần cấu hình để xử lý.' : undefined,
    }));
    items.push({
      id: 'workflow',
      label: 'Độ hoàn thiện dự án',
      detail: `${readiness.overallPercent}% · ${readiness.blockingCount} điểm đang chặn · ${readiness.chargeableOperations} thao tác có thể phát sinh phí.`,
      status: readiness.blockingCount ? 'warning' : 'pass',
      action: readiness.blockingCount ? readiness.nextLabel : undefined,
    });
    items.push({
      id: 'recovery',
      label: 'Khả năng phục hồi',
      detail: project.workflow?.checkpoints.length ? `Có ${project.workflow.checkpoints.length} checkpoint gần nhất.` : 'Chưa có checkpoint cho dự án này.',
      status: project.workflow?.checkpoints.length ? 'pass' : 'warning',
      action: project.workflow?.checkpoints.length ? undefined : 'Tạo checkpoint trước khi chạy tác vụ hàng loạt.',
    });
  } else {
    items.push({ id: 'project', label: 'Dự án kiểm thử', detail: 'Chưa mở dự án; có thể tạo demo để kiểm tra toàn bộ luồng.', status: 'warning', action: 'Tạo dự án demo production.' });
  }

  const failCount = items.filter((item) => item.status === 'fail').length;
  const warningCount = items.filter((item) => item.status === 'warning').length;
  const score = Math.max(0, Math.round(100 - failCount * 22 - warningCount * 8));
  return {
    score,
    generatedAt: Date.now(),
    items,
    summary: failCount ? `${failCount} lỗi cần xử lý trước khi chạy.` : warningCount ? `${warningCount} mục nên hoàn thiện.` : 'Hệ thống sẵn sàng chạy production.',
  };
};
