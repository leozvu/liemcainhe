# Kế hoạch: từ máy sinh thành trí tuệ sản xuất

## Thước đo, trước khi bàn tính năng

"Hoàn mỹ" không đo được nên không lập kế hoạch được. Ba con số dưới đây đo được, và **mọi hạng mục trong tài liệu này phải dịch chuyển ít nhất một trong ba**:

| Chỉ số | Ý nghĩa |
|---|---|
| **Tỷ lệ duyệt lần đầu** | Bao nhiêu phần trăm đầu ra được duyệt mà không phải sửa |
| **Số lần regenerate mỗi shot** | Đo trực tiếp lượng tiền đốt vào thứ bị vứt |
| **Chi phí mỗi giây video được duyệt** | Con số cuối cùng ăn vào margin |

Hạng mục nào không dịch chuyển được cái nào trong ba thì không đưa vào.

## Chẩn đoán hiện trạng

AI trong app đang đảm nhiệm **một vai**:

| Vai | Hiện trạng |
|---|---|
| **Máy sinh** | Mạnh. 114 model, chuyển tuyến khi lỗi, đếm chi phí |
| **Người lập kế hoạch** | Yếu. Creative Director đề xuất nhưng không giải bài toán ràng buộc |
| **Người thẩm định** | Đã có local audit, Vision dùng Reference Pack, confidence calibration, selective repair và Release Gate; còn thiếu dữ liệu chiến dịch thật để đo độ chính xác |
| **Người học** | **Không có.** Mọi dự án bắt đầu từ con số không |

Bằng chứng trong code: `CreativeDirectorToolName` có đúng sáu giá trị, cả sáu đều là công cụ sinh. Không có công cụ đọc số liệu, đọc lịch sử duyệt, hay ước tính chi phí trước khi làm.

Trí tuệ đến từ bốn thứ còn thiếu: **nhớ**, **thẩm định trước khi tiêu tiền**, **giữ nhất quán**, và **biết lúc nào mình đang không chắc**.

---

## Epic 1 — Thẩm định trước khi tiêu tiền

**Vì sao trước tiên:** rẻ nhất, tiết kiệm ngay từ ngày đầu, không cần dữ liệu tích luỹ.

Trước mỗi lời gọi model ảnh hoặc video (đắt), chạy một model chat (rẻ) để chấm prompt:

- Prompt có nêu rõ chủ thể không, hay chỉ tả không khí
- Có mâu thuẫn nội tại không (ban đêm + nắng gắt)
- Có vi phạm Brand Kit không
- Có yêu cầu thứ model này không làm được không (chữ trong ảnh, tay cầm vật thể phức tạp)
- Ảnh tham chiếu có đủ cho yêu cầu nhất quán không

Kết quả: **chặn**, **tự sửa prompt**, hoặc **cho qua**. Chi phí một lần chấm bằng khoảng 1/50 một lần sinh video.

**Đo:** số lần regenerate mỗi shot.

**Ước lượng:** 2–3 tuần.

---

## Epic 2 — Trí nhớ theo khách hàng

**Vì sao thứ hai:** rẻ, và giá trị **cộng dồn** — càng dùng càng tốt.

Hiện Brand Kit là bộ quy tắc tĩnh do người nhập. Thiếu thứ quan trọng hơn: **cái gì đã thực sự được duyệt**.

- Kho ví dụ đã duyệt theo từng khách, lấy tự động từ Bàn duyệt
- Đưa vào prompt dưới dạng few-shot từ chính bài đã được khách gật đầu
- Kho mẫu bị từ chối → ràng buộc phủ định, kèm lý do người duyệt ghi
- Ghi nhớ prompt ảnh nào cho ra kết quả được duyệt, tái sử dụng cấu trúc đó

Điểm mấu chốt: **dữ liệu này đã bắt đầu tự sinh ra rồi.** Bàn duyệt ghi lại mọi quyết định kèm ghi chú. Chỉ cần đọc và dùng.

**Đo:** tỷ lệ duyệt lần đầu, so sánh output thứ 1 với output thứ 20 của cùng một khách.

**Ước lượng:** 3–4 tuần.

---

## Epic 3 — Hiệu chỉnh người thẩm định

**Vì sao thứ ba:** không tốn công xây, nhưng **phải bắt đầu thu dữ liệu ngay hôm nay** vì nó cần thời gian tích luỹ.

AI Supervisor hiện đưa ra cảnh báo mà không ai biết chúng đúng bao nhiêu phần trăm. Cảnh báo sai nhiều thì người dùng bắt đầu bỏ qua tất cả — và lúc đó nó tệ hơn là không có.

- Mỗi cảnh báo ghi lại: người duyệt **chấp nhận** hay **bỏ qua**
- Tỷ lệ bỏ qua theo từng loại cảnh báo chính là tỷ lệ báo sai
- Loại nào bị bỏ qua trên 40% thì hạ xuống mức nhắc, không chặn
- Bổ sung điểm tin cậy; chỉ chặn khi đủ chắc
- Bộ dữ liệu vàng 500–1.000 shot do team tự chấm, dùng làm chuẩn

**Đo:** tỷ lệ người override cảnh báo — con số này phải giảm.

**Ước lượng:** 2 tuần xây cơ chế ghi nhận, rồi tích luỹ dần qua 20–30 campaign.

---

## Epic 4 — Bộ máy nhất quán nhân vật và sản phẩm

**Vì sao thứ tư dù là đòn bẩy lớn nhất:** đắt và khó nhất. Làm sau khi ba epic rẻ đã chạy và đã có dữ liệu để biết hỏng ở đâu.

Đây là nguyên nhân số một gây regenerate.

- **Character bible**: nhiều ảnh tham chiếu mỗi nhân vật, xếp hạng theo góc và ánh sáng
- **Khoá seed và tham số** của lần sinh được duyệt, tái dùng cho shot sau
- **Xác minh sau khi sinh**: khuôn mặt có khớp tham chiếu không, sản phẩm có đúng màu và bao bì không
- **Đồ thị phụ thuộc shot**: sửa nhân vật thì biết chính xác những shot nào phải sinh lại
- **Regenerate đúng lớp lỗi** thay vì sinh lại cả shot

Phần xác minh khuôn mặt là phần khó thật, có thể phải chấp nhận độ chính xác vừa phải ở vòng đầu.

**Đo:** số lần regenerate mỗi shot, mục tiêu giảm ít nhất 30%.

**Ước lượng:** 5–7 tuần.

---

## Epic 5 — Đạo diễn AI biết ràng buộc

Creative Director hiện có sáu công cụ, cả sáu đều để **sinh**. Bổ sung nhóm công cụ để **biết**:

- Đọc số liệu hiệu quả của các bài đã đăng
- Đọc lịch sử duyệt của khách này
- Ước tính chi phí một kế hoạch **trước** khi chạy
- So sánh nhiều phương án theo cả chất lượng lẫn giá

Khi có những công cụ đó, nó mới lập được kế hoạch trong ràng buộc thật: ngân sách campaign, deadline, và chuẩn thương hiệu. Và mới đề xuất được **model rẻ nhất đạt chuẩn** cho từng shot, thay vì luôn dùng model mặc định.

Ranh giới tự động vẫn giữ nguyên như đã chốt: không vượt ngân sách, không chạy model final khi chưa duyệt, không gửi link khách khi Account chưa duyệt, không tự xoá dữ liệu, không tự đổi Brand Kit.

**Đo:** chi phí mỗi giây video được duyệt.

**Ước lượng:** 4–6 tuần.

---

## Epic 6 — Trí tuệ dựng phim

Auto Editor hiện cắt máy móc: cắt thẳng hoặc mờ chồng theo thứ tự storyboard.

- Nhịp cắt theo nội dung: câu thoại dài thì giữ lâu, hành động nhanh thì cắt dồn
- Cắt theo nhịp nhạc
- Chọn take tốt nhất trong nhiều take giọng
- Tự chọn khung cắt bám chủ thể khi đổi tỷ lệ
- Đề xuất điểm chèn b-roll

**Đo:** giờ nhân sự mỗi campaign.

**Ước lượng:** 4–6 tuần, và nên làm sau khi có Cloud Auto Editor vì render nặng.

> Đã làm — xem [EDITING_INTELLIGENCE.vi.md](EDITING_INTELLIGENCE.vi.md). Smart Reframe đã nối vào FFmpeg theo từng shot+tỷ lệ. Master render trên bản Sites nay được lưu bền vững vào [Master Library](MASTER_LIBRARY.vi.md), tạo đầu vào ổn định cho vòng duyệt và phân phối.

---

## Thứ tự và lý do

```
Epic 1  Thẩm định trước khi tiêu tiền   2–3 tuần   rẻ, tiết kiệm ngay
Epic 2  Trí nhớ theo khách hàng          3–4 tuần   rẻ, giá trị cộng dồn
Epic 3  Hiệu chỉnh Supervisor            2 tuần     xây nhanh, dữ liệu tích luỹ dần
   ── chạy 20–30 campaign thật ──
Epic 4  Nhất quán nhân vật, sản phẩm     5–7 tuần   đòn bẩy lớn nhất, cần dữ liệu để làm đúng
Epic 5  Đạo diễn biết ràng buộc          4–6 tuần
Epic 6  Trí tuệ dựng phim                4–6 tuần
```

Ba epic đầu **không cần dữ liệu tích luỹ** nên làm được ngay. Epic 4 trở đi làm đúng hơn nhiều nếu đã có dữ liệu thật từ 20–30 campaign — không có nó thì đang tối ưu theo phỏng đoán.

## Một điều kiện tiên quyết

Tất cả những thứ trên đều dựa trên giả định: **vòng lặp cơ bản đã chạy tốt**. Hiện chưa ai chạy thật một lần nào — chưa có bài viết thật, chưa có ảnh thật, chưa có video nào đi hết vòng với khoá API thật.

Trước khi bắt Epic 1, nên chạy **ít nhất một campaign hoàn chỉnh** từ brief tới video xuất ra. Nó sẽ cho biết chỗ nào thật sự đau, và rất có thể thứ tự trên phải xếp lại.

Xây trí tuệ trên một vòng lặp chưa từng chạy là cách chắc chắn nhất để tối ưu nhầm chỗ.
