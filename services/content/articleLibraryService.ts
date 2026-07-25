import { ArticleDraft, ContentBrief, SavedArticle } from '../../types/content';
import {
  deleteArticleFromLibrary,
  getArticleLibrary,
  saveArticleToLibrary,
} from '../storageService';
import { PublishLedgerEntry, fingerprintPost } from './publishLedgerService';
import { CHANNEL_LIMITS, toPostText } from './publishService';

/**
 * Thư viện bài viết.
 *
 * Trước đây mỗi dự án chỉ giữ được một bài và không có lịch sử. Thư viện tách
 * riêng khỏi dự án nên tìm lại được bài cũ kể cả khi dự án đã đóng, và dùng
 * lại được bài hay cho khách khác.
 */

/** Cho phép thay lớp lưu trữ khi kiểm thử. */
export interface ArticleStore {
  readAll: () => Promise<SavedArticle[]>;
  put: (article: SavedArticle) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const indexedDbStore: ArticleStore = {
  readAll: () => getArticleLibrary<SavedArticle>(),
  put: (article) => saveArticleToLibrary(article),
  remove: (id) => deleteArticleFromLibrary(id),
};

export interface SaveArticleOptions {
  store?: ArticleStore;
  now?: () => number;
  projectId?: string;
  projectTitle?: string;
  /** Ghi đè bài đã có thay vì tạo bản mới. */
  existingId?: string;
}

const makeId = (now: number): string =>
  `art_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const saveArticle = async (
  draft: ArticleDraft,
  brief: ContentBrief,
  options: SaveArticleOptions = {},
): Promise<SavedArticle> => {
  const store = options.store ?? indexedDbStore;
  const now = (options.now ?? Date.now)();

  // Giữ nguyên thời điểm tạo khi ghi đè, để thứ tự trong thư viện không nhảy.
  const existing = options.existingId
    ? (await store.readAll()).find((item) => item.id === options.existingId)
    : undefined;

  const article: SavedArticle = {
    id: existing?.id ?? options.existingId ?? makeId(now),
    title: draft.title || brief.topic || 'Bài chưa đặt tên',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    projectId: options.projectId,
    projectTitle: options.projectTitle,
    brief,
    draft,
  };

  await store.put(article);
  return article;
};

export const listArticles = async (store: ArticleStore = indexedDbStore): Promise<SavedArticle[]> => {
  try {
    const articles = await store.readAll();
    return articles.sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  }
};

export const removeArticle = async (
  id: string,
  store: ArticleStore = indexedDbStore,
): Promise<void> => store.remove(id);

/**
 * Tìm bài theo từ khoá.
 *
 * Bỏ dấu trước khi so, vì người dùng gõ tìm kiếm thường lười bỏ dấu và sẽ
 * không tìm ra gì nếu so khớp thô.
 */
const boDau = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');

export const searchArticles = (articles: SavedArticle[], query: string): SavedArticle[] => {
  const needle = boDau(query.trim());
  if (!needle) return articles;

  return articles.filter((article) => {
    const haystack = boDau(
      [
        article.title,
        article.brief.topic,
        article.projectTitle ?? '',
        article.draft.sapo,
        article.draft.hashtags.join(' '),
        ...article.draft.sections.map((section) => section.heading),
      ].join(' '),
    );
    return haystack.includes(needle);
  });
};

/**
 * Bài này đã được đăng ở đâu chưa.
 *
 * Đối chiếu với nhật ký đăng bài bằng chính vân tay nội dung, nên không cần
 * lưu thêm quan hệ nào giữa hai kho. Đổi lại: sửa bài sau khi đăng thì vân tay
 * đổi và bài sẽ hiện là chưa đăng — đúng về mặt nghĩa, vì bản đang nằm trong
 * thư viện quả thật chưa từng lên mạng.
 */
export const findPublishRecords = (
  article: SavedArticle,
  ledger: PublishLedgerEntry[],
): PublishLedgerEntry[] => {
  const matches: PublishLedgerEntry[] = [];

  for (const entry of ledger) {
    if (entry.status !== 'success') continue;
    const limit = CHANNEL_LIMITS[entry.channelId];
    if (!limit) continue;
    const text = toPostText(article.draft, limit);
    if (fingerprintPost(entry.channelId, entry.accountId, text) === entry.fingerprint) {
      matches.push(entry);
    }
  }

  return matches;
};
