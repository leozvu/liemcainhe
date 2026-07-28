# Master Library

Sprint 1D là lớp nền bắt buộc trước khi nối TikTok, YouTube và Facebook Reels.

## Lỗi cấu trúc đã sửa

Auto Editor trước đây đọc MP4 từ FFmpeg, tạo một Blob URL để tải file rồi thu hồi URL sau 30 giây. `AutoEditorOutput` chỉ đổi sang `ready`; nó không giữ artifact, dung lượng, checksum hay đường dẫn cloud.

Hệ quả:

- không thể mở lại master sau khi reload;
- Bàn duyệt và Distribution không có một nguồn video ổn định để đọc;
- người dùng phải tự tìm file trong thư mục Downloads;
- nút đăng kênh sau này buộc phải dựa vào file người dùng chọn lại, không phải đúng version đã duyệt.

## Contract mới

`AutoEditorOutput` lưu thêm:

| Trường | Ý nghĩa |
|---|---|
| `videoUrl` | URL media Egoric trên R2; chỉ có khi lưu cloud thành công |
| `bytes` | Kích thước MP4 thực tế |
| `checksum` | SHA-256 của đúng artifact FFmpeg trả về |
| `storage` | `cloud` hoặc `downloaded` |
| `renderedAt` | Thời điểm render hoàn tất |
| `archivedAt` | Thời điểm R2 xác nhận lưu xong |
| `archiveError` | Lý do có file tải về nhưng chưa lưu được cloud |

Không tạo URL giả cho bản local. `downloaded` chỉ có nghĩa trình duyệt đã gửi file về thiết bị; nó không hứa rằng app có thể mở lại file đó.

## Entry point thật

1. `renderAutoEditorOutputInBrowser` trả `AutoEditorRenderArtifact` thay vì tự kết thúc sau thao tác download.
2. `AutoEditor.handleRender` tải file về thiết bị trước, rồi trên bản Sites gọi `uploadProjectMediaBlob`.
3. `uploadProjectMediaBlob` dùng endpoint media hiện có: một PUT cho file nhỏ, multipart 8 MB cho file lớn, SHA-256 để bỏ upload trùng.
4. Chỉ sau khi R2 trả URL, `finishAutoEditorRender` mới ghi `storage: cloud` và `archivedAt`.
5. Nếu R2 lỗi, render vẫn là `ready`, file vẫn được tải về, nhưng Master Library hiện cảnh báo rõ và không tạo `videoUrl`.

## Quy tắc version

- Lập lại đúng cùng một plan giữ nguyên master đã lưu.
- Đổi màu, crop, caption, voice, nhạc, logo hoặc media nguồn làm chữ ký plan đổi; lần lập kế hoạch sau xoá liên kết master cũ khỏi output mới.
- R2 cleanup nhìn thấy `AutoEditorOutput.videoUrl`, nên không xóa nhầm master còn được project tham chiếu.

## Giao diện

Workbench **Master Library** nằm sau Smart Reframe trong Auto Editor:

- xem được master cloud ngay trong app;
- phân biệt rõ “Đã lưu cloud” và “Chỉ trên máy”;
- hiện tỷ lệ, dung lượng và thời điểm lưu;
- có entry point mở master cloud;
- empty state chỉ người dùng render ở hàng đợi bên phải.

## Chưa làm trong Sprint 1D

- chưa gửi video lên TikTok, YouTube hoặc Facebook Reels;
- chưa đưa master vào version của cổng duyệt khách hàng;
- chưa có background render; FFmpeg vẫn chạy trong tab;
- chưa có retry nền cho upload master sau khi tab đóng.

Các adapter phân phối phải đọc `AutoEditorOutput.videoUrl` và checksum này, không được tự chọn một file khác ngoài version đã duyệt.
