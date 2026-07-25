import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Film,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { ReviewDecision } from '../types/content';
import {
  REVIEW_KIND_LABELS,
  ReviewQueueItem,
  ReviewSignal,
  buildReviewQueue,
  countQueue,
  decideArticle,
  filterQueue,
} from '../services/reviewQueueService';
import { listArticles } from '../services/content/articleLibraryService';

/**
 * Bàn duyệt.
 *
 * Nguyên tắc: mỗi dòng phải đủ ngữ cảnh để quyết mà không cần mở ra. Các tín
 * hiệu tự động đã chạy sẵn được hiện thẳng trên dòng; người duyệt chỉ đọc và
 * bấm.
 */

const SIGNAL_STYLE: Record<ReviewSignal['status'], string> = {
  pass: 'border-emerald-300/25 bg-emerald-400/[.07] text-emerald-100',
  warn: 'border-amber-300/25 bg-amber-400/[.07] text-amber-100',
  fail: 'border-rose-300/30 bg-rose-500/[.09] text-rose-100',
};

const DECISION_META: Record<ReviewDecision, { label: string; icon: React.ReactNode; chip: string }> = {
  pending: {
    label: 'Chờ duyệt',
    icon: <Clock className="h-3.5 w-3.5" />,
    chip: 'border-white/[.1] bg-white/[.04] text-zinc-300',
  },
  approved: {
    label: 'Đã duyệt',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    chip: 'border-emerald-300/25 bg-emerald-400/[.08] text-emerald-100',
  },
  'changes-requested': {
    label: 'Yêu cầu sửa',
    icon: <XCircle className="h-3.5 w-3.5" />,
    chip: 'border-rose-300/30 bg-rose-500/[.09] text-rose-100',
  },
};

const FILTERS: { value: 'all' | ReviewDecision; label: string }[] = [
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'changes-requested', label: 'Yêu cầu sửa' },
  { value: 'approved', label: 'Đã duyệt' },
  { value: 'all', label: 'Tất cả' },
];

const ReviewDeskPanel: React.FC<{ isActive: boolean }> = ({ isActive }) => {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [filter, setFilter] = useState<'all' | ReviewDecision>('pending');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await buildReviewQueue());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isActive) void refresh();
  }, [isActive]);

  const counts = useMemo(() => countQueue(items), [items]);
  const visible = useMemo(() => filterQueue(items, filter), [items, filter]);

  const decide = async (item: ReviewQueueItem, decision: ReviewDecision, withNote?: string) => {
    if (item.kind !== 'article') {
      setError('Video duyệt trong Trung tâm sản xuất của dự án. Bàn duyệt chỉ hiện trạng thái.');
      return;
    }
    setError(null);
    try {
      const article = (await listArticles()).find((row) => row.id === item.sourceId);
      if (!article) throw new Error('Không tìm thấy bài trong thư viện.');
      await decideArticle(article, decision, { note: withNote });
      setNoteFor(null);
      setNote('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không ghi được quyết định.');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-sm text-zinc-400">
          Mọi thứ đang chờ quyết, gộp từ mọi dự án. Mỗi dòng mang sẵn kết quả các vòng kiểm tự động
          để quyết được ngay mà không cần mở ra.
        </p>
        <button type="button" className="eg-button-secondary min-h-11 px-4" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={`mr-2 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Làm mới
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-4 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
        <span>{counts.total} mục</span>
        <span className="text-zinc-300">{counts.pending} chờ duyệt</span>
        {counts.changesRequested > 0 && <span className="text-rose-300/80">{counts.changesRequested} cần sửa</span>}
        {counts.blocked > 0 && <span className="text-rose-300/80">{counts.blocked} bị chặn</span>}
        <span className="text-emerald-300/70">{counts.approved} đã duyệt</span>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-rose-300/30 bg-rose-500/[.08] px-4 py-3 text-sm text-rose-100">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            aria-pressed={filter === option.value}
            className={`min-h-11 rounded-xl border px-4 text-xs font-medium transition-colors ${
              filter === option.value
                ? 'border-cyan-200/25 bg-cyan-200/[.09] text-white'
                : 'border-white/[.07] text-zinc-400 hover:bg-white/[.035] hover:text-zinc-200'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">
          {items.length === 0
            ? 'Chưa có gì chờ duyệt. Lưu một bài vào thư viện hoặc mở vòng duyệt video để nó xuất hiện ở đây.'
            : 'Không có mục nào ở trạng thái này.'}
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {visible.map((item) => {
            const meta = DECISION_META[item.decision];
            return (
              <li key={item.id} className="eg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {item.kind === 'article' ? (
                        <FileText className="h-4 w-4 shrink-0 text-zinc-500" />
                      ) : (
                        <Film className="h-4 w-4 shrink-0 text-zinc-500" />
                      )}
                      <span className="eg-mono text-[10px] uppercase tracking-wider text-zinc-600">
                        {REVIEW_KIND_LABELS[item.kind]}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${meta.chip}`}>
                        {meta.icon}{meta.label}
                      </span>
                      {item.blocked && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-rose-300/30 bg-rose-500/[.09] px-2.5 py-0.5 text-[10px] font-medium text-rose-100">
                          <ShieldAlert className="h-3 w-3" />Bị chặn
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 truncate text-sm font-medium text-zinc-100">{item.title}</div>
                    <div className="eg-mono mt-1 flex flex-wrap gap-x-3 text-[10px] uppercase tracking-wider text-zinc-600">
                      {item.projectTitle && <span className="truncate">{item.projectTitle}</span>}
                      <span>{new Date(item.updatedAt).toLocaleString('vi-VN')}</span>
                    </div>

                    {item.signals.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {item.signals.map((signal) => (
                          <span
                            key={signal.label}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] ${SIGNAL_STYLE[signal.status]}`}
                            title={signal.detail}
                          >
                            {signal.status === 'fail' && <AlertTriangle className="h-3 w-3" />}
                            {signal.label}
                            {signal.detail ? ` · ${signal.detail}` : ''}
                          </span>
                        ))}
                      </div>
                    )}

                    {item.note && (
                      <p className="mt-2 text-xs italic text-zinc-500">Ghi chú: {item.note}</p>
                    )}
                  </div>

                  {item.kind === 'article' && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        className="eg-button-primary min-h-11 px-4 text-xs"
                        onClick={() => void decide(item, 'approved')}
                        disabled={item.blocked || item.decision === 'approved'}
                        title={item.blocked ? 'Còn tín hiệu hỏng, phải sửa trước' : undefined}
                      >
                        Duyệt
                      </button>
                      <button
                        type="button"
                        className="eg-button-secondary min-h-11 px-4 text-xs"
                        onClick={() => { setNoteFor(item.id); setNote(item.note ?? ''); }}
                      >
                        Yêu cầu sửa
                      </button>
                    </div>
                  )}
                </div>

                {noteFor === item.id && (
                  <div className="mt-3 border-t eg-divider pt-3">
                    <label className="block">
                      <span className="eg-kicker">Cần sửa gì</span>
                      <textarea
                        className="eg-input mt-2 min-h-[64px] w-full resize-y"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="Ví dụ: sapo quá dài, bỏ đoạn cuối, thêm CTA đã duyệt"
                      />
                    </label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="eg-button-secondary min-h-11 px-4 text-xs"
                        onClick={() => void decide(item, 'changes-requested', note.trim() || undefined)}
                      >
                        Gửi yêu cầu sửa
                      </button>
                      <button
                        type="button"
                        className="eg-button-secondary min-h-11 px-4 text-xs"
                        onClick={() => { setNoteFor(null); setNote(''); }}
                      >
                        Huỷ
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default ReviewDeskPanel;
