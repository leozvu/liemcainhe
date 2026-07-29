# Đăng nhập và phân quyền đội ngũ Egoric

## Mô hình vận hành

- Mỗi người có email và mật khẩu riêng; không dùng chung credential.
- `Owner` quản lý nhân sự, quyền, hồ sơ workspace và toàn bộ chức năng.
- `Director` điều hành sản xuất, AI, review và phân phối; chỉ đọc danh sách đội ngũ.
- `Editor` làm dự án, media, AI và review; không xem tài chính hay quản lý nhân sự.
- `Account` quản lý campaign, khách hàng, review, phân phối và tài chính; không gọi model AI.
- Tất cả nhân sự cùng nhìn một cloud workspace được neo theo email Owner. API vẫn giữ email người thao tác riêng để bổ sung audit log về sau.

## Bảo mật

- Mật khẩu: PBKDF2-SHA-256, 210.000 vòng, salt ngẫu nhiên riêng cho từng tài khoản.
- Phiên: token 256-bit ngẫu nhiên, D1 chỉ lưu SHA-256; cookie `HttpOnly`, `Secure`, `SameSite=Lax`, hạn 14 ngày.
- Login sai 8 lần sẽ khóa tạm 15 phút.
- Lời mời: token dùng một lần, D1 chỉ lưu SHA-256, hết hạn sau 7 ngày.
- Khi app-owned auth được bật, mọi header danh tính gửi từ trình duyệt bị xóa và được Worker dựng lại từ phiên hợp lệ.
- API AI, production, review, distribution và finance đều kiểm quyền ở Worker; ẩn nút trên UI không được coi là biện pháp bảo mật.

## Khởi tạo lần đầu

1. Cấu hình secret môi trường `EGORIC_BOOTSTRAP_TOKEN` bằng chuỗi ngẫu nhiên mạnh. Không commit chuỗi này.
2. Deploy migration `drizzle/0012_team_auth.sql` cùng Worker.
3. Mở site, nhập email Owner, họ tên, mật khẩu riêng và mã khởi tạo.
4. Sau khi Owner đầu tiên được tạo, API bootstrap tự từ chối mọi lần gọi tiếp theo.
5. Owner mở `Tài khoản và đội ngũ`, chọn vai trò, tạo link mời rồi gửi riêng cho từng nhân sự.

## Thu hồi quyền

Owner có thể tạm khóa tài khoản. Worker thu hồi toàn bộ session đang hoạt động của người đó ngay khi trạng thái chuyển sang `disabled`.

## Không gửi mật khẩu qua chat

Egoric chỉ gửi link mời dùng một lần. Mỗi nhân sự tự đặt mật khẩu trên site. Owner không biết và không cần lưu mật khẩu của họ.
