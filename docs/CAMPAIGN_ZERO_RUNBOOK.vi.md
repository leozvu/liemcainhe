# Campaign 0 — Golden Run nội bộ

## Mục tiêu

Campaign 0 là lần chạy xuyên suốt đầu tiên của Egoric Film Studio bằng một chiến dịch thật của chính Egoric. Mục tiêu không phải tạo video đẹp nhất bằng mọi giá, mà chứng minh app có thể giữ dữ liệu, kiểm soát chi phí, duyệt đúng vai trò và bàn giao một master đã được nghiệm thu.

## Entry point

1. Mở **Campaign Hub**.
2. Chọn một chiến dịch nội bộ của Egoric.
3. Trong chi tiết chiến dịch, mở **Campaign 0 — ca vận hành chuẩn đầu tiên**.
4. Bấm **Bắt đầu Campaign 0**.

## 14 cổng bắt buộc

### Nền móng

- Brief sẵn sàng từ 80%.
- Brand Kit sẵn sàng từ 80%.
- Có ít nhất một project được tạo từ deliverable.

### Đo lường

- Chỉ định một người đóng vai khách hàng. Ưu tiên người không tham gia sinh nội dung.
- Telemetry dry-run được cloud xác nhận ở cả hai đường: usage và 6 pha lifecycle
  attempt, chi phí 0 USD.
- Bằng chứng hai thiết bị đã được thiết bị A tạo, thiết bị B xác nhận và thiết bị A chốt trong 7 ngày gần nhất.
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
- Dry-run hợp lệ phải có đủ: preflight, submitted, provider accepted, provider
  task, output committed và completed. Đây đều là event giả, không tạo tác vụ
  tại provider.
- Chỉ chạy chat rẻ trước, sau đó ảnh draft, cuối cùng mới đến video ngắn.
- Request trả phí đầu tiên bị khóa cho đến khi: dry-run cloud xanh, có project,
  ngân sách chiến dịch lớn hơn 0, khóa voice đã cấu hình, số dư provider trước
  test đã được chốt và không còn job mất dấu.
- Khi cổng mở, team tự sang **Lồng tiếng** và tạo đúng một câu tối đa 200 ký tự.
  Campaign 0 tuyệt đối không tự gọi provider.
- Dashboard hiển thị chi phí telemetry là ước tính. Số dư provider trước/sau là bằng chứng đối soát.
- Nếu chi phí thực tế lớn hơn telemetry, ghi nhận chênh lệch rồi điều tra billable attempt; không sửa số liệu cho khớp bằng tay.

## Đối chiếu execution trail

Khối **Đối chiếu execution trail** ghép ba nguồn theo project và tài nguyên:

- job bền vững trong workflow;
- usage/cost record;
- lifecycle từ preflight đến kết quả cuối.

Phải xử lý hết các cảnh báo trước request mới:

- `Interrupted`: provider có thể đã nhận; dùng task ID để kiểm tra, không tự chạy lại.
- `Provider đã nhận rồi mới thất bại`: khoản này có thể vẫn bị tính tiền dù usage
  đang ghi 0 USD.
- `Job hoàn tất nhưng thiếu usage`: Dashboard đang thấp hơn giá vốn thực.
- `Usage không có job`: đã có chi phí nhưng thiếu execution trail để điều tra và
  chống gửi trùng.

Sau request voice thật, nhập số dư provider sau test rồi lưu đối soát. Chênh lệch
giữa số dư và telemetry là bằng chứng cần điều tra, không phải số để sửa tay.

## Dữ liệu và đồng bộ

- Runbook được lưu trước vào IndexedDB để thao tác không mất dữ liệu khi mạng chập chờn.
- Trên bản production, app tự hợp nhất bản mới nhất lên workspace cloud khi mở hoặc lưu Campaign 0.
- Bấm trạng thái **Workspace đã lưu** ở Dashboard hoặc sidebar để mở Trung tâm
  đồng bộ. Bảng này đối chiếu số bản ghi local/cloud, ghi lỗi theo từng kho và
  có nút **Kiểm tra và đồng bộ toàn bộ**.
- Trước lượt media đầu tiên, mở Trung tâm đồng bộ trên thiết bị A để tạo mã,
  xác nhận mã trên thiết bị B rồi quay về A chốt. Sau đó bấm **Nạp bằng chứng
  từ cloud** trong Campaign 0. Tiếp tục checklist tạo/sửa/xóa bằng dữ liệu thử
  để kiểm chứng adapter và bia mộ. Toàn bộ bước này có chi phí AI bằng 0.
- Các run cũ từng nằm trong `localStorage` được chuyển sang kho mới ở lần mở đầu tiên.
- Xung đột giữa hai thiết bị được giải quyết bằng `updatedAt`; nếu cùng mốc, hai bên dùng cùng quy tắc phân thắng để không đồng bộ qua lại vô hạn.
