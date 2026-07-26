import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { BrandKit } from '../../types';
import {
  ArticleDraft,
  ManagedAccount,
  PublishChannelId,
  ReviewDecision,
} from '../../types/content';
import { PUBLISH_CHANNELS } from '../../services/content/publishChannels';
import {
  CHANNEL_LIMITS,
  findMissingCredentials,
  toPostText,
} from '../../services/content/publishService';
import { AccountPublishOutcome, publishToAccounts } from '../../services/content/publishLedgerService';
import {
  ManagedAccountError,
  addAccount,
  collectAccountWarnings,
  listAccounts,
  publishableAccounts,
  removeAccount,
} from '../../services/content/managedAccountService';
import { inspectBrandCompliance } from '../../services/brandKitService';
import { getPublishSecret, setPublishSecret } from '../../services/credentialVault';

interface Props {
  draft: ArticleDraft;
  /** Brand Kit đã chốt của dự án. Không có thì bỏ qua vòng kiểm thương hiệu. */
  brandKit?: BrandKit | null;
  /**
   * Quyết định duyệt của bản đang mở, lấy từ thư viện.
   *
   * `undefined` nghĩa là bài chưa được lưu vào thư viện nên chưa qua bàn duyệt.
   */
  reviewDecision?: ReviewDecision;
  /** Khách hàng của dự án, để tài khoản mới gắn đúng chủ. */
  clientId?: string;
}

/**
 * Đăng bài đi nhiều tài khoản.
 *
 * Hai điều cố ý làm chặt hơn phần còn lại của ứng dụng, vì đăng bài không rút
 * lại được: nội dung sắp đăng luôn hiện ra để đọc lại trước, và nút đăng có
 * bước xác nhận riêng chứ không đăng ngay lần bấm đầu.
 *
 * Phạm vi có chủ ý: mỗi lần đăng chỉ nhắm **một nền tảng**, nhiều tài khoản
 * trong nền tảng đó. Đăng chéo nền tảng cùng lúc sẽ kéo theo hai giới hạn ký
 * tự và hai kết quả kiểm Brand Kit trên cùng một màn — rối hơn phần nó tiết
 * kiệm được.
 */
const PublishPanel: React.FC<Props> = ({ draft, brandKit, reviewDecision, clientId }) => {
  const [channelId, setChannelId] = useState<PublishChannelId>('facebook-page');
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [secrets, setSecrets] = useState<Record<string, { accessToken: string; accountId: string }>>({});
  const [showSteps, setShowSteps] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newExternalId, setNewExternalId] = useState('');
  const [formError, setFormError] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [outcomes, setOutcomes] = useState<AccountPublishOutcome[] | null>(null);

  const channel = PUBLISH_CHANNELS.find((item) => item.id === channelId)!;
  const limit = CHANNEL_LIMITS[channelId];
  const postText = toPostText(draft, limit);

  const reload = useCallback(async () => {
    const all = await listAccounts();
    setAccounts(all);

    // Nạp khoá đã lưu trong phiên cho từng tài khoản.
    const loaded: Record<string, { accessToken: string; accountId: string }> = {};
    all.forEach((item) => {
      const stored = getPublishSecret(item.id);
      loaded[item.id] = {
        accessToken: stored.accessToken ?? '',
        accountId: stored.accountId ?? item.externalId,
      };
    });
    setSecrets(loaded);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const channelAccounts = useMemo(
    () => accounts.filter((item) => item.channelId === channelId),
    [accounts, channelId],
  );
  const usable = useMemo(() => publishableAccounts(channelAccounts), [channelAccounts]);
  const warnings = useMemo(() => collectAccountWarnings(channelAccounts), [channelAccounts]);

  const selected = useMemo(
    () => usable.filter((item) => selectedIds.includes(item.id)),
    [usable, selectedIds],
  );

  // Đổi nền tảng thì bỏ chọn hết: tài khoản của nền tảng cũ không còn nghĩa gì.
  useEffect(() => {
    setSelectedIds([]);
    setConfirming(false);
    setOutcomes(null);
  }, [channelId]);

  /**
   * Kiểm thương hiệu trên đúng đoạn sắp đăng, không phải trên bài đầy đủ.
   *
   * Bài dài bị cắt để vừa giới hạn kênh, mà đoạn bị cắt đi có thể chính là chỗ
   * chứa từ bắt buộc hoặc CTA đã duyệt. Kiểm bài đầy đủ sẽ báo đạt trong khi
   * thứ thật sự lên mạng lại thiếu.
   */
  const compliance = useMemo(
    () => (brandKit ? inspectBrandCompliance(postText, brandKit) : null),
    [postText, brandKit],
  );
  const blockedByBrand = Boolean(compliance && !compliance.passed);

  /**
   * Chưa duyệt thì không đăng.
   *
   * Đây là quy tắc do chủ sản phẩm đặt ra và áp cho cả kênh của Egoric lẫn
   * kênh khách hàng, không có ngoại lệ. Không có nút bỏ qua ở đây — muốn đăng
   * thì phải đi qua bàn duyệt.
   */
  const blockedByReview = reviewDecision !== 'approved';

  const missingByAccount = useMemo(
    () =>
      selected
        .map((item) => ({
          account: item,
          missing: findMissingCredentials(channelId, secrets[item.id] ?? {}),
        }))
        .filter((entry) => entry.missing.length > 0),
    [selected, secrets, channelId],
  );

  const patchSecret = (id: string, patch: Partial<{ accessToken: string; accountId: string }>) => {
    setSecrets((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } as never }));
  };

  const persistSecret = (id: string) => {
    const value = secrets[id];
    if (value) setPublishSecret(id, value);
  };

  const handleAdd = async () => {
    setFormError([]);
    try {
      await addAccount({
        channelId,
        label: newLabel,
        externalId: newExternalId,
        clientId,
      });
      setNewLabel('');
      setNewExternalId('');
      setAdding(false);
      await reload();
    } catch (error) {
      setFormError(error instanceof ManagedAccountError ? error.issues : ['Không thêm được tài khoản.']);
    }
  };

  const handleRemove = async (id: string) => {
    await removeAccount(id);
    setSelectedIds((previous) => previous.filter((item) => item !== id));
    await reload();
  };

  /**
   * @param force bỏ qua cảnh báo trùng. Chỉ true khi người dùng đã đọc cảnh
   * báo và tự khẳng định muốn đăng lại.
   */
  const handlePublish = async (force = false) => {
    // Chốt chặn thứ hai. Nút đã bị khoá khi vi phạm, nhưng nội dung có thể đổi
    // sau lúc bấm xác nhận, và đăng bài thì không rút lại được.
    if (blockedByBrand || blockedByReview || !selected.length) {
      setConfirming(false);
      return;
    }
    selected.forEach((item) => persistSecret(item.id));
    setSending(true);
    setOutcomes(null);

    try {
      const results = await publishToAccounts(
        selected,
        { text: postText },
        (id) => secrets[id] ?? {},
        { force },
      );
      setOutcomes(results);
    } finally {
      setSending(false);
      setConfirming(false);
    }
  };

  const retryOne = async (managedAccountId: string) => {
    const account = selected.find((item) => item.id === managedAccountId);
    if (!account) return;
    setSending(true);
    try {
      const results = await publishToAccounts(
        [account],
        { text: postText },
        (id) => secrets[id] ?? {},
        { force: true },
      );
      setOutcomes((previous) =>
        (previous ?? []).map((row) => (row.managedAccountId === managedAccountId ? results[0] : row)),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="eg-panel mt-6 p-5" aria-labelledby="publish-heading">
      <h2 id="publish-heading" className="text-sm font-semibold text-white">Đăng bài</h2>
      <p className="mt-1.5 text-xs text-zinc-500">
        Token chỉ nằm trong phiên trình duyệt này, không ghi ra đĩa và không lên cloud. Đóng tab là mất.
        Danh sách tài khoản thì được lưu lại, chỉ token là không.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {PUBLISH_CHANNELS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setChannelId(item.id)}
            aria-pressed={channelId === item.id}
            className={`min-h-11 rounded-xl border px-4 text-xs font-medium transition-colors ${
              channelId === item.id
                ? 'border-cyan-200/25 bg-cyan-200/[.09] text-white'
                : 'border-white/[.07] text-zinc-400 hover:bg-white/[.035] hover:text-zinc-200'
            }`}
          >
            {item.label}
            {accounts.filter((account) => account.channelId === item.id).length > 0 && (
              <span className="ml-2 text-[10px] text-zinc-500">
                {accounts.filter((account) => account.channelId === item.id).length}
              </span>
            )}
          </button>
        ))}
      </div>

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

      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="eg-kicker">Tài khoản {channel.label}</div>
          <button
            type="button"
            className="min-h-11 text-xs font-medium text-cyan-200/80 hover:text-cyan-100"
            onClick={() => setAdding((v) => !v)}
            aria-expanded={adding}
          >
            <Plus className="mr-1 inline h-3.5 w-3.5" />Thêm tài khoản
          </button>
        </div>

        {adding && (
          <div className="mt-3 rounded-xl border border-white/[.07] bg-black/20 p-4">
            <div className="grid gap-3 md:grid-cols-2">
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
                <span className="eg-kicker">{channel.fields.find((f) => f.key === 'accountId')?.label ?? 'ID trên nền tảng'}</span>
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
            <div className="mt-3 flex gap-2">
              <button type="button" className="eg-button-primary min-h-11 px-4 text-xs" onClick={() => void handleAdd()}>
                Lưu tài khoản
              </button>
              <button type="button" className="eg-button-secondary min-h-11 px-4 text-xs" onClick={() => setAdding(false)}>
                Huỷ
              </button>
            </div>
          </div>
        )}

        {channelAccounts.length === 0 ? (
          <p className="mt-3 rounded-xl border border-white/[.07] bg-black/20 px-4 py-3 text-xs leading-relaxed text-zinc-500">
            Chưa có tài khoản {channel.label} nào. Thêm ít nhất một tài khoản để đăng được.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {channelAccounts.map((account) => {
              const isUsable = usable.some((item) => item.id === account.id);
              const isSelected = selectedIds.includes(account.id);
              const secret = secrets[account.id] ?? { accessToken: '', accountId: '' };

              return (
                <li key={account.id} className="rounded-xl border border-white/[.07] bg-black/20 p-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-cyan-300"
                      checked={isSelected}
                      disabled={!isUsable}
                      aria-label={`Chọn ${account.label}`}
                      onChange={(e) =>
                        setSelectedIds((previous) =>
                          e.target.checked
                            ? [...previous, account.id]
                            : previous.filter((item) => item !== account.id),
                        )
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-zinc-100">{account.label}</span>
                        {!isUsable && (
                          <span className="shrink-0 rounded-md border border-white/10 px-1.5 text-[10px] text-zinc-500">
                            {account.status === 'paused' ? 'tạm dừng' : 'không đăng được'}
                          </span>
                        )}
                      </div>
                      <span className="eg-mono block text-[10px] text-zinc-600">{account.externalId}</span>

                      {isSelected && (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {channel.fields.map((field) => (
                            <label key={field.key} className="block">
                              <span className="eg-kicker">{field.label}</span>
                              <input
                                className="eg-input mt-2 w-full"
                                type={field.secret ? 'password' : 'text'}
                                autoComplete="off"
                                value={field.key === 'accessToken' ? secret.accessToken : secret.accountId}
                                onChange={(e) =>
                                  patchSecret(
                                    account.id,
                                    field.key === 'accessToken'
                                      ? { accessToken: e.target.value }
                                      : { accountId: e.target.value },
                                  )
                                }
                                onBlur={() => persistSecret(account.id)}
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="min-h-11 shrink-0 px-2 text-zinc-600 hover:text-rose-200"
                      aria-label={`Gỡ ${account.label}`}
                      onClick={() => void handleRemove(account.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <button
          type="button"
          className="text-xs font-medium text-cyan-200/80 underline underline-offset-4 hover:text-cyan-100"
          onClick={() => setShowSteps((v) => !v)}
          aria-expanded={showSteps}
        >
          {showSteps ? 'Ẩn hướng dẫn lấy token' : `Lấy token ${channel.label} ở đâu?`}
        </button>

        {showSteps && (
          <div className="mt-3 rounded-xl border border-white/[.07] bg-black/20 p-4">
            <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-zinc-400">
              {channel.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>

            <div className="mt-4 border-t eg-divider pt-3">
              <div className="eg-kicker">Điều kiện bắt buộc</div>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs leading-relaxed text-zinc-400">
                {channel.requirements.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>

            {channel.caveat && (
              <p className="mt-3 flex gap-2 text-xs leading-relaxed text-amber-100/70">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{channel.caveat}</span>
              </p>
            )}

            <a
              href={channel.consoleUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-4 inline-flex min-h-11 items-center text-xs font-medium text-cyan-200/80 hover:text-cyan-100"
            >
              Mở {channel.consoleUrl.replace('https://', '')}
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </div>
        )}
      </div>

      <div className="mt-5 border-t eg-divider pt-4">
        <div className="flex items-baseline justify-between">
          <div className="eg-kicker">Nội dung sắp đăng</div>
          <span className={`eg-mono text-[10px] ${postText.length > limit ? 'text-rose-300' : 'text-zinc-600'}`}>
            {postText.length}/{limit}
          </span>
        </div>
        <pre className="eg-safe-scroll mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/[.07] bg-black/20 p-3 text-xs leading-relaxed text-zinc-400">
          {postText}
        </pre>
      </div>

      {compliance && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 ${
            compliance.passed
              ? 'border-emerald-300/20 bg-emerald-400/[.05]'
              : 'border-rose-300/30 bg-rose-500/[.08]'
          }`}
        >
          <div className="flex items-center gap-2">
            {compliance.passed ? (
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-300" />
            ) : (
              <ShieldAlert className="h-4 w-4 shrink-0 text-rose-300" />
            )}
            <span className={`text-sm font-medium ${compliance.passed ? 'text-emerald-100' : 'text-rose-100'}`}>
              Kiểm Brand Kit: {compliance.score}/100
              {compliance.passed ? ' — đạt' : ' — chưa đạt, không đăng được'}
            </span>
          </div>

          {compliance.violations.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-rose-100/85">
              {compliance.violations.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
          {compliance.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-amber-100/70">
              {compliance.warnings.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
          {!compliance.passed && (
            <p className="mt-2 text-xs text-rose-100/70">
              Sửa bài rồi viết lại, hoặc chỉnh Brand Kit nếu quy định đã thay đổi.
            </p>
          )}
        </div>
      )}

      <div
        className={`mt-4 flex gap-2 rounded-xl border px-4 py-3 ${
          blockedByReview
            ? 'border-amber-300/30 bg-amber-400/[.08]'
            : 'border-emerald-300/20 bg-emerald-400/[.05]'
        }`}
      >
        {blockedByReview ? (
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
        ) : (
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
        )}
        <div className="min-w-0 text-sm">
          {blockedByReview ? (
            <>
              <p className="font-medium text-amber-50">
                {reviewDecision === 'changes-requested'
                  ? 'Bàn duyệt yêu cầu sửa'
                  : reviewDecision === 'pending'
                    ? 'Đang chờ duyệt'
                    : 'Chưa qua bàn duyệt'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
                {reviewDecision
                  ? 'Mở Trung tâm vận hành → Bàn duyệt để xử lý.'
                  : 'Lưu bài vào thư viện rồi duyệt ở Trung tâm vận hành → Bàn duyệt. Mọi bài đều phải qua bước này, kể cả kênh của Egoric.'}
              </p>
            </>
          ) : (
            <p className="font-medium text-emerald-100">Đã duyệt, đăng được.</p>
          )}
        </div>
      </div>

      {missingByAccount.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-100/70">
          {missingByAccount.map((entry) => (
            <li key={entry.account.id}>
              <strong>{entry.account.label}</strong> còn thiếu: {entry.missing.join(', ')}.
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!confirming ? (
          <button
            type="button"
            className="eg-button-primary min-h-11 px-5"
            onClick={() => setConfirming(true)}
            disabled={
              !selected.length ||
              missingByAccount.length > 0 ||
              blockedByBrand ||
              blockedByReview ||
              sending
            }
          >
            <Send className="mr-2 inline h-4 w-4" />
            Đăng lên {selected.length || 0} tài khoản
          </button>
        ) : (
          <>
            <span className="text-xs text-zinc-300">
              Đăng công khai lên {selected.length} tài khoản {channel.label}:{' '}
              {selected.map((item) => item.label).join(', ')}. Thao tác này không rút lại được từ đây.
            </span>
            <button type="button" className="eg-button-primary min-h-11 px-5" onClick={() => void handlePublish(false)} disabled={sending}>
              {sending ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : null}
              Xác nhận đăng
            </button>
            <button type="button" className="eg-button-secondary min-h-11 px-4" onClick={() => setConfirming(false)} disabled={sending}>
              Huỷ
            </button>
          </>
        )}
      </div>

      {outcomes && (
        <ul className="mt-4 space-y-2">
          {outcomes.map((row) => {
            const duplicate = row.outcome.duplicate;
            const result = row.outcome.result;
            const isDuplicate = Boolean(duplicate && duplicate.kind !== 'clear');

            return (
              <li
                key={row.managedAccountId}
                role={result.success ? 'status' : 'alert'}
                className={`flex gap-2 rounded-xl border px-4 py-3 text-sm ${
                  isDuplicate
                    ? 'border-amber-300/30 bg-amber-400/[.08] text-amber-100'
                    : result.success
                      ? 'border-emerald-300/25 bg-emerald-400/[.07] text-emerald-100'
                      : 'border-rose-300/30 bg-rose-500/[.08] text-rose-100'
                }`}
              >
                {isDuplicate ? (
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                ) : result.success ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="font-medium">{row.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed opacity-90">
                    {isDuplicate && duplicate?.kind === 'indeterminate' ? (
                      <>
                        Lần đăng trước chưa rõ kết quả. <strong>Bài có thể đã lên.</strong> Hãy mở{' '}
                        {channel.label} kiểm tra trước khi đăng lại.
                      </>
                    ) : (
                      result.message
                    )}
                    {result.url && (
                      <>
                        {' '}
                        <a href={result.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                          Xem bài
                        </a>
                      </>
                    )}
                  </p>
                  {isDuplicate && (
                    <button
                      type="button"
                      className="eg-button-secondary mt-2 min-h-11 px-4 text-xs"
                      onClick={() => void retryOne(row.managedAccountId)}
                      disabled={sending}
                    >
                      Tôi đã kiểm tra, vẫn đăng
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default PublishPanel;
