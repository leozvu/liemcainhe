# Xưởng Nội dung — đặc tả

Module bắt xu hướng Việt Nam, dựng brief, viết bài, và chuyển chủ đề nóng thành đầu vào cho xưởng phim.

## Nguồn gốc và bản quyền

Module này được **viết mới hoàn toàn** trong stack của Egoric Film Studio. Không chứa, không dịch, không phái sinh từ mã của bất kỳ dự án nào khác.

Bối cảnh: có xem xét việc dùng lại AIWriteX (`iniwap/AIWriteX`) nhưng đã loại bỏ. File `NOTICE` của dự án đó bổ sung điều khoản ngoài Apache-2.0, cấm phân phối tác phẩm phái sinh và cấm dùng để phục vụ bên thứ ba khi chưa có văn bản cho phép. Viết lại mã của họ theo cách khác **không** gỡ được ràng buộc đó, vì phái sinh vẫn là phái sinh.

Cái không bị bảo hộ bản quyền là **ý tưởng và chức năng**. Chuỗi "bắt xu hướng → AI viết bài → dàn trang → đăng" là mô hình chung của cả một lớp sản phẩm, ai cũng làm được. Module này dựng từ đặc tả chức năng đó, với thiết kế, mô hình dữ liệu, prompt và mã nguồn riêng.

Ghi nhận cụ thể để về sau khỏi tranh cãi:

| Thành phần | Nguồn |
|---|---|
| Mô hình dữ liệu (`types/content.ts`) | Thiết kế riêng. Bốn trục brief bắt buộc và Phòng chiến lược Egoric tùy chọn. |
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

## Phòng chiến lược Egoric

Bốn trục vẫn là phần brief tối thiểu để team chạy nhanh. Khi cần tạo nhiều góc khác nhau cho cùng một chủ đề, người dùng mở Phòng chiến lược để chọn một hướng nâng cao.

- 15 lăng kính chiến thuật: cơ chế mở đầu, lực căng, cách chứng minh, đường cảm xúc, vai người kể, chất liệu Việt Nam, khung thời gian, không gian, định dạng, kết cấu, nhịp, ngôn ngữ, điểm nhìn, hành vi sau nội dung và mô-típ hình ảnh.
- Mỗi hướng chỉ kích hoạt tối đa 5 lăng kính. Giới hạn này ngăn prompt chứa quá nhiều yêu cầu xung đột.
- Hệ thống đề xuất ba hướng ngay trên thiết bị bằng thuật toán xác định, không gọi model và không phát sinh chi phí API.
- Người dùng có thể đổi cường độ hoặc thay từng lăng kính. Hướng đã chốt được lưu cùng brief và đi vào cả prompt viết bài lẫn prompt dựng phim ngắn.
- Đổi hướng làm bài viết và truyện cũ hết hiệu lực, tránh việc giao diện hiển thị đầu ra được tạo từ một brief khác.

Toàn bộ danh mục, directive, công thức đề xuất và giao diện của Phòng chiến lược nằm trong mã TypeScript của Egoric; không nhập runtime, template hay tài nguyên giao diện từ kho đã khảo sát trước đây.

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

## Bốn phần bù so với AIWriteX

Không bê nguyên mô hình của họ về. AIWriteX đăng lên WeChat — nền tảng bài viết HTML — nên 35 template và trình sửa trực quan của họ giải quyết một bài toán ta không có: kênh của ta là feed văn bản thuần.

### Ảnh minh hoạ

Tách hai bước có chủ đích: lên ý tưởng bằng model chat (rẻ), vẽ bằng model ảnh (đắt). Prompt hiện ra để sửa trước khi bấm vẽ, và vẽ từng ảnh một để dừng được khi ảnh đầu đã sai hướng. **Không có nút "vẽ tất cả"** — đó là cách nhanh nhất để đốt credit vào ảnh không ai dùng.

Dùng lại `imageAdapter` nên thừa hưởng 42 model ảnh KIE, chuyển tuyến khi lỗi và đếm chi phí. Ba điều đưa vào prompt từ kinh nghiệm thực tế: prompt vẽ bằng tiếng Anh còn mô tả thay thế bằng tiếng Việt; bắt nêu rõ bối cảnh Việt Nam vì model mặc định vẽ người phương Tây; cấm đưa chữ vào ảnh vì model vẽ chữ rất tệ, càng tệ với tiếng Việt có dấu.

### Sửa bài trước khi đăng

Sửa tiêu đề, sapo, từng mục, hashtag, phần SEO có đếm ký tự. Mỗi thay đổi tính lại thời gian đọc để con số không lệch nội dung, và vòng kiểm Brand Kit chạy lại theo — sửa thành vi phạm thì nút đăng khoá lại ngay. Không cho xoá mục cuối cùng.

### Thư viện bài viết

Kho riêng trong IndexedDB (DB version 5), **dùng chung cho cả workspace** chứ không gắn vào dự án, nên tìm lại được bài cũ kể cả khi dự án đã đóng.

Tìm kiếm bỏ dấu trước khi so, vì người dùng gõ tìm thường lười bỏ dấu.

Cột "đã đăng ở đâu" đối chiếu với nhật ký đăng bài bằng **chính vân tay nội dung**, không lưu thêm quan hệ nào giữa hai kho. Đổi lại: sửa bài sau khi đăng thì vân tay đổi và bài hiện là chưa đăng — đúng về nghĩa, vì bản đang nằm trong thư viện quả thật chưa từng lên mạng.

### Dàn trang HTML

Ba bố cục: Tạp chí, Tối giản, Thẻ. Màu và font lấy từ Brand Kit của khách nên một bố cục ra được nhiều diện mạo — đúng thứ một agency cần, thay vì thư viện template cố định.

Sinh bằng chuỗi chứ **không gọi model**: dàn trang là việc xác định, gọi AI ở đây chỉ tốn tiền để nhận về HTML kém ổn định hơn.

Trang xuất ra độc lập hoàn toàn: không `<script>`, không tham chiếu tệp ngoài, ảnh nhúng thẳng. Mọi nội dung người dùng đều đi qua `escapeHtml`, có test khẳng định tiêu đề chứa `<img onerror=...>` bị vô hiệu hoá.

## Lưu trữ

Trạng thái Xưởng Nội dung nằm trong `ProjectState.contentStudio`, không phải state cục bộ của component. Nhờ vậy dùng luôn cơ chế tự lưu xuống IndexedDB và đồng bộ cloud sẵn có, không phải dựng đường lưu trữ riêng.

Giữ: nguồn xu hướng đang chọn, brief, ô từ khoá, bài viết, truyện, thời lượng. Không giữ: trạng thái đang bận, thông báo, và **danh sách chủ đề nóng vừa tải** — chúng hết hạn rất nhanh, mở lại dự án hôm sau mà thấy bảng xu hướng của hôm qua thì tệ hơn bảng trống.

`contentStudio` cũng nằm trong `ProjectSnapshot` để khôi phục checkpoint không xoá mất bài viết.

Mọi thay đổi đều tính từ `prev` trong hàm cập nhật chứ không từ biến trong closure. Đọc từ closure sẽ mất ký tự khi gõ nhanh, vì React gộp nhiều lần cập nhật còn biến ngoài vẫn giữ giá trị của lần render cũ. Có test mô phỏng đúng tình huống này.

## Nối với phần còn lại của Egoric

| Điểm nối | Cách làm |
|---|---|
| Brand Kit vào prompt | `buildBrandKitPromptContext(project.brandKitSnapshot)` được nối vào system prompt của cả viết bài lẫn dựng truyện. Tone of voice, từ bắt buộc, từ cấm và CTA đã duyệt đi vào ngay từ đầu, thay vì phải sửa ở vòng kiểm. |
| Cổng kiểm thương hiệu | `inspectBrandCompliance` chạy trên **đoạn sắp đăng**, không phải bài đầy đủ. Vi phạm thì nút đăng bị khoá, kèm chốt chặn thứ hai trong hàm xử lý. |
| Chi phí | `usageResourceId` dùng nhãn `content-article` và `content-story` theo đúng quy ước sẵn có. `projectId` tự gắn từ `setUsageProjectContext` trong `App.tsx`, nên chi phí Xưởng Nội dung đã vào Cost Dashboard và quy được về campaign qua liên kết project. |

Vì sao kiểm trên đoạn sắp đăng chứ không phải bài đầy đủ: bài dài bị cắt cho vừa giới hạn kênh, mà đoạn bị cắt có thể chính là chỗ chứa từ bắt buộc hoặc CTA. Kiểm bài đầy đủ sẽ báo đạt trong khi thứ thật sự lên mạng lại thiếu.

Không có Brand Kit thì bỏ qua vòng kiểm, hành vi giống như trước.

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

### Chống đăng trùng

Đây là hàng rào cho tình huống nguy hiểm nhất của sản phẩm: **mất mạng giữa lúc đăng**. Người dùng không biết bài đã lên hay chưa, bấm lại, và Trang khách hàng có hai bài giống nhau. Sự cố uy tín, không phải sự cố chi phí, và không tự sửa được.

Cơ chế nằm ở `publishLedgerService.ts`, ghi vào kho `publishLedger` của IndexedDB (DB version 4). Giao diện **chỉ gọi `publishWithGuard`**, không gọi thẳng `publishToChannel`, để không có đường nào đăng mà bỏ qua hàng rào.

Nguyên tắc: **ghi bản ghi `pending` xuống đĩa trước khi gọi mạng**. Tiến trình chết giữa chừng thì lần sau vẫn còn dấu vết.

Vân tay nội dung là `hash(channelId + accountId + text)` — cùng bài, cùng kênh, cùng tài khoản thì cùng vân tay. Không dùng hàm băm mật mã vì không cần chống giả mạo; trùng vân tay chỉ gây một cảnh báo thừa, tức là hỏng về phía an toàn.

Ba trạng thái và cách xử lý lần đăng kế tiếp trong 24 giờ:

| Trạng thái | Nghĩa | Lần sau |
|---|---|---|
| `success` | Chắc chắn đã lên | Chặn, kèm liên kết xem bài cũ |
| `pending` | **Không rõ đã lên hay chưa** | Chặn, yêu cầu tự kiểm tra trên nền tảng trước |
| `failed` | Chắc chắn chưa lên | Cho đăng lại ngay |

Phân biệt `pending` với `failed` là điểm mấu chốt. Lỗi có phản hồi từ nhà cung cấp (HTTP 400, token hết hạn) là **chắc chắn chưa lên** nên đăng lại an toàn. Còn `TypeError: Failed to fetch` nghĩa là **không nhận được phản hồi nào** — request vẫn có thể đã tới nơi và đã được xử lý. `PublishResult.indeterminate` đánh dấu đúng trường hợp này, và nhật ký giữ nguyên `pending` thay vì ghi `failed`.

Lỗi này bị bắt trong lúc chạy thử trên trình duyệt, không phải trong unit test — vì unit test mock hàm đăng *ném lỗi*, còn `publishToChannel` thật lại nuốt lỗi thành kết quả thất bại. Nay có test cho cả hai đường.

Người dùng đã tự kiểm tra trên nền tảng thì có nút *"Tôi đã kiểm tra, vẫn đăng"* để vượt hàng rào.

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
