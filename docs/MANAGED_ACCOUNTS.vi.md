# Sổ tài khoản đăng bài

Phase A trong [MULTI_ACCOUNT_PLAN.vi.md](MULTI_ACCOUNT_PLAN.vi.md).

## Vấn đề đã sửa

```ts
// services/credentialVault.ts — bản cũ
export const getPublishSecret = (channelId: string) => ...
```

Khoá lưu theo `channelId`. Toàn app chứa được đúng **một** token Facebook Page, một Threads, một Zalo OA. Nhập Fanpage thứ hai là ghi đè Fanpage thứ nhất, **không báo gì**.

Nay khoá theo `managedAccountId`. Một agency quản mười Fanpage thì có mười bộ khoá, cùng một `channelId`.

## Phạm vi

Chỉ dành cho **tài khoản thật mà Egoric hoặc khách hàng sở hữu**, nối qua API chính thức của nền tảng. Đây cũng là ràng buộc kỹ thuật chứ không chỉ là chính sách: Graph API, Threads và Zalo OA đều đòi tài khoản business đã xác minh.

## Ba thứ tách bạch, đừng lẫn

| Khái niệm | Là gì | Ví dụ |
|---|---|---|
| `channelId` | Nền tảng | `facebook-page` |
| `ManagedAccount.id` | Id nội bộ, khoá của kho khoá | `acct_m2x9_a7f3` |
| `externalId` | Id trên nền tảng | Page ID `10021…` |

`externalId` nằm trong sổ tài khoản chứ không nằm trong kho khoá, vì nó không phải bí mật — và sổ cái cần nó để tính vân tay chống trùng **kể cả khi phiên đã hết và token đã bị xoá**.

## Sổ cái vốn đã sẵn sàng

```ts
// publishLedgerService.ts:55 — có từ trước
const source = `${channelId}::${accountId ?? ''}::${text}`;
```

Vân tay đã có `accountId` từ đầu, chỉ là không có gì ở tầng trên cung cấp quá một tài khoản. Nên phần khó nhất — chống đăng trùng khi nhiều tài khoản — **không phải viết lại**, chỉ cần nối dây.

Hệ quả kiểm được: cùng một nội dung lên hai tài khoản khác nhau **không** bị coi là trùng; lên cùng một tài khoản lần hai thì bị chặn.

## Đăng tuần tự, không song song

`publishToAccounts` chạy lần lượt. Bắn đồng thời lên hai mươi tài khoản là cách nhanh nhất chạm trần tốc độ của nền tảng, và lúc đó lỗi trả về không phân biệt được với lỗi thật.

Giới hạn tốc độ tử tế thuộc Phase E. Tuần tự là mặc định an toàn cho tới lúc đó.

Một tài khoản hỏng **không** làm dừng các tài khoản còn lại — mỗi tài khoản là một lần đăng độc lập, có vân tay riêng, và ném lỗi được gói lại thành kết quả thất bại của riêng nó.

## Cảnh báo token

Token Facebook Page sống 60 ngày. Không nhắc trước thì **cả sổ tài khoản chết cùng một hôm** và không ai biết cho tới lúc bài không lên.

`collectAccountWarnings` nhắc trước `TOKEN_WARNING_DAYS = 7` ngày, và phân biệt ba nguyên nhân không đăng được: hết token, bị thu hồi quyền, và người dùng chủ động tạm dừng. Tài khoản `paused` thì **im lặng** — người dùng đã tự tắt, không cần app kêu.

## Giới hạn có chủ ý ở giao diện

Mỗi lần đăng chỉ nhắm **một nền tảng**, nhiều tài khoản trong nền tảng đó.

Đăng chéo nền tảng cùng lúc kéo theo hai giới hạn ký tự và hai kết quả kiểm Brand Kit trên cùng một màn — rối hơn phần nó tiết kiệm được. Chọn nền tảng trước, rồi tick tài khoản.

Cổng duyệt giữ nguyên: chưa `approved` thì không đăng, kể cả kênh của Egoric.

## Đọc số liệu

`refreshInsights` nay nhận `(channelId, accountId)`. Đọc số liệu bài của Page A bằng token Page B thì nền tảng trả lỗi quyền chứ không trả số liệu.

Sổ cái giữ `externalId`, kho khoá giữ theo id nội bộ, nên `ArticleLibrary` bắc cầu qua sổ tài khoản. Tài khoản đã gỡ thì không còn token và bản ghi ghi rõ lý do.

## Kiểm chứng

```bash
npx vitest run tests/managedAccount.test.ts
```

25 test. Đáng chú ý:

- Giữ được nhiều tài khoản cùng một nền tảng — cả lý do tồn tại của lớp này
- Thêm trùng cùng một Page bị chặn, **và nói rõ nó đang mang tên gì**
- Cùng `externalId` nhưng khác nền tảng thì không phải trùng
- Cùng nội dung lên hai tài khoản khác nhau không bị coi là trùng; lên cùng tài khoản lần hai thì bị
- Một tài khoản hỏng không làm dừng tài khoản còn lại
- Thiếu token thì lấy `externalId` làm vân tay, đối chiếu bằng `fingerprintPost` chứ không so chuỗi

Kiểm thêm trong trình duyệt thật, không phải bằng mock:

- IndexedDB nâng **v5 → v6** trên database đã có dữ liệu: `managedAccounts` được thêm, **sáu store cũ còn nguyên**
- Ghi hai Fanpage khác nhau vào store rồi đọc lại qua index `channelId` → ra đủ hai. Đây đúng là thứ bất khả thi ở bản trước

## Chưa làm

- **OAuth** — vẫn dán token bằng tay. Với 20 tài khoản là 20 lần đi lấy, và cứ 60 ngày phải làm lại. Đây là Phase B, và là thứ chặn nhất hiện giờ.
- **Lịch đăng** — chưa có. Phase C.
- **Giới hạn tốc độ theo tài khoản** — Phase E.
- **Duyệt hàng loạt** — bàn duyệt vẫn duyệt từng bài. Với 20 tài khoản đăng hằng ngày thì đây sẽ thành nút cổ chai trước cả khi Phase C xong.
- `status` chưa tự đổi sang `token-expired` hay `revoked` khi nền tảng trả lỗi tương ứng — hiện phải sửa tay.
