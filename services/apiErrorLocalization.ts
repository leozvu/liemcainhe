const REQUEST_ID_PATTERN = /(?:request\s*id|request_id)\s*[:：]\s*([a-z0-9_-]+)/i;
const VIETNAMESE_MARKERS = /[ăâđêôơưĂÂĐÊÔƠƯ]|\b(không|lỗi|vui lòng|thất bại|hết hạn|tài khoản|yêu cầu)\b/i;
const CJK_PATTERN = /[\u3400-\u9fff]/;

const withRequestId = (message: string, raw: string): string => {
  const requestId = raw.match(REQUEST_ID_PATTERN)?.[1];
  return requestId ? `${message} Mã yêu cầu: ${requestId}.` : message;
};

/** Chuyển thông báo lỗi từ nhà cung cấp thành nội dung tiếng Việt an toàn cho giao diện. */
export const localizeApiErrorMessage = (input: unknown, status?: number): string => {
  const raw = String(input ?? '').trim();
  const normalized = raw.toLowerCase();

  const isQuotaError =
    status === 429 ||
    /quota|insufficient\s*(balance|credit|funds)|balance\s*(is\s*)?(zero|insufficient)|resource_exhausted/.test(normalized) ||
    /\u989d\u5ea6\u4e0d\u8db3|\u5269\u4f59\u989d\u5ea6/.test(raw);

  if (isQuotaError) {
    return withRequestId(
      'Tài khoản API đã hết hạn mức hoặc không đủ số dư. Vui lòng nạp thêm tiền hoặc dùng khóa API khác.',
      raw
    );
  }

  if (status === 401 || /invalid\s*(api\s*)?key|unauthorized|authentication/.test(normalized)) {
    return withRequestId('Khóa API không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra và lưu lại khóa.', raw);
  }

  if (status === 403 || /forbidden|permission\s*denied|access\s*denied/.test(normalized)) {
    return withRequestId('Tài khoản API không có quyền sử dụng mô hình hoặc tính năng này.', raw);
  }

  if (/safety|moderation|content\s*policy|blocked/.test(normalized)) {
    return withRequestId('Yêu cầu bị chặn bởi bộ lọc an toàn. Vui lòng điều chỉnh nội dung rồi thử lại.', raw);
  }

  if (status && status >= 500) {
    return withRequestId('Dịch vụ AI đang tạm thời gián đoạn. Vui lòng thử lại sau ít phút.', raw);
  }

  if (/timeout|timed\s*out|network|fetch\s*failed|econnreset|etimedout/.test(normalized)) {
    return withRequestId('Không thể kết nối ổn định tới dịch vụ AI. Vui lòng kiểm tra mạng và thử lại.', raw);
  }

  if (raw && VIETNAMESE_MARKERS.test(raw) && !CJK_PATTERN.test(raw)) {
    return raw;
  }

  return withRequestId(
    status ? `Yêu cầu tới dịch vụ AI thất bại (mã HTTP ${status}).` : 'Yêu cầu tới dịch vụ AI thất bại.',
    raw
  );
};
