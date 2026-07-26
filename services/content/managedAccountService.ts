import { ManagedAccount, ManagedAccountStatus, PublishChannelId } from '../../types/content';
import {
  deleteManagedAccount,
  getManagedAccounts,
  saveManagedAccount,
} from '../storageService';
import { getPublishChannel } from './publishChannels';

/**
 * Sổ tài khoản đăng bài.
 *
 * Trước đây khoá đăng bài lưu theo `channelId` nên toàn app chỉ giữ được đúng
 * một tài khoản mỗi nền tảng: nhập Fanpage thứ hai là ghi đè Fanpage thứ nhất,
 * không báo gì. Lớp này là chỗ đứng của tài khoản thứ hai trở đi.
 *
 * Chỉ dành cho tài khoản thật mà Egoric hoặc khách hàng sở hữu, nối qua API
 * chính thức của nền tảng.
 */

/** Cho phép thay lớp lưu trữ khi kiểm thử. */
export interface ManagedAccountStore {
  readAll: () => Promise<ManagedAccount[]>;
  put: (account: ManagedAccount) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const indexedDbStore: ManagedAccountStore = {
  readAll: () => getManagedAccounts<ManagedAccount>(),
  put: (account) => saveManagedAccount(account),
  remove: (id) => deleteManagedAccount(id),
};

export interface ManagedAccountOptions {
  store?: ManagedAccountStore;
  now?: () => number;
}

const makeId = (now: number): string =>
  `acct_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export interface ManagedAccountInput {
  channelId: PublishChannelId;
  label: string;
  externalId: string;
  clientId?: string;
  note?: string;
  tokenExpiresAt?: number;
}

/**
 * Lý do một input bị từ chối.
 *
 * Trả về danh sách chứ không ném lỗi ở lỗi đầu tiên: người dùng điền một form
 * thì muốn thấy hết chỗ sai một lượt, không phải sửa từng cái rồi bấm lại.
 */
export const validateAccountInput = (
  input: ManagedAccountInput,
  existing: ManagedAccount[],
  editingId?: string,
): string[] => {
  const issues: string[] = [];

  if (!getPublishChannel(input.channelId)) issues.push('Nền tảng không hợp lệ.');
  if (!input.label.trim()) issues.push('Cần đặt tên để phân biệt với tài khoản khác.');
  if (!input.externalId.trim()) issues.push('Cần ID trên nền tảng (Page ID, OA ID…).');

  // Cùng một Page mà thêm hai lần thì mọi bài sẽ đăng đôi, và sổ cái không cứu
  // được vì hai bản ghi mang hai accountId khác nhau.
  const duplicate = existing.find(
    (account) =>
      account.id !== editingId &&
      account.channelId === input.channelId &&
      account.externalId.trim() === input.externalId.trim(),
  );
  if (duplicate) issues.push(`Tài khoản này đã có trong sổ với tên "${duplicate.label}".`);

  return issues;
};

export class ManagedAccountError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join(' '));
    this.name = 'ManagedAccountError';
    this.issues = issues;
  }
}

export const listAccounts = async (options: ManagedAccountOptions = {}): Promise<ManagedAccount[]> => {
  const store = options.store ?? indexedDbStore;
  const accounts = await store.readAll();
  return [...accounts].sort((left, right) => left.label.localeCompare(right.label, 'vi'));
};

export const addAccount = async (
  input: ManagedAccountInput,
  options: ManagedAccountOptions = {},
): Promise<ManagedAccount> => {
  const store = options.store ?? indexedDbStore;
  const now = (options.now ?? Date.now)();

  const issues = validateAccountInput(input, await store.readAll());
  if (issues.length) throw new ManagedAccountError(issues);

  const account: ManagedAccount = {
    id: makeId(now),
    channelId: input.channelId,
    label: input.label.trim(),
    externalId: input.externalId.trim(),
    clientId: input.clientId || undefined,
    note: input.note?.trim() || undefined,
    tokenExpiresAt: input.tokenExpiresAt,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  await store.put(account);
  return account;
};

export const updateAccount = async (
  id: string,
  updates: Partial<ManagedAccountInput> & { status?: ManagedAccountStatus },
  options: ManagedAccountOptions = {},
): Promise<ManagedAccount> => {
  const store = options.store ?? indexedDbStore;
  const now = (options.now ?? Date.now)();
  const all = await store.readAll();

  const existing = all.find((account) => account.id === id);
  if (!existing) throw new ManagedAccountError(['Không tìm thấy tài khoản.']);

  const merged: ManagedAccount = {
    ...existing,
    ...updates,
    label: (updates.label ?? existing.label).trim(),
    externalId: (updates.externalId ?? existing.externalId).trim(),
    note: updates.note?.trim() || existing.note,
    updatedAt: now,
  };

  const issues = validateAccountInput(merged, all, id);
  if (issues.length) throw new ManagedAccountError(issues);

  await store.put(merged);
  return merged;
};

export const removeAccount = async (id: string, options: ManagedAccountOptions = {}): Promise<void> => {
  const store = options.store ?? indexedDbStore;
  await store.remove(id);
};

/* ─────────────────────────  Trạng thái và cảnh báo  ───────────────────── */

/** Còn ngần này thì bắt đầu nhắc đổi token. */
export const TOKEN_WARNING_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AccountWarning {
  accountId: string;
  label: string;
  severity: 'warning' | 'blocked';
  message: string;
}

/**
 * Tài khoản nào sắp hoặc đã không đăng được.
 *
 * Token Facebook Page sống 60 ngày. Không nhắc trước thì cả sổ tài khoản chết
 * cùng một hôm và không ai biết cho tới lúc bài không lên.
 */
export const collectAccountWarnings = (
  accounts: ManagedAccount[],
  now = Date.now(),
): AccountWarning[] => {
  const warnings: AccountWarning[] = [];

  accounts.forEach((account) => {
    if (account.status === 'revoked') {
      warnings.push({
        accountId: account.id,
        label: account.label,
        severity: 'blocked',
        message: 'Quyền đã bị thu hồi bên nền tảng. Cần nối lại tài khoản.',
      });
      return;
    }

    if (account.status === 'token-expired') {
      warnings.push({
        accountId: account.id,
        label: account.label,
        severity: 'blocked',
        message: 'Token đã hết hạn. Cần lấy token mới.',
      });
      return;
    }

    if (account.status === 'paused') return;

    if (account.tokenExpiresAt) {
      const remainingDays = Math.floor((account.tokenExpiresAt - now) / DAY_MS);
      if (remainingDays < 0) {
        warnings.push({
          accountId: account.id,
          label: account.label,
          severity: 'blocked',
          message: 'Token đã quá hạn theo ngày ghi nhận. Cần lấy token mới.',
        });
      } else if (remainingDays <= TOKEN_WARNING_DAYS) {
        warnings.push({
          accountId: account.id,
          label: account.label,
          severity: 'warning',
          message: `Token còn ${remainingDays} ngày. Nên đổi trước khi hết.`,
        });
      }
    }
  });

  return warnings;
};

/** Tài khoản đăng được ngay bây giờ. */
export const publishableAccounts = (
  accounts: ManagedAccount[],
  now = Date.now(),
): ManagedAccount[] =>
  accounts.filter(
    (account) =>
      account.status === 'active' && (!account.tokenExpiresAt || account.tokenExpiresAt > now),
  );

/** Gom theo khách hàng để giao diện hiện thành nhóm. */
export const groupByClient = (
  accounts: ManagedAccount[],
): { clientId?: string; accounts: ManagedAccount[] }[] => {
  const groups = new Map<string, ManagedAccount[]>();
  accounts.forEach((account) => {
    const key = account.clientId ?? '';
    groups.set(key, [...(groups.get(key) ?? []), account]);
  });

  return Array.from(groups.entries())
    .map(([key, items]) => ({ clientId: key || undefined, accounts: items }))
    // Kênh của Egoric xuống cuối: phần lớn thời gian người dùng đang tìm kênh khách.
    .sort((left, right) => {
      if (!left.clientId) return 1;
      if (!right.clientId) return -1;
      return left.clientId.localeCompare(right.clientId, 'vi');
    });
};
