# Lộ trình sau Epic 6

Viết ngày 25/07/2026, sau khi khảo sát lại toàn bộ repo ở commit `aa1ce46`.

## Đọc trước khi lập kế hoạch

App đã được xây **vượt xa điểm nó được kiểm chứng**.

| Sự thật | Số liệu |
|---|---|
| Nhánh `agent/vietnamese-egoric-rebrand` vượt bản đang chạy | **26 commit** |
| Vượt `origin/main` | 38 commit |
| Test | 460 / 37 file, đều xanh |
| Số lần toàn bộ 6 epic AI chạy với API key thật | **0** |
| Bản live đang chạy | `7b68e83`, từ 21/07 |

Nghĩa là: Xưởng Nội dung, Bàn duyệt, Sức khoẻ nhà cung cấp, Độ bền job, và **cả sáu epic AI** — chưa ai dùng được. Không phải "chưa hoàn thiện". Là **chưa tồn tại** đối với người dùng.

Rủi ro lớn nhất hiện nay không phải là một tính năng còn thiếu. Là 38 commit chưa từng gặp người dùng thật hay API thật.

---

## Bốn lỗ hổng cấu trúc

Ngoài chuyện chưa deploy, khảo sát code cho thấy bốn chỗ mà **không tính năng mới nào bù được**.

### 1. Video không ra khỏi app được

```ts
// types/content.ts:227
export type PublishChannelId = 'facebook-page' | 'threads' | 'zalo-oa';
```

Ba kênh, cả ba nhận **chữ**. Không có TikTok, không có YouTube, không có Reels.

Đường ống Bàn duyệt → Đăng bài — thứ được xây kỹ nhất trong Xưởng Nội dung, có sổ cái chống trùng, có vân tay, có trạng thái `indeterminate` — chỉ phục vụ bài viết. Video đi ra bằng `document.createElement('a')` rồi `a.download`.

Đây là app sản xuất video mà video phải tải về máy rồi tự upload tay.

### 2. Render bị nhốt trong tab trình duyệt

`browserMasterRenderService.ts` chạy `ffmpeg.wasm`, nạp core từ `cdn.jsdelivr.net`. Hệ quả:

- Đóng tab là mất bản render.
- Trần bộ nhớ WASM đặt trần độ dài dự án, và không ai biết trần đó ở đâu cho tới lúc chạm.
- Phụ thuộc một CDN bên ngoài. CDN chết hoặc bị chặn thì không render được gì.
- Máy yếu render chậm hơn máy mạnh — cùng một sản phẩm, trải nghiệm khác nhau.

### 3. Dữ liệu nằm trên đúng một máy

IndexedDB `EgoricStudioDB` v5 giữ: projects, assetLibrary, agencyClients, agencyCampaigns, publishLedger, articleLibrary.

`syncProjectToCloud` chỉ được gọi từ **hai chỗ**, cả hai đều do người dùng bấm:

```
components/ClientReviewManager.tsx   — khi gửi khách duyệt
components/ProductionCenter.tsx      — nút đồng bộ thủ công
```

Không có đồng bộ tự động. Và khách hàng, campaign, sổ cái đăng bài, thư viện bài viết **không bao giờ** lên cloud.

Xoá dữ liệu duyệt web = mất sạch. Không có cảnh báo, không có cách khôi phục. Đây là rủi ro thảm khốc và im lặng.

### 4. Danh tính phụ thuộc một nhà cung cấp host

```js
// worker/index.js:49
const getAuthenticatedEmail = (request) =>
  request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase() || null;
```

Toàn bộ mô hình danh tính dựa vào một header do ChatGPT Sites chèn vào. Hệ quả:

- Rời host là mất toàn bộ auth.
- Không chạy được ở local với danh tính thật, nên không test được luồng nhiều người dùng.
- Không mời được người ngoài vào — không có cách cấp tài khoản.

---

## Lộ trình

Sắp theo **rủi ro giảm được trên mỗi tuần công**, không theo độ thú vị.

### Phase 0 — Đưa lên live và chạy thật một campaign đầu-cuối

**~1 tuần. Chặn mọi thứ phía sau.**

1. Thu hồi hai API key đã dán trong chat (OpenRouter, KIE). Chưa làm thì đừng làm gì khác.
2. Merge `agent/vietnamese-egoric-rebrand` → nhánh deploy. 26 commit.
3. Nhập key thật vào app, **tự tay bạn nhập**, rồi chạy trọn một campaign: brief → bài viết → duyệt → đăng → kịch bản → shot → keyframe → video → voice → dựng → duyệt → xuất.
4. Ghi lại mọi chỗ vỡ.

**Vì sao đứng đầu:** sáu epic AI đang dựa trên giả định chưa ai kiểm. Epic 1 chặn prompt bằng regex chưa từng gặp prompt thật. Epic 3 hiệu chỉnh bằng **22 bản ghi tôi bịa ra**. Epic 2 dựa trên giả thuyết chưa được chứng minh: rằng đưa ví dụ đã duyệt vào prompt làm model viết nhất quán hơn.

Một lần chạy thật cho biết nhiều hơn ba epic nữa.

**Xong khi:** có một video đã render và một bài đã đăng, do app làm ra, bằng key thật.

---

### Phase 1 — Video ra khỏi app

**3–4 tuần.**

> Tiến độ nền tảng: Sprint 1D đã thêm [Master Library](MASTER_LIBRARY.vi.md). MP4 không còn biến mất khỏi app sau thao tác tải xuống; bản hosted lưu artifact và checksum lên R2. Adapter TikTok/YouTube/Reels vẫn chưa được coi là hoàn tất cho tới khi dùng chính master đã duyệt này và poll được trạng thái nền tảng.

> Tiến độ review: Sprint 1E đã nối [Master Review](MASTER_REVIEW.vi.md). Vòng Director → Editor → Account và quyết định khách hàng đều khóa đúng `masterOutputId + checksum`; version cũ không thể ký nhầm artifact mới. Bước kế tiếp là Distribution Gateway chỉ nhận master có chữ ký nghiệm thu hợp lệ.

> Tiến độ phân phối: Sprint 1F đã thêm [Distribution Gateway](DISTRIBUTION_GATEWAY.vi.md). Server chỉ tạo package khi ba chữ ký nội bộ, quyết định khách hàng, version và checksum cùng trỏ một master R2; ledger có idempotency và manifest JSON. Upload tự động vẫn chờ adapter OAuth + polling chính thức của từng nền tảng.

> Tiến độ upload: Sprint 1G đã thêm [Publishing Queue](DISTRIBUTION_PUBLISHING.vi.md). YouTube có OAuth server-side + resumable chunks + status probe; TikTok có OAuth + FILE_UPLOAD + creator inbox + status polling. Job và offset nằm ở D1, token mã hóa AES-GCM, kết quả mạng mơ hồ chuyển sang `indeterminate` thay vì retry mù. Meta vẫn chờ App Review.

Mở rộng đúng đường ống đã có, không xây mới:

- `PublishChannelId` thêm `tiktok`, `youtube`, `facebook-reels`.
- `PublishChannel` thêm khái niệm payload video: upload nhiều phần, hàng đợi xử lý, poll trạng thái. Ba kênh hiện tại đăng xong là xong; video thì nền tảng còn xử lý tiếp vài phút và có thể từ chối sau đó.
- Sổ cái đăng bài mở rộng cho video, giữ nguyên vân tay chống trùng và trạng thái `indeterminate` — cái bẫy đã bắt được ở bài viết còn nguy hiểm hơn với video, vì upload lại là tốn băng thông thật.
- **Cổng duyệt bắt buộc**, kể cả kênh của Egoric. Đây là quyết định bạn đã chốt: *"cả kênh của egoric cũng cần phải duyệt trước"*. Video không có ngoại lệ.

**Rủi ro thật:** TikTok Content Posting API và YouTube Data API đều cần app review và quota. Quá trình đó tính bằng tuần và **không nằm trong tay mình**. Nên nộp hồ sơ ngay đầu Phase 1, làm code song song trong lúc chờ.

**Đo:** số phút từ lúc video render xong tới lúc nó lên kênh. Hiện tại con số này là "tuỳ người dùng nhớ hay quên".

---

### Phase 2 — Dữ liệu phải sống sót qua một lần xoá cache

**3–4 tuần.**

1. Đồng bộ tự động, không cần bấm nút. Ghi cục bộ trước rồi đẩy nền — không bao giờ chặn thao tác người dùng vì mạng.
2. Đưa `agencyClients`, `agencyCampaigns`, `publishLedger`, `articleLibrary` và Brand Kit lên D1. Đã có sẵn 5 file migration, thêm một file nữa.
3. Giải quyết xung đột. Hai tab cùng mở một dự án là chuyện thường. Hiện tại tab nào ghi sau thì thắng, im lặng.
4. Chỉ báo trạng thái đồng bộ trong giao diện: đã lưu cloud lúc nào, còn gì chưa đẩy.

**Vì sao trước Phase 3:** rẻ hơn, và rủi ro nó chặn là loại không hồi lại được. Render chậm thì bực; mất ba tháng dữ liệu khách hàng thì hết chuyện.

**Đo:** đóng máy, mở trên máy khác, còn nguyên hay không.

---

### Phase 3 — Render rời khỏi tab

**6–8 tuần. Phần đắt nhất trong lộ trình.**

Cloudflare Worker không render video được — không đủ CPU time, không có ffmpeg. Cần một dịch vụ riêng.

Ba hướng, theo thứ tự tôi khuyến nghị:

| Hướng | Ưu | Nhược |
|---|---|---|
| Hàng đợi + worker container (Fly.io / Railway) | Kiểm soát hoàn toàn, chi phí đoán được | Phải tự vận hành, tự giám sát |
| Dịch vụ render sẵn (Shotstack, Creatomate) | Nhanh nhất để có bản chạy | Phụ thuộc, giá theo phút, khó tuỳ biến sâu |
| Cloudflare Containers | Cùng hệ sinh thái với worker và R2 | Còn mới, giới hạn chưa rõ |

Dù chọn hướng nào cũng cần: hàng đợi job bền, tiếp tục được sau khi ngắt, báo tiến độ về client, và dọn file tạm. `jobStateMachine.ts` và `durableJobService.ts` đã có sẵn phần khung.

Giữ đường render trong trình duyệt làm **phương án dự phòng** cho dự án ngắn — nó đã chạy được, đừng vứt.

**Đo:** render một dự án 3 phút mà không cần mở tab.

---

### Phase 4 — Danh tính không phụ thuộc host

**2–3 tuần.**

Tách `getAuthenticatedEmail` thành một lớp có nhiều nguồn: header của host (giữ nguyên đường hiện tại), phiên đăng nhập riêng, và một chế độ dev cho local.

Kèm theo: mời thành viên, vai trò, và không gian làm việc theo nhóm. Agency ERP đã có mô hình RBAC ba vai trò — dùng lại thay vì nghĩ lại.

**Vì sao không sớm hơn:** nếu chỉ mình bạn dùng, header hiện tại vẫn chạy. Nó là nợ, chưa phải cháy. Nhưng nó chặn mọi thứ liên quan tới nhiều người dùng, nên đừng để tới lúc cần mới làm.

---

### Phase 5 — Chứng minh sáu epic AI có tác dụng

**Chạy song song từ Phase 0, liên tục.**

Sáu epic đã xây xong nhưng chưa cái nào được đo. Từng cái cần một con số:

| Epic | Giả thuyết | Đo bằng gì |
|---|---|---|
| 1 · Thẩm định prompt | Chặn được lượt sinh sẽ hỏng | Tỷ lệ bị chặn, và trong số đó bao nhiêu là chặn oan |
| 2 · Trí nhớ khách hàng | Ví dụ đã duyệt làm model viết nhất quán hơn | Tỷ lệ duyệt lần đầu, trước và sau |
| 3 · Hiệu chỉnh Supervisor | Hạ độ nặng cảnh báo hay bị bỏ qua giúp giảm nhiễu | Tỷ lệ bỏ qua theo từng loại, theo thời gian |
| 4 · Nhất quán | Ảnh tham chiếu làm nhân vật giống nhau hơn | Số lần phải sinh lại vì lệch mặt |
| 5 · Giao ban Đạo diễn | Biết ràng buộc thì lập kế hoạch rẻ hơn | Chi phí trên mỗi giây video được duyệt |
| 6 · Trí tuệ dựng phim | Nhịp đề xuất tốt hơn nhịp mặc định | Tỷ lệ người dùng bấm "Áp nhịp đề xuất" rồi **không** sửa lại |

Epic nào sau 20–30 campaign thật mà không dịch được kim, **gỡ đi**. Giữ code chết chỉ làm chậm mọi thứ về sau.

Epic 3 đặc biệt: nó đang được hiệu chỉnh bằng dữ liệu bịa. Con số thật vào có thể cho kết quả ngược hẳn.

---

### Phase 6 — Nợ đã ghi nhận

Làm khi có chỗ trống, không cái nào chặn ai:

- **Xác minh khuôn mặt sau khi sinh** (phần còn lại của Epic 4). Cần embedding khuôn mặt hoặc một lượt AI Vision riêng. Nên hiệu chỉnh bằng dữ liệu thật trước khi cho quyền chặn.
- **Nối `suggestReframe` vào render nhiều tỷ lệ.** Hàm đã có, đã test, chưa có nút bấm.
- **Đoán BPM từ tệp nhạc.** Hiện phải nhập tay.
- **Tự tìm cảnh phụ để chèn.** Mới chỉ ra chỗ nên chèn.
- **Rà lại lỗi `\b` với tiếng Việt.** Đã sửa ở `promptPreflight`, nhưng `\b` không khớp `đ` và nguyên âm có dấu — nhiều khả năng còn chỗ khác trong codebase mắc đúng lỗi này, và nó **hỏng im lặng**.
- **Chia nhỏ bundle.** `index-*.js` đang 508 kB, vượt ngưỡng cảnh báo.
- **Dựng CI.** Chưa có `.github/workflows`. 460 test chỉ chạy khi có người nhớ chạy.

---

## Tổng thời gian

```
Phase 0  Live + chạy thật              1 tuần      ← chặn mọi thứ
Phase 1  Video ra khỏi app             3–4 tuần    ← nộp hồ sơ API ngay
Phase 2  Dữ liệu sống sót              3–4 tuần
Phase 3  Render rời tab                6–8 tuần    ← đắt nhất
Phase 4  Danh tính độc lập host        2–3 tuần
Phase 5  Đo 6 epic AI                  liên tục
Phase 6  Nợ kỹ thuật                   xen kẽ
```

Khoảng **4–5 tháng** tới hết Phase 4.

## Điều tôi sẽ không khuyên

**Đừng xây Epic 7.** Sáu epic hiện có chưa cái nào chứng minh được nó có tác dụng. Thêm epic thứ bảy chỉ làm dài thêm danh sách thứ chưa được kiểm chứng.

Việc đáng làm nhất tuần này không phải viết thêm code. Là đưa 26 commit đang nằm im lên live, rồi tự tay chạy một campaign từ đầu đến cuối.
