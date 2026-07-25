# Xưởng Nội dung — đặc tả

Module bắt xu hướng Việt Nam, dựng brief, viết bài, và chuyển chủ đề nóng thành đầu vào cho xưởng phim.

## Nguồn gốc và bản quyền

Module này được **viết mới hoàn toàn** trong stack của Egoric Film Studio. Không chứa, không dịch, không phái sinh từ mã của bất kỳ dự án nào khác.

Bối cảnh: có xem xét việc dùng lại AIWriteX (`iniwap/AIWriteX`) nhưng đã loại bỏ. File `NOTICE` của dự án đó bổ sung điều khoản ngoài Apache-2.0, cấm phân phối tác phẩm phái sinh và cấm dùng để phục vụ bên thứ ba khi chưa có văn bản cho phép. Viết lại mã của họ theo cách khác **không** gỡ được ràng buộc đó, vì phái sinh vẫn là phái sinh.

Cái không bị bảo hộ bản quyền là **ý tưởng và chức năng**. Chuỗi "bắt xu hướng → AI viết bài → dàn trang → đăng" là mô hình chung của cả một lớp sản phẩm, ai cũng làm được. Module này dựng từ đặc tả chức năng đó, với thiết kế, mô hình dữ liệu, prompt và mã nguồn riêng.

Ghi nhận cụ thể để về sau khỏi tranh cãi:

| Thành phần | Nguồn |
|---|---|
| Mô hình dữ liệu (`types/content.ts`) | Thiết kế riêng. Bốn trục điều khiển, không phải ma trận đa chiều. |
| Danh mục nguồn xu hướng | Feed RSS công khai của báo Việt Nam. Danh sách và trọng số do dự án này chọn. |
| Bộ đọc RSS | Viết riêng bằng biểu thức chính quy, không phụ thuộc thư viện ngoài. |
| Lớp proxy | Theo đúng mẫu allowlist sẵn có của Egoric trong `docs/API_GATEWAY.vi.md`. |
| Prompt | Viết mới. |

## Mô hình bốn trục

Cố ý giữ nhỏ. Một ma trận hàng trăm lựa chọn nghe thì oai nhưng người viết không dùng hết, còn tổ hợp ngẫu nhiên thì cho ra bài lai tạp. Bốn trục dưới đây là bốn câu hỏi phải trả lời trước khi đặt bút:

| Trục | Câu hỏi | Giá trị |
|---|---|---|
| `intent` | Viết để làm gì | awareness, education, conversion, community |
| `approach` | Vào bài bằng góc nào | story, howto, contrarian, listicle, casestudy, mythbust, explainer, interview |
| `voice` | Giọng ra sao | thân mật, chuyên gia, hài hước, truyền cảm, sắc lạnh, mộc mạc |
| `audience` | Nói với ai | gen Z, dân văn phòng, chủ doanh nghiệp, phụ huynh, dân kỹ thuật, phổ thông |

Mỗi lựa chọn mang theo một `directive` — câu chỉ dẫn được ghép vào prompt. Đó là chỗ trục thực sự tác động, không phải chỉ là nhãn hiển thị.

## Nguồn xu hướng

13 feed RSS công khai, không cần khoá API. Khai báo tại `services/content/trendSources.ts`, là nguồn sự thật duy nhất cho cả giao diện lẫn allowlist của proxy.

Một nguồn thuộc loại `search` (Google Xu hướng, `geo=VN`) — đây là tín hiệu mạnh nhất vì phản ánh điều người ta chủ động tìm. 12 nguồn còn lại là `editorial`, dòng tin toà soạn đẩy ra.

Chủ đề được rút thăm theo trọng số `1/rank²`: đầu bảng chiếm ưu thế rõ rệt nhưng đuôi vẫn có cửa, nên chạy hằng ngày không bị lặp mãi một tin.

## Lớp proxy

Trình duyệt không gọi thẳng feed được vì CORS. Đường đi:

```
Trình duyệt  →  /api-proxy/trends/<id>  →  proxy tra allowlist  →  feed thật
```

Trình duyệt **chỉ gửi lên `id`**, không bao giờ gửi URL đích — giữ đúng nguyên tắc đã ghi trong `docs/API_GATEWAY.vi.md`. Ba id không hợp lệ đã thử đều bị chặn: `khong-co`, `../../../etc/passwd`, `https://evil.example.com/x`, tất cả trả 404.

Không dùng được `server.proxy` tĩnh của Vite vì 13 nguồn nằm trên nhiều tên miền, trong khi `server.proxy` chỉ ánh xạ một tiền tố tới một host. Thay bằng:

| Môi trường | Nơi cài đặt |
|---|---|
| `npm run dev`, `npm run preview` | `scripts/trend-proxy-plugin.mjs` |
| Cloudflare Worker | `TREND_TARGETS` trong `worker/index.js` |

Worker giữ bản sao allowlist vì chạy độc lập, không import được TypeScript. `tests/trendService.test.ts` có một test khẳng định hai bên không bao giờ lệch nhau — sửa một bên mà quên bên kia là đỏ ngay.

Bản Worker còn yêu cầu đã đăng nhập và chịu rate-limit dưới bucket `trends`, giống mọi tuyến proxy khác.

## Cầu nối sang xưởng phim

Đây là lý do module tồn tại trong Egoric chứ không phải một công cụ viết bài rời rạc. Cùng một chủ đề nóng, hai nhánh:

```
TrendItem ──┬─→ ContentBrief ─→ ArticleDraft   (bài đăng)
            └─→ StoryBridge ──→ rawScript      (Phase 01, phim ngắn)
```

`StoryBridge` khớp sẵn với `rawScript`, `targetDuration` và `visualStyle` mà Phase 01 đang nhận.

## Trạng thái

| Phần | Trạng thái |
|---|---|
| Mô hình dữ liệu | ✅ `types/content.ts` |
| Danh mục nguồn + proxy (dev, preview, Worker) | ✅ đã kiểm chứng 13/13 nguồn |
| Đọc feed, chuẩn hoá, rút thăm, gom bảng | ✅ 25 test |
| Bốn trục điều khiển kèm `directive` | ⬜ tiếp theo |
| Sinh bài qua `callChatApi` | ⬜ |
| `StoryBridge` sang Phase 01 | ⬜ |
| Giao diện | ⬜ |
| Đăng đa nền tảng | ⬜ cần khoá và duyệt ứng dụng từng nền tảng |

## Kiểm chứng

```bash
npx vitest run tests/trendService.test.ts
```
