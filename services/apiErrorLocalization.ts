const REQUEST_ID_PATTERN = /(?:request\s*id|request_id)\s*[:：]\s*([a-z0-9_-]+)/i;
/**
 * Ranh giới từ nhận biết Unicode, không dùng `\b`.
 *
 * `\b` của JavaScript chỉ hiểu `[A-Za-z0-9_]`. Bảy cụm hiện tại tình cờ đều bắt
 * đầu và kết thúc bằng chữ ASCII nên `\b` vẫn chạy — nhưng thêm một cụm như
 * "đăng nhập" hay "dữ liệu" là nó **im lặng không khớp nữa**, và không có gì
 * báo. Dùng lookaround để cái bẫy đó không chờ người sau.
 */
const VIETNAMESE_MARKERS = new RegExp(
  '[ăâđêôơưĂÂĐÊÔƠƯ]|' +
    ['không', 'lỗi', 'vui lòng', 'thất bại', 'hết hạn', 'tài khoản', 'yêu cầu']
      .map((phrase) => `(?<!\\p{L})${phrase}(?!\\p{L})`)
      .join('|'),
  'iu',
);
const CJK_PATTERN = /[㐀-鿿]/;

const withRequestId = (message: string, raw: string): string => {
  const requestId = raw.match(REQUEST_ID_PATTERN)?.[1];
  return requestId ? `${message} Mã yêu cầu: ${requestId}.` : message;
};

/**
 * Loại lỗi từ nhà cung cấp.
 *
 * Phân loại có cấu trúc chứ không chỉ để hiện thông báo, vì cách xử lý khác
 * hẳn nhau: hết tiền thì thử lại bao nhiêu lần cũng vô ích, giới hạn tốc độ
 * thì chờ rồi thử lại được, còn nội dung bị chặn thì phải sửa nội dung.
 */
export type ApiErrorCategory =
  | 'balance'
  | 'rate-limit'
  | 'auth'
  | 'permission'
  | 'moderation'
  | 'server'
  | 'network'
  | 'unknown';

/**
 * Nhận diện chính những câu do hàm dịch bên dưới sinh ra.
 *
 * Nhật ký usage lưu thông báo đã việt hoá chứ không lưu lỗi gốc, nên nếu chỉ
 * dò mẫu tiếng Anh thì mọi bản ghi cũ đều rơi vào "chưa xác định". Đây là
 * chuỗi của chính ứng dụng nên khớp được chắc chắn.
 */
const LOCALIZED_MARKERS: [ApiErrorCategory, RegExp][] = [
  ['balance', /không đủ credit/i],
  ['rate-limit', /giới hạn tốc độ hoặc số tác vụ đồng thời/i],
  ['auth', /khóa api không hợp lệ hoặc đã hết hạn/i],
  ['permission', /không có quyền sử dụng mô hình/i],
  ['moderation', /bộ lọc an toàn/i],
  ['server', /đang tạm thời gián đoạn/i],
  ['network', /không thể kết nối ổn định/i],
];

export const classifyApiError = (input: unknown, status?: number): ApiErrorCategory => {
  const raw = String(input ?? '').trim();
  const normalized = raw.toLowerCase();

  for (const [category, pattern] of LOCALIZED_MARKERS) {
    if (pattern.test(raw)) return category;
  }

  const isBalanceError =
    status === 402 ||
    /insufficient\s*(balance|credit|credits|funds)|balance\s*(is\s*)?(zero|insufficient)|credit\s*balance\s*(is\s*)?(zero|insufficient)/.test(normalized) ||
    /额度不足|剩余额度/.test(raw);
  if (isBalanceError) return 'balance';

  const isRateLimitError =
    status === 429 ||
    /too\s*many\s*requests|rate[\s_-]*limit|concurren(t|cy)|task\s*limit|queue\s*(is\s*)?full|quota|resource_exhausted/.test(normalized);
  if (isRateLimitError) return 'rate-limit';

  if (status === 401 || /invalid\s*(api\s*)?key|unauthorized|authentication/.test(normalized)) return 'auth';
  if (status === 403 || /forbidden|permission\s*denied|access\s*denied/.test(normalized)) return 'permission';
  if (/safety|moderation|content\s*policy|blocked/.test(normalized)) return 'moderation';
  if (status && status >= 500) return 'server';
  // "failed to fetch" là chuỗi trình duyệt ném ra khi đứt mạng, phổ biến nhất
  // trong nhóm này. Mẫu cũ chỉ bắt "fetch failed" nên bỏ lọt đúng ca hay gặp.
  if (
    /timeout|timed\s*out|network|fetch\s*failed|failed\s*to\s*fetch|load\s*failed|econnreset|etimedout|enotfound|econnrefused/.test(
      normalized,
    )
  ) {
    return 'network';
  }

  return 'unknown';
};

/**
 * Lỗi này có phải do nhà cung cấp đang trục trặc không.
 *
 * Dùng để quyết định có ngắt mạch nhà cung cấp hay không. Hết tiền, khóa sai,
 * thiếu quyền hay nội dung bị chặn đều là vấn đề của tài khoản hoặc của nội
 * dung; chuyển sang nhà cung cấp khác cũng hỏng y hệt, nên ngắt mạch trong
 * những trường hợp đó chỉ làm mất oan các lựa chọn còn tốt.
 */
export const isProviderSideFailure = (category: ApiErrorCategory): boolean =>
  category === 'rate-limit' || category === 'server' || category === 'network';

export const API_ERROR_CATEGORY_LABELS: Record<ApiErrorCategory, string> = {
  balance: 'Hết số dư',
  'rate-limit': 'Giới hạn tốc độ hoặc đồng thời',
  auth: 'Khóa API không hợp lệ',
  permission: 'Không đủ quyền',
  moderation: 'Bị bộ lọc nội dung chặn',
  server: 'Nhà cung cấp gián đoạn',
  network: 'Lỗi kết nối',
  unknown: 'Chưa xác định',
};

const CATEGORY_MESSAGES: Partial<Record<ApiErrorCategory, string>> = {
  balance:
    'Tài khoản API không đủ credit để thực hiện yêu cầu này. Vui lòng kiểm tra số dư hoặc chọn mô hình tiết kiệm hơn.',
  'rate-limit':
    'Nhà cung cấp đang giới hạn tốc độ hoặc số tác vụ đồng thời; đây không phải lỗi khóa API hay hết tiền. Ứng dụng sẽ giãn các yêu cầu, hãy chạy lại mục bị lỗi sau ít phút.',
  auth: 'Khóa API không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra và lưu lại khóa.',
  permission: 'Tài khoản API không có quyền sử dụng mô hình hoặc tính năng này.',
  moderation: 'Yêu cầu bị chặn bởi bộ lọc an toàn. Vui lòng điều chỉnh nội dung rồi thử lại.',
  server: 'Dịch vụ AI đang tạm thời gián đoạn. Vui lòng thử lại sau ít phút.',
  network: 'Không thể kết nối ổn định tới dịch vụ AI. Vui lòng kiểm tra mạng và thử lại.',
};

/** Chuyển thông báo lỗi từ nhà cung cấp thành nội dung tiếng Việt an toàn cho giao diện. */
export const localizeApiErrorMessage = (input: unknown, status?: number): string => {
  const raw = String(input ?? '').trim();
  const message = CATEGORY_MESSAGES[classifyApiError(input, status)];
  if (message) return withRequestId(message, raw);

  if (raw && VIETNAMESE_MARKERS.test(raw) && !CJK_PATTERN.test(raw)) {
    return raw;
  }

  return withRequestId(
    status ? `Yêu cầu tới dịch vụ AI thất bại (mã HTTP ${status}).` : 'Yêu cầu tới dịch vụ AI thất bại.',
    raw
  );
};
