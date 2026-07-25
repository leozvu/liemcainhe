import { BrandKit } from '../../types';
import { ArticleDraft, ArticleSection, ContentBrief } from '../../types/content';
import { callChatApi } from '../adapters/chatAdapter';
import { buildBrandKitPromptContext } from '../brandKitService';
import { parseModelJson } from '../jsonResponse';
import { buildAxisDirectives, getApproach, getAudience, getIntent, getVoice } from './contentAxes';

/**
 * Sinh bài viết từ một brief.
 *
 * Đi qua `callChatApi` nên thừa hưởng sẵn chuyển tuyến khi model lỗi, đếm chi
 * phí theo `usageResourceId` và thông báo lỗi tiếng Việt của Egoric.
 */

/**
 * Quy tắc viết tiếng Việt áp cho mọi bài, không phụ thuộc bốn trục.
 *
 * Phần lớn là để chặn những lỗi mô hình hay mắc khi viết tiếng Việt: dịch máy
 * từ tiếng Anh, viết hoa toàn bộ làm mất dấu, và thói quen chèn lời dẫn kiểu
 * trợ lý ảo vào đầu bài.
 */
const VIETNAMESE_WRITING_RULES = `Bạn viết nội dung tiếng Việt cho một hãng sản xuất nội dung.

Quy tắc bắt buộc:
- Viết hoàn toàn bằng tiếng Việt, đúng chính tả và đủ dấu thanh.
- Không viết hoa toàn bộ một từ hay một câu, vì viết hoa toàn bộ làm mất dấu và khó đọc. Cần nhấn mạnh thì dùng cách diễn đạt, không dùng chữ hoa.
- Viết như người Việt viết, không dịch máy từ tiếng Anh. Nếu một cụm nghe như câu tiếng Anh dịch sang thì viết lại.
- Giữ nguyên tên riêng nước ngoài, không phiên âm.
- Thuật ngữ tiếng Anh đã quen dùng thì để nguyên, chú thích ngắn trong ngoặc ở lần đầu xuất hiện.
- Tiền tệ ghi bằng đồng, ngày tháng theo dạng ngày/tháng/năm.
- Không mở đầu bằng lời dẫn của trợ lý, không nhắc tới việc mình là AI, không mô tả quá trình làm bài.
- Không bịa số liệu, tên người, tên tổ chức hay trích dẫn. Không chắc thì viết theo hướng khái quát.`;

const buildArticlePrompt = (brief: ContentBrief): string => {
  const parts = [
    `Chủ đề: ${brief.topic}`,
    '',
    'Bốn trục điều khiển cho bài này:',
    '',
    buildAxisDirectives(brief),
    '',
    `Độ dài phần thân bài: khoảng ${brief.targetWords} chữ.`,
  ];

  if (brief.keywords.length) {
    parts.push(
      `Từ khoá cần xuất hiện tự nhiên trong bài: ${brief.keywords.join(', ')}. Đưa vào cho thuận câu, không nhồi nhét.`,
    );
  }

  if (brief.notes?.trim()) {
    parts.push('', `Ràng buộc riêng của lượt này: ${brief.notes.trim()}`);
  }

  if (brief.origin) {
    parts.push(
      '',
      `Chủ đề lấy từ ${brief.origin.sourceLabel}. Đây là tin đang nóng, hãy viết sao cho người đọc thấy được vì sao nó đáng chú ý lúc này.`,
    );
  }

  parts.push(
    '',
    'Trả về đúng một đối tượng JSON, không kèm chữ nào khác, theo cấu trúc:',
    '{',
    '  "title": "tiêu đề bài, tối đa 70 ký tự, không dùng dấu hai chấm sáo rỗng",',
    '  "sapo": "đoạn mở dưới tiêu đề, 2-3 câu, nêu được vì sao đáng đọc",',
    '  "sections": [{ "heading": "tiêu đề mục", "body": "nội dung mục, có thể nhiều đoạn" }],',
    '  "hashtags": ["khong_dau_cach", "..."],',
    '  "seoTitle": "tiêu đề cho kết quả tìm kiếm, tối đa 60 ký tự",',
    '  "metaDescription": "mô tả cho kết quả tìm kiếm, tối đa 155 ký tự"',
    '}',
  );

  return parts.join('\n');
};

/** Ước lượng thời gian đọc. Người Việt đọc khoảng 200 chữ mỗi phút. */
export const estimateReadingMinutes = (draft: Omit<ArticleDraft, 'readingMinutes'>): number => {
  const words = [draft.sapo, ...draft.sections.flatMap((s) => [s.heading, s.body])]
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
};

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeHashtag = (value: unknown): string =>
  asText(value)
    .replace(/^#+/, '')
    .replace(/\s+/g, '_')
    .trim();

/**
 * Chuẩn hoá phản hồi thô của mô hình thành `ArticleDraft`.
 *
 * Tách riêng khỏi phần gọi mạng để kiểm thử được mà không cần model thật. Mô
 * hình hay trả thiếu trường hoặc sai kiểu, nên mọi trường đều có đường lui.
 */
export const normalizeArticleDraft = (raw: unknown, brief: ContentBrief): ArticleDraft => {
  const source = (raw ?? {}) as Record<string, unknown>;

  const sections: ArticleSection[] = Array.isArray(source.sections)
    ? source.sections
        .map((item) => {
          const entry = (item ?? {}) as Record<string, unknown>;
          return { heading: asText(entry.heading), body: asText(entry.body) };
        })
        .filter((section) => section.body.length > 0)
    : [];

  if (!sections.length) {
    throw new Error('Mô hình không trả về phần thân bài nào. Hãy thử lại hoặc đổi mô hình.');
  }

  const title = asText(source.title) || brief.topic;
  const sapo = asText(source.sapo);
  const seoTitle = asText(source.seoTitle) || title.slice(0, 60);
  const metaDescription =
    asText(source.metaDescription) || sapo.slice(0, 155) || title.slice(0, 155);

  const hashtags = Array.isArray(source.hashtags)
    ? Array.from(new Set(source.hashtags.map(normalizeHashtag).filter(Boolean))).slice(0, 12)
    : [];

  const draft = { title, sapo, sections, hashtags, seoTitle, metaDescription };
  return { ...draft, readingMinutes: estimateReadingMinutes(draft) };
};

/** Ghép bài thành Markdown để xem trước hoặc xuất ra ngoài. */
export const articleToMarkdown = (draft: ArticleDraft): string => {
  const parts = [`# ${draft.title}`, '', `**${draft.sapo}**`, ''];
  for (const section of draft.sections) {
    if (section.heading) parts.push(`## ${section.heading}`, '');
    parts.push(section.body, '');
  }
  if (draft.hashtags.length) {
    parts.push(draft.hashtags.map((tag) => `#${tag}`).join(' '), '');
  }
  return parts.join('\n').trimEnd() + '\n';
};

export interface GenerateArticleOptions {
  /**
   * Brand Kit của khách hàng. Có thì tone of voice, từ bắt buộc, từ cấm và CTA
   * đã duyệt được đưa vào prompt, nên bài ra đúng thương hiệu ngay từ đầu thay
   * vì phải sửa ở vòng kiểm tra.
   */
  brandKit?: BrandKit | null;
  /** Nhãn ngắn để quy chi phí về đúng thao tác. projectId tự gắn từ context. */
  usageResourceId?: string;
  /** Cho phép thay hàm gọi model khi kiểm thử. */
  chat?: typeof callChatApi;
}

export const generateArticle = async (
  brief: ContentBrief,
  options: GenerateArticleOptions = {},
): Promise<ArticleDraft> => {
  if (!brief.topic.trim()) {
    throw new Error('Chưa có chủ đề. Hãy chọn một chủ đề từ bảng xu hướng hoặc tự nhập.');
  }

  const chat = options.chat ?? callChatApi;
  const systemPrompt = options.brandKit
    ? `${VIETNAMESE_WRITING_RULES}\n\n${buildBrandKitPromptContext(options.brandKit)}`
    : VIETNAMESE_WRITING_RULES;

  const response = await chat({
    systemPrompt,
    prompt: buildArticlePrompt(brief),
    responseFormat: 'json',
    usageResourceId: options.usageResourceId ?? 'content-article',
  });

  return normalizeArticleDraft(parseModelJson(response), brief);
};

/** Tóm tắt brief thành một dòng để hiện trong nhật ký và danh sách. */
export const describeBrief = (brief: ContentBrief): string =>
  [
    getIntent(brief.intent).label,
    getApproach(brief.approach).label,
    getVoice(brief.voice).label,
    getAudience(brief.audience).label,
  ].join(' · ');
