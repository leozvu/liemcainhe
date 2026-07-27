import { describe, expect, it } from 'vitest';
import worker from '../worker/index.js';

const createFieldTestDb = () => {
  const records = new Map<string, string>();
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT item_id AS id')) return records.has(String(args[2])) ? { id: args[2] } : null;
          if (sql.includes('SELECT payload_json AS payload')) {
            const payload = records.get(String(args[2]));
            return payload ? { payload } : null;
          }
          return null;
        },
        all: async () => ({ results: Array.from(records.values()).reverse().map((payload) => ({ payload })) }),
        run: async () => {
          if (sql.includes('INSERT INTO egoric_workspace_items')) records.set(String(args[2]), String(args[3]));
          if (sql.includes('UPDATE egoric_workspace_items')) records.set(String(args[4]), String(args[0]));
          return { success: true };
        },
      }),
    }),
  };
};

const call = (DB: ReturnType<typeof createFieldTestDb>, path: string, init: RequestInit = {}) => worker.fetch(
  new Request(`https://studio.test${path}`, {
    ...init,
    headers: { 'oai-authenticated-user-email': 'owner@egoric.vn', 'content-type': 'application/json', ...(init.headers || {}) },
  }),
  { DB, MEDIA: {} },
);

describe('field test hai thiết bị trên D1', () => {
  it('bắt buộc danh tính workspace', async () => {
    const response = await worker.fetch(new Request('https://studio.test/api/cloud/workspace/field-tests', { method: 'POST' }), {
      DB: createFieldTestDb(), MEDIA: {},
    });
    expect(response.status).toBe(401);
  });

  it('chỉ cho A chốt sau khi một thiết bị B khác xác nhận', async () => {
    const DB = createFieldTestDb();
    const created = await call(DB, '/api/cloud/workspace/field-tests', {
      method: 'POST', body: JSON.stringify({ deviceId: 'device_a_123', deviceLabel: 'Laptop Account' }),
    });
    expect(created.status).toBe(201);
    const code = ((await created.json()) as { session: { code: string } }).session.code;

    const sameDevice = await call(DB, `/api/cloud/workspace/field-tests/${code}/ack`, {
      method: 'PUT', body: JSON.stringify({ deviceId: 'device_a_123', deviceLabel: 'Laptop Account' }),
    });
    expect(sameDevice.status).toBe(409);

    const acknowledged = await call(DB, `/api/cloud/workspace/field-tests/${code}/ack`, {
      method: 'PUT', body: JSON.stringify({ deviceId: 'device_b_456', deviceLabel: 'Máy dựng' }),
    });
    expect(acknowledged.status).toBe(200);
    expect(((await acknowledged.json()) as { session: { status: string } }).session.status).toBe('acknowledged');

    const wrongVerifier = await call(DB, `/api/cloud/workspace/field-tests/${code}/verify`, {
      method: 'PUT', body: JSON.stringify({ deviceId: 'device_b_456' }),
    });
    expect(wrongVerifier.status).toBe(403);

    const verified = await call(DB, `/api/cloud/workspace/field-tests/${code}/verify`, {
      method: 'PUT', body: JSON.stringify({ deviceId: 'device_a_123' }),
    });
    expect(verified.status).toBe(200);
    expect(((await verified.json()) as { session: { status: string; deviceB: { label: string } } }).session)
      .toMatchObject({ status: 'verified', deviceB: { label: 'Máy dựng' } });

    const latest = await call(DB, '/api/cloud/workspace/field-tests/latest');
    expect(latest.status).toBe(200);
    expect(((await latest.json()) as { session: { code: string } }).session.code).toBe(code);
  });
});
