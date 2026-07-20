# Cấu hình mô hình trong Egoric Studio

## Kết nối nhà cung cấp

1. Mở **Cấu hình mô hình** từ dashboard hoặc thanh bên.
2. Chọn **Cấu hình chung**.
3. Chọn nhà cung cấp, nhấn **Lấy khóa API** nếu chưa có khóa.
4. Dán khóa vào đúng thẻ nhà cung cấp.
5. Nhấn **Kiểm tra và lưu**.

Khóa của OpenRouter, Google AI Studio và Replicate được lưu tách biệt trong trình duyệt. Khóa của dịch vụ này không được gửi sang dịch vụ khác.

## Chọn mô hình hoạt động

Egoric Studio chia mô hình thành ba nhóm:

- **Hội thoại**: phân tích kịch bản, tạo bảng phân cảnh và tối ưu câu lệnh.
- **Hình ảnh**: tạo ý tưởng nhân vật, bối cảnh và khung hình chính.
- **Video**: tạo video từ văn bản, khung đầu hoặc khung cuối.

Nhấn **Sử dụng** trên thẻ mô hình để đặt mô hình hoạt động cho nhóm đó.

## Thêm mô hình tùy chỉnh

1. Chọn nhóm mô hình phù hợp.
2. Nhấn **Thêm mô hình tùy chỉnh**.
3. Chọn nhà cung cấp hỗ trợ nhóm đó.
4. Nhập tên hiển thị và chính xác giá trị `model` mà API mong đợi.
5. Chỉ nhập endpoint khi cần ghi đè đường dẫn mặc định.
6. Để trống khóa riêng của mô hình để dùng khóa đã lưu trên thẻ nhà cung cấp.

Với Replicate, dùng tên dạng `chủ-sở-hữu/tên-mô-hình`; Egoric Studio tự tạo endpoint dự đoán và kiểm tra trạng thái đến khi hoàn tất.

## Dữ liệu và quyền riêng tư

Cấu hình mô hình và khóa API được lưu trong trình duyệt. Xóa dữ liệu trang web sẽ xóa cả cấu hình và dự án cục bộ; hãy xuất bản sao trước khi dọn bộ nhớ.
