# Distribution Gateway

Sprint 1F biến kết quả nghiệm thu thành một package bất biến mà adapter nền tảng có thể tin cậy.

## Vấn đề được đóng

Trước Sprint 1F, team có thể mở URL master rồi tự upload, nhưng app chưa có một ranh giới kỹ thuật ngăn code tương lai gửi nhầm file chưa duyệt lên TikTok, YouTube hoặc Reels.

Gateway không nhận URL video tuỳ ý. Nó chỉ tạo package từ chuỗi bằng chứng đã được server kiểm lại:

1. Director, Editor và Account đã duyệt cùng một `AgencyReviewRound`.
2. Vòng duyệt khóa `masterOutputId`, checksum và source signature.
3. Khách hàng phê duyệt đúng `ClientReviewVersion` của vòng đó.
4. `decisionArtifactSignature`, `version.artifactSignature` và fingerprint master trùng tuyệt đối.
5. Master vẫn nằm trên R2, còn trạng thái `ready`, và checksum chưa đổi.
6. Version không còn góp ý mở.

Client không thể tự bịa package: `/api/distribution-packages` dựng manifest từ project và portal đang lưu trong D1/R2.

## Contract package

`DistributionPackage` giữ:

| Trường | Ý nghĩa |
|---|---|
| `reviewRoundId` | Vòng duyệt nội bộ đã ký |
| `reviewPortalId` | Cổng duyệt khách hàng |
| `reviewVersionId` | Version khách đã xem |
| `masterOutputId` | Master Library output duy nhất |
| `masterChecksum` | SHA-256 của file trên cloud |
| `artifactSignature` | `master:<outputId>:<checksum>` |
| `approvalFingerprint` | Fingerprint quyết định khách hàng; phải bằng artifact signature |
| `targets` | Adapter được phép nhận package |
| `idempotencyKey` | Chống tạo trùng cùng artifact, metadata và tập nền tảng |

Package được lưu trong bảng `egoric_distribution_packages`. Account export và xóa dữ liệu tài khoản đã bao gồm ledger này.

## Tương thích nền tảng hiện tại

| Adapter | Tỷ lệ được phép đóng gói |
|---|---|
| TikTok | `9:16` |
| YouTube / Shorts | `16:9`, `9:16`, `1:1` |
| Instagram Reels | `9:16` |
| Facebook Reels | `9:16` |

Nếu một master không đúng tỷ lệ, UI khóa adapter thay vì ngầm crop hoặc upload sai định dạng. Team phải quay lại Auto Editor, render đúng tỷ lệ và cho duyệt version đó.

## Entry point

- Sau khi khách duyệt đúng master, tab **Duyệt khách hàng** hiện nút **Mở cổng phân phối**.
- Tab **Phân phối** trong Trung tâm sản xuất hiển thị gate, artifact, fingerprint, adapter tương thích và release ledger.
- Team có thể tải manifest JSON để bàn giao/upload thủ công trong lúc chờ OAuth nền tảng.

## Lớp upload kế tiếp

Sprint 1G đã thêm [Publishing Queue và OAuth nền tảng](DISTRIBUTION_PUBLISHING.vi.md): YouTube dùng resumable upload, TikTok dùng creator inbox, token nằm ở server và job `indeterminate` bắt buộc đối soát trước khi tiếp tục.

## Chưa tuyên bố hoàn tất

Meta Reels vẫn chờ App Review và Page/Instagram permissions. YouTube/TikTok chỉ hiện nút kết nối khi Sites runtime có OAuth credential thật; không có credential mẫu hoặc token phía client. Adapter bắt buộc nhận `DistributionPackage`; không được nhận trực tiếp `ProjectState` hoặc URL tự do.

Chi phí AI của Distribution Gateway: **0 USD**. Phần phát sinh chỉ là D1 metadata và băng thông R2 khi con người hoặc adapter đọc master.
