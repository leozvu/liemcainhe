import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CATEGORY_LABELS,
  classifyApiError,
  isProviderSideFailure,
  localizeApiErrorMessage,
} from '../services/apiErrorLocalization';
import {
  CIRCUIT_TRIP_THRESHOLD,
  MIN_SAMPLE,
  computeProviderHealth,
  describeProviderHealth,
  shouldSkipProvider,
} from '../services/providerHealthService';
import { applyCircuitBreaker } from '../services/modelRoutingService';
import { UsageRecord } from '../services/usageService';
import { ModelDefinition } from '../types/model';

const NOW = 1_700_000_000_000;

/**
 * Dùng đúng chuỗi mà hệ thống thật lưu xuống nhật ký.
 *
 * recordUsage lưu thông báo đã việt hoá chứ không lưu lỗi gốc của nhà cung
 * cấp, nên test mà dùng "503 service unavailable" thì không phản ánh thực tế
 * và sẽ bỏ lọt lỗi phân loại.
 */
const LOI_GIAN_DOAN = localizeApiErrorMessage('', 503);
const LOI_HET_TIEN = localizeApiErrorMessage('', 402);

let seq = 0;
const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  id: `u${(seq += 1)}`,
  timestamp: NOW - 1000,
  kind: 'chat',
  providerId: 'openrouter',
  units: 1,
  estimatedCostUsd: 0.01,
  status: 'success',
  ...over,
});

describe('phân loại lỗi nhà cung cấp', () => {
  it('nhận ra hết số dư qua mã HTTP và qua nội dung', () => {
    expect(classifyApiError('', 402)).toBe('balance');
    expect(classifyApiError('Insufficient credit balance')).toBe('balance');
  });

  it('nhận ra giới hạn tốc độ và giới hạn đồng thời', () => {
    expect(classifyApiError('', 429)).toBe('rate-limit');
    expect(classifyApiError('too many concurrent tasks')).toBe('rate-limit');
    expect(classifyApiError('queue is full')).toBe('rate-limit');
  });

  it('tách bạch khoá sai, thiếu quyền và bị kiểm duyệt', () => {
    expect(classifyApiError('invalid api key')).toBe('auth');
    expect(classifyApiError('', 403)).toBe('permission');
    expect(classifyApiError('blocked by content policy')).toBe('moderation');
  });

  it('nhận ra gián đoạn máy chủ và lỗi mạng', () => {
    expect(classifyApiError('', 503)).toBe('server');
    expect(classifyApiError('Failed to fetch')).toBe('network');
  });

  it('chỉ coi rate-limit, server và network là lỗi phía nhà cung cấp', () => {
    expect(isProviderSideFailure('rate-limit')).toBe(true);
    expect(isProviderSideFailure('server')).toBe(true);
    expect(isProviderSideFailure('network')).toBe(true);
    // Hết tiền hay khoá sai thì đổi nhà cung cấp cũng hỏng y hệt.
    expect(isProviderSideFailure('balance')).toBe(false);
    expect(isProviderSideFailure('auth')).toBe(false);
    expect(isProviderSideFailure('moderation')).toBe(false);
  });

  it('mọi loại đều có nhãn tiếng Việt', () => {
    for (const label of Object.values(API_ERROR_CATEGORY_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('phân loại được chính thông báo đã việt hoá mà nhật ký lưu xuống', () => {
    // Đây là đường đi thật: chatAdapter việt hoá lỗi rồi ném, executeWithModelFallback
    // lưu message đã việt hoá. Dò mẫu tiếng Anh sẽ trượt hết.
    expect(classifyApiError(localizeApiErrorMessage('', 402))).toBe('balance');
    expect(classifyApiError(localizeApiErrorMessage('', 429))).toBe('rate-limit');
    expect(classifyApiError(localizeApiErrorMessage('', 401))).toBe('auth');
    expect(classifyApiError(localizeApiErrorMessage('', 403))).toBe('permission');
    expect(classifyApiError(localizeApiErrorMessage('blocked by content policy'))).toBe('moderation');
    expect(classifyApiError(localizeApiErrorMessage('', 503))).toBe('server');
    expect(classifyApiError(localizeApiErrorMessage('Failed to fetch'))).toBe('network');
  });
});

describe('tính sức khoẻ nhà cung cấp', () => {
  it('chưa đủ mẫu thì không kết luận', () => {
    const health = computeProviderHealth([rec({}), rec({})], NOW);
    expect(health[0].status).toBe('unknown');
    expect(describeProviderHealth(health[0])).toContain(`2/${MIN_SAMPLE}`);
  });

  it('toàn thành công thì bình thường', () => {
    const records = Array.from({ length: 5 }, () => rec({}));
    const health = computeProviderHealth(records, NOW);
    expect(health[0].status).toBe('healthy');
    expect(health[0].successRate).toBe(1);
  });

  it('thành công dưới ngưỡng thì chập chờn', () => {
    const records = [
      ...Array.from({ length: 3 }, () => rec({ status: 'failed', error: LOI_HET_TIEN })),
      ...Array.from({ length: 2 }, () => rec({})),
    ];
    const health = computeProviderHealth(records, NOW);
    expect(health[0].status).toBe('degraded');
    expect(health[0].dominantError).toBe('balance');
    expect(describeProviderHealth(health[0])).toContain('Chập chờn');
  });

  it('lỗi liên tiếp phía nhà cung cấp thì coi là mất kết nối', () => {
    const records = Array.from({ length: CIRCUIT_TRIP_THRESHOLD }, (_, i) =>
      rec({ status: 'failed', error: LOI_GIAN_DOAN, timestamp: NOW - i * 1000 }),
    );
    const health = computeProviderHealth(records, NOW);
    expect(health[0].status).toBe('down');
    expect(health[0].consecutiveProviderFailures).toBe(CIRCUIT_TRIP_THRESHOLD);
    expect(describeProviderHealth(health[0])).toContain('Mất kết nối');
  });

  it('hết tiền liên tiếp KHÔNG làm mất kết nối, vì đổi nhà cung cấp cũng vô ích', () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      rec({ status: 'failed', error: LOI_HET_TIEN, timestamp: NOW - i * 1000 }),
    );
    const health = computeProviderHealth(records, NOW);
    expect(health[0].consecutiveProviderFailures).toBe(0);
    expect(health[0].status).toBe('degraded');
  });

  it('một lần thành công cắt đứt chuỗi lỗi liên tiếp', () => {
    const records = [
      rec({ status: 'failed', error: LOI_GIAN_DOAN, timestamp: NOW - 1000 }),
      rec({ status: 'failed', error: LOI_GIAN_DOAN, timestamp: NOW - 2000 }),
      rec({ status: 'success', timestamp: NOW - 3000 }),
      rec({ status: 'failed', error: LOI_GIAN_DOAN, timestamp: NOW - 4000 }),
      rec({ status: 'failed', error: LOI_GIAN_DOAN, timestamp: NOW - 5000 }),
    ];
    const health = computeProviderHealth(records, NOW);
    expect(health[0].consecutiveProviderFailures).toBe(2);
    expect(health[0].status).not.toBe('down');
  });

  it('bỏ qua bản ghi ngoài cửa sổ thời gian', () => {
    const records = [
      ...Array.from({ length: 5 }, () => rec({ timestamp: NOW - 10 * 60 * 60 * 1000, status: 'failed', error: LOI_GIAN_DOAN })),
      ...Array.from({ length: 3 }, () => rec({})),
    ];
    const health = computeProviderHealth(records, NOW);
    expect(health[0].requests).toBe(3);
    expect(health[0].status).toBe('healthy');
  });

  it('tách riêng từng nhà cung cấp và xếp theo lưu lượng', () => {
    const records = [
      ...Array.from({ length: 6 }, () => rec({ providerId: 'openrouter' })),
      ...Array.from({ length: 3 }, () => rec({ providerId: 'kie-ai' })),
    ];
    const health = computeProviderHealth(records, NOW);
    expect(health.map((item) => item.providerId)).toEqual(['openrouter', 'kie-ai']);
  });

  it('bỏ qua bản ghi không có providerId', () => {
    expect(computeProviderHealth([rec({ providerId: undefined })], NOW)).toEqual([]);
  });

  it('tính trung vị thời gian phản hồi', () => {
    const records = [100, 200, 900].map((durationMs) => rec({ durationMs }));
    expect(computeProviderHealth(records, NOW)[0].medianDurationMs).toBe(200);
  });
});

describe('ngắt mạch khi định tuyến', () => {
  const model = (id: string, providerId: string): ModelDefinition =>
    ({ id, providerId, type: 'chat', isEnabled: true }) as ModelDefinition;

  const downHealth = computeProviderHealth(
    Array.from({ length: CIRCUIT_TRIP_THRESHOLD }, (_, i) =>
      rec({ providerId: 'openrouter', status: 'failed', error: LOI_GIAN_DOAN, timestamp: NOW - i * 1000 }),
    ),
    NOW,
  );

  it('nhận ra nhà cung cấp cần bỏ qua', () => {
    expect(shouldSkipProvider(downHealth, 'openrouter')).toBe(true);
    expect(shouldSkipProvider(downHealth, 'google')).toBe(false);
  });

  it('loại model của nhà cung cấp đang chết, giữ lại nhà cung cấp còn sống', () => {
    const candidates = [model('a', 'openrouter'), model('b', 'google')];
    expect(applyCircuitBreaker(candidates, downHealth).map((m) => m.id)).toEqual(['b']);
  });

  it('lọc xong rỗng thì trả lại nguyên danh sách, không để không còn gì để thử', () => {
    const candidates = [model('a', 'openrouter')];
    expect(applyCircuitBreaker(candidates, downHealth).map((m) => m.id)).toEqual(['a']);
  });

  it('không có dữ liệu sức khoẻ thì giữ nguyên mọi lựa chọn', () => {
    const candidates = [model('a', 'openrouter'), model('b', 'google')];
    expect(applyCircuitBreaker(candidates, [])).toHaveLength(2);
  });
});
