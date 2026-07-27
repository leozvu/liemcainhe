import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionJob } from '../types';
import { MediaExecutionContext } from '../types/model';
import { clearCredentialVault } from '../services/credentialVault';
import { setVoiceCredentials } from '../services/voiceRegistry';
import { generateVoice, GenerateVoiceInput } from '../services/voiceService';

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

const input = (execution: MediaExecutionContext): GenerateVoiceInput => ({
  providerId: 'fpt',
  text: 'Xin chào từ Egoric',
  voiceId: 'banmai',
  speed: 1,
  pitch: 0,
  emotion: 'neutral',
  outputFormat: 'mp3',
  usageResourceId: 'shot_voice_1:voice',
  execution,
});

const createContext = (projectId: string) => {
  const jobs: ProductionJob[] = [];
  const order: string[] = [];
  const context: MediaExecutionContext = {
    projectId,
    jobs,
    kind: 'voice',
    stage: 'voice',
    label: 'Tạo thoại cảnh 1',
    resourceId: 'shot_voice_1:voice',
    commitResult: async (result) => {
      expect(result).toMatchObject({ audioUrl: 'https://audio.test/result.mp3' });
      order.push('commit');
    },
    onJobChange: (job) => {
      const index = jobs.findIndex((item) => item.id === job.id);
      if (index >= 0) jobs[index] = job;
      else jobs.unshift(job);
      if (job.status === 'completed') order.push('completed');
    },
  };
  return { context, jobs, order };
};

describe('execution envelope cho voice trả phí', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
    clearCredentialVault();
    setVoiceCredentials('fpt', { apiKey: 'fpt_test_key' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hai lệnh đồng thời chỉ gửi provider một lần, lưu task ID và commit trước completed', async () => {
    const { context, jobs, order } = createContext('project_voice_dedupe');
    let release!: () => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      release = () => resolve(new Response(JSON.stringify({
        error: 0,
        async: 'https://audio.test/result.mp3',
        request_id: 'fpt_task_123',
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = generateVoice(input(context));
    const second = generateVoice(input(context));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ audioUrl: 'https://audio.test/result.mp3' }),
      expect.objectContaining({ audioUrl: 'https://audio.test/result.mp3' }),
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(jobs[0]).toMatchObject({ status: 'completed', providerTaskId: 'fpt_task_123' });
    expect(order).toEqual(['commit', 'completed']);
    const usage = JSON.parse(localStorage.getItem('egoric_usage_records_v1') || '[]');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ kind: 'voice', status: 'success', resourceId: 'shot_voice_1:voice' });
  });

  it('HTTP 503 không retry và trở thành interrupted để chặn trừ tiền lần hai', async () => {
    const { context, jobs } = createContext('project_voice_503');
    const fetchMock = vi.fn().mockResolvedValue(new Response('Dịch vụ tạm gián đoạn', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateVoice(input(context))).rejects.toThrow('Dịch vụ tạm gián đoạn');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(jobs[0].status).toBe('interrupted');
  });

  it('provider trả 2xx nhưng body hỏng vẫn là unknown/interrupted', async () => {
    const { context, jobs } = createContext('project_voice_bad_body');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(generateVoice(input(context))).rejects.toThrow();
    expect(jobs[0].status).toBe('interrupted');
    expect(jobs[0].detail?.toLowerCase()).toContain('có thể provider đã tính tiền');
  });

  it('provider xác nhận lỗi nghiệp vụ thì đánh failed và cho phép sửa rồi thử lại', async () => {
    const { context, jobs } = createContext('project_voice_confirmed_failure');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 1,
      message: 'Giọng không tồn tại',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(generateVoice(input(context))).rejects.toThrow('Giọng không tồn tại');
    expect(jobs[0].status).toBe('failed');
  });
});
