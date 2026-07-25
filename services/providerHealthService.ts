import {
  ApiErrorCategory,
  API_ERROR_CATEGORY_LABELS,
  classifyApiError,
  isProviderSideFailure,
} from './apiErrorLocalization';
import { UsageRecord, getUsageRecords } from './usageService';

/**
 * Sức khoẻ từng nhà cung cấp, suy ra từ nhật ký usage đã có sẵn.
 *
 * Không thu thập thêm dữ liệu nào: `recordUsage` vốn đã ghi providerId,
 * modelId, status, error và durationMs cho mọi lời gọi. Chỗ thiếu chỉ là chưa
 * ai đọc chúng theo chiều nhà cung cấp.
 *
 * Phục vụ hai việc trong roadmap: bảng theo dõi sức khoẻ từng nhà cung cấp, và
 * ngắt mạch khi một nhà cung cấp lỗi hàng loạt.
 */

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface ProviderHealth {
  providerId: string;
  status: ProviderHealthStatus;
  requests: number;
  successes: number;
  failures: number;
  /** Tỷ lệ thành công, 0–1. `null` khi chưa có dữ liệu. */
  successRate: number | null;
  /** Số lần lỗi liên tiếp gần nhất do phía nhà cung cấp. */
  consecutiveProviderFailures: number;
  /** Đếm theo loại lỗi, để biết đang hỏng vì cái gì. */
  errorsByCategory: Partial<Record<ApiErrorCategory, number>>;
  /** Loại lỗi áp đảo, dùng làm câu chẩn đoán ngắn. */
  dominantError?: ApiErrorCategory;
  medianDurationMs: number | null;
  lastFailureAt?: number;
  lastSuccessAt?: number;
}

/** Cửa sổ mặc định khi tính sức khoẻ. */
export const HEALTH_WINDOW_MS = 60 * 60 * 1000;

/** Số lỗi liên tiếp từ phía nhà cung cấp thì coi là mất kết nối. */
export const CIRCUIT_TRIP_THRESHOLD = 4;

/** Dưới ngưỡng này thì coi là chập chờn. */
export const DEGRADED_SUCCESS_RATE = 0.8;

/** Số lượt tối thiểu mới đủ căn cứ kết luận, tránh phán xét từ một lần lỗi. */
export const MIN_SAMPLE = 3;

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/**
 * Tính sức khoẻ của từng nhà cung cấp trong một cửa sổ thời gian.
 *
 * Tách khỏi phần đọc nhật ký để kiểm thử được mà không cần localStorage.
 */
export const computeProviderHealth = (
  records: UsageRecord[],
  now: number,
  windowMs: number = HEALTH_WINDOW_MS,
): ProviderHealth[] => {
  const trongCuaSo = records.filter(
    (record) => record.providerId && now - record.timestamp <= windowMs,
  );

  const theoNhaCungCap = new Map<string, UsageRecord[]>();
  for (const record of trongCuaSo) {
    const key = record.providerId as string;
    const list = theoNhaCungCap.get(key);
    if (list) list.push(record);
    else theoNhaCungCap.set(key, [record]);
  }

  const health: ProviderHealth[] = [];

  for (const [providerId, all] of theoNhaCungCap) {
    // Mới nhất trước, để đếm chuỗi lỗi liên tiếp từ hiện tại lùi về.
    const sorted = [...all].sort((left, right) => right.timestamp - left.timestamp);

    const successes = sorted.filter((record) => record.status === 'success').length;
    const failures = sorted.length - successes;

    const errorsByCategory: Partial<Record<ApiErrorCategory, number>> = {};
    for (const record of sorted) {
      if (record.status !== 'failed') continue;
      const category = classifyApiError(record.error);
      errorsByCategory[category] = (errorsByCategory[category] ?? 0) + 1;
    }

    let consecutiveProviderFailures = 0;
    for (const record of sorted) {
      if (record.status === 'success') break;
      if (!isProviderSideFailure(classifyApiError(record.error))) break;
      consecutiveProviderFailures += 1;
    }

    const successRate = sorted.length ? successes / sorted.length : null;

    let status: ProviderHealthStatus;
    if (sorted.length < MIN_SAMPLE) {
      status = 'unknown';
    } else if (consecutiveProviderFailures >= CIRCUIT_TRIP_THRESHOLD) {
      status = 'down';
    } else if (successRate !== null && successRate < DEGRADED_SUCCESS_RATE) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    const dominantError = (Object.entries(errorsByCategory) as [ApiErrorCategory, number][]).sort(
      (left, right) => right[1] - left[1],
    )[0]?.[0];

    health.push({
      providerId,
      status,
      requests: sorted.length,
      successes,
      failures,
      successRate,
      consecutiveProviderFailures,
      errorsByCategory,
      dominantError,
      medianDurationMs: median(
        sorted.map((record) => record.durationMs).filter((value): value is number => typeof value === 'number'),
      ),
      lastFailureAt: sorted.find((record) => record.status === 'failed')?.timestamp,
      lastSuccessAt: sorted.find((record) => record.status === 'success')?.timestamp,
    });
  }

  return health.sort((left, right) => right.requests - left.requests);
};

/** Đọc nhật ký thật rồi tính sức khoẻ. */
export const getProviderHealth = (
  now: number = Date.now(),
  windowMs: number = HEALTH_WINDOW_MS,
): ProviderHealth[] => computeProviderHealth(getUsageRecords(), now, windowMs);

/**
 * Nhà cung cấp này có nên bị bỏ qua khi định tuyến không.
 *
 * Chỉ ngắt khi lỗi liên tiếp đến từ phía nhà cung cấp. Hết tiền hay khóa sai
 * thì chuyển nhà cung cấp khác cũng vô ích, mà lại mất oan lựa chọn đang tốt.
 */
export const shouldSkipProvider = (health: ProviderHealth[], providerId: string): boolean =>
  health.some(
    (item) => item.providerId === providerId && item.status === 'down',
  );

/** Câu chẩn đoán ngắn để hiện trong giao diện. */
export const describeProviderHealth = (health: ProviderHealth): string => {
  if (health.status === 'unknown') {
    return `Chưa đủ dữ liệu (${health.requests}/${MIN_SAMPLE} lượt gọi).`;
  }

  const tyLe = health.successRate === null ? '—' : `${Math.round(health.successRate * 100)}%`;

  if (health.status === 'down') {
    const nguyenNhan = health.dominantError
      ? API_ERROR_CATEGORY_LABELS[health.dominantError].toLowerCase()
      : 'lỗi liên tiếp';
    return `Mất kết nối: ${health.consecutiveProviderFailures} lần lỗi liên tiếp do ${nguyenNhan}. Đang tạm bỏ qua khi định tuyến.`;
  }

  if (health.status === 'degraded') {
    const nguyenNhan = health.dominantError
      ? ` Chủ yếu do: ${API_ERROR_CATEGORY_LABELS[health.dominantError].toLowerCase()}.`
      : '';
    return `Chập chờn: thành công ${tyLe} trên ${health.requests} lượt.${nguyenNhan}`;
  }

  return `Bình thường: thành công ${tyLe} trên ${health.requests} lượt.`;
};
