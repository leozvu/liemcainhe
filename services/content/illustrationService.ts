import { BrandKit } from '../../types';
import { AspectRatio, ImageGenerateOptions, MediaExecutionContext } from '../../types/model';
import { ArticleDraft, ArticleIllustration, ContentBrief } from '../../types/content';
import { callChatApi } from '../adapters/chatAdapter';
import { buildBrandVisualGuardrails } from '../brandKitService';
import { parseModelJson } from '../jsonResponse';
import { generateImage } from '../modelService';
import { getAudience, getVoice } from './contentAxes';

/**
 * Ảnh minh hoạ cho bài viết.
 *
 * Cố ý tách làm hai bước: lên ý tưởng ảnh (rẻ, dùng model chat) rồi mới vẽ
 * (đắt, dùng model ảnh). Người dùng đọc và sửa được prompt trước khi bấm vẽ.
 * Tự động vẽ hàng loạt là cách nhanh nhất để đốt credit vào những tấm ảnh
 * không ai dùng.
 */

const ILLUSTRATION_RULES = `Bạn là giám đốc hình ảnh, lên ý tưởng ảnh minh hoạ cho bài viết của một hãng nội dung Việt Nam.

Quy tắc bắt buộc:
- Prompt vẽ ảnh viết bằng tiếng Anh, vì model ảnh hiểu tiếng Anh tốt hơn nhiều.
- Mô tả thay thế (altText) viết bằng tiếng Việt, cho người dùng trình đọc màn hình.
- Ảnh phải minh hoạ được ý của bài, không phải ảnh trang trí chung chung.
- Nếu bài nói về người Việt hoặc bối cảnh Việt Nam thì prompt phải nêu rõ điều đó, nếu không model sẽ mặc định vẽ người phương Tây.
- Không đưa chữ vào ảnh: model ảnh viết chữ rất tệ, càng tệ với tiếng Việt có dấu.
- Không mô tả người có thật, logo có thật hay thương hiệu có thật.
- Tránh ảnh stock sáo rỗng như bắt tay trong phòng họp hay biểu đồ mũi tên đi lên.`;

/** Tỷ lệ mặc định theo vai trò của ảnh. */
export const DEFAULT_ASPECT: Record<ArticleIllustration['purpose'], AspectRatio> = {
  cover: '16:9',
  section: '1:1',
};

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const makeId = (purpose: string, index: number, seed: number): string =>
  `ill_${purpose}_${index}_${seed.toString(36)}`;

export interface PlanIllustrationsOptions {
  /** Số ảnh cho các mục, ngoài ảnh bìa. 0 nghĩa là chỉ làm ảnh bìa. */
  sectionCount?: number;
  brandKit?: BrandKit | null;
  usageResourceId?: string;
  chat?: typeof callChatApi;
  /** Cho phép cố định id khi kiểm thử. */
  seed?: number;
}

/**
 * Chuẩn hoá phản hồi thô thành danh sách ảnh cần vẽ.
 *
 * Tách khỏi phần gọi mạng để kiểm thử được mà không cần model thật.
 */
export const normalizeIllustrationPlan = (
  raw: unknown,
  draft: ArticleDraft,
  sectionCount: number,
  seed: number,
): ArticleIllustration[] => {
  const source = (raw ?? {}) as Record<string, unknown>;
  const plans: ArticleIllustration[] = [];

  const cover = (source.cover ?? {}) as Record<string, unknown>;
  const coverPrompt = asText(cover.prompt);
  if (coverPrompt) {
    plans.push({
      id: makeId('cover', 0, seed),
      purpose: 'cover',
      prompt: coverPrompt,
      altText: asText(cover.altText) || draft.title,
      aspectRatio: DEFAULT_ASPECT.cover,
      status: 'draft',
    });
  }

  const sections = Array.isArray(source.sections) ? source.sections : [];
  for (let i = 0; i < Math.min(sections.length, sectionCount); i += 1) {
    const entry = (sections[i] ?? {}) as Record<string, unknown>;
    const prompt = asText(entry.prompt);
    if (!prompt) continue;

    // Mô hình có thể trả chỉ số mục ngoài phạm vi; kẹp lại cho an toàn.
    const rawIndex = Number(entry.sectionIndex);
    const sectionIndex = Number.isInteger(rawIndex)
      ? Math.max(0, Math.min(draft.sections.length - 1, rawIndex))
      : i;

    plans.push({
      id: makeId('section', i, seed),
      purpose: 'section',
      sectionIndex,
      prompt,
      altText: asText(entry.altText) || draft.sections[sectionIndex]?.heading || draft.title,
      aspectRatio: DEFAULT_ASPECT.section,
      status: 'draft',
    });
  }

  if (!plans.length) {
    throw new Error('Mô hình không đề xuất được ảnh nào. Hãy thử lại hoặc đổi mô hình.');
  }

  return plans;
};

/** Bước một: lên ý tưởng ảnh. Dùng model chat nên rẻ. */
export const planIllustrations = async (
  draft: ArticleDraft,
  brief: ContentBrief,
  options: PlanIllustrationsOptions = {},
): Promise<ArticleIllustration[]> => {
  const sectionCount = Math.max(0, Math.min(options.sectionCount ?? 0, draft.sections.length));
  const chat = options.chat ?? callChatApi;

  const guardrails = options.brandKit ? buildBrandVisualGuardrails(options.brandKit) : '';
  const systemPrompt = guardrails
    ? `${ILLUSTRATION_RULES}\n\nRÀNG BUỘC THƯƠNG HIỆU:\n${guardrails}`
    : ILLUSTRATION_RULES;

  const prompt = [
    `Tiêu đề bài: ${draft.title}`,
    `Mở bài: ${draft.sapo}`,
    '',
    'Các mục trong bài:',
    ...draft.sections.map((section, index) => `${index}. ${section.heading || '(không tiêu đề)'} — ${section.body.slice(0, 160)}`),
    '',
    `Người đọc: ${getAudience(brief.audience).label}. Giọng bài viết: ${getVoice(brief.voice).label}.`,
    '',
    `Hãy đề xuất một ảnh bìa${sectionCount > 0 ? ` và ${sectionCount} ảnh cho các mục quan trọng nhất` : ''}.`,
    '',
    'Trả về đúng một đối tượng JSON, không kèm chữ nào khác:',
    '{',
    '  "cover": { "prompt": "prompt tiếng Anh để vẽ ảnh bìa", "altText": "mô tả tiếng Việt" },',
    sectionCount > 0
      ? '  "sections": [{ "sectionIndex": 0, "prompt": "prompt tiếng Anh", "altText": "mô tả tiếng Việt" }]'
      : '  "sections": []',
    '}',
  ].join('\n');

  const response = await chat({
    systemPrompt,
    prompt,
    responseFormat: 'json',
    usageResourceId: options.usageResourceId ?? 'content-illustration-plan',
  });

  return normalizeIllustrationPlan(
    parseModelJson(response),
    draft,
    sectionCount,
    options.seed ?? Date.now(),
  );
};

export interface RenderIllustrationOptions {
  usageResourceId?: string;
  execution?: MediaExecutionContext;
  image?: (options: ImageGenerateOptions) => Promise<string>;
}

/**
 * Bước hai: vẽ một ảnh. Đây là bước tốn tiền.
 *
 * Vẽ từng ảnh một chứ không vẽ cả loạt, để người dùng dừng lại được giữa
 * chừng khi thấy ảnh đầu đã sai hướng.
 */
export const renderIllustration = async (
  illustration: ArticleIllustration,
  options: RenderIllustrationOptions = {},
): Promise<ArticleIllustration> => {
  if (!illustration.prompt.trim()) {
    return { ...illustration, status: 'failed', error: 'Prompt rỗng, không có gì để vẽ.' };
  }

  const image = options.image ?? generateImage;
  try {
    const imageUrl = await image({
      prompt: illustration.prompt,
      aspectRatio: illustration.aspectRatio,
      usageResourceId: options.usageResourceId ?? `content-illustration-${illustration.purpose}`,
      execution: options.execution,
    });
    return { ...illustration, imageUrl, status: 'done', error: undefined };
  } catch (error) {
    return {
      ...illustration,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Vẽ ảnh thất bại.',
    };
  }
};

/** Ảnh bìa đã vẽ xong, dùng làm ảnh đại diện khi đăng. */
export const getCoverImage = (draft: ArticleDraft): string | undefined =>
  draft.illustrations?.find((item) => item.purpose === 'cover' && item.status === 'done')?.imageUrl;

/** Đếm số ảnh đã vẽ xong, để hiện tiến độ. */
export const countRendered = (illustrations: ArticleIllustration[] = []): number =>
  illustrations.filter((item) => item.status === 'done').length;
