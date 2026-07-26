import {
  ManagedAccount,
  ManagedAccountStatus,
  PublishChannelId,
  PublishErrorDetail,
  PublishResult,
} from '../../types/content';

/**
 * Vòng đời token đăng bài.
 *
 * Bản trước chỉ giữ câu chữ của lỗi nên không phân biệt được "token hết hạn"
 * với "sai Page ID". Hai thứ đó đòi hai cách xử lý khác hẳn: một cái phải đi
 * lấy token mới, cái kia sửa một ô nhập. Gộp chung thành "đăng thất bại" là
 * đẩy việc chẩn đoán sang cho người dùng.
 *
 * Đây là logic thuần, không gọi mạng. Nó đọc mã lỗi mà adapter đã mang về.
 */

export type TokenVerdict =
  /** Token hết hạn hoặc không còn hợp lệ. Đi lấy token mới là xong. */
  | 'expired'
  /** Người dùng gỡ ứng dụng hoặc thu hồi quyền. Phải nối lại tài khoản. */
  | 'revoked'
  /** Token còn sống nhưng thiếu quyền cho thao tác này. */
  | 'permission'
  /** Chạm trần tốc độ. Token không sao, chỉ cần chờ. */
  | 'rate-limited'
  /** Không phải chuyện token. */
  | 'unrelated';

/**
 * Mã lỗi của Meta, dùng chung cho Facebook Page và Threads.
 *
 * 190 là `OAuthException` cho mọi vấn đề về token; `error_subcode` mới nói rõ
 * là hết hạn hay bị thu hồi. Thiếu subcode thì coi là hết hạn — đó là nguyên
 * nhân phổ biến hơn nhiều, và hướng xử lý của nó cũng nhẹ hơn.
 */
const META_SUBCODE_REVOKED = new Set([
  458, // Người dùng đã gỡ ứng dụng.
  459, // Tài khoản đang bị hạn chế, phải đăng nhập lại trên nền tảng.
  460, // Mật khẩu đã đổi, phiên cũ không còn giá trị.
  467, // Token không còn hợp lệ vì người dùng đăng xuất hoặc đổi mật khẩu.
]);

const META_SUBCODE_EXPIRED = new Set([463]);

const META_PERMISSION_CODES = new Set([
  10, // Ứng dụng chưa được cấp quyền này.
  200, // Thiếu quyền cho thao tác.
  283, // Thiếu quyền quản lý Trang.
]);

const META_RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

/**
 * Mã lỗi Zalo OA.
 *
 * Zalo trả HTTP 200 kèm mã âm trong thân phản hồi, nên mã ở đây đến từ chỗ
 * khác với Meta nhưng ý nghĩa thì tương đương.
 */
const ZALO_EXPIRED = new Set([-216, -217]);
const ZALO_PERMISSION = new Set([-201, -213]);
const ZALO_RATE_LIMIT = new Set([-32, -101]);

/** Lỗi token nhìn ra được bằng chữ, khi nền tảng không trả mã. */
const TEXT_EXPIRED = /(access[_\s]?token).*(expired|invalid)|token.*(hết hạn|không hợp lệ)|session has expired/i;
const TEXT_REVOKED = /(revoked|removed the app|deauthorized)|thu hồi|đã gỡ ứng dụng/i;

/**
 * Lỗi này nói gì về token.
 *
 * Ưu tiên mã số. Chỉ dò chữ khi không có mã — chữ thì nền tảng đổi lúc nào
 * cũng được, còn mã thì ổn định hơn nhiều.
 */
export const classifyAuthFailure = (
  channelId: PublishChannelId,
  detail?: PublishErrorDetail,
): TokenVerdict => {
  if (!detail) return 'unrelated';

  const { code, subcode, httpStatus, message, type } = detail;

  if (channelId === 'zalo-oa') {
    if (code !== undefined) {
      if (ZALO_EXPIRED.has(code)) return 'expired';
      if (ZALO_PERMISSION.has(code)) return 'permission';
      if (ZALO_RATE_LIMIT.has(code)) return 'rate-limited';
    }
  } else {
    // Trần tốc độ và thiếu quyền xét trước: chúng cũng đi kèm subcode, và
    // đánh dấu tài khoản hỏng vì chạm trần tốc độ là kết luận sai đắt tiền.
    if (code !== undefined) {
      if (META_RATE_LIMIT_CODES.has(code)) return 'rate-limited';
      if (META_PERMISSION_CODES.has(code)) return 'permission';
    }

    // `type` phải xét ngoài nhánh trên: Threads có lúc trả `OAuthException`
    // mà không kèm mã số nào.
    if (code === 190 || type === 'OAuthException') {
      if (subcode !== undefined && META_SUBCODE_REVOKED.has(subcode)) return 'revoked';
      if (subcode !== undefined && META_SUBCODE_EXPIRED.has(subcode)) return 'expired';
      // Không có subcode thì mặc định là hết hạn: phổ biến hơn, và hướng xử
      // lý nhẹ hơn nên đoán sai cũng ít thiệt hại.
      return 'expired';
    }
  }

  if (TEXT_REVOKED.test(message)) return 'revoked';
  if (TEXT_EXPIRED.test(message)) return 'expired';

  // 401/403 không kèm mã: gần như chắc chắn là chuyện token, nhưng không đủ
  // căn cứ nói là hết hạn hay bị thu hồi.
  if (httpStatus === 401) return 'expired';
  if (httpStatus === 403) return 'permission';

  return 'unrelated';
};

/** Trạng thái tài khoản tương ứng với một phán quyết. */
const STATUS_BY_VERDICT: Partial<Record<TokenVerdict, ManagedAccountStatus>> = {
  expired: 'token-expired',
  revoked: 'revoked',
};

export interface AccountStatusChange {
  accountId: string;
  from: ManagedAccountStatus;
  to: ManagedAccountStatus;
  verdict: TokenVerdict;
  reason: string;
}

export const describeVerdict = (verdict: TokenVerdict): string => {
  switch (verdict) {
    case 'expired':
      return 'Token đã hết hạn hoặc không còn hợp lệ. Lấy token mới rồi nhập lại.';
    case 'revoked':
      return 'Quyền đã bị thu hồi bên nền tảng. Phải nối lại tài khoản từ đầu.';
    case 'permission':
      return 'Token còn sống nhưng thiếu quyền cho thao tác này. Kiểm tra lại quyền của ứng dụng.';
    case 'rate-limited':
      return 'Đã chạm trần tốc độ của nền tảng. Token không sao, chờ rồi thử lại.';
    default:
      return 'Không liên quan tới token.';
  }
};

/**
 * Đổi trạng thái tài khoản theo kết quả đăng.
 *
 * Chỉ đổi khi có căn cứ chắc: `permission` và `rate-limited` **không** đụng tới
 * trạng thái. Chạm trần tốc độ mà đánh dấu tài khoản hỏng thì mười phút sau nó
 * vẫn tốt, và người dùng đã bị dọa đi lấy token mới một cách vô ích.
 *
 * Không bao giờ tự đặt lại thành `active` — token hoạt động trở lại là chuyện
 * người dùng làm, và họ nên thấy trạng thái đổi vì mình vừa sửa, chứ không
 * phải vì hệ thống lặng lẽ đổi hộ.
 */
export const applyAuthVerdict = (
  account: ManagedAccount,
  result: PublishResult,
  now = Date.now(),
): { account: ManagedAccount; change?: AccountStatusChange } => {
  if (result.success) return { account };

  const verdict = classifyAuthFailure(account.channelId, result.errorDetail);
  const next = STATUS_BY_VERDICT[verdict];
  if (!next || account.status === next) return { account };

  return {
    account: { ...account, status: next, updatedAt: now },
    change: {
      accountId: account.id,
      from: account.status,
      to: next,
      verdict,
      reason: describeVerdict(verdict),
    },
  };
};

/* ──────────────────────────  Hạn token  ────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Token Facebook Page dạng long-lived sống 60 ngày.
 *
 * Con số này để tính hạn khi nền tảng có trả `expires_in`, và để đoán khi
 * không trả. Đoán thì thà đoán ngắn hơn thực tế: nhắc sớm một tuần không hại
 * ai, còn nhắc muộn thì bài không lên.
 */
export const LONG_LIVED_TOKEN_DAYS = 60;

/** Đổi `expires_in` (giây) của nền tảng thành mốc thời gian tuyệt đối. */
export const expiryFromSeconds = (expiresInSeconds?: number, now = Date.now()): number | undefined => {
  if (!expiresInSeconds || expiresInSeconds <= 0) return undefined;
  return now + expiresInSeconds * 1000;
};

/**
 * Tài khoản nào cần đi làm mới token, xếp việc gấp lên trước.
 *
 * Tài khoản đã hỏng hẳn (`revoked`) không nằm trong danh sách này — làm mới
 * token không cứu được, phải nối lại từ đầu.
 */
export const accountsNeedingRefresh = (
  accounts: ManagedAccount[],
  withinDays: number,
  now = Date.now(),
): ManagedAccount[] =>
  accounts
    .filter((account) => {
      if (account.status === 'revoked' || account.status === 'paused') return false;
      if (account.status === 'token-expired') return true;
      if (!account.tokenExpiresAt) return false;
      return account.tokenExpiresAt - now <= withinDays * DAY_MS;
    })
    .sort((left, right) => (left.tokenExpiresAt ?? 0) - (right.tokenExpiresAt ?? 0));
