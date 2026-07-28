# AI Supervisor · Quality & Release Gate

## Mục tiêu

Supervisor không còn chỉ ghi cảnh báo. Luồng vận hành hiện tại có entry point đầy đủ:

```
Quét local miễn phí
  → quét Vision có dự toán (tuỳ chọn hoặc bắt buộc)
  → xếp đúng shot lỗi và khóa ngân sách
  → producer xác nhận
  → tạo lại đúng khung đầu/cuối bị lỗi
  → dựng lại video của shot đó
  → quét local lại
  → Release Gate quyết định chuyển duyệt
```

Không bước nào chạy lại toàn campaign hoặc toàn variant.

## Hai tầng kiểm định

### Local audit — miễn phí

Chạy rule engine trong trình duyệt, không gửi media ra ngoài. Nó kiểm tra media thiếu/lỗi thời, thoại dài hơn shot, nguồn nhân vật/bối cảnh, Brand Kit, CTA và cấu hình safe zone.

Lỗi thoại dài được gắn `repairTarget: script`: tạo lại voice không thể chữa một câu thoại vốn dài hơn video, nên Supervisor không được phép đốt API cho lỗi này.

### AI Vision — có chi phí và ngưỡng tin cậy

Vision nhận ảnh của shot, continuity liền kề và đúng `ShotReferencePack` đã khóa. Asset Brand Kit không được khóa sẽ không âm thầm đi vào prompt kiểm định.

- `minimumVisionConfidence`: bỏ false positive dưới ngưỡng.
- `criticalVisionConfidence`: chỉ cho lỗi Vision chặn release khi đủ chắc.
- Vision trả `frames: start/end`, nhờ đó kế hoạch sửa biết chính xác keyframe cần tạo lại.
- Chữ ký Vision dùng `getShotFullSignature`; đổi media, nhân vật, bối cảnh hay Reference Pack đều làm kết quả cũ mất hiệu lực.

## Selective repair

`queueSupervisorRepair` chỉ tạo checkpoint, production job và khóa phần ngân sách dự toán. Chưa gọi API.

`executeSupervisorRepair` là entry point thực thi thật:

- tạo lại đúng frame được chỉ định;
- tự dựng lại video nếu keyframe thay đổi;
- có thể tạo lại voice với lỗi voice thật sự;
- giữ lỗi `script` và `none` cho producer xử lý thủ công;
- cập nhật tiến độ production job;
- khi hủy trước lúc chạy, mở lại issue và hoàn ngân sách đã cam kết;
- khi hoàn tất, quét local lại trước khi mở gate.

Mặc định `requireHumanApproval = true`. Có thể tắt ở Budget Guard cho workflow nội bộ đã được team tin cậy; giới hạn ngân sách vẫn luôn có hiệu lực.

## Release Gate

Gate không tin trạng thái cache. Mỗi lần render UI, nó đối chiếu báo cáo với chữ ký media + upstream hiện tại.

| Trạng thái | Điều kiện |
|---|---|
| Chưa thể xuất bản | Chưa quét/báo cáo cũ, còn lỗi critical, còn repair đang chờ, hoặc thiếu Vision khi policy bắt buộc |
| Cần producer duyệt | Không có blocker nhưng còn warning |
| Sẵn sàng xuất bản | Báo cáo hiện hành và không còn lỗi mở |

Vision là tùy chọn mặc định để giữ chi phí thấp. Campaign cao cấp có thể bật “Bắt buộc Vision trước khi release”.

## Entry points

| Hành động người dùng | Hàm runtime |
|---|---|
| Quét miễn phí | `runLocalSupervisorAudit` |
| Quét một shot bằng Vision | `runSupervisorVisionAudit` |
| Xếp shot lỗi | `queueSupervisorRepair` |
| Chạy sửa | `executeSupervisorRepair` |
| Hủy sửa | `cancelSupervisorRepair` |
| Hiển thị cổng release | `getAISupervisorGate` |

UI nằm tại `components/AISupervisor.tsx`, được mở từ Production Center.

## Kiểm thử không tốn API

Suite dùng executor giả lập để đi trọn entry point “xếp → chạy → hoàn tất job”. Nó còn phủ:

- giữ hoặc hủy kết quả Vision đúng theo chữ ký;
- chỉ dùng asset Reference Pack đã khóa;
- kế hoạch sửa đúng frame;
- không xếp API cho lỗi cần sửa script;
- hủy và hoàn ngân sách;
- gate tùy chọn/bắt buộc Vision;
- chuẩn hóa hai ngưỡng confidence.
