import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROVIDER_MODEL_AVAILABILITY_TTL_MS,
  clearProviderModelAvailability,
  getProviderModelAvailability,
  isProviderModelAllowed,
  saveProviderModelAvailability,
} from '../services/providerCapabilities';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  clearProviderModelAvailability('shopaikey');
});

afterEach(() => vi.unstubAllGlobals());

describe('provider model availability', () => {
  it('khử trùng và tra đúng quyền model', () => {
    const now = Date.now();
    saveProviderModelAvailability('shopaikey', ['gpt-5-mini', 'gpt-5-mini', 'grok-4-1-fast-reasoning'], now);
    expect(getProviderModelAvailability('shopaikey', now + 1)?.apiModelIds).toEqual([
      'gpt-5-mini',
      'grok-4-1-fast-reasoning',
    ]);
    expect(isProviderModelAllowed('shopaikey', 'gpt-5-mini')).toBe(true);
    expect(isProviderModelAllowed('shopaikey', 'gpt-4.1')).toBe(false);
  });

  it('không dùng danh sách quyền đã quá hạn', () => {
    saveProviderModelAvailability('shopaikey', ['gpt-5-mini'], 100);
    expect(getProviderModelAvailability('shopaikey', 100 + PROVIDER_MODEL_AVAILABILITY_TTL_MS + 1)).toBeUndefined();
  });

  it('coi chưa kiểm tra là chưa biết thay vì cấm model', () => {
    expect(isProviderModelAllowed('shopaikey', 'gpt-5-mini')).toBeUndefined();
  });
});
