# Thẩm định ShopAIKey cho vận hành nội bộ Egoric

Ngày rà soát: 28/07/2026.

## Kết luận

**Mức đánh giá: dùng thử nội bộ có kiểm soát; chưa đủ điều kiện coi là provider
doanh nghiệp hoặc nền tảng cho SaaS bán ra ngoài.** Không thấy bằng chứng đủ để
kết luận đây là lừa đảo, nhưng cũng chưa có bằng chứng độc lập về pháp nhân,
quyền phân phối upstream, SLA, DPA hoặc kiểm toán bảo mật.

## Bằng chứng tích cực

- [Tài liệu chính thức](https://shopaikey.com/en/docs/introduction) công khai
  base URL, nhiều chuẩn API và endpoint media/TTS.
- [API video](https://shopaikey.com/en/docs/veo-video),
  [Nano Banana](https://shopaikey.com/en/docs/nano-banana) và
  [TTS](https://shopaikey.com/en/docs/tts) có request/response contract cụ thể.
- [Điều khoản](https://shopaikey.com/en/terms) và
  [chính sách riêng tư](https://shopaikey.com/privacy) đã được công bố; chính
  sách nói họ không lưu nội dung prompt/response và chỉ log metadata.
- Có Seller API, lịch sử sử dụng và cơ chế task ID, cho thấy sản phẩm có hạ tầng
  vận hành chứ không chỉ là trang bán key tĩnh.

## Điểm chưa đạt

- ShopAIKey tự xác nhận mình là **reverse proxy**, không phải chủ model.
  Điều khoản yêu cầu người dùng tự tuân thủ policy của upstream nhưng không nêu
  bằng chứng họ được upstream ủy quyền phân phối.
- Không tìm thấy tên pháp nhân, mã số thuế, địa chỉ doanh nghiệp, DPA, danh sách
  subprocessor, nơi lưu dữ liệu, thời hạn log hoặc báo cáo SOC 2/ISO 27001 trên
  các trang công khai đã rà soát.
- Điều khoản cung cấp dịch vụ theo dạng “as is/as available”, không bảo đảm
  uptime, có thể khóa tài khoản không báo trước, không hoàn credit chưa dùng và
  giới hạn trách nhiệm tối đa ở số tiền thanh toán trong ba tháng gần nhất.
- Trang model hiện ghi **374 model**, trong khi phần giới thiệu quảng cáo hơn
  500 model. Đây có thể là khác biệt giữa catalog khả dụng và marketing, nhưng
  cần xác minh bằng key thật.
- [Nguồn kiểm tra tên miền bên thứ ba](https://www.scamadviser.com/check-website/shopaikey.com)
  ghi nhận tên miền còn trẻ và chủ thể WHOIS được ẩn. Đây không phải bằng chứng
  lừa đảo, nhưng làm giảm khả năng truy cứu khi có tranh chấp.
- Thanh toán VietQR và chính sách không hoàn tiền làm khả năng chargeback thấp.
- Tài liệu đề xuất DNS resolver/script quyền quản trị. Egoric **không sử dụng**
  cách này; app chỉ đổi base URL qua proxy do mình kiểm soát.

## Luật vận hành bắt buộc

1. Dùng key riêng cho Egoric, không dùng key cá nhân hoặc key khách hàng.
2. Chỉ nạp số dư nhỏ theo tuần; không để số dư lớn trên tài khoản.
3. Không gửi PII, hợp đồng, dữ liệu tài chính, NDA brief hoặc asset chưa công bố.
4. Ghi request ID/task ID, số dư trước/sau và chi phí theo campaign.
5. Ảnh/video không tự retry hoặc fallback sau khi provider có thể đã nhận.
6. Chạy 20 request canary cho từng model trước khi đưa vào production board.
7. Nếu tỷ lệ lỗi vượt 10%, sai billing, mất task hoặc support không phản hồi
   trong một ngày làm việc: tắt cổng bằng một release và dừng nạp tiền.
8. Không dùng ShopAIKey làm backend cho khách hàng trả phí trước khi có văn bản
   xác nhận quyền thương mại/upstream, hóa đơn pháp nhân, DPA và SLA.

## Bài kiểm tra còn thiếu khóa thật

- Đối chiếu `/v1/models` với catalog trên website.
- Một chat JSON, một ảnh không reference, một ảnh có reference.
- Một video text-to-video và một video có khung đầu; đóng/mở tab để đối soát task.
- Một câu Gemini TTS tiếng Việt cho mỗi giọng mặc định.
- So sánh số dư trước/sau với telemetry Egoric và lưu request ID hỗ trợ.
