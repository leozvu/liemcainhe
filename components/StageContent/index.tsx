import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  Clapperboard,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Loader2,
  Pencil,
  Sparkles,
} from 'lucide-react';
import { ProjectState } from '../../types';
import {
  ArticleDraft,
  ContentBrief,
  ContentStudioState,
  ReviewDecision,
  StoryBridge,
  TrendItem,
} from '../../types/content';
import { TREND_SOURCES } from '../../services/content/trendSources';
import { fetchTrendsWithFallback } from '../../services/content/trendService';
import {
  APPROACH_OPTIONS,
  AUDIENCE_OPTIONS,
  INTENT_OPTIONS,
  VOICE_OPTIONS,
  createDefaultBrief,
} from '../../services/content/contentAxes';
import { articleToMarkdown, generateArticle } from '../../services/content/articleService';
import {
  SHORT_FILM_DURATIONS,
  ShortFilmDuration,
  buildStoryBridgeFromArticle,
  buildStoryBridgeFromTrend,
  toFilmProjectSeed,
} from '../../services/content/storyBridgeService';
import { getCoverImage } from '../../services/content/illustrationService';
import {
  ClientMemory,
  buildClientMemory,
  describeMemory,
  hasMemory,
} from '../../services/content/clientMemoryService';
import { listArticles } from '../../services/content/articleLibraryService';
import { readPublishHistory } from '../../services/content/publishLedgerService';
import {
  ARTICLE_LAYOUTS,
  ArticleLayout,
  renderArticleHtml,
} from '../../services/content/articleHtmlService';
import ArticleEditor from './ArticleEditor';
import ArticleLibrary from './ArticleLibrary';
import AxisPicker from './AxisPicker';
import IllustrationPanel from './IllustrationPanel';
import PublishPanel from './PublishPanel';
import TrendBoard from './TrendBoard';
import CreativeDirectionPanel from './CreativeDirectionPanel';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
  onGoToScript?: () => void;
}

/** Trạng thái khởi đầu khi dự án chưa từng mở Xưởng Nội dung. */
const EMPTY_STUDIO_STATE: ContentStudioState = {
  sourceId: TREND_SOURCES[0].id,
  brief: createDefaultBrief(''),
  keywordText: '',
  draft: null,
  bridge: null,
  durationSeconds: 60,
  updatedAt: 0,
};

const StageContent: React.FC<Props> = ({ project, updateProject, onGoToScript }) => {
  /**
   * Nội dung đáng giữ nằm trong `project.contentStudio`, không phải state cục
   * bộ, để chuyển tab hay đóng app không mất bài. Ghi vào dự án là đủ vì App
   * đã tự lưu xuống IndexedDB và đồng bộ cloud sẵn.
   *
   * Chỉ những thứ thuần giao diện — đang bận, thông báo, danh sách tin vừa tải
   * — mới ở lại đây, vì lưu chúng không có ý nghĩa gì sau khi đóng app.
   */
  const saved = project.contentStudio;

  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [loadingTrends, setLoadingTrends] = useState(false);
  const [busy, setBusy] = useState<'article' | 'bridge' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<ArticleLayout>('editorial');
  /**
   * Quyết định duyệt của bản đang mở.
   *
   * Không lưu vào dự án: nguồn sự thật là thư viện, còn đây chỉ là bản sao để
   * khối đăng bài biết có được mở khoá hay không. Sinh bài mới thì phải đặt lại
   * về `undefined`, nếu không bài mới thừa hưởng dấu đã duyệt của bài cũ.
   */
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision | undefined>(undefined);
  const [memory, setMemory] = useState<ClientMemory | null>(null);

  const sourceId = saved?.sourceId ?? TREND_SOURCES[0].id;
  const brief = saved?.brief ?? createDefaultBrief('');
  const keywordText = saved?.keywordText ?? '';
  const draft = saved?.draft ?? null;
  const bridge = saved?.bridge ?? null;
  const duration = (saved?.durationSeconds ?? 60) as ShortFilmDuration;

  /**
   * Mọi thay đổi đều tính từ `prev` chứ không từ biến trong closure.
   *
   * Đọc từ closure sẽ mất ký tự khi gõ nhanh, vì React gộp nhiều lần cập nhật
   * và biến ngoài vẫn giữ giá trị của lần render cũ.
   */
  const patchStudio = (
    patch: Partial<ContentStudioState> | ((current: ContentStudioState) => Partial<ContentStudioState>),
  ) =>
    updateProject((prev) => {
      const current = prev.contentStudio ?? EMPTY_STUDIO_STATE;
      const delta = typeof patch === 'function' ? patch(current) : patch;
      return { ...prev, contentStudio: { ...current, ...delta, updatedAt: Date.now() } };
    });

  const setSourceId = (value: string) => patchStudio({ sourceId: value });
  const setKeywordText = (value: string) => patchStudio({ keywordText: value });
  const setDuration = (value: ShortFilmDuration) => patchStudio({ durationSeconds: value });
  /**
   * Đổi nội dung là mất hiệu lực phê duyệt.
   *
   * Không có ngoại lệ, kể cả sửa một dấu phẩy. Giữ lại dấu đã duyệt sau khi sửa
   * chính là lỗ hổng mà bàn duyệt sinh ra để bịt: bài được duyệt xong rồi sửa
   * thành bất cứ thứ gì mà vẫn đăng được.
   */
  const setDraft = (value: ArticleDraft | null) => {
    setReviewDecision(undefined);
    patchStudio({ draft: value });
  };
  const setBridge = (value: StoryBridge | null) => patchStudio({ bridge: value });

  const markdown = useMemo(() => (draft ? articleToMarkdown(draft) : ''), [draft]);

  const cover = draft ? getCoverImage(draft) : undefined;
  /** Ảnh đã vẽ xong của một mục, dùng khi xem trước bài. */
  const sectionImage = (index: number): string | undefined =>
    draft?.illustrations?.find(
      (item) => item.purpose === 'section' && item.sectionIndex === index && item.status === 'done',
    )?.imageUrl;

  const patchBrief = (patch: Partial<ContentBrief>) =>
    patchStudio((current) => ({ brief: { ...current.brief, ...patch } }));

  /** Đổi hướng sáng tạo làm bài và truyện cũ hết hiệu lực. */
  const setCreativeDirection = (creativeDirection: ContentBrief['creativeDirection']) => {
    setReviewDecision(undefined);
    patchStudio((current) => ({
      brief: { ...current.brief, creativeDirection },
      draft: null,
      bridge: null,
    }));
    setNotice('Đã cập nhật hướng sáng tạo. Hãy tạo lại bài viết hoặc phim ngắn.');
  };

  const handleLoadTrends = async () => {
    setLoadingTrends(true);
    setError(null);
    try {
      const items = await fetchTrendsWithFallback(sourceId, 12);
      setTrends(items);
      if (!items.length) setError('Không nguồn nào phản hồi. Hãy thử lại sau ít phút.');
    } finally {
      setLoadingTrends(false);
    }
  };

  const handlePickTrend = (trend: TrendItem) => {
    patchBrief({
      topic: trend.title,
      origin: { sourceId: trend.sourceId, sourceLabel: trend.sourceLabel, link: trend.link },
    });
    setDraft(null);
    setBridge(null);
    setNotice(null);
  };

  const runGuarded = async (kind: 'article' | 'bridge', task: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi không xác định.');
    } finally {
      setBusy(null);
    }
  };

  const handleGenerateArticle = () =>
    runGuarded('article', async () => {
      const keywords = keywordText
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      // Dựng trí nhớ ngay trước khi viết, không dùng bản lưu sẵn: quyết định
      // duyệt và số liệu hiệu quả đổi liên tục ở nơi khác trong app.
      const memory = buildClientMemory(await listArticles(), {
        clientId: project.clientId,
        ledger: await readPublishHistory(),
      });
      setMemory(memory);

      const result = await generateArticle(
        { ...brief, keywords },
        { brandKit: project.brandKitSnapshot, memory },
      );
      setDraft(result);
      setBridge(null);
    });

  const handleBuildBridge = () =>
    runGuarded('bridge', async () => {
      const options = {
        durationSeconds: duration,
        brandKit: project.brandKitSnapshot,
        creativeDirection: brief.creativeDirection,
      };
      const result = draft
        ? await buildStoryBridgeFromArticle(draft, brief, options)
        : await buildStoryBridgeFromTrend(
            {
              title: brief.topic,
              sourceId: brief.origin?.sourceId ?? 'thu-cong',
              sourceLabel: brief.origin?.sourceLabel ?? 'Tự nhập',
              category: 'tong_hop',
              rank: 1,
            },
            options,
          );
      setBridge(result);
    });

  const handleSendToScript = () => {
    if (!bridge) return;
    const seed = toFilmProjectSeed(bridge, project.title);
    updateProject({
      rawScript: seed.rawScript,
      targetDuration: seed.targetDuration,
      language: seed.language,
      visualStyle: seed.visualStyle,
    });
    setNotice('Đã đưa truyện sang Kịch bản. Dự án hiện tại đã được cập nhật.');
    onGoToScript?.();
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(markdown);
    setNotice('Đã chép bài viết dạng Markdown.');
  };

  const safeName = (draft?.title || 'bai-viet').replace(/[\\/:*?"<>|]/g, '-');

  const download = (content: string, mime: string, extension: string) => {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeName}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownload = () => download(markdown, 'text/markdown', 'md');

  const buildHtml = () =>
    draft ? renderArticleHtml(draft, { layout, brandKit: project.brandKitSnapshot }) : '';

  const handleDownloadHtml = () => download(buildHtml(), 'text/html', 'html');

  /**
   * Mở bản xem thử trong tab mới.
   *
   * Không thu hồi URL ngay vì tab mới cần nó để tải; trình duyệt tự dọn khi
   * đóng tài liệu gốc.
   */
  const handlePreviewHtml = () => {
    const url = URL.createObjectURL(new Blob([buildHtml()], { type: 'text/html;charset=utf-8' }));
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const canGenerate = brief.topic.trim().length > 0 && busy === null;

  return (
    <div className="eg-safe-scroll h-screen overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-8">
          <div className="eg-kicker">Xưởng nội dung</div>
          <h1 className="eg-display mt-2 text-3xl font-semibold text-white">Bắt trend và viết bài</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Chọn một chủ đề đang nóng, chỉnh bốn trục điều khiển rồi để hệ thống viết bài. Cùng chủ
            đề đó có thể chuyển thẳng thành truyện cho Kịch bản.
          </p>
        </header>

        {error && (
          <div role="alert" className="mb-6 rounded-xl border border-rose-300/30 bg-rose-500/[.08] px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="mb-6 rounded-xl border border-emerald-300/25 bg-emerald-400/[.07] px-4 py-3 text-sm text-emerald-100">
            {notice}
          </div>
        )}

        <TrendBoard
          sources={TREND_SOURCES}
          sourceId={sourceId}
          onSourceChange={setSourceId}
          trends={trends}
          loading={loadingTrends}
          selectedTopic={brief.topic}
          onLoad={() => void handleLoadTrends()}
          onPick={handlePickTrend}
        />

        <section className="eg-panel mt-6 p-5" aria-labelledby="brief-heading">
          <h2 id="brief-heading" className="text-sm font-semibold text-white">Brief</h2>

          <label className="mt-4 block">
            <span className="eg-kicker">Chủ đề</span>
            <input
              className="eg-input mt-2 w-full"
              value={brief.topic}
              onChange={(e) => patchBrief({ topic: e.target.value })}
              placeholder="Chọn từ bảng xu hướng hoặc tự nhập"
            />
          </label>

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <AxisPicker label="Mục tiêu" options={INTENT_OPTIONS} value={brief.intent} onChange={(v) => patchBrief({ intent: v })} />
            <AxisPicker label="Góc tiếp cận" options={APPROACH_OPTIONS} value={brief.approach} onChange={(v) => patchBrief({ approach: v })} />
            <AxisPicker label="Giọng" options={VOICE_OPTIONS} value={brief.voice} onChange={(v) => patchBrief({ voice: v })} />
            <AxisPicker label="Người đọc" options={AUDIENCE_OPTIONS} value={brief.audience} onChange={(v) => patchBrief({ audience: v })} />
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="eg-kicker">Từ khoá, cách nhau bằng dấu phẩy</span>
              <input
                className="eg-input mt-2 w-full"
                value={keywordText}
                onChange={(e) => setKeywordText(e.target.value)}
                placeholder="giá vàng, lãi suất"
              />
            </label>
            <label className="block">
              <span className="eg-kicker">Độ dài thân bài (chữ)</span>
              <input
                type="number"
                min={300}
                max={3000}
                step={100}
                className="eg-input mt-2 w-full"
                value={brief.targetWords}
                onChange={(e) => patchBrief({ targetWords: Number(e.target.value) || 900 })}
              />
            </label>
          </div>

          <label className="mt-4 block">
            <span className="eg-kicker">Ràng buộc riêng</span>
            <textarea
              className="eg-input mt-2 min-h-[72px] w-full resize-y"
              value={brief.notes ?? ''}
              onChange={(e) => patchBrief({ notes: e.target.value })}
              placeholder="Ví dụ: không nhắc tên đối thủ, phải nêu chương trình khuyến mãi tháng này"
            />
          </label>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" className="eg-button-primary min-h-11 px-5" onClick={() => void handleGenerateArticle()} disabled={!canGenerate}>
              {busy === 'article' ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 inline h-4 w-4" />}
              Viết bài
            </button>
            {!brief.topic.trim() && <span className="text-xs text-zinc-500">Cần có chủ đề trước đã.</span>}
            {memory && hasMemory(memory) && (
              <span className="inline-flex items-center gap-1.5 text-xs text-cyan-100/70">
                <BrainCircuit className="h-3.5 w-3.5" />
                {describeMemory(memory)}
              </span>
            )}
          </div>
        </section>

        <CreativeDirectionPanel brief={brief} onChange={setCreativeDirection} />

        {draft && (
          <section className="eg-panel mt-6 p-5" aria-labelledby="draft-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="draft-heading" className="text-sm font-semibold text-white">Bài viết</h2>
                <p className="eg-mono mt-1 text-[10px] uppercase tracking-wider text-zinc-500">
                  {draft.sections.length} mục · đọc khoảng {draft.readingMinutes} phút
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="eg-button-secondary min-h-11 px-4"
                  onClick={() => setEditing((value) => !value)}
                  aria-pressed={editing}
                >
                  {editing ? <Eye className="mr-2 inline h-4 w-4" /> : <Pencil className="mr-2 inline h-4 w-4" />}
                  {editing ? 'Xem bài' : 'Sửa bài'}
                </button>
                <button type="button" className="eg-button-secondary min-h-11 px-4" onClick={() => void handleCopy()}>
                  <Copy className="mr-2 inline h-4 w-4" />Chép Markdown
                </button>
                <button type="button" className="eg-button-secondary min-h-11 px-4" onClick={handleDownload}>
                  <Download className="mr-2 inline h-4 w-4" />Tải Markdown
                </button>
              </div>
            </div>

            <div className="mt-5 border-t eg-divider pt-5">
              {editing ? (
                <ArticleEditor draft={draft} onChange={setDraft} />
              ) : (
                <>
                  <article>
                    {cover && (
                      <img
                        src={cover}
                        alt=""
                        className="mb-4 w-full rounded-xl border border-white/[.07]"
                        loading="lazy"
                      />
                    )}
                    <h3 className="eg-display text-xl font-semibold text-white">{draft.title}</h3>
                    <p className="mt-2 font-medium text-zinc-300">{draft.sapo}</p>
                    {draft.sections.map((section, index) => (
                      <div key={`${section.heading}-${index}`} className="mt-5">
                        {section.heading && <h4 className="text-sm font-semibold text-cyan-100">{section.heading}</h4>}
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">{section.body}</p>
                        {sectionImage(index) && (
                          <img
                            src={sectionImage(index)}
                            alt=""
                            className="mt-3 w-full rounded-lg border border-white/[.07]"
                            loading="lazy"
                          />
                        )}
                      </div>
                    ))}
                    {draft.hashtags.length > 0 && (
                      <div className="mt-5 flex flex-wrap gap-2">
                        {draft.hashtags.map((tag) => <span key={tag} className="eg-chip">#{tag}</span>)}
                      </div>
                    )}
                  </article>

                  <div className="mt-5 border-t eg-divider pt-4">
                    <div className="eg-kicker">Cho công cụ tìm kiếm</div>
                    <p className="mt-1.5 text-xs text-zinc-400"><strong className="text-zinc-300">{draft.seoTitle}</strong></p>
                    <p className="mt-1 text-xs text-zinc-500">{draft.metaDescription}</p>
                  </div>
                </>
              )}
            </div>

            <div className="mt-5 border-t eg-divider pt-4">
              <div className="eg-kicker">Xuất bản dạng trang web</div>
              <p className="mt-1.5 text-xs text-zinc-500">
                Dùng để đăng lên web hoặc blog của khách, và để gửi khách duyệt. Màu và font lấy từ
                Brand Kit của dự án.
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="eg-kicker">Bố cục</span>
                  <select
                    className="eg-input mt-2"
                    value={layout}
                    onChange={(e) => setLayout(e.target.value as ArticleLayout)}
                  >
                    {ARTICLE_LAYOUTS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <button type="button" className="eg-button-secondary min-h-11 px-4" onClick={handlePreviewHtml}>
                  <ExternalLink className="mr-2 inline h-4 w-4" />Xem thử
                </button>
                <button type="button" className="eg-button-secondary min-h-11 px-4" onClick={handleDownloadHtml}>
                  <Download className="mr-2 inline h-4 w-4" />Tải HTML
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {ARTICLE_LAYOUTS.find((item) => item.value === layout)?.description}
              </p>
            </div>
          </section>
        )}

        {draft && (
          <IllustrationPanel
            draft={draft}
            brief={brief}
            brandKit={project.brandKitSnapshot}
            project={project}
            updateProject={updateProject}
            onChange={(illustrations) => setDraft({ ...draft, illustrations })}
          />
        )}

        {draft && (
          <PublishPanel
            draft={draft}
            brandKit={project.brandKitSnapshot}
            reviewDecision={reviewDecision}
          />
        )}

        <ArticleLibrary
          draft={draft}
          brief={brief}
          projectId={project.id}
          projectTitle={project.title}
          clientId={project.clientId}
          brandKit={project.brandKitSnapshot}
          onReviewChange={setReviewDecision}
          onLoad={(article) => {
            patchStudio({ draft: article.draft, brief: article.brief });
            setReviewDecision(article.review?.decision);
            setEditing(false);
            setNotice(`Đã mở “${article.title}” từ thư viện.`);
          }}
        />

        <section className="eg-panel mt-6 p-5" aria-labelledby="bridge-heading">
          <h2 id="bridge-heading" className="text-sm font-semibold text-white">Chuyển thành phim ngắn</h2>
          <p className="mt-1.5 text-xs text-zinc-500">
            {draft
              ? 'Sẽ dựa trên mạch của bài viết ở trên.'
              : 'Chưa có bài viết thì vẫn chuyển thẳng từ chủ đề được.'}
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="eg-kicker">Thời lượng</span>
              <select
                className="eg-input mt-2"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) as ShortFilmDuration)}
              >
                {SHORT_FILM_DURATIONS.map((value) => <option key={value} value={value}>{value} giây</option>)}
              </select>
            </label>
            <button type="button" className="eg-button-secondary min-h-11 px-5" onClick={() => void handleBuildBridge()} disabled={!canGenerate}>
              {busy === 'bridge' ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <Clapperboard className="mr-2 inline h-4 w-4" />}
              Dựng truyện
            </button>
          </div>

          {bridge && (
            <div className="mt-5 border-t eg-divider pt-5">
              <div className="eg-kicker">Logline</div>
              <p className="mt-1.5 text-sm font-medium text-zinc-200">{bridge.logline}</p>

              <div className="eg-kicker mt-4">Truyện</div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">{bridge.rawScript}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                <span className="eg-chip">{bridge.suggestedDurationSeconds} giây</span>
                <span className="eg-chip">{bridge.suggestedVisualStyle}</span>
                {bridge.characterHints.map((hint) => <span key={hint} className="eg-chip">{hint}</span>)}
              </div>

              <button type="button" className="eg-button-primary mt-5 min-h-11 px-5" onClick={handleSendToScript}>
                Đưa sang Kịch bản<ArrowRight className="ml-2 inline h-4 w-4" />
              </button>
              <p className="mt-2 text-xs text-zinc-500">
                Thao tác này ghi đè phần truyện của dự án <strong className="text-zinc-400">{project.title}</strong>.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default StageContent;
