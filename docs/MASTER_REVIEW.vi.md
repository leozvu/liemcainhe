# Master Review và chữ ký nghiệm thu

Sprint 1E nối artifact bền vững từ Master Library vào đúng version khách hàng xem và ký duyệt.

## Lỗi cấu trúc đã đóng

Trước Sprint 1E, cổng duyệt tạo playlist từ các video shot. Bản master FFmpeg vừa render không tham gia vòng duyệt, nên khách có thể duyệt một tập clip khác với file team dùng để phân phối.

Quyết định trước đây chỉ giữ `decisionVersionId`. Nó chưa lưu dấu vân tay của media, nên không đủ bằng chứng rằng quyết định vẫn trỏ tới đúng bytes của artifact.

## Contract

Một `ClientReviewVersion` từ Master Library giữ:

| Trường | Ý nghĩa |
|---|---|
| `sourceKind` | `master`; phân biệt với version shot cũ |
| `masterOutputId` | ID output Auto Editor đã được chọn |
| `artifactChecksum` | SHA-256 do Master Library ghi khi upload |
| `artifactSignature` | `master:<outputId>:<checksum>` |
| `artifactBytes` | Dung lượng artifact |
| `aspectRatio` | Tỷ lệ để portal dựng player đúng khung |

Khi khách xác nhận, server ghi thêm `decision_artifact_signature` cạnh `decision_version_id`. Client phải gửi lại chữ ký đang hiển thị; server từ chối nếu trong thời gian trang mở đã có version hoặc artifact mới.

## Entry point

1. Trong Auto Editor, mỗi master cloud có nút **Gửi sang duyệt**.
2. Nút này lưu `preferredMasterOutputId` và mở thẳng tab Duyệt khách hàng.
3. Team chọn master, mở vòng Director → Editor → Account.
4. `AgencyReviewRound` khóa `masterOutputId`, checksum và source signature.
5. Server chỉ phát hành khi master gửi lên trùng master đã được ba vai trò duyệt.
6. Portal hiển thị fingerprint trong player và hộp xác nhận quyết định.

Không thể đổi master trong lúc vòng đang duyệt. Khi vòng đã nghiệm thu, bị trả sửa hoặc trở nên stale, team mới chọn master khác để mở version mới.

## Tương thích dữ liệu cũ

- Version cũ không có `sourceKind` tiếp tục được đọc như `shots`.
- Vòng cũ không có `masterOutputId` vẫn đọc được, nhưng UI mới chỉ cho mở vòng từ master cloud.
- Quyết định cũ không có chữ ký vẫn hiển thị; mọi quyết định mới dùng contract chữ ký artifact.

## Gate cho phân phối

TikTok, YouTube và Reels chỉ được nhận version có:

- `decision === approved`;
- `decisionVersionId` trỏ đúng version;
- `decisionArtifactSignature === version.artifactSignature`;
- `sourceKind === master` và còn `masterOutputId`.

Nếu chữ ký lệch, campaign bị đưa về trạng thái cần chỉnh sửa thay vì coi là đã nghiệm thu.

Sprint 1F đã hiện thực gate này bằng [Distribution Gateway](DISTRIBUTION_GATEWAY.vi.md). Package được server dựng từ đúng round, portal, version, master và fingerprint; client không thể tự bịa URL để bỏ qua nghiệm thu.
