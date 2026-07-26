import { describe, expect, it, vi } from 'vitest';
import {
  DUPLICATE_WINDOW_MS,
  LedgerStore,
  PublishLedgerEntry,
  checkDuplicate,
  fingerprintPost,
  publishWithGuard,
  readPublishHistory,
} from '../services/content/publishLedgerService';
import { PublishResult } from '../types/content';

/** Kho trong bộ nhớ, thay IndexedDB khi kiểm thử. */
const memoryStore = (seed: PublishLedgerEntry[] = []) => {
  const rows = new Map(seed.map((entry) => [entry.fingerprint, entry]));
  const store: LedgerStore & { rows: typeof rows } = {
    rows,
    readAll: async () => [...rows.values()],
    put: async (entry) => {
      rows.set(entry.fingerprint, entry);
    },
  };
  return store;
};

const okPublish = (extra: Partial<PublishResult> = {}) =>
  vi.fn().mockResolvedValue({
    channelId: 'facebook-page',
    success: true,
    message: 'Đã đăng lên Trang.',
    postId: 'p1',
    ...extra,
  });

const creds = { accessToken: 'tok', accountId: '123' };
const payload = { text: 'Xin chào Egoric' };

describe('vân tay nội dung', () => {
  it('ổn định qua nhiều lần gọi', () => {
    expect(fingerprintPost('facebook-page', '123', 'abc')).toBe(
      fingerprintPost('facebook-page', '123', 'abc'),
    );
  });

  it('khác nhau khi đổi kênh, đổi tài khoản hoặc đổi nội dung', () => {
    const base = fingerprintPost('facebook-page', '123', 'abc');
    expect(fingerprintPost('threads', '123', 'abc')).not.toBe(base);
    expect(fingerprintPost('facebook-page', '999', 'abc')).not.toBe(base);
    expect(fingerprintPost('facebook-page', '123', 'abd')).not.toBe(base);
  });

  it('phân biệt được các chuỗi dễ đụng nhau', () => {
    const seen = new Set<string>();
    for (const text of ['ab', 'ba', 'aab', 'abb', 'a b', 'ab ', ' ab', 'AB']) {
      seen.add(fingerprintPost('facebook-page', '1', text));
    }
    expect(seen.size).toBe(8);
  });
});

describe('phán định trùng', () => {
  const entry = (over: Partial<PublishLedgerEntry>): PublishLedgerEntry => ({
    fingerprint: 'fp',
    channelId: 'facebook-page',
    textPreview: 'x',
    status: 'success',
    startedAt: 1_000_000,
    ...over,
  });

  it('chưa có tiền lệ thì cho qua', () => {
    expect(checkDuplicate([], 'fp', 1_000_000).kind).toBe('clear');
  });

  it('đã đăng thành công thì chặn', () => {
    expect(checkDuplicate([entry({})], 'fp', 1_000_100).kind).toBe('already-published');
  });

  it('bản ghi treo ở pending thì cảnh báo không rõ kết quả', () => {
    expect(checkDuplicate([entry({ status: 'pending' })], 'fp', 1_000_100).kind).toBe(
      'unknown-outcome',
    );
  });

  it('lần trước thất bại thì cho đăng lại ngay', () => {
    expect(checkDuplicate([entry({ status: 'failed' })], 'fp', 1_000_100).kind).toBe('clear');
  });

  it('quá cửa sổ thời gian thì cho đăng lại', () => {
    const now = 1_000_000 + DUPLICATE_WINDOW_MS + 1;
    expect(checkDuplicate([entry({})], 'fp', now).kind).toBe('clear');
  });

  it('nội dung khác thì không bị vạ lây', () => {
    expect(checkDuplicate([entry({})], 'fp-khac', 1_000_100).kind).toBe('clear');
  });
});

describe('đăng có hàng rào', () => {
  it('ghi bản ghi pending xuống đĩa TRƯỚC khi gọi mạng', async () => {
    const store = memoryStore();
    const thuTu: string[] = [];
    const spyPut = store.put;
    store.put = async (entry) => {
      thuTu.push(`ghi:${entry.status}`);
      return spyPut(entry);
    };
    const publish = vi.fn().mockImplementation(async () => {
      thuTu.push('goi-mang');
      return { channelId: 'facebook-page', success: true, message: 'ok', postId: 'p1' };
    });

    await publishWithGuard('facebook-page', payload, creds, { store, publish: publish as never });

    expect(thuTu).toEqual(['ghi:pending', 'goi-mang', 'ghi:success']);
  });

  it('ghi nhận thành công kèm postId và url', async () => {
    const store = memoryStore();
    await publishWithGuard('facebook-page', payload, creds, {
      store,
      publish: okPublish({ url: 'https://facebook.com/p1' }) as never,
      now: () => 5_000,
    });

    const entry = [...store.rows.values()][0];
    expect(entry.status).toBe('success');
    expect(entry.postId).toBe('p1');
    expect(entry.url).toBe('https://facebook.com/p1');
    expect(entry.finishedAt).toBe(5_000);
    expect(entry.textPreview).toBe('Xin chào Egoric');
  });

  it('ghi nhận thất bại kèm lý do', async () => {
    const store = memoryStore();
    const publish = vi.fn().mockResolvedValue({
      channelId: 'facebook-page',
      success: false,
      message: 'Token hết hạn',
    });
    await publishWithGuard('facebook-page', payload, creds, { store, publish: publish as never });

    const entry = [...store.rows.values()][0];
    expect(entry.status).toBe('failed');
    expect(entry.error).toBe('Token hết hạn');
  });

  it('chặn lần đăng thứ hai cùng nội dung, không gọi mạng', async () => {
    const store = memoryStore();
    const publish = okPublish();

    await publishWithGuard('facebook-page', payload, creds, { store, publish: publish as never });
    const lanHai = await publishWithGuard('facebook-page', payload, creds, {
      store,
      publish: publish as never,
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(lanHai.result.success).toBe(false);
    expect(lanHai.duplicate?.kind).toBe('already-published');
  });

  it('force thì bỏ qua hàng rào và đăng thật', async () => {
    const store = memoryStore();
    const publish = okPublish();

    await publishWithGuard('facebook-page', payload, creds, { store, publish: publish as never });
    const lanHai = await publishWithGuard('facebook-page', payload, creds, {
      store,
      publish: publish as never,
      force: true,
    });

    expect(publish).toHaveBeenCalledTimes(2);
    expect(lanHai.result.success).toBe(true);
    expect(lanHai.duplicate).toBeUndefined();
  });

  it('mô phỏng mất mạng giữa chừng: lần sau cảnh báo có thể đã lên', async () => {
    const store = memoryStore();
    const publishChet = vi.fn().mockRejectedValue(new Error('mạng đứt'));

    await expect(
      publishWithGuard('facebook-page', payload, creds, { store, publish: publishChet as never }),
    ).rejects.toThrow('mạng đứt');

    // Bản ghi pending vẫn còn vì được ghi trước khi gọi mạng.
    expect([...store.rows.values()][0].status).toBe('pending');

    const lanSau = await publishWithGuard('facebook-page', payload, creds, {
      store,
      publish: okPublish() as never,
    });
    expect(lanSau.duplicate?.kind).toBe('unknown-outcome');
    expect(lanSau.result.message).toContain('có thể đã lên');
  });

  it('kết quả không xác định thì giữ pending, không phải failed', async () => {
    const store = memoryStore();
    // publishToChannel thật nuốt lỗi mạng thành kết quả có indeterminate,
    // chứ không ném ra ngoài. Đây là đường đi thật, khác với mock ném lỗi.
    const publish = vi.fn().mockResolvedValue({
      channelId: 'facebook-page',
      success: false,
      indeterminate: true,
      message: 'Failed to fetch. Không rõ bài đã lên hay chưa.',
    });

    await publishWithGuard('facebook-page', payload, creds, { store, publish: publish as never });

    const entry = [...store.rows.values()][0];
    expect(entry.status).toBe('pending');
    expect(entry.finishedAt).toBeUndefined();
  });

  it('sau lần mạng đứt, lần đăng kế tiếp bị cảnh báo thay vì đăng thẳng', async () => {
    const store = memoryStore();
    const dut = vi.fn().mockResolvedValue({
      channelId: 'facebook-page',
      success: false,
      indeterminate: true,
      message: 'Failed to fetch. Không rõ bài đã lên hay chưa.',
    });
    const thanhCong = okPublish();

    await publishWithGuard('facebook-page', payload, creds, { store, publish: dut as never });
    const lanSau = await publishWithGuard('facebook-page', payload, creds, {
      store,
      publish: thanhCong as never,
    });

    expect(thanhCong).not.toHaveBeenCalled();
    expect(lanSau.duplicate?.kind).toBe('unknown-outcome');
  });

  it('lỗi chắc chắn từ nhà cung cấp thì cho đăng lại ngay', async () => {
    const store = memoryStore();
    // HTTP 400 có phản hồi hẳn hoi: chắc chắn bài chưa lên.
    const tuChoi = vi.fn().mockResolvedValue({
      channelId: 'facebook-page',
      success: false,
      message: 'Token hết hạn',
    });
    const thanhCong = okPublish();

    await publishWithGuard('facebook-page', payload, creds, { store, publish: tuChoi as never });
    const lanSau = await publishWithGuard('facebook-page', payload, creds, {
      store,
      publish: thanhCong as never,
    });

    expect(thanhCong).toHaveBeenCalledTimes(1);
    expect(lanSau.result.success).toBe(true);
    expect(lanSau.duplicate).toBeUndefined();
  });

  it('nội dung khác nhau thì đăng bình thường', async () => {
    const store = memoryStore();
    const publish = okPublish();

    await publishWithGuard('facebook-page', { text: 'bài một' }, creds, { store, publish: publish as never });
    await publishWithGuard('facebook-page', { text: 'bài hai' }, creds, { store, publish: publish as never });

    expect(publish).toHaveBeenCalledTimes(2);
    expect(store.rows.size).toBe(2);
  });

  it('cùng nội dung nhưng khác kênh thì vẫn đăng được', async () => {
    const store = memoryStore();
    const publish = okPublish();

    await publishWithGuard('facebook-page', payload, creds, { store, publish: publish as never });
    const threads = await publishWithGuard('threads', payload, creds, {
      store,
      publish: publish as never,
    });

    expect(threads.result.success).toBe(true);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('kho lưu trữ hỏng thì vẫn đăng được, không chặn oan', async () => {
    const store: LedgerStore = {
      readAll: async () => {
        throw new Error('IndexedDB hỏng');
      },
      put: async () => {
        throw new Error('IndexedDB hỏng');
      },
    };
    const publish = okPublish();
    const outcome = await publishWithGuard('facebook-page', payload, creds, {
      store,
      publish: publish as never,
    });

    expect(outcome.result.success).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe('lịch sử đăng', () => {
  it('sắp xếp mới nhất trước', async () => {
    const store = memoryStore([
      { fingerprint: 'a', channelId: 'threads', textPreview: 'cũ', status: 'success', startedAt: 100 },
      { fingerprint: 'b', channelId: 'threads', textPreview: 'mới', status: 'success', startedAt: 900 },
    ]);
    const history = await readPublishHistory(store);
    expect(history.map((entry) => entry.textPreview)).toEqual(['mới', 'cũ']);
  });

  it('kho hỏng thì trả mảng rỗng chứ không ném lỗi', async () => {
    const history = await readPublishHistory({
      readAll: async () => {
        throw new Error('hỏng');
      },
      put: async () => {},
    });
    expect(history).toEqual([]);
  });
});
