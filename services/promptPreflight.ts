import { BrandKit } from '../types';
import { AppLocale } from './i18n';
import { callChatApi } from './adapters/chatAdapter';
import { normalizeBrandKit } from './brandKitService';
import { parseModelJson } from './jsonResponse';
import { getUsagePolicy } from './usageService';

/**
 * Thẩm định prompt trước khi tiêu tiền.
 *
 * AI Supervisor kiểm *sau khi* đã sinh xong, tức là tiền đã mất rồi mới biết
 * hỏng. Lớp này chạy *trước*: một model chat rẻ đọc prompt và đoán trước những
 * lỗi chắc chắn sẽ dẫn tới phải sinh lại.
 *
 * Hai tầng, cùng kiểu với AI Supervisor:
 *
 * - **Luật cục bộ**: miễn phí, tức thời, bắt những lỗi hiển nhiên. Chạy trước
 *   để không tốn một lời gọi nào cho các ca rõ ràng.
 * - **Model chấm**: chỉ chạy khi luật cục bộ không chặn, để soi phần ngữ nghĩa
 *   mà biểu thức chính quy không thấy được.
 *
 * Tỷ lệ chi phí là lý do lớp này đáng tồn tại: một lần chấm bằng model chat rẻ
 * hơn một lần sinh video khoảng năm mươi lần.
 */

export type PreflightVerdict = 'pass' | 'warn' | 'block';

export type PreflightIssueCode =
  | 'empty'
  | 'too-vague'
  | 'text-in-image'
  | 'contradiction'
  | 'brand-forbidden'
  | 'missing-reference'
  | 'unsupported-request'
  | 'model-flagged';

export interface PreflightIssue {
  code: PreflightIssueCode;
  severity: 'warn' | 'block';
  message: string;
  /** Cách sửa cụ thể, không phải lời khuyên chung chung. */
  fix?: string;
}

export interface PreflightReport {
  verdict: PreflightVerdict;
  issues: PreflightIssue[];
  /** Prompt đã sửa, khi model đề xuất được bản tốt hơn. */
  revisedPrompt?: string;
  /** Số tiền ước tính tránh được nếu chặn ở đây. */
  estimatedSavedUsd?: number;
  checkedAt: number;
}

export type PreflightTarget = 'image' | 'video';

export interface PreflightInput {
  prompt: string;
  target: PreflightTarget;
  brandKit?: BrandKit | null;
  /** Có ảnh tham chiếu kèm theo không. */
  hasReference?: boolean;
  /** Model bắt buộc phải có ảnh tham chiếu mới chạy được. */
  requiresReference?: boolean;
  /** Thời lượng video, dùng để ước tính tiền tránh được. */
  durationSeconds?: number;
}

/** Prompt ngắn hơn ngần này gần như chắc chắn thiếu mô tả chủ thể. */
const MIN_PROMPT_WORDS = 6;

/**
 * Dấu hiệu đòi chữ trong ảnh.
 *
 * Model ảnh viết chữ rất tệ, và tệ hơn hẳn với tiếng Việt có dấu. Đây là
 * nguyên nhân sinh lại phổ biến mà lại phát hiện được bằng luật, không cần AI.
 */
const TEXT_IN_IMAGE = [
  /\btext\b/i,
  /\bwords?\b/i,
  /\bcaption\b/i,
  /\btypograph/i,
  /\bwritten\b/i,
  /\bsign (?:that )?(?:says|reading)\b/i,
  // Tiếng Việt phải dùng ranh giới nhận biết Unicode. `\b` của JavaScript chỉ
  // hiểu ký tự ASCII nên `\bchữ\b` không bao giờ khớp: `ữ` không thuộc `\w`.
  /(?<!\p{L})chữ(?!\p{L})/iu,
  /(?<!\p{L})viết(?!\p{L})/iu,
  /["“][^"”]{2,}["”]/,
];

/**
 * Dựng biểu thức khớp cụm từ với ranh giới nhận biết Unicode.
 *
 * Bắt buộc phải làm thế cho tiếng Việt: `\b` của JavaScript chỉ hiểu `[A-Za-z0-9_]`,
 * nên `\bđêm khuya\b` không bao giờ khớp vì `đ` không thuộc nhóm đó, và
 * `\bmàu sắc rực rỡ\b` cũng hỏng vì kết thúc bằng `ỡ`. Lỗi này im lặng: luật
 * vẫn chạy, chỉ là không bao giờ bắt được gì.
 */
const anyOf = (...phrases: string[]): RegExp =>
  new RegExp(
    phrases.map((phrase) => `(?<!\\p{L})${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`).join('|'),
    'iu',
  );

/** Cặp khái niệm không thể cùng đúng trong một khung hình. */
const CONTRADICTIONS: [RegExp, RegExp, string][] = [
  [
    anyOf('night', 'ban đêm', 'đêm khuya'),
    anyOf('bright sunlight', 'nắng gắt', 'giữa trưa'),
    'ban đêm nhưng lại nắng gắt',
  ],
  [
    anyOf('close-up', 'closeup', 'cận cảnh'),
    anyOf('wide shot', 'toàn cảnh', 'viễn cảnh'),
    'vừa cận cảnh vừa toàn cảnh',
  ],
  [
    anyOf('minimalist', 'tối giản'),
    anyOf('highly detailed', 'cực kỳ chi tiết', 'nhiều chi tiết'),
    'vừa tối giản vừa cực kỳ chi tiết',
  ],
  [
    anyOf('black and white', 'đen trắng'),
    anyOf('vibrant colors', 'vibrant colours', 'màu sắc rực rỡ'),
    'vừa đen trắng vừa màu rực rỡ',
  ],
];

const wordCount = (value: string): number => value.trim().split(/\s+/).filter(Boolean).length;

/**
 * Tầng luật cục bộ. Không gọi mạng, không tốn tiền.
 *
 * Tách riêng và xuất ra để kiểm thử được từng luật, và để chỗ gọi có thể chạy
 * riêng tầng này khi muốn phản hồi tức thời trong lúc người dùng đang gõ.
 */
export const runLocalPreflight = (input: PreflightInput): PreflightIssue[] => {
  const issues: PreflightIssue[] = [];
  const prompt = input.prompt.trim();

  if (!prompt) {
    return [{ code: 'empty', severity: 'block', message: 'Prompt rỗng, không có gì để sinh.' }];
  }

  if (wordCount(prompt) < MIN_PROMPT_WORDS) {
    issues.push({
      code: 'too-vague',
      severity: 'block',
      message: `Prompt chỉ có ${wordCount(prompt)} từ, quá ngắn để model biết cần vẽ gì.`,
      fix: 'Nêu rõ chủ thể, bối cảnh và ánh sáng. Tả không khí thôi thì model sẽ tự bịa chủ thể.',
    });
  }

  const textHit = TEXT_IN_IMAGE.find((pattern) => pattern.test(prompt));
  if (textHit) {
    issues.push({
      code: 'text-in-image',
      severity: 'warn',
      message: 'Prompt đang yêu cầu chữ trong ảnh.',
      fix: 'Model ảnh viết chữ rất tệ, càng tệ với tiếng Việt có dấu. Bỏ phần chữ ra và chèn bằng công cụ dựng.',
    });
  }

  for (const [first, second, label] of CONTRADICTIONS) {
    if (first.test(prompt) && second.test(prompt)) {
      issues.push({
        code: 'contradiction',
        severity: 'warn',
        message: `Prompt mâu thuẫn: ${label}.`,
        fix: 'Bỏ một trong hai vế, nếu không model sẽ tự chọn và thường chọn sai ý bạn.',
      });
    }
  }

  if (input.brandKit) {
    const kit = normalizeBrandKit(input.brandKit);
    const lower = prompt.toLocaleLowerCase('vi');
    const hits = kit.forbiddenTerms.filter((term) => lower.includes(term.toLocaleLowerCase('vi')));
    if (hits.length) {
      issues.push({
        code: 'brand-forbidden',
        severity: 'block',
        message: `Prompt chứa từ cấm của khách: ${hits.map((term) => `“${term}”`).join(', ')}.`,
        fix: 'Bỏ hoặc thay từ đó trước khi sinh.',
      });
    }
  }

  if (input.requiresReference && !input.hasReference) {
    issues.push({
      code: 'missing-reference',
      severity: 'block',
      message: 'Model này bắt buộc phải có ảnh tham chiếu nhưng chưa có ảnh nào.',
      fix: 'Thêm ảnh định trang nhân vật hoặc ảnh bối cảnh, hoặc đổi sang model sinh từ văn bản thuần.',
    });
  }

  return issues;
};

/** Ước tính số tiền tránh được nếu chặn tại đây. */
export const estimateSavedCost = (input: PreflightInput): number => {
  const rates = getUsagePolicy().rates;
  if (input.target === 'video') {
    return Math.round(rates.videoPerSecond * (input.durationSeconds ?? 8) * 100) / 100;
  }
  return Math.round(rates.imagePerOutput * 100) / 100;
};

const JUDGE_RULES = `Bạn là giám đốc hình ảnh soát prompt trước khi đưa vào model sinh ảnh hoặc video.

Nhiệm vụ: tìm những lỗi khiến kết quả chắc chắn phải sinh lại. Sinh lại tốn tiền thật, nên chỉ nêu lỗi bạn thật sự tin, đừng nêu ý thích cá nhân.

Chỉ báo lỗi khi thuộc các nhóm sau:
- Không rõ chủ thể: prompt chỉ tả không khí, model sẽ tự bịa ra người hoặc vật.
- Mâu thuẫn nội tại: hai yêu cầu không thể cùng đúng trong một khung hình.
- Vượt khả năng model: chữ trong ảnh, bàn tay cầm vật thể phức tạp, nhiều nhân vật có danh tính riêng trong một khung.
- Thiếu bối cảnh địa phương: nội dung nói về người Việt hoặc Việt Nam nhưng prompt không nêu, model sẽ mặc định vẽ người phương Tây.

KHÔNG báo lỗi vì prompt ngắn gọn, vì thiếu tính từ hoa mỹ, hay vì bạn muốn thêm chi tiết cho đẹp.

Nếu sửa được, đưa ra bản prompt đã sửa giữ nguyên ý định gốc, chỉ bổ sung phần còn thiếu.`;

export interface PreflightOptions {
  chat?: typeof callChatApi;
  /** Bỏ qua tầng model, chỉ chạy luật cục bộ. */
  localOnly?: boolean;
  usageResourceId?: string;
  now?: () => number;
}

/**
 * Chuẩn hoá phản hồi của model chấm.
 *
 * Tách riêng để kiểm thử được mà không cần model thật.
 */
export const normalizeJudgeResponse = (raw: unknown): { issues: PreflightIssue[]; revisedPrompt?: string } => {
  const source = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(source.issues) ? source.issues : [];

  const issues: PreflightIssue[] = list
    .map((entry): PreflightIssue | null => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const message = typeof row.message === 'string' ? row.message.trim() : '';
      if (!message) return null;
      return {
        code: 'model-flagged' as const,
        // Model không được tự ý chặn: nó hay quá tay. Chặn là quyền của luật
        // cục bộ, vốn xác định và kiểm chứng được.
        severity: 'warn' as const,
        message,
        fix: typeof row.fix === 'string' && row.fix.trim() ? row.fix.trim() : undefined,
      };
    })
    .filter((issue): issue is PreflightIssue => issue !== null);

  const revised = typeof source.revisedPrompt === 'string' ? source.revisedPrompt.trim() : '';
  return { issues, revisedPrompt: revised || undefined };
};

const verdictFrom = (issues: PreflightIssue[]): PreflightVerdict => {
  if (issues.some((issue) => issue.severity === 'block')) return 'block';
  return issues.length ? 'warn' : 'pass';
};

export const preflightPrompt = async (
  input: PreflightInput,
  options: PreflightOptions = {},
): Promise<PreflightReport> => {
  const now = (options.now ?? Date.now)();
  const local = runLocalPreflight(input);

  // Đã chặn ở tầng luật thì không tốn thêm một lời gọi nào nữa.
  if (options.localOnly || local.some((issue) => issue.severity === 'block')) {
    return {
      verdict: verdictFrom(local),
      issues: local,
      estimatedSavedUsd: local.some((issue) => issue.severity === 'block')
        ? estimateSavedCost(input)
        : undefined,
      checkedAt: now,
    };
  }

  const chat = options.chat ?? callChatApi;
  const kit = input.brandKit ? normalizeBrandKit(input.brandKit) : undefined;

  const prompt = [
    `Loại đầu ra: ${input.target === 'video' ? 'video' : 'ảnh tĩnh'}`,
    `Có ảnh tham chiếu kèm theo: ${input.hasReference ? 'có' : 'không'}`,
    kit?.forbiddenTerms.length ? `Từ cấm của khách: ${kit.forbiddenTerms.join(', ')}` : '',
    '',
    'Prompt cần soát:',
    input.prompt.trim(),
    '',
    'Trả về đúng một đối tượng JSON, không kèm chữ nào khác:',
    '{ "issues": [{ "message": "lỗi là gì", "fix": "sửa thế nào" }], "revisedPrompt": "bản đã sửa, hoặc chuỗi rỗng nếu không cần sửa" }',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await chat({
      systemPrompt: JUDGE_RULES,
      prompt,
      responseFormat: 'json',
      usageResourceId: options.usageResourceId ?? 'preflight-judge',
    });

    const judged = normalizeJudgeResponse(parseModelJson(response));
    const issues = [...local, ...judged.issues];

    return {
      verdict: verdictFrom(issues),
      issues,
      revisedPrompt: judged.revisedPrompt,
      checkedAt: now,
    };
  } catch {
    // Model chấm hỏng thì không được chặn việc sinh: đây là lớp hỗ trợ, không
    // phải cổng bắt buộc. Trả về kết quả của tầng luật cục bộ.
    return { verdict: verdictFrom(local), issues: local, checkedAt: now };
  }
};

/**
 * Brand Kit của dự án đang mở.
 *
 * Dùng biến toàn cục theo đúng mẫu `setUsageProjectContext` sẵn có, để cổng
 * chặn nằm được ngay trong `generateImage` và `generateVideo` mà không phải
 * đổi chữ ký của chúng — hai hàm đó được gọi từ rất nhiều nơi.
 */
let activeBrandKit: BrandKit | undefined;

export const setPreflightBrandKit = (kit?: BrandKit | null): void => {
  activeBrandKit = kit ?? undefined;
};

/**
 * Những lỗi chắc chắn sai, chặn được mà không sợ oan.
 *
 * Cố ý **không** gồm `too-vague`: đó là suy đoán theo số từ, và luồng sẵn có
 * của dự án có thể đang dùng prompt ngắn hợp lệ. Chặn nhầm một lượt sinh đúng
 * gây bực hơn là để lọt một lượt sinh hỏng.
 *
 * Cũng không gồm `missing-reference` vì `selectImageModelForGeneration` đã tự
 * chuyển sang model sinh từ văn bản khi thiếu ảnh tham chiếu.
 */
const CERTAIN_BLOCK: PreflightIssueCode[] = ['empty', 'brand-forbidden'];

export class PreflightBlockedError extends Error {
  readonly issues: PreflightIssue[];

  constructor(issues: PreflightIssue[]) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'PreflightBlockedError';
    this.issues = issues;
  }
}

/**
 * Cổng chặn tự động, đặt ngay trước mọi lời gọi sinh ảnh và video.
 *
 * Chỉ chạy luật cục bộ nên **không tốn tiền và không thêm độ trễ**. Không gọi
 * model chấm ở đây: tầng đó cần người đọc và quyết, nên chỉ chạy ở giao diện.
 */
export const assertGenerationAllowed = (
  prompt: string,
  target: PreflightTarget,
  brandKit: BrandKit | null | undefined = activeBrandKit,
): void => {
  const blocking = runLocalPreflight({ prompt, target, brandKit }).filter(
    (issue) => issue.severity === 'block' && CERTAIN_BLOCK.includes(issue.code),
  );
  if (blocking.length) throw new PreflightBlockedError(blocking);
};

/** Một dòng tóm tắt để hiện cạnh nút sinh. */
export const describePreflight = (report: PreflightReport, locale: AppLocale = 'vi'): string => {
  if (report.verdict === 'pass') return locale === 'en' ? 'Prompt passed and is ready to render.' : 'Prompt ổn, sinh được.';
  const blocking = report.issues.filter((issue) => issue.severity === 'block').length;
  if (blocking) {
    const saved = report.estimatedSavedUsd;
    return locale === 'en'
      ? `Blocked ${blocking} definite ${blocking === 1 ? 'issue' : 'issues'}${saved ? `, avoiding about USD ${saved}` : ''}.`
      : `Chặn ${blocking} lỗi chắc chắn hỏng${saved ? `, tránh tốn khoảng ${saved} USD` : ''}.`;
  }
  return locale === 'en'
    ? `${report.issues.length} ${report.issues.length === 1 ? 'item needs' : 'items need'} review before rendering.`
    : `${report.issues.length} điểm nên xem lại trước khi sinh.`;
};

export const describePreflightIssue = (
  issue: PreflightIssue,
  locale: AppLocale = 'vi',
): Pick<PreflightIssue, 'message' | 'fix'> => {
  if (locale === 'vi' || issue.code === 'model-flagged') return issue;

  const english: Partial<Record<PreflightIssueCode, Pick<PreflightIssue, 'message' | 'fix'>>> = {
    empty: { message: 'The prompt is empty, so there is nothing to render.', fix: 'Describe the subject, setting, and lighting.' },
    'too-vague': { message: 'The prompt is too short for the model to identify a clear subject.', fix: 'Describe the subject, setting, and lighting instead of atmosphere alone.' },
    'text-in-image': { message: 'The prompt asks the image model to render text.', fix: 'Remove the text and add it later in the editor for accurate typography.' },
    contradiction: { message: 'The prompt contains conflicting visual instructions.', fix: 'Remove one of the conflicting requirements.' },
    'brand-forbidden': { message: 'The prompt contains a term prohibited by the client Brand Kit.', fix: 'Remove or replace the prohibited term before rendering.' },
    'missing-reference': { message: 'This model requires a reference image, but none is attached.', fix: 'Attach a character or location reference, or choose a text-to-image model.' },
    'unsupported-request': { message: 'The selected model does not support this request.', fix: 'Adjust the request or choose a compatible model.' },
  };

  return english[issue.code] ?? issue;
};
