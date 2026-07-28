# Kiến trúc cổng AI nội bộ

Egoric Film Studio đang chạy chế độ **ShopAIKey-only** cho vận hành nội bộ.
Một khóa ShopAIKey phục vụ bốn nhóm tác vụ:

- Hội thoại qua giao thức OpenAI-compatible.
- Ảnh qua OpenAI Images hoặc `/images/google/generations`.
- Video qua `/v1/videos` hoặc hàng đợi `/v1/video/generations`.
- Giọng nói qua `/tts/google/generations`.

Mọi yêu cầu đi qua tiền tố cùng miền `/api-proxy/shopaikey`. Worker và desktop
không còn entry point cho OpenRouter, Google AI Studio, Replicate, KIE, FPT,
Viettel hoặc ElevenLabs. Nginx trả HTTP 410 cho các tiền tố AI cũ.

Adapter cũ vẫn được giữ trong mã nguồn để có thể phục hồi sau một quyết định
kiến trúc có chủ đích; registry và giao diện không thể chọn chúng ở chế độ này.

## Nguyên tắc an toàn

- Khóa chỉ nằm trong `sessionStorage`, không đi vào project, localStorage, D1,
  R2 hoặc Git.
- Không tự fallback ảnh/video sang model thứ hai.
- Task video phải có task ID và được poll đúng task; mất kết nối không tạo lại.
- Chỉ nhập động model trả từ `/v1/models` vào nhóm hội thoại. Media dùng catalog
  đã kiểm contract để tránh gửi sai endpoint và phát sinh phí.
- Không dùng DNS resolver hoặc script cài đặt cấp hệ thống của bên thứ ba.

## Vị trí chính

- `types/model.ts`: provider và catalog mặc định.
- `services/modelRegistry.ts`: policy ShopAIKey-only, vault và active model.
- `services/adapters/shopAIKeyAdapter.ts`: ảnh Nano Banana và video Veo/Grok.
- `services/voiceService.ts`: Gemini TTS qua ShopAIKey.
- `vite.config.ts`, `electron/main.cjs`, `worker/index.js`, `nginx.conf`: proxy.

Không commit khóa API, token hoặc thông tin đăng nhập vào repository.
