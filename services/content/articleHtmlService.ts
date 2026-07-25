import { BrandKit } from '../../types';
import { ArticleDraft } from '../../types/content';
import { normalizeBrandKit } from '../brandKitService';

/**
 * Dàn trang bài viết thành HTML.
 *
 * AIWriteX có 35 template vì nó đăng lên WeChat — nền tảng bài viết HTML. Kênh
 * của Egoric là feed văn bản thuần nên HTML không dùng để đăng, mà để **xuất
 * bản lên web hoặc blog của khách, và để gửi khách duyệt**.
 *
 * Vì vậy không bê 35 template về. Ba bố cục dưới đây lấy màu và font từ chính
 * Brand Kit của khách, nên một bố cục ra được nhiều diện mạo khác nhau — đúng
 * thứ một agency cần, thay vì một thư viện template cố định.
 *
 * Sinh bằng chuỗi chứ không gọi model: dàn trang là việc xác định, không cần
 * AI, và gọi model ở đây chỉ tốn tiền để nhận về HTML kém ổn định hơn.
 */

export type ArticleLayout = 'editorial' | 'minimal' | 'card';

export interface LayoutOption {
  value: ArticleLayout;
  label: string;
  description: string;
}

export const ARTICLE_LAYOUTS: LayoutOption[] = [
  {
    value: 'editorial',
    label: 'Tạp chí',
    description: 'Tiêu đề lớn, ảnh bìa tràn viền, chữ thoáng. Hợp bài dài và bài thương hiệu.',
  },
  {
    value: 'minimal',
    label: 'Tối giản',
    description: 'Chỉ chữ và khoảng trắng. Hợp bài kỹ thuật, bản tin nội bộ.',
  },
  {
    value: 'card',
    label: 'Thẻ',
    description: 'Mỗi mục một thẻ có viền. Hợp bài dạng danh sách và hướng dẫn.',
  },
];

/** Thoát ký tự để nội dung người dùng không phá cấu trúc HTML. */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Tách đoạn theo dòng trống, giữ xuống dòng đơn thành <br>. */
const toParagraphs = (body: string): string =>
  body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n      ');

interface Palette {
  ink: string;
  muted: string;
  accent: string;
  surface: string;
  border: string;
  bodyFont: string;
  headingFont: string;
}

/**
 * Lấy màu và font từ Brand Kit, có giá trị dự phòng.
 *
 * Brand Kit của khách thường thiếu chỗ này chỗ kia, mà một trang thiếu màu thì
 * vỡ hẳn, nên mọi giá trị đều phải có đường lui.
 */
const buildPalette = (brandKit?: BrandKit | null): Palette => {
  const kit = normalizeBrandKit(brandKit);
  const colors = kit.colors.map((color) => color.hex).filter(Boolean);
  const fonts = kit.fonts.filter(Boolean);

  return {
    ink: '#16202b',
    muted: '#5b6673',
    accent: colors[0] || '#0f766e',
    surface: colors[1] || '#f6f7f9',
    border: 'rgba(22,32,43,.12)',
    bodyFont: fonts[1] || fonts[0] || "'Be Vietnam Pro', system-ui, sans-serif",
    headingFont: fonts[0] || "'Be Vietnam Pro', system-ui, sans-serif",
  };
};

const LAYOUT_CSS: Record<ArticleLayout, (p: Palette) => string> = {
  editorial: (p) => `
    body { max-width: 760px; }
    h1 { font-size: 2.4rem; line-height: 1.15; letter-spacing: -.02em; }
    .sapo { font-size: 1.15rem; font-weight: 600; color: ${p.ink}; border-left: 4px solid ${p.accent}; padding-left: 1rem; }
    h2 { font-size: 1.35rem; margin-top: 2.75rem; }
    .cover { margin: 0 -2rem 2rem; width: calc(100% + 4rem); }
    @media (max-width: 760px) { .cover { margin: 0 0 1.5rem; width: 100%; } }`,
  minimal: (p) => `
    body { max-width: 640px; }
    h1 { font-size: 1.9rem; line-height: 1.25; }
    .sapo { font-size: 1.02rem; color: ${p.muted}; }
    h2 { font-size: 1.15rem; margin-top: 2.25rem; }
    .cover { display: none; }`,
  card: (p) => `
    body { max-width: 720px; }
    h1 { font-size: 2rem; line-height: 1.2; }
    .sapo { font-size: 1.05rem; color: ${p.muted}; }
    section.block { background: ${p.surface}; border: 1px solid ${p.border}; border-radius: 14px; padding: 1.25rem 1.5rem; margin-top: 1.25rem; }
    section.block h2 { margin-top: 0; font-size: 1.1rem; }`,
};

export interface RenderHtmlOptions {
  layout?: ArticleLayout;
  brandKit?: BrandKit | null;
  /** Chèn ảnh minh hoạ đã vẽ xong. */
  includeImages?: boolean;
}

/** Dựng trang HTML độc lập, không phụ thuộc tệp ngoài. */
export const renderArticleHtml = (
  draft: ArticleDraft,
  options: RenderHtmlOptions = {},
): string => {
  const layout = options.layout ?? 'editorial';
  const p = buildPalette(options.brandKit);
  const includeImages = options.includeImages ?? true;

  const cover = includeImages
    ? draft.illustrations?.find((item) => item.purpose === 'cover' && item.status === 'done')
    : undefined;

  const sectionTag = layout === 'card' ? 'section class="block"' : 'section';

  const body = draft.sections
    .map((section, index) => {
      const image = includeImages
        ? draft.illustrations?.find(
            (item) => item.purpose === 'section' && item.sectionIndex === index && item.status === 'done',
          )
        : undefined;

      return [
        `    <${sectionTag}>`,
        section.heading ? `      <h2>${escapeHtml(section.heading)}</h2>` : '',
        `      ${toParagraphs(section.body)}`,
        image?.imageUrl
          ? `      <img src="${escapeHtml(image.imageUrl)}" alt="${escapeHtml(image.altText)}">`
          : '',
        '    </section>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  const tags = draft.hashtags.length
    ? `\n    <p class="tags">${draft.hashtags.map((tag) => `#${escapeHtml(tag)}`).join(' ')}</p>`
    : '';

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(draft.seoTitle || draft.title)}</title>
<meta name="description" content="${escapeHtml(draft.metaDescription)}">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 2rem 1.5rem 4rem;
    font-family: ${p.bodyFont};
    color: ${p.ink}; background: #fff;
    font-size: 1rem; line-height: 1.7;
    -webkit-text-size-adjust: 100%;
  }
  h1, h2 { font-family: ${p.headingFont}; color: ${p.ink}; margin: 0 0 .75rem; }
  h2 { margin-bottom: .5rem; }
  p { margin: 0 0 1rem; }
  img { max-width: 100%; height: auto; display: block; border-radius: 10px; margin: 1.25rem 0; }
  a { color: ${p.accent}; }
  .sapo { margin: 0 0 2rem; }
  .tags { margin-top: 2.5rem; color: ${p.accent}; font-size: .92rem; }
  .meta { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid ${p.border}; color: ${p.muted}; font-size: .82rem; }
${LAYOUT_CSS[layout](p)}
</style>
</head>
<body>
${cover?.imageUrl ? `  <img class="cover" src="${escapeHtml(cover.imageUrl)}" alt="${escapeHtml(cover.altText)}">\n` : ''}  <h1>${escapeHtml(draft.title)}</h1>
  <p class="sapo">${escapeHtml(draft.sapo)}</p>
${body}${tags}
  <p class="meta">Đọc khoảng ${draft.readingMinutes} phút</p>
</body>
</html>
`;
};
