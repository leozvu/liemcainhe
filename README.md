# Egoric Studio

> Xưởng sản xuất phim ngắn, motion comic và storyboard bằng AI của Egoric Agency.

Egoric Studio biến ý tưởng hoặc kịch bản thành một quy trình sản xuất có thể xem trước, chỉnh sửa và xuất bản. Dữ liệu dự án, hình ảnh và cấu hình model được lưu cục bộ trong trình duyệt bằng IndexedDB.

## Quy trình sản xuất

1. **Sáng tạo kịch bản** — phân tích cốt truyện, nhân vật, bối cảnh và storyboard.
2. **Nhân vật & bối cảnh** — tạo concept, biến thể trang phục và ảnh tham chiếu.
3. **Xưởng AI** — sản xuất keyframe đầu/cuối và video cho từng cảnh quay.
4. **Sản xuất & xuất bản** — xem timeline, tải video và toàn bộ tài nguyên gốc.
5. **Quản lý tài nguyên** — tìm kiếm và chỉnh prompt nhân vật, bối cảnh, keyframe và video.

## Công nghệ

- React 19, TypeScript và Vite 6
- Tailwind CSS và Lucide icons
- IndexedDB cho dữ liệu dự án cục bộ
- API tương thích OpenAI cho model văn bản, hình ảnh và video
- Electron cho bản desktop
- Docker và Nginx cho triển khai web

## Chạy cục bộ

Yêu cầu Node.js 20 trở lên.

```bash
npm install
npm run dev
```

Mở địa chỉ Vite hiển thị trong terminal. Để dùng các tính năng AI, mở **Cấu hình mô hình** và nhập API Key.

### Build production

```bash
npm run build
npm run preview
```

### Bản desktop

```bash
npm run electron:dev
npm run electron:build:win
```

Bộ cài Windows được tạo trong thư mục `release/` với tên **Egoric Studio**.

### Docker

```bash
docker compose up -d --build
docker compose logs -f
docker compose down
```

Ứng dụng mặc định chạy tại `http://localhost:3005`.

## Cấu hình API

Mặc định dự án dùng một gateway tương thích OpenAI và chuyển tiếp yêu cầu qua `/api-proxy` để tránh lỗi CORS. Xem [hướng dẫn cấu hình model](./docs/MODEL_CONFIGURATION.vi.md) và [hướng dẫn thay gateway API](./docs/API_GATEWAY.vi.md).

API Key chỉ được lưu trong bộ nhớ cục bộ của trình duyệt. Không commit API Key vào repository.

## Thương hiệu và nguồn mở

Phiên bản này được Việt hóa và white-label thành **Egoric Studio**, một sản phẩm của **Egoric Agency**.

Dự án được phát triển từ mã nguồn mở [yuanzhongqiao/printfilm](https://github.com/yuanzhongqiao/printfilm), phân phối theo giấy phép MIT. Mọi thương hiệu và dịch vụ model của bên thứ ba thuộc về chủ sở hữu tương ứng.

## Hỗ trợ

Gửi lỗi hoặc đề xuất tại [GitHub Issues](https://github.com/leozvu/liemcainhe/issues).

## Giấy phép

MIT
