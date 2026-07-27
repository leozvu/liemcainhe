import { describe, expect, it } from 'vitest';
import {
  JOB_TRANSITIONS,
  applyTransition,
  canTransition,
  decideSubmit,
  deriveIdempotencyKey,
  findDuplicateJob,
  isTerminal,
  reconcileInterruptedJobs,
  summarizeJobs,
} from '../services/jobStateMachine';
import { ProductionJob, ProductionJobStatus } from '../types';

const job = (over: Partial<ProductionJob> = {}): ProductionJob => ({
  id: 'j1',
  kind: 'video',
  stage: 'director',
  label: 'Dựng shot 1',
  status: 'queued',
  progress: 0,
  attempts: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('máy trạng thái', () => {
  it('cho phép đường đi bình thường', () => {
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('running', 'interrupted')).toBe(true);
  });

  it('chặn đường đi vô lý', () => {
    expect(canTransition('completed', 'running')).toBe(false);
    expect(canTransition('queued', 'completed')).toBe(false);
    expect(canTransition('cancelled', 'queued')).toBe(false);
  });

  it('job bị ngắt có thể chạy lại, job hoàn thành thì không', () => {
    expect(canTransition('interrupted', 'queued')).toBe(true);
    expect(canTransition('failed', 'queued')).toBe(true);
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('interrupted')).toBe(false);
  });

  it('mọi trạng thái đều có khai báo, không sót', () => {
    const all: ProductionJobStatus[] = ['queued', 'running', 'completed', 'failed', 'interrupted', 'cancelled'];
    for (const status of all) expect(JOB_TRANSITIONS[status]).toBeDefined();
  });

  it('áp chuyển trạng thái hợp lệ và cập nhật mốc thời gian', () => {
    const next = applyTransition(job(), 'running', { providerTaskId: 'task_1' }, 500);
    expect(next.status).toBe('running');
    expect(next.providerTaskId).toBe('task_1');
    expect(next.updatedAt).toBe(500);
  });

  it('ném lỗi khi chuyển trạng thái sai, không nuốt lặng lẽ', () => {
    expect(() => applyTransition(job({ status: 'completed' }), 'running')).toThrow(
      /Không thể chuyển job/,
    );
  });

  it('chuyển sang chính nó thì chỉ cập nhật, không ném lỗi', () => {
    const next = applyTransition(job({ status: 'running' }), 'running', { progress: 40 }, 900);
    expect(next.progress).toBe(40);
    expect(next.updatedAt).toBe(900);
  });
});

describe('khoá chống trùng', () => {
  it('cùng đầu vào cho cùng khoá', () => {
    expect(deriveIdempotencyKey('video', 'shot1', 'abc')).toBe(
      deriveIdempotencyKey('video', 'shot1', 'abc'),
    );
  });

  it('đổi loại, đổi tài nguyên hay đổi đầu vào thì khoá khác', () => {
    const base = deriveIdempotencyKey('video', 'shot1', 'abc');
    expect(deriveIdempotencyKey('voice', 'shot1', 'abc')).not.toBe(base);
    expect(deriveIdempotencyKey('video', 'shot2', 'abc')).not.toBe(base);
    expect(deriveIdempotencyKey('video', 'shot1', 'abd')).not.toBe(base);
  });

  it('khoá mang theo tên loại để đọc log dễ hơn', () => {
    expect(deriveIdempotencyKey('video', 'a', 'b').startsWith('video-')).toBe(true);
  });
});

describe('quyết định gửi tác vụ', () => {
  const key = deriveIdempotencyKey('video', 'shot1', 'abc');

  it('chưa có gì thì cho gửi', () => {
    expect(decideSubmit([], key).proceed).toBe(true);
  });

  it('đang chạy thì KHÔNG gửi lại', () => {
    const decision = decideSubmit([job({ idempotencyKey: key, status: 'running' })], key);
    expect(decision.proceed).toBe(false);
    expect(decision.reason).toContain('đang xử lý');
  });

  it('đang chờ thì cũng không gửi lại', () => {
    expect(decideSubmit([job({ idempotencyKey: key, status: 'queued' })], key).proceed).toBe(false);
  });

  it('đã xong thì dùng lại kết quả, không chạy lại tốn tiền', () => {
    const decision = decideSubmit([job({ idempotencyKey: key, status: 'completed' })], key);
    expect(decision.proceed).toBe(false);
    expect(decision.reason).toContain('đã chạy xong');
  });

  it('bị gián đoạn thì bắt buộc đối chiếu, không được tự chạy lại', () => {
    const decision = decideSubmit([job({ idempotencyKey: key, status: 'interrupted' })], key);
    expect(decision.proceed).toBe(false);
    expect(decision.reason).toContain('đối chiếu');
    expect(decision.reason).toContain('tính tiền');
  });

  it('thất bại hoặc bị huỷ thì cho làm lại', () => {
    expect(decideSubmit([job({ idempotencyKey: key, status: 'failed' })], key).proceed).toBe(true);
    expect(decideSubmit([job({ idempotencyKey: key, status: 'cancelled' })], key).proceed).toBe(true);
  });

  it('khoá khác thì không cản', () => {
    expect(decideSubmit([job({ idempotencyKey: 'khac', status: 'running' })], key).proceed).toBe(true);
    expect(findDuplicateJob([job({ idempotencyKey: 'khac' })], key)).toBeUndefined();
  });
});

describe('đối chiếu job bị ngắt', () => {
  it('job chạy quá lâu không cập nhật thì thành interrupted, KHÔNG phải failed', () => {
    const [result] = reconcileInterruptedJobs([job({ status: 'running', updatedAt: 0 })], 999_999);
    // Đây là điểm mấu chốt: failed nghĩa là chắc chắn chưa xảy ra nên chạy lại
    // an toàn; interrupted nghĩa là không rõ và có thể đã bị tính tiền.
    expect(result.status).toBe('interrupted');
  });

  it('job còn mới thì để yên', () => {
    const [result] = reconcileInterruptedJobs([job({ status: 'running', updatedAt: 900 })], 1000);
    expect(result.status).toBe('running');
  });

  it('job đã kết thúc thì không đụng tới', () => {
    const jobs = [
      job({ id: 'a', status: 'completed', updatedAt: 0 }),
      job({ id: 'b', status: 'failed', updatedAt: 0 }),
      job({ id: 'c', status: 'cancelled', updatedAt: 0 }),
    ];
    expect(reconcileInterruptedJobs(jobs, 999_999).map((j) => j.status)).toEqual([
      'completed',
      'failed',
      'cancelled',
    ]);
  });

  it('có mã tác vụ thì hướng dẫn đối chiếu', () => {
    const [result] = reconcileInterruptedJobs(
      [job({ status: 'running', updatedAt: 0, providerTaskId: 'task_9' })],
      999_999,
    );
    expect(result.detail).toContain('task_9');
    expect(result.detail).toContain('đối chiếu');
  });

  it('không có mã tác vụ thì cảnh báo nguy cơ trừ tiền hai lần', () => {
    const [result] = reconcileInterruptedJobs([job({ status: 'running', updatedAt: 0 })], 999_999);
    expect(result.detail).toContain('có thể đã bị tính tiền');
  });

  it('job đang chờ cũng được đối chiếu', () => {
    const [result] = reconcileInterruptedJobs([job({ status: 'queued', updatedAt: 0 })], 999_999);
    expect(result.status).toBe('interrupted');
  });
});

describe('tóm tắt tình trạng hàng đợi', () => {
  it('đếm đúng, và tách riêng số job mập mờ', () => {
    const jobs = [
      job({ id: '1', status: 'running', updatedAt: 0 }),
      job({ id: '2', status: 'queued' }),
      job({ id: '3', status: 'interrupted', providerTaskId: 't1' }),
      job({ id: '4', status: 'interrupted' }),
      job({ id: '5', status: 'failed' }),
      job({ id: '6', status: 'completed' }),
    ];
    expect(summarizeJobs(jobs)).toEqual({
      total: 6,
      active: 2,
      interrupted: 2,
      failed: 1,
      // Chỉ job bị ngắt mà không có mã tác vụ mới là mập mờ.
      ambiguous: 1,
    });
  });
});
