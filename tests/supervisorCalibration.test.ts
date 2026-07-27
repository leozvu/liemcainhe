import { describe, expect, it } from 'vitest';
import {
  CalibrationRecord,
  MIN_CALIBRATION_SAMPLE,
  SAMPLE_AUTO_ADJUST,
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
    const [stats] = computeCalibration(many('missing-media', 27, 3));
    expect(stats.trust).toBe('trusted');
    expect(stats.overrideRate).toBe(0.1);
    expect(stats.suggestedSeverity).toBeUndefined();
  });

  it('bị bỏ qua quá nhiều thì coi là hay báo sai và đề nghị hạ mức', () => {
    const [stats] = computeCalibration(many('hands', 9, 21));
    expect(stats.trust).toBe('noisy');
    expect(stats.overrideRate).toBeGreaterThanOrEqual(NOISY_OVERRIDE_RATE);
    expect(stats.suggestedSeverity).toBe('info');
    expect(describeCalibration(stats)).toContain('hạ xuống mức nhắc');
  });

  it('ở giữa thì để nguyên, không hạ vội', () => {
    const [stats] = computeCalibration(many('logo', 21, 9));
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
  const noisy = computeCalibration(many('hands', 6, 24));

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

/**
 * Ba tầng theo số mẫu, chốt trong plan vòng 2 với Codex.
 *
 * Bản đầu chỉ có một ngưỡng là 5, và 5 mẫu đã đủ để tự hạ độ nặng cảnh báo.
 * Với dữ liệu ít và lệch, đó là vòng lặp tự củng cố: vài lần bỏ qua ngẫu nhiên
 * làm cảnh báo bị hạ cấp, hạ cấp khiến người duyệt bỏ qua nhiều hơn, và cảnh
 * báo tắt hẳn.
 */
describe('ngưỡng dữ liệu ba tầng', () => {
  it('dưới 10 mẫu: chưa kết luận, không có tỷ lệ', () => {
    const [stats] = computeCalibration(many('hands', 2, 7));
    expect(stats.tier).toBe('insufficient');
    expect(stats.overrideRate).toBeNull();
    expect(stats.suggestedSeverity).toBeUndefined();
  });

  it('10–29 mẫu: hiện tỷ lệ và độ tin, nhưng KHÔNG tự điều chỉnh', () => {
    const [stats] = computeCalibration(many('hands', 2, 8));
    expect(stats.tier).toBe('advisory');
    expect(stats.overrideRate).toBe(0.8);
    expect(stats.trust).toBe('noisy');
    // Biết là hay báo sai, nhưng chưa được quyền hạ mức.
    expect(stats.suggestedSeverity).toBeUndefined();
  });

  it('29 mẫu vẫn chưa được điều chỉnh — ranh giới phải chặt', () => {
    const [stats] = computeCalibration(many('hands', 6, 23));
    expect(stats.total).toBe(29);
    expect(stats.suggestedSeverity).toBeUndefined();
  });

  it('đúng 30 mẫu thì mới được điều chỉnh', () => {
    const [stats] = computeCalibration(many('hands', 6, 24));
    expect(stats.total).toBe(30);
    expect(stats.tier).toBe('actionable');
    expect(stats.suggestedSeverity).toBe('info');
  });

  it('ở tầng advisory thì calibrateIssues không đổi gì cả', () => {
    const advisory = computeCalibration(many('hands', 2, 8));
    const [result] = calibrateIssues([issue({ kind: 'hands', severity: 'critical' })], advisory);
    expect(result.severity).toBe('critical');
  });

  it('đủ mẫu nhưng đáng tin thì vẫn không hạ mức — ngưỡng không phải giấy phép', () => {
    const trusted = computeCalibration(many('hands', 27, 3));
    const [result] = calibrateIssues([issue({ kind: 'hands', severity: 'critical' })], trusted);
    expect(result.severity).toBe('critical');
  });
});

/**
 * Một cảnh báo góp đúng một mẫu.
 *
 * Bản trước mỗi lần đổi trạng thái lại thêm một bản ghi mới. Bật rồi tắt rồi
 * bật lại một cảnh báo thành ba mẫu, và `queued → resolved` của cùng một cảnh
 * báo thành hai phiếu `accepted`. Người duyệt lưỡng lự vài lần là tự tay bơm
 * mẫu, và loại đó đạt ngưỡng 30 bằng nhiễu.
 */
describe('gộp mẫu theo cảnh báo', () => {
  const store = () => {
    const rows: CalibrationRecord[] = [];
    return {
      rows,
      read: () => [...rows],
      write: (next: CalibrationRecord[]) => {
        rows.length = 0;
        rows.push(...next);
      },
    };
  };

  it('đổi ý trên cùng một cảnh báo thì thay chỗ, không cộng thêm', () => {
    const s = store();
    const one = issue({ id: 'i1', kind: 'hands' });

    recordSupervisorDecision(one, 'ignored', { read: s.read, write: s.write, now: () => 1 });
    recordSupervisorDecision(one, 'queued', { read: s.read, write: s.write, now: () => 2 });
    recordSupervisorDecision(one, 'ignored', { read: s.read, write: s.write, now: () => 3 });

    expect(s.rows).toHaveLength(1);
  });

  it('quyết định cuối cùng thắng', () => {
    const s = store();
    const one = issue({ id: 'i1', kind: 'hands' });

    recordSupervisorDecision(one, 'ignored', { read: s.read, write: s.write, now: () => 1 });
    recordSupervisorDecision(one, 'queued', { read: s.read, write: s.write, now: () => 2 });

    expect(s.rows[0].outcome).toBe('accepted');
    expect(s.rows[0].timestamp).toBe(2);
  });

  it('queued rồi resolved của cùng cảnh báo chỉ là MỘT phiếu chấp nhận', () => {
    const s = store();
    const one = issue({ id: 'i1', kind: 'hands' });

    recordSupervisorDecision(one, 'queued', { read: s.read, write: s.write, now: () => 1 });
    recordSupervisorDecision(one, 'resolved', { read: s.read, write: s.write, now: () => 2 });

    expect(s.rows).toHaveLength(1);
    expect(computeCalibration(s.rows)[0].total).toBe(1);
  });

  it('hai cảnh báo khác nhau vẫn là hai mẫu', () => {
    const s = store();
    recordSupervisorDecision(issue({ id: 'i1', kind: 'hands' }), 'ignored', { read: s.read, write: s.write, now: () => 1 });
    recordSupervisorDecision(issue({ id: 'i2', kind: 'hands' }), 'ignored', { read: s.read, write: s.write, now: () => 2 });

    expect(s.rows).toHaveLength(2);
  });

  it('giữ nguyên vị trí cũ khi thay, để thứ tự thời gian không nhảy', () => {
    const s = store();
    recordSupervisorDecision(issue({ id: 'i1' }), 'ignored', { read: s.read, write: s.write, now: () => 1 });
    recordSupervisorDecision(issue({ id: 'i2' }), 'ignored', { read: s.read, write: s.write, now: () => 2 });
    recordSupervisorDecision(issue({ id: 'i1' }), 'queued', { read: s.read, write: s.write, now: () => 3 });

    expect(s.rows.map((row) => row.issueId)).toEqual(['i1', 'i2']);
  });
});

describe('câu mô tả không được nói quá', () => {
  it('tầng advisory: nói rõ CHƯA hạ và còn thiếu bao nhiêu lượt', () => {
    const [stats] = computeCalibration(many('hands', 2, 8));
    const text = describeCalibration(stats);

    expect(stats.suggestedSeverity).toBeUndefined();
    expect(text).not.toContain('Đã hạ');
    expect(text).toContain('Chưa hạ mức');
    expect(text).toContain(`${SAMPLE_AUTO_ADJUST - stats.total} lượt`);
  });

  it('đủ 30 mẫu và thật sự đã hạ thì mới được nói "Đã hạ"', () => {
    const [stats] = computeCalibration(many('hands', 6, 24));
    expect(stats.suggestedSeverity).toBe('info');
    expect(describeCalibration(stats)).toContain('Đã hạ xuống mức nhắc');
  });
});

/**
 * Dedupe phải tách theo dự án.
 *
 * Kho hiệu chỉnh nằm trong `localStorage` dùng chung cho cả workspace, còn id
 * cảnh báo dựng từ shot và loại lỗi — hai dự án khác nhau hoàn toàn có thể sinh
 * ra cùng một `issueId`. Khoá bằng mình `issueId` thì dự án sau ghi đè mẫu của
 * dự án trước, và cả hai cùng mất dữ liệu mà không ai biết.
 */
describe('gộp mẫu tách theo dự án', () => {
  const store = () => {
    const rows: CalibrationRecord[] = [];
    return {
      rows,
      read: () => [...rows],
      write: (next: CalibrationRecord[]) => {
        rows.length = 0;
        rows.push(...next);
      },
    };
  };

  it('cùng dự án + cùng cảnh báo → một mẫu, quyết định cuối thắng', () => {
    const s = store();
    const one = issue({ id: 'shot1:hands', kind: 'hands' });

    recordSupervisorDecision(one, 'ignored', { projectId: 'p1', read: s.read, write: s.write, now: () => 1 });
    recordSupervisorDecision(one, 'queued', { projectId: 'p1', read: s.read, write: s.write, now: () => 2 });

    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].outcome).toBe('accepted');
    expect(s.rows[0].timestamp).toBe(2);
  });

  it('cùng cảnh báo, KHÁC dự án → hai mẫu riêng, không ghi đè nhau', () => {
    const s = store();
    const one = issue({ id: 'shot1:hands', kind: 'hands' });

    recordSupervisorDecision(one, 'ignored', { projectId: 'p1', read: s.read, write: s.write, now: () => 1 });
    recordSupervisorDecision(one, 'queued', { projectId: 'p2', read: s.read, write: s.write, now: () => 2 });

    expect(s.rows).toHaveLength(2);
    expect(s.rows.map((row) => row.projectId)).toEqual(['p1', 'p2']);
    expect(computeCalibration(s.rows)[0].total).toBe(2);
  });

  it('bản ghi không có projectId là một không gian riêng, không đụng dự án nào', () => {
    const s = store();
    const one = issue({ id: 'shot1:hands', kind: 'hands' });

    recordSupervisorDecision(one, 'ignored', { read: s.read, write: s.write, now: () => 1 });
    recordSupervisorDecision(one, 'ignored', { projectId: 'p1', read: s.read, write: s.write, now: () => 2 });
    recordSupervisorDecision(one, 'queued', { read: s.read, write: s.write, now: () => 3 });

    expect(s.rows).toHaveLength(2);
    expect(s.rows.find((row) => !row.projectId)?.outcome).toBe('accepted');
    expect(s.rows.find((row) => row.projectId === 'p1')?.outcome).toBe('overridden');
  });

  it('bản ghi cũ chưa có issueId vẫn đọc được và không bị dedupe nuốt', () => {
    const s = store();
    s.write([record('hands', 'overridden', 0)]);

    recordSupervisorDecision(issue({ id: 'i1', kind: 'hands' }), 'ignored', {
      projectId: 'p1', read: s.read, write: s.write, now: () => 5,
    });

    expect(s.rows).toHaveLength(2);
  });
});
