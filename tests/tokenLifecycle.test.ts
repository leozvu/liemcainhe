import { describe, expect, it } from 'vitest';
import {
  LONG_LIVED_TOKEN_DAYS,
  accountsNeedingRefresh,
  applyAuthVerdict,
  classifyAuthFailure,
  expiryFromSeconds,
} from '../services/content/tokenLifecycleService';
import { ManagedAccount, PublishErrorDetail, PublishResult } from '../types/content';

const DAY = 24 * 60 * 60 * 1000;

const detail = (over: Partial<PublishErrorDetail> = {}): PublishErrorDetail => ({
  message: 'Có lỗi',
  httpStatus: 400,
  ...over,
});

const account = (over: Partial<ManagedAccount> = {}): ManagedAccount => ({
  id: 'a1',
  channelId: 'facebook-page',
  label: 'Fanpage Hạnh',
  externalId: '111',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const failure = (errorDetail?: PublishErrorDetail): PublishResult => ({
  channelId: 'facebook-page',
  success: false,
  message: errorDetail?.message ?? 'hỏng',
  errorDetail,
});

describe('phân loại lỗi Meta', () => {
  it('code 190 không kèm subcode thì coi là hết hạn', () => {
    expect(classifyAuthFailure('facebook-page', detail({ code: 190 }))).toBe('expired');
  });

  it('subcode 463 là hết hạn', () => {
    expect(classifyAuthFailure('facebook-page', detail({ code: 190, subcode: 463 }))).toBe('expired');
  });

  it('subcode 458 — người dùng gỡ ứng dụng — là bị thu hồi, không phải hết hạn', () => {
    expect(classifyAuthFailure('facebook-page', detail({ code: 190, subcode: 458 }))).toBe('revoked');
  });

  it('đổi mật khẩu (460) cũng là thu hồi', () => {
    expect(classifyAuthFailure('facebook-page', detail({ code: 190, subcode: 460 }))).toBe('revoked');
  });

  it('OAuthException nhận ra qua type kể cả khi thiếu code', () => {
    expect(classifyAuthFailure('threads', detail({ type: 'OAuthException' }))).toBe('expired');
  });

  it('thiếu quyền khác hẳn hết hạn', () => {
    expect(classifyAuthFailure('facebook-page', detail({ code: 200 }))).toBe('permission');
  });

  it('chạm trần tốc độ không phải chuyện token', () => {
    expect(classifyAuthFailure('facebook-page', detail({ code: 4 }))).toBe('rate-limited');
    expect(classifyAuthFailure('facebook-page', detail({ code: 613 }))).toBe('rate-limited');
  });

  it('trần tốc độ được xét trước quyền — mã 4 không bị nhầm thành thiếu quyền', () => {
    expect(classifyAuthFailure('facebook-page', detail({ code: 4, subcode: 458 }))).toBe('rate-limited');
  });

  it('lỗi thường thì không đổ cho token', () => {
    expect(classifyAuthFailure('facebook-page', detail({ code: 100, message: 'Sai tham số' }))).toBe('unrelated');
  });
});

describe('phân loại lỗi Zalo', () => {
  it('-216 là token hỏng', () => {
    expect(classifyAuthFailure('zalo-oa', detail({ code: -216 }))).toBe('expired');
  });

  it('-201 là thiếu quyền', () => {
    expect(classifyAuthFailure('zalo-oa', detail({ code: -201 }))).toBe('permission');
  });

  it('mã Meta không được áp nhầm cho Zalo', () => {
    // 190 là mã của Meta; với Zalo nó không có nghĩa gì.
    expect(classifyAuthFailure('zalo-oa', detail({ code: 190, message: 'Lỗi lạ' }))).toBe('unrelated');
  });
});

describe('đoán bằng chữ khi không có mã', () => {
  it('nhận ra token hết hạn qua câu chữ tiếng Anh', () => {
    expect(classifyAuthFailure('facebook-page', detail({ message: 'Session has expired' }))).toBe('expired');
  });

  it('nhận ra qua câu chữ tiếng Việt', () => {
    expect(classifyAuthFailure('facebook-page', detail({ message: 'Token đã hết hạn' }))).toBe('expired');
  });

  it('thu hồi được ưu tiên hơn hết hạn khi cả hai cùng khớp', () => {
    expect(
      classifyAuthFailure('facebook-page', detail({ message: 'User revoked access, token invalid' })),
    ).toBe('revoked');
  });

  it('401 trơ không mã vẫn coi là chuyện token', () => {
    expect(classifyAuthFailure('facebook-page', detail({ httpStatus: 401, message: 'Unauthorized' }))).toBe('expired');
  });

  it('403 trơ là thiếu quyền chứ không phải hết hạn', () => {
    expect(classifyAuthFailure('facebook-page', detail({ httpStatus: 403, message: 'Forbidden' }))).toBe('permission');
  });

  it('không có chi tiết lỗi thì không kết luận gì', () => {
    expect(classifyAuthFailure('facebook-page', undefined)).toBe('unrelated');
  });
});

describe('đổi trạng thái tài khoản', () => {
  it('hết hạn thì đánh dấu token-expired', () => {
    const { account: next, change } = applyAuthVerdict(account(), failure(detail({ code: 190, subcode: 463 })), 99);
    expect(next.status).toBe('token-expired');
    expect(next.updatedAt).toBe(99);
    expect(change?.verdict).toBe('expired');
    expect(change?.reason).toContain('Lấy token mới');
  });

  it('bị thu hồi thì đánh dấu revoked kèm hướng xử lý khác', () => {
    const { change } = applyAuthVerdict(account(), failure(detail({ code: 190, subcode: 458 })));
    expect(change?.to).toBe('revoked');
    expect(change?.reason).toContain('nối lại tài khoản');
  });

  it('chạm trần tốc độ KHÔNG đụng tới trạng thái — mười phút sau tài khoản vẫn tốt', () => {
    const { account: next, change } = applyAuthVerdict(account(), failure(detail({ code: 4 })));
    expect(next.status).toBe('active');
    expect(change).toBeUndefined();
  });

  it('thiếu quyền cũng không đánh dấu tài khoản hỏng', () => {
    expect(applyAuthVerdict(account(), failure(detail({ code: 200 }))).change).toBeUndefined();
  });

  it('đăng thành công thì không đụng gì', () => {
    const result: PublishResult = { channelId: 'facebook-page', success: true, message: 'ok' };
    expect(applyAuthVerdict(account({ status: 'token-expired' }), result).change).toBeUndefined();
  });

  it('không tự đặt lại thành active — người dùng phải thấy mình vừa sửa cái gì', () => {
    const result: PublishResult = { channelId: 'facebook-page', success: true, message: 'ok' };
    expect(applyAuthVerdict(account({ status: 'revoked' }), result).account.status).toBe('revoked');
  });

  it('đã ở đúng trạng thái rồi thì không báo đổi lần nữa', () => {
    const { change } = applyAuthVerdict(
      account({ status: 'token-expired' }),
      failure(detail({ code: 190, subcode: 463 })),
    );
    expect(change).toBeUndefined();
  });
});

describe('hạn token', () => {
  it('đổi expires_in thành mốc tuyệt đối', () => {
    expect(expiryFromSeconds(3600, 1000)).toBe(1000 + 3600 * 1000);
  });

  it('không có hoặc bằng 0 thì không đoán bừa', () => {
    expect(expiryFromSeconds(undefined)).toBeUndefined();
    expect(expiryFromSeconds(0)).toBeUndefined();
    expect(expiryFromSeconds(-5)).toBeUndefined();
  });

  it('hằng số long-lived khớp với 60 ngày của Meta', () => {
    expect(LONG_LIVED_TOKEN_DAYS).toBe(60);
  });
});

describe('tài khoản cần làm mới token', () => {
  const now = 100 * DAY;

  it('xếp việc gấp lên trước', () => {
    const list = accountsNeedingRefresh(
      [
        account({ id: 'muon', tokenExpiresAt: now + 6 * DAY }),
        account({ id: 'gap', tokenExpiresAt: now + 1 * DAY }),
      ],
      7,
      now,
    );
    expect(list.map((item) => item.id)).toEqual(['gap', 'muon']);
  });

  it('token còn dài thì chưa cần', () => {
    expect(accountsNeedingRefresh([account({ tokenExpiresAt: now + 30 * DAY })], 7, now)).toEqual([]);
  });

  it('đã hết token thì luôn nằm trong danh sách kể cả khi không biết hạn', () => {
    expect(accountsNeedingRefresh([account({ status: 'token-expired' })], 7, now)).toHaveLength(1);
  });

  it('bị thu hồi thì KHÔNG nằm trong danh sách — làm mới token không cứu được', () => {
    expect(accountsNeedingRefresh([account({ status: 'revoked' })], 7, now)).toEqual([]);
  });

  it('tạm dừng thì bỏ qua', () => {
    expect(accountsNeedingRefresh([account({ status: 'paused', tokenExpiresAt: now })], 7, now)).toEqual([]);
  });
});
