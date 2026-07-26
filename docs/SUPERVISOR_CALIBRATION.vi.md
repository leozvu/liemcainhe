# Hiệu chỉnh AI Supervisor

Epic 3 trong [AI_INTELLIGENCE_PLAN.vi.md](AI_INTELLIGENCE_PLAN.vi.md).

## Vấn đề

Supervisor đưa ra cảnh báo mà **không ai biết chúng đúng bao nhiêu phần trăm**.

Báo sai nhiều thì người dùng bắt đầu bỏ qua *tất cả* — và lúc đó nó tệ hơn là không có, vì vẫn tốn tiền chạy AI Vision mà không ai đọc kết quả.

## Tín hiệu đã có sẵn

`AISupervisorIssueStatus` đã ghi đúng thứ cần đo:

| Trạng thái | Nghĩa |
|---|---|
| `ignored` | Người duyệt nhìn thấy rồi bỏ qua — **phiếu bầu rằng cảnh báo sai** |
| `queued`, `resolved` | Chấp nhận |
| `open` | Chưa nói lên gì, không ghi nhận |

Chỗ thiếu là nơi **giữ lại** các quyết định đó xuyên dự án: trong dự án chúng biến mất mỗi khi báo cáo dựng lại.

Nay `setSupervisorIssueStatus` ghi mỗi quyết định vào một sổ riêng trong `localStorage`, giới hạn 1.000 bản ghi theo đúng cách `usageService` làm.

## Bốn mức tin

| Mức | Điều kiện |
|---|---|
| `unknown` | Dưới 5 lượt — chưa đủ căn cứ |
| `trusted` | Bị bỏ qua ≤ 15% |
| `mixed` | Ở giữa |
| `noisy` | Bị bỏ qua ≥ **40%** |

Loại `noisy` bị **tự động hạ xuống mức nhắc** trước khi chấm điểm shot. Áp trước khi chấm là có chủ đích: áp sau thì điểm shot vẫn bị kéo xuống bởi cảnh báo đã mất tín.

## Ba ràng buộc an toàn

**Chỉ hạ, không bao giờ nâng.** Nâng mức dựa trên thống kê là cách nhanh nhất để một loại cảnh báo đúng vài lần rồi bắt đầu chặn oan.

**Chưa đủ mẫu thì không đụng tới.** Năm lượt là ngưỡng tối thiểu.

**Nói rõ vì sao hạ.** Cảnh báo bị hạ mức mang thêm ghi chú *"Đã hạ mức: 80% cảnh báo loại này từng bị bỏ qua trên 10 lần."* Im lặng hạ mức sẽ khiến người duyệt mất tin vào chính hệ thống.

## Xem ở đâu

Trung tâm vận hành → **Sức khỏe nhà cung cấp** → phần *Độ tin của AI Supervisor*.

## Kiểm chứng

```bash
npx vitest run tests/supervisorCalibration.test.ts
```

20 test, trong đó có test khẳng định **không** đụng tới loại chưa đủ dữ liệu, **không** đụng tới loại đáng tin, và **không bao giờ nâng mức**.

Đã chạy thật trên trình duyệt với 22 quyết định mô phỏng:

| Loại | Dữ liệu | Kết quả |
|---|---|---|
| Bàn tay | 8/10 bị bỏ qua | **Hay báo sai** — đã hạ xuống mức nhắc |
| Thiếu media | 0/10 bị bỏ qua | **Đáng tin** |
| CTA | 2 lượt | **Chưa đủ dữ liệu** |

Tổng quan hiện: *22 quyết định · 2/3 loại đủ dữ liệu · bỏ qua chung 45%*.

## Vì sao đáng làm sớm

Cơ chế ghi nhận càng bật sớm càng tốt — nó cần **thời gian tích luỹ**, không phải công sức xây. Xây trong một buổi, nhưng phải chạy qua vài chục campaign mới có đủ dữ liệu để kết luận.
