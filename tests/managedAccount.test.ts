import { describe, expect, it } from 'vitest';
import {
  ManagedAccountError,
  ManagedAccountStore,
  TOKEN_WARNING_DAYS,
  addAccount,
  collectAccountWarnings,
  groupByClient,
  listAccounts,
  publishableAccounts,
  removeAccount,
  updateAccount,
  validateAccountInput,
} from '../services/content/managedAccountService';
import { fingerprintPost, publishToAccounts } from '../services/content/publishLedgerService';
import { ManagedAccount, PublishPayload, PublishResult } from '../types/content';

const DAY = 24 * 60 * 60 * 1000;

const memoryStore = (seed: ManagedAccount[] = []): ManagedAccountStore & { items: ManagedAccount[] } => {
  const items = [...seed];
  return {
    items,
    readAll: async () => [...items],
    put: async (account) => {
      const index = items.findIndex((item) => item.id === account.id);
      if (index >= 0) items[index] = account;
      else items.push(account);
    },
    remove: async (id) => {
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) items.splice(index, 1);
    },
  };
};

const account = (over: Partial<ManagedAccount> = {}): ManagedAccount => ({
  id: 'a1',
  channelId: 'facebook-page',
  label: 'Fanpage Hạnh',
  externalId: '111',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('thêm tài khoản', () => {
  it('giữ được nhiều tài khoản cùng một nền tảng — đây là cả lý do tồn tại của lớp này', async () => {
    const store = memoryStore();
    await addAccount({ channelId: 'facebook-page', label: 'Page A', externalId: '111' }, { store, now: () => 1 });
    await addAccount({ channelId: 'facebook-page', label: 'Page B', externalId: '222' }, { store, now: () => 2 });

    const all = await listAccounts({ store });
    expect(all).toHaveLength(2);
    expect(all.map((item) => item.externalId).sort()).toEqual(['111', '222']);
  });

  it('mỗi tài khoản có id riêng, không đè nhau', async () => {
    const store = memoryStore();
    const first = await addAccount({ channelId: 'threads', label: 'A', externalId: '1' }, { store, now: () => 1 });
    const second = await addAccount({ channelId: 'threads', label: 'B', externalId: '2' }, { store, now: () => 2 });
    expect(first.id).not.toBe(second.id);
  });

  it('chặn thêm trùng cùng một Page, và nói rõ nó đang mang tên gì', async () => {
    const store = memoryStore([account({ label: 'Fanpage cũ', externalId: '111' })]);
    await expect(
      addAccount({ channelId: 'facebook-page', label: 'Fanpage mới', externalId: '111' }, { store }),
    ).rejects.toThrow(/Fanpage cũ/);
  });

  it('cùng externalId nhưng khác nền tảng thì không phải trùng', () => {
    const issues = validateAccountInput(
      { channelId: 'threads', label: 'Threads', externalId: '111' },
      [account({ channelId: 'facebook-page', externalId: '111' })],
    );
    expect(issues).toEqual([]);
  });

  it('gom hết lỗi một lượt thay vì dừng ở lỗi đầu', () => {
    const issues = validateAccountInput({ channelId: 'facebook-page', label: '  ', externalId: '' }, []);
    expect(issues).toHaveLength(2);
  });

  it('bỏ trống clientId nghĩa là kênh của Egoric, không phải lỗi', async () => {
    const store = memoryStore();
    const created = await addAccount({ channelId: 'zalo-oa', label: 'OA Egoric', externalId: '9' }, { store });
    expect(created.clientId).toBeUndefined();
    expect(created.status).toBe('active');
  });
});

describe('sửa và gỡ', () => {
  it('sửa tên không làm nó thành trùng với chính nó', async () => {
    const store = memoryStore([account()]);
    const updated = await updateAccount('a1', { label: 'Tên mới' }, { store, now: () => 5 });
    expect(updated.label).toBe('Tên mới');
    expect(updated.externalId).toBe('111');
    expect(updated.updatedAt).toBe(5);
  });

  it('sửa sang externalId của tài khoản khác thì bị chặn', async () => {
    const store = memoryStore([account({ id: 'a1', externalId: '111' }), account({ id: 'a2', externalId: '222', label: 'Page B' })]);
    await expect(updateAccount('a1', { externalId: '222' }, { store })).rejects.toThrow(ManagedAccountError);
  });

  it('sửa tài khoản không tồn tại thì báo rõ', async () => {
    await expect(updateAccount('khong-co', { label: 'x' }, { store: memoryStore() })).rejects.toThrow(/Không tìm thấy/);
  });

  it('gỡ xong thì không còn trong sổ', async () => {
    const store = memoryStore([account()]);
    await removeAccount('a1', { store });
    expect(await listAccounts({ store })).toEqual([]);
  });
});

describe('cảnh báo token', () => {
  const now = 100 * DAY;

  it('nhắc trước khi token hết hạn', () => {
    const warnings = collectAccountWarnings([account({ tokenExpiresAt: now + 3 * DAY })], now);
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].message).toContain('3 ngày');
  });

  it('token còn dài thì im lặng', () => {
    expect(collectAccountWarnings([account({ tokenExpiresAt: now + 40 * DAY })], now)).toEqual([]);
  });

  it('đúng ngưỡng vẫn nhắc', () => {
    const warnings = collectAccountWarnings([account({ tokenExpiresAt: now + TOKEN_WARNING_DAYS * DAY })], now);
    expect(warnings).toHaveLength(1);
  });

  it('quá hạn thì chặn hẳn, không chỉ cảnh báo', () => {
    const warnings = collectAccountWarnings([account({ tokenExpiresAt: now - DAY })], now);
    expect(warnings[0].severity).toBe('blocked');
  });

  it('bị thu hồi quyền thì nói đúng nguyên nhân, không đổ cho token', () => {
    const warnings = collectAccountWarnings([account({ status: 'revoked' })], now);
    expect(warnings[0].message).toContain('thu hồi');
  });

  it('tài khoản tạm dừng thì không kêu — người dùng đã chủ động tắt', () => {
    expect(collectAccountWarnings([account({ status: 'paused', tokenExpiresAt: now - DAY })], now)).toEqual([]);
  });
});

describe('lọc tài khoản đăng được', () => {
  const now = 100 * DAY;

  it('bỏ tài khoản tạm dừng, hết token và bị thu hồi', () => {
    const usable = publishableAccounts(
      [
        account({ id: 'ok' }),
        account({ id: 'paused', status: 'paused' }),
        account({ id: 'expired', tokenExpiresAt: now - DAY }),
        account({ id: 'revoked', status: 'revoked' }),
      ],
      now,
    );
    expect(usable.map((item) => item.id)).toEqual(['ok']);
  });

  it('không có hạn token thì coi như dùng được', () => {
    expect(publishableAccounts([account()], now)).toHaveLength(1);
  });
});

describe('gom theo khách hàng', () => {
  it('kênh của Egoric xuống cuối danh sách', () => {
    const groups = groupByClient([
      account({ id: 'x', clientId: undefined }),
      account({ id: 'y', clientId: 'c1' }),
    ]);
    expect(groups[groups.length - 1].clientId).toBeUndefined();
  });

  it('nhiều tài khoản cùng khách thì nằm chung một nhóm', () => {
    const groups = groupByClient([
      account({ id: 'a', clientId: 'c1' }),
      account({ id: 'b', clientId: 'c1' }),
      account({ id: 'c', clientId: 'c2' }),
    ]);
    expect(groups.find((group) => group.clientId === 'c1')?.accounts).toHaveLength(2);
  });
});

describe('đăng lên nhiều tài khoản', () => {
  const payload: PublishPayload = { text: 'Bài chung cho nhiều kênh' };

  const ledgerStore = () => {
    const rows: { fingerprint: string }[] = [];
    return {
      rows,
      readAll: async () => [...rows] as never[],
      put: async (entry: { fingerprint: string }) => {
        const index = rows.findIndex((item) => item.fingerprint === entry.fingerprint);
        if (index >= 0) rows[index] = entry;
        else rows.push(entry);
      },
    };
  };

  it('mỗi tài khoản một dòng kết quả riêng', async () => {
    const store = ledgerStore();
    const outcomes = await publishToAccounts(
      [account({ id: 'a1', externalId: '111', label: 'Page A' }), account({ id: 'a2', externalId: '222', label: 'Page B' })],
      payload,
      (id) => ({ accessToken: `tok_${id}`, accountId: id === 'a1' ? '111' : '222' }),
      {
        store: store as never,
        publish: async (channelId): Promise<PublishResult> => ({ channelId, success: true, message: 'ok', postId: 'p' }),
      },
    );

    expect(outcomes.map((item) => item.label)).toEqual(['Page A', 'Page B']);
    expect(outcomes.every((item) => item.outcome.result.success)).toBe(true);
  });

  it('cùng nội dung lên hai tài khoản khác nhau KHÔNG bị coi là trùng', async () => {
    const store = ledgerStore();
    await publishToAccounts(
      [account({ id: 'a1', externalId: '111' }), account({ id: 'a2', externalId: '222' })],
      payload,
      (id) => ({ accessToken: 't', accountId: id === 'a1' ? '111' : '222' }),
      {
        store: store as never,
        publish: async (channelId): Promise<PublishResult> => ({ channelId, success: true, message: 'ok', postId: 'p' }),
      },
    );
    // Hai vân tay khác nhau vì accountId khác nhau.
    expect(store.rows).toHaveLength(2);
  });

  it('cùng nội dung lên CÙNG một tài khoản lần hai thì bị chặn', async () => {
    const store = ledgerStore();
    const publish = async (channelId: never): Promise<PublishResult> =>
      ({ channelId, success: true, message: 'ok', postId: 'p' }) as PublishResult;

    const args = [
      [account({ id: 'a1', externalId: '111' })],
      payload,
      () => ({ accessToken: 't', accountId: '111' }),
      { store: store as never, publish: publish as never },
    ] as const;

    await publishToAccounts(...(args as never as Parameters<typeof publishToAccounts>));
    const second = await publishToAccounts(...(args as never as Parameters<typeof publishToAccounts>));

    expect(second[0].outcome.result.success).toBe(false);
    expect(second[0].outcome.duplicate?.kind).toBe('already-published');
  });

  it('một tài khoản hỏng không làm dừng các tài khoản còn lại', async () => {
    const store = ledgerStore();
    const outcomes = await publishToAccounts(
      [account({ id: 'a1', externalId: '111' }), account({ id: 'a2', externalId: '222' })],
      payload,
      () => ({ accessToken: 't' }),
      {
        store: store as never,
        publish: async (channelId, _payload, credentials): Promise<PublishResult> => {
          if (credentials.accountId === '111') throw new Error('Mạng hỏng');
          return { channelId, success: true, message: 'ok', postId: 'p' };
        },
      },
    );

    expect(outcomes[0].outcome.result.success).toBe(false);
    expect(outcomes[0].outcome.result.message).toContain('Mạng hỏng');
    expect(outcomes[1].outcome.result.success).toBe(true);
  });

  it('thiếu accountId trong khoá thì lấy externalId của tài khoản làm vân tay', async () => {
    const store = ledgerStore();
    await publishToAccounts(
      [account({ id: 'a1', externalId: '999' })],
      payload,
      () => ({ accessToken: 't' }),
      {
        store: store as never,
        publish: async (channelId): Promise<PublishResult> => ({ channelId, success: true, message: 'ok', postId: 'p' }),
      },
    );
    // Vân tay là chuỗi băm nên không chứa '999' nguyên văn; đối chiếu với vân
    // tay tính thẳng từ externalId mới là phép kiểm đúng.
    expect(store.rows[0].fingerprint).toBe(fingerprintPost('facebook-page', '999', payload.text));
  });
});
