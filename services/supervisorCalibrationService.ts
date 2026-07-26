import {
  AISupervisorIssue,
  AISupervisorIssueKind,
  AISupervisorIssueSeverity,
  AISupervisorIssueSource,
  AISupervisorIssueStatus,
} from '../types';

/**
 * Hiệu chỉnh AI Supervisor.
 *
 * Supervisor hiện đưa ra cảnh báo mà không ai biết chúng đúng bao nhiêu phần
 * trăm. Báo sai nhiều thì người dùng bắt đầu bỏ qua **tất cả** — và lúc đó nó
 * tệ hơn là không có, vì vẫn tốn tiền chạy AI Vision mà không ai đọc kết quả.
 *
 * Tín hiệu để đo đã có sẵn: trạng thái `ignored` chính là người duyệt bỏ qua,
 * còn `queued` và `resolved` là chấp nhận. Chỗ thiếu là nơi giữ lại các quyết
 * định đó xuyên dự án — trong dự án chúng biến mất mỗi khi báo cáo dựng lại.
 */

export type CalibrationOutcome = 'accepted' | 'overridden';

export interface CalibrationRecord {
  id: string;
  kind: AISupervisorIssueKind;
  source: AISupervisorIssueSource;
  /** Mức nghiêm trọng lúc cảnh báo được đưa ra, trước khi hiệu chỉnh. */
  severity: AISupervisorIssueSeverity;
  outcome: CalibrationOutcome;
  confidence?: number;
  projectId?: string;
  timestamp: number;
}

const STORAGE_KEY = 'egoric_supervisor_calibration_v1';

/**
 * Giữ tối đa ngần này bản ghi.
 *
 * Cùng cách `usageService` làm. Dữ liệu cũ quá thì cũng không còn phản ánh
 * đúng chất lượng hiện tại của model, nên cắt bớt không mất mát gì.
 */
const MAX_RECORDS = 1000;

/**
 * Ba tầng tin cậy theo số mẫu.
 *
 * Bản đầu để một ngưỡng duy nhất là 5, và **5 mẫu đã đủ để tự hạ độ nặng cảnh
 * báo**. Con số đó tôi chọn không dựa trên gì cả. Với dữ liệu ít và lệch, nó
 * tạo đúng vòng lặp tự củng cố: vài lần bỏ qua ngẫu nhiên làm cảnh báo bị hạ
 * cấp, hạ cấp khiến người duyệt bỏ qua nhiều hơn, và cảnh báo tắt hẳn.
 *
 * Nay tách làm ba tầng — dưới 10 chỉ hiện số, 10–29 khuyến nghị nhưng không tự
 * áp, từ 30 mới cho điều chỉnh.
 */
export const SAMPLE_DISPLAY_ONLY = 10;
export const SAMPLE_RECOMMEND = 10;
export const SAMPLE_AUTO_ADJUST = 30;

/** Còn giữ tên cũ cho chỗ hiển thị tiến độ; nay trỏ vào tầng thấp nhất. */
export const MIN_CALIBRATION_SAMPLE = SAMPLE_DISPLAY_ONLY;

export type CalibrationTier = 'insufficient' | 'advisory' | 'actionable';

/**
 * Với ngần này mẫu thì được phép làm gì.
 *
 * `actionable` là tầng **duy nhất** cho phép đổi hành vi thật. Hai tầng dưới
 * chỉ để người dùng nhìn.
 */
export const calibrationTier = (sampleCount: number): CalibrationTier => {
  if (sampleCount >= SAMPLE_AUTO_ADJUST) return 'actionable';
  if (sampleCount >= SAMPLE_RECOMMEND) return 'advisory';
  return 'insufficient';
};

/** Tỷ lệ bị bỏ qua từ mức này trở lên thì coi là hay báo sai. */
export const NOISY_OVERRIDE_RATE = 0.4;

/** Tỷ lệ bị bỏ qua dưới mức này thì coi là đáng tin. */
export const TRUSTED_OVERRIDE_RATE = 0.15;

export const readCalibrationRecords = (): CalibrationRecord[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
};

const writeCalibrationRecords = (records: CalibrationRecord[]): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
  } catch {
    // Hết dung lượng thì bỏ qua. Mất một bản ghi hiệu chỉnh không đáng để làm
    // hỏng thao tác người dùng đang thực hiện.
  }
};

/**
 * Trạng thái mới nói lên điều gì về cảnh báo.
 *
 * `ignored` là người duyệt nhìn thấy và quyết định bỏ qua — đó là phiếu bầu
 * rằng cảnh báo sai. `queued` và `resolved` là chấp nhận. `open` chưa nói lên
 * gì nên không ghi nhận.
 */
export const outcomeFromStatus = (status: AISupervisorIssueStatus): CalibrationOutcome | null => {
  if (status === 'ignored') return 'overridden';
  if (status === 'queued' || status === 'resolved') return 'accepted';
  return null;
};

export interface RecordDecisionOptions {
  projectId?: string;
  now?: () => number;
  /** Cho phép thay lớp lưu trữ khi kiểm thử. */
  read?: () => CalibrationRecord[];
  write?: (records: CalibrationRecord[]) => void;
}

/** Ghi lại quyết định của người duyệt với một cảnh báo. */
export const recordSupervisorDecision = (
  issue: Pick<AISupervisorIssue, 'kind' | 'source' | 'severity' | 'confidence'>,
  status: AISupervisorIssueStatus,
  options: RecordDecisionOptions = {},
): CalibrationRecord | null => {
  const outcome = outcomeFromStatus(status);
  if (!outcome) return null;

  const now = (options.now ?? Date.now)();
  const record: CalibrationRecord = {
    id: `cal_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind: issue.kind,
    source: issue.source,
    severity: issue.severity,
    outcome,
    confidence: issue.confidence,
    projectId: options.projectId,
    timestamp: now,
  };

  const read = options.read ?? readCalibrationRecords;
  const write = options.write ?? writeCalibrationRecords;
  write([...read(), record]);
  return record;
};

export type CalibrationTrust = 'trusted' | 'mixed' | 'noisy' | 'unknown';

export interface KindCalibration {
  kind: AISupervisorIssueKind;
  total: number;
  accepted: number;
  overridden: number;
  /** Tỷ lệ bị bỏ qua, 0 đến 1. `null` khi chưa đủ mẫu. */
  overrideRate: number | null;
  trust: CalibrationTrust;
  /** Với ngần này mẫu thì được phép làm gì: chỉ xem, khuyến nghị, hay điều chỉnh. */
  tier: CalibrationTier;
  /**
   * Mức nghiêm trọng nên dùng thay cho mức gốc.
   *
   * Chỉ hạ, không bao giờ nâng. Nâng mức dựa trên thống kê là cách nhanh nhất
   * để một loại cảnh báo đúng vài lần rồi bắt đầu chặn oan.
   */
  suggestedSeverity?: AISupervisorIssueSeverity;
}

const trustFrom = (total: number, rate: number): CalibrationTrust => {
  if (total < MIN_CALIBRATION_SAMPLE) return 'unknown';
  if (rate >= NOISY_OVERRIDE_RATE) return 'noisy';
  if (rate <= TRUSTED_OVERRIDE_RATE) return 'trusted';
  return 'mixed';
};

/** Hạ một bậc, không bao giờ xuống dưới `info`. */
const downgrade = (severity: AISupervisorIssueSeverity): AISupervisorIssueSeverity =>
  severity === 'critical' ? 'warning' : 'info';

export const computeCalibration = (records: CalibrationRecord[]): KindCalibration[] => {
  const byKind = new Map<AISupervisorIssueKind, CalibrationRecord[]>();
  for (const record of records) {
    const list = byKind.get(record.kind);
    if (list) list.push(record);
    else byKind.set(record.kind, [record]);
  }

  const result: KindCalibration[] = [];

  for (const [kind, list] of byKind) {
    const overridden = list.filter((record) => record.outcome === 'overridden').length;
    const rate = overridden / list.length;
    const trust = trustFrom(list.length, rate);

    result.push({
      kind,
      total: list.length,
      accepted: list.length - overridden,
      overridden,
      overrideRate: list.length >= SAMPLE_DISPLAY_ONLY ? Math.round(rate * 100) / 100 : null,
      trust,
      tier: calibrationTier(list.length),
      /**
       * Chỉ đề xuất hạ mức khi đã đủ **30** mẫu.
       *
       * Dưới ngưỡng đó, `trust` vẫn được tính và hiện ra cho người dùng đọc,
       * nhưng không có đề xuất nào — nghĩa là `calibrateIssues` không đổi gì.
       * Đây là chỗ ranh giới "hiển thị" và "điều khiển" được vạch.
       */
      suggestedSeverity:
        trust === 'noisy' && list.length >= SAMPLE_AUTO_ADJUST ? 'info' : undefined,
    });
  }

  return result.sort((left, right) => right.total - left.total);
};

/**
 * Áp hiệu chỉnh lên danh sách cảnh báo trước khi hiện ra.
 *
 * Loại hay báo sai bị hạ xuống mức nhắc, và gắn kèm ghi chú để người duyệt
 * biết vì sao — im lặng hạ mức sẽ khiến họ mất tin vào chính hệ thống.
 */
export const calibrateIssues = (
  issues: AISupervisorIssue[],
  calibration: KindCalibration[],
): AISupervisorIssue[] => {
  const byKind = new Map(calibration.map((item) => [item.kind, item]));

  return issues.map((issue) => {
    const stats = byKind.get(issue.kind);
    if (!stats?.suggestedSeverity) return issue;
    if (stats.suggestedSeverity === issue.severity) return issue;

    const percent = Math.round((stats.overrideRate ?? 0) * 100);
    return {
      ...issue,
      severity: downgrade(issue.severity),
      detail: `${issue.detail} (Đã hạ mức: ${percent}% cảnh báo loại này từng bị bỏ qua trên ${stats.total} lần.)`,
    };
  });
};

export const KIND_LABELS: Record<AISupervisorIssueKind, string> = {
  'missing-media': 'Thiếu media',
  'stale-media': 'Media lỗi thời',
  face: 'Khuôn mặt',
  hands: 'Bàn tay',
  logo: 'Logo',
  product: 'Sản phẩm',
  continuity: 'Continuity',
  'dialogue-overrun': 'Thoại dài hơn video',
  'safe-zone': 'Safe zone',
  brand: 'Thương hiệu',
  cta: 'CTA',
};

export const TRUST_LABELS: Record<CalibrationTrust, string> = {
  trusted: 'Đáng tin',
  mixed: 'Nửa vời',
  noisy: 'Hay báo sai',
  unknown: 'Chưa đủ dữ liệu',
};

/** Một dòng chẩn đoán cho từng loại cảnh báo. */
export const describeCalibration = (item: KindCalibration): string => {
  if (item.trust === 'unknown') {
    return `Mới ${item.total}/${MIN_CALIBRATION_SAMPLE} lượt, chưa đủ để kết luận.`;
  }

  const percent = Math.round((item.overrideRate ?? 0) * 100);
  if (item.trust === 'noisy') {
    return `${percent}% bị bỏ qua trên ${item.total} lượt. Đã hạ xuống mức nhắc.`;
  }
  if (item.trust === 'trusted') {
    return `Chỉ ${percent}% bị bỏ qua trên ${item.total} lượt. Cảnh báo này đáng tin.`;
  }
  return `${percent}% bị bỏ qua trên ${item.total} lượt.`;
};

/** Tổng quan để biết Supervisor nói chung có đang được tin không. */
export const summarizeCalibration = (calibration: KindCalibration[]) => {
  const measured = calibration.filter((item) => item.trust !== 'unknown');
  const total = calibration.reduce((sum, item) => sum + item.total, 0);
  const overridden = calibration.reduce((sum, item) => sum + item.overridden, 0);

  return {
    kinds: calibration.length,
    measured: measured.length,
    noisy: calibration.filter((item) => item.trust === 'noisy').length,
    trusted: calibration.filter((item) => item.trust === 'trusted').length,
    totalDecisions: total,
    overallOverrideRate: total ? Math.round((overridden / total) * 100) / 100 : null,
  };
};
