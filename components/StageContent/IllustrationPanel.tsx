import React, { useState } from 'react';
import { ImagePlus, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { BrandKit } from '../../types';
import { ArticleDraft, ArticleIllustration, ContentBrief } from '../../types/content';
import {
  countRendered,
  planIllustrations,
  renderIllustration,
} from '../../services/content/illustrationService';
import {
  PreflightReport,
  describePreflight,
  preflightPrompt,
} from '../../services/promptPreflight';

interface Props {
  draft: ArticleDraft;
  brief: ContentBrief;
  brandKit?: BrandKit | null;
  onChange: (illustrations: ArticleIllustration[]) => void;
}

/**
 * Ảnh minh hoạ cho bài viết.
 *
 * Hai bước tách bạch có chủ đích: lên ý tưởng bằng model chat (rẻ), rồi vẽ
 * từng ảnh bằng model ảnh (đắt). Prompt hiện ra để sửa được trước khi bấm vẽ,
 * và vẽ từng ảnh một để dừng lại được khi thấy ảnh đầu đã sai hướng.
 */
const IllustrationPanel: React.FC<Props> = ({ draft, brief, brandKit, onChange }) => {
  const illustrations = draft.illustrations ?? [];
  const [sectionCount, setSectionCount] = useState(0);
  const [planning, setPlanning] = useState(false);
  const [renderingId, setRenderingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<{ id: string; report: PreflightReport } | null>(null);

  const handlePlan = async () => {
    setPlanning(true);
    setError(null);
    try {
      onChange(await planIllustrations(draft, brief, { sectionCount, brandKit }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lên được ý tưởng ảnh.');
    } finally {
      setPlanning(false);
    }
  };

  /**
   * @param force bỏ qua cảnh báo thẩm định. Chỉ true khi người dùng đã đọc và
   * vẫn muốn vẽ.
   */
  const handleRender = async (target: ArticleIllustration, force = false) => {
    setRenderingId(target.id);
    setError(null);

    // Chấm prompt trước khi gọi model ảnh. Một lần chấm rẻ hơn một lần vẽ
    // nhiều lần, nên chặn được một lần vẽ hỏng là đã có lãi.
    if (!force) {
      const report = await preflightPrompt(
        { prompt: target.prompt, target: 'image', brandKit },
        { usageResourceId: 'preflight-illustration' },
      );
      if (report.verdict !== 'pass') {
        setPreflight({ id: target.id, report });
        setRenderingId(null);
        return;
      }
    }

    setPreflight(null);
    const marked = illustrations.map((item) =>
      item.id === target.id ? { ...item, status: 'generating' as const } : item,
    );
    onChange(marked);

    const done = await renderIllustration(target);
    onChange(marked.map((item) => (item.id === target.id ? done : item)));
    setRenderingId(null);
  };

  const patchPrompt = (id: string, prompt: string) =>
    onChange(illustrations.map((item) => (item.id === id ? { ...item, prompt } : item)));

  const remove = (id: string) => onChange(illustrations.filter((item) => item.id !== id));

  return (
    <section className="eg-panel mt-6 p-5" aria-labelledby="illustration-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="illustration-heading" className="text-sm font-semibold text-white">Ảnh minh hoạ</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Lên ý tưởng bằng model chat trước, rồi tự bấm vẽ từng ảnh. Mỗi lần vẽ đều tốn credit.
          </p>
        </div>
        {illustrations.length > 0 && (
          <span className="eg-mono text-[10px] uppercase tracking-wider text-zinc-600">
            đã vẽ {countRendered(illustrations)}/{illustrations.length}
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-rose-300/30 bg-rose-500/[.08] px-4 py-3 text-sm text-rose-100">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="eg-kicker">Ảnh cho các mục</span>
          <select
            className="eg-input mt-2"
            value={sectionCount}
            onChange={(event) => setSectionCount(Number(event.target.value))}
          >
            <option value={0}>Chỉ ảnh bìa</option>
            {[1, 2, 3].map((value) => (
              <option key={value} value={value} disabled={value > draft.sections.length}>
                Bìa + {value} ảnh mục
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="eg-button-secondary min-h-11 px-4" onClick={() => void handlePlan()} disabled={planning}>
          {planning ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 inline h-4 w-4" />}
          {illustrations.length ? 'Lên ý tưởng lại' : 'Lên ý tưởng ảnh'}
        </button>
      </div>

      {illustrations.length > 0 && (
        <ul className="mt-5 space-y-4 border-t eg-divider pt-5">
          {illustrations.map((item) => (
            <li key={item.id} className="rounded-xl border border-white/[.07] bg-black/15 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="eg-kicker">
                  {item.purpose === 'cover' ? 'Ảnh bìa' : `Mục ${(item.sectionIndex ?? 0) + 1}`} · {item.aspectRatio}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="eg-button-secondary min-h-11 px-3 text-xs"
                    onClick={() => void handleRender(item)}
                    disabled={renderingId !== null}
                  >
                    {renderingId === item.id ? (
                      <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
                    ) : item.status === 'done' ? (
                      <RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />
                    ) : (
                      <ImagePlus className="mr-1.5 inline h-3.5 w-3.5" />
                    )}
                    {item.status === 'done' ? 'Vẽ lại' : 'Vẽ ảnh'}
                  </button>
                  <button
                    type="button"
                    className="eg-icon-button flex h-11 w-11 items-center justify-center"
                    onClick={() => remove(item.id)}
                    aria-label="Bỏ ảnh này"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <textarea
                className="eg-input mt-2 min-h-[64px] w-full resize-y font-mono text-xs"
                value={item.prompt}
                onChange={(event) => patchPrompt(item.id, event.target.value)}
                aria-label="Prompt vẽ ảnh"
              />
              <p className="mt-1.5 text-xs text-zinc-500">Mô tả thay thế: {item.altText}</p>

              {preflight?.id === item.id && (
                <div
                  className={`mt-3 rounded-xl border px-3 py-2.5 ${
                    preflight.report.verdict === 'block'
                      ? 'border-rose-300/30 bg-rose-500/[.08]'
                      : 'border-amber-300/30 bg-amber-400/[.08]'
                  }`}
                  role="alert"
                >
                  <p
                    className={`text-xs font-medium ${
                      preflight.report.verdict === 'block' ? 'text-rose-50' : 'text-amber-50'
                    }`}
                  >
                    {describePreflight(preflight.report)}
                  </p>
                  <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-300">
                    {preflight.report.issues.map((issue, index) => (
                      <li key={`${issue.code}-${index}`}>
                        <span className={issue.severity === 'block' ? 'text-rose-200' : 'text-amber-100'}>
                          {issue.message}
                        </span>
                        {issue.fix && <span className="block text-zinc-500">{issue.fix}</span>}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {preflight.report.revisedPrompt && (
                      <button
                        type="button"
                        className="eg-button-secondary min-h-11 px-3 text-xs"
                        onClick={() => {
                          patchPrompt(item.id, preflight.report.revisedPrompt!);
                          setPreflight(null);
                        }}
                      >
                        Dùng bản sửa
                      </button>
                    )}
                    {preflight.report.verdict === 'warn' && (
                      <button
                        type="button"
                        className="eg-button-secondary min-h-11 px-3 text-xs"
                        onClick={() => void handleRender(item, true)}
                      >
                        Vẫn vẽ
                      </button>
                    )}
                    <button
                      type="button"
                      className="eg-button-secondary min-h-11 px-3 text-xs"
                      onClick={() => setPreflight(null)}
                    >
                      Để tôi sửa
                    </button>
                  </div>
                </div>
              )}

              {item.status === 'failed' && item.error && (
                <p role="alert" className="mt-2 text-xs text-rose-200">{item.error}</p>
              )}

              {item.imageUrl && (
                <img
                  src={item.imageUrl}
                  alt={item.altText}
                  className="mt-3 w-full rounded-lg border border-white/[.07]"
                  loading="lazy"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default IllustrationPanel;
