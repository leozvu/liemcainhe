import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canFallbackFromModelError,
  getModelRoutingPolicy,
  getRoutingCandidates,
  saveModelRoutingPolicy,
} from '../services/modelRoutingService';
import { getModels } from '../services/modelRegistry';

afterEach(() => vi.unstubAllGlobals());

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

  it.each(['image', 'video'] as const)('không tự gọi model dự phòng cho %s dù người dùng đã cấu hình', (type) => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    const models = getModels(type).filter((model) => model.isEnabled);
    expect(models.length).toBeGreaterThan(1);
    const preferred = models[0];
    const fallback = models[1];
    const policy = getModelRoutingPolicy();
    saveModelRoutingPolicy({
      ...policy,
      enabled: true,
      maxAttempts: 3,
      fallbackModelIds: { ...policy.fallbackModelIds, [type]: [fallback.id] },
    });

    expect(getRoutingCandidates(type, preferred).map((model) => model.id)).toEqual([preferred.id]);
  });

  it('không tự đổi model hội thoại khi dùng chung số dư ShopAIKey', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    const preferred = getModels('chat').find((model) => model.providerId === 'shopaikey');
    expect(preferred).toBeTruthy();
    const policy = getModelRoutingPolicy();
    saveModelRoutingPolicy({
      ...policy,
      enabled: true,
      maxAttempts: 3,
      fallbackModelIds: {
        ...policy.fallbackModelIds,
        chat: getModels('chat').filter((model) => model.id !== preferred!.id).map((model) => model.id),
      },
    });

    expect(getRoutingCandidates('chat', preferred!).map((model) => model.id)).toEqual([preferred!.id]);
  });
});
