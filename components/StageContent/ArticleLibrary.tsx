import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FolderOpen, Save, Search, Trash2 } from 'lucide-react';
import { ArticleDraft, ContentBrief, SavedArticle } from '../../types/content';
import {
  findPublishRecords,
  listArticles,
  removeArticle,
  saveArticle,
  searchArticles,
} from '../../services/content/articleLibraryService';
import { PublishLedgerEntry, readPublishHistory } from '../../services/content/publishLedgerService';
import { getPublishChannel } from '../../services/content/publishChannels';

interface Props {
  /** Bài đang mở, để lưu vào thư viện. Không có thì chỉ xem lại bài cũ. */
  draft: ArticleDraft | null;
  brief: ContentBrief;
  projectId: string;
  projectTitle: string;
  onLoad: (article: SavedArticle) => void;
}

/**
 * Thư viện bài viết.
 *
 * Tách khỏi dự án nên tìm lại được bài cũ kể cả khi dự án đã đóng. Cột trạng
 * thái đăng đối chiếu với nhật ký đăng bài bằng vân tay nội dung, không lưu
 * thêm quan hệ nào giữa hai kho.
 */
const ArticleLibrary: React.FC<Props> = ({ draft, brief, projectId, projectTitle, onLoad }) => {
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
      const saved = await saveArticle(draft, brief, { projectId, projectTitle });
      await refresh();
      setNotice(`Đã lưu “${saved.title}” vào thư viện.`);
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
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {published.map((entry) => (
                          <span key={entry.fingerprint} className="inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-400/[.07] px-2 py-0.5 text-[10px] text-emerald-100">
                            <CheckCircle2 className="h-3 w-3" />
                            {getPublishChannel(entry.channelId)?.label ?? entry.channelId}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="eg-button-secondary min-h-11 px-3 text-xs"
                      onClick={() => onLoad(article)}
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
