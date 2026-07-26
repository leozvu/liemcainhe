# Egoric Film Studio — Design System

## Định hướng

Egoric Film Studio là một bàn làm việc sản xuất điện ảnh, không phải một dashboard AI đại trà. Phong cách chủ đạo là **cinematic editorial**: nền graphite sâu, bề mặt ít nhưng rõ tầng, typography có nhịp điệu và một màu nhấn xanh băng mang tính công cụ.

## Nguyên tắc

- Mỗi màn hình chỉ có một hành động chính.
- Ưu tiên nội dung dự án, hình ảnh và âm thanh; chrome giao diện phải lùi xuống.
- Không dùng emoji làm biểu tượng. Toàn bộ biểu tượng dùng Lucide với stroke 1.5–2px.
- Chuyển động 160–280ms, chỉ dùng opacity/transform và phải tôn trọng `prefers-reduced-motion`.
- Mọi nút tương tác tối thiểu 44px; focus ring luôn nhìn thấy.
- Nội dung quan trọng đạt WCAG AA, không truyền trạng thái chỉ bằng màu sắc.

## Màu sắc

- Canvas: `#07090c`
- Surface 1: `#0d1117`
- Surface 2: `#121821`
- Surface raised: `#17202b`
- Text primary: `#f4f7fb`
- Text secondary: `#a7b0bd`
- Text muted: `#707b89`
- Border: `rgba(255,255,255,.09)`
- Accent: `#79e6df`
- Accent strong: `#a3fff7`
- Warm highlight: `#d8b976`
- Success: `#68d7a3`
- Warning: `#f3c969`
- Danger: `#ff7f8d`

## Typography

- Display/heading: Manrope, 600–700.
- Body: Be Vietnam Pro, 400–600.
- Technical metadata: JetBrains Mono, 400–500.
- Thang chữ: 12 / 14 / 16 / 20 / 24 / 32 / 44.

## Hình khối và khoảng cách

- Spacing theo nhịp 4/8px.
- Radius: 10px control, 16px card, 24px panel lớn.
- Shadow dùng ít; ưu tiên border và thay đổi surface để biểu đạt tầng.
- Desktop content tối đa 1600px; sidebar 248px, compact 84px.

## Các trạng thái bắt buộc

- Hover, pressed, focus-visible, disabled, loading, empty, error và success.
- Loading trên 300ms dùng skeleton/progress; không để nút bấm lặp.
- Lỗi phải nói nguyên nhân và cách khắc phục ngay tại vùng thao tác.

