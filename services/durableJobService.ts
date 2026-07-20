import { ProductionJob, ProjectState } from '../types';

const isHosted = (): boolean =>
  typeof window !== 'undefined' && window.location.hostname.endsWith('.chatgpt.site');

export const syncDurableJobs = async (projectId: string, jobs: ProductionJob[]): Promise<void> => {
  if (!isHosted()) return;
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
  if (!isHosted()) return [];
  const response = await fetch(`/api/jobs?projectId=${encodeURIComponent(projectId)}`);
  if (!response.ok) return [];
  const payload = await response.json();
  return Array.isArray(payload.jobs) ? payload.jobs : [];
};

export const hydrateDurableJobs = async (project: ProjectState): Promise<ProjectState> => {
  const remoteJobs = await loadDurableJobs(project.id);
  if (!remoteJobs.length) return project;
  const merged = new Map<string, ProductionJob>();
  [...remoteJobs, ...(project.workflow?.jobs || [])].forEach((job) => {
    const current = merged.get(job.id);
    if (!current || job.updatedAt >= current.updatedAt) merged.set(job.id, job);
  });
  return {
    ...project,
    workflow: {
      ...(project.workflow || { checkpoints: [], jobs: [] }),
      jobs: Array.from(merged.values()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100),
    },
  };
};

export const clearFinishedDurableJobs = async (projectId: string): Promise<void> => {
  if (!isHosted()) return;
  await fetch(`/api/jobs?projectId=${encodeURIComponent(projectId)}`, { method: 'DELETE' });
};
