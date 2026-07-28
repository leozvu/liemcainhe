# Độ tin cậy của job sản xuất

Giai đoạn 1 trong roadmap. **Đây là điều kiện tiên quyết của background orchestrator, không phải bản thân orchestrator.**

## Vì sao làm lớp này trước

Thiếu nó thì dựng orchestrator chỉ là chuyển lỗi lên máy chủ: vẫn gửi trùng tác vụ, vẫn mất dấu job bị ngắt, vẫn trừ tiền hai lần. Chỉ khác là giờ lỗi xảy ra ở nơi khó nhìn thấy hơn.

Ba mục trong roadmap được lớp này giải quyết: **khoá chống trùng**, **mã tác vụ nhà cung cấp**, và **trạng thái sau khi tab chết**.

## Execution authority đã đi vào workflow

`executeBillableMedia` không còn là service đứng riêng. Nó đang bao quanh các
đường tạo ảnh, keyframe, video và voice trả phí từ Stage Assets, Stage Director,
Content Illustration, Stage Voice và Director Agent.

Trước khi gọi provider, client tạo idempotency key và giành claim duy nhất trên
D1. Sau khi provider trả 2xx, adapter lập tức ghi trạng thái accepted; provider
có task ID thì ghi ID trước khi polling. Output phải được commit vào project và
IndexedDB trước khi job chuyển sang `completed`.

Mỗi lần chạy còn ghi execution trail riêng: preflight, submitted, provider
accepted, provider task, output committed và trạng thái cuối. Campaign 0 ghép
trail này với job và usage để phát hiện output thiếu giá vốn, usage thiếu job,
failure sau khi provider nhận và job interrupted cần đối chiếu. Click trùng bị
chặn cũng được đếm thành `deduplicated` mà không tạo provider request mới.

Với voice:

- FPT lưu `request_id` làm provider task ID;
- ElevenLabs và Viettel ghi accepted ngay sau HTTP 2xx;
- 5xx, mất mạng hoặc 2xx nhưng body hỏng trở thành `interrupted`;
- lỗi nghiệp vụ được provider xác nhận mới trở thành `failed` để cho phép sửa
  rồi chạy lại;
- batch thoại vẫn chạy từng câu, nên mỗi câu có claim riêng và không làm mất
  toàn bộ dấu vết khi một câu lỗi.
- bản nghe thử cũng có claim và được cache trong project theo câu/preset/định
  dạng; bấm lại cùng cấu hình phát bản đã có thay vì trừ thêm credit.

## Máy trạng thái

```
queued  ──→ running ──→ completed
   │           ├──────→ failed ──────→ queued
   │           ├──────→ interrupted ──→ queued / running / failed
   └───────────┴──────→ cancelled
```

`completed` và `cancelled` là kết thúc, không quay lại được. Chạy lại thì tạo lượt mới.

`applyTransition` **ném lỗi** khi chuyển sai thay vì lặng lẽ bỏ qua. Nuốt lỗi sẽ tạo ra job kẹt ở trạng thái vô lý mà không ai biết vì sao.

## Bài học từ lớp đăng bài, áp sang media

Đây là phần quan trọng nhất.

Job bị ngắt chuyển sang **`interrupted`**, không phải `failed`. Khác biệt không phải chuyện chữ nghĩa:

| Trạng thái | Nghĩa | Chạy lại |
|---|---|---|
| `failed` | Chắc chắn **chưa** xảy ra | An toàn |
| `interrupted` | **Không rõ** đã chạy tới đâu, có thể đã bị tính tiền | Phải kiểm tra trước |

Ghi nhầm job bị ngắt thành thất bại sẽ khiến lần sau chạy lại và **trừ tiền lần hai**. Đây đúng lỗi đã bắt được ở lớp đăng bài khi chạy thử trên trình duyệt, nay phòng trước cho media.

`summarizeJobs` tách riêng số job **mập mờ** — bị ngắt mà không có `providerTaskId`. Đó là những job nguy hiểm nhất: không đối chiếu được với nhà cung cấp nên chỉ còn cách hỏi người dùng.

## Khoá chống trùng

`deriveIdempotencyKey(kind, resourceId, inputSignature)` — cùng loại, cùng tài nguyên, cùng đầu vào thì cùng khoá.

`decideSubmit` quyết định trước khi gửi:

| Job trùng đang ở | Kết quả |
|---|---|
| `queued` hoặc `running` | Không gửi lại — đang chạy rồi |
| `completed` | Không gửi lại — dùng kết quả cũ |
| `failed` hoặc `cancelled` | Cho gửi — chắc chắn không còn gì đang chạy |

## Sửa một lỗi có sẵn

`hydrateDurableJobs` cũ **thoát sớm khi cloud không trả về job nào**. Nhưng job kẹt ở `running` nằm ngay trong dự án cục bộ — tab bị đóng giữa chừng thì không ai kịp đổi trạng thái. Bản cũ vì vậy bỏ sót đúng trường hợp hay gặp nhất: chạy ở máy, đóng tab, mở lại.

Nay chạy đối chiếu cả khi cloud rỗng.

## Còn thiếu gì để thành orchestrator thật

Lớp này là nền, không phải đích. Muốn "đóng tab mà việc vẫn chạy" còn cần:

- Runtime phía máy chủ: Cloudflare Queues hoặc Durable Objects
- Nơi nhận webhook của nhà cung cấp
- Giới hạn số việc chạy song song theo workspace
- Hàng đợi thư chết cho job hỏng liên tiếp
- Thông báo khi xong

Những thứ đó cần deploy và chạy thật mới kiểm chứng được, không dựng trọn vẹn trong một phiên làm việc.

## Kiểm chứng

```bash
npx vitest run tests/jobStateMachine.test.ts tests/mediaExecution.test.ts tests/voiceExecution.test.ts
```

Suite khẳng định job bị ngắt **không** bị ghi thành thất bại, hai click đồng thời
chỉ gọi provider một lần, voice ghi task ID và output được commit trước khi job
được đánh hoàn tất.
