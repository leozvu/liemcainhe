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
| Bốn trục điều khiển kèm `directive` | ✅ 24 lựa chọn |
| Sinh bài qua `callChatApi` | ✅ `articleService.ts` |
| `StoryBridge` sang Phase 01 | ✅ `storyBridgeService.ts` |
| Giao diện | ✅ chặng `content` trong sidebar |
| Đăng bài dạng chữ | ✅ Facebook Page, Threads, Zalo OA |
| Đăng video | ⬜ TikTok và YouTube nhận video, thuộc đường ống Phase 04 |

## Đăng bài

Ba kênh nhận nội dung dạng chữ nên hợp với đầu ra của Xưởng Nội dung. TikTok và YouTube không có ở đây vì chúng nhận video — đó là đầu ra của Phase 04, một đường ống khác.

Token nằm trong `credentialVault` cùng cơ chế BYOK với khoá model: chỉ ở `sessionStorage`, không ghi ra đĩa, không lên cloud, đóng tab là mất.

Đăng bài không rút lại được nên luồng làm chặt hơn phần còn lại của ứng dụng: nội dung sắp đăng luôn hiện ra để đọc lại, có bộ đếm ký tự theo giới hạn từng kênh, và nút đăng có bước xác nhận riêng chứ không đăng ngay lần bấm đầu.

### Lấy thông tin đăng nhập ở đâu

Hướng dẫn đầy đủ nằm ngay trong giao diện, nút *"Lấy token … ở đâu?"*. Tóm tắt:

| Kênh | Cần gì | Lấy ở đâu |
|---|---|---|
| Facebook Page | Page ID + Page Access Token | `developers.facebook.com/apps` → ứng dụng loại Business → quyền `pages_manage_posts`, `pages_read_engagement` → Graph API Explorer → Generate Access Token → đổi sang dài hạn bằng Access Token Debugger |
| Threads | Threads User ID + Access Token | Cùng nơi, thêm sản phẩm Threads API → quyền `threads_basic`, `threads_content_publish` → Threads Graph API Explorer. Gọi `/v1.0/me` để lấy User ID |
| Zalo OA | OA Access Token | `developers.zalo.me` → tạo ứng dụng → liên kết Official Account → chạy OAuth lấy access token và refresh token |

Ba điều dễ vấp:

1. **Facebook**: token *người dùng* không đăng được, phải là token của chính Trang. Đăng cho Trang của khách hàng ngoài tổ chức thì Meta bắt duyệt ứng dụng.
2. **Threads**: tài khoản phải liên kết với một tài khoản Instagram chuyên nghiệp. Giới hạn 250 bài mỗi 24 giờ.
3. **Zalo**: Official Account phải đã xác thực. Access token chỉ sống **25 giờ** — bản này chưa tự làm mới, hết hạn thì phải dán token mới. Tự động làm mới cần nơi giữ refresh token an toàn, tức là phải có phía máy chủ.

### Đường đi kỹ thuật

| Kênh | Endpoint | Ghi chú |
|---|---|---|
| Facebook Page | `POST /v21.0/{page-id}/feed` | Một bước |
| Threads | `POST /v1.0/{user-id}/threads` rồi `/threads_publish` | Hai bước. Bước một hỏng thì chưa có gì lên mạng; bước hai hỏng thì vùng chứa còn treo nhưng không hiện công khai |
| Zalo OA | `POST /v2.0/article/create` | Trả HTTP 200 kèm mã lỗi trong thân phản hồi, khác hai kênh kia. Token đi qua header tuỳ biến `access_token`, đã thêm vào allowlist header của Worker |

Ba tiền tố proxy `facebook`, `threads`, `zalo` có ở cả bốn lớp: `vite.config.ts`, `worker/index.js`, `electron/main.cjs`, `nginx.conf`. Có test chạy qua từng kênh khẳng định không lớp nào bị bỏ sót.

## Giao diện

Chặng `content` đứng trước Kịch bản trong sidebar, đánh dấu không phải chặng lõi giống Kho sáng tạo. Ba khối theo đúng thứ tự làm việc: bảng xu hướng, brief, kết quả.

Mỗi trục hiện mô tả của lựa chọn đang chọn ngay dưới ô chọn. Bốn trục chỉ hữu ích khi người dùng biết mỗi lựa chọn thực sự làm gì, mà nhãn thì quá ngắn để nói hết.

Nút **Đưa sang Kịch bản** ghi đè `rawScript`, `targetDuration`, `language` và `visualStyle` của dự án đang mở rồi chuyển thẳng sang chặng Kịch bản. Có cảnh báo ghi đè ngay dưới nút.

`stageForProjectStage` quy chặng `content` về `script`, vì Xưởng nội dung không phải chặng lõi nhưng vẫn cần một chặng để gắn tác vụ và tiến độ, và Kịch bản là nơi kết quả của nó đi tiếp.

## Đã chạy thử trên trình duyệt

| Việc | Kết quả |
|---|---|
| Mở chặng Xưởng nội dung | Dựng đủ ba khối, 13 nguồn trong ô chọn |
| Bấm Lấy tin | 10 chủ đề từ Google Xu hướng, `GET /api-proxy/trends/google-trends` → 200 |
| Đổi nguồn sang CafeF | 12 chủ đề, `GET /api-proxy/trends/cafef` → 200 |
| Chọn một chủ đề | Ô chủ đề trong brief tự điền |
| Bấm Viết bài khi chưa có khoá | Hiện đúng "Thiếu khóa API. Hãy cấu hình khóa API trong phần cài đặt" |
| Lỗi console | Không có |
| Màn hình 375px | Không tràn ngang |

## Cách sinh bài

`generateArticle(brief)` đi qua `callChatApi` nên thừa hưởng sẵn chuyển tuyến khi model lỗi, đếm chi phí theo `usageResourceId` và thông báo lỗi tiếng Việt.

Prompt gồm hai lớp. Lớp hệ thống là quy tắc viết tiếng Việt áp cho mọi bài, chủ yếu để chặn những lỗi mô hình hay mắc: dịch máy từ tiếng Anh, viết hoa toàn bộ làm mất dấu, chèn lời dẫn kiểu trợ lý ảo, bịa số liệu. Lớp người dùng là chủ đề cộng bốn `directive` của bốn trục.

Phản hồi đi qua `parseModelJson` sẵn có rồi mới chuẩn hoá. Mọi trường đều có đường lui vì mô hình hay trả thiếu — chỉ thiếu toàn bộ thân bài mới báo lỗi. Hàm chuẩn hoá tách riêng khỏi phần gọi mạng nên kiểm thử được mà không cần model thật.

## Cách nối sang Phase 01

```
TrendItem  ──buildStoryBridgeFromTrend──┐
                                        ├─→ StoryBridge ──toFilmProjectSeed──→ ProjectState
ArticleDraft ─buildStoryBridgeFromArticle┘
```

`toFilmProjectSeed` trả về đúng `title`, `rawScript`, `targetDuration`, `language`, `visualStyle` — chỗ gọi chỉ việc trộn vào `ProjectState` mới, không cần biết gì về Xưởng Nội dung.

Nhánh từ bài viết dùng **tiêu đề mục làm sườn** thay vì đổ nguyên bài vào prompt: giữ được mạch lập luận mà không tốn token cho phần thân bài, vốn không giúp gì cho việc nghĩ ra một câu chuyện quay được.

## Kiểm chứng

```bash
npx vitest run tests/trendService.test.ts tests/contentStudio.test.ts
```
