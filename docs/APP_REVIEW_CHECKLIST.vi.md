# Đăng ký app và nộp review — làm từng bước

Bước 1 của Phase B trong [MULTI_ACCOUNT_PLAN.vi.md](MULTI_ACCOUNT_PLAN.vi.md). Đây là phần **không cần code, không cần deploy, không cần hạn mức Codex** — và nó đang chặn ba bước còn lại.

> Ghi chú: giao diện console của các nền tảng đổi khá thường. Tên nút và vị trí menu có thể khác với mô tả dưới đây, nhưng trình tự và thứ cần nộp thì ổn định nhiều năm nay.

## Việc này không bị chặn bởi deploy

Meta đòi ba đường link công khai khi nộp review. Cả ba **đã chạy trên bản live hiện tại**, không phải chờ deploy bản mới:

| Meta đòi | Trạng thái |
|---|---|
| Privacy Policy URL | `public/privacy.html` — có trên `sites/main` |
| Terms of Service URL | `public/terms.html` — có trên `sites/main` |
| Data Deletion | endpoint `DELETE_ACCOUNT_DATA` — có trên `sites/main` |

Worker còn cho hai trang này qua cổng đăng nhập (`legalPath` trong `worker/index.js:1200`), nên người ngoài mở được — đúng yêu cầu của Meta.

**Lấy URL:** mở bản live, thêm `/privacy.html` và `/terms.html` vào sau tên miền.

---

## Chuẩn bị trước khi bấm nút nào

Thiếu một trong những thứ này là kẹt giữa chừng, phải quay lại:

- **Giấy phép kinh doanh** (bản chụp rõ, còn hiệu lực)
- **Mã số thuế**
- **Giấy tờ chứng minh địa chỉ** — hợp đồng thuê văn phòng, hoá đơn điện nước, hoặc sao kê ngân hàng có tên và địa chỉ công ty
- **Số điện thoại công ty** nhận được cuộc gọi hoặc SMS
- **Email theo tên miền công ty** (Meta không thích Gmail cho phần này)
- Tên công ty trên giấy tờ phải **khớp chính xác** với tên khai trên Meta Business

---

## Meta — Facebook Page và Threads

### Bước 1 · Business Verification ← bắt đầu hôm nay

Đây là **đường găng**: mất từ vài ngày tới vài tuần, hoàn toàn ngoài tầm tay bạn, và mọi thứ khác ở Meta đều chờ nó.

1. Mở `business.facebook.com`, tạo Business Portfolio nếu chưa có
2. Vào **Business Settings → Security Center** (có nơi gọi là Business Info)
3. Bấm **Start Verification**, điền đúng tên như trên giấy phép kinh doanh
4. Tải giấy tờ lên, chọn cách nhận mã xác minh (điện thoại/SMS/email)
5. Nộp rồi **để đấy**, làm việc khác

Bị từ chối thường vì tên công ty lệch một ký tự so với giấy tờ, hoặc ảnh chụp mờ. Sửa rồi nộp lại được.

### Bước 2 · Tạo app

1. `developers.facebook.com` → **My Apps → Create App**
2. Chọn loại **Business**
3. Gắn app vào Business Portfolio vừa xác minh ở bước 1
4. Ghi lại **App ID** và **App Secret** — App Secret là thứ sẽ nằm trong worker, **không bao giờ đưa vào code chạy ở trình duyệt**

### Bước 3 · Thêm sản phẩm và quyền

Thêm **Facebook Login for Business**. Quyền cần xin:

| Quyền | Để làm gì |
|---|---|
| `pages_show_list` | Liệt kê Trang mà người dùng quản lý |
| `pages_manage_posts` | Đăng bài — quyền chính |
| `pages_read_engagement` | Đọc số liệu bài đã đăng |
| `business_management` | Quản lý nhiều Trang qua Business |

Cho Threads (cùng app):

| Quyền | Để làm gì |
|---|---|
| `threads_basic` | Đọc hồ sơ |
| `threads_content_publish` | Đăng bài |
| `threads_manage_insights` | Đọc số liệu |

### Bước 4 · Khai redirect URI

Trong phần cài đặt Facebook Login, khai **Valid OAuth Redirect URIs**. Khai cả hai:

```
http://localhost:3400/oauth/facebook      ← để xây và test
https://<tên-miền-live>/oauth/facebook    ← để chạy thật
```

Meta cho `localhost` khi app ở chế độ Development — đây chính là thứ cho phép làm bước 2–4 của Phase B mà **không cần deploy**.

### Bước 5 · Xây và test ở chế độ Development

App mới luôn ở **Development mode**. Ở chế độ này:

- Dùng được **mọi quyền** ở trên mà **không cần review**
- Nhưng chỉ với tài khoản có vai trò **Admin / Developer / Tester** của app
- Tức là: tài khoản của bạn và của nhân sự Egoric dùng được ngay

Thêm người vào **App Roles → Roles**.

Nghĩa là toàn bộ luồng OAuth xây và chạy thử được ngay khi có App ID, không chờ review. Review chỉ cần khi muốn phục vụ tài khoản của **khách hàng bên ngoài**.

### Bước 6 · Nộp App Review

Chỉ nộp khi luồng đã chạy thật, vì Meta đòi quay màn hình.

Mỗi quyền phải nộp riêng, gồm:

1. **Mô tả use case** — nói rõ Egoric là agency, đăng bài thay cho Trang của khách hàng đã uỷ quyền
2. **Video quay màn hình** — từ lúc bấm đăng nhập, chọn Trang, tới lúc bài lên. Không cắt khúc.
3. **Tài khoản test** để reviewer tự thử
4. Ba đường link phía trên

Duyệt thường mất **1–4 tuần**. Bị trả về thì sửa và nộp lại, không mất lượt.

---

## Zalo OA

1. **Xác thực OA trước** — vào `oa.zalo.me`, nộp giấy phép kinh doanh. OA chưa xác thực bị giới hạn nặng.
2. `developers.zalo.me` → tạo ứng dụng
3. Liên kết ứng dụng với OA
4. Xin quyền gửi bài / gửi tin
5. Khai callback URL
6. Ghi lại **App ID** và **Secret Key**

Zalo nhanh hơn Meta nhiều, thường vài ngày. Nhưng token OA sống ngắn hơn và **bắt buộc dùng refresh token** — đây là lý do lớp làm mới token phải có trước khi chạy thật.

---

## Để sau: TikTok và YouTube

Chưa cần bây giờ vì app chưa đăng được video. Nhưng nếu định làm Phase 1 (video ra khỏi app) thì nộp sớm, vì cả hai đều chậm.

**TikTok** — `developers.tiktok.com`, xin **Content Posting API**. Lưu ý: app chưa qua audit chỉ đăng được ở chế độ riêng tư (`SELF_ONLY`). Muốn đăng công khai phải qua audit.

**YouTube** — tạo project ở Google Cloud, bật **YouTube Data API v3**, khai OAuth consent screen với scope `youtube.upload`. Hai cái bẫy:

- Scope này thuộc nhóm nhạy cảm, app chưa verify bị **giới hạn 100 người dùng**
- **Quota mặc định 10.000 đơn vị/ngày, mỗi lần upload tốn 1.600** → khoảng **6 video/ngày**. Cần nhiều hơn phải xin nâng quota, và đơn đó xét lâu.

---

## Thứ tự và thời gian

```
Hôm nay      Meta Business Verification        ← đường găng, nộp trước tiên
Hôm nay      Xác thực Zalo OA
+1 ngày      Tạo Meta app, lấy App ID/Secret
+1 ngày      Khai redirect localhost
             → từ đây tôi xây được OAuth và test thật
+1 tuần      Tạo app Zalo
Khi xong OAuth  Quay màn hình, nộp App Review
+1–4 tuần    Chờ Meta duyệt
```

Điểm mấu chốt: **có App ID là tôi làm tiếp được ngay**, không cần chờ hết chu trình review, không cần deploy. Chế độ Development đủ để xây xong và chạy thử toàn bộ luồng.

## Việc tôi không làm được

Tạo tài khoản, nhập giấy tờ, và nhập App Secret — cả ba đều là việc phải do bạn tự làm. App Secret khi có thì **không dán vào chat**; nó đi thẳng vào biến môi trường của worker.

Cần App ID (không phải Secret) thì gửi được, vì nó vốn công khai trong mã client.
