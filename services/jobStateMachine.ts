import { ProductionJob, ProductionJobKind, ProductionJobStatus } from '../types';

/**
 * Máy trạng thái cho job sản xuất.
 *
 * Đây là điều kiện tiên quyết của background orchestrator, không phải bản thân
 * orchestrator. Thiếu lớp này thì dựng orchestrator chỉ là chuyển lỗi lên máy
 * chủ: vẫn gửi trùng tác vụ, vẫn mất dấu job bị ngắt, vẫn trừ tiền hai lần.
 *
 * Ba thứ lớp này giải quyết, đúng ba mục trong Giai đoạn 1 của roadmap:
 * khoá chống trùng, mã tác vụ nhà cung cấp, và trạng thái sau khi tab chết.
 */

/** Trạng thái nào đi được sang trạng thái nào. */
export const JOB_TRANSITIONS: Record<ProductionJobStatus, ProductionJobStatus[]> = {
  queued: ['running', 'cancelled', 'failed'],
  running: ['completed', 'failed', 'interrupted', 'cancelled'],
  // Ba trạng thái dưới là kết thúc; chạy lại thì tạo lượt mới từ queued.
  completed: [],
  failed: ['queued'],
  interrupted: ['queued', 'running', 'failed'],
  cancelled: [],
};

export const canTransition = (from: ProductionJobStatus, to: ProductionJobStatus): boolean =>
  JOB_TRANSITIONS[from]?.includes(to) ?? false;

/** Trạng thái đã kết thúc, không đổi được nữa. */
export const isTerminal = (status: ProductionJobStatus): boolean =>
  JOB_TRANSITIONS[status].length === 0;

/**
 * Áp một chuyển trạng thái, từ chối nếu không hợp lệ.
 *
 * Ném lỗi thay vì lặng lẽ bỏ qua: một chuyển trạng thái sai là dấu hiệu logic
 * gọi đang nhầm, và nuốt nó đi sẽ tạo ra job kẹt ở trạng thái vô lý mà không
 * ai biết vì sao.
 */
export const applyTransition = (
  job: ProductionJob,
  to: ProductionJobStatus,
  patch: Partial<ProductionJob> = {},
  now: number = Date.now(),
): ProductionJob => {
  if (job.status === to) return { ...job, ...patch, updatedAt: now };
  if (!canTransition(job.status, to)) {
    throw new Error(`Không thể chuyển job từ "${job.status}" sang "${to}".`);
  }
  return { ...job, ...patch, status: to, updatedAt: now };
};

/**
 * Vân tay của một công việc.
 *
 * Cùng loại, cùng tài nguyên, cùng đầu vào thì cùng khoá. Không dùng hàm băm
 * mật mã vì chỉ cần ổn định; trùng khoá thì hậu quả là một cảnh báo thừa, tức
 * là hỏng về phía an toàn.
 */
export const deriveIdempotencyKey = (
  kind: ProductionJobKind,
  resourceId: string,
  inputSignature: string,
): string => {
  const source = `${kind}::${resourceId}::${inputSignature}`;
  let djb2 = 5381;
  let fnv = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    djb2 = ((djb2 << 5) + djb2 + code) >>> 0;
    fnv = ((fnv ^ code) * 0x01000193) >>> 0;
  }
  return `${kind}-${djb2.toString(36)}${fnv.toString(36)}`;
};

/**
 * Đã có job nào đang làm đúng việc này chưa.
 *
 * Chỉ tính job chưa kết thúc và job đã hoàn thành. Job thất bại hay bị huỷ thì
 * cho làm lại, vì chắc chắn không còn gì đang chạy bên nhà cung cấp.
 */
export const findDuplicateJob = (
  jobs: ProductionJob[],
  idempotencyKey: string,
): ProductionJob | undefined =>
  jobs.find(
    (job) =>
      job.idempotencyKey === idempotencyKey &&
      ['queued', 'running', 'completed'].includes(job.status),
  );

export interface SubmitDecision {
  /** Có được gửi tác vụ mới không. */
  proceed: boolean;
  /** Job trùng đã tồn tại, nếu có. */
  existing?: ProductionJob;
  reason?: string;
}

/** Quyết định có gửi tác vụ mới hay dùng lại job cũ. */
export const decideSubmit = (
  jobs: ProductionJob[],
  idempotencyKey: string,
): SubmitDecision => {
  const existing = findDuplicateJob(jobs, idempotencyKey);
  if (!existing) return { proceed: true };

  if (existing.status === 'completed') {
    return { proceed: false, existing, reason: 'Việc này đã chạy xong, dùng lại kết quả cũ.' };
  }
  return {
    proceed: false,
    existing,
    reason: `Việc này đang chạy (${existing.status === 'queued' ? 'đang chờ' : 'đang xử lý'}), không gửi lại.`,
  };
};

/** Sau bao lâu không cập nhật thì coi là bị ngắt. */
export const STALE_RUNNING_MS = 10 * 60 * 1000;

/**
 * Đánh dấu các job bị ngắt khi tab chết.
 *
 * Điểm mấu chốt: chuyển sang `interrupted` chứ **không** phải `failed`. Đây
 * đúng bài học từ lớp đăng bài — thất bại nghĩa là chắc chắn chưa xảy ra nên
 * chạy lại an toàn, còn bị ngắt nghĩa là **không rõ** đã chạy tới đâu và có
 * thể đã bị tính tiền. Ghi nhầm thành thất bại sẽ khiến lần sau chạy lại và
 * trừ tiền lần hai.
 *
 * Job có `providerTaskId` thì phiên sau đối chiếu được với nhà cung cấp; không
 * có thì phải hỏi người dùng.
 */
export const reconcileInterruptedJobs = (
  jobs: ProductionJob[],
  now: number = Date.now(),
  staleAfterMs: number = STALE_RUNNING_MS,
): ProductionJob[] =>
  jobs.map((job) => {
    if (job.status !== 'running' && job.status !== 'queued') return job;
    if (now - job.updatedAt < staleAfterMs) return job;

    return {
      ...job,
      status: 'interrupted' as const,
      updatedAt: now,
      detail: job.providerTaskId
        ? `Bị ngắt giữa chừng. Có mã tác vụ ${job.providerTaskId} để đối chiếu với nhà cung cấp.`
        : 'Bị ngắt giữa chừng và không có mã tác vụ. Kiểm tra bên nhà cung cấp trước khi chạy lại, vì có thể đã bị tính tiền.',
    };
  });

export interface JobHealth {
  total: number;
  active: number;
  interrupted: number;
  failed: number;
  /** Job bị ngắt mà không có mã tác vụ: nguy cơ trừ tiền hai lần nếu chạy lại. */
  ambiguous: number;
}

export const summarizeJobs = (jobs: ProductionJob[]): JobHealth => ({
  total: jobs.length,
  active: jobs.filter((job) => job.status === 'queued' || job.status === 'running').length,
  interrupted: jobs.filter((job) => job.status === 'interrupted').length,
  failed: jobs.filter((job) => job.status === 'failed').length,
  ambiguous: jobs.filter((job) => job.status === 'interrupted' && !job.providerTaskId).length,
});
