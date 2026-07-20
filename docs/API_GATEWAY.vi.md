# Kiến trúc kết nối API

Egoric Film Studio hỗ trợ nhiều nhà cung cấp và giữ khóa riêng biệt cho từng dịch vụ:

- **OpenRouter**: mô hình hội thoại tương thích OpenAI.
- **Google AI Studio**: mô hình Gemini qua giao thức tương thích OpenAI.
- **Replicate**: mô hình tạo hình ảnh và video.
- **ElevenLabs**: Eleven v3, thư viện Voice ID và tổng hợp giọng tiếng Việt.

Trình duyệt gửi yêu cầu đến một tiền tố cùng miền nằm trong danh sách cho phép:

- `/api-proxy/openrouter`
- `/api-proxy/google`
- `/api-proxy/replicate`
- `/api-proxy/elevenlabs`

Vite, Electron, Cloudflare Worker hoặc Nginx chuyển tiếp yêu cầu đến đúng tên miền đã được khai báo cứng. Proxy không nhận URL đích từ người dùng. Bản Sites còn yêu cầu danh tính đã đăng nhập, lọc danh sách header, giới hạn kích thước, rate-limit theo nhà cung cấp và đặt phản hồi ở chế độ `no-store`.

## Các vị trí cấu hình

- `types/model.ts`: metadata nhà cung cấp và mô hình tích hợp.
- `services/credentialVault.ts`: giữ khóa BYOK trong `sessionStorage`, tách khỏi dữ liệu lâu dài.
- `services/modelRegistry.ts`: quản lý danh mục, lấy khóa từ vault và ánh xạ proxy.
- `services/providerService.ts`: kiểm tra khóa bằng điểm cuối miễn phí.
- `services/adapters/`: bộ điều hợp hội thoại, hình ảnh, video và Replicate.
- `services/voiceRegistry.ts`: metadata giọng, khóa và cấu hình nhà cung cấp âm thanh.
- `services/voiceService.ts`: kiểm tra khóa, tải My Voices và tổng hợp giọng ElevenLabs.
- `vite.config.ts`: proxy khi phát triển và xem thử.
- `electron/main.cjs`: proxy trong bản máy tính.
- `worker/index.js`: proxy khi triển khai Sites/Cloudflare.
- `nginx.conf`: proxy trong Docker.

## Kiểm tra nhanh

```powershell
rg -n "/api-proxy/(openrouter|google|replicate|elevenlabs)" vite.config.ts worker electron nginx.conf services
npm run build
```

Không commit khóa API, token hoặc thông tin đăng nhập vào repository.
