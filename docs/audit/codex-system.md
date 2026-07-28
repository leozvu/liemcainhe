# Evidence Audit: nền tảng hệ thống

Phạm vi Codex theo plan vòng 2: luồng dữ liệu, độ bền job, provider/chi phí,
persistence, khả năng tìm thấy tính năng, xuất bản, review và release. Tài liệu
này **không coi số dòng code là bằng chứng sản phẩm đã hoạt động**.

Tài liệu được khởi tạo ở Sprint 0A và cập nhật sau mỗi sprint hệ thống. Một cấp
chỉ được nâng khi runtime, entry point và bằng chứng test tương ứng đã có.

## Thang bằng chứng

| Cấp | Nghĩa |
|---|---|
| 1 | Có code |
| 2 | Có test |
| 3 | Được nối vào workflow |
| 4 | Người dùng tìm thấy và dùng được |
| 5 | Đã chạy bằng dữ liệu/API thật và quan sát được kết quả |

## Kết luận điều hành

App có nhiều khung hệ thống đúng hướng, nhưng phần **bảo vệ tiền và dữ liệu**
đang thấp hơn phần giao diện sản xuất.

| Năng lực | Cấp | Quyết định |
|---|---:|---|
| Golden Workflow và entry point | 3–4 | Giữ, kiểm bằng Campaign 0 |
| Lưu project cục bộ | 4 | Giữ |
| Sao lưu project + media lên D1/R2 | 4 | Giữ, vẫn là thao tác tay |
| Đồng bộ dữ liệu workspace | **4** | Đã nối autosync + recovery; cần test thực địa hai thiết bị để lên cấp 5 |
| Job history và trạng thái gián đoạn | **4** | Contract đã đồng nhất; cần test đóng tab với provider thật để lên cấp 5 |
| Chống gửi trùng job billable | **4** | Ảnh, video và voice đã có execution authority; còn đo dedupe thực tế |
| Model routing và circuit breaker | 3 | Phủ hết đường gọi trực tiếp |
| Usage/cost telemetry | 3 | Phủ hết billable path, đo chi phí thật |
| Review nội bộ + link khách hàng | 4 | Chạy khô rồi chạy thật |
| Render/export master | 4 | Giữ local fallback, thêm bàn giao cloud |
| Đăng video lên nền tảng | 1 | Track riêng, phụ thuộc OAuth/review |
| Release Sites | 4 | Giữ một release owner |
| CI | **4** | GitHub Actions chặn PR/main khi whitespace, typecheck, test hoặc build hỏng |

Không năng lực nào đạt cấp 5. Các endpoint cloud đã được deploy, nhưng chưa có
bằng chứng một campaign thật chạy xuyên suốt và đối chiếu được số tiền thực.

---

## 1. Golden Workflow và khả năng tìm thấy — cấp 3–4

| Trường | Bằng chứng |
|---|---|
| Entry point | Dashboard → Campaign Hub hoặc Dự án; project có Sidebar và Trung tâm sản xuất |
| Existing code | `App.tsx`, `Dashboard.tsx`, `CampaignHub.tsx`, `Sidebar.tsx`, `ProductionCenter.tsx`, `OperationsHub.tsx` |
| Integration | Campaign mở được project theo Content/Production/Review; project giữ stage |
| Persistence | Project trong IndexedDB; campaign/client trong các store workspace |
| Real test | Chưa có campaign thật đầu-cuối |
| Measurement | Không có event funnel theo stage; chỉ có usage và system event rời rạc |
| Blocking gap | Không biết người dùng rơi ở bước nào; nhiều năng lực chỉ tìm thấy qua modal/tab sâu |
| Decision | Giữ cấu trúc hiện tại, Campaign 0 ghi từng entry point và thao tác tay |

Ba lần tính năng bị chôn cho thấy “component đã render ở đâu đó” chưa đủ. Từ PR
tiếp theo, **Entry point** và **cách người dùng kiểm chứng** là hai trường bắt
buộc. PR không có entry point chỉ được merge khi chủ đích là service nền và có
consumer được nêu rõ trong cùng milestone.

---

## 2. Lưu project cục bộ — cấp 4

| Trường | Bằng chứng |
|---|---|
| Entry point | Tự động khi project thay đổi; danh sách dự án ở Dashboard |
| Existing code | `storageService.ts`, autosave trong `App.tsx` |
| Integration | `saveProjectToDB` và `loadProjectFromDB` đang phục vụ luồng chính |
| Persistence | IndexedDB `EgoricStudioDB` |
| Real test | Đã dùng trên bản live, nhưng chưa có Campaign 0 được ghi nhận |
| Measurement | Không có tỷ lệ autosave lỗi hay kích thước project |
| Blocking gap | Dữ liệu vẫn phụ thuộc thiết bị cho tới khi người dùng chủ động sync cloud |
| Decision | Giữ làm local-first, bổ sung quan sát lỗi ở Sprint 0B |

Liên kết campaign → project có thể lệch vì campaign được đồng bộ riêng trong
khi project chỉ nằm ở thiết bị khác. Bản vá hiện tại tự tái tạo project từ brief
và Brand Kit, nhưng đây là phục hồi an toàn chứ không thay cho đồng bộ project.

---

## 3. Sao lưu project và media — cấp 4

| Trường | Bằng chứng |
|---|---|
| Entry point | Trung tâm sản xuất → sao lưu cloud; tự chạy khi phát hành link review |
| Existing code | `cloudSyncService.ts`, `/api/cloud/projects`, R2 media routes |
| Integration | Project được clone, media upload theo lô ba, sau đó payload lưu D1 |
| Persistence | D1 cho project metadata; R2 cho media |
| Real test | Endpoint đã deploy, chưa có biên bản chạy thật đầu-cuối |
| Measurement | Có usage loại `cloud`, nhưng chỉ ghi thành công; thiếu failed/bytes thật |
| Blocking gap | Autosave local không tự đẩy project lên cloud; lần sync review gọi nhiều lượt |
| Decision | Giữ manual sync cho Campaign 0, đo thời gian và lỗi trước khi tự động hóa |

Review Portal bắt buộc gọi `syncProjectToCloud` trước khi tạo link. Đây là đường
bàn giao tốt nhất hiện có và phải được chạy khô trước khi tiêu credit.

---

## 4. Đồng bộ dữ liệu workspace — cấp 4, đã có entry point

| Trường | Bằng chứng |
|---|---|
| Entry point | Trạng thái ở Dashboard/sidebar mở Trung tâm đồng bộ; Campaign 0 dùng chung coordinator |
| Existing code | `workspaceSyncService.ts`, `workspaceSyncCoordinatorService.ts`, `workspaceFieldTestService.ts`, `WorkspaceSyncCenter.tsx`, IndexedDB adapters, `/api/cloud/workspace`, `/api/cloud/workspace/health`, `/api/cloud/workspace/field-tests/*` |
| Integration | App root chạy `syncAllCollections` khi mở, online/focus, sau local write và theo heartbeat; Trung tâm đồng bộ tạo protocol A/B; Campaign 0 chỉ mở cổng thứ 14 khi nạp bằng chứng D1 còn hạn |
| Persistence | D1 migration và worker route đã có |
| Real test | Endpoint và Campaign 0 đã chạy production; test hai thiết bị với sửa/xóa thật còn chờ Golden Run |
| Measurement | UI hiển thị trạng thái, local/cloud count, pending, tombstone, kết quả từng collection và 12 phiên gần nhất; protocol ghi A/B/verifiedAt; báo cáo không chứa API key |
| Blocking gap | Protocol có thể ghi bằng chứng D1 nhưng chưa được chạy trên hai máy vật lý; checklist tạo/sửa/xóa thật và compaction bia mộ còn thiếu |
| Decision | Giữ local-first + autosync ở cấp 4; chỉ nâng cấp 5 sau khi protocol và checklist hội tụ chạy thật trên A/B |

Mục này từng là ví dụ điển hình của tính năng có code nhưng không có caller.
Coordinator, health endpoint và Trung tâm đồng bộ nay tạo được bằng chứng cloud
có máy A, máy B và người chốt. Đây là công cụ kiểm chứng, chưa phải bằng chứng
thực địa: cấp năng lực vẫn giữ ở 4 cho tới khi team chạy protocol và thao tác
tạo/sửa/xóa trên hai thiết bị vật lý.

---

## 5. Job history và hàng đợi bền — cấp 4

| Trường | Bằng chứng |
|---|---|
| Entry point | Trung tâm sản xuất → tab Tác vụ; tự hydrate khi mở project |
| Existing code | `workflowService.ts`, `durableJobService.ts`, `jobStateMachine.ts`, `mediaExecutionService.ts`, `/api/jobs` |
| Integration | App hydrate khi mở project; ảnh/video/voice claim D1 trước provider và cập nhật job theo lifecycle |
| Persistence | Project local + `egoric_jobs` trên D1, gồm `idempotencyKey` và `providerTaskId` |
| Real test | Chưa chạy job provider thật qua lần đóng tab |
| Measurement | Trạng thái/progress/error/attempts có sẵn |
| Blocking gap | Chưa có server runtime/webhook để tiếp tục polling khi đóng tab; chưa chạy provider thật qua lần đóng/mở tab |
| Decision | Contract đã đóng; giữ cấp 4 cho tới field test provider thật |

Hai lỗi contract từ audit ban đầu đã được đóng:

1. Worker và client dùng cùng danh sách kind, có contract test chống lệch.
2. Migration, SELECT, UPSERT và unique claim D1 đều giữ idempotency key/task ID.

---

## 6. Chống gửi trùng job billable — cấp 4, đã có entry point

| Trường | Bằng chứng |
|---|---|
| Entry point | Trung tâm sản xuất → Tác vụ; các nút tạo ảnh/video/voice và Director Agent dùng chung envelope |
| Existing code | `mediaExecutionService.ts`, `deriveIdempotencyKey`, `claimDurableJob`, provider hooks trong image/video/voice adapter |
| Integration | Claim trước provider; double-click dùng chung Promise; output commit trước completed; voice batch claim từng câu |
| Persistence | Project/IndexedDB + D1 unique claim, idempotency key và provider task ID |
| Real test | Chưa |
| Measurement | Tab Tác vụ hiện trạng thái, task ID, lỗi và job interrupted; chưa tổng hợp số lượt dedupe |
| Blocking gap | Chưa đối chiếu một interrupted job bằng dashboard provider thật; chưa có counter dedupe theo campaign |
| Decision | Giữ cấp 4; Campaign 0 chạy một lỗi mô phỏng và một provider task thật trước khi nâng cấp 5 |

Job UI vẫn là nơi quan sát, nhưng execution authority nay nằm đúng trước lời gọi
provider. Ảnh, video và voice đều không được gửi nếu claim D1 bị trùng. Voice là
đường cuối cùng được nối trong Sprint 0I.

---

## 7. Model routing và circuit breaker — cấp 3

| Trường | Bằng chứng |
|---|---|
| Entry point | Trung tâm vận hành → API & định tuyến; Sức khỏe nhà cung cấp |
| Existing code | `modelRegistry.ts`, `modelRoutingService.ts`, ba adapter chat/image/video |
| Integration | Chat đi qua adapter; KIE/Replicate media đi qua adapter |
| Persistence | Policy và credential trên thiết bị |
| Real test | Chưa benchmark bằng key thật |
| Measurement | Adapter ghi provider/model/status/duration |
| Blocking gap | Đường image/video tương thích trực tiếp trong `geminiService` bỏ qua router |
| Decision | Giữ, đưa mọi billable path qua cùng execution envelope |

Retry hiện tồn tại ở hai tầng: `retryOperation` trong `geminiService` và fallback
trong adapter. Campaign 0 phải xác nhận một lỗi không tạo ra retry nhân chéo.
KIE đã có chính sách không tự fallback để tránh trả tiền model thứ hai.

---

## 8. Usage và Cost telemetry — cấp 4

| Trường | Bằng chứng |
|---|---|
| Entry point | Trung tâm vận hành và Dashboard chi phí/lợi nhuận |
| Existing code | `usageService.ts`, `agencyEconomicsService.ts`, D1 usage endpoint |
| Integration | Adapter, voice, cloud và export ghi usage; execution envelope ghi lifecycle và Campaign 0 ghép ba nguồn |
| Persistence | usage local tối đa 500 + D1; lifecycle local tối đa 2.000 + system event cloud |
| Real test | Chưa đối chiếu hóa đơn provider |
| Measurement | Units, estimated USD, duration, status, provider/model/resource, lifecycle, dedupe và điểm mù reconciliation |
| Blocking gap | Failed call vẫn ghi cost 0 cho đến khi đối chiếu số dư; rate là ước lượng tĩnh; chưa có invoice/provider webhook |
| Decision | Đã có dry-run 0đ và paid preflight; chạy một voice request ≤200 ký tự rồi đối chiếu số dư |

`recordUsage` vẫn chỉ tính cost khi `status === success`. Nhiều provider tính
tiền khi tác vụ thất bại sau lúc được nhận, nên Dashboard vẫn là **ước tính**.
Khác với audit ban đầu, app nay chỉ rõ các failure đã qua `provider-accepted`
và buộc đối chiếu thay vì âm thầm coi chi phí bằng 0.

Ba event tối thiểu cho Campaign 0 đã có entry point:

- Preflight: pass/block/deduplicated và lý do trong execution trail.
- Human work session: bắt đầu/kết thúc theo stage trong Campaign 0.
- Billable attempt: submitted/accepted/provider-task/output-committed/completed/failed/interrupted.

Cấp 5 chỉ được mở sau một provider request thật được đối chiếu với số dư trước,
số dư sau, usage, job và lifecycle trên production.

---

## 9. Review nội bộ và khách hàng — cấp 4

| Trường | Bằng chứng |
|---|---|
| Entry point | Trung tâm sản xuất → Duyệt khách; Trung tâm vận hành → Bàn duyệt |
| Existing code | `agencyReviewService`, `ClientReviewManager`, `clientReviewService`, worker review routes |
| Integration | Director → Editor → Account trước khi phát hành link; comment theo timecode |
| Persistence | D1 + R2, version được đóng gói trong portal |
| Real test | Chưa có người ngoài team duyệt Campaign 0 |
| Measurement | Có quyết định, comment và version; chưa có decision method/role chuẩn cho học máy |
| Blocking gap | Mẫu học chưa phân biệt duyệt cá nhân, duyệt hàng loạt và quyết định client |
| Decision | Chạy khô link review; bổ sung metadata trước khi Client Memory được tự tác động |

### Hợp đồng “mẫu đủ chất lượng” đề xuất

Một quyết định được tính vào dữ liệu học chỉ khi:

1. Có `decisionMethod`: `individual`, `batch` hoặc `client-portal`.
2. `batch` luôn được ghi telemetry nhưng **không** tính vào mẫu học.
3. `client-portal` được tính.
4. `individual` chỉ được tính khi người duyệt đã mở mục và vai trò là Client
   hoặc Account được chỉ định làm client proxy.
5. `changes-requested` phải có lý do có nội dung; quyết định trống chỉ là trạng
   thái vận hành.
6. Cùng artifact + version + review gate chỉ tính quyết định cuối cùng một lần.

Supervisor calibration cần thêm `issueId` và dedupe theo issue, nếu không việc
toggle cùng một cảnh báo hoặc `queued → resolved` sẽ tạo nhiều “mẫu” giả.

### Người đóng vai khách trong Campaign 0

Ưu tiên một người Egoric **không tham gia sinh nội dung**. Người này chỉ nhận
link review, không xem prompt hoặc màn production. Nếu chưa có người phù hợp,
chủ dự án đóng vai client proxy nhưng phải tách phiên: hoàn tất production,
đóng workspace, rồi chỉ mở link review như khách hàng.

---

## 10. Render, export và bàn giao — cấp 4

| Trường | Bằng chứng |
|---|---|
| Entry point | Stage Xuất bản: preview, ghép MP4, ZIP, EDL/XML/SRT |
| Existing code | `browserMasterRenderService`, `autoEditorRenderService`, `exportService` |
| Integration | FFmpeg WASM ghép và tải file trực tiếp |
| Persistence | File tải về máy; source/project có thể lên R2 khi sync |
| Real test | Chưa render Campaign 0 với media/provider thật |
| Measurement | Có duration và input bytes cho một số render |
| Blocking gap | Đóng tab làm mất render; master không có asset cloud/link bàn giao độc lập |
| Decision | Giữ browser render làm fallback, thêm cloud delivery sau Campaign 0 |

“Video ra khỏi app” phải tách:

- **Bàn giao:** master cloud, version, review và link tải — app có phần lớn nền.
- **Đăng nền tảng:** TikTok/YouTube/Reels, OAuth, upload/poll/quota — track riêng.

Campaign 0 hoàn tất khi có master được duyệt và bàn giao. Upload nền tảng có thể
làm tay và ghi thời gian để tạo baseline.

---

## 11. Auth và release — cấp 3–4

| Trường | Bằng chứng |
|---|---|
| Entry point | Sites bảo vệ workspace; review token mở portal công khai |
| Existing code | Header `oai-authenticated-user-email`, worker dispatch, `.openai/hosting.json` |
| Integration | API workspace kiểm tra email; link review có token riêng |
| Persistence | Dữ liệu tách theo owner email |
| Real test | Deploy production đang hoạt động; multi-user ngoài workspace chưa kiểm |
| Measurement | Có system events; chưa có release health/SLO |
| Blocking gap | Auth phụ thuộc host; source credential và deploy có một release owner |
| Decision | Giữ cho agency nội bộ; chưa ưu tiên auth riêng trước Campaign 0 |

Deploy không còn là blocker như tài liệu cũ: Codex đã phát hành liên tiếp các
version gần đây. Quy tắc mới là deploy theo milestone, không theo từng commit.

### CI — cấp 4

`.github/workflows/ci.yml` chạy trên mọi PR vào `main` và mọi push lên `main`:

1. `npx tsc --noEmit`
2. `npm run test:run`
3. `npm run build`
4. `git diff --check`

---

## P0 trước Campaign 0

Không xây epic mới. Chỉ đóng các lỗ khiến lần chạy thật mất dữ liệu, đo sai hoặc
trả tiền hai lần.

1. ~~**Contract job:**~~ worker nhận đủ kind, lưu `idempotencyKey` và
   `providerTaskId`, có unique claim trên D1.
2. ~~**Execution envelope ảnh/video/voice:**~~ mọi đường sản xuất media chính có
   idempotency, provider task/accepted và trạng thái `interrupted` khi kết quả
   không rõ. Còn bổ sung event lifecycle riêng cho cost telemetry.
3. ~~**Workspace sync entry point, chẩn đoán và proof gate:**~~ đã có local-first
   autosync, full recovery, bia mộ local, health endpoint, protocol A/B và cổng
   Campaign 0; còn bước team chạy thực địa trên hai thiết bị vật lý.
4. ~~**Telemetry dry-run:**~~ usage + lifecycle giả đã được cloud xác nhận, có
   paid preflight và bảng reconciliation; còn một voice request thật ≤200 ký tự
   do team chủ động chạy sau khi cổng xanh.
5. ~~**CI:**~~ chặn merge khi whitespace/typecheck/test/build hỏng.
6. ~~**Review metadata:**~~ phân biệt individual/batch/client-portal và vai trò
   reviewer trước khi mở quyền học tự động.

## Thứ tự Sprint 0B đề xuất

```
Contract + CI
  → dry-run không tốn tiền
  → một request chat rẻ
  → một ảnh draft rẻ
  → một video ngắn có budget cap
  → review nội bộ
  → link client/proxy
  → master + bàn giao
  → đối chiếu số dư provider và dashboard
```

Sau Campaign 0, backlog được xếp lại bằng lỗi quan sát thật, không bằng số dòng
code hoặc độ hấp dẫn của tính năng.
