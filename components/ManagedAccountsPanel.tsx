import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { AgencyClient } from '../types';
import { ManagedAccount, PublishChannelId } from '../types/content';
import { PUBLISH_CHANNELS } from '../services/content/publishChannels';
import {
  ManagedAccountError,
  addAccount,
  collectAccountWarnings,
  groupByClient,
  listAccounts,
  removeAccount,
  updateAccount,
} from '../services/content/managedAccountService';
import { getPublishSecret, setPublishSecret } from '../services/credentialVault';
import { getAllAgencyClients } from '../services/storageService';

/**
 * Sổ tài khoản đăng bài.
 *
 * Nằm ở Trung tâm vận hành chứ không nằm trong một bài viết, vì tài khoản là dữ
 * liệu cấp workspace: một Fanpage phục vụ nhiều chiến dịch của cùng khách hàng,
 * và nó tồn tại độc lập với bất kỳ bài nào.
 *
 * Chỉ dành cho tài khoản thật mà Egoric hoặc khách hàng sở hữu, nối qua API
 * chính thức của nền tảng.
 */
const ManagedAccountsPanel: React.FC<{ isActive: boolean }> = ({ isActive }) => {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [clients, setClients] = useState<AgencyClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string[]>([]);
  const [editingSecretFor, setEditingSecretFor] = useState<string | null>(null);
  const [secretDraft, setSecretDraft] = useState({ accessToken: '', accountId: '' });

  const [newChannel, setNewChannel] = useState<PublishChannelId>('facebook-page');
  const [newLabel, setNewLabel] = useState('');
  const [newExternalId, setNewExternalId] = useState('');
  const [newClientId, setNewClientId] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, clientRows] = await Promise.all([listAccounts(), getAllAgencyClients()]);
      setAccounts(rows);
      setClients(clientRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không đọc được sổ tài khoản.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) void refresh();
  }, [isActive, refresh]);

  const warnings = useMemo(() => collectAccountWarnings(accounts), [accounts]);
  const groups = useMemo(() => groupByClient(accounts), [accounts]);
  const clientName = useCallback(
    (id?: string) => clients.find((client) => client.id === id)?.brandName || 'Kênh của Egoric',
    [clients],
  );

  const handleAdd = async () => {
    setFormError([]);
    try {
      await addAccount({
        channelId: newChannel,
        label: newLabel,
        externalId: newExternalId,
        clientId: newClientId || undefined,
      });
      setNewLabel('');
      setNewExternalId('');
      setAdding(false);
      await refresh();
    } catch (err) {
      setFormError(err instanceof ManagedAccountError ? err.issues : ['Không thêm được tài khoản.']);
    }
  };

  const togglePause = async (account: ManagedAccount) => {
    // Chỉ đổi giữa `active` và `paused`. Tài khoản đang ở `token-expired` hay
    // `revoked` thì bật lại bằng nút này là nói dối: token vẫn hỏng.
    if (account.status !== 'active' && account.status !== 'paused') return;
    await updateAccount(account.id, { status: account.status === 'active' ? 'paused' : 'active' });
    await refresh();
  };

  const openSecret = (account: ManagedAccount) => {
    const stored = getPublishSecret(account.id);
    setSecretDraft({
      accessToken: stored.accessToken ?? '',
      accountId: stored.accountId ?? account.externalId,
    });
    setEditingSecretFor(account.id);
  };

  const saveSecret = async (account: ManagedAccount) => {
    setPublishSecret(account.id, secretDraft);
    // Nhập token mới cho tài khoản đang bị đánh dấu hết hạn thì trả nó về hoạt
    // động — đây là thao tác người dùng chủ động, không phải hệ thống tự đoán.
    if (account.status === 'token-expired') await updateAccount(account.id, { status: 'active' });
    setEditingSecretFor(null);
    await refresh();
  };

  const channel = PUBLISH_CHANNELS.find((item) => item.id === newChannel)!;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-sm text-zinc-400">
          Tài khoản thật mà Egoric hoặc khách hàng sở hữu, nối qua API chính thức của nền tảng.
          Danh sách được lưu lại; token thì chỉ nằm trong phiên trình duyệt này.
        </p>
        <div className="flex gap-2">
          <button type="button" className="eg-button-secondary min-h-11 px-4" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`mr-2 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Làm mới
          </button>
          <button type="button" className="eg-button-primary min-h-11 px-4" onClick={() => setAdding((v) => !v)}>
            <Plus className="mr-2 inline h-4 w-4" />Thêm tài khoản
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-4 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
        <span>{accounts.length} tài khoản</span>
        <span className="text-emerald-300/70">{accounts.filter((a) => a.status === 'active').length} đang chạy</span>
        {accounts.some((a) => a.status === 'paused') && (
          <span>{accounts.filter((a) => a.status === 'paused').length} tạm dừng</span>
        )}
        {warnings.length > 0 && <span className="text-amber-300/80">{warnings.length} cần xử lý</span>}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-rose-300/30 bg-rose-500/[.08] px-4 py-3 text-sm text-rose-100">
          {error}
        </p>
      )}

      {warnings.length > 0 && (
        <div className="mt-4 space-y-2">
          {warnings.map((warning) => (
            <p
              key={warning.accountId}
              className={`flex gap-2 rounded-xl border px-3 py-2 text-xs leading-relaxed ${
                warning.severity === 'blocked'
                  ? 'border-rose-300/25 bg-rose-500/[.07] text-rose-100'
                  : 'border-amber-300/25 bg-amber-400/[.07] text-amber-100'
              }`}
            >
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span><strong>{warning.label}</strong> — {warning.message}</span>
            </p>
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-5 rounded-2xl border border-white/[.08] bg-black/20 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="eg-kicker">Nền tảng</span>
              <select
                className="eg-input mt-2 min-h-11 w-full px-3 text-sm"
                value={newChannel}
                onChange={(e) => setNewChannel(e.target.value as PublishChannelId)}
              >
                {PUBLISH_CHANNELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="eg-kicker">Khách hàng</span>
              <select
                className="eg-input mt-2 min-h-11 w-full px-3 text-sm"
                value={newClientId}
                onChange={(e) => setNewClientId(e.target.value)}
              >
                <option value="">Kênh của Egoric</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.brandName}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="eg-kicker">Tên gọi</span>
              <input
                className="eg-input mt-2 w-full"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Fanpage Cà phê Hạnh — miền Nam"
              />
            </label>
            <label className="block">
              <span className="eg-kicker">
                {channel.fields.find((f) => f.key === 'accountId')?.label ?? 'ID trên nền tảng'}
              </span>
              <input
                className="eg-input mt-2 w-full"
                value={newExternalId}
                onChange={(e) => setNewExternalId(e.target.value)}
                autoComplete="off"
              />
            </label>
          </div>

          {formError.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-rose-100/85">
              {formError.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}

          <div className="mt-4 flex gap-2">
            <button type="button" className="eg-button-primary min-h-11 px-4 text-xs" onClick={() => void handleAdd()}>
              Lưu tài khoản
            </button>
            <button type="button" className="eg-button-secondary min-h-11 px-4 text-xs" onClick={() => setAdding(false)}>
              Huỷ
            </button>
          </div>
        </div>
      )}

      {accounts.length === 0 && !adding ? (
        <p className="mt-6 text-sm text-zinc-500">
          Chưa có tài khoản nào. Thêm Fanpage, Threads hoặc Zalo OA để đăng bài từ Xưởng nội dung.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.clientId ?? 'egoric'} className="mt-6">
            <h3 className="eg-kicker mb-2 flex items-baseline gap-2">
              {clientName(group.clientId)}
              <span className="text-zinc-600">{group.accounts.length} tài khoản</span>
            </h3>

            <ul className="space-y-3">
              {group.accounts.map((account) => {
                const meta = PUBLISH_CHANNELS.find((item) => item.id === account.channelId);
                const hasToken = Boolean(getPublishSecret(account.id).accessToken);

                return (
                  <li key={account.id} className="eg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="eg-mono text-[10px] uppercase tracking-wider text-zinc-600">
                            {meta?.label ?? account.channelId}
                          </span>
                          {account.status === 'active' && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-400/[.08] px-2.5 py-0.5 text-[10px] text-emerald-100">
                              <CheckCircle2 className="h-3 w-3" />Đang chạy
                            </span>
                          )}
                          {account.status === 'paused' && (
                            <span className="rounded-full border border-white/[.1] bg-white/[.04] px-2.5 py-0.5 text-[10px] text-zinc-400">
                              Tạm dừng
                            </span>
                          )}
                          {(account.status === 'token-expired' || account.status === 'revoked') && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-rose-300/30 bg-rose-500/[.09] px-2.5 py-0.5 text-[10px] text-rose-100">
                              <AlertTriangle className="h-3 w-3" />
                              {account.status === 'revoked' ? 'Bị thu hồi' : 'Hết token'}
                            </span>
                          )}
                          {!hasToken && (
                            <span className="rounded-full border border-amber-300/25 bg-amber-400/[.07] px-2.5 py-0.5 text-[10px] text-amber-100">
                              Chưa nhập token
                            </span>
                          )}
                        </div>

                        <div className="mt-1.5 truncate text-sm font-medium text-zinc-100">{account.label}</div>
                        <div className="eg-mono mt-1 text-[10px] text-zinc-600">{account.externalId}</div>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          className="eg-button-secondary min-h-11 px-3 text-xs"
                          onClick={() => openSecret(account)}
                        >
                          <KeyRound className="mr-1.5 inline h-3.5 w-3.5" />Token
                        </button>
                        {(account.status === 'active' || account.status === 'paused') && (
                          <button
                            type="button"
                            className="eg-button-secondary min-h-11 px-3 text-xs"
                            onClick={() => void togglePause(account)}
                            aria-label={account.status === 'active' ? `Tạm dừng ${account.label}` : `Bật lại ${account.label}`}
                          >
                            {account.status === 'active'
                              ? <Pause className="h-3.5 w-3.5" />
                              : <Play className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        <button
                          type="button"
                          className="min-h-11 px-2 text-zinc-600 hover:text-rose-200"
                          aria-label={`Gỡ ${account.label}`}
                          onClick={() => void removeAccount(account.id).then(refresh)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {editingSecretFor === account.id && (
                      <div className="mt-4 border-t eg-divider pt-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          {(meta?.fields ?? []).map((field) => (
                            <label key={field.key} className="block">
                              <span className="eg-kicker">{field.label}</span>
                              <input
                                className="eg-input mt-2 w-full"
                                type={field.secret ? 'password' : 'text'}
                                autoComplete="off"
                                value={field.key === 'accessToken' ? secretDraft.accessToken : secretDraft.accountId}
                                onChange={(e) =>
                                  setSecretDraft((previous) => ({
                                    ...previous,
                                    [field.key]: e.target.value,
                                  }))
                                }
                              />
                              <span className="mt-1.5 block text-xs leading-relaxed text-zinc-500">{field.hint}</span>
                            </label>
                          ))}
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button type="button" className="eg-button-primary min-h-11 px-4 text-xs" onClick={() => void saveSecret(account)}>
                            Lưu token
                          </button>
                          <button type="button" className="eg-button-secondary min-h-11 px-4 text-xs" onClick={() => setEditingSecretFor(null)}>
                            Huỷ
                          </button>
                        </div>
                        <p className="mt-3 text-xs leading-relaxed text-zinc-600">
                          Token chỉ nằm trong phiên trình duyệt này, không ghi ra đĩa và không lên cloud. Đóng tab là mất,
                          phải nhập lại — danh sách tài khoản thì vẫn còn.
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
};

export default ManagedAccountsPanel;
