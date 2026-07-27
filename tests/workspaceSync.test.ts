import { beforeEach, describe, expect, it } from 'vitest';
import {
  COLLECTION_SHAPES,
  LocalStore,
  SyncRecord,
  SyncTransport,
  WORKSPACE_COLLECTIONS,
  WorkspaceCollection,
  changedSince,
  clearSyncMarks,
  describeSyncOutcomes,
  getSyncMark,
  highWaterMark,
  mergeCollection,
  setSyncMark,
  syncAllCollections,
  syncCollection,
  toSyncRecord,
} from '../services/workspaceSyncService';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
});

const rec = (id: string, updatedAt: number, payload: unknown = { v: id }): SyncRecord => ({
  id,
  updatedAt,
  payload,
});

const tomb = (id: string, deletedAt: number): SyncRecord => ({
  id,
  updatedAt: deletedAt,
  deletedAt,
  payload: null,
});

describe('hợp nhất hai phía', () => {
  it('bản ghi chỉ có ở máy thì đẩy lên', () => {
    const plan = mergeCollection([rec('a', 10)], []);
    expect(plan.toRemote.map((r) => r.id)).toEqual(['a']);
    expect(plan.toLocal).toEqual([]);
  });

  it('bản ghi chỉ có trên cloud thì tải về', () => {
    const plan = mergeCollection([], [rec('a', 10)]);
    expect(plan.toLocal.map((r) => r.id)).toEqual(['a']);
  });

  it('bản mới hơn thắng, bất kể nó ở phía nào', () => {
    expect(mergeCollection([rec('a', 20)], [rec('a', 10)]).toRemote).toHaveLength(1);
    expect(mergeCollection([rec('a', 10)], [rec('a', 20)]).toLocal).toHaveLength(1);
  });

  it('giống hệt nhau thì không làm gì cả — không ghi thừa mỗi lần đồng bộ', () => {
    const plan = mergeCollection([rec('a', 10)], [rec('a', 10)]);
    expect(plan.toLocal).toEqual([]);
    expect(plan.toRemote).toEqual([]);
    expect(plan.toDeleteLocal).toEqual([]);
  });

  it('trùng mốc nhưng khác nội dung thì hai máy phải chọn ra CÙNG một kết quả', () => {
    const mine = rec('a', 10, { v: 'aaa' });
    const theirs = rec('a', 10, { v: 'bbb' });

    // Máy A nhìn thấy (mine, theirs); máy B nhìn thấy (theirs, mine).
    const onA = mergeCollection([mine], [theirs]);
    const onB = mergeCollection([theirs], [mine]);

    // A giữ bản của mình thì B phải nhận bản đó về, và ngược lại — không bên
    // nào được kết luận "phía kia thua" cùng lúc, nếu không sẽ đẩy qua đẩy lại.
    const aKeepsOwn = onA.toRemote.length > 0;
    const bKeepsOwn = onB.toRemote.length > 0;
    expect(aKeepsOwn).not.toBe(bKeepsOwn);
  });
});

describe('bia mộ', () => {
  it('cloud báo đã xoá thì xoá luôn ở máy', () => {
    const plan = mergeCollection([rec('a', 10)], [tomb('a', 20)]);
    expect(plan.toDeleteLocal).toEqual(['a']);
    expect(plan.toLocal).toEqual([]);
  });

  it('xoá ở máy thì đẩy bia mộ lên, nếu không máy khác không bao giờ biết', () => {
    const plan = mergeCollection([tomb('a', 20)], []);
    expect(plan.toRemote.map((r) => r.id)).toEqual(['a']);
  });

  it('sửa sau khi xoá thì bản sửa thắng — người đụng sau cùng biết rõ hơn', () => {
    const plan = mergeCollection([rec('a', 30)], [tomb('a', 20)]);
    expect(plan.toDeleteLocal).toEqual([]);
    expect(plan.toRemote.map((r) => r.id)).toEqual(['a']);
  });

  it('xoá sau khi sửa thì bản xoá thắng', () => {
    expect(mergeCollection([rec('a', 10)], [tomb('a', 30)]).toDeleteLocal).toEqual(['a']);
  });

  it('bia mộ cho thứ máy này chưa từng có thì không phải làm gì', () => {
    const plan = mergeCollection([], [tomb('a', 20)]);
    expect(plan.toLocal).toEqual([]);
    expect(plan.toDeleteLocal).toEqual([]);
  });
});

describe('mốc đồng bộ', () => {
  it('chỉ lấy bản ghi đổi sau mốc', () => {
    expect(changedSince([rec('a', 5), rec('b', 15)], 10).map((r) => r.id)).toEqual(['b']);
  });

  it('bia mộ tính theo mốc xoá, không theo mốc sửa', () => {
    const deleted: SyncRecord = { id: 'a', updatedAt: 5, deletedAt: 15, payload: null };
    expect(changedSince([deleted], 10).map((r) => r.id)).toEqual(['a']);
  });

  it('mốc cao nhất tính cả mốc xoá', () => {
    expect(highWaterMark([rec('a', 10), tomb('b', 25)])).toBe(25);
  });

  it('danh sách rỗng thì giữ nguyên mốc cũ', () => {
    expect(highWaterMark([], 42)).toBe(42);
  });

  it('mốc lưu và đọc lại được theo từng bộ', () => {
    setSyncMark('agencyClients', 100);
    expect(getSyncMark('agencyClients')).toBe(100);
    expect(getSyncMark('articleLibrary')).toBe(0);
    clearSyncMarks();
    expect(getSyncMark('agencyClients')).toBe(0);
  });
});

describe('chạy đồng bộ', () => {
  const makeStore = (seed: Partial<Record<WorkspaceCollection, SyncRecord[]>> = {}) => {
    const data: Partial<Record<WorkspaceCollection, SyncRecord[]>> = { ...seed };
    const store: LocalStore = {
      readAll: async (collection) => [...(data[collection] ?? [])],
      write: async (collection, records) => {
        const current = [...(data[collection] ?? [])];
        records.forEach((record) => {
          const index = current.findIndex((row) => row.id === record.id);
          if (index >= 0) current[index] = record;
          else current.push(record);
        });
        data[collection] = current;
      },
      remove: async (collection, ids) => {
        data[collection] = (data[collection] ?? []).filter((row) => !ids.includes(row.id));
      },
    };
    return { store, data };
  };

  const makeTransport = (remote: SyncRecord[] = []): SyncTransport & { pushed: SyncRecord[] } => ({
    pushed: [],
    pull: async () => [...remote],
    push: async function (this: { pushed: SyncRecord[] }, _collection, records) {
      this.pushed.push(...records);
    },
  });

  it('tải bản ghi mới từ cloud xuống kho cục bộ', async () => {
    const { store, data } = makeStore();
    const transport = makeTransport([rec('a', 10)]);

    const outcome = await syncCollection('agencyClients', store, transport);

    expect(outcome.pulled).toBe(1);
    expect(data.agencyClients?.map((r) => r.id)).toEqual(['a']);
  });

  it('đẩy bản ghi cục bộ lên cloud', async () => {
    const { store } = makeStore({ agencyClients: [rec('a', 10)] });
    const transport = makeTransport();

    const outcome = await syncCollection('agencyClients', store, transport);

    expect(outcome.pushed).toBe(1);
    expect(transport.pushed.map((r) => r.id)).toEqual(['a']);
  });

  it('KHÔNG ném lỗi khi mất mạng — đồng bộ hỏng không được làm hỏng việc đang làm', async () => {
    const { store } = makeStore({ agencyClients: [rec('a', 10)] });
    const broken: SyncTransport = {
      pull: async () => {
        throw new Error('Failed to fetch');
      },
      push: async () => undefined,
    };

    const outcome = await syncCollection('agencyClients', store, broken);
    expect(outcome.error).toContain('Failed to fetch');
    expect(outcome.pushed).toBe(0);
  });

  it('lỗi thì KHÔNG nhích mốc — lần sau phải thử lại từ đúng chỗ cũ', async () => {
    setSyncMark('agencyClients', 5);
    const { store } = makeStore({ agencyClients: [rec('a', 99)] });
    const broken: SyncTransport = {
      pull: async () => {
        throw new Error('đứt mạng');
      },
      push: async () => undefined,
    };

    await syncCollection('agencyClients', store, broken);
    expect(getSyncMark('agencyClients')).toBe(5);
  });

  it('đẩy hỏng thì cũng không nhích mốc', async () => {
    const { store } = makeStore({ agencyClients: [rec('a', 99)] });
    const transport: SyncTransport = {
      pull: async () => [],
      push: async () => {
        throw new Error('server từ chối');
      },
    };

    await syncCollection('agencyClients', store, transport);
    expect(getSyncMark('agencyClients')).toBe(0);
  });

  it('thành công thì nhích mốc lên bản ghi mới nhất', async () => {
    const { store } = makeStore({ agencyClients: [rec('a', 70)] });
    await syncCollection('agencyClients', store, makeTransport([rec('b', 90)]));
    expect(getSyncMark('agencyClients')).toBe(90);
  });

  it('một bộ hỏng không làm dừng các bộ còn lại', async () => {
    const { store } = makeStore({ agencyClients: [rec('a', 10)] });
    let calls = 0;
    const flaky: SyncTransport = {
      pull: async () => {
        calls += 1;
        if (calls === 1) throw new Error('hỏng bộ đầu');
        return [];
      },
      push: async () => undefined,
    };

    const outcomes = await syncAllCollections(store, flaky);
    expect(outcomes).toHaveLength(6);
    expect(outcomes[0].error).toBeDefined();
    expect(outcomes.slice(1).every((outcome) => !outcome.error)).toBe(true);
  });
});

describe('mỗi kho một hình dạng', () => {
  it('kho thường lấy id và updatedAt', () => {
    const record = toSyncRecord('agencyClients', { id: 'c1', updatedAt: 42, name: 'Hạnh' });
    expect(record.id).toBe('c1');
    expect(record.updatedAt).toBe(42);
  });

  it('Campaign 0 dùng campaignId làm khóa cloud', () => {
    const record = toSyncRecord('campaignZeroRuns', { campaignId: 'campaign_0', updatedAt: 84, status: 'running' });
    expect(record).toMatchObject({ id: 'campaign_0', updatedAt: 84 });
  });

  it('sổ cái đăng bài khoá theo fingerprint, KHÔNG phải id', () => {
    const record = toSyncRecord('publishLedger', { fingerprint: 'fp1', startedAt: 10 });
    expect(record.id).toBe('fp1');
    expect(COLLECTION_SHAPES.publishLedger.key).toBe('fingerprint');
  });

  it('sổ cái dùng finishedAt khi đã xong', () => {
    expect(toSyncRecord('publishLedger', { fingerprint: 'f', startedAt: 10, finishedAt: 30 }).updatedAt).toBe(30);
  });

  it('sổ cái còn treo thì lấy startedAt — chưa có mốc kết thúc', () => {
    expect(toSyncRecord('publishLedger', { fingerprint: 'f', startedAt: 10 }).updatedAt).toBe(10);
  });

  it('thiếu mốc thời gian thì về 0 chứ không thành NaN', () => {
    expect(toSyncRecord('agencyClients', { id: 'c1' }).updatedAt).toBe(0);
  });

  it('mọi bộ workspace đều có hình dạng khai báo sẵn', () => {
    expect(Object.keys(COLLECTION_SHAPES).sort()).toEqual([...WORKSPACE_COLLECTIONS].sort());
  });
});

describe('tóm tắt cho giao diện', () => {
  const ok = (over: Record<string, number> = {}) => ({
    collection: 'agencyClients' as const,
    pulled: 0,
    pushed: 0,
    deleted: 0,
    ...over,
  });

  it('không có gì đổi thì nói thẳng là không có gì đổi', () => {
    expect(describeSyncOutcomes([ok()])).toContain('không có gì thay đổi');
  });

  it('nêu đủ số đẩy lên, tải về và xoá', () => {
    const text = describeSyncOutcomes([ok({ pushed: 2, pulled: 3, deleted: 1 })]);
    expect(text).toContain('đẩy lên 2');
    expect(text).toContain('tải về 3');
    expect(text).toContain('xoá 1');
  });

  it('hỏng hết thì trấn an rằng dữ liệu vẫn còn trên máy', () => {
    const text = describeSyncOutcomes([{ ...ok(), error: 'mất mạng' }]);
    expect(text).toContain('vẫn an toàn trên máy này');
  });

  it('hỏng một phần thì vẫn báo phần đã xong và nói sẽ thử lại', () => {
    const text = describeSyncOutcomes([ok({ pushed: 1 }), { ...ok(), error: 'x' }]);
    expect(text).toContain('đẩy lên 1');
    expect(text).toContain('sẽ thử lại');
  });
});
