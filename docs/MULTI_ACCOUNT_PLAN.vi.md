# Quản lý nhiều tài khoản và đăng bài theo lịch

Viết ngày 26/07/2026, sau khi khảo sát code ở commit `88d1070`.

## Chỗ này đang gãy ở đâu

Không phải "thiếu tính năng". Là **mô hình dữ liệu hiện tại chỉ chứa được đúng một tài khoản mỗi nền tảng**.

### 1. Kho khoá khoá theo kênh, không theo tài khoản

```ts
// services/credentialVault.ts:107
export const getPublishSecret = (channelId: string): StoredPublishCredentials =>
  readVault().publishCredentials[channelId] || {};
```

Khoá là `channelId`. Nghĩa là trong toàn app tồn tại đúng **một** token Facebook Page, **một** Threads, **một** Zalo OA. Nhập tài khoản thứ hai là ghi đè tài khoản thứ nhất.

Đây là gốc rễ. Mọi thứ khác chỉ là hệ quả.

### 2. Sổ cái thì đã sẵn sàng từ trước

```ts
// services/content/publishLedgerService.ts:55
const source = `${channelId}::${accountId ?? ''}::${text}`;
```

Vân tay chống trùng **đã có `accountId`**. Phần khó nhất — chống đăng trùng khi có nhiều tài khoản — đã được thiết kế đúng từ đầu. Chỉ là không có gì ở tầng trên cung cấp quá một tài khoản, nên `accountId` luôn là cùng một giá trị.

Tin tốt: không phải đập đi làm lại.

### 3. Không có lịch. Không có gì hết

`grep -rn "schedule\|cron\|scheduledAt\|publishAt" services/content/ types/content.ts` → **không kết quả nào**.

Đăng bài hiện tại là đồng bộ, do người dùng bấm nút, ngay lúc đó. Không có hàng đợi, không có giờ hẹn, không có thử lại.

### 4. Token lấy bằng tay, và sẽ hết hạn

Kênh hiện tại mô tả **các bước người dùng tự đi lấy token** rồi dán vào. Với 20 tài khoản là 20 lần đi lấy tay.

Tệ hơn: token Facebook Page sống 60 ngày, Threads cũng có hạn. Không có luồng làm mới thì **cứ 60 ngày là toàn bộ 20 tài khoản chết cùng lúc**, và không ai biết cho tới lúc bài không lên.

---

## Ranh giới, nói một lần rồi thôi

Tôi sẽ xây bản **quản lý nhiều tài khoản thật mà bạn hoặc khách hàng của bạn sở hữu** — đúng thứ Buffer, Hootsuite, Sprout Social làm. Đây là loại sản phẩm hoàn toàn bình thường.

Tôi không xây phần nuôi tài khoản ảo: tạo tài khoản hàng loạt, xoay proxy và vân tay trình duyệt để né phát hiện, hay đẩy cùng một nội dung qua nhiều tài khoản giả để tạo cảm giác đông người.

Lý do thực dụng hơn là lý do đạo đức: **API chính thức không cho phép chuyện đó về mặt kỹ thuật.** Facebook Graph, Threads, TikTok Content Posting, YouTube Data đều bắt buộc tài khoản business thật, xác thực qua OAuth, gắn với một app đã qua review. Tài khoản farm không dùng được API — muốn dùng chúng thì phải giả lập trình duyệt, và đó là con đường khác hẳn, dễ vỡ, và làm bay cả tài sản thật của khách hàng khi nền tảng quét.

Xây trên API chính thức thì ranh giới đó tự có, không cần ai canh.

---

## Ngã ba phải chọn trước khi viết dòng code nào

**Khoá đăng bài lưu ở đâu?**

Hiện tại toàn bộ bí mật nằm trong `sessionStorage` — mất khi đóng tab. Đó là lựa chọn đúng cho khoá model (BYOK, không ai giữ hộ tiền của bạn).

Nhưng **"tự đăng bài" mà khoá biến mất khi đóng tab thì không tự được**. Không thể đăng bài lúc 7h sáng nếu máy đang tắt.

Ba hướng:

| Hướng | Được | Mất |
|---|---|---|
| **A · Tab phải mở** — trình duyệt làm bộ hẹn giờ | Giữ nguyên BYOK, làm trong 1 tuần | Chỉ đăng được khi app đang mở. Không phải "tự động", chỉ là "nhắc và bấm hộ" |
| **B · Server giữ tất cả** — D1 + Cron Trigger | Tự động thật | Bỏ lời hứa "không giữ bí mật của bạn" cho mọi loại khoá |
| **C · Tách hai loại bí mật** ★ | Token đăng bài lên server, khoá model vẫn BYOK | Phức tạp hơn, phải mã hoá khi lưu |

**Tôi khuyến nghị C**, vì hai loại bí mật có mức rủi ro khác hẳn nhau:

- Token Facebook Page **chỉ đăng được lên đúng Page đó**, phạm vi hẹp, thu hồi một cú bấm trong Business Settings, và hết hạn tự động sau 60 ngày.
- Khoá OpenRouter **tiêu được tiền không giới hạn**, không có phạm vi, và bạn chỉ biết khi nhìn hoá đơn.

Ghép hai thứ đó vào cùng một chính sách lưu trữ là sai. Cái nào rủi ro thấp và cần chạy nền thì lên server; cái nào tiêu được tiền thì ở lại trong phiên.

### Một rào cản nằm ngoài repo

```json
// .openai/hosting.json
{ "project_id": "appgprj_...", "d1": "DB", "r2": "MEDIA" }
```

Không có `wrangler.toml`. Worker được **nền tảng host deploy hộ**, nên repo này **không tự cấu hình được Cron Trigger**.

Nghĩa là hướng B và C phụ thuộc vào việc host có cho chạy worker theo lịch hay không — và đó là câu hỏi phải đi hỏi, không phải câu hỏi giải được bằng code. **Hỏi trước khi tới Phase C**, vì nếu câu trả lời là không thì phải chuyển sang một máy chủ riêng, đội thêm 3–4 tuần.

---

## Lộ trình

### Phase A — Mô hình tài khoản

**2–3 tuần. Không có nó thì không phase nào sau chạy được.**

Thêm thực thể `ManagedAccount` (tên tránh đụng `AccountProfile` — tài khoản Egoric của bạn, và `PublishChannel` — định nghĩa nền tảng):

```ts
interface ManagedAccount {
  id: string;
  clientId?: string;        // gắn với khách hàng; bỏ trống là kênh của Egoric
  channelId: PublishChannelId;
  label: string;            // "Fanpage Cà phê Hạnh — miền Nam"
  externalId: string;       // Page ID / User ID trên nền tảng
  status: 'active' | 'paused' | 'token-expired' | 'revoked';
  tokenExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
}
```

Việc phải làm:

1. Đổi `getPublishSecret(channelId)` → `getPublishSecret(accountId)`. Đây là thay đổi lan rộng nhất, làm sớm khi còn ít chỗ gọi.
2. Đổi `credentialsFor: (channelId) => ...` trong `readInsights` thành `(accountId) => ...`.
3. `publishToChannel` nhận thêm `accountId`, truyền xuống sổ cái. Sổ cái **không cần sửa** — vân tay đã có sẵn chỗ.
4. Màn quản lý tài khoản: thêm, gắn khách hàng, tạm dừng, gỡ.
5. Đăng một bài lên nhiều tài khoản cùng lúc, mỗi tài khoản một dòng kết quả riêng.

**Xong khi:** thêm được ba Fanpage khác nhau và đăng một bài lên cả ba, sổ cái ghi ba dòng riêng biệt, đăng lại không bị trùng.

### Phase B — OAuth thật và tự làm mới token

**2–3 tuần. Không làm thì Phase A chết sau 60 ngày.**

1. Luồng OAuth cho từng nền tảng: bấm nút → sang trang nền tảng → chọn Page → quay về, app tự lưu token và `externalId`. Không dán tay nữa.
2. Đổi short-lived token sang long-lived, lưu `tokenExpiresAt`.
3. Tự làm mới trước hạn. Không làm mới được thì chuyển `status: 'token-expired'` và **báo trong giao diện trước khi bài đến hạn đăng**, không phải sau khi thất bại.
4. Người dùng thu hồi quyền bên nền tảng thì app phải nhận ra và dừng, không thử lại vô ích.

**Rủi ro thật:** OAuth cần app đã qua review của từng nền tảng, và cần domain redirect cố định. Facebook và TikTok review tính bằng tuần và **không nằm trong tay mình**. Nộp hồ sơ ngay đầu Phase A, làm code song song.

### Phase C — Lịch đăng và hàng đợi

**3–4 tuần, cộng 3–4 tuần nữa nếu host không cho chạy cron.**

1. `ScheduledPost`: nội dung, danh sách tài khoản đích, giờ đăng, trạng thái.
2. Lịch dạng bảng tuần: nhìn một màn thấy tuần tới tài khoản nào đăng gì.
3. Hàng đợi bền, thử lại có backoff, và **cờ không-chắc-chắn** — bài đã gửi mà mạng đứt giữa chừng thì để `pending`, không đánh `failed` rồi gửi lại thành hai bài. Lỗi này đã bị bắt một lần ở Xưởng Nội dung; ở đây nó đắt hơn vì chạy nền, không ai nhìn.
4. Đăng theo múi giờ Việt Nam, kể cả khi máy người dùng ở múi khác.

### Phase D — Duyệt hàng loạt

**2 tuần. Bỏ qua là Phase C vô dụng.**

Bạn đã chốt: *"cả kênh của egoric cũng cần phải duyệt trước."* Giữ nguyên. Nhưng 20 tài khoản × mỗi ngày một bài = 140 lượt duyệt mỗi tuần. Bàn duyệt hiện tại duyệt từng bài một sẽ thành nút cổ chai, và người duyệt sẽ bắt đầu bấm duyệt mà không đọc — lúc đó cổng duyệt còn tệ hơn không có, vì nó tạo cảm giác an toàn giả.

Cần: một màn duyệt cả tuần, xem theo tài khoản hoặc theo ngày, duyệt nhiều bài một lượt nhưng **bắt buộc mở từng bài mới bấm được duyệt** — không có nút "duyệt tất cả" mù.

Đây là chỗ sản phẩm thắng hay thua. Phần còn lại chỉ là ống dẫn.

### Phase E — An toàn tài khoản

**2 tuần.**

1. Giới hạn tốc độ theo từng tài khoản, tôn trọng hạn mức của nền tảng. Đẩy 20 bài trong một phút là cách nhanh nhất để bị khoá.
2. Giãn giờ đăng tự nhiên thay vì dồn cùng một phút.
3. Bảng sức khoẻ tài khoản: lần đăng gần nhất, tỷ lệ thất bại, token còn bao lâu. Dùng lại `providerHealthService` — cùng bài toán, khác đối tượng.
4. Ngắt tự động: một tài khoản thất bại liên tiếp thì dừng nó lại và báo, thay vì tiếp tục đâm đầu.

### Phase F — Nội dung khác nhau cho từng tài khoản

**2–3 tuần.**

Đăng y hệt một đoạn chữ lên nhiều tài khoản là thứ nền tảng phát hiện và dìm đầu tiên — và cũng là thứ khiến việc này trượt sang bên kia ranh giới.

Mỗi tài khoản có khán giả riêng nên phải có bản riêng: `clientMemoryService` (Epic 2) đã biết học từ quyết định duyệt, mở rộng để học **theo từng tài khoản** thay vì theo từng khách hàng. Kèm cảnh báo khi hai bài sắp đăng quá giống nhau.

---

## Tổng thời gian và chỗ nó chen vào

```
Phase A  Mô hình tài khoản         2–3 tuần   ← nộp hồ sơ OAuth ngay tại đây
Phase B  OAuth + làm mới token     2–3 tuần
Phase C  Lịch đăng + hàng đợi      3–4 tuần   (+3–4 nếu host không cho cron)
Phase D  Duyệt hàng loạt           2 tuần     ← chỗ quyết định thành bại
Phase E  An toàn tài khoản         2 tuần
Phase F  Nội dung riêng mỗi kênh   2–3 tuần
```

**13–17 tuần**, hoặc 17–21 nếu phải dựng máy chủ riêng để chạy lịch.

### Phụ thuộc bắt buộc

Cụm này **không thể làm trước Phase 2 của [ROADMAP_2026H2](ROADMAP_2026H2.vi.md)** (dữ liệu lên cloud). Lý do đơn giản: bộ hẹn giờ không đọc được lịch nằm trong IndexedDB của một trình duyệt đang tắt. Tài khoản, lịch và token phải ở D1 trước, rồi mới có chuyện tự đăng.

Thứ tự đúng:

```
Phase 0 (live + chạy thật)  →  Phase 2 (dữ liệu lên cloud)  →  A → B → C → D → E → F
```

Phase 1 cũ (đăng video lên TikTok/YouTube) **gộp được vào Phase A/B** — cùng một việc: thêm kênh, thêm OAuth. Làm chung tiết kiệm khoảng 2 tuần so với làm rời.

## Việc nên làm ngay tuần này

Không phải viết code. Là **nộp hồ sơ review app** cho Facebook, Threads, TikTok và YouTube. Chúng chạy nền hàng tuần trong lúc mình làm Phase 0 và Phase 2, và nếu bị từ chối thì toàn bộ kế hoạch này phải tính lại — biết sớm hơn tốt hơn.
