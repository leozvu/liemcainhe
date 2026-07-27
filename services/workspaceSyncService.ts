/**
 * Đồng bộ dữ liệu cấp workspace lên cloud.
 *
 * Sáu bộ dữ liệu — khách hàng, chiến dịch, Campaign 0, thư viện bài, sổ cái
 * đăng bài, sổ tài khoản đăng bài — trước đây chỉ nằm trong IndexedDB của đúng một trình
 * duyệt. `syncProjectToCloud` có sẵn nhưng chỉ chạy khi người dùng bấm nút, và
 * nó chỉ đồng bộ **dự án**, không đụng tới năm bộ này.
 *
 * Hệ quả: xoá dữ liệu duyệt web là mất sạch khách hàng, sổ cái và lịch sử
 * đăng bài. Không cảnh báo, không khôi phục được.
 *
 * Phần hợp nhất ở đây là **logic thuần**, không gọi mạng — để kiểm được hết
 * các tình huống tranh chấp mà không cần dựng server.
 */

import {
  deleteFromWorkspaceStore,
  readWorkspaceTombstones,
  readWorkspaceStore,
  writeWorkspaceStore,
} from './storageService';

export type WorkspaceCollection =
  | 'agencyClients'
  | 'agencyCampaigns'
  | 'articleLibrary'
  | 'publishLedger'
  | 'managedAccounts'
  | 'campaignZeroRuns';

export const WORKSPACE_COLLECTIONS: WorkspaceCollection[] = [
  'agencyClients',
  'agencyCampaigns',
  'articleLibrary',
  'publishLedger',
  'managedAccounts',
  'campaignZeroRuns',
];

/** Một bản ghi bất kỳ, đã chuẩn hoá về dạng đồng bộ hiểu được. */
export interface SyncRecord {
  id: string;
  updatedAt: number;
  payload: unknown;
  /** Có mốc này nghĩa là bản ghi đã bị xoá; giữ lại làm bia mộ. */
  deletedAt?: number;
}

export interface MergePlan {
  /** Ghi xuống kho cục bộ. */
  toLocal: SyncRecord[];
  /** Đẩy lên cloud. */
  toRemote: SyncRecord[];
  /** Xoá khỏi kho cục bộ vì cloud báo đã xoá. */
  toDeleteLocal: string[];
}

const serialize = (record: SyncRecord): string => JSON.stringify(record.payload ?? null);

/**
 * Ai thắng khi cả hai bên cùng sửa một bản ghi.
 *
 * Mốc sửa đổi mới hơn thì thắng. Bằng nhau thì so chuỗi payload và lấy chuỗi
 * lớn hơn — nghe tuỳ tiện, nhưng đó chính là điểm: **cả hai máy đều tính ra
 * cùng một kết quả**, nên chúng hội tụ thay vì đẩy qua đẩy lại mãi. Chọn "ưu
 * tiên cloud" thì bất đối xứng và sẽ ping-pong.
 */
const winner = (left: SyncRecord, right: SyncRecord): SyncRecord => {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? left : right;
  return serialize(left) >= serialize(right) ? left : right;
};

/** Thu gọn bản sống và bia mộ cục bộ về đúng một quyết định cho mỗi khóa. */
export const collapseSyncRecords = (records: SyncRecord[]): SyncRecord[] => {
  const collapsed = new Map<string, SyncRecord>();
  records.forEach((record) => {
    const current = collapsed.get(record.id);
    collapsed.set(record.id, current ? winner(current, record) : record);
  });
  return Array.from(collapsed.values());
};

/**
 * Hợp nhất hai phía.
 *
 * Bia mộ được đối xử như một lần sửa bình thường: nó chỉ thắng khi mới hơn.
 * Xoá trên máy A lúc 10h rồi sửa trên máy B lúc 11h thì bản sửa thắng — người
 * dùng đụng vào sau cùng là người biết rõ hơn.
 */
export const mergeCollection = (local: SyncRecord[], remote: SyncRecord[]): MergePlan => {
  const localById = new Map(local.map((record) => [record.id, record]));
  const remoteById = new Map(remote.map((record) => [record.id, record]));

  const plan: MergePlan = { toLocal: [], toRemote: [], toDeleteLocal: [] };

  const ids = new Set([...localById.keys(), ...remoteById.keys()]);

  ids.forEach((id) => {
    const mine = localById.get(id);
    const theirs = remoteById.get(id);

    if (mine && !theirs) {
      // Cloud chưa biết bản ghi này. Kể cả bia mộ cũng phải đẩy lên, nếu không
      // máy khác sẽ không bao giờ biết nó đã bị xoá.
      plan.toRemote.push(mine);
      return;
    }

    if (!mine && theirs) {
      // Bia mộ từ cloud mà cục bộ đã không có thì không phải làm gì.
      if (!theirs.deletedAt) plan.toLocal.push(theirs);
      return;
    }

    if (!mine || !theirs) return;

    const chosen = winner(mine, theirs);
    if (chosen === mine) {
      // Chỉ đẩy khi thật sự khác, tránh ghi thừa mỗi lần đồng bộ.
      if (mine.updatedAt !== theirs.updatedAt || serialize(mine) !== serialize(theirs)) {
        plan.toRemote.push(mine);
      }
      return;
    }

    if (chosen.deletedAt) plan.toDeleteLocal.push(id);
    else plan.toLocal.push(chosen);
  });

  return plan;
};

/* ────────────────────────  Theo dõi bản ghi bẩn  ──────────────────────── */

/**
 * Bản ghi nào đã đổi kể từ lần đồng bộ trước.
 *
 * Đẩy cả bộ mỗi lần là lãng phí băng thông và pin; với thư viện bài viết vài
 * trăm mục thì đó là vài MB mỗi lần lưu.
 */
export const changedSince = (records: SyncRecord[], since: number): SyncRecord[] =>
  records.filter((record) => Math.max(record.updatedAt, record.deletedAt ?? 0) > since);

/** Mốc mới nhất trong một lô, để lần sau hỏi tiếp từ đó. */
export const highWaterMark = (records: SyncRecord[], previous = 0): number =>
  records.reduce(
    (mark, record) => Math.max(mark, record.updatedAt, record.deletedAt ?? 0),
    previous,
  );

/* ──────────────────────────  Trạng thái đồng bộ  ─────────────────────── */

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  phase: SyncPhase;
  lastSyncedAt?: number;
  /** Số bản ghi chưa đẩy được lên. */
  pendingCount: number;
  error?: string;
}

const STORAGE_KEY = 'egoric_workspace_sync_marks_v1';

type Marks = Partial<Record<WorkspaceCollection, number>>;

const readMarks = (): Marks => {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Marks;
  } catch {
    return {};
  }
};

export const getSyncMark = (collection: WorkspaceCollection): number =>
  readMarks()[collection] ?? 0;

export const setSyncMark = (collection: WorkspaceCollection, mark: number): void => {
  if (typeof localStorage === 'undefined') return;
  const marks = readMarks();
  marks[collection] = mark;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
  } catch {
    // Hết chỗ lưu thì lần sau đồng bộ lại từ đầu — chậm chứ không sai.
  }
};

export const clearSyncMarks = (): void => {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
};

/* ────────────────────────────  Chạy đồng bộ  ─────────────────────────── */

export interface SyncTransport {
  pull: (collection: WorkspaceCollection, since: number) => Promise<SyncRecord[]>;
  push: (collection: WorkspaceCollection, records: SyncRecord[]) => Promise<void>;
}

export interface LocalStore {
  readAll: (collection: WorkspaceCollection) => Promise<SyncRecord[]>;
  write: (collection: WorkspaceCollection, records: SyncRecord[]) => Promise<void>;
  remove: (collection: WorkspaceCollection, ids: string[]) => Promise<void>;
}

export interface SyncOutcome {
  collection: WorkspaceCollection;
  pulled: number;
  pushed: number;
  deleted: number;
  error?: string;
}

/**
 * Đồng bộ một bộ sưu tập.
 *
 * **Không bao giờ ném lỗi ra ngoài.** Đồng bộ chạy nền; một lần mất mạng làm
 * hỏng thao tác người dùng đang làm là đánh đổi sai. Lỗi được trả về trong kết
 * quả để giao diện hiện trạng thái, và mốc đồng bộ **không** được đẩy lên khi
 * có lỗi — lần sau thử lại từ đúng chỗ cũ.
 */
export const syncCollection = async (
  collection: WorkspaceCollection,
  store: LocalStore,
  transport: SyncTransport,
  options: { since?: number; now?: () => number } = {},
): Promise<SyncOutcome> => {
  const since = options.since ?? getSyncMark(collection);

  try {
    const [allLocal, remote] = await Promise.all([
      store.readAll(collection),
      transport.pull(collection, since),
    ]);

    // GET cloud theo mốc chỉ trả bản ghi mới đổi. Vì vậy local cũng phải lọc
    // cùng mốc; nếu đưa toàn bộ local vào merge, mọi bản ghi cũ không xuất hiện
    // trong response incremental sẽ bị hiểu nhầm là "cloud chưa biết" và bị
    // upload lại mỗi phút.
    const local = since > 0 ? changedSince(allLocal, since) : allLocal;

    const plan = mergeCollection(local, remote);

    if (plan.toLocal.length) await store.write(collection, plan.toLocal);
    if (plan.toDeleteLocal.length) await store.remove(collection, plan.toDeleteLocal);
    if (plan.toRemote.length) await transport.push(collection, plan.toRemote);

    // Chỉ nhích mốc sau khi mọi bước đã xong. Nhích sớm thì lần sau bỏ qua đúng
    // những bản ghi vừa lỗi.
    setSyncMark(collection, highWaterMark([...local, ...remote], since));

    return {
      collection,
      pulled: plan.toLocal.length,
      pushed: plan.toRemote.length,
      deleted: plan.toDeleteLocal.length,
    };
  } catch (error) {
    return {
      collection,
      pulled: 0,
      pushed: 0,
      deleted: 0,
      error: error instanceof Error ? error.message : 'Không đồng bộ được.',
    };
  }
};

/** Đồng bộ toàn bộ kho workspace. Một bộ hỏng không làm dừng các bộ còn lại. */
export const syncAllCollections = async (
  store: LocalStore,
  transport: SyncTransport,
  options: { since?: number } = {},
): Promise<SyncOutcome[]> => {
  const outcomes: SyncOutcome[] = [];
  for (const collection of WORKSPACE_COLLECTIONS) {
    outcomes.push(await syncCollection(collection, store, transport, options));
  }
  return outcomes;
};

/* ─────────────────────  Nối vào worker và IndexedDB  ─────────────────── */

/**
 * Mỗi kho một hình dạng, không gộp mù được.
 *
 * Sổ cái đăng bài khoá theo `fingerprint` chứ không phải `id`, và mốc thời gian
 * của nó là `startedAt`/`finishedAt` chứ không có `updatedAt`. Viết một adapter
 * chung giả định mọi kho đều `{ id, updatedAt }` thì sổ cái sẽ đồng bộ sai mà
 * không báo gì.
 */
interface CollectionShape {
  store: string;
  key: string;
  /** Lấy mốc sửa đổi. Kho nào không có `updatedAt` thì tự suy ra. */
  timestamp: (item: Record<string, unknown>) => number;
}

export const COLLECTION_SHAPES: Record<WorkspaceCollection, CollectionShape> = {
  agencyClients: { store: 'agencyClients', key: 'id', timestamp: (item) => Number(item.updatedAt) || 0 },
  agencyCampaigns: { store: 'agencyCampaigns', key: 'id', timestamp: (item) => Number(item.updatedAt) || 0 },
  articleLibrary: { store: 'articleLibrary', key: 'id', timestamp: (item) => Number(item.updatedAt) || 0 },
  managedAccounts: { store: 'managedAccounts', key: 'id', timestamp: (item) => Number(item.updatedAt) || 0 },
  campaignZeroRuns: { store: 'campaignZeroRuns', key: 'campaignId', timestamp: (item) => Number(item.updatedAt) || 0 },
  publishLedger: {
    store: 'publishLedger',
    key: 'fingerprint',
    // Bản ghi còn treo thì chưa có `finishedAt`; lúc đó `startedAt` là mốc mới
    // nhất mà ta biết chắc.
    timestamp: (item) => Number(item.finishedAt) || Number(item.startedAt) || 0,
  },
};

/** Đưa một bản ghi bất kỳ về dạng đồng bộ hiểu được. */
export const toSyncRecord = (
  collection: WorkspaceCollection,
  item: Record<string, unknown>,
): SyncRecord => {
  const shape = COLLECTION_SHAPES[collection];
  return {
    id: String(item[shape.key] ?? ''),
    updatedAt: shape.timestamp(item),
    payload: item,
  };
};

/** Kho IndexedDB, gói lại cho lớp đồng bộ dùng. */
export const indexedDbSyncStore: LocalStore = {
  readAll: async (collection) => {
    const shape = COLLECTION_SHAPES[collection];
    const [rows, tombstones] = await Promise.all([
      readWorkspaceStore<Record<string, unknown>>(shape.store),
      readWorkspaceTombstones(collection),
    ]);
    return collapseSyncRecords([
      ...rows.map((row) => toSyncRecord(collection, row)),
      ...tombstones.map((tombstone) => ({
        id: tombstone.itemId,
        updatedAt: tombstone.updatedAt,
        deletedAt: tombstone.deletedAt,
        payload: null,
      })),
    ]);
  },

  write: async (collection, records) => {
    // Bia mộ không ghi xuống kho cục bộ — kho này không có chỗ cho bản ghi đã
    // xoá, việc xoá do `remove` lo.
    const payloads = records.filter((record) => !record.deletedAt).map((record) => record.payload);
    await writeWorkspaceStore(COLLECTION_SHAPES[collection].store, payloads);
  },

  remove: async (collection, ids) => {
    await deleteFromWorkspaceStore(COLLECTION_SHAPES[collection].store, ids);
  },
};

/** Transport thật, gọi qua worker cùng miền. */
export const cloudTransport: SyncTransport = {
  pull: async (collection, since) => {
    const response = await fetch(
      `/api/cloud/workspace?collection=${encodeURIComponent(collection)}&since=${since}`,
    );
    if (!response.ok) throw new Error(`Không tải được ${collection} (HTTP ${response.status}).`);
    const data = await response.json();
    return Array.isArray(data?.records) ? data.records : [];
  },

  push: async (collection, records) => {
    // Worker chặn ở 500 bản ghi mỗi lượt; chia lô ở đây thay vì để nó trả 413.
    for (let index = 0; index < records.length; index += 500) {
      const response = await fetch('/api/cloud/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection, records: records.slice(index, index + 500) }),
      });
      if (!response.ok) throw new Error(`Không đẩy được ${collection} (HTTP ${response.status}).`);
    }
  },
};

/** Một dòng tóm tắt cho giao diện. */
export const describeSyncOutcomes = (outcomes: SyncOutcome[]): string => {
  const failed = outcomes.filter((outcome) => outcome.error);
  if (failed.length === outcomes.length && outcomes.length > 0) {
    return 'Không đồng bộ được. Dữ liệu vẫn an toàn trên máy này.';
  }

  const pulled = outcomes.reduce((total, outcome) => total + outcome.pulled, 0);
  const pushed = outcomes.reduce((total, outcome) => total + outcome.pushed, 0);
  const deleted = outcomes.reduce((total, outcome) => total + outcome.deleted, 0);

  const parts: string[] = [];
  if (pushed) parts.push(`đẩy lên ${pushed}`);
  if (pulled) parts.push(`tải về ${pulled}`);
  if (deleted) parts.push(`xoá ${deleted}`);
  if (!parts.length) return 'Đã đồng bộ, không có gì thay đổi.';

  const summary = `Đã đồng bộ: ${parts.join(', ')} bản ghi.`;
  return failed.length ? `${summary} ${failed.length} nhóm còn lỗi, sẽ thử lại.` : summary;
};
