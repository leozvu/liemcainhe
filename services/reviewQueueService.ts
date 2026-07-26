import { ProjectState } from '../types';
import { ReviewDecision, SavedArticle } from '../types/content';
import { AGENCY_REVIEW_ROLES, getAgencyReviewSummary } from './agencyReviewService';
import { ArticleStore, listArticles, saveArticle } from './content/articleLibraryService';
import { getAllProjectsMetadata } from './storageService';

/**
 * Bàn duyệt — một hàng đợi cho mọi thứ đang chờ quyết.
 *
 * Trước đây việc duyệt nằm rải rác: xác nhận đăng ở Xưởng Nội dung, vòng duyệt
 * shot trong từng dự án, cổng khách hàng riêng. Không có chỗ nào nhìn thấy tất
 * cả, nên người phụ trách phải tự nhớ còn gì chưa xử lý.
 *
 * Nguyên tắc thiết kế: **mỗi dòng phải đủ ngữ cảnh để quyết mà không cần mở
 * ra**. Vì vậy mỗi mục mang theo các tín hiệu tự động đã chạy sẵn; mở chi tiết
 * chỉ dành cho trường hợp cần xem kỹ.
 */

export type ReviewItemKind = 'article' | 'video';

export interface ReviewSignal {
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail?: string;
  /**
   * Chỉ là thông tin, không phải điều đáng bận tâm.
   *
   * Phân biệt hai thứ hay bị gộp làm một: "vòng kiểm đã chạy và thấy có vấn
   * đề" khác hẳn "vòng kiểm đã chạy và báo lại một sự thật trung tính". Bài
   * đăng Facebook không có ảnh minh hoạ là chuyện bình thường — nói ra thì
   * hữu ích, nhưng bắt người duyệt mở từng bài vì nó thì vô nghĩa.
   *
   * Tín hiệu advisory không làm mục mất quyền duyệt hàng loạt.
   */
  advisory?: boolean;
}

export interface ReviewQueueItem {
  /** Khoá duy nhất trong hàng đợi, gồm cả loại để không đụng id giữa hai nguồn. */
  id: string;
  kind: ReviewItemKind;
  /** Id gốc trong kho của nó, dùng khi ghi quyết định. */
  sourceId: string;
  title: string;
  projectId?: string;
  projectTitle?: string;
  updatedAt: number;
  decision: ReviewDecision;
  signals: ReviewSignal[];
  /** Có tín hiệu hỏng: không cho duyệt cho tới khi sửa. */
  blocked: boolean;
  note?: string;
}

export const REVIEW_KIND_LABELS: Record<ReviewItemKind, string> = {
  article: 'Bài viết',
  video: 'Video',
};

/** Tín hiệu Brand Kit của một bài viết, lấy từ bản chụp lúc lưu. */
const articleSignals = (article: SavedArticle): ReviewSignal[] => {
  const compliance = article.compliance;
  const signals: ReviewSignal[] = [];

  // Không thoát sớm khi thiếu Brand Kit: các tín hiệu còn lại vẫn có giá trị,
  // và thiếu chúng thì người duyệt phải mở bài ra mới quyết được.
  if (!compliance) {
    signals.push({
      label: 'Brand Kit',
      status: 'warn',
      detail: 'Chưa kiểm — dự án không có Brand Kit',
    });
  } else {
    signals.push({
      label: 'Brand Kit',
      status: compliance.passed ? 'pass' : 'fail',
      detail: compliance.passed ? `${compliance.score}/100` : compliance.violations.join('; '),
    });

    if (compliance.passed && compliance.warnings.length) {
      signals.push({ label: 'Lưu ý', status: 'warn', detail: compliance.warnings.join('; ') });
    }
  }

  const words = article.draft.sections.reduce(
    (total, section) => total + section.body.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
  const target = article.brief.targetWords;
  // Lệch quá một phần ba so với yêu cầu thì đáng nhắc, vì thường là dấu hiệu
  // mô hình bỏ sót ý hoặc viết lan man.
  if (target && Math.abs(words - target) / target > 0.34) {
    signals.push({
      label: 'Độ dài',
      status: 'warn',
      detail: `${words} chữ, yêu cầu khoảng ${target}`,
    });
  }

  const rendered = article.draft.illustrations?.filter((item) => item.status === 'done').length ?? 0;
  signals.push({
    label: 'Ảnh',
    status: rendered > 0 ? 'pass' : 'warn',
    detail: rendered > 0 ? `${rendered} ảnh` : 'Chưa có ảnh nào',
    // Bài đăng dạng chữ thì không có ảnh là bình thường. Nói ra để người duyệt
    // biết, nhưng không vì thế mà bắt mở từng bài.
    advisory: rendered === 0,
  });

  return signals;
};

/**
 * Tín hiệu của một vòng duyệt video.
 *
 * Dùng lại `getAgencyReviewSummary` sẵn có thay vì đọc lại cấu trúc vòng duyệt,
 * để bàn duyệt không phải biết gì về cách video được duyệt bên trong.
 */
const videoSignals = (project: ProjectState): { signals: ReviewSignal[]; decision: ReviewDecision } => {
  const summary = getAgencyReviewSummary(project);
  const round = summary.activeRound;

  if (!round) return { signals: [], decision: 'pending' };

  const signals: ReviewSignal[] = [
    {
      label: 'Cổng nội bộ',
      status: summary.approvedGates === AGENCY_REVIEW_ROLES.length ? 'pass' : 'warn',
      detail: `${summary.approvedGates}/${AGENCY_REVIEW_ROLES.length} đã duyệt${
        summary.nextRole ? ` — chờ ${summary.nextRole}` : ''
      }`,
    },
  ];

  if (summary.stale) {
    signals.push({
      label: 'Đã lỗi thời',
      status: 'fail',
      detail: 'Nội dung đổi sau khi mở vòng duyệt, cần mở vòng mới',
    });
  }

  const changesRequested = round.gates.filter((gate) => gate.status === 'changes-requested');
  if (changesRequested.length) {
    signals.push({
      label: 'Yêu cầu sửa',
      status: 'fail',
      detail: changesRequested.map((gate) => gate.role).join(', '),
    });
  }

  const decision: ReviewDecision = changesRequested.length
    ? 'changes-requested'
    : summary.approvedGates === AGENCY_REVIEW_ROLES.length && !summary.stale
      ? 'approved'
      : 'pending';

  return { signals, decision };
};

export interface QueueSources {
  articles?: () => Promise<SavedArticle[]>;
  projects?: () => Promise<ProjectState[]>;
}

/** Dựng hàng đợi từ mọi nguồn, mới nhất trước. */
export const buildReviewQueue = async (sources: QueueSources = {}): Promise<ReviewQueueItem[]> => {
  const readArticles = sources.articles ?? (() => listArticles());
  const readProjects = sources.projects ?? (() => getAllProjectsMetadata());

  const [articles, projects] = await Promise.all([
    readArticles().catch(() => [] as SavedArticle[]),
    readProjects().catch(() => [] as ProjectState[]),
  ]);

  const items: ReviewQueueItem[] = [];

  for (const article of articles) {
    const signals = articleSignals(article);
    items.push({
      id: `article:${article.id}`,
      kind: 'article',
      sourceId: article.id,
      title: article.title,
      projectId: article.projectId,
      projectTitle: article.projectTitle,
      updatedAt: article.updatedAt,
      decision: article.review?.decision ?? 'pending',
      note: article.review?.note,
      signals,
      blocked: signals.some((signal) => signal.status === 'fail'),
    });
  }

  for (const project of projects) {
    if (!project.agencyReview?.rounds?.length) continue;
    const { signals, decision } = videoSignals(project);
    const round = getAgencyReviewSummary(project).activeRound;
    if (!round) continue;

    items.push({
      id: `video:${project.id}:${round.id}`,
      kind: 'video',
      sourceId: round.id,
      title: round.label || project.title,
      projectId: project.id,
      projectTitle: project.title,
      updatedAt: round.updatedAt,
      decision,
      signals,
      blocked: signals.some((signal) => signal.status === 'fail'),
    });
  }

  return items.sort((left, right) => right.updatedAt - left.updatedAt);
};

/** Lọc theo trạng thái quyết định. */
export const filterQueue = (
  items: ReviewQueueItem[],
  filter: 'all' | ReviewDecision,
): ReviewQueueItem[] => (filter === 'all' ? items : items.filter((item) => item.decision === filter));

export interface QueueCounts {
  total: number;
  pending: number;
  approved: number;
  changesRequested: number;
  blocked: number;
}

export const countQueue = (items: ReviewQueueItem[]): QueueCounts => ({
  total: items.length,
  pending: items.filter((item) => item.decision === 'pending').length,
  approved: items.filter((item) => item.decision === 'approved').length,
  changesRequested: items.filter((item) => item.decision === 'changes-requested').length,
  blocked: items.filter((item) => item.blocked).length,
});

/* ────────────────────────  Duyệt hàng loạt  ──────────────────────── */

/**
 * Vì sao cần duyệt hàng loạt.
 *
 * Với hai mươi tài khoản đăng hằng ngày là khoảng 140 lượt duyệt mỗi tuần.
 * Duyệt từng bài một thì người duyệt sẽ bắt đầu bấm mà không đọc — và lúc đó
 * cổng duyệt còn tệ hơn không có, vì nó tạo cảm giác an toàn giả.
 *
 * Nhưng "duyệt tất cả" mù cũng chính là cái bẫy đó. Nên quy tắc ở đây:
 * **chỉ những mục mà mọi vòng kiểm tự động đều sạch mới được duyệt hàng loạt.**
 * Mục nào có cảnh báo là mục mà máy đang phân vân — đúng chỗ cần mắt người, và
 * phải quyết riêng.
 *
 * Kết quả: sự chú ý của người duyệt dồn vào đúng phần máy không chắc, thay vì
 * rải đều lên cả trăm mục mà phần lớn không có gì để xem.
 */
export interface BatchPartition {
  /** Sạch mọi tín hiệu, duyệt hàng loạt được. */
  eligible: ReviewQueueItem[];
  /** Có cảnh báo hoặc bị chặn — phải mở ra quyết từng cái. */
  needsAttention: ReviewQueueItem[];
}

export const partitionForBatch = (items: ReviewQueueItem[]): BatchPartition => {
  const eligible: ReviewQueueItem[] = [];
  const needsAttention: ReviewQueueItem[] = [];

  items.forEach((item) => {
    if (item.decision !== 'pending') return;

    const decisive = item.signals.filter((signal) => !signal.advisory);
    const clean =
      item.kind === 'article' &&
      !item.blocked &&
      decisive.length > 0 &&
      decisive.every((signal) => signal.status === 'pass');

    if (clean) eligible.push(item);
    else needsAttention.push(item);
  });

  return { eligible, needsAttention };
};

export interface BatchDecisionResult {
  itemId: string;
  title: string;
  ok: boolean;
  error?: string;
}

/**
 * Ghi quyết định cho nhiều bài một lượt.
 *
 * Một bài hỏng không làm dừng các bài còn lại: người duyệt vừa bỏ ra vài phút
 * đọc cả nhóm, mất hết công vì một bản ghi lỗi là cách chắc chắn khiến lần sau
 * họ không dùng nữa.
 *
 * Vẫn đi qua `decideArticle` nên mọi hàng rào của nó còn nguyên — bài vi phạm
 * Brand Kit vẫn bị chặn kể cả khi lọt vào danh sách.
 */
export const decideBatch = async (
  items: ReviewQueueItem[],
  decision: ReviewDecision,
  options: {
    reviewer?: string;
    note?: string;
    now?: () => number;
    store?: ArticleStore;
    /** Nạp bài từ thư viện. Thay được khi kiểm thử. */
    loadArticles?: () => Promise<SavedArticle[]>;
  } = {},
): Promise<BatchDecisionResult[]> => {
  const load = options.loadArticles ?? (() => listArticles(options.store));
  const articles = await load();
  const byId = new Map(articles.map((article) => [article.id, article]));

  const results: BatchDecisionResult[] = [];

  for (const item of items) {
    if (item.kind !== 'article') {
      results.push({
        itemId: item.id,
        title: item.title,
        ok: false,
        error: 'Video duyệt trong Trung tâm sản xuất của dự án.',
      });
      continue;
    }

    const article = byId.get(item.sourceId);
    if (!article) {
      results.push({ itemId: item.id, title: item.title, ok: false, error: 'Không tìm thấy bài trong thư viện.' });
      continue;
    }

    try {
      await decideArticle(article, decision, {
        reviewer: options.reviewer,
        note: options.note,
        now: options.now,
        store: options.store,
      });
      results.push({ itemId: item.id, title: item.title, ok: true });
    } catch (error) {
      results.push({
        itemId: item.id,
        title: item.title,
        ok: false,
        error: error instanceof Error ? error.message : 'Không ghi được quyết định.',
      });
    }
  }

  return results;
};

/* ──────────────────────────  Gom nhóm  ─────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface QueueGroup {
  key: string;
  label: string;
  items: ReviewQueueItem[];
}

/** Gom theo ngày, mới nhất trước, để nhìn ra tải của từng hôm. */
export const groupQueueByDay = (items: ReviewQueueItem[], now = Date.now()): QueueGroup[] => {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const groups = new Map<string, ReviewQueueItem[]>();

  items.forEach((item) => {
    const day = new Date(item.updatedAt).setHours(0, 0, 0, 0);
    const key = String(day);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });

  return Array.from(groups.entries())
    .sort((left, right) => Number(right[0]) - Number(left[0]))
    .map(([key, groupItems]) => {
      const day = Number(key);
      const diffDays = Math.round((startOfToday - day) / DAY_MS);
      const label =
        diffDays === 0
          ? 'Hôm nay'
          : diffDays === 1
            ? 'Hôm qua'
            : new Date(day).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
      return { key, label, items: groupItems };
    });
};

/** Gom theo dự án, để duyệt trọn một khách hàng một lượt. */
export const groupQueueByProject = (items: ReviewQueueItem[]): QueueGroup[] => {
  const groups = new Map<string, ReviewQueueItem[]>();

  items.forEach((item) => {
    const key = item.projectId ?? '';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });

  return Array.from(groups.entries())
    .map(([key, groupItems]) => ({
      key,
      label: groupItems[0]?.projectTitle || 'Không thuộc dự án nào',
      items: groupItems,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'vi'));
};

/**
 * Ghi quyết định cho một bài viết.
 *
 * Không cho duyệt mục đang bị chặn: chặn nghĩa là có tín hiệu hỏng chắc chắn,
 * ví dụ bài chứa từ cấm của khách. Duyệt qua nó là đúng thứ bàn duyệt sinh ra
 * để ngăn.
 */
export const decideArticle = async (
  article: SavedArticle,
  decision: ReviewDecision,
  options: {
    reviewer?: string;
    note?: string;
    now?: () => number;
    /** Cho phép thay lớp lưu trữ khi kiểm thử. */
    store?: ArticleStore;
  } = {},
): Promise<SavedArticle> => {
  if (decision === 'approved' && article.compliance && !article.compliance.passed) {
    throw new Error('Bài đang vi phạm Brand Kit, phải sửa trước khi duyệt.');
  }

  const now = (options.now ?? Date.now)();
  const updated: SavedArticle = {
    ...article,
    review: { decision, reviewer: options.reviewer, note: options.note, decidedAt: now },
  };

  await saveArticle(updated.draft, updated.brief, {
    store: options.store,
    existingId: updated.id,
    projectId: updated.projectId,
    projectTitle: updated.projectTitle,
    now: () => now,
    review: updated.review,
    compliance: updated.compliance,
  });

  return updated;
};
