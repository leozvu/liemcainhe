import { describe, expect, it, vi } from 'vitest';
import {
  acknowledgeWorkspaceFieldTest,
  createWorkspaceFieldTest,
  getWorkspaceDeviceIdentity,
  loadLatestVerifiedWorkspaceFieldTest,
  normalizeWorkspaceFieldTestCode,
  verifyWorkspaceFieldTest,
  WorkspaceFieldTestSession,
} from '../services/workspaceFieldTestService';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
};

const session: WorkspaceFieldTestSession = {
  version: 1,
  id: 'ABCD2345',
  code: 'ABCD2345',
  status: 'verified',
  deviceA: { id: 'device_a_123', label: 'Laptop Account' },
  deviceB: { id: 'device_b_456', label: 'Máy dựng' },
  createdAt: 100,
  acknowledgedAt: 200,
  verifiedAt: 300,
  updatedAt: 300,
  expiresAt: 10_000,
};

describe('workspace field test client', () => {
  it('giữ một danh tính ổn định trên cùng thiết bị và cho đổi nhãn', () => {
    const storage = createStorage();
    const first = getWorkspaceDeviceIdentity('Laptop Account', storage);
    const second = getWorkspaceDeviceIdentity('Laptop Director', storage);
    expect(second.id).toBe(first.id);
    expect(second.label).toBe('Laptop Director');
  });

  it('chuẩn hóa mã viết thường và bỏ dấu cách', () => {
    expect(normalizeWorkspaceFieldTestCode(' abcd-2345 ')).toBe('ABCD2345');
  });

  it('gửi đúng contract tạo, xác nhận, chốt và đọc bằng chứng mới nhất', async () => {
    const storageA = createStorage();
    const storageB = createStorage();
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ session }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await createWorkspaceFieldTest('Laptop Account', { fetchImpl, storage: storageA });
    expect(fetchImpl).toHaveBeenLastCalledWith('/api/cloud/workspace/field-tests', expect.objectContaining({ method: 'POST' }));

    await acknowledgeWorkspaceFieldTest('abcd 2345', 'Máy dựng', { fetchImpl, storage: storageB });
    const acknowledgeInit = fetchImpl.mock.calls.at(-1)?.[1] as RequestInit;
    expect(fetchImpl.mock.calls.at(-1)?.[0]).toBe('/api/cloud/workspace/field-tests/ABCD2345/ack');
    expect(JSON.parse(String(acknowledgeInit.body))).toMatchObject({ deviceLabel: 'Máy dựng' });

    await verifyWorkspaceFieldTest('ABCD2345', 'Laptop Account', { fetchImpl, storage: storageA });
    expect(fetchImpl.mock.calls.at(-1)?.[0]).toBe('/api/cloud/workspace/field-tests/ABCD2345/verify');

    await loadLatestVerifiedWorkspaceFieldTest({ fetchImpl, storage: storageA });
    expect(fetchImpl.mock.calls.at(-1)?.[0]).toBe('/api/cloud/workspace/field-tests/latest');
  });

  it('hiện lỗi tiếng Việt do cloud trả về', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Phải dùng thiết bị khác.' }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    }));
    await expect(acknowledgeWorkspaceFieldTest('ABCD2345', 'Máy B', { fetchImpl, storage: createStorage() }))
      .rejects.toThrow('Phải dùng thiết bị khác.');
  });
});
