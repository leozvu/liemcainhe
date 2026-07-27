# Sprint 0A — Evidence Audit: nền tảng hệ thống

Phạm vi Codex theo plan vòng 2: luồng dữ liệu, độ bền job, provider/chi phí,
persistence, khả năng tìm thấy tính năng, xuất bản, review và release. Tài liệu
này **không coi số dòng code là bằng chứng sản phẩm đã hoạt động**.

Nhánh: `codex/sprint-0a-system`, xuất phát từ `main` tại `18fe390`.
Sprint này chỉ audit; không thay đổi runtime hoặc UI.

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
| Đồng bộ dữ liệu workspace | **2** | **Nối lại — gấp** |
| Job history và trạng thái gián đoạn | 3 | Sửa contract client/worker |
| Chống gửi trùng job billable | **2** | **Nối vào mọi lời gọi media — gấp** |
| Model routing và circuit breaker | 3 | Phủ hết đường gọi trực tiếp |
| Usage/cost telemetry | 3 | Phủ hết billable path, đo chi phí thật |
| Review nội bộ + link khách hàng | 4 | Chạy khô rồi chạy thật |
| Render/export master | 4 | Giữ local fallback, thêm bàn giao cloud |
| Đăng video lên nền tảng | 1 | Track riêng, phụ thuộc OAuth/review |
| Release Sites | 4 | Giữ một release owner |
| CI | **0** | Thêm trước khi hai agent merge thường xuyên |

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

## 4. Đồng bộ dữ liệu workspace — cấp 2, blocker dữ liệu

| Trường | Bằng chứng |
|---|---|
| Entry point | Campaign 0 tự đồng bộ khi mở/lưu và có nút **Đồng bộ ngay**; các kho workspace còn lại chưa có caller ở runtime |
| Existing code | `workspaceSyncService.ts`, IndexedDB adapters, cloud transport, `/api/cloud/workspace` |
| Integration | `campaignZeroRuns` gọi trực tiếp `syncCollection`; `syncAllCollections` vẫn chỉ được gọi trong test |
| Persistence | D1 migration và worker route đã có |
| Real test | Chưa |
| Measurement | Panel Campaign 0 hiển thị đang tải/đồng bộ/đã đồng bộ/local-only/lỗi; số pulled/pushed vẫn chưa đưa lên dashboard |
| Blocking gap | Client, campaign, article, publish ledger và managed account chưa tự sync |
| Decision | Campaign 0 đã có local-first, full pull và recovery thủ công; nối năm kho còn lại sau khi Golden Run xác nhận contract cloud ổn định |

Đây là ví dụ hệ thống tương ứng với Consistency Engine: code, adapter, endpoint
và test đều có, nhưng không có caller nên người dùng nhận được **0 giá trị**.

---

## 5. Job history và hàng đợi bền — cấp 3

| Trường | Bằng chứng |
|---|---|
| Entry point | Trung tâm sản xuất → tab Tác vụ; tự hydrate khi mở project |
| Existing code | `workflowService.ts`, `durableJobService.ts`, `jobStateMachine.ts`, `/api/jobs` |
| Integration | App debounce đẩy `workflow.jobs` và tải lại khi mở project |
| Persistence | Project local + bảng `egoric_jobs` trên D1 |
| Real test | Chưa chạy job provider thật qua lần đóng tab |
| Measurement | Trạng thái/progress/error/attempts có sẵn |
| Blocking gap | Worker không nhận bốn kind mới; không lưu idempotency key và provider task ID |
| Decision | Sửa contract trước khi gọi nó là durable queue |

Hai lỗi contract cụ thể:

1. Client cho phép `video-factory`, `ai-supervisor`, `auto-editor`,
   `agency-review`; worker chỉ cho tám kind cũ. Khi project có kind mới, toàn bộ
   PUT `/api/jobs` bị 400.
2. `ProductionJob` có `idempotencyKey` và `providerTaskId`, nhưng migration,
   SELECT và UPSERT D1 không có hai cột đó. Sau reload, đúng hai dữ kiện cần để
   chống trừ tiền hai lần bị mất.

---

## 6. Chống gửi trùng job billable — cấp 2, blocker tiền

| Trường | Bằng chứng |
|---|---|
| Entry point | **Không có trên đường gọi media** |
| Existing code | `deriveIdempotencyKey`, `findDuplicateJob`, `decideSubmit` |
| Integration | Chỉ test gọi các hàm này; `createProductionJob` không tạo key |
| Persistence | Không lưu key/task ID lên D1 |
| Real test | Chưa |
| Measurement | Không có số request bị dedupe |
| Blocking gap | Double-click, retry hoặc reload có thể gửi lại tác vụ billable |
| Decision | P0 trước khi chạy video thật số lượng lớn |

Job UI hiện chủ yếu là **nhật ký tiến độ**, chưa phải execution authority. Chặn
trùng phải xảy ra trước lời gọi provider, không phải sau khi UI đã tạo job.

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

## 8. Usage và Cost telemetry — cấp 3

| Trường | Bằng chứng |
|---|---|
| Entry point | Trung tâm vận hành và Dashboard chi phí/lợi nhuận |
| Existing code | `usageService.ts`, `agencyEconomicsService.ts`, D1 usage endpoint |
| Integration | Adapter, voice, cloud và export có ghi usage |
| Persistence | localStorage tối đa 500; hosted usage lên D1 |
| Real test | Chưa đối chiếu hóa đơn provider |
| Measurement | Units, estimated USD, duration, status, provider/model/resource |
| Blocking gap | Failed call luôn ghi cost 0; direct media path không ghi; rate là ước lượng tĩnh |
| Decision | Dry-run telemetry rồi đối chiếu số dư trước/sau một request thật |

`recordUsage` chỉ tính cost khi `status === success`. Nhiều provider vẫn tính
tiền khi tác vụ thất bại sau lúc được nhận. Vì vậy Dashboard hiện là **ước tính
lạc quan**, chưa phải giá vốn kế toán.

Thiếu ba event tối thiểu cho Campaign 0:

- Preflight: pass/block/override và lý do.
- Human work session: bắt đầu/kết thúc theo stage.
- Billable attempt: submitted/accepted/provider-task/completed/failed/unknown.

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

### CI — cấp 0

Repo không có `.github/workflows`. Khi Claude và Codex cùng mở PR, việc này
không còn là nợ “làm lúc rảnh”. Trước khi merge thường xuyên cần tối thiểu:

1. `npx tsc --noEmit`
2. `npm run test:run`
3. `npm run build`
4. `git diff --check`

---

## P0 trước Campaign 0

Không xây epic mới. Chỉ đóng các lỗ khiến lần chạy thật mất dữ liệu, đo sai hoặc
trả tiền hai lần.

1. **Contract job:** worker nhận đủ kind, lưu `idempotencyKey` và
   `providerTaskId`.
2. **Execution envelope:** mọi lời gọi billable có idempotency, provider task,
   usage event và trạng thái `unknown` khi mất kết nối.
3. **Workspace sync entry point:** chạy nền có trạng thái, hoặc khóa Campaign 0
   trên một thiết bị với cảnh báo rõ.
4. **Telemetry dry-run:** provider giả, zero-credit asset, review link và export;
   xác nhận mọi event trước một lời gọi thật.
5. **CI:** chặn merge khi typecheck/test/build hỏng.
6. **Review metadata:** phân biệt individual/batch/client-portal trước khi mở
   quyền học tự động.

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
