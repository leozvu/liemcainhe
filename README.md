# Egoric Film Studio

> Xưởng sản xuất phim ngắn, truyện tranh chuyển động và bảng phân cảnh bằng AI của Egoric Agency.

Egoric Film Studio biến ý tưởng hoặc kịch bản thành một quy trình sản xuất có thể xem trước, chỉnh sửa và xuất bản. Dữ liệu dự án, hình ảnh, bản thoại và cấu hình mô hình được lưu cục bộ trên thiết bị.

## Quy trình sản xuất

1. **Sáng tạo kịch bản** — phân tích cốt truyện, nhân vật, bối cảnh và bảng phân cảnh.
2. **Nhân vật & bối cảnh** — tạo concept, biến thể trang phục và ảnh tham chiếu.
3. **Voice Studio** — casting giọng Việt, tổng hợp bản nháp hoặc duyệt nhiều take của diễn viên thật.
4. **Xưởng dựng** — sản xuất khung hình chính đầu/cuối và video cho từng cảnh quay.
5. **Xuất bản** — xem timeline, tải video và toàn bộ tài nguyên gốc.

Kho sáng tạo là khu vực nâng cao để tìm kiếm và chỉnh câu lệnh nhân vật, bối cảnh, khung hình chính và video.

## Công nghệ

- React 19, TypeScript và Vite 6
- Tailwind CSS và Lucide icons
- IndexedDB cho dữ liệu dự án cục bộ
- OpenRouter và Google AI Studio cho mô hình hội thoại
- Replicate cho mô hình hình ảnh và video
- FPT.AI, Viettel AI và ElevenLabs cho bản nháp giọng nói; tệp âm thanh cho diễn viên thật
- Electron cho bản máy tính
- Docker và Nginx cho triển khai web

## Chạy cục bộ

Yêu cầu Node.js 20 trở lên.

```bash
npm install
npm run dev
```

Mở địa chỉ Vite hiển thị trong terminal. Để dùng các tính năng AI, mở **Cấu hình mô hình** và nhập API Key.

### Tạo bản phát hành

```bash
npm run build
npm run preview
```

### Bản máy tính

```bash
npm run electron:dev
npm run electron:build:win
```

Bộ cài Windows được tạo trong thư mục `release/` với tên **Egoric Film Studio**.

### Docker

```bash
docker compose up -d --build
docker compose logs -f
docker compose down
```

Ứng dụng mặc định chạy tại `http://localhost:3005`.

## Cấu hình API

Mặc định dự án hỗ trợ OpenRouter, Google AI Studio và Replicate cho hình ảnh/video; FPT.AI, Viettel AI và ElevenLabs cho giọng nói. Mỗi dịch vụ có khóa riêng và được chuyển tiếp qua một tuyến proxy cùng miền nằm trong danh sách cho phép. Xem [hướng dẫn cấu hình mô hình](./docs/MODEL_CONFIGURATION.vi.md), [hướng dẫn Voice Studio](./docs/VOICE_STUDIO.vi.md) và [kiến trúc kết nối API](./docs/API_GATEWAY.vi.md).

Khóa API chỉ được lưu trong bộ nhớ cục bộ của trình duyệt. Không đưa khóa API vào lịch sử Git.

## Thương hiệu và nguồn mở

Phiên bản này được Việt hóa và mang thương hiệu **Egoric Film Studio**, một sản phẩm của **Egoric Agency**.

Dự án được phát triển từ mã nguồn mở [yuanzhongqiao/printfilm](https://github.com/yuanzhongqiao/printfilm), phân phối theo giấy phép MIT. Mọi thương hiệu và dịch vụ mô hình của bên thứ ba thuộc về chủ sở hữu tương ứng.

## Hỗ trợ

Gửi lỗi hoặc đề xuất tại [GitHub Issues](https://github.com/leozvu/liemcainhe/issues).

## Giấy phép

MIT
