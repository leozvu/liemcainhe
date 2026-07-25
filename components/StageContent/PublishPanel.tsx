import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, Send, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { BrandKit } from '../../types';
import { ArticleDraft, PublishChannelId, PublishResult } from '../../types/content';
import { PUBLISH_CHANNELS } from '../../services/content/publishChannels';
import {
  CHANNEL_LIMITS,
  findMissingCredentials,
  publishToChannel,
  toPostText,
} from '../../services/content/publishService';
import { inspectBrandCompliance } from '../../services/brandKitService';
import { getPublishSecret, setPublishSecret } from '../../services/credentialVault';

interface Props {
  draft: ArticleDraft;
  /** Brand Kit đã chốt của dự án. Không có thì bỏ qua vòng kiểm thương hiệu. */
  brandKit?: BrandKit | null;
}

/**
 * Đăng bài đi các kênh.
 *
 * Hai điều cố ý làm chặt hơn phần còn lại của ứng dụng, vì đăng bài không rút
 * lại được: nội dung sắp đăng luôn hiện ra để đọc lại trước, và nút đăng có
 * bước xác nhận riêng chứ không đăng ngay lần bấm đầu.
 */
const PublishPanel: React.FC<Props> = ({ draft, brandKit }) => {
  const [channelId, setChannelId] = useState<PublishChannelId>('facebook-page');
  const [accessToken, setAccessToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [showSteps, setShowSteps] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);

  const channel = PUBLISH_CHANNELS.find((item) => item.id === channelId)!;
  const limit = CHANNEL_LIMITS[channelId];
  const postText = toPostText(draft, limit);
  const missing = findMissingCredentials(channelId, { accessToken, accountId });

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

  // Nạp lại token đã lưu trong phiên khi đổi kênh.
  useEffect(() => {
    const stored = getPublishSecret(channelId);
    setAccessToken(stored.accessToken ?? '');
    setAccountId(stored.accountId ?? '');
    setConfirming(false);
    setResult(null);
  }, [channelId]);

  const handleSaveCredentials = () => {
    setPublishSecret(channelId, { accessToken, accountId });
  };

  const handlePublish = async () => {
    // Chốt chặn thứ hai. Nút đã bị khoá khi vi phạm, nhưng nội dung có thể đổi
    // sau lúc bấm xác nhận, và đăng bài thì không rút lại được.
    if (blockedByBrand) {
      setConfirming(false);
      return;
    }
    handleSaveCredentials();
    setSending(true);
    setResult(null);
    try {
      setResult(await publishToChannel(channelId, { text: postText }, { accessToken, accountId }));
    } finally {
      setSending(false);
      setConfirming(false);
    }
  };

  return (
    <section className="eg-panel mt-6 p-5" aria-labelledby="publish-heading">
      <h2 id="publish-heading" className="text-sm font-semibold text-white">Đăng bài</h2>
      <p className="mt-1.5 text-xs text-zinc-500">
        Token chỉ nằm trong phiên trình duyệt này, không ghi ra đĩa và không lên cloud. Đóng tab là mất.
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
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {channel.fields.map((field) => (
          <label key={field.key} className="block">
            <span className="eg-kicker">{field.label}</span>
            <input
              className="eg-input mt-2 w-full"
              type={field.secret ? 'password' : 'text'}
              autoComplete="off"
              value={field.key === 'accessToken' ? accessToken : accountId}
              onChange={(e) =>
                field.key === 'accessToken' ? setAccessToken(e.target.value) : setAccountId(e.target.value)
              }
              onBlur={handleSaveCredentials}
            />
            <span className="mt-1.5 block text-xs leading-relaxed text-zinc-500">{field.hint}</span>
          </label>
        ))}
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

      {missing.length > 0 && (
        <p className="mt-3 text-xs text-amber-100/70">Còn thiếu: {missing.join(', ')}.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!confirming ? (
          <button
            type="button"
            className="eg-button-primary min-h-11 px-5"
            onClick={() => setConfirming(true)}
            disabled={missing.length > 0 || blockedByBrand || sending}
          >
            <Send className="mr-2 inline h-4 w-4" />Đăng lên {channel.label}
          </button>
        ) : (
          <>
            <span className="text-xs text-zinc-300">
              Đăng công khai lên {channel.label}. Thao tác này không rút lại được từ đây.
            </span>
            <button type="button" className="eg-button-primary min-h-11 px-5" onClick={() => void handlePublish()} disabled={sending}>
              {sending ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : null}
              Xác nhận đăng
            </button>
            <button type="button" className="eg-button-secondary min-h-11 px-4" onClick={() => setConfirming(false)} disabled={sending}>
              Huỷ
            </button>
          </>
        )}
      </div>

      {result && (
        <div
          role={result.success ? 'status' : 'alert'}
          className={`mt-4 flex gap-2 rounded-xl border px-4 py-3 text-sm ${
            result.success
              ? 'border-emerald-300/25 bg-emerald-400/[.07] text-emerald-100'
              : 'border-rose-300/30 bg-rose-500/[.08] text-rose-100'
          }`}
        >
          {result.success ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>
            {result.message}
            {result.url && (
              <>
                {' '}
                <a href={result.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                  Xem bài
                </a>
              </>
            )}
          </span>
        </div>
      )}
    </section>
  );
};

export default PublishPanel;
