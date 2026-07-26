import { beforeEach, describe, expect, it } from 'vitest';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), configurable: true });

import { clearCredentialVault, getCredentialVaultStatus, getProviderSecret, setProviderSecret } from '../services/credentialVault';

describe('session credential vault', () => {
  beforeEach(() => clearCredentialVault());

  it('giữ khóa trong session vault và xóa theo yêu cầu', () => {
    setProviderSecret('openrouter', '  sk-test  ');
    expect(getProviderSecret('openrouter')).toBe('sk-test');
    expect(getCredentialVaultStatus().providerCount).toBe(1);
    setProviderSecret('openrouter', undefined);
    expect(getProviderSecret('openrouter')).toBeUndefined();
  });
});
