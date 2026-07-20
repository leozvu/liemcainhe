# Voice Studio tiếng Việt

Voice Studio nằm ở Giai đoạn 03, giữa Tài nguyên và Xưởng dựng. Mỗi nhân vật có một hồ sơ giọng riêng; mỗi câu thoại có thể chứa nhiều take và chỉ một take được chọn để phát hành.

## Chọn nguồn giọng

### FPT.AI Voice Maker

1. Tạo khóa tại [FPT.AI Console](https://console.fpt.ai/).
2. Trong dự án, mở **Giọng thoại → Kết nối giọng nói → FPT.AI**.
3. Dán khóa, lưu kết nối, sau đó chọn giọng Bắc/Trung/Nam cho từng nhân vật.

FPT xử lý bất đồng bộ nên đường dẫn âm thanh có thể cần vài giây trước khi phát được.

### Viettel AI

1. Lấy token tại [Viettel AI](https://viettelai.vn/dashboard/token).
2. Mở **Kết nối giọng nói → Viettel AI** và lưu token.
3. Chọn giọng theo vùng miền rồi tạo từng câu hoặc tạo hàng loạt.

### ElevenLabs

1. Tạo khóa tại [ElevenLabs API Keys](https://elevenlabs.io/app/settings/api-keys).
2. Lưu khóa trong **Kết nối giọng nói → ElevenLabs**.
3. Sao chép Voice ID từ thư viện ElevenLabs và dán vào hồ sơ nhân vật.

Nên chọn voice gốc nói tiếng Việt. Voice có accent ngoại ngữ dễ đọc sai thanh điệu hoặc tên riêng.

### Vbee

Vbee AIVoice API trả kết quả qua callback URL công khai. Bản web tĩnh hiện không giữ một máy chủ callback riêng. Có thể tạo âm thanh tại Vbee rồi dùng nút **Nhập bản thu**, hoặc triển khai backend riêng và nối callback sau.

## Giọng người thật

Để bản phát hành hoàn toàn không dùng giọng tổng hợp:

1. Chia vai cho diễn viên dựa trên danh sách nhân vật.
2. Tại từng câu thoại, chọn **Nhập bản thu**.
3. Tải lên MP3/WAV/M4A, tối đa 25 MB mỗi take.
4. Nhập nhiều take nếu cần và chọn take tốt nhất trong danh sách.

Ứng dụng gắn nhãn rõ **Người thật** cho take được nhập; không giả mạo bản thu thật thành kết quả TTS.

## Bảo mật và chi phí

- Khóa giọng nói tách biệt với khóa hội thoại, hình ảnh và video.
- Khóa được lưu cục bộ trên thiết bị, không đưa vào tệp dự án hoặc Git.
- Nút tạo hàng loạt hiển thị xác nhận vì mỗi câu có thể tiêu hao hạn mức API.
- Chỉ nhân bản giọng khi có sự đồng ý rõ ràng của chủ giọng và quyền sử dụng thương mại phù hợp.

