export type WorkspaceFieldTestStatus = 'waiting' | 'acknowledged' | 'verified';

export interface WorkspaceFieldTestDevice {
  id: string;
  label: string;
}

export interface WorkspaceFieldTestSession {
  version: 1;
  id: string;
  code: string;
  status: WorkspaceFieldTestStatus;
  deviceA: WorkspaceFieldTestDevice;
  deviceB?: WorkspaceFieldTestDevice;
  createdAt: number;
  acknowledgedAt?: number;
  verifiedAt?: number;
  updatedAt: number;
  expiresAt: number;
}

export type WorkspaceFieldTestEvidence = WorkspaceFieldTestSession;

interface FieldTestResponse {
  session?: WorkspaceFieldTestSession;
  error?: string;
}

export interface WorkspaceFieldTestClientOptions {
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

const DEVICE_STORAGE_KEY = 'egoric_workspace_device_identity_v1';
const ACTIVE_TEST_STORAGE_KEY = 'egoric_workspace_field_test_active_v1';
const FIELD_TEST_CODE = /^[A-HJ-NP-Z2-9]{8}$/;

const createDeviceId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
};

const getDefaultStorage = (): Pick<Storage, 'getItem' | 'setItem'> | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export const normalizeWorkspaceFieldTestCode = (value: string): string =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

export const getWorkspaceDeviceIdentity = (
  label?: string,
  storage = getDefaultStorage(),
): WorkspaceFieldTestDevice => {
  let id = '';
  let savedLabel = '';
  try {
    const saved = JSON.parse(storage?.getItem(DEVICE_STORAGE_KEY) || 'null') as Partial<WorkspaceFieldTestDevice> | null;
    if (saved && typeof saved.id === 'string' && /^[a-zA-Z0-9_-]{8,160}$/.test(saved.id)) {
      id = saved.id;
      savedLabel = String(saved.label || '').trim().slice(0, 80);
    }
  } catch {
    // Tạo lại danh tính cục bộ khi bản lưu cũ hỏng; không ảnh hưởng dữ liệu cloud.
  }
  const normalizedLabel = label?.trim().slice(0, 80) || savedLabel || 'Thiết bị của tôi';
  const device = { id: id || createDeviceId(), label: normalizedLabel };
  try { storage?.setItem(DEVICE_STORAGE_KEY, JSON.stringify(device)); } catch { /* Chế độ riêng tư vẫn dùng được trong phiên. */ }
  return device;
};

const rememberActiveCode = (code: string, storage = getDefaultStorage()): void => {
  try { storage?.setItem(ACTIVE_TEST_STORAGE_KEY, code); } catch { /* Bản cloud vẫn là nguồn sự thật. */ }
};

const parseSession = (value: unknown): WorkspaceFieldTestSession => {
  const session = value as Partial<WorkspaceFieldTestSession> | undefined;
  if (!session || session.version !== 1 || !session.id || !FIELD_TEST_CODE.test(session.code || '')
    || !['waiting', 'acknowledged', 'verified'].includes(session.status || '')
    || !session.deviceA?.id || !session.deviceA?.label
    || !Number(session.createdAt) || !Number(session.updatedAt) || !Number(session.expiresAt)) {
    throw new Error('Bằng chứng đồng bộ cloud không hợp lệ.');
  }
  return session as WorkspaceFieldTestSession;
};

const requestFieldTest = async (
  path: string,
  init: RequestInit,
  options: WorkspaceFieldTestClientOptions,
): Promise<WorkspaceFieldTestSession | undefined> => {
  const response = await (options.fetchImpl || fetch)(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const data = await response.json().catch(() => ({})) as FieldTestResponse;
  if (!response.ok) throw new Error(data.error || `Cloud từ chối yêu cầu (${response.status}).`);
  return data.session ? parseSession(data.session) : undefined;
};

export const createWorkspaceFieldTest = async (
  deviceLabel: string,
  options: WorkspaceFieldTestClientOptions = {},
): Promise<WorkspaceFieldTestSession> => {
  const device = getWorkspaceDeviceIdentity(deviceLabel, options.storage ?? getDefaultStorage());
  const session = await requestFieldTest('/api/cloud/workspace/field-tests', {
    method: 'POST',
    body: JSON.stringify({ deviceId: device.id, deviceLabel: device.label }),
  }, options);
  if (!session) throw new Error('Cloud chưa trả mã kiểm tra.');
  rememberActiveCode(session.code, options.storage ?? getDefaultStorage());
  return session;
};

export const loadActiveWorkspaceFieldTest = async (
  options: WorkspaceFieldTestClientOptions = {},
): Promise<WorkspaceFieldTestSession | undefined> => {
  let code = '';
  try { code = options.storage?.getItem(ACTIVE_TEST_STORAGE_KEY) || getDefaultStorage()?.getItem(ACTIVE_TEST_STORAGE_KEY) || ''; } catch { /* Không có con trỏ local. */ }
  if (!FIELD_TEST_CODE.test(code)) return undefined;
  try {
    return await getWorkspaceFieldTest(code, options);
  } catch (error) {
    if (error instanceof Error && /hết hạn|Không tìm thấy/.test(error.message)) return undefined;
    throw error;
  }
};

export const getWorkspaceFieldTest = async (
  code: string,
  options: WorkspaceFieldTestClientOptions = {},
): Promise<WorkspaceFieldTestSession> => {
  const normalized = normalizeWorkspaceFieldTestCode(code);
  if (!FIELD_TEST_CODE.test(normalized)) throw new Error('Mã kiểm tra phải có đúng 8 ký tự.');
  const session = await requestFieldTest(`/api/cloud/workspace/field-tests/${normalized}`, { method: 'GET' }, options);
  if (!session) throw new Error('Không tìm thấy phiên kiểm tra.');
  return session;
};

export const acknowledgeWorkspaceFieldTest = async (
  code: string,
  deviceLabel: string,
  options: WorkspaceFieldTestClientOptions = {},
): Promise<WorkspaceFieldTestSession> => {
  const normalized = normalizeWorkspaceFieldTestCode(code);
  if (!FIELD_TEST_CODE.test(normalized)) throw new Error('Mã kiểm tra phải có đúng 8 ký tự.');
  const device = getWorkspaceDeviceIdentity(deviceLabel, options.storage ?? getDefaultStorage());
  const session = await requestFieldTest(`/api/cloud/workspace/field-tests/${normalized}/ack`, {
    method: 'PUT',
    body: JSON.stringify({ deviceId: device.id, deviceLabel: device.label }),
  }, options);
  if (!session) throw new Error('Cloud chưa ghi nhận thiết bị B.');
  rememberActiveCode(session.code, options.storage ?? getDefaultStorage());
  return session;
};

export const verifyWorkspaceFieldTest = async (
  code: string,
  deviceLabel: string,
  options: WorkspaceFieldTestClientOptions = {},
): Promise<WorkspaceFieldTestSession> => {
  const normalized = normalizeWorkspaceFieldTestCode(code);
  if (!FIELD_TEST_CODE.test(normalized)) throw new Error('Mã kiểm tra phải có đúng 8 ký tự.');
  const device = getWorkspaceDeviceIdentity(deviceLabel, options.storage ?? getDefaultStorage());
  const session = await requestFieldTest(`/api/cloud/workspace/field-tests/${normalized}/verify`, {
    method: 'PUT',
    body: JSON.stringify({ deviceId: device.id }),
  }, options);
  if (!session) throw new Error('Cloud chưa chốt bằng chứng.');
  return session;
};

export const loadLatestVerifiedWorkspaceFieldTest = async (
  options: WorkspaceFieldTestClientOptions = {},
): Promise<WorkspaceFieldTestSession | undefined> =>
  requestFieldTest('/api/cloud/workspace/field-tests/latest', { method: 'GET' }, options);
