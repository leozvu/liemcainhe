import { describe, expect, it } from 'vitest';
import {
  addProductionJob,
  createProductionJob,
  resolveInterruptedProductionJob,
  setProductionJobStatus,
} from '../services/workflowService';
import { createNewProjectState } from '../services/storageService';

describe('production jobs', () => {
  it('ghi nhận vòng đời queued → running → completed', () => {
    const project = createNewProjectState();
    const job = createProductionJob({ kind: 'export', stage: 'export', label: 'Xuất bản thử' });
    const running = setProductionJobStatus(addProductionJob(project, job), job.id, 'running');
    const completed = setProductionJobStatus(running, job.id, 'completed');
    expect(completed.workflow?.jobs[0].status).toBe('completed');
    expect(completed.workflow?.jobs[0].progress).toBe(100);
    expect(completed.workflow?.jobs[0].attempts).toBe(1);
  });

  it('chỉ người vận hành đối chiếu mới mở khóa interrupted thành failed', () => {
    const project = createNewProjectState();
    const job = { ...createProductionJob({ kind: 'video', stage: 'director', label: 'Cảnh 1' }), status: 'interrupted' as const };
    const resolved = resolveInterruptedProductionJob(addProductionJob(project, job), job.id);
    expect(resolved.workflow?.jobs[0]).toMatchObject({
      status: 'failed',
      error: undefined,
    });
    expect(resolved.workflow?.jobs[0].detail).toContain('đối chiếu');
  });
});
