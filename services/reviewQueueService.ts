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
