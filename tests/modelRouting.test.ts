import { describe, expect, it } from 'vitest';
import { canFallbackFromModelError } from '../services/modelRoutingService';

describe('model fallback policy', () => {
  it('chuyển tuyến với quota, mạng và lỗi hạ tầng', () => {
    expect(canFallbackFromModelError(new Error('429 quota exceeded'))).toBe(true);
    expect(canFallbackFromModelError(new Error('503 service unavailable'))).toBe(true);
    expect(canFallbackFromModelError(new Error('Failed to fetch'))).toBe(true);
  });

  it('không chuyển tuyến với input hoặc content policy', () => {
    expect(canFallbackFromModelError(new Error('400 tham số không hợp lệ'))).toBe(false);
    expect(canFallbackFromModelError(new Error('Vi phạm content policy'))).toBe(false);
  });
});
