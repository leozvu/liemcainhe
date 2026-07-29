import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ArticleDraft } from '../../types/content';
import { estimateReadingMinutes } from '../../services/content/articleService';
import { useLocale } from '../../contexts/LocaleContext';

interface Props {
  draft: ArticleDraft;
  onChange: (draft: ArticleDraft) => void;
}

/**
 * Sửa bài trước khi đăng.
 *
 * AI viết xong mà không sửa được một chữ là thiếu sót cơ bản — người biên tập
 * luôn cần đổi tiêu đề, cắt một đoạn hay thêm một câu. Mọi thay đổi đều tính
 * lại thời gian đọc và chạy lại vòng kiểm Brand Kit ở khối bên dưới.
 */
const ArticleEditor: React.FC<Props> = ({ draft, onChange }) => {
  const { t } = useLocale();
  /** Ghi lại kèm tính lại thời gian đọc, để con số không bao giờ lệch nội dung. */
  const patch = (changes: Partial<ArticleDraft>) => {
    const next = { ...draft, ...changes };
    onChange({ ...next, readingMinutes: estimateReadingMinutes(next) });
  };

  const patchSection = (index: number, changes: Partial<ArticleDraft['sections'][number]>) =>
    patch({
      sections: draft.sections.map((section, i) => (i === index ? { ...section, ...changes } : section)),
    });

  const addSection = () =>
    patch({ sections: [...draft.sections, { heading: '', body: '' }] });

  const removeSection = (index: number) =>
    patch({ sections: draft.sections.filter((_, i) => i !== index) });

  return (
    <div className="space-y-5">
      <label className="block">
        <span className="eg-kicker">{t('content.editor.headline')}</span>
        <input
          className="eg-input mt-2 w-full"
          value={draft.title}
          onChange={(event) => patch({ title: event.target.value })}
        />
      </label>

      <label className="block">
        <span className="eg-kicker">{t('content.editor.standfirst')}</span>
        <textarea
          className="eg-input mt-2 min-h-[76px] w-full resize-y"
          value={draft.sapo}
          onChange={(event) => patch({ sapo: event.target.value })}
        />
      </label>

      <div>
        <div className="flex items-center justify-between">
          <span className="eg-kicker">{t('content.editor.sections')}</span>
          <button type="button" className="eg-button-secondary min-h-11 px-3 text-xs" onClick={addSection}>
            <Plus className="mr-1.5 inline h-3.5 w-3.5" />{t('content.editor.addSection')}
          </button>
        </div>

        <div className="mt-3 space-y-4">
          {draft.sections.map((section, index) => (
            <div key={index} className="rounded-xl border border-white/[.07] bg-black/15 p-3">
              <div className="flex items-center gap-2">
                <input
                  className="eg-input flex-1"
                  value={section.heading}
                  placeholder={t('content.editor.sectionTitle')}
                  onChange={(event) => patchSection(index, { heading: event.target.value })}
                />
                <button
                  type="button"
                  className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center"
                  onClick={() => removeSection(index)}
                  aria-label={t('content.editor.deleteSectionAria', { number: index + 1 })}
                  disabled={draft.sections.length <= 1}
                  title={draft.sections.length <= 1 ? t('content.editor.keepOneSection') : t('content.editor.deleteSection')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <textarea
                className="eg-input mt-2 min-h-[104px] w-full resize-y"
                value={section.body}
                placeholder={t('content.editor.sectionBody')}
                onChange={(event) => patchSection(index, { body: event.target.value })}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="eg-kicker">{t('content.editor.hashtags')}</span>
          <input
            className="eg-input mt-2 w-full"
            value={draft.hashtags.join(' ')}
            onChange={(event) =>
              patch({
                hashtags: event.target.value
                  .split(/\s+/)
                  .map((tag) => tag.replace(/^#+/, '').trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <label className="block">
          <span className="eg-kicker">{t('content.editor.seoTitle')}</span>
          <input
            className="eg-input mt-2 w-full"
            value={draft.seoTitle}
            onChange={(event) => patch({ seoTitle: event.target.value })}
          />
          <span className={`eg-mono mt-1 block text-[10px] ${draft.seoTitle.length > 60 ? 'text-amber-300' : 'text-zinc-600'}`}>
            {draft.seoTitle.length}/60
          </span>
        </label>
      </div>

      <label className="block">
        <span className="eg-kicker">{t('content.editor.seoDescription')}</span>
        <textarea
          className="eg-input mt-2 min-h-[64px] w-full resize-y"
          value={draft.metaDescription}
          onChange={(event) => patch({ metaDescription: event.target.value })}
        />
        <span className={`eg-mono mt-1 block text-[10px] ${draft.metaDescription.length > 155 ? 'text-amber-300' : 'text-zinc-600'}`}>
          {draft.metaDescription.length}/155
        </span>
      </label>
    </div>
  );
};

export default ArticleEditor;
