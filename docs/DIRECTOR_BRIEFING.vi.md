# Đạo diễn AI biết ràng buộc

Epic 5 trong [AI_INTELLIGENCE_PLAN.vi.md](AI_INTELLIGENCE_PLAN.vi.md).

## Vấn đề

`CreativeDirectorToolName` có đúng sáu giá trị, và **cả sáu đều là công cụ sinh**:

```
generate-character-image · generate-scene-image
generate-start-keyframe  · generate-end-keyframe
generate-video           · generate-voice
```

Đạo diễn lập kế hoạch rồi bấm nút. Nó **không biết** khách này từng duyệt kiểu bài nào, nhà cung cấp nào đang chết, cảnh báo nào đáng tin, nhân vật nào chưa đủ ảnh, hay còn bao nhiêu tiền.

## Ý chính

Epic 5 không thêm model, không thêm lời gọi AI. Nó **gộp kết quả của bốn epic trước** thành một khối ngữ cảnh Đạo diễn đọc trước khi lập kế hoạch.

| Nguồn | Từ epic | Cho biết |
|---|---|---|
| Trí nhớ khách hàng | 2 | Khách đã duyệt kiểu gì, từng bắt sửa gì |
| Sức khỏe nhà cung cấp | — | Nhà nào đang chết, đừng lên lịch qua đó |
| Hiệu chỉnh Supervisor | 3 | Cảnh báo nào đã mất tín |
| Độ sẵn sàng nhân vật | 4 | Ai chưa đủ ảnh để giữ nhất quán |
| Ngân sách đã tiêu | — | Còn bao nhiêu tiền thật |

Trí tuệ không nằm ở việc gọi thêm model. Nó nằm ở việc **đưa cho model những gì hệ thống đã biết**.

## Lỗ hổng ngân sách đã bịt

`startCreativeDirectorMission` đã có kiểm ngân sách:

```ts
if (remainingCostUsd > director.budgetLimitUsd) throw ...
```

Nhưng `budgetLimitUsd` là trần cho **một** nhiệm vụ. Chạy năm mươi nhiệm vụ mỗi cái dưới trần vẫn đốt sạch ngân sách mà không có gì cản.

Nay thêm `projectBudgetUsd` — trần **cộng dồn**, đối chiếu với tiền đã tiêu thật trong nhật ký usage. Cùng nguồn với bảng chi phí, nên hai nơi không bao giờ nói hai con số khác nhau.

Ba trạng thái: `ok`, `warning` khi vượt 80%, `exceeded` khi chạm trần. Đã vượt thì chặn mọi kế hoạch, kể cả kế hoạch rẻ.

**Chưa đặt trần thì không cản gì.** Không áp luật khi người dùng chưa chọn luật.

## Chọn model rẻ nhất còn chạy được

`recommendCheapestModel` xếp theo rate card nhưng **bỏ qua model thuộc nhà cung cấp đang mất kết nối**. Chọn model rẻ nhất mà nhà cung cấp đang chết thì không tiết kiệm được gì — chỉ đổi tiền lấy thời gian chờ rồi vẫn phải chạy lại.

Model bị bỏ qua vẫn được liệt kê kèm lý do, để người dùng cân nhắc chứ không bị quyết thay.

## Thứ tự trong prompt

Cảnh báo đứng **đầu**, trước cả ngân sách. Đó là thứ phải đọc trước khi nghĩ ra bất cứ gì; nằm cuối thì bị chìm giữa các mục dài hơn.

## Ranh giới tự động vẫn nguyên

Không đổi gì so với đã chốt: không vượt ngân sách, không chạy model final khi chưa duyệt, không gửi link khách khi Account chưa duyệt, không tự xoá dữ liệu, không tự đổi Brand Kit.

## Kiểm chứng

```bash
npx vitest run tests/directorBriefing.test.ts
```

15 test, gồm: chặn khi kế hoạch tốn hơn phần còn lại và **nói rõ thiếu bao nhiêu**; đã vượt trần thì chặn cả kế hoạch rẻ; chưa đặt trần thì không cản; và bản giao ban nêu đủ bốn loại cảnh báo khi cả bốn cùng có vấn đề.
