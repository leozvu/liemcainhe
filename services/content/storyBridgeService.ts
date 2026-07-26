import { BrandKit } from '../../types';
import { ArticleDraft, ContentBrief, CreativeDirection, StoryBridge, TrendItem } from '../../types/content';
import { callChatApi } from '../adapters/chatAdapter';
import { buildBrandKitPromptContext } from '../brandKitService';
import { parseModelJson } from '../jsonResponse';
import { getAudience, getVoice } from './contentAxes';
import { buildCreativeDirectionPromptContext } from './creativeDirectionService';

/**
 * Chuyển một chủ đề hoặc một bài viết thành đầu vào cho Phase 01.
 *
 * Đây là chỗ Xưởng Nội dung nối vào xưởng phim: cùng một chủ đề đang nóng,
 * một nhánh ra bài đăng, một nhánh ra phim ngắn. Đầu ra khớp với `rawScript`,
 * `targetDuration` và `visualStyle` mà Phase 01 đang nhận, nên người dùng chỉ
 * việc mở dự án phim và bấm phân tích.
 */

/** Thời lượng phim ngắn thường dùng, tính bằng giây. */
export const SHORT_FILM_DURATIONS = [30, 45, 60, 90] as const;
export type ShortFilmDuration = (typeof SHORT_FILM_DURATIONS)[number];

const STORY_RULES = `Bạn chuyển một chủ đề thành ý tưởng phim ngắn cho một hãng sản xuất Việt Nam.

Quy tắc bắt buộc:
- Viết hoàn toàn bằng tiếng Việt, đúng chính tả và đủ dấu thanh.
- Câu chuyện phải quay được trong thời lượng cho trước. Không viết ý tưởng cần bối cảnh hoành tráng hay đám đông lớn.
- Nhân vật là người Việt, bối cảnh là nơi chốn có thật ở Việt Nam.
- Có xung đột rõ ràng và một khoảnh khắc chuyển biến. Đừng chỉ mô tả không khí.
- Không bịa số liệu, tên người có thật hay tên tổ chức có thật.
- Không mở đầu bằng lời dẫn của trợ lý, không mô tả quá trình làm bài.`;

const buildStoryPrompt = (
  topic: string,
  durationSeconds: number,
  context: string[],
): string => {
  const parts = [
    `Chủ đề: ${topic}`,
    `Thời lượng phim: khoảng ${durationSeconds} giây.`,
  ];

  if (context.length) {
    parts.push('', 'Chất liệu tham khảo:', ...context.map((line) => `- ${line}`));
  }

  parts.push(
    '',
    'Trả về đúng một đối tượng JSON, không kèm chữ nào khác, theo cấu trúc:',
    '{',
    '  "logline": "một câu tóm cả phim, nêu được nhân vật, mong muốn và trở ngại",',
    '  "rawScript": "phần truyện viết liền mạch, 200-400 chữ, có mở đầu, chuyển biến và kết. Đây là văn xuôi kể chuyện, không phải kịch bản phân cảnh",',
    '  "suggestedVisualStyle": "phong cách hình ảnh gợi ý, một cụm ngắn",',
    '  "characterHints": ["tên nhân vật — mô tả ngắn về tuổi, nghề, nét nhận dạng"]',
    '}',
  );

  return parts.join('\n');
};

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Chuẩn hoá phản hồi thô thành `StoryBridge`.
 *
 * Tách riêng để kiểm thử được mà không cần model thật.
 */
export const normalizeStoryBridge = (
  raw: unknown,
  topic: string,
  durationSeconds: number,
): StoryBridge => {
  const source = (raw ?? {}) as Record<string, unknown>;
  const rawScript = asText(source.rawScript);

  if (!rawScript) {
    throw new Error('Mô hình không trả về nội dung truyện. Hãy thử lại hoặc đổi mô hình.');
  }

  const characterHints = Array.isArray(source.characterHints)
    ? source.characterHints.map(asText).filter(Boolean).slice(0, 8)
    : [];

  return {
    logline: asText(source.logline) || topic,
    rawScript,
    suggestedDurationSeconds: durationSeconds,
    suggestedVisualStyle: asText(source.suggestedVisualStyle) || 'điện ảnh, ánh sáng tự nhiên',
    characterHints,
  };
};

export interface BuildStoryBridgeOptions {
  durationSeconds?: ShortFilmDuration;
  /** Brand Kit của khách hàng, đưa vào prompt để truyện không lệch thương hiệu. */
  brandKit?: BrandKit | null;
  /** Hướng sáng tạo đã chốt ở Xưởng Nội dung, dùng chung cho bài và phim. */
  creativeDirection?: CreativeDirection | null;
  usageResourceId?: string;
  chat?: typeof callChatApi;
}

const systemPromptFor = (
  brandKit?: BrandKit | null,
  creativeDirection?: CreativeDirection | null,
): string =>
  [
    STORY_RULES,
    brandKit ? buildBrandKitPromptContext(brandKit) : '',
    buildCreativeDirectionPromptContext(creativeDirection),
  ]
    .filter(Boolean)
    .join('\n\n');

/** Dựng cầu nối từ một chủ đề nóng, chưa cần viết bài. */
export const buildStoryBridgeFromTrend = async (
  trend: TrendItem,
  options: BuildStoryBridgeOptions = {},
): Promise<StoryBridge> => {
  const duration = options.durationSeconds ?? 60;
  const chat = options.chat ?? callChatApi;

  const response = await chat({
    systemPrompt: systemPromptFor(options.brandKit, options.creativeDirection),
    prompt: buildStoryPrompt(trend.title, duration, [
      `Chủ đề đang nóng trên ${trend.sourceLabel}, đứng hạng ${trend.rank}.`,
    ]),
    responseFormat: 'json',
    usageResourceId: options.usageResourceId ?? 'content-story',
  });

  return normalizeStoryBridge(parseModelJson(response), trend.title, duration);
};

/**
 * Dựng cầu nối từ một bài đã viết.
 *
 * Dùng tiêu đề mục làm sườn thay vì đổ nguyên bài vào prompt: giữ được mạch
 * lập luận mà không tốn token cho phần thân bài, vốn không giúp gì cho việc
 * nghĩ ra một câu chuyện quay được.
 */
export const buildStoryBridgeFromArticle = async (
  draft: ArticleDraft,
  brief: ContentBrief,
  options: BuildStoryBridgeOptions = {},
): Promise<StoryBridge> => {
  const duration = options.durationSeconds ?? 60;
  const chat = options.chat ?? callChatApi;

  const context = [
    `Bài viết gốc có tiêu đề "${draft.title}".`,
    draft.sapo && `Mở bài: ${draft.sapo}`,
    draft.sections.length && `Mạch bài: ${draft.sections.map((s) => s.heading).filter(Boolean).join(' → ')}`,
    `Người xem: ${getAudience(brief.audience).label}.`,
    `Giọng mong muốn: ${getVoice(brief.voice).label}.`,
  ].filter((line): line is string => Boolean(line));

  const response = await chat({
    systemPrompt: systemPromptFor(options.brandKit, options.creativeDirection ?? brief.creativeDirection),
    prompt: buildStoryPrompt(brief.topic, duration, context),
    responseFormat: 'json',
    usageResourceId: options.usageResourceId ?? 'content-story',
  });

  return normalizeStoryBridge(parseModelJson(response), brief.topic, duration);
};

/**
 * Đổi cầu nối thành phần khởi tạo dự án phim.
 *
 * Trả về đúng những trường Phase 01 cần, để chỗ gọi chỉ việc trộn vào
 * `ProjectState` mới mà không phải biết gì về Xưởng Nội dung.
 */
export const toFilmProjectSeed = (bridge: StoryBridge, title: string) => ({
  title,
  rawScript: bridge.rawScript,
  targetDuration: `${bridge.suggestedDurationSeconds} giây`,
  language: 'Tiếng Việt',
  visualStyle: bridge.suggestedVisualStyle,
});
