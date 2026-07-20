# Xưởng giọng Việt

Xưởng giọng nằm ở Giai đoạn 03, giữa Tài nguyên và Xưởng dựng. Mỗi nhân vật có một hồ sơ giọng riêng; mỗi câu thoại có thể chứa nhiều take và chỉ một take được chọn để phát hành.

## Kết nối ElevenLabs

1. Tạo khóa tại [ElevenLabs API Keys](https://elevenlabs.io/app/settings/api-keys).
2. Nếu khóa bị giới hạn quyền, bật **Text to Speech** và **Voices**; không giới hạn IP cho bản web.
3. Trong dự án, mở **Giọng thoại → Kết nối giọng nói**.
4. Dán khóa rồi chọn **Kiểm tra và sử dụng**.
5. Chọn giọng cho từng nhân vật từ danh sách My Voices được tải tự động.

Egoric sử dụng `eleven_v3`, ép ngôn ngữ `vi` và chỉ gửi các tham số mà model này hỗ trợ. Nếu khóa không có quyền đọc danh sách giọng, bạn vẫn có thể dán Voice ID thủ công.

Nên chọn voice gốc có chất giọng hoặc accent Việt Nam. Voice được huấn luyện chủ yếu bằng ngôn ngữ khác có thể đọc sai thanh điệu và tên riêng.

## Giọng người thật

Để bản phát hành hoàn toàn không dùng giọng tổng hợp:

1. Chia vai cho diễn viên dựa trên danh sách nhân vật.
2. Tại từng câu thoại, chọn **Nhập bản thu**.
3. Tải lên MP3/WAV/M4A, tối đa 25 MB mỗi take.
4. Nhập nhiều take nếu cần và chọn take tốt nhất trong danh sách.

Ứng dụng gắn nhãn rõ **Người thật** cho take được nhập; không giả mạo bản thu thật thành kết quả TTS.

## Bảo mật và chi phí

- Khóa giọng nói tách biệt với khóa hội thoại, hình ảnh và video.
- Khóa chỉ được giữ trong phiên trình duyệt hiện tại, không đưa vào localStorage, tệp dự án, cloud hoặc Git. Đóng phiên sẽ yêu cầu nhập lại.
- Nút tạo hàng loạt hiển thị xác nhận vì mỗi câu có thể tiêu hao hạn mức API.
- Chỉ nhân bản giọng khi có sự đồng ý rõ ràng của chủ giọng và quyền sử dụng thương mại phù hợp.
