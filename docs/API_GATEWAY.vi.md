# Kiến trúc kết nối API

Egoric Film Studio hỗ trợ nhiều nhà cung cấp và giữ khóa riêng biệt cho từng dịch vụ:

- **OpenRouter**: mô hình hội thoại tương thích OpenAI.
- **Google AI Studio**: mô hình Gemini qua giao thức tương thích OpenAI.
- **Replicate**: mô hình tạo hình ảnh và video.
- **FPT.AI**: tổng hợp giọng Việt ba miền.
- **Viettel AI**: tổng hợp giọng Việt trực tiếp MP3/WAV.
- **ElevenLabs**: giọng biểu cảm và Voice ID tùy chọn.

Trình duyệt gửi yêu cầu đến một tiền tố cùng miền nằm trong danh sách cho phép:

- `/api-proxy/openrouter`
- `/api-proxy/google`
- `/api-proxy/replicate`
- `/api-proxy/fpt`
- `/api-proxy/viettel`
- `/api-proxy/elevenlabs`

Vite, Electron, Cloudflare Worker hoặc Nginx chuyển tiếp yêu cầu đến đúng tên miền đã được khai báo cứng. Proxy không nhận URL đích từ người dùng, tránh biến máy chủ thành cổng chuyển tiếp tùy ý.

## Các vị trí cấu hình

- `types/model.ts`: metadata nhà cung cấp và mô hình tích hợp.
- `services/modelRegistry.ts`: lưu khóa theo nhà cung cấp và ánh xạ proxy.
- `services/providerService.ts`: kiểm tra khóa bằng điểm cuối miễn phí.
- `services/adapters/`: bộ điều hợp hội thoại, hình ảnh, video và Replicate.
- `services/voiceRegistry.ts`: metadata giọng, khóa và cấu hình nhà cung cấp âm thanh.
- `services/voiceService.ts`: bộ điều hợp FPT.AI, Viettel AI và ElevenLabs.
- `vite.config.ts`: proxy khi phát triển và xem thử.
- `electron/main.cjs`: proxy trong bản máy tính.
- `worker/index.js`: proxy khi triển khai Sites/Cloudflare.
- `nginx.conf`: proxy trong Docker.

## Kiểm tra nhanh

```powershell
rg -n "/api-proxy/(openrouter|google|replicate|fpt|viettel|elevenlabs)" vite.config.ts worker electron nginx.conf services
npm run build
```

Không commit khóa API, token hoặc thông tin đăng nhập vào repository.
