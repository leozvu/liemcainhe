# Kiến trúc kết nối API

Egoric Studio hỗ trợ nhiều nhà cung cấp và giữ khóa riêng biệt cho từng dịch vụ:

- **OpenRouter**: mô hình hội thoại tương thích OpenAI.
- **Google AI Studio**: mô hình Gemini qua giao thức tương thích OpenAI.
- **Replicate**: mô hình tạo hình ảnh và video.

Trình duyệt gửi yêu cầu đến một trong ba tiền tố cùng miền:

- `/api-proxy/openrouter`
- `/api-proxy/google`
- `/api-proxy/replicate`

Vite, Electron, Cloudflare Worker hoặc Nginx chuyển tiếp yêu cầu đến đúng tên miền đã được khai báo cứng. Proxy không nhận URL đích từ người dùng, tránh biến máy chủ thành cổng chuyển tiếp tùy ý.

## Các vị trí cấu hình

- `types/model.ts`: metadata nhà cung cấp và mô hình tích hợp.
- `services/modelRegistry.ts`: lưu khóa theo nhà cung cấp và ánh xạ proxy.
- `services/providerService.ts`: kiểm tra khóa bằng điểm cuối miễn phí.
- `services/adapters/`: bộ điều hợp hội thoại, hình ảnh, video và Replicate.
- `vite.config.ts`: proxy khi phát triển và xem thử.
- `electron/main.cjs`: proxy trong bản máy tính.
- `worker/index.js`: proxy khi triển khai Sites/Cloudflare.
- `nginx.conf`: proxy trong Docker.

## Kiểm tra nhanh

```powershell
rg -n "/api-proxy/(openrouter|google|replicate)" vite.config.ts worker electron nginx.conf services
npm run build
```

Không commit khóa API, token hoặc thông tin đăng nhập vào repository.
