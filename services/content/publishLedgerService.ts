import {
  PostInsights,
  PublishChannelId,
  PublishCredentials,
  PublishPayload,
  PublishResult,
} from '../../types/content';
import { fetchPostInsights } from './insightsService';
import { getPublishLedger, savePublishLedgerEntry } from '../storageService';
import { publishToChannel } from './publishService';

/**
 * Nhật ký đăng bài và cơ chế chống đăng trùng.
 *
 * Đây là hàng rào cho tình huống nguy hiểm nhất của sản phẩm: mất mạng giữa
 * lúc đăng. Người dùng không biết bài đã lên hay chưa, bấm lại, và Trang của
 * khách hàng có hai bài giống nhau. Đó là sự cố uy tín chứ không phải sự cố
 * chi phí, và không tự sửa được.
 *
 * Nguyên tắc: ghi bản ghi `pending` xuống đĩa TRƯỚC khi gọi mạng. Nếu tiến
 * trình chết giữa chừng thì lần sau vẫn còn dấu vết để cảnh báo.
 */

export type PublishLedgerStatus = 'pending' | 'success' | 'failed';

export interface PublishLedgerEntry {
  /** Khoá chính. Cùng nội dung, cùng kênh, cùng tài khoản thì cùng fingerprint. */
  fingerprint: string;
  channelId: PublishChannelId;
  accountId?: string;
  /** Trích đoạn để hiện trong cảnh báo, không lưu toàn văn cho nhẹ. */
  textPreview: string;
  status: PublishLedgerStatus;
  startedAt: number;
  finishedAt?: number;
  postId?: string;
  url?: string;
  error?: string;
  /** Số liệu hiệu quả, đọc về sau khi bài đã lên. */
  insights?: PostInsights;
}

/**
 * Vân tay nội dung.
 *
 * Không dùng hàm băm mật mã vì không cần chống giả mạo, chỉ cần ổn định và
 * rẻ. Trộn hai hàm băm khác nhau cộng độ dài để hạ xác suất trùng; và kể cả
 * có trùng thì hậu quả chỉ là một cảnh báo thừa, tức là hỏng về phía an toàn.
 */
export const fingerprintPost = (
  channelId: string,
  accountId: string | undefined,
  text: string,
): string => {
  const source = `${channelId}::${accountId ?? ''}::${text}`;

  let djb2 = 5381;
  let fnv = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    djb2 = ((djb2 << 5) + djb2 + code) >>> 0;
    fnv = ((fnv ^ code) * 0x01000193) >>> 0;
  }

  return `${djb2.toString(36)}-${fnv.toString(36)}-${source.length.toString(36)}`;
};

/** Trong bao lâu thì coi việc đăng lại cùng nội dung là trùng. */
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type DuplicateVerdict =
  | { kind: 'clear' }
  | { kind: 'already-published'; entry: PublishLedgerEntry }
  | { kind: 'unknown-outcome'; entry: PublishLedgerEntry };

/**
 * Tra xem nội dung này đã từng được đăng chưa.
 *
 * `already-published` là đã lên chắc chắn. `unknown-outcome` là lần trước bắt
 * đầu nhưng chưa ghi nhận kết quả — nguy hiểm hơn, vì bài có thể đã lên mà hệ
 * thống không biết.
 */
export const checkDuplicate = (
  entries: PublishLedgerEntry[],
  fingerprint: string,
  now: number,
): DuplicateVerdict => {
  const entry = entries.find((item) => item.fingerprint === fingerprint);
  if (!entry) return { kind: 'clear' };
  if (now - entry.startedAt > DUPLICATE_WINDOW_MS) return { kind: 'clear' };
  if (entry.status === 'success') return { kind: 'already-published', entry };
  if (entry.status === 'pending') return { kind: 'unknown-outcome', entry };
  return { kind: 'clear' };
};

/** Cho phép thay lớp lưu trữ khi kiểm thử, mặc định dùng IndexedDB. */
export interface LedgerStore {
  readAll: () => Promise<PublishLedgerEntry[]>;
  put: (entry: PublishLedgerEntry) => Promise<void>;
}

const indexedDbStore: LedgerStore = {
  readAll: () => getPublishLedger<PublishLedgerEntry>(),
  put: (entry) => savePublishLedgerEntry(entry),
};

export interface GuardedPublishOptions {
  store?: LedgerStore;
  /** Bỏ qua cảnh báo trùng. Chỉ đặt true khi người dùng đã đọc và chấp nhận. */
  force?: boolean;
  now?: () => number;
  publish?: typeof publishToChannel;
}

export interface GuardedPublishOutcome {
  result: PublishResult;
  /** Cảnh báo trùng đã chặn lần đăng này. Người dùng phải xác nhận lại. */
  duplicate?: DuplicateVerdict;
}

/**
 * Đăng bài có kiểm tra trùng và ghi nhật ký.
 *
 * Giao diện chỉ nên gọi hàm này, không gọi thẳng `publishToChannel`, để không
 * có đường nào đăng mà bỏ qua hàng rào.
 */
export const publishWithGuard = async (
  channelId: PublishChannelId,
  payload: PublishPayload,
  credentials: PublishCredentials,
  options: GuardedPublishOptions = {},
): Promise<GuardedPublishOutcome> => {
  const store = options.store ?? indexedDbStore;
  const now = options.now ?? Date.now;
  const publish = options.publish ?? publishToChannel;

  const fingerprint = fingerprintPost(channelId, credentials.accountId, payload.text);
  const startedAt = now();

  if (!options.force) {
    let entries: PublishLedgerEntry[] = [];
    try {
      entries = await store.readAll();
    } catch {
      // Đọc nhật ký hỏng thì không được chặn việc đăng, nhưng cũng không im
      // lặng bỏ qua — cứ đăng và ghi nhận, coi như chưa có tiền lệ.
      entries = [];
    }

    const verdict = checkDuplicate(entries, fingerprint, startedAt);
    if (verdict.kind !== 'clear') {
      const message =
        verdict.kind === 'already-published'
          ? 'Nội dung này đã được đăng lên kênh và tài khoản này rồi.'
          : 'Lần đăng trước chưa ghi nhận được kết quả. Bài có thể đã lên. Hãy kiểm tra trên nền tảng trước khi đăng lại.';
      return {
        result: { channelId, success: false, message },
        duplicate: verdict,
      };
    }
  }

  const pending: PublishLedgerEntry = {
    fingerprint,
    channelId,
    accountId: credentials.accountId,
    textPreview: payload.text.slice(0, 160),
    status: 'pending',
    startedAt,
  };

  // Ghi xuống đĩa trước khi gọi mạng. Nếu tab bị đóng giữa chừng thì lần sau
  // vẫn còn bản ghi pending để cảnh báo.
  try {
    await store.put(pending);
  } catch {
    // Không ghi được nhật ký thì vẫn đăng, vì chặn ở đây gây khó chịu hơn là
    // rủi ro nó phòng. Nhưng lần sau sẽ không có tiền lệ để cảnh báo.
  }

  const result = await publish(channelId, payload, credentials);

  /**
   * Kết quả không xác định thì giữ nguyên `pending`.
   *
   * Đây là điểm mấu chốt của cả hàng rào. Ghi `failed` sẽ khiến lần đăng sau
   * được cho qua, mà bài lần này có thể đã lên rồi — đúng cách sinh ra hai bài
   * giống nhau trên Trang khách hàng.
   */
  const status: PublishLedgerStatus = result.success
    ? 'success'
    : result.indeterminate
      ? 'pending'
      : 'failed';

  try {
    await store.put({
      ...pending,
      status,
      // Còn treo thì chưa kết thúc, để trống mốc kết thúc cho đúng nghĩa.
      finishedAt: status === 'pending' ? undefined : now(),
      postId: result.postId,
      url: result.url,
      error: result.success ? undefined : result.message,
    });
  } catch {
    // Kết quả đã có, không ghi được nhật ký cũng không đổi được gì.
  }

  return { result };
};

/**
 * Đọc số liệu về cho các bài đã đăng thành công.
 *
 * Chỉ đụng tới bản ghi có `postId` và trạng thái `success` — bài chưa lên thì
 * không có gì để đo. Một kênh hỏng không làm dừng các kênh còn lại.
 */
export const refreshInsights = async (
  credentialsFor: (channelId: PublishChannelId) => PublishCredentials,
  options: {
    store?: LedgerStore;
    fetchInsights?: typeof fetchPostInsights;
    /** Chỉ đọc lại bản ghi cũ hơn ngần này, tránh gọi mạng thừa. */
    staleAfterMs?: number;
    now?: () => number;
  } = {},
): Promise<PublishLedgerEntry[]> => {
  const store = options.store ?? indexedDbStore;
  const read = options.fetchInsights ?? fetchPostInsights;
  const now = (options.now ?? Date.now)();
  const staleAfter = options.staleAfterMs ?? 15 * 60 * 1000;

  let entries: PublishLedgerEntry[] = [];
  try {
    entries = await store.readAll();
  } catch {
    return [];
  }

  const updated: PublishLedgerEntry[] = [];

  for (const entry of entries) {
    if (entry.status !== 'success' || !entry.postId) continue;
    if (entry.insights && now - entry.insights.fetchedAt < staleAfter) {
      updated.push(entry);
      continue;
    }

    const insights = await read(entry.channelId, entry.postId, credentialsFor(entry.channelId));
    const next = { ...entry, insights };
    updated.push(next);
    try {
      await store.put(next);
    } catch {
      // Đọc được số liệu rồi thì không ghi được cũng vẫn trả về cho giao diện.
    }
  }

  return updated;
};

/** Đọc nhật ký để hiện lịch sử đăng, mới nhất trước. */
export const readPublishHistory = async (
  store: LedgerStore = indexedDbStore,
): Promise<PublishLedgerEntry[]> => {
  try {
    const entries = await store.readAll();
    return entries.sort((left, right) => right.startedAt - left.startedAt);
  } catch {
    return [];
  }
};
