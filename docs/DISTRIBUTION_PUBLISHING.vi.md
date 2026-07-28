# Publishing Queue và OAuth nền tảng

Sprint 1G nối `DistributionPackage` đã ký với hai adapter chính thức đầu tiên: YouTube resumable upload và TikTok Content Upload. Hệ thống không tuyên bố đã đăng nếu nền tảng chưa xác nhận.

## Ranh giới an toàn

1. Job chỉ được tạo từ một package còn khớp master R2, checksum, source signature, ba chữ ký nội bộ và quyết định khách hàng.
2. Một package + platform + connection chỉ có một idempotency key. Bấm lại không sinh job thứ hai.
3. Token OAuth và upload session URL được mã hóa AES-GCM bằng `DISTRIBUTION_TOKEN_KEY`; API và account export không trả `secret_json` hay `private_json`.
4. OAuth state hết hạn sau 10 phút và bị xóa trước khi đổi authorization code, nên không thể dùng lại callback.
5. Mỗi request chỉ gửi một chunk. Offset nằm trong D1 nên đóng tab rồi mở lại vẫn tiếp tục được.
6. Nếu mất mạng giữa chunk, job chuyển sang `indeterminate`. Nút retry bị khóa; operator phải **đối soát** với upload session/status endpoint trước.

## Trạng thái job

| Trạng thái | Ý nghĩa | Hành động hợp lệ |
|---|---|---|
| `queued` | Đã khóa package và tài khoản | Mở upload session |
| `uploading` | Đang gửi từng chunk từ R2 | Tiếp tục từ offset đã xác nhận |
| `processing` | Nền tảng đã nhận đủ bytes | Poll trạng thái |
| `awaiting-user` | TikTok đã gửi draft vào inbox creator | Creator mở TikTok để hoàn tất |
| `published` | Nền tảng xác nhận hoàn tất | Không upload lại |
| `failed` | Kết quả thất bại rõ ràng | Retry chỉ khi `retrySafe=true` |
| `indeterminate` | Request có thể đã được nhận nhưng Egoric mất phản hồi | Chỉ đối soát, không retry mù |

## YouTube

- OAuth scope: `youtube.upload` và `youtube.readonly`.
- Upload dùng protocol resumable, chunk 8 MiB.
- Khi mất phản hồi, Egoric gửi status probe `Content-Range: bytes */TOTAL` để lấy offset thật.
- Quyền riêng tư mặc định là **Riêng tư**. Chọn Công khai cần xác nhận thêm trong UI.
- Sau upload, app poll `videos.list(part=status)` cho tới `processed`, `failed` hoặc `rejected`.

Tài liệu chính thức: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol

## TikTok

- OAuth scope: `user.info.basic,video.upload`.
- Dùng Content Posting **Upload API**, không tự Direct Post công khai.
- Video được chuyển bằng `FILE_UPLOAD`, chunk 10 MiB; job sau đó vào `awaiting-user` khi TikTok báo `SEND_TO_USER_INBOX`.
- Creator phải mở thông báo trong TikTok, chỉnh sửa và bấm đăng. Chỉ `PUBLISH_COMPLETE` mới thành `published`.
- Direct Post vẫn cần audit riêng; app không lách hạn chế private-only của client chưa được audit.

Tài liệu chính thức:

- https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
- https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status

## Cấu hình production

Đặt các biến sau trong Sites runtime, không điền giá trị thật vào Git:

```text
YOUTUBE_CLIENT_ID
YOUTUBE_CLIENT_SECRET
TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET
DISTRIBUTION_TOKEN_KEY   # tối thiểu 32 ký tự ngẫu nhiên
```

Giữ `DISTRIBUTION_TOKEN_KEY` ổn định. Nếu buộc phải xoay khóa, hãy để toàn bộ job kết thúc rồi kết nối lại các tài khoản; khóa cũ mất thì token và upload session cũ không thể giải mã.

Callback phải được khai báo chính xác tại developer console:

```text
https://egoric-studio-vietnam.leozvu-work.chatgpt.site/api/distribution-oauth/callback/youtube
https://egoric-studio-vietnam.leozvu-work.chatgpt.site/api/distribution-oauth/callback/tiktok
```

Nếu credential chưa tồn tại, UI hiển thị `Chưa cấu hình` và khóa nút kết nối. Không có chế độ giả kết nối.

## Meta

Instagram Reels và Facebook Reels vẫn hiển thị trong package nhưng adapter live bị khóa bằng trạng thái `app-review`. Không tự đoán Graph version, Page permissions hoặc dùng token dán trong trình duyệt. Sprint tiếp theo chỉ mở chúng sau khi Meta App Review, Page selection và public media handoff có contract kiểm thử được.
