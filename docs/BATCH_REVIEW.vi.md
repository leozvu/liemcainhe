# Duyệt hàng loạt

Phase D trong [MULTI_ACCOUNT_PLAN.vi.md](MULTI_ACCOUNT_PLAN.vi.md).

## Vấn đề

Hai mươi tài khoản đăng hằng ngày là khoảng **140 lượt duyệt mỗi tuần**. Bàn duyệt cũ duyệt từng bài một.

Kết cục dễ đoán: người duyệt bắt đầu bấm mà không đọc. Và lúc đó cổng duyệt **còn tệ hơn không có**, vì nó tạo cảm giác an toàn giả — ai cũng tưởng nội dung đã qua mắt người, thực tế thì không.

## Nhưng "duyệt tất cả" chính là cái bẫy đó

Nên quy tắc ở đây:

> **Chỉ mục mà mọi vòng kiểm tự động đều sạch mới được duyệt hàng loạt.**

Mục có cảnh báo là mục **máy đang phân vân** — đúng chỗ cần mắt người, và phải mở ra quyết riêng. Không có nút "duyệt tất cả" mù.

Kết quả: sự chú ý của người duyệt dồn vào đúng phần máy không chắc, thay vì rải đều lên cả trăm mục mà phần lớn không có gì để xem.

Hàng rào cũ còn nguyên: mục `blocked` không bao giờ lọt vào lô, và `decideBatch` vẫn đi qua `decideArticle` nên bài vi phạm Brand Kit vẫn bị chặn kể cả khi lọt vào danh sách.

## Tín hiệu chỉ để biết, khác tín hiệu đáng lo

Đây là phần phải sửa sau khi mở trình duyệt lên xem.

Bản đầu tiên đòi **mọi** tín hiệu phải `pass`. Nhưng tín hiệu "Ảnh" luôn `warn` khi bài không có ảnh minh hoạ — mà bài đăng Facebook/Threads/Zalo dạng chữ thì gần như không bao giờ có. Hệ quả: **không bài nào duyệt hàng loạt được**, tính năng chết ngay từ đầu.

`ReviewSignal` nay có `advisory`, tách hai thứ hay bị gộp làm một:

| Loại | Nghĩa | Ví dụ |
|---|---|---|
| Cảnh báo thật | Vòng kiểm chạy và **thấy có vấn đề** | Brand Kit chưa kiểm · độ dài lệch 1/3 |
| `advisory` | Vòng kiểm chạy và **báo lại một sự thật trung tính** | Bài không có ảnh |

Phép thử: *thiếu cái này có buộc người phải mở bài ra xem không?* Không có ảnh trong bài đăng dạng chữ thì không. Brand Kit chưa kiểm thì có.

Tín hiệu `advisory` vẫn hiện trên dòng — người duyệt vẫn thấy — nhưng không tước quyền duyệt hàng loạt.

## Gộp nhóm

Ba chế độ: không gộp, theo ngày (`Hôm nay` / `Hôm qua` / ngày tháng), theo dự án. Với 140 mục thì một danh sách phẳng không đọc được.

## Một bài hỏng không làm dừng cả lô

`decideBatch` trả kết quả từng mục, không ném lỗi ra ngoài. Người duyệt vừa bỏ vài phút đọc cả nhóm mà mất hết công vì một bản ghi lỗi là cách chắc chắn khiến lần sau họ không dùng nữa.

## Kiểm chứng

```bash
npx vitest run tests/reviewBatch.test.ts
```

20 test. Đáng chú ý:

- **Ba test cho bài thật đi qua `buildReviewQueue`** — đây là chỗ các test khác để lọt, vì chúng tự dựng `ReviewQueueItem` nên không bao giờ thấy tín hiệu thật trông thế nào
- Không có tín hiệu nào thì **không** coi là sạch — chưa kiểm khác với đã kiểm và đạt
- Một `fail` giữa nhiều `pass` vẫn bị loại
- Hàng rào Brand Kit vẫn chặn kể cả khi mục lọt vào lô
- Một bài hỏng không làm dừng các bài còn lại

Kiểm trong trình duyệt thật với 4 bài seed (2 sạch, 1 chưa kiểm Brand Kit, 1 vi phạm):

- Banner báo đúng `2 mục sạch` / `2 mục còn lại phải mở ra quyết riêng`
- **Đúng 2 checkbox**, chỉ nằm trên 2 mục sạch
- Bấm duyệt lô → `Đã ghi 2/2 mục`, bộ đếm đổi từ `4 chờ duyệt / 0 đã duyệt` thành `2 chờ duyệt / 2 đã duyệt`
- Mục bị chặn và mục có cảnh báo vẫn nguyên trạng thái chờ
- Gộp theo ngày ra đúng nhóm `Hôm qua · 2 mục`

Dữ liệu seed đã xoá sạch sau khi kiểm. 538 test / 40 file toàn bộ xanh, build sạch.

## Chưa làm

- Chưa gộp theo **tài khoản đăng** — vì bài viết chưa gắn với tài khoản nào cho tới lúc bấm đăng. Cần Phase C (lịch đăng) trước, khi đó mỗi bài mới biết trước nó sẽ lên tài khoản nào.
- Chưa có màn xem cả tuần theo dạng lịch.
- Video vẫn duyệt trong Trung tâm sản xuất của dự án, không duyệt hàng loạt ở đây được.
