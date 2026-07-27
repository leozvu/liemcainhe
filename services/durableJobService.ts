import { ProductionJob, ProjectState } from '../types';
import { reconcileInterruptedJobs } from './jobStateMachine';

export const isHostedWorkspace = (): boolean =>
  typeof window !== 'undefined' && window.location.hostname.endsWith('.chatgpt.site');

export const syncDurableJobs = async (projectId: string, jobs: ProductionJob[]): Promise<void> => {
  if (!isHostedWorkspace()) return;
  const response = await fetch(`/api/jobs?projectId=${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs: jobs.slice(0, 100) }),
  });
  if (!response.ok && response.status !== 401) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Không thể đồng bộ hàng đợi production');
  }
};

export const loadDurableJobs = async (projectId: string): Promise<ProductionJob[]> => {
  if (!isHostedWorkspace()) return [];
  const response = await fetch(`/api/jobs?projectId=${encodeURIComponent(projectId)}`);
  if (!response.ok) return [];
  const payload = await response.json();
  return Array.isArray(payload.jobs) ? payload.jobs : [];
};

/**
 * Nạp lại hàng đợi job và đối chiếu những job bị ngắt.
 *
 * Chạy cả khi không có job từ cloud, vì job kẹt ở `running` nằm ngay trong dự
 * án cục bộ: tab bị đóng giữa chừng thì không ai kịp đổi trạng thái. Bản cũ
 * thoát sớm khi cloud rỗng nên bỏ sót đúng trường hợp hay gặp nhất.
 */
export const hydrateDurableJobs = async (project: ProjectState): Promise<ProjectState> => {
  const remoteJobs = await loadDurableJobs(project.id);
  const localJobs = project.workflow?.jobs || [];
  if (!remoteJobs.length && !localJobs.length) return project;

  const merged = new Map<string, ProductionJob>();
  [...remoteJobs, ...localJobs].forEach((job) => {
    const current = merged.get(job.id);
    if (!current || job.updatedAt >= current.updatedAt) merged.set(job.id, job);
  });

  const jobs = reconcileInterruptedJobs(Array.from(merged.values()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 100);

  return {
    ...project,
    workflow: { ...(project.workflow || { checkpoints: [], jobs: [] }), jobs },
  };
};

export const clearFinishedDurableJobs = async (projectId: string): Promise<void> => {
  if (!isHostedWorkspace()) return;
  await fetch(`/api/jobs?projectId=${encodeURIComponent(projectId)}`, { method: 'DELETE' });
};

export interface DurableJobClaim {
  claimed: boolean;
  existing?: ProductionJob;
}

/**
 * Giành quyền gửi một request billable trước khi gọi provider.
 *
 * Trên bản hosted, unique index D1 là trọng tài giữa nhiều tab/thiết bị. Bản
 * local vẫn được bảo vệ bằng job hiện có và in-flight map của execution layer.
 */
export const claimDurableJob = async (projectId: string, job: ProductionJob): Promise<DurableJobClaim> => {
  if (!isHostedWorkspace()) return { claimed: true };
  const response = await fetch(`/api/jobs?projectId=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 409) {
    return { claimed: false, existing: payload.existing };
  }
  if (!response.ok) {
    throw new Error(payload.error || 'Không thể khóa tác vụ trước khi gọi nhà cung cấp. Chưa có credit nào bị sử dụng.');
  }
  return { claimed: true };
};
