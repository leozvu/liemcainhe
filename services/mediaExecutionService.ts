import { ProductionJob, ProjectState } from '../types';
import { MediaExecutionContext } from '../types/model';
import { claimDurableJob, syncDurableJobs } from './durableJobService';
import { applyTransition, decideSubmit, deriveIdempotencyKey } from './jobStateMachine';
import { createProductionJob, upsertProductionJob } from './workflowService';
import { loadProjectFromDB, saveProjectToDB } from './storageService';
import { BillableLifecyclePhase, recordBillableLifecycleEvent } from './billableTelemetryService';

const inFlight = new Map<string, Promise<unknown>>();
const latestJobsByProject = new Map<string, Map<string, ProductionJob>>();

export class DuplicateBillableExecutionError extends Error {
  existing?: ProductionJob;

  constructor(message: string, existing?: ProductionJob) {
    super(message);
    this.name = 'DuplicateBillableExecutionError';
    this.existing = existing;
  }
}

export const isDuplicateBillableExecutionError = (error: unknown): error is DuplicateBillableExecutionError =>
  error instanceof DuplicateBillableExecutionError;

/** JSON chỉ dùng trong bộ nhớ để tạo fingerprint; không ghi prompt/ảnh vào job. */
export const buildMediaInputSignature = (value: unknown): string => JSON.stringify(value);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || 'Tác vụ media thất bại');

const errorStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : undefined;
};

/** Giữ mã HTTP trên lỗi đã Việt hoá để policy retry/đối chiếu không đoán bằng câu chữ. */
export const createBillableHttpError = (message: string, status: number): Error & { status: number } =>
  Object.assign(new Error(message), { status });

export const createConfirmedBillableFailure = (message: string): Error & { billableOutcome: 'failed' } =>
  Object.assign(new Error(message), { billableOutcome: 'failed' as const });

export const isExplicitRateLimitError = (error: unknown): boolean =>
  errorStatus(error) === 429 || /(^|\D)429(\D|$)|rate.?limit|quá nhiều yêu cầu/i.test(errorMessage(error));

/**
 * Submission media chỉ được thử lại khi provider nói rõ 429 — nghĩa là request
 * đã bị từ chối trước khi tạo tác vụ. Lỗi mạng/5xx/402 tuyệt đối không tự gửi lại.
 */
export const submitPaidTaskSafely = async <T>(
  operation: () => Promise<T>,
  maxRateLimitRetries: number = 1,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isExplicitRateLimitError(error) || attempt >= maxRateLimitRetries) throw error;
      await wait(1200 * (attempt + 1));
    }
  }
};

/** Mất kết nối sau submission là "không rõ", không phải failed an toàn để retry. */
export const isAmbiguousBillableError = (
  error: unknown,
  providerTaskId?: string,
  providerAccepted: boolean = false,
): boolean => {
  if ((error as { billableOutcome?: unknown })?.billableOutcome === 'failed') return false;
  if (providerTaskId || providerAccepted) return true;
  const status = errorStatus(error);
  if (status && status >= 500) return true;
  return /timeout|hết thời gian|mạng|network|failed to fetch|load failed|gián đoạn|abort|502|503|504/i.test(errorMessage(error));
};

const rememberJob = (projectId: string, job: ProductionJob): void => {
  const projectJobs = latestJobsByProject.get(projectId) || new Map<string, ProductionJob>();
  const current = projectJobs.get(job.id);
  if (!current || job.updatedAt >= current.updatedAt) projectJobs.set(job.id, job);
  if (projectJobs.size > 200) {
    const oldest = [...projectJobs.values()].sort((left, right) => left.updatedAt - right.updatedAt)[0];
    if (oldest) projectJobs.delete(oldest.id);
  }
  latestJobsByProject.set(projectId, projectJobs);
};

const knownJobs = (context: MediaExecutionContext): ProductionJob[] => {
  context.jobs.forEach((job) => rememberJob(context.projectId, job));
  return [...(latestJobsByProject.get(context.projectId)?.values() || [])];
};

const notify = (context: MediaExecutionContext, job: ProductionJob): void => {
  rememberJob(context.projectId, job);
  context.onJobChange?.(job);
};

const recordLifecycle = (
  context: MediaExecutionContext,
  job: ProductionJob,
  phase: BillableLifecyclePhase,
  error?: unknown,
): void => {
  recordBillableLifecycleEvent({
    projectId: context.projectId,
    jobId: job.id,
    kind: job.kind,
    resourceId: job.resourceId,
    idempotencyKey: job.idempotencyKey,
    providerTaskId: job.providerTaskId,
    phase,
    error: error ? errorMessage(error) : undefined,
  });
};

const persist = async (context: MediaExecutionContext, job: ProductionJob): Promise<void> => {
  try {
    await syncDurableJobs(context.projectId, [job]);
  } catch (error) {
    // Claim D1 đã được tạo trước khi tiêu tiền. Không dừng polling chỉ vì một
    // lần cập nhật metadata lỗi; autosync của App sẽ thử lại từ project state.
    console.warn('Không thể cập nhật ngay job media lên cloud:', error);
  }
};

export interface BillableOperationHooks {
  onProviderAccepted: () => Promise<void>;
  onProviderTaskId: (taskId: string) => Promise<void>;
}

export interface ExecuteBillableMediaInput<T> {
  context?: MediaExecutionContext;
  mediaType: 'image' | 'video' | 'voice';
  inputSignature: string;
  resourceId?: string;
  operation: (hooks: BillableOperationHooks) => Promise<T>;
}

export const executeBillableMedia = async <T>(input: ExecuteBillableMediaInput<T>): Promise<T> => {
  const kind = input.context?.kind
    || (input.mediaType === 'video' ? 'video' : input.mediaType === 'voice' ? 'voice' : 'asset-image');
  const resourceId = input.context?.resourceId || input.resourceId || 'unscoped';
  const versionSignature = buildMediaInputSignature({
    input: input.inputSignature,
    previousOutput: input.context?.previousOutput || null,
  });
  const idempotencyKey = deriveIdempotencyKey(kind, resourceId, versionSignature);
  // D1 đã scope theo project; in-memory map cũng phải giống vậy. Hai project
  // có cùng shot id/prompt không được vô tình dùng chung output trong một tab.
  const inFlightKey = `${input.context?.projectId || 'unscoped'}:${idempotencyKey}`;

  // Hai click trong cùng event loop nhận chung Promise, không tạo job hay gọi
  // provider lần hai. Map hoạt động cả khi caller chưa truyền project context.
  const active = inFlight.get(inFlightKey) as Promise<T> | undefined;
  if (active) {
    if (input.context) {
      const duplicate = decideSubmit(knownJobs(input.context), idempotencyKey).existing;
      if (duplicate) recordLifecycle(input.context, duplicate, 'deduplicated');
    }
    return active;
  }

  const run = async (): Promise<T> => {
    const context = input.context;
    if (!context) {
      return input.operation({
        onProviderAccepted: async () => undefined,
        onProviderTaskId: async () => undefined,
      });
    }

    const localDecision = decideSubmit(knownJobs(context), idempotencyKey);
    if (!localDecision.proceed) {
      if (localDecision.existing) recordLifecycle(context, localDecision.existing, 'deduplicated');
      throw new DuplicateBillableExecutionError(localDecision.reason || 'Tác vụ này đã tồn tại.', localDecision.existing);
    }

    let current = createProductionJob({
      kind: context.kind,
      stage: context.stage,
      label: context.label,
      resourceId: context.resourceId,
      totalUnits: 1,
      idempotencyKey,
      detail: 'Đang khóa quyền gửi để tránh trừ credit hai lần.',
    });
    notify(context, current);
    recordLifecycle(context, current, 'preflight-passed');

    let claim;
    try {
      claim = await claimDurableJob(context.projectId, current);
    } catch (error) {
      current = applyTransition(current, 'failed', {
        error: errorMessage(error),
        detail: 'Không khóa được tác vụ nên đã dừng trước khi gọi provider. Chưa sử dụng credit.',
      });
      notify(context, current);
      recordLifecycle(context, current, 'preflight-blocked', error);
      throw error;
    }
    if (!claim.claimed) {
      current = applyTransition(current, 'cancelled', {
        detail: 'Đã hủy bản gửi cục bộ vì cloud xác nhận tác vụ tương đương đã tồn tại.',
      });
      notify(context, current);
      if (claim.existing) notify(context, claim.existing);
      recordLifecycle(context, claim.existing || current, 'deduplicated');
      throw new DuplicateBillableExecutionError(
        'Một tab hoặc thiết bị khác đã gửi đúng tác vụ này. Không gửi lại để tránh trừ credit hai lần.',
        claim.existing,
      );
    }

    current = applyTransition(current, 'running', {
      attempts: 1,
      detail: 'Đã khóa tác vụ. Đang chờ nhà cung cấp xác nhận.',
    });
    notify(context, current);
    await persist(context, current);
    recordLifecycle(context, current, 'submitted');

    let providerAccepted = false;
    const onProviderAccepted = async () => {
      if (providerAccepted) return;
      providerAccepted = true;
      current = applyTransition(current, 'running', {
        detail: 'Nhà cung cấp đã chấp nhận yêu cầu; đang nhận và lưu kết quả.',
      });
      notify(context, current);
      await persist(context, current);
      recordLifecycle(context, current, 'provider-accepted');
    };

    const onProviderTaskId = async (taskId: string) => {
      if (!taskId.trim()) return;
      providerAccepted = true;
      current = applyTransition(current, 'running', {
        providerTaskId: taskId.trim(),
        detail: `Nhà cung cấp đã nhận tác vụ ${taskId.trim()}.`,
      });
      notify(context, current);
      await persist(context, current);
      recordLifecycle(context, current, 'provider-task');
    };

    try {
      const result = await input.operation({ onProviderAccepted, onProviderTaskId });
      // Operation đã trả output thì provider chắc chắn đã nhận. Gọi hook ở
      // đây là hàng rào cuối nếu một adapter đồng bộ quên phát tín hiệu 2xx.
      await onProviderAccepted();
      if (context.commitResult) {
        await context.commitResult(result);
        recordLifecycle(context, current, 'output-committed');
      }
      current = applyTransition(current, 'completed', {
        progress: 100,
        completedUnits: 1,
        detail: 'Đã nhận và chuyển kết quả vào trạng thái dự án.',
        error: undefined,
      });
      notify(context, current);
      await persist(context, current);
      recordLifecycle(context, current, 'completed');
      return result;
    } catch (error) {
      const ambiguous = isAmbiguousBillableError(error, current.providerTaskId, providerAccepted);
      current = applyTransition(current, ambiguous ? 'interrupted' : 'failed', {
        error: errorMessage(error),
        detail: ambiguous
          ? current.providerTaskId
            ? `Mất dấu sau khi provider nhận tác vụ ${current.providerTaskId}. Phải đối chiếu trước khi chạy lại.`
            : 'Kết nối bị gián đoạn sau khi gửi. Có thể provider đã tính tiền; không tự chạy lại.'
          : 'Provider đã từ chối hoặc xác nhận tác vụ thất bại; có thể thử lại sau khi sửa nguyên nhân.',
      });
      notify(context, current);
      await persist(context, current);
      recordLifecycle(context, current, ambiguous ? 'interrupted' : 'failed', error);
      throw error;
    }
  };

  const promise = run();
  inFlight.set(inFlightKey, promise);
  try {
    return await promise;
  } finally {
    if (inFlight.get(inFlightKey) === promise) inFlight.delete(inFlightKey);
  }
};

export interface ProjectMediaExecutionInput<TResult = string> {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((previous: ProjectState) => ProjectState)) => void;
  kind: MediaExecutionContext['kind'];
  stage: MediaExecutionContext['stage'];
  label: string;
  resourceId: string;
  previousOutput?: string;
  commitResult?: (project: ProjectState, result: TResult) => ProjectState;
  /** Test seam; production mặc định ghi IndexedDB bằng saveProjectToDB. */
  persistProject?: (project: ProjectState) => Promise<void>;
}

/** Adapter mỏng để component React ghi snapshot envelope vào project. */
export const createProjectMediaExecutionContext = <TResult = string>(
  input: ProjectMediaExecutionInput<TResult>,
): MediaExecutionContext => {
  const originProjectId = input.project.id;
  let originProject = input.project;

  return {
    projectId: originProjectId,
    get jobs() {
      return originProject.workflow?.jobs || [];
    },
    kind: input.kind,
    stage: input.stage,
    label: input.label,
    resourceId: input.resourceId,
    previousOutput: input.previousOutput,
    commitResult: input.commitResult ? async (result: unknown) => {
      const typedResult = result as TResult;
      const stored = await loadProjectFromDB(originProjectId).catch(() => null);
      let base = stored?.id === originProjectId ? stored : originProject;
      for (const job of originProject.workflow?.jobs || []) {
        const savedJob = base.workflow?.jobs.find((item) => item.id === job.id);
        if (!savedJob || job.updatedAt >= savedJob.updatedAt) base = upsertProductionJob(base, job);
      }
      originProject = input.commitResult!(base, typedResult);
      await (input.persistProject || saveProjectToDB)(originProject);
      input.updateProject((previous) => previous.id === originProjectId
        ? input.commitResult!(previous, typedResult)
        : previous);
    } : undefined,
    onJobChange: (job) => {
      originProject = upsertProductionJob(originProject, job);
      input.updateProject((previous) => previous.id === originProjectId
        ? upsertProductionJob(previous, job)
        : previous);
    },
  };
};
