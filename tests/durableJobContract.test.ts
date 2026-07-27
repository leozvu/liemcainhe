import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PRODUCTION_JOB_KINDS, ProductionJob } from '../types';
import { loadDurableJobs, syncDurableJobs } from '../services/durableJobService';
import worker from '../worker/index.js';

const root = path.join(__dirname, '..');
const workerSource = readFileSync(path.join(root, 'worker', 'index.js'), 'utf8');
const migrationSource = readFileSync(path.join(root, 'drizzle', '0007_durable_job_contract.sql'), 'utf8');

const hostedWindow = { location: { hostname: 'egoric-studio-vietnam.example.chatgpt.site' } };

const createFakeD1 = () => {
  const prepared: Array<{ sql: string; bindings: unknown[]; bind: (...values: unknown[]) => unknown }> = [];
  const batch = vi.fn().mockResolvedValue([]);
  const prepare = (sql: string) => {
    const statement = {
      sql,
      bindings: [] as unknown[],
      bind(...values: unknown[]) {
        this.bindings = values;
        return this;
      },
      all: vi.fn().mockResolvedValue({ results: [] }),
      run: vi.fn().mockResolvedValue({ success: true }),
      first: vi.fn().mockResolvedValue(null),
    };
    prepared.push(statement);
    return statement;
  };
  return { db: { prepare, batch }, prepared, batch };
};

const job = (): ProductionJob => ({
  id: 'job_contract_1',
  kind: 'video-factory',
  stage: 'director',
  label: 'Video Factory',
  status: 'running',
  progress: 30,
  attempts: 1,
  createdAt: 100,
  updatedAt: 200,
  idempotencyKey: 'idem_video_shot_1',
  providerTaskId: 'kie_task_123',
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('contract durable jobs giữa client và worker', () => {
  it('worker chấp nhận đúng toàn bộ loại job mà client khai báo', () => {
    const block = /const PRODUCTION_JOB_KINDS = \[([\s\S]*?)\n\];/.exec(workerSource);
    expect(block, 'không tìm thấy PRODUCTION_JOB_KINDS trong worker').toBeTruthy();
    const workerKinds = [...block![1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(workerKinds.sort()).toEqual([...PRODUCTION_JOB_KINDS].sort());
  });

  it('API nhận bốn loại job từng bị worker từ chối', async () => {
    const { db, batch, prepared } = createFakeD1();
    const formerlyRejected = ['video-factory', 'ai-supervisor', 'auto-editor', 'agency-review'] as const;
    const jobs = formerlyRejected.map((kind, index) => ({
      ...job(),
      id: `job_contract_${index}`,
      kind,
    }));
    const response = await worker.fetch(new Request('https://studio.test/api/jobs?projectId=project_1', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'oai-authenticated-user-email': 'owner@egoric.vn',
      },
      body: JSON.stringify({ jobs }),
    }), { DB: db });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ saved: 4 });
    expect(batch).toHaveBeenCalledOnce();
    expect(prepared).toHaveLength(4);
    expect(prepared[0].bindings).toContain('idem_video_shot_1');
    expect(prepared[0].bindings).toContain('kie_task_123');
  });

  it('migration và worker đều lưu hai trường phục hồi tác vụ trả phí', () => {
    expect(migrationSource).toContain('ADD COLUMN idempotency_key TEXT');
    expect(migrationSource).toContain('ADD COLUMN provider_task_id TEXT');
    expect(workerSource).toContain('idempotency_key AS idempotencyKey');
    expect(workerSource).toContain('provider_task_id AS providerTaskId');
    expect(workerSource).toContain('idempotency_key = COALESCE');
    expect(workerSource).toContain('provider_task_id = COALESCE');
  });

  it('client gửi nguyên khóa chống trùng và mã provider lên API', async () => {
    vi.stubGlobal('window', hostedWindow);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await syncDurableJobs('project_1', [job()]);

    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(init?.body));
    expect(payload.jobs[0]).toMatchObject({
      idempotencyKey: 'idem_video_shot_1',
      providerTaskId: 'kie_task_123',
    });
  });

  it('client khôi phục nguyên khóa chống trùng và mã provider từ API', async () => {
    vi.stubGlobal('window', hostedWindow);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [job()] }), { status: 200 })));

    const restored = await loadDurableJobs('project_1');

    expect(restored[0]).toMatchObject({
      kind: 'video-factory',
      idempotencyKey: 'idem_video_shot_1',
      providerTaskId: 'kie_task_123',
    });
  });
});
