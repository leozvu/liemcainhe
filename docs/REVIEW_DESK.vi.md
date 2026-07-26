# Bàn duyệt

Trung tâm vận hành → **Bàn duyệt**.

## Vì sao có

Chủ sản phẩm quyết định: **mọi thứ phải qua người duyệt trước khi ra ngoài, kể cả kênh của Egoric.**

Quyết định đó đổi mục tiêu của cả sản phẩm. Không phải "tự đăng", mà là: **app làm hết phần chuẩn bị, người duyệt trong vài giây**. Giá trị của tự động hoá nằm ở chỗ xoá bỏ công chuẩn bị, không phải xoá bỏ phán đoán — phán đoán tốn 30 giây, chuẩn bị tốn 3 tiếng.

Trước đây việc duyệt nằm rải rác: xác nhận đăng ở Xưởng Nội dung, vòng duyệt shot trong từng dự án, cổng khách hàng riêng. Không có chỗ nào nhìn thấy tất cả, nên người phụ trách phải tự nhớ còn gì chưa xử lý.

## Nguyên tắc thiết kế

**Mỗi dòng phải đủ ngữ cảnh để quyết mà không cần mở ra.** Các vòng kiểm tự động đã chạy sẵn được hiện thẳng trên dòng; mở chi tiết chỉ dành cho trường hợp cần xem kỹ.

Ví dụ một dòng thật:

```
BÀI VIẾT   Chờ duyệt   Bài chờ duyệt
           Brand Kit · Chưa kiểm — dự án không có Brand Kit
           Độ dài · 8 chữ, yêu cầu khoảng 900
           Ảnh · Chưa có ảnh nào                    [Duyệt] [Yêu cầu sửa]
```

## Tín hiệu

| Loại | Tín hiệu | Chặn? |
|---|---|---|
| Bài viết | Brand Kit — từ bản chụp lúc lưu | **Có** khi vi phạm |
| Bài viết | Độ dài — lệch quá 1/3 so với yêu cầu | Không, chỉ nhắc |
| Bài viết | Ảnh — số ảnh đã vẽ xong | Không |
| Video | Cổng nội bộ — Director/Editor/Account | Không |
| Video | Đã lỗi thời — nội dung đổi sau khi mở vòng | **Có** |
| Video | Yêu cầu sửa — vai nào đã từ chối | **Có** |

Bị chặn thì **không bấm Duyệt được**. Đó là toàn bộ lý do bàn duyệt tồn tại.

Kết quả kiểm Brand Kit được **chụp lại lúc lưu** thay vì tính lại lúc mở bàn duyệt, vì bàn duyệt nhìn nhiều dự án cùng lúc và không cầm được Brand Kit của từng dự án.

Video dùng lại `getAgencyReviewSummary` sẵn có, nên bàn duyệt không phải biết gì về cách video được duyệt bên trong. Quyết định video vẫn thực hiện trong Trung tâm sản xuất của dự án; bàn duyệt chỉ hiện trạng thái.

## Hai lỗ hổng đã bịt

**1. Sửa bài sau khi duyệt.** Bài được duyệt xong rồi sửa thành bất cứ thứ gì mà vẫn giữ dấu đã duyệt — đúng thứ bàn duyệt sinh ra để ngăn. Nay **đổi nội dung là mất hiệu lực phê duyệt**, không có ngoại lệ, kể cả sửa một dấu phẩy. `saveArticle` so nội dung cũ với mới và xoá `review` khi khác.

**2. Duyệt qua bài vi phạm.** `decideArticle` ném lỗi nếu cố duyệt bài đang vi phạm Brand Kit. Vẫn yêu cầu sửa được — chỉ không duyệt được.

## Chặn đăng khi chưa duyệt

Khối Đăng bài trong Xưởng Nội dung khoá nút cho tới khi bài ở trạng thái `approved`. **Không có nút bỏ qua** — khác với cảnh báo trùng nội dung, vốn có lối thoát vì người dùng có thể đã tự kiểm tra trên nền tảng.

## Kiểm chứng

```bash
npx vitest run tests/reviewQueue.test.ts
```

17 test, trong đó có hai test cho đúng hai lỗ hổng trên.

Đã chạy thật trên trình duyệt: bài mới sinh ra thì nút đăng khoá kèm câu *"Chưa qua bàn duyệt"*; lưu vào thư viện rồi duyệt ở bàn duyệt thì ghi `approved` xuống IndexedDB; mở lại bài thì hiện *"Đã duyệt, đăng được"* và nút mở khoá; **sửa một chữ trong tiêu đề thì nút khoá lại ngay**.

Trong lúc chạy thử phát hiện một lỗi: thư viện giữ bản đã nạp từ lúc mở màn hình, còn phê duyệt diễn ra sau đó ở bàn duyệt, nên mở bài ra vẫn thiếu dấu đã duyệt. Đã sửa bằng cách đọc lại bản mới nhất ngay trước khi mở.
