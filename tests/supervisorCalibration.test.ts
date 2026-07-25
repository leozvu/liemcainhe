import { describe, expect, it } from 'vitest';
import {
  CalibrationRecord,
  MIN_CALIBRATION_SAMPLE,
  NOISY_OVERRIDE_RATE,
  calibrateIssues,
  computeCalibration,
  describeCalibration,
  outcomeFromStatus,
  recordSupervisorDecision,
  summarizeCalibration,
} from '../services/supervisorCalibrationService';
import { AISupervisorIssue, AISupervisorIssueKind } from '../types';

const issue = (over: Partial<AISupervisorIssue> = {}): AISupervisorIssue => ({
  id: 'i1',
  kind: 'face',
  severity: 'critical',
  status: 'open',
  source: 'ai-vision',
  title: 'Khuôn mặt lệch tham chiếu',
  detail: 'Mặt nhân vật khác ảnh định trang.',
  repairTarget: 'keyframes',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const record = (
  kind: AISupervisorIssueKind,
  outcome: 'accepted' | 'overridden',
  index = 0,
): CalibrationRecord => ({
  id: `r${kind}${outcome}${index}`,
  kind,
  source: 'ai-vision',
  severity: 'critical',
  outcome,
  timestamp: index,
});

const many = (kind: AISupervisorIssueKind, accepted: number, overridden: number) => [
  ...Array.from({ length: accepted }, (_, i) => record(kind, 'accepted', i)),
  ...Array.from({ length: overridden }, (_, i) => record(kind, 'overridden', 100 + i)),
];

describe('đọc tín hiệu từ quyết định của người duyệt', () => {
  it('bỏ qua là phiếu bầu rằng cảnh báo sai', () => {
    expect(outcomeFromStatus('ignored')).toBe('overridden');
  });

  it('xếp hàng sửa hoặc đã sửa là chấp nhận', () => {
    expect(outcomeFromStatus('queued')).toBe('accepted');
    expect(outcomeFromStatus('resolved')).toBe('accepted');
  });

  it('chưa xử lý thì không nói lên gì, không ghi nhận', () => {
    expect(outcomeFromStatus('open')).toBeNull();
  });
});

describe('ghi nhận quyết định', () => {
  const memory = () => {
    let rows: CalibrationRecord[] = [];
    return {
      read: () => rows,
      write: (next: CalibrationRecord[]) => { rows = next; },
      get rows() { return rows; },
    };
  };

  it('ghi lại loại, nguồn, mức và kết quả', () => {
    const store = memory();
    recordSupervisorDecision(issue(), 'ignored', {
      projectId: 'p1',
      now: () => 500,
      read: store.read,
      write: store.write,
    });

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      kind: 'face',
      source: 'ai-vision',
      severity: 'critical',
      outcome: 'overridden',
      projectId: 'p1',
      timestamp: 500,
    });
  });

  it('trạng thái open thì không ghi gì', () => {
    const store = memory();
    const result = recordSupervisorDecision(issue(), 'open', { read: store.read, write: store.write });
    expect(result).toBeNull();
    expect(store.rows).toHaveLength(0);
  });
});

describe('tính độ tin từng loại cảnh báo', () => {
  it('chưa đủ mẫu thì không kết luận', () => {
    const [stats] = computeCalibration(many('face', 1, 1));
    expect(stats.trust).toBe('unknown');
    expect(stats.overrideRate).toBeNull();
    expect(describeCalibration(stats)).toContain(`2/${MIN_CALIBRATION_SAMPLE}`);
  });

  it('hầu như luôn được chấp nhận thì đáng tin', () => {
    const [stats] = computeCalibration(many('missing-media', 9, 1));
    expect(stats.trust).toBe('trusted');
    expect(stats.overrideRate).toBe(0.1);
    expect(stats.suggestedSeverity).toBeUndefined();
  });

  it('bị bỏ qua quá nhiều thì coi là hay báo sai và đề nghị hạ mức', () => {
    const [stats] = computeCalibration(many('hands', 3, 7));
    expect(stats.trust).toBe('noisy');
    expect(stats.overrideRate).toBeGreaterThanOrEqual(NOISY_OVERRIDE_RATE);
    expect(stats.suggestedSeverity).toBe('info');
    expect(describeCalibration(stats)).toContain('hạ xuống mức nhắc');
  });

  it('ở giữa thì để nguyên, không hạ vội', () => {
    const [stats] = computeCalibration(many('logo', 7, 3));
    expect(stats.trust).toBe('mixed');
    expect(stats.suggestedSeverity).toBeUndefined();
  });

  it('tách riêng từng loại và xếp loại nhiều dữ liệu lên trước', () => {
    const stats = computeCalibration([...many('face', 8, 2), ...many('cta', 2, 1)]);
    expect(stats.map((item) => item.kind)).toEqual(['face', 'cta']);
  });

  it('chưa có bản ghi nào thì trả rỗng', () => {
    expect(computeCalibration([])).toEqual([]);
  });
});

describe('áp hiệu chỉnh lên cảnh báo', () => {
  const noisy = computeCalibration(many('hands', 2, 8));

  it('hạ mức loại hay báo sai', () => {
    const [result] = calibrateIssues([issue({ kind: 'hands', severity: 'critical' })], noisy);
    expect(result.severity).toBe('warning');
  });

  it('nói rõ vì sao hạ, không im lặng', () => {
    const [result] = calibrateIssues([issue({ kind: 'hands' })], noisy);
    expect(result.detail).toContain('Đã hạ mức');
    expect(result.detail).toContain('80%');
    // Giữ nguyên nội dung gốc, chỉ thêm ghi chú.
    expect(result.detail).toContain('Mặt nhân vật khác ảnh định trang.');
  });

  it('KHÔNG đụng tới loại chưa đủ dữ liệu', () => {
    const it_ = computeCalibration(many('face', 1, 1));
    const [result] = calibrateIssues([issue({ kind: 'face', severity: 'critical' })], it_);
    expect(result.severity).toBe('critical');
    expect(result.detail).not.toContain('Đã hạ mức');
  });

  it('KHÔNG đụng tới loại đáng tin', () => {
    const trusted = computeCalibration(many('missing-media', 10, 0));
    const [result] = calibrateIssues([issue({ kind: 'missing-media', severity: 'critical' })], trusted);
    expect(result.severity).toBe('critical');
  });

  it('không bao giờ nâng mức, chỉ hạ', () => {
    const [result] = calibrateIssues([issue({ kind: 'hands', severity: 'info' })], noisy);
    // Đã ở mức thấp nhất thì giữ nguyên.
    expect(result.severity).toBe('info');
  });

  it('loại khác trong cùng danh sách không bị vạ lây', () => {
    const results = calibrateIssues(
      [issue({ id: 'a', kind: 'hands' }), issue({ id: 'b', kind: 'logo' })],
      noisy,
    );
    expect(results[0].severity).toBe('warning');
    expect(results[1].severity).toBe('critical');
  });

  it('chưa có hiệu chỉnh nào thì giữ nguyên tất cả', () => {
    const results = calibrateIssues([issue({ kind: 'hands' })], []);
    expect(results[0].severity).toBe('critical');
  });
});

describe('tổng quan', () => {
  it('đếm loại đáng tin, loại hay báo sai và tỷ lệ bỏ qua chung', () => {
    const calibration = computeCalibration([
      ...many('missing-media', 10, 0),
      ...many('hands', 2, 8),
      ...many('cta', 1, 1),
    ]);
    const summary = summarizeCalibration(calibration);

    expect(summary).toMatchObject({ kinds: 3, measured: 2, trusted: 1, noisy: 1, totalDecisions: 22 });
    expect(summary.overallOverrideRate).toBeCloseTo(0.41, 1);
  });

  it('chưa có dữ liệu thì không bịa tỷ lệ', () => {
    expect(summarizeCalibration([]).overallOverrideRate).toBeNull();
  });
});
