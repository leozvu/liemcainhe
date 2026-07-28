# Trí tuệ dựng phim

Epic 6 trong [AI_INTELLIGENCE_PLAN.vi.md](AI_INTELLIGENCE_PLAN.vi.md).

## Vấn đề

Auto Editor trước đây ghép chứ không dựng:

- Độ dài mỗi clip bằng đúng `shot.interval.duration` — thứ do model sinh video quyết định, không liên quan gì tới lời thoại trong shot đó.
- `settings.transition` là **một** giá trị cho toàn bộ timeline. Đổi bối cảnh hay không đổi cũng cùng một kiểu chuyển cảnh.
- Không ai kiểm tra clip có đủ dài để đọc hết câu thoại hay không. Lỗi này chỉ lộ ra sau khi render.

## Không gọi AI ở đây

`editingIntelligenceService.ts` là **logic thuần, không có lời gọi model nào**.

Nhịp cắt và sync nhạc là việc xác định: biết độ dài câu thoại, cỡ cảnh, chuyển động máy và BPM thì tính ra được. Gọi model chỉ tốn tiền để nhận về một đề xuất kém ổn định hơn quy tắc dựng đã có từ trăm năm nay — và không lặp lại được giữa hai lần chạy.

## Quy tắc đã mã hoá

| Quy tắc | Hằng số | Vì sao |
|---|---|---|
| Thoại quyết định sàn độ dài | `VIETNAMESE_CHARS_PER_SECOND = 12` | Cắt trước khi nói hết câu là lỗi nặng nhất trong dựng |
| Chừa khoảng thở hai đầu | `BREATHING_ROOM_SECONDS = 0.6` | Vào và ra câu thoại không được sát mép |
| Cảnh toàn giữ lâu hơn cảnh cận | 3.5s / 2.6s / 2.0s | Mắt phải quét hết khung mới hiểu cảnh toàn |
| Máy đang chuyển động thì để nó hoàn thành | +0.5s (có thoại) / +0.8s | Cắt giữa cú lia làm khán giả hụt hẫng |
| Không clip nào ngắn hơn ngưỡng đọc | `MIN_CLIP_SECONDS = 1.2` | Ngắn hơn thì mắt không kịp nhận khung hình |
| Mờ chồng chỉ khi đổi bối cảnh | — | Cắt thẳng vô hình và giữ nhịp; mờ chồng là tín hiệu đổi không gian |
| Chỉ dịch điểm cắt dưới nửa phách | `snapToBeats` | Dịch xa hơn là phá nhịp kể chuyện để chiều nhạc nền — đánh đổi sai |
| Clip trên 6s với khung tĩnh thì nên chèn cảnh phụ | `BROLL_THRESHOLD_SECONDS = 6` | Một khung giữ quá lâu làm khán giả rời mắt |

Ngưỡng 12 ký tự/giây lấy thấp hơn tốc độ nói thật (khoảng 140–160 từ/phút) để chừa biên: thà giữ khung hơi lâu còn hơn cắt mất cuối câu.

## Vì sao nhịp lưu riêng, không sửa thẳng timeline

`state.timeline` được **dựng lại từ đầu** mỗi lần `createAutoEditorPlan` chạy. Sửa thẳng vào đó thì lần lập kế hoạch sau xoá sạch.

Nên nhịp đã áp lưu ở `state.pacing` — danh sách `{ shotId, duration, transition }` — và `buildTimeline` đọc nó khi dựng. Kết quả: áp nhịp một lần rồi đổi caption, đổi logo, đổi tỷ lệ bao nhiêu lần cũng không mất.

Đi kèm là một sửa lỗi có sẵn từ trước: `editorSignature` **không** tính `transition` vào chữ ký, nên đổi chuyển cảnh mà kế hoạch vẫn không bị đánh dấu là cũ. Nay đã tính.

## Cắt theo nhạc

Chỉ chạy khi **vừa bật nhạc nền vừa có `musicBpm`**. Không đoán BPM từ tệp âm thanh — đoán sai thì toàn bộ timeline lệch, và người dùng không có cách nào biết vì sao.

`snapToBeats` dịch điểm cắt về phách gần nhất, nhưng bỏ qua nếu phải dịch từ nửa phách trở lên, và không bao giờ dịch xuống dưới `MIN_CLIP_SECONDS`.

## Chọn take giọng

`pickBestTake` loại take dài hơn khung hình (kèm lý do, ghi rõ dài bao nhiêu giây), rồi ưu tiên bản thu người thật, rồi trong số vừa lấy bản dài nhất — nói chậm rãi nghe tự nhiên hơn nói vội.

Không take nào vừa thì vẫn chọn bản gần nhất và **khuyên kéo dài shot** thay vì tự cắt cụt câu thoại.

## Đổi tỷ lệ khung

`suggestReframe` xác định đúng trục bị crop theo tỷ lệ nguồn và tỷ lệ đích:

- Ngang sang dọc/vuông mất hai bên: cho chọn Trái, Giữa hoặc Phải. Shot nhiều nhân vật có cảnh báo nên dựng riêng.
- Dọc sang ngang mất trên/dưới: cho chọn Trên hoặc Giữa; mặc định giữ phần trên để bảo vệ mặt và đường chân trời.
- Cùng tỷ lệ không hiện lựa chọn vô nghĩa.

`AutoEditorState.reframeOverrides` chỉ lưu quyết định editor đã sửa theo khoá `shotId + aspectRatio`; đề xuất mặc định vẫn được tính lại từ shot. Thay đổi crop làm `planSignature` cũ ngay lập tức, buộc lập lại timeline trước khi render.

`autoEditorRenderService` đọc kế hoạch hiệu lực và tạo biểu thức `crop=w:h:x:y` riêng cho từng clip sau bước scale-cover. Vì vậy lựa chọn trong giao diện đi thẳng vào FFmpeg, không phải mock UI.

## Giao diện

Bảng “Trí tuệ dựng phim” trong Auto Editor (cột phải, dưới Preflight):

- Một dòng tóm tắt số điểm đáng sửa.
- Cảnh báo đỏ nếu có clip cắt mất thoại, kèm số giây thiếu nhiều nhất.
- Tối đa 5 clip lệch nhịp, mỗi cái ghi `hiện tại → đề xuất` và lý do.
- Tối đa 3 chỗ nên chèn cảnh phụ.
- Nút **Áp nhịp đề xuất** và **Trả về độ dài gốc** (chỉ hiện khi đã áp).

Ô nhập BPM nằm trong thẻ Nhạc nền.

Workbench **Smart Reframe** nằm trong cột chính, trước Timeline:

- Chuyển giữa từng tỷ lệ đầu ra.
- Xem preview theo vùng crop hiệu lực.
- Chỉnh vùng giữ khung theo từng shot hoặc trả lại đề xuất.
- Cảnh báo shot nhiều nhân vật ngay tại shot và trong Preflight.
- Tối đa 6 shot được mở mặc định; danh sách dài dùng nút mở rộng để giao diện không quá tải.

Đường **Render MP4** là entry point tạo master gửi khách nên bắt buộc qua `assertAISupervisorCanRelease`, giống khu vực Xuất bản. Auto Editor hiển thị trạng thái gate và lý do khóa trước khi người dùng bấm.

Sau render, artifact được bàn giao cho [Master Library](MASTER_LIBRARY.vi.md). Bản Sites vừa tải MP4 về máy vừa lưu đúng artifact đó lên R2 bằng checksum SHA-256; giao diện không coi một lần tải về là bản master cloud.

## Kiểm chứng

```bash
npx vitest run tests/editingIntelligence.test.ts tests/autoEditor.test.ts
```

Các test đáng chú ý:

- Nhịp đã áp **sống sót qua lần lập kế hoạch sau** và kế hoạch không bị đánh dấu là cũ — đây là thứ dễ hỏng nhất trong toàn bộ epic.
- `snapToBeats` **từ chối** dịch khi phải dịch đúng nửa phách (60 bpm, clip 2.5s).
- Sau khi áp nhịp, không còn clip nào cắt mất thoại.
- Take dài hơn khung bị loại **kèm số giây thừa**, không chỉ bị bỏ im lặng.
- Override Smart Reframe chỉ ảnh hưởng đúng cặp shot+tỷ lệ và sống qua lần lập kế hoạch sau.
- Bốn vùng giữ khung sinh đúng biểu thức crop FFmpeg.
- Render master bị khóa khi AI Supervisor chưa quét và mở sau lượt quét sạch.

## Chưa làm

- Không phân tích nội dung khung hình để chọn điểm cắt — muốn vậy phải đọc từng frame, đắt và chậm.
- Không tự tìm cảnh phụ để chèn; mới chỉ chỉ ra **chỗ nên chèn**.
- Không đoán BPM từ tệp nhạc.
- Chưa theo dõi khuôn mặt/chủ thể theo từng frame; Smart Reframe hiện dùng metadata shot và quyết định của editor, không gọi Vision nên chi phí API vẫn bằng 0.
