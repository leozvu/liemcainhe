# Vòng đời token

Phần đầu của Phase B trong [MULTI_ACCOUNT_PLAN.vi.md](MULTI_ACCOUNT_PLAN.vi.md).

## Vấn đề

```ts
// publishService.ts — bản cũ
const readError = async (response) => data?.error?.message || `Lỗi HTTP ${status}`;
```

Chỉ giữ **câu chữ**, vứt **mã lỗi**. Nên app không phân biệt được:

| Chuyện thật sự xảy ra | Người dùng thấy |
|---|---|
| Token hết hạn | "Đăng thất bại" |
| Người dùng gỡ ứng dụng | "Đăng thất bại" |
| Sai Page ID | "Đăng thất bại" |
| Chạm trần tốc độ | "Đăng thất bại" |

Bốn nguyên nhân, bốn cách xử lý khác hẳn nhau, một thông báo. Việc chẩn đoán bị đẩy hết sang cho người dùng.

## Đã làm

`readErrorDetail` giữ nguyên `code`, `error_subcode`, `type` và HTTP status. `PublishResult` mang thêm `errorDetail`.

`tokenLifecycleService` đọc mã đó và kết luận một trong năm điều: `expired`, `revoked`, `permission`, `rate-limited`, `unrelated`.

### Mã nào nói gì

| Nền tảng | Mã | Kết luận |
|---|---|---|
| Meta | `190` không subcode | hết hạn |
| Meta | `190` + `463` | hết hạn |
| Meta | `190` + `458/459/460/467` | **bị thu hồi** |
| Meta | `type: OAuthException` không mã | hết hạn |
| Meta | `10 / 200 / 283` | thiếu quyền |
| Meta | `4 / 17 / 32 / 613` | trần tốc độ |
| Zalo | `-216 / -217` | hết hạn |
| Zalo | `-201 / -213` | thiếu quyền |

Ưu tiên mã số, chỉ dò chữ khi không có mã — nền tảng đổi câu chữ lúc nào cũng được, mã thì ổn định hơn nhiều.

Mã của Meta **không** được áp cho Zalo và ngược lại. `190` với Zalo không có nghĩa gì, và coi nó là lỗi token sẽ đánh dấu nhầm một tài khoản đang tốt.

## Hai quyết định đáng nói

**Trần tốc độ và thiếu quyền không đụng tới trạng thái tài khoản.**

Chạm trần tốc độ mà đánh dấu tài khoản hỏng thì mười phút sau nó vẫn tốt, còn người dùng đã bị dọa đi lấy token mới một cách vô ích. Chỉ `expired` và `revoked` mới đổi trạng thái, vì chỉ hai cái đó là kết luận chắc.

**Không bao giờ tự đặt lại thành `active`.**

Token hoạt động trở lại là chuyện người dùng vừa làm. Họ nên thấy trạng thái đổi vì mình vừa sửa, chứ không phải vì hệ thống lặng lẽ đổi hộ — nếu không thì lần sau hỏng thật, họ sẽ ngồi chờ nó tự khỏi.

## Không có subcode thì đoán là hết hạn

Meta trả `190` trơ khá thường xuyên. Giữa "hết hạn" và "bị thu hồi", chọn hết hạn vì nó phổ biến hơn nhiều **và hướng xử lý nhẹ hơn** — đoán sai thì người dùng đi lấy token mới, thấy vẫn không được, rồi mới phải nối lại. Đoán ngược lại thì họ đi nối lại tài khoản trong khi chỉ cần dán token mới.

## Một lỗi test bắt được

Nhánh `type === 'OAuthException'` ban đầu bị lồng trong `if (code !== undefined)` nên **không bao giờ chạy** khi nền tảng chỉ trả `type` mà không kèm mã — đúng thứ Threads hay làm. Test bắt được trước khi commit.

Sửa xong vẫn giữ thứ tự: trần tốc độ và thiếu quyền xét trước, vì chúng cũng đi kèm subcode và kết luận sai ở đó đắt hơn.

## Kiểm chứng

```bash
npx vitest run tests/tokenLifecycle.test.ts
```

33 test. Đáng chú ý:

- `code 4` + `subcode 458` → **trần tốc độ**, không phải thu hồi. Thứ tự xét đúng.
- Mã Meta không áp nhầm cho Zalo
- Trần tốc độ và thiếu quyền không đổi trạng thái
- Đăng thành công không đặt lại `revoked` thành `active`
- `accountsNeedingRefresh` bỏ tài khoản `revoked` — làm mới token không cứu được, phải nối lại từ đầu

518 test / 39 file toàn bộ xanh, build sạch.

## Chưa làm — và đây là chỗ thật sự chặn

**Luồng OAuth vẫn chưa có.** Token vẫn dán tay.

Lý do không làm nốt trong lượt này: trao đổi authorization code lấy token **bắt buộc cần `client_secret`**, mà thứ đó không được nằm trong bundle trình duyệt. Nó phải chạy trong `worker/index.js` — tức là cần deploy, mà deploy đang kẹt hạn mức Codex.

Và trước cả deploy còn cần: đăng ký app trên Meta/Zalo, khai redirect URI, qua app review. Chưa có app thì không có `client_id` để mà bắt đầu.

Nên phần còn lại của Phase B xếp theo thứ tự này:

1. Đăng ký app + Business Verification (ngoài code, chạy nền hàng tuần)
2. Endpoint đổi code lấy token trong worker
3. Đổi short-lived sang long-lived, ghi `tokenExpiresAt`
4. Tự làm mới trước hạn

Bước 1 không cần deploy và không cần quota — nó là việc nên bắt đầu ngay.
