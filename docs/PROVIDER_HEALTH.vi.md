# Sức khoẻ nhà cung cấp và ngắt mạch

Thuộc Giai đoạn 1 — Production Reliability.

## Ý chính

Không thu thập thêm dữ liệu nào. `recordUsage` vốn đã ghi `providerId`, `modelId`, `status`, `error` và `durationMs` cho mọi lời gọi AI. Chỗ thiếu chỉ là chưa ai đọc chúng theo chiều nhà cung cấp.

## Phân loại lỗi

`classifyApiError(input, status)` trả về một trong tám loại:

| Loại | Nghĩa | Phía nhà cung cấp? |
|---|---|---|
| `balance` | Hết số dư | Không |
| `rate-limit` | Giới hạn tốc độ hoặc đồng thời | **Có** |
| `auth` | Khóa API không hợp lệ | Không |
| `permission` | Không đủ quyền | Không |
| `moderation` | Bị bộ lọc nội dung chặn | Không |
| `server` | Nhà cung cấp gián đoạn | **Có** |
| `network` | Lỗi kết nối | **Có** |
| `unknown` | Chưa xác định | Không |

Cột cuối quyết định có ngắt mạch hay không. Hết tiền, khóa sai, thiếu quyền hay nội dung bị chặn đều là vấn đề của **tài khoản hoặc của nội dung**; chuyển sang nhà cung cấp khác cũng hỏng y hệt, nên ngắt mạch trong những trường hợp đó chỉ làm mất oan các lựa chọn còn tốt.

Logic này vốn nằm rải trong `localizeApiErrorMessage`; nay tách ra thành phân loại có cấu trúc và hàm dịch dùng lại chính nó, nên thông báo không đổi.

### Hai điều phải biết khi đọc nhật ký

`recordUsage` lưu **thông báo đã việt hoá**, không lưu lỗi gốc của nhà cung cấp. Nếu chỉ dò mẫu tiếng Anh thì mọi bản ghi đều rơi vào `unknown`. Bộ phân loại vì vậy nhận diện cả chuỗi tiếng Việt của chính ứng dụng.

Trong lúc viết test còn phát hiện một lỗi có sẵn: mẫu nhận diện lỗi mạng là `fetch failed`, trong khi chuỗi trình duyệt thật sự ném ra là **`Failed to fetch`** — tức là ca hay gặp nhất bị bỏ lọt và rơi vào thông báo chung chung. Đã sửa, kèm `load failed`, `enotfound`, `econnrefused`.

## Bốn trạng thái

| Trạng thái | Điều kiện |
|---|---|
| `unknown` | Dưới 3 lượt gọi trong cửa sổ — chưa đủ căn cứ |
| `down` | Từ 4 lần lỗi liên tiếp **do phía nhà cung cấp** |
| `degraded` | Tỷ lệ thành công dưới 80% |
| `healthy` | Còn lại |

Cửa sổ mặc định 1 giờ. Một lần thành công cắt đứt chuỗi lỗi liên tiếp.

## Ngắt mạch

`applyCircuitBreaker` loại các model thuộc nhà cung cấp đang `down` khỏi danh sách định tuyến.

Hai bảo hiểm quan trọng:

1. **Lọc xong rỗng thì trả lại nguyên danh sách.** Thà thử rồi nhận lỗi thật của nhà cung cấp, còn hơn báo "không có model khả dụng" — thông báo đó khiến người dùng đi tìm nhầm chỗ, tưởng mình cấu hình sai.
2. **Quy tắc không tự chuyển tuyến của KIE vẫn nguyên vẹn.** Khi model được chọn thuộc KIE thì danh sách chỉ có một phần tử; lọc xong rỗng nên được khôi phục, không có chuyện tự gọi model khác rồi trừ credit ngoài dự kiến.

## Giao diện

Trung tâm vận hành → tab **Sức khỏe nhà cung cấp**. Đọc từ nhật ký đã ghi, không gọi mạng, nên mở bảng không tốn phí và không đụng hạn mức của ai. Tự làm mới mỗi phút vì nhật ký chỉ đổi khi có lời gọi AI mới.

Chọn được cửa sổ 1 giờ, 6 giờ hoặc 24 giờ. Mỗi nhà cung cấp hiện trạng thái, số lượt, tỷ lệ thành công, trung vị thời gian phản hồi và bảng đếm theo loại lỗi.

## Kiểm chứng

```bash
npx vitest run tests/providerHealth.test.ts
```

21 test, gồm: hết tiền liên tiếp **không** làm mất kết nối; một lần thành công cắt chuỗi lỗi; bản ghi ngoài cửa sổ bị bỏ qua; lọc rỗng thì khôi phục danh sách; và phân loại đúng trên chính chuỗi việt hoá mà nhật ký lưu.
