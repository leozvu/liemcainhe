# Thay đổi gateway API

Egoric Studio gửi yêu cầu từ trình duyệt đến `/api-proxy`, sau đó Vite, Electron hoặc Nginx chuyển tiếp đến gateway thật. Thiết kế này giúp giữ cùng một luồng yêu cầu và tránh CORS.

## Các vị trí cần cập nhật

- `types/model.ts`: URL và tên nhà cung cấp mặc định.
- `services/modelConfigService.ts`: cấu hình provider mặc định.
- `services/geminiService.ts`: `DEFAULT_API_BASE` và logic chọn proxy.
- `services/adapters/chatAdapter.ts`: URL dự phòng khi xác thực API Key.
- `services/modelRegistry.ts`: hàm nhận diện hostname của gateway.
- `vite.config.ts`: proxy cho môi trường phát triển.
- `electron/main.cjs`: proxy trong bản desktop.
- `nginx.conf`: proxy trong Docker/production.

## Quy trình

1. Thay URL gateway ở tất cả vị trí trên.
2. Cập nhật header `Host`, `Origin` và `Referer` trong Nginx nếu gateway yêu cầu.
3. Giữ nguyên tiền tố `/api-proxy` ở frontend, trừ khi bạn đồng thời thay cả ba môi trường.
4. Chạy `npm run build` và xác thực API Key trong giao diện.

## Kiểm tra nhanh

```powershell
rg -n "api\.gitcc\.com|/api-proxy" .
```

Không commit API Key, token hoặc thông tin đăng nhập vào repository.
