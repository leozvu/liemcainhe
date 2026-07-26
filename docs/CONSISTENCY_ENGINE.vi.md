# Bộ máy nhất quán nhân vật và sản phẩm

Epic 4 trong [AI_INTELLIGENCE_PLAN.vi.md](AI_INTELLIGENCE_PLAN.vi.md). Đòn bẩy lớn nhất về chi phí: nhân vật lệch nhận diện giữa các shot là nguyên nhân hàng đầu phải sinh lại, và sinh lại là tiền thật.

## Một lỗ hổng có sẵn, và nó nghiêm trọng

`getShotMediaSignature` chỉ tính **keyframe và video của chính shot**:

```ts
export const getShotMediaSignature = (shot: Shot): string => [
  ...shot.keyframes.map(...),
  shot.interval ? ... : 'no-interval',
].join('|');
```

Nghĩa là **đổi ảnh định trang nhân vật thì shot không hề bị đánh dấu lỗi thời**. Keyframe sai từ gốc mà hệ thống vẫn báo hợp lệ, AI Vision vẫn dùng lại kết quả cũ, và người dùng chỉ phát hiện khi xem bản dựng.

Nay `getShotFullSignature` ghép thêm chữ ký nguồn:

```
<media của shot> ## <ảnh + prompt nhân vật, biến thể, khoá model, bối cảnh>
```

Có test khẳng định: đổi ảnh định trang → chữ ký đổi, **dù media của shot y nguyên**.

## Ba nguyên nhân gốc được tấn công

### 1. Một ảnh tham chiếu không đủ

Trước đây mỗi nhân vật chỉ có đúng một `referenceImage`. Ảnh chính diện không giúp model giữ khuôn mặt ở cảnh nghiêng hay cảnh lưng.

Nay có `referencePack` — nhiều ảnh, mỗi ảnh gắn góc chụp. `pickReferences` chọn ảnh hợp với cỡ cảnh:

| Cỡ cảnh | Ưu tiên góc |
|---|---|
| Cận | chính diện → ba phần tư → nghiêng |
| Trung | ba phần tư → chính diện → nghiêng |
| Toàn | ba phần tư → chính diện |

Ảnh **đã đi qua shot được duyệt** luôn đứng trước, bất kể góc — nó đã qua mắt người nên đáng tin hơn ảnh mới sinh.

Giới hạn 3 ảnh mỗi lần gọi. Nhiều hơn không tốt hơn: model bắt đầu trộn đặc điểm và cho ra một người thứ ba không giống ảnh nào.

`referenceImage` cũ vẫn dùng được ngay, được coi là ảnh chính diện đã duyệt — dự án cũ không cần làm gì.

### 2. Đổi model hoặc seed giữa chừng

Cùng prompt, khác model, ra khác người. `lockGenerationParams` khoá model và seed của lần sinh đã được duyệt; từ đó mọi shot có nhân vật này dùng đúng tham số đó.

Khoá chỉ áp khi người dùng chủ động khoá, nên không cản trở lúc đang thử nghiệm.

### 3. Sửa nhân vật mà không biết shot nào bị ảnh hưởng

`buildDependencyGraph` dựng bản đồ nhân vật → shot và bối cảnh → shot. `findAffectedShots` trả về đúng danh sách shot phải xem lại khi sửa một nhân vật.

## Sinh lại đúng lớp

`classifyRegenerationScope` phân biệt:

| Trường hợp | Phạm vi |
|---|---|
| Nguồn đổi (ảnh, prompt, khoá model) | `keyframes-and-video` — keyframe sai từ gốc |
| Chưa sinh gì | `none` |
| Không đổi | `none` |

Đây là chỗ tiết kiệm lớn nhất: giữ được keyframe khi chỉ cần dựng lại video rẻ hơn nhiều so với sinh lại cả shot.

## Cảnh báo trước khi sinh hàng loạt

`assessCharacterReadiness` chấm độ sẵn sàng của nhân vật: bao nhiêu ảnh, đủ góc chưa, đã khoá model chưa. Dùng để cảnh báo **trước khi** chạy Video Factory, thay vì phát hiện lệch mặt sau khi đã dựng xong hai mươi shot.

## Kiểm chứng

```bash
npx vitest run tests/consistency.test.ts
```

34 test. Nhóm quan trọng nhất là *"chữ ký nguồn — lỗ hổng chính Epic 4 bịt"*, khẳng định mọi thay đổi ở nguồn đều làm chữ ký đổi: ảnh định trang, prompt nhân vật, prompt bối cảnh, và khoá model.

Test cũ `aiSupervisor.test.ts` đã cập nhật để so với `getShotFullSignature` thay vì dựng chuỗi bằng tay — test nên đối chiếu với chính hàm mà code dùng.

## Chưa làm

Phần **xác minh khuôn mặt sau khi sinh** — so ảnh vừa tạo với ảnh tham chiếu để chấm điểm giống nhau. Đây là phần khó thật, cần embedding khuôn mặt hoặc một lượt AI Vision riêng, và nên hiệu chỉnh bằng dữ liệu thật trước khi cho nó quyền chặn.
