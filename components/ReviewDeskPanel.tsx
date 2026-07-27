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
  BatchDecisionResult,
  REVIEW_KIND_LABELS,
  ReviewQueueItem,
  ReviewSignal,
  buildReviewQueue,
  countQueue,
  decideArticle,
  decideBatch,
  filterQueue,
  groupQueueByDay,
  groupQueueByProject,
  partitionForBatch,
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
  const [grouping, setGrouping] = useState<'none' | 'day' | 'project'>('none');
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchDecisionResult[] | null>(null);

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

  /**
   * Chỉ mục sạch mọi tín hiệu mới duyệt hàng loạt được.
   *
   * Mục có cảnh báo là mục máy đang phân vân — đúng chỗ cần mắt người, nên
   * phải mở ra quyết riêng. Không có nút "duyệt tất cả" mù ở đây.
   */
  const batch = useMemo(() => partitionForBatch(visible), [visible]);
  const selectedBatch = useMemo(
    () => batch.eligible.filter((entry) => batchIds.includes(entry.id)),
    [batch.eligible, batchIds],
  );

  // Bỏ chọn những mục không còn nằm trong danh sách sau khi lọc hoặc làm mới,
  // để không âm thầm duyệt thứ người dùng không còn nhìn thấy.
  useEffect(() => {
    const allowed = new Set(batch.eligible.map((entry) => entry.id));
    setBatchIds((previous) => previous.filter((id) => allowed.has(id)));
  }, [batch.eligible]);

  const groups = useMemo(() => {
    if (grouping === 'day') return groupQueueByDay(visible);
    if (grouping === 'project') return groupQueueByProject(visible);
    return [{ key: 'all', label: '', items: visible }];
  }, [visible, grouping]);

  const runBatch = async (decision: ReviewDecision) => {
    if (!selectedBatch.length) return;
    setBatchBusy(true);
    setError(null);
    try {
      const results = await decideBatch(selectedBatch, decision, { note: note.trim() || undefined });
      setBatchResults(results);
      setBatchIds([]);
      setNote('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không ghi được quyết định hàng loạt.');
    } finally {
      setBatchBusy(false);
    }
  };

  const decide = async (item: ReviewQueueItem, decision: ReviewDecision, withNote?: string) => {
    if (item.kind !== 'article') {
      setError('Video duyệt trong Trung tâm sản xuất của dự án. Bàn duyệt chỉ hiện trạng thái.');
      return;
    }
    setError(null);
    try {
      const article = (await listArticles()).find((row) => row.id === item.sourceId);
      if (!article) throw new Error('Không tìm thấy bài trong thư viện.');
      await decideArticle(article, decision, {
        note: withNote,
        mode: 'individual',
        role: 'account',
        opened: true,
        gate: 'content-internal',
      });
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

        <span className="mx-1 w-px self-stretch bg-white/[.08]" aria-hidden />

        {([
          { value: 'none', label: 'Không gộp' },
          { value: 'day', label: 'Theo ngày' },
          { value: 'project', label: 'Theo dự án' },
        ] as const).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setGrouping(option.value)}
            aria-pressed={grouping === option.value}
            className={`min-h-11 rounded-xl border px-4 text-xs font-medium transition-colors ${
              grouping === option.value
                ? 'border-cyan-200/25 bg-cyan-200/[.09] text-white'
                : 'border-white/[.07] text-zinc-400 hover:bg-white/[.035] hover:text-zinc-200'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {batch.eligible.length > 0 && (
        <div className="mt-4 rounded-xl border border-white/[.08] bg-black/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-100">
                {batch.eligible.length} mục sạch mọi vòng kiểm — duyệt hàng loạt được
              </p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                {batch.needsAttention.length > 0 ? (
                  <>
                    {batch.needsAttention.length} mục còn lại có cảnh báo hoặc bị chặn, phải mở ra quyết
                    riêng. Đó là chỗ máy đang phân vân — không gộp vào đây.
                  </>
                ) : (
                  'Không mục nào có cảnh báo.'
                )}
              </p>
            </div>
            <button
              type="button"
              className="min-h-11 rounded-xl border border-white/[.08] px-4 text-xs font-medium text-zinc-300 hover:bg-white/[.04]"
              onClick={() =>
                setBatchIds((previous) =>
                  previous.length === batch.eligible.length ? [] : batch.eligible.map((entry) => entry.id),
                )
              }
            >
              {batchIds.length === batch.eligible.length ? 'Bỏ chọn hết' : 'Chọn hết mục sạch'}
            </button>
          </div>

          {selectedBatch.length > 0 && (
            <div className="mt-4 border-t eg-divider pt-4">
              <label className="block">
                <span className="eg-kicker">Ghi chú chung (tuỳ chọn)</span>
                <input
                  className="eg-input mt-2 w-full"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Áp cho cả lô"
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="eg-button-primary min-h-11 px-5 text-xs"
                  onClick={() => void runBatch('approved')}
                  disabled={batchBusy}
                >
                  {batchBusy ? <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" /> : null}
                  Duyệt {selectedBatch.length} mục
                </button>
                <button
                  type="button"
                  className="eg-button-secondary min-h-11 px-4 text-xs"
                  onClick={() => void runBatch('changes-requested')}
                  disabled={batchBusy}
                >
                  Yêu cầu sửa {selectedBatch.length} mục
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {batchResults && (
        <div className="mt-4 rounded-xl border border-white/[.08] bg-black/20 p-4">
          <p className="text-sm font-medium text-zinc-100">
            Đã ghi {batchResults.filter((row) => row.ok).length}/{batchResults.length} mục
          </p>
          {batchResults.some((row) => !row.ok) && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-rose-100/85">
              {batchResults
                .filter((row) => !row.ok)
                .map((row) => (
                  <li key={row.itemId}>
                    <strong>{row.title}</strong> — {row.error}
                  </li>
                ))}
            </ul>
          )}
          <button
            type="button"
            className="mt-3 min-h-11 text-xs font-medium text-cyan-200/80 hover:text-cyan-100"
            onClick={() => setBatchResults(null)}
          >
            Đóng
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">
          {items.length === 0
            ? 'Chưa có gì chờ duyệt. Lưu một bài vào thư viện hoặc mở vòng duyệt video để nó xuất hiện ở đây.'
            : 'Không có mục nào ở trạng thái này.'}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="mt-5">
            {group.label && (
              <h3 className="eg-kicker mb-2 flex items-baseline gap-2">
                {group.label}
                <span className="text-zinc-600">{group.items.length} mục</span>
              </h3>
            )}
            <ul className="space-y-3">
          {group.items.map((item) => {
            const meta = DECISION_META[item.decision];
            const batchable = batch.eligible.some((entry) => entry.id === item.id);
            return (
              <li key={item.id} className="eg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {batchable && (
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-cyan-300"
                      checked={batchIds.includes(item.id)}
                      aria-label={`Chọn ${item.title} để duyệt hàng loạt`}
                      onChange={(e) =>
                        setBatchIds((previous) =>
                          e.target.checked
                            ? [...previous, item.id]
                            : previous.filter((id) => id !== item.id),
                        )
                      }
                    />
                  )}
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
          </section>
        ))
      )}
    </div>
  );
};

export default ReviewDeskPanel;
