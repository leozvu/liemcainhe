# Sprint 0A — Evidence Audit: năng lực AI

Phạm vi của Claude theo phân vai vòng 2. Codex ghi phần hệ thống ở `codex-system.md`; file gộp `PRODUCT_MASTER_PLAN.md` do **một mình Codex** viết.

Nhánh: `claude/sprint-0a-audit`. Ngoài `docs/`, chỉ đụng `supervisorCalibrationService.ts` và `clientMemoryService.ts` (mục 3 của plan vòng 2).

## Thang 5 cấp

| Cấp | Nghĩa |
|---|---|
| 1 | Có code |
| 2 | Có test |
| 3 | Được nối vào workflow |
| 4 | Người dùng tìm thấy và dùng được |
| 5 | Đã chạy với API/dữ liệu thật |

## Tổng kết

| Năng lực | Cấp | Quyết định |
|---|---|---|
| Prompt Preflight | **4** | Giữ |
| Editing Intelligence | **4** | Giữ |
| Client Memory | **4** | Sửa (đã sửa ngưỡng) |
| Supervisor + Calibration | **3–4** | Sửa (đã sửa ngưỡng) |
| Director Agent + Briefing | **3** | Nối lại |
| **Consistency Engine** | **2** | **Nối lại — gấp** |

**Không năng lực nào đạt cấp 5.** Không có lượt chạy nào với API key thật. Mọi con số chất lượng trong plan hiện là giả định.

---

## 1. Consistency Engine — cấp 2, nghiêm trọng nhất

| Trường | Nội dung |
|---|---|
| Entry point | **Không có.** Không màn nào mở nó. |
| Existing code | `consistencyService.ts` — 326 dòng, **12 hàm export** |
| Integration | **2/12 hàm được gọi.** `getShotUpstreamSignature` (bởi `aiSupervisorService`), `assessCharacterReadiness` (bởi `directorBriefingService`) |
| Persistence | `Character.referencePack` và `Character.lock` đã có trong `types.ts` — **chưa có gì ghi vào** |
| Real API test | Chưa |
| Measurement | Không ghi gì |
| Blocking gap | `geminiService` — nơi sinh ảnh — có **0** tham chiếu tới `referencePack`, `pickReferences`, `GenerationLock`. Không có UI thêm/duyệt ảnh tham chiếu. |
| Decision | **Nối lại, ưu tiên cao nhất** |

Mười hàm chết: `collectReferences`, `pickReferences`, `addReference`, `approveReference`, `lockGenerationParams`, `unlockGenerationParams`, `resolveLockedModel`, `buildDependencyGraph`, `findAffectedShots`, `classifyRegenerationScope`.

Nhưng **15 khẳng định test** phủ đúng những hàm đó — nên bộ test xanh và không ai thấy vấn đề.

Đây là ví dụ mạnh nhất cho luận điểm của Codex ở mục 1. Plan gọi Consistency là *"lợi thế lớn nhất của Egoric"*; thực tế nó chưa từng ảnh hưởng tới một tấm ảnh nào.

**Việc cần làm:** truyền reference pack vào `geminiService.generateImage`, thêm UI khoá nhân vật/sản phẩm, nối `classifyRegenerationScope` vào luồng sinh lại. Ước lượng: hạ tầng + UI thuộc Codex, chọn ảnh và luật ưu tiên góc thuộc Claude.

---

## 2. Director Agent + Briefing — cấp 3

| Trường | Nội dung |
|---|---|
| Entry point | `CreativeDirectorPanel` — lazy load từ `App.tsx:446` |
| Existing code | `creativeDirectorService` (563 dòng), `creativeDirectorMissionService`, `directorBriefingService` |
| Integration | Briefing được `creativeDirectorMissionService` gọi ✓ |
| Persistence | `ProjectState.creativeDirector` |
| Real API test | Chưa |
| Measurement | `usageService` ghi chi phí mỗi lượt gọi ✓ |
| Blocking gap | `directorBriefingService` **không có UI nào gọi trực tiếp** — người dùng không đọc được bản giao ban, chỉ model đọc. Không kiểm được nó nói đúng hay sai. |
| Decision | Nối lại (hiện bản giao ban cho người) |

Sáu công cụ của Agent đều là công cụ **sinh**. Cổng ngân sách cộng dồn (`projectBudgetUsd`) đã có nhưng chưa có UI đặt trần.

---

## 3. Supervisor + Calibration — cấp 3–4

| Trường | Nội dung |
|---|---|
| Entry point | `AISupervisor` trong `ProductionCenter.tsx:353` ✓ · calibration hiện trong `ProviderHealthPanel` |
| Existing code | `aiSupervisorService` (506 dòng), `supervisorCalibrationService` |
| Integration | `calibrateIssues` chạy trước khi chấm điểm ✓ |
| Persistence | `localStorage` — **không lên cloud**, mất khi xoá cache |
| Real API test | Chưa. Epic 3 từng kiểm bằng **22 bản ghi tôi tự bịa** |
| Measurement | Ghi outcome mỗi cảnh báo ✓ |
| Blocking gap | Ngưỡng cũ quá thấp (**đã sửa**, xem dưới). Dữ liệu hiệu chỉnh không đồng bộ nên mỗi máy học một kiểu. |
| Decision | Sửa |

---

## 4. Client Memory — cấp 4

| Trường | Nội dung |
|---|---|
| Entry point | `StageContent/index.tsx` ✓ |
| Existing code | `clientMemoryService` |
| Integration | `articleService:190` ghép vào system prompt ✓ |
| Persistence | Suy ra từ `articleLibrary` (IndexedDB), nay có đồng bộ D1 |
| Real API test | Chưa |
| Measurement | Đọc engagement thật từ sổ cái ✓ |
| Blocking gap | **Không có ngưỡng** (đã sửa). Giả thuyết trung tâm — ví dụ đã duyệt làm model viết nhất quán hơn — **chưa được chứng minh**. |
| Decision | Sửa |

---

## 5. Prompt Preflight — cấp 4

| Trường | Nội dung |
|---|---|
| Entry point | Tự động, không cần thao tác |
| Integration | Cắm vào `geminiService.generateImage` và `generateVideo` — phủ mọi chỗ gọi ✓ |
| Persistence | Brand Kit trong project |
| Real API test | Chưa |
| Measurement | **Không ghi gì.** Không biết chặn bao nhiêu lượt, bao nhiêu là chặn oan |
| Blocking gap | Thiếu đo lường → không đánh giá được nó lợi hay hại |
| Decision | Giữ, thêm telemetry ở Sprint 0B |

---

## 6. Editing Intelligence — cấp 4

| Trường | Nội dung |
|---|---|
| Entry point | Bảng "Trí tuệ dựng phim" trong Auto Editor ✓ |
| Integration | `autoEditorService` đọc `pacing` khi dựng timeline ✓ |
| Persistence | `autoEditor.pacing` trong project ✓ |
| Real API test | **Không cần** — logic thuần, không gọi model |
| Measurement | Chưa ghi tỷ lệ người dùng áp rồi giữ nguyên |
| Blocking gap | `suggestReframe` viết xong, có test, **chưa có nút bấm** |
| Decision | Giữ |

Đây là năng lực duy nhất đúng ngay cả khi chưa có API key.

---

## 7. Trải nghiệm agency — vấn đề xuyên suốt

**Tính năng bị chôn là lỗi lặp lại, không phải sự cố đơn lẻ.** Ba lần trong một session:

| Trường hợp | Triệu chứng |
|---|---|
| Creative Direction | Có code + test, người dùng không thấy |
| `ManagedAccountsPanel` | Tôi đặt trong panel đăng bài của **một bài viết** — sai cấp dữ liệu |
| Consistency Engine | Không có entry point nào |

Nguyên nhân chung: **service viết xong được coi là việc đã xong.** Đề nghị đưa "Entry point" thành trường bắt buộc trong mọi PR — không có thì không merge.

Thiếu đo lường thời gian tay: `UsageRecord` có `durationMs` của lời gọi API nhưng **không có trường nào ghi thời gian thao tác người**. Không có nó thì không tính được giá vốn thật.

---

## Entry point → dữ liệu thật đi vào service

Bảng Codex yêu cầu ở vòng sửa cuối. Cột cuối trả lời: **dữ liệu chạy qua đây có phải dữ liệu thật của người dùng không**, hay chỉ là hình dạng đúng.

| Năng lực | Entry point | Đường dữ liệu | Thật? |
|---|---|---|---|
| Prompt Preflight | Tự động, không thao tác | `geminiService.generateImage/generateVideo` ← prompt người dùng gõ | **Có** |
| Editing Intelligence | Bảng "Trí tuệ dựng phim", Auto Editor | `autoEditorService.buildTimeline` ← `autoEditor.pacing` trong project | **Có** |
| Supervisor + Calibration | `ProductionCenter.tsx:353` | `setSupervisorIssueStatus` → `recordSupervisorDecision(issue, …)` ← `issue.id` thật | **Có** (nay có dedupe) |
| Client Memory | `StageContent/index.tsx` | `articleService:190` ← `articleLibrary` IndexedDB | **Một nửa** — bài thật, nhưng **không có metadata chất lượng quyết định** |
| Director Agent | `App.tsx:446` | `ProjectState.creativeDirector` | **Có** |
| Director **Briefing** | **Không có** | Chỉ `creativeDirectorMissionService` gọi; người không đọc được | **Không kiểm được** |
| Consistency Engine | **Không có** | `geminiService` có 0 tham chiếu tới `referencePack` | **Không** |

---

## Rút khỏi PR: ngưỡng Client Memory

Theo đúng chỉ dẫn *"nếu 5 file hiện tại không đủ để truyền metadata thật từ entry point thì rút runtime memory change; không giả lập dữ liệu"*.

**Contract hiện tại không đủ:**

```ts
// types/content.ts:264 — không thuộc 5 file của Claude
export interface ReviewRecord {
  decision: ReviewDecision;
  reviewer?: string;
  note?: string;
  decidedAt?: number;
}
```

Không có trường nào phân biệt `individual | batch | client-portal`, không có vai trò người duyệt, không có `artifactVersion` hay `gate` để gộp quyết định cuối. Nơi duy nhất ghi review là `reviewQueueService.ts:437` — cũng ngoài phạm vi.

Đặt ngưỡng đếm thuần trên dữ liệu không phân loại thì **tệ hơn không có ngưỡng**: duyệt hàng loạt 20 mục một cú bấm là đạt mốc ngay, mà đó đúng là loại nhiễu ngưỡng sinh ra để chặn. Một hàng rào dễ vượt bằng nhiễu tạo cảm giác an toàn giả.

`clientMemoryService.ts` và test của nó đã **khôi phục nguyên trạng** — `git diff` với `main` rỗng.

### Contract cần cho Sprint 0B

```ts
export type ReviewMode = 'individual' | 'batch' | 'client-portal';
export type ReviewerRole = 'director' | 'editor' | 'account' | 'client' | 'client-proxy';

export interface ReviewRecord {
  decision: ReviewDecision;
  reviewer?: string;
  note?: string;
  decidedAt?: number;

  mode: ReviewMode;
  role: ReviewerRole;
  /** Người duyệt đã mở mục ra xem chưa. `batch` luôn false. */
  opened: boolean;
  /** Gộp quyết định cuối cùng theo cùng artifact + version + gate. */
  artifactVersion: string;
  gate: string;
}
```

Luật đếm khi có contract, để Codex chốt:

| Trường hợp | Tính vào mẫu học |
|---|---|
| `batch` | **Không** (vẫn ghi nhận vận hành) |
| `client-portal` | Có |
| `individual` + `opened` + role `client`/`client-proxy` | Có |
| `individual` role khác | Không |
| `changes-requested` không có lý do | **Không** |
| Cùng artifact + version + gate | Chỉ quyết định **cuối cùng**, một lần |

Chủ sở hữu: `types/content.ts` và `reviewQueueService.ts` thuộc Codex. Claude nhận phần luật đếm và test khi contract đã có.

---

## Hai sửa đổi đã làm

Theo mục 3 plan vòng 2, phạm vi thu về **một file**: `supervisorCalibrationService.ts`.

### Supervisor: một ngưỡng → ba tầng

`MIN_CALIBRATION_SAMPLE = 5` cho phép **5 mẫu đã tự hạ độ nặng cảnh báo**. Con số 5 không dựa trên gì cả.

```
< 10 mẫu   insufficient  chỉ hiện số, không kết luận
10–29      advisory      hiện tỷ lệ và độ tin, KHÔNG tự áp
≥ 30       actionable    được phép hạ mức
```

`KindCalibration` thêm `tier`. `suggestedSeverity` chỉ có từ 30 mẫu. Ranh giới 29/30 có test riêng.

Giữ nguyên: **chỉ hạ, không bao giờ nâng**, và đủ mẫu mà đáng tin thì vẫn không hạ — ngưỡng không phải giấy phép.

### Gộp mẫu theo cảnh báo

Bản trước `recordSupervisorDecision` luôn `push` bản ghi mới với id ngẫu nhiên. Hệ quả:

- Bật → tắt → bật lại một cảnh báo = **ba mẫu**
- `queued → resolved` của cùng cảnh báo = **hai** phiếu `accepted`

Người duyệt lưỡng lự vài lần là tự tay bơm mẫu, và loại đó đạt ngưỡng 30 bằng nhiễu — làm hỏng đúng thứ ngưỡng vừa dựng lên.

`CalibrationRecord` thêm `issueId` (lấy từ `AISupervisorIssue.id` vốn đã có). Ghi lần sau **thay tại chỗ**, giữ nguyên vị trí để thứ tự thời gian không nhảy. Bản ghi cũ chưa có `issueId` vẫn đọc được, chỉ không tham gia dedupe.

Đã kiểm chỗ gọi: `aiSupervisorService:466` truyền cả đối tượng `issue` nên `id` đi xuyên suốt — dedupe chạy thật, không phải chỉ đúng trong test.

### Câu mô tả không nói quá

`describeCalibration` cũ nói **"Đã hạ xuống mức nhắc"** ở cả tầng advisory, trong khi `suggestedSeverity` chưa được áp. Người duyệt đọc xong tưởng cảnh báo đã nhẹ đi, thực tế nó vẫn chặn như cũ.

Nay ở tầng advisory: *"…% bị bỏ qua trên N lượt. **Chưa hạ mức** — cần thêm M lượt nữa."*

13 test mới cho ba tầng, dedupe và câu mô tả.

---

## Đề xuất cho Sprint 0B

**Định nghĩa "mẫu đủ chất lượng" — cần chốt trước khi đếm.**

Phase D tôi xây duyệt hàng loạt: một cú bấm duyệt 20 mục. Nếu 20 lượt đó đếm ngang một lượt từ chối kèm lý do, mốc 30 đạt rất nhanh mà toàn nhiễu.

Đề xuất: chỉ tính quyết định có tín hiệu thông tin — từ chối kèm lý do, hoặc duyệt từng mục. Duyệt hàng loạt vẫn ghi nhận nhưng **không tính vào mẫu học**. Cần Codex xác nhận vì nó chạm vào cách ghi telemetry.

**Telemetry tối thiểu — phần còn thiếu nhỏ hơn tưởng.** `usageService` đã ghi chi phí, trạng thái, lỗi, thời lượng API. Còn thiếu: thời gian thao tác tay, quyết định duyệt kèm lý do, và số lượt Preflight chặn. Nối thứ có sẵn, không dựng mới.

**Chạy khô trước khi chạy thật.** Xác nhận mọi trường ghi đúng rồi mới tiêu tiền; phát hiện telemetry hỏng sau khi chạy thì phải chạy lại và trả tiền hai lần.

**Ai đóng vai khách trong Campaign 0?** Egoric tự duyệt video của mình thì cổng duyệt không được thử thật.
