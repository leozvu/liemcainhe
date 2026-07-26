import { ContentApproach, ContentVoice, SavedArticle } from '../../types/content';
import { PublishLedgerEntry, fingerprintPost } from './publishLedgerService';
import { CHANNEL_LIMITS, toPostText } from './publishService';
import { engagementRate } from './insightsService';
import { getApproach, getVoice } from './contentAxes';

/**
 * Trí nhớ theo khách hàng.
 *
 * Brand Kit là bộ quy tắc **người nhập**. Lớp này giữ thứ quan trọng hơn: cái
 * gì **thực sự đã được duyệt** và cái gì **thực sự chạy tốt**.
 *
 * Không cần thu thập dữ liệu mới. Bàn duyệt đã ghi mọi quyết định kèm lý do
 * người duyệt viết, và lớp số liệu đã ghi lượt tiếp cận của bài đã đăng. Việc
 * ở đây chỉ là đọc và biến chúng thành ngữ cảnh cho prompt.
 *
 * Gom theo **khách** chứ không theo dự án: một khách chạy nhiều chiến dịch, và
 * bài học từ chiến dịch trước phải dùng được cho chiến dịch sau.
 */

export interface MemoryExample {
  articleId: string;
  title: string;
  sapo: string;
  /** Một đoạn tiêu biểu, đủ để model bắt được giọng mà không tốn quá nhiều token. */
  excerpt: string;
  approach: ContentApproach;
  voice: ContentVoice;
  /** Tỷ lệ tương tác, nếu bài đã đăng và đã đọc được số liệu. */
  engagementRate?: number;
}

export interface MemoryRejection {
  articleId: string;
  title: string;
  /** Lý do người duyệt ghi khi bấm "Yêu cầu sửa". Đây là tín hiệu quý nhất. */
  reason: string;
}

export interface ClientMemory {
  clientId?: string;
  /** Bài đã duyệt, xếp bài chạy tốt lên trước. */
  approved: MemoryExample[];
  rejected: MemoryRejection[];
  /** Tổng số bài đã duyệt, kể cả những bài không lọt vào danh sách mẫu. */
  approvedCount: number;
  rejectedCount: number;
}

/**
 * Số mẫu đưa vào prompt.
 *
 * Cố ý ít. Nhồi hai mươi bài mẫu vừa tốn token vừa làm loãng: model bắt đầu
 * trộn giọng của tất cả thay vì học một giọng nhất quán.
 */
export const MAX_EXAMPLES = 3;
export const MAX_REJECTIONS = 4;

/** Cắt một đoạn tiêu biểu, ưu tiên mục đầu vì đó thường là chỗ định giọng. */
const excerptOf = (article: SavedArticle, limit = 320): string => {
  const body = article.draft.sections[0]?.body?.trim() ?? '';
  if (body.length <= limit) return body;
  const cut = body.slice(0, limit);
  const stop = cut.lastIndexOf('. ');
  return stop > limit * 0.5 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
};

/**
 * Tỷ lệ tương tác của một bài, tra qua nhật ký đăng bài.
 *
 * Đối chiếu bằng vân tay nội dung, cùng cách `findPublishRecords` làm, nên
 * không cần lưu thêm quan hệ nào giữa thư viện và nhật ký.
 */
export const findEngagementRate = (
  article: SavedArticle,
  ledger: PublishLedgerEntry[],
): number | undefined => {
  const rates: number[] = [];

  for (const entry of ledger) {
    if (entry.status !== 'success' || !entry.insights) continue;
    const limit = CHANNEL_LIMITS[entry.channelId];
    if (!limit) continue;
    if (fingerprintPost(entry.channelId, entry.accountId, toPostText(article.draft, limit)) !== entry.fingerprint) {
      continue;
    }
    const rate = engagementRate(entry.insights);
    if (rate !== undefined) rates.push(rate);
  }

  return rates.length ? Math.max(...rates) : undefined;
};

export interface BuildMemoryOptions {
  clientId?: string;
  ledger?: PublishLedgerEntry[];
}

/**
 * Dựng trí nhớ cho một khách từ thư viện bài viết.
 *
 * Bài chưa gắn khách thì gom theo dự án, để dữ liệu cũ vẫn dùng được thay vì
 * bị bỏ đi.
 */
export const buildClientMemory = (
  articles: SavedArticle[],
  options: BuildMemoryOptions = {},
): ClientMemory => {
  const ledger = options.ledger ?? [];
  const scope = options.clientId
    ? articles.filter((article) => article.clientId === options.clientId)
    : articles;

  const approvedArticles = scope.filter((article) => article.review?.decision === 'approved');
  const rejectedArticles = scope.filter((article) => article.review?.decision === 'changes-requested');

  const approved: MemoryExample[] = approvedArticles
    .map((article) => ({
      articleId: article.id,
      title: article.title,
      sapo: article.draft.sapo,
      excerpt: excerptOf(article),
      approach: article.brief.approach,
      voice: article.brief.voice,
      engagementRate: findEngagementRate(article, ledger),
    }))
    // Bài đã đo được hiệu quả xếp trước, trong đó bài tương tác cao lên đầu.
    // Bài chưa đo được thì xếp sau nhưng vẫn dùng, vì có mẫu còn hơn không.
    .sort((left, right) => {
      const a = left.engagementRate ?? -1;
      const b = right.engagementRate ?? -1;
      if (a !== b) return b - a;
      return left.title.localeCompare(right.title, 'vi');
    })
    .slice(0, MAX_EXAMPLES);

  const rejected: MemoryRejection[] = rejectedArticles
    .filter((article) => article.review?.note?.trim())
    .map((article) => ({
      articleId: article.id,
      title: article.title,
      reason: article.review!.note!.trim(),
    }))
    .slice(0, MAX_REJECTIONS);

  return {
    clientId: options.clientId,
    approved,
    rejected,
    approvedCount: approvedArticles.length,
    rejectedCount: rejectedArticles.length,
  };
};

/**
 * Số quyết định tối thiểu trước khi trí nhớ được phép tác động vào prompt.
 *
 * Bản đầu **không có ngưỡng nào**: bài được duyệt đầu tiên đã đi thẳng vào
 * prompt của bài thứ hai. Một quyết định thì chưa phải khuôn mẫu — nó có thể
 * là bài duyệt vội, hoặc duyệt vì deadline. Học từ nó rồi đưa vào mọi bài sau
 * là tự nhân bản một mẫu ngẫu nhiên.
 *
 * Dưới ngưỡng: trí nhớ vẫn được thu thập và hiện ra cho người dùng xem, nhưng
 * `buildMemoryPromptContext` trả chuỗi rỗng — không tác động gì.
 */
export const MIN_MEMORY_DECISIONS = 10;

/** Trí nhớ có gì để hiện cho người dùng xem không. */
export const hasMemory = (memory: ClientMemory): boolean =>
  memory.approved.length > 0 || memory.rejected.length > 0;

/**
 * Số quyết định đã có, dùng cho cả ngưỡng lẫn chỗ hiện tiến độ.
 *
 * Dùng `rejectedCount` chứ không phải `rejected.length`: danh sách `rejected`
 * đã bị cắt còn `MAX_REJECTIONS` mẫu đưa vào prompt. Đếm theo nó thì mười lần
 * bị từ chối chỉ tính thành bốn, và ngưỡng khó đạt hơn dự định mà không ai
 * hiểu vì sao.
 */
export const memorySampleCount = (memory: ClientMemory): number =>
  memory.approvedCount + memory.rejectedCount;

/**
 * Trí nhớ đã đủ mẫu để tác động vào prompt chưa.
 *
 * Tách khỏi `hasMemory` có chủ ý: "có gì để xem" và "đủ căn cứ để dùng" là hai
 * câu hỏi khác nhau, và gộp chúng chính là lỗi của bản đầu.
 */
export const isMemoryActionable = (memory: ClientMemory): boolean =>
  memorySampleCount(memory) >= MIN_MEMORY_DECISIONS;

/**
 * Biến trí nhớ thành khối ngữ cảnh cho prompt.
 *
 * Đặt phần đã duyệt trước phần bị từ chối: model bám mẫu tích cực tốt hơn bám
 * lệnh cấm, và lệnh cấm đứng cuối thì nằm gần chỗ nó phải áp dụng nhất.
 */
export const buildMemoryPromptContext = (memory: ClientMemory): string => {
  // Chưa đủ mẫu thì không tác động vào prompt. Trí nhớ vẫn tồn tại và vẫn hiện
  // ra được cho người dùng — chỉ là chưa được quyền điều khiển.
  if (!isMemoryActionable(memory)) return '';

  const parts: string[] = ['TRÍ NHỚ VỀ KHÁCH HÀNG NÀY — học từ những gì đã thực sự được duyệt:'];

  if (memory.approved.length) {
    parts.push('', `Đã duyệt ${memory.approvedCount} bài. Vài bài tiêu biểu:`);
    for (const example of memory.approved) {
      const perf = example.engagementRate !== undefined
        ? ` — đạt ${example.engagementRate}% tương tác`
        : '';
      parts.push(
        '',
        `• "${example.title}"${perf}`,
        `  Góc tiếp cận: ${getApproach(example.approach).label}. Giọng: ${getVoice(example.voice).label}.`,
        `  Mở bài: ${example.sapo}`,
        `  Trích: ${example.excerpt}`,
      );
    }
    parts.push('', 'Hãy viết theo đúng mạch và giọng của những bài trên. Đó là thứ khách này đã gật đầu.');
  }

  if (memory.rejected.length) {
    parts.push('', 'Những điều khách này đã từng yêu cầu sửa — tuyệt đối tránh lặp lại:');
    for (const item of memory.rejected) {
      parts.push(`• ${item.reason}`);
    }
  }

  return parts.join('\n');
};

/** Một dòng tóm tắt để hiện trong giao diện. */
export const describeMemory = (memory: ClientMemory): string => {
  if (!hasMemory(memory)) return 'Chưa có bài nào được duyệt để học.';

  const parts = [`học từ ${memory.approvedCount} bài đã duyệt`];
  if (memory.rejectedCount) parts.push(`${memory.rejectedCount} lần bị yêu cầu sửa`);

  const measured = memory.approved.filter((item) => item.engagementRate !== undefined).length;
  if (measured) parts.push(`${measured} bài có số liệu hiệu quả`);

  return `Đang ${parts.join(', ')}.`;
};
