import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canFallbackFromModelError,
  executeWithModelFallback,
  getModelRoutingPolicy,
  getRoutingCandidates,
  saveModelRoutingPolicy,
} from '../services/modelRoutingService';
import { getModels } from '../services/modelRegistry';
import { clearProviderModelAvailability, saveProviderModelAvailability } from '../services/providerCapabilities';

afterEach(() => vi.unstubAllGlobals());

describe('model fallback policy', () => {
  it('chỉ chuyển tuyến với mạng và lỗi hạ tầng chưa có output', () => {
    expect(canFallbackFromModelError(new Error('429 quota exceeded'))).toBe(false);
    expect(canFallbackFromModelError(new Error('503 service unavailable'))).toBe(true);
    expect(canFallbackFromModelError(new Error('Failed to fetch'))).toBe(true);
    expect(canFallbackFromModelError(new Error('401 invalid API key'))).toBe(false);
    expect(canFallbackFromModelError(new Error('403 permission denied'))).toBe(false);
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

  it('chuẩn bị tối đa số tuyến chat ShopAIKey được cấu hình', () => {
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

    const candidates = getRoutingCandidates('chat', preferred!).map((model) => model.id);
    expect(candidates[0]).toBe(preferred!.id);
    expect(candidates).toHaveLength(3);
  });

  it('bỏ model không thuộc nhóm quyền của key trước khi gọi tốn phí', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    clearProviderModelAvailability('shopaikey');
    saveProviderModelAvailability('shopaikey', ['gpt-5-mini']);
    const preferred = getModels('chat').find((model) => model.id === 'shopaikey-grok-fast')!;
    const candidates = getRoutingCandidates('chat', preferred);
    expect(candidates.map((model) => model.apiModel)).toEqual(['gpt-5-mini']);
  });

  it('không dùng catalog chat để chặn nhầm endpoint ảnh riêng', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    saveProviderModelAvailability('shopaikey', ['grok-4-1-fast-reasoning']);
    const preferred = getModels('image').find((model) => model.id === 'shopaikey-nano-banana-2')!;
    expect(getRoutingCandidates('image', preferred).map((model) => model.id)).toEqual([preferred.id]);
  });

  it('fallback chat đúng một lần và đánh dấu đã hết tuyến để lớp ngoài không retry lồng', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    clearProviderModelAvailability('shopaikey');
    const preferred = getModels('chat').find((model) => model.id === 'shopaikey-grok-fast')!;
    const policy = getModelRoutingPolicy();
    saveModelRoutingPolicy({
      ...policy,
      maxAttempts: 2,
      fallbackModelIds: { ...policy.fallbackModelIds, chat: ['shopaikey-gpt-5-mini'] },
    });
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('503 service unavailable'), { status: 503 }))
      .mockResolvedValueOnce('ok');

    await expect(executeWithModelFallback({ type: 'chat', preferred, operation })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);

    const exhausted = Object.assign(new Error('503 service unavailable'), { status: 503 });
    const alwaysFails = vi.fn().mockRejectedValue(exhausted);
    await expect(executeWithModelFallback({ type: 'chat', preferred, operation: alwaysFails })).rejects.toMatchObject({
      modelRoutingExhausted: true,
    });
    expect(alwaysFails).toHaveBeenCalledTimes(2);
  });
});
