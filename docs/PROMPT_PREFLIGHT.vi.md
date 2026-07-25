# Thẩm định prompt trước khi tiêu tiền

Epic 1 trong [AI_INTELLIGENCE_PLAN.vi.md](AI_INTELLIGENCE_PLAN.vi.md).

## Vấn đề

AI Supervisor kiểm **sau khi** đã sinh xong — tiền đã mất rồi mới biết hỏng. Lớp này chạy **trước**, đoán những lỗi chắc chắn dẫn tới phải sinh lại.

Tỷ lệ chi phí là lý do nó đáng tồn tại: một lần chấm bằng model chat rẻ hơn một lần sinh video khoảng năm mươi lần. Chặn được một lượt sinh hỏng là đã có lãi nhiều lần.

## Hai tầng

| Tầng | Chi phí | Chạy khi nào |
|---|---|---|
| **Luật cục bộ** | 0 | Luôn luôn, trước tiên |
| **Model chấm** | Rẻ | Chỉ khi luật cục bộ không chặn |

Luật cục bộ chạy trước nên các ca rõ ràng không tốn một lời gọi nào.

### Sáu luật cục bộ

| Mã | Mức | Bắt gì |
|---|---|---|
| `empty` | chặn | Prompt rỗng |
| `too-vague` | chặn | Dưới 6 từ — model sẽ tự bịa chủ thể |
| `text-in-image` | cảnh báo | Đòi chữ trong ảnh |
| `contradiction` | cảnh báo | Hai yêu cầu không thể cùng đúng |
| `brand-forbidden` | chặn | Chứa từ cấm của khách |
| `missing-reference` | chặn | Model bắt buộc ảnh tham chiếu mà không có |

## Ranh giới quyền hạn

**Model không được tự chặn.** Mọi lỗi nó nêu đều hạ xuống mức cảnh báo. Chặn là quyền của luật cục bộ vì luật xác định và kiểm chứng được, còn model thì hay quá tay.

Model chấm hỏng, hết credit, hay trả JSON hỏng đều **không** chặn việc sinh. Đây là lớp hỗ trợ, không phải cổng bắt buộc.

## Hai nơi cắm

### Cổng tự động, trong lõi

Đặt ngay đầu `generateImage` và `generateVideo` trong `geminiService.ts`, nên phủ **mọi** nơi gọi cùng lúc: Xưởng dựng, Video Factory, Đạo diễn AI, và cả bước sửa lỗi của Supervisor — không phải sửa một dòng nào ở các chỗ đó.

Chỉ chạy luật cục bộ nên **không tốn phí và không thêm độ trễ**.

Chỉ chặn hai mã chắc chắn sai: `empty` và `brand-forbidden`.

Cố ý **không** chặn `too-vague` — đó là suy đoán theo số từ, và luồng sẵn có của dự án có thể đang dùng prompt ngắn hợp lệ. Chặn nhầm một lượt sinh đúng gây bực hơn là để lọt một lượt hỏng. Cũng không chặn `missing-reference` vì `selectImageModelForGeneration` đã tự chuyển sang model sinh từ văn bản.

Brand Kit đi vào qua biến context toàn cục `setPreflightBrandKit`, theo đúng mẫu `setUsageProjectContext` sẵn có — nhờ vậy không phải đổi chữ ký hai hàm vốn được gọi từ rất nhiều nơi.

### Cổng đầy đủ, ở giao diện

Khối Ảnh minh hoạ chạy cả hai tầng trước khi vẽ. Cảnh báo thì có nút *"Vẫn vẽ"*; chặn thì không có nút vượt. Có bản prompt đã sửa thì hiện nút *"Dùng bản sửa"*.

## Một lớp lỗi im lặng đã sửa

Test bắt được, và nó nghiêm trọng hơn một bug thường:

```js
/\bchữ\b/i             // KHÔNG BAO GIỜ khớp
/\bđêm khuya\b/i       // KHÔNG BAO GIỜ khớp
/\bđen trắng\b/i       // KHÔNG BAO GIỜ khớp
/\bmàu sắc rực rỡ\b/i  // KHÔNG BAO GIỜ khớp
```

`\b` trong JavaScript chỉ hiểu `[A-Za-z0-9_]`. `đ` và `ỡ` không thuộc nhóm đó, nên mọi cụm tiếng Việt bắt đầu bằng `đ` hoặc kết thúc bằng nguyên âm có dấu đều hỏng lặng lẽ — luật vẫn chạy, không báo lỗi, chỉ là không bao giờ bắt được gì.

Thay bằng hàm `anyOf` dựng ranh giới nhận biết Unicode qua `(?<!\p{L})…(?!\p{L})`.

**Đáng rà lại toàn bộ codebase**: chỗ nào khác dùng `\b` với tiếng Việt cũng đang hỏng như vậy.

## Kiểm chứng

```bash
npx vitest run tests/promptPreflight.test.ts
```

36 test. Phần lớn dành cho việc **không chặn oan**, vì cổng tự động nằm trong đường sinh lõi.

Đã chạy thật trên trình duyệt: prompt đòi chữ trong ảnh hiện cảnh báo và **model ảnh không được gọi**; prompt hai từ bị chặn kèm số tiền tránh được và không có nút vượt.
