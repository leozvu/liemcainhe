import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, FolderOpen, Save, Search, Trash2 } from 'lucide-react';
import { BrandKit } from '../../types';
import { ArticleDraft, ContentBrief, ReviewDecision, SavedArticle } from '../../types/content';
import { inspectBrandCompliance } from '../../services/brandKitService';
import { articleToMarkdown } from '../../services/content/articleService';
import {
  findPublishRecords,
  listArticles,
  removeArticle,
  saveArticle,
  searchArticles,
} from '../../services/content/articleLibraryService';
import {
  PublishLedgerEntry,
  readPublishHistory,
  refreshInsights,
} from '../../services/content/publishLedgerService';
import { describeInsights } from '../../services/content/insightsService';
import { getPublishChannel } from '../../services/content/publishChannels';
import { getPublishSecret } from '../../services/credentialVault';
import { listAccounts } from '../../services/content/managedAccountService';

interface Props {
  /** Bài đang mở, để lưu vào thư viện. Không có thì chỉ xem lại bài cũ. */
  draft: ArticleDraft | null;
  brief: ContentBrief;
  projectId: string;
  projectTitle: string;
  /** Khách hàng của dự án, để trí nhớ gom bài theo khách. */
  clientId?: string;
  brandKit?: BrandKit | null;
  onLoad: (article: SavedArticle) => void;
  /** Báo cho màn hình cha biết quyết định duyệt của bản đang mở. */
  onReviewChange?: (decision: ReviewDecision | undefined) => void;
}

/**
 * Thư viện bài viết.
 *
 * Tách khỏi dự án nên tìm lại được bài cũ kể cả khi dự án đã đóng. Cột trạng
 * thái đăng đối chiếu với nhật ký đăng bài bằng vân tay nội dung, không lưu
 * thêm quan hệ nào giữa hai kho.
 */
const ArticleLibrary: React.FC<Props> = ({
  draft,
  brief,
  projectId,
  projectTitle,
  clientId,
  brandKit,
  onLoad,
  onReviewChange,
}) => {
  const [articles, setArticles] = useState<SavedArticle[]>([]);
  const [ledger, setLedger] = useState<PublishLedgerEntry[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const refresh = async () => {
    setArticles(await listArticles());
    setLedger(await readPublishHistory());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const visible = useMemo(() => searchArticles(articles, query), [articles, query]);

  const handleSave = async () => {
    if (!draft) return;
    setBusy(true);
    setNotice(null);
    try {
      // Chụp kết quả kiểm Brand Kit ngay lúc lưu, vì bàn duyệt nhìn nhiều dự án
      // cùng lúc và không cầm được Brand Kit của từng dự án.
      const compliance = brandKit
        ? inspectBrandCompliance(articleToMarkdown(draft), brandKit)
        : undefined;

      const saved = await saveArticle(draft, brief, {
        projectId,
        projectTitle,
        clientId,
        compliance,
      });
      await refresh();
      onReviewChange?.(saved.review?.decision);
      setNotice(
        compliance && !compliance.passed
          ? `Đã lưu “${saved.title}”, nhưng bài đang vi phạm Brand Kit nên bàn duyệt sẽ chặn.`
          : `Đã lưu “${saved.title}” vào thư viện. Sang Trung tâm vận hành → Bàn duyệt để duyệt.`,
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * Đọc lại bản mới nhất ngay trước khi mở.
   *
   * Danh sách trong màn hình này được nạp lúc mở, còn quyết định duyệt lại
   * diễn ra ở Bàn duyệt sau đó. Dùng bản đang giữ trong bộ nhớ sẽ mở ra một
   * bài thiếu dấu đã duyệt, và nút đăng không mở khoá dù bài đã được duyệt.
   */
  const handleOpen = async (article: SavedArticle) => {
    const fresh = (await listArticles()).find((row) => row.id === article.id) ?? article;
    onLoad(fresh);
    await refresh();
  };

  /**
   * Đọc số liệu về cho mọi bài đã đăng.
   *
   * Tra token theo đúng tài khoản đã đăng bài đó. Bản ghi trong sổ cái giữ
   * `accountId` của nền tảng, còn kho khoá lưu theo id nội bộ, nên phải đi qua
   * sổ tài khoản để bắc cầu. Tài khoản đã gỡ thì không còn token — bản ghi ghi
   * rõ lý do thay vì im lặng bỏ qua.
   */
  const handleRefreshInsights = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const accounts = await listAccounts();
      await refreshInsights((channelId, accountId) => {
        const account = accounts.find(
          (item) => item.channelId === channelId && item.externalId === accountId,
        );
        return account ? getPublishSecret(account.id) : {};
      });
      await refresh();
      setNotice('Đã đọc lại số liệu của các bài đã đăng.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    await removeArticle(id);
    setConfirmingDelete(null);
    await refresh();
  };

  return (
    <section className="eg-panel mt-6 p-5" aria-labelledby="library-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="library-heading" className="text-sm font-semibold text-white">Thư viện bài viết</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Dùng chung cho cả workspace. Bài cũ vẫn tìm lại được sau khi dự án đóng.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="eg-button-secondary min-h-11 px-4"
            onClick={() => void handleRefreshInsights()}
            disabled={busy}
            title="Đọc lượt tiếp cận và tương tác của các bài đã đăng"
          >
            <BarChart3 className={`mr-2 inline h-4 w-4 ${busy ? 'animate-pulse' : ''}`} />Đọc số liệu
          </button>
          <button
            type="button"
            className="eg-button-secondary min-h-11 px-4"
            onClick={() => void handleSave()}
            disabled={!draft || busy}
            title={draft ? 'Lưu bài đang mở vào thư viện' : 'Chưa có bài nào để lưu'}
          >
            <Save className="mr-2 inline h-4 w-4" />Lưu bài đang mở
          </button>
        </div>
      </div>

      {notice && (
        <p role="status" className="mt-4 rounded-xl border border-emerald-300/25 bg-emerald-400/[.07] px-4 py-3 text-sm text-emerald-100">
          {notice}
        </p>
      )}

      {articles.length > 0 && (
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" />
          <input
            className="eg-input w-full pl-10"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm theo tiêu đề, chủ đề, hashtag — không cần bỏ dấu"
            aria-label="Tìm bài trong thư viện"
          />
        </div>
      )}

      {articles.length === 0 ? (
        <p className="mt-5 text-sm text-zinc-500">
          Thư viện đang trống. Viết một bài rồi bấm <strong className="text-zinc-400">Lưu bài đang mở</strong>.
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-5 text-sm text-zinc-500">Không có bài nào khớp “{query}”.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {visible.map((article) => {
            const published = findPublishRecords(article, ledger);
            return (
              <li key={article.id} className="rounded-xl border border-white/[.07] bg-black/15 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-zinc-200">{article.title}</div>
                    <div className="eg-mono mt-1 flex flex-wrap gap-x-3 text-[10px] uppercase tracking-wider text-zinc-600">
                      <span>{new Date(article.updatedAt).toLocaleString('vi-VN')}</span>
                      <span>{article.draft.sections.length} mục</span>
                      {article.projectTitle && <span className="truncate">{article.projectTitle}</span>}
                    </div>
                    {published.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {published.map((entry) => (
                          <div key={entry.fingerprint} className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-400/[.07] px-2 py-0.5 text-[10px] text-emerald-100">
                              <CheckCircle2 className="h-3 w-3" />
                              {getPublishChannel(entry.channelId)?.label ?? entry.channelId}
                            </span>
                            <span
                              className={`text-[10px] ${
                                entry.insights && !entry.insights.unavailable
                                  ? 'text-cyan-100/70'
                                  : 'text-zinc-600'
                              }`}
                            >
                              {entry.insights ? describeInsights(entry.insights) : 'Chưa đọc số liệu'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="eg-button-secondary min-h-11 px-3 text-xs"
                      onClick={() => void handleOpen(article)}
                    >
                      <FolderOpen className="mr-1.5 inline h-3.5 w-3.5" />Mở
                    </button>
                    <button
                      type="button"
                      className="eg-icon-button flex h-11 w-11 items-center justify-center"
                      onClick={() => setConfirmingDelete(article.id)}
                      aria-label={`Xoá ${article.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {confirmingDelete === article.id && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t eg-divider pt-3">
                    <span className="text-xs text-zinc-300">Xoá khỏi thư viện? Không khôi phục được.</span>
                    <button
                      type="button"
                      className="eg-button-secondary min-h-11 px-3 text-xs"
                      onClick={() => void handleDelete(article.id)}
                    >
                      Xoá
                    </button>
                    <button
                      type="button"
                      className="eg-button-secondary min-h-11 px-3 text-xs"
                      onClick={() => setConfirmingDelete(null)}
                    >
                      Huỷ
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default ArticleLibrary;
