# Cấu hình mô hình ShopAIKey

## Kết nối

1. Mở **Cổng AI nội bộ**.
2. Ở **Cấu hình chung**, dán khóa ShopAIKey.
3. Nhấn **Kiểm tra và dùng trong phiên**.
4. App kiểm tra khóa bằng `/v1/models`; không gọi model trả phí.

Cùng khóa này được dùng cho hội thoại, ảnh, video và Gemini TTS. Khóa chỉ tồn
tại trong phiên trình duyệt và tự mất khi đóng phiên.

## Model mặc định

- Hội thoại: Grok 4.1 Fast Reasoning; có Qwen 3.5 Plus, GPT-5.2 và GPT-4.1.
- Hình ảnh: Nano Banana 2; có Nano Banana Pro, GPT Image 1 và Grok Imagine.
- Video: Veo 3 Fast; có Veo 3.1 Fast, Grok Video 3 và Sora 2.
- Giọng: Gemini TTS với Kore, Aoede, Leda, Orus và Puck.

Ảnh/video không tự chuyển model khi lỗi. Team phải đối soát request/task ID rồi
mới chủ động chạy lại để tránh trừ phí hai lần.

## Model hội thoại khác

Sau khi xác thực khóa, danh sách `/v1/models` xuất hiện trong thẻ ShopAIKey.
Có thể nhập model hội thoại từ danh sách đó. Model ảnh/video mới phải được thêm
vào catalog bằng adapter đúng contract; không gán bừa model media vào chat API.

## Quyền riêng tư

ShopAIKey là reverse proxy bên thứ ba. Không gửi dữ liệu cá nhân, hợp đồng, brief
mật, tài sản chưa công bố hoặc credential của khách hàng qua cổng này.
