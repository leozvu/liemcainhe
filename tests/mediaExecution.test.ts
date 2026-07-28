import { describe, expect, it, vi } from 'vitest';
import { MediaExecutionContext } from '../types/model';
import { ProductionJob } from '../types';
import {
  createBillableHttpError,
  createProjectMediaExecutionContext,
  executeBillableMedia,
  submitPaidTaskSafely,
} from '../services/mediaExecutionService';
import { createNewProjectState } from '../services/storageService';
import { getBillableLifecycleEvents } from '../services/billableTelemetryService';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] || null,
    get length() { return values.size; },
  } as Storage;
};

const createContext = () => {
  const jobs: ProductionJob[] = [];
  const context: MediaExecutionContext = {
    projectId: 'project_media_test',
    jobs,
    kind: 'video',
    stage: 'director',
    label: 'Tạo video cảnh 1',
    resourceId: 'shot_1',
    onJobChange: (next) => {
      const index = jobs.findIndex((item) => item.id === next.id);
      if (index >= 0) jobs[index] = next;
      else jobs.unshift(next);
    },
  };
  return { context, jobs };
};

describe('execution envelope cho media trả phí', () => {
  it('hai click đồng thời dùng chung một Promise và chỉ gọi provider một lần', async () => {
    vi.stubGlobal('localStorage', createStorage());
    try {
      const { context } = createContext();
      let release!: (value: string) => void;
      const provider = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));
      const input = {
        context,
        mediaType: 'video' as const,
        inputSignature: 'same-input',
        operation: provider,
      };

      const first = executeBillableMedia(input);
      const second = executeBillableMedia(input);
      await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
      release('video-result');

      await expect(Promise.all([first, second])).resolves.toEqual(['video-result', 'video-result']);
      expect(provider).toHaveBeenCalledOnce();
      expect(getBillableLifecycleEvents().filter((event) => event.phase === 'deduplicated')).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lưu provider task id ngay rồi mới đánh dấu hoàn thành', async () => {
    const { context, jobs } = createContext();
    await expect(executeBillableMedia({
      context,
      mediaType: 'video',
      inputSignature: 'provider-id',
      operation: async ({ onProviderTaskId }) => {
        await onProviderTaskId('kie_task_123');
        expect(jobs[0]).toMatchObject({ status: 'running', providerTaskId: 'kie_task_123' });
        return 'done';
      },
    })).resolves.toBe('done');

    expect(jobs[0]).toMatchObject({
      status: 'completed',
      providerTaskId: 'kie_task_123',
      progress: 100,
    });
  });

  it('ghi execution trail từ preflight đến completed cho đối soát Campaign 0', async () => {
    vi.stubGlobal('localStorage', createStorage());
    try {
      const { context } = createContext();
      context.projectId = 'project_media_lifecycle';
      context.commitResult = async () => undefined;
      await executeBillableMedia({
        context,
        mediaType: 'video',
        inputSignature: 'lifecycle-trail',
        operation: async ({ onProviderAccepted, onProviderTaskId }) => {
          await onProviderAccepted();
          await onProviderTaskId('provider_lifecycle_1');
          return 'saved-output';
        },
      });

      const phases = getBillableLifecycleEvents()
        .filter((event) => event.projectId === context.projectId)
        .sort((left, right) => (left.sequence || 0) - (right.sequence || 0))
        .map((event) => event.phase);
      expect(phases).toEqual([
        'preflight-passed',
        'submitted',
        'provider-accepted',
        'provider-task',
        'output-committed',
        'completed',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('chỉ completed sau khi callback ghi output đã chạy xong', async () => {
    const { context, jobs } = createContext();
    const order: string[] = [];
    context.commitResult = async (result) => {
      expect(result).toBe('saved-output');
      order.push('commit');
      await Promise.resolve();
    };
    const previousOnChange = context.onJobChange;
    context.onJobChange = (job) => {
      previousOnChange?.(job);
      if (job.status === 'completed') order.push('completed');
    };

    await executeBillableMedia({
      context,
      mediaType: 'video',
      inputSignature: 'commit-before-complete',
      operation: async () => 'saved-output',
    });

    expect(order).toEqual(['commit', 'completed']);
    expect(jobs[0].status).toBe('completed');
  });

  it('Project context đợi IndexedDB ack trước khi ghi completed', async () => {
    let project = { ...createNewProjectState(), id: 'project_durable_result' };
    const order: string[] = [];
    const context = createProjectMediaExecutionContext({
      project,
      updateProject: (updates) => {
        project = typeof updates === 'function' ? updates(project) : { ...project, ...updates };
        if (project.workflow?.jobs[0]?.status === 'completed') order.push('completed');
      },
      kind: 'asset-image',
      stage: 'assets',
      label: 'Ảnh nhân vật',
      resourceId: 'character_1',
      commitResult: (current, result) => ({ ...current, title: result }),
      persistProject: async (next) => {
        await Promise.resolve();
        expect(next.title).toBe('durable-output');
        order.push('indexeddb');
      },
    });

    await executeBillableMedia({
      context,
      mediaType: 'image',
      inputSignature: 'durable-project-result',
      operation: async () => 'durable-output',
    });

    expect(order).toEqual(['indexeddb', 'completed']);
    expect(project.title).toBe('durable-output');
  });

  it('đổi sang project khác giữa lúc chạy vẫn lưu output về đúng project gốc', async () => {
    const origin = { ...createNewProjectState(), id: 'project_origin', title: 'Project A' };
    let active = { ...createNewProjectState(), id: 'project_active', title: 'Project B' };
    let persisted: typeof origin | undefined;
    const context = createProjectMediaExecutionContext({
      project: origin,
      updateProject: (updates) => {
        active = (typeof updates === 'function' ? updates(active) : { ...active, ...updates }) as typeof active;
      },
      kind: 'asset-image',
      stage: 'assets',
      label: 'Ảnh project A',
      resourceId: 'asset_a',
      commitResult: (current, result) => ({ ...current, title: result }),
      persistProject: async (next) => { persisted = next as typeof origin; },
    });

    await executeBillableMedia({
      context,
      mediaType: 'image',
      inputSignature: 'switch-project',
      operation: async () => 'Output A',
    });

    expect(persisted).toMatchObject({ id: 'project_origin', title: 'Output A' });
    expect(active).toMatchObject({ id: 'project_active', title: 'Project B' });
  });

  it('không dùng chung Promise giữa hai project dù shot và prompt giống nhau', async () => {
    const first = createContext();
    const second = createContext();
    second.context.projectId = 'project_media_other';
    const provider = vi.fn(async () => 'result');
    const execute = (context: MediaExecutionContext) => executeBillableMedia({
      context,
      mediaType: 'video',
      inputSignature: 'same-across-projects',
      operation: provider,
    });

    await expect(Promise.all([execute(first.context), execute(second.context)])).resolves.toEqual(['result', 'result']);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('lỗi mạng hoặc 5xx thành interrupted để không tự trừ tiền lần hai', async () => {
    const { context, jobs } = createContext();
    await expect(executeBillableMedia({
      context,
      mediaType: 'video',
      inputSignature: 'ambiguous-network',
      operation: async () => { throw createBillableHttpError('Gateway timeout', 504); },
    })).rejects.toThrow('Gateway timeout');

    expect(jobs[0].status).toBe('interrupted');
    expect(jobs[0].detail).toContain('không tự chạy lại');
  });

  it('HTTP 2xx nhưng body lỗi vẫn thành interrupted vì provider đã nhận', async () => {
    const { context, jobs } = createContext();
    await expect(executeBillableMedia({
      context,
      mediaType: 'image',
      inputSignature: 'accepted-malformed-body',
      operation: async ({ onProviderAccepted }) => {
        await onProviderAccepted();
        throw new Error('Unexpected end of JSON input');
      },
    })).rejects.toThrow('Unexpected end');

    expect(jobs[0].status).toBe('interrupted');
  });

  it('provider xác nhận task thất bại thì cho retry dù đã có task id', async () => {
    const { context, jobs } = createContext();
    await expect(executeBillableMedia({
      context,
      mediaType: 'video',
      inputSignature: 'confirmed-provider-failure',
      operation: async ({ onProviderTaskId }) => {
        await onProviderTaskId('task_failed_1');
        throw Object.assign(new Error('Provider xác nhận failed'), { billableOutcome: 'failed' as const });
      },
    })).rejects.toThrow('Provider xác nhận failed');

    expect(jobs[0]).toMatchObject({ status: 'failed', providerTaskId: 'task_failed_1' });
  });

  it('snapshot context cũ vẫn thấy interrupted mới nhất trong cùng project', async () => {
    const first = createContext();
    await expect(executeBillableMedia({
      context: first.context,
      mediaType: 'video',
      inputSignature: 'stale-context-guard',
      operation: async () => { throw createBillableHttpError('HTTP 503', 503); },
    })).rejects.toThrow('HTTP 503');

    const stale = createContext();
    await expect(executeBillableMedia({
      context: stale.context,
      mediaType: 'video',
      inputSignature: 'stale-context-guard',
      operation: async () => 'must-not-run',
    })).rejects.toThrow(/đối chiếu/);
  });

  it('402 là từ chối chắc chắn và không bị retry', async () => {
    const { context, jobs } = createContext();
    const provider = vi.fn(async () => { throw createBillableHttpError('Số dư không đủ', 402); });
    await expect(executeBillableMedia({
      context,
      mediaType: 'video',
      inputSignature: 'no-balance',
      operation: provider,
    })).rejects.toThrow('Số dư không đủ');

    expect(provider).toHaveBeenCalledOnce();
    expect(jobs[0].status).toBe('failed');
  });
});

describe('retry policy cho request tạo task', () => {
  it('chỉ retry 429 đã được provider từ chối trước khi tạo task', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(createBillableHttpError('Rate limited', 429))
      .mockResolvedValue('accepted');
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(submitPaidTaskSafely(operation, 1, wait)).resolves.toBe('accepted');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
  });

  it.each([402, 500, 503])('không retry HTTP %s vì có thể request trước đã được nhận', async (status) => {
    const operation = vi.fn(async () => { throw createBillableHttpError(`HTTP ${status}`, status); });
    await expect(submitPaidTaskSafely(operation, 2, vi.fn())).rejects.toThrow(`HTTP ${status}`);
    expect(operation).toHaveBeenCalledOnce();
  });
});
