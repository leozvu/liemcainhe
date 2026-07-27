# Campaign 0 — Golden Run nội bộ

## Mục tiêu

Campaign 0 là lần chạy xuyên suốt đầu tiên của Egoric Film Studio bằng một chiến dịch thật của chính Egoric. Mục tiêu không phải tạo video đẹp nhất bằng mọi giá, mà chứng minh app có thể giữ dữ liệu, kiểm soát chi phí, duyệt đúng vai trò và bàn giao một master đã được nghiệm thu.

## Entry point

1. Mở **Campaign Hub**.
2. Chọn một chiến dịch nội bộ của Egoric.
3. Trong chi tiết chiến dịch, mở **Campaign 0 — ca vận hành chuẩn đầu tiên**.
4. Bấm **Bắt đầu Campaign 0**.

## 13 cổng bắt buộc

### Nền móng

- Brief sẵn sàng từ 80%.
- Brand Kit sẵn sàng từ 80%.
- Có ít nhất một project được tạo từ deliverable.

### Đo lường

- Chỉ định một người đóng vai khách hàng. Ưu tiên người không tham gia sinh nội dung.
- Telemetry dry-run được cloud xác nhận, chi phí 0 USD.
- Có ít nhất một phiên thời gian nhân sự đã kết thúc.

### Sản xuất

- Một lượt chat rẻ thành công.
- Một ảnh draft thành công.
- Một video ngắn thành công với budget cap.

### Duyệt

- Director, Editor và Account duyệt riêng theo thứ tự.
- Khách hàng hoặc client proxy duyệt qua portal, có version và thời điểm quyết định.

### Bàn giao

- Tất cả deliverable ở trạng thái **Đã bàn giao**.
- Nhập số dư provider trước và sau để đối chiếu chi tiêu thực tế với telemetry.

## Quy tắc chi phí

- Luôn chạy dry-run 0đ trước media.
- Chỉ chạy chat rẻ trước, sau đó ảnh draft, cuối cùng mới đến video ngắn.
- Dashboard hiển thị chi phí telemetry là ước tính. Số dư provider trước/sau là bằng chứng đối soát.
- Nếu chi phí thực tế lớn hơn telemetry, ghi nhận chênh lệch rồi điều tra billable attempt; không sửa số liệu cho khớp bằng tay.

## Dữ liệu và đồng bộ

- Runbook được lưu trước vào IndexedDB để thao tác không mất dữ liệu khi mạng chập chờn.
- Trên bản production, app tự hợp nhất bản mới nhất lên workspace cloud khi mở hoặc lưu Campaign 0.
- Bấm trạng thái **Workspace đã lưu** ở Dashboard hoặc sidebar để mở Trung tâm
  đồng bộ. Bảng này đối chiếu số bản ghi local/cloud, ghi lỗi theo từng kho và
  có nút **Kiểm tra và đồng bộ toàn bộ**.
- Trước lượt media đầu tiên, hoàn tất checklist hai thiết bị trong Trung tâm
  đồng bộ bằng dữ liệu thử. Bài kiểm tra này có chi phí AI bằng 0.
- Các run cũ từng nằm trong `localStorage` được chuyển sang kho mới ở lần mở đầu tiên.
- Xung đột giữa hai thiết bị được giải quyết bằng `updatedAt`; nếu cùng mốc, hai bên dùng cùng quy tắc phân thắng để không đồng bộ qua lại vô hạn.
