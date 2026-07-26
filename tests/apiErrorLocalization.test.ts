import { describe, expect, it } from 'vitest';
import { localizeApiErrorMessage } from '../services/apiErrorLocalization';

describe('localizeApiErrorMessage', () => {
  it('không dịch HTTP 429 thành hết số dư', () => {
    const message = localizeApiErrorMessage('Too many concurrent tasks', 429);
    expect(message).toContain('không phải lỗi khóa API hay hết tiền');
    expect(message).not.toContain('không đủ credit');
  });

  it('chỉ báo thiếu credit khi nhà cung cấp nói rõ', () => {
    expect(localizeApiErrorMessage('insufficient credit balance', 402)).toContain('không đủ credit');
  });
});
