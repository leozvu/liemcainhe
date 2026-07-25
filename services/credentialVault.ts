/**
 * Kho khóa BYOK theo phiên trình duyệt.
 *
 * Khóa không được ghi vào localStorage, IndexedDB, project payload hay cloud.
 * sessionStorage chỉ tồn tại trong tab/phiên hiện tại và được trình duyệt xóa
 * khi phiên kết thúc. Đây là ranh giới an toàn phù hợp cho bản Sites dùng khóa
 * riêng của khách hàng mà không yêu cầu máy chủ giữ bí mật của họ.
 */

export interface StoredVoiceCredentials {
  apiKey?: string;
  appId?: string;
  callbackUrl?: string;
}

/** Thông tin đăng nhập của một kênh đăng bài. */
export interface StoredPublishCredentials {
  accessToken?: string;
  accountId?: string;
}

interface CredentialVaultState {
  providerKeys: Record<string, string>;
  modelKeys: Record<string, string>;
  voiceCredentials: Record<string, StoredVoiceCredentials>;
  publishCredentials: Record<string, StoredPublishCredentials>;
}

const SESSION_KEY = 'egoric_secure_credential_vault_v1';

const emptyVault = (): CredentialVaultState => ({
  providerKeys: {},
  modelKeys: {},
  voiceCredentials: {},
  publishCredentials: {},
});

const readVault = (): CredentialVaultState => {
  if (typeof sessionStorage === 'undefined') return emptyVault();
  try {
    const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
    return {
      providerKeys: stored.providerKeys || {},
      modelKeys: stored.modelKeys || {},
      voiceCredentials: stored.voiceCredentials || {},
      publishCredentials: stored.publishCredentials || {},
    };
  } catch {
    return emptyVault();
  }
};

const writeVault = (state: CredentialVaultState): void => {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
};

const normalizedSecret = (value?: string): string | undefined => value?.trim() || undefined;

export const getProviderSecret = (providerId: string): string | undefined =>
  readVault().providerKeys[providerId];

export const setProviderSecret = (providerId: string, value?: string): void => {
  const state = readVault();
  const secret = normalizedSecret(value);
  if (secret) state.providerKeys[providerId] = secret;
  else delete state.providerKeys[providerId];
  writeVault(state);
};

export const getModelSecret = (modelId: string): string | undefined =>
  readVault().modelKeys[modelId];

export const setModelSecret = (modelId: string, value?: string): void => {
  const state = readVault();
  const secret = normalizedSecret(value);
  if (secret) state.modelKeys[modelId] = secret;
  else delete state.modelKeys[modelId];
  writeVault(state);
};

export const getVoiceSecret = (providerId: string): StoredVoiceCredentials =>
  readVault().voiceCredentials[providerId] || {};

export const setVoiceSecret = (providerId: string, credentials: StoredVoiceCredentials): void => {
  const state = readVault();
  const normalized = {
    apiKey: normalizedSecret(credentials.apiKey),
    appId: normalizedSecret(credentials.appId),
    callbackUrl: normalizedSecret(credentials.callbackUrl),
  };
  if (normalized.apiKey || normalized.appId || normalized.callbackUrl) {
    state.voiceCredentials[providerId] = normalized;
  } else {
    delete state.voiceCredentials[providerId];
  }
  writeVault(state);
};

export const clearModelCredentials = (): void => {
  const state = readVault();
  state.providerKeys = {};
  state.modelKeys = {};
  writeVault(state);
};

export const getPublishSecret = (channelId: string): StoredPublishCredentials =>
  readVault().publishCredentials[channelId] || {};

export const setPublishSecret = (
  channelId: string,
  credentials: StoredPublishCredentials,
): void => {
  const state = readVault();
  const normalized = {
    accessToken: normalizedSecret(credentials.accessToken),
    accountId: normalizedSecret(credentials.accountId),
  };
  if (normalized.accessToken || normalized.accountId) {
    state.publishCredentials[channelId] = normalized;
  } else {
    delete state.publishCredentials[channelId];
  }
  writeVault(state);
};

export const clearPublishSecret = (channelId: string): void => setPublishSecret(channelId, {});

export const clearVoiceSecret = (providerId: string): void => setVoiceSecret(providerId, {});

export const clearCredentialVault = (): void => {
  if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SESSION_KEY);
};

export const getCredentialVaultStatus = () => {
  const state = readVault();
  return {
    providerCount: Object.keys(state.providerKeys).length,
    modelCount: Object.keys(state.modelKeys).length,
    voiceProviderCount: Object.values(state.voiceCredentials).filter((item) => Boolean(item.apiKey)).length,
    publishChannelCount: Object.values(state.publishCredentials).filter((item) => Boolean(item.accessToken)).length,
    persistence: 'session' as const,
  };
};
