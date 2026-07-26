# Đồng bộ dữ liệu workspace

Phase 2 trong [ROADMAP_2026H2](ROADMAP_2026H2.vi.md).

## Vấn đề

Năm bộ dữ liệu chỉ nằm trong IndexedDB của **đúng một trình duyệt**:

```
agencyClients · agencyCampaigns · articleLibrary · publishLedger · managedAccounts
```

`syncProjectToCloud` đã có từ trước, nhưng nó chỉ đồng bộ **dự án**, và chỉ chạy khi người dùng bấm nút ở một trong hai chỗ.

Nghĩa là: xoá dữ liệu duyệt web là **mất sạch khách hàng, sổ cái đăng bài và lịch sử bài viết**. Không cảnh báo, không khôi phục được. Đây là rủi ro thảm khốc và im lặng — khác hẳn "render chậm thì bực".

## Một bảng, không phải năm

```sql
CREATE TABLE egoric_workspace_items (
  owner_email TEXT, collection TEXT, item_id TEXT,
  payload_json TEXT, updated_at INTEGER, deleted_at INTEGER,
  PRIMARY KEY (owner_email, collection, item_id)
);
```

Cả năm bộ đều là "danh sách bản ghi có id và mốc sửa đổi", nên tách ra năm bảng chỉ nhân bản cùng một đoạn mã năm lần.

Tên bộ đi qua **danh sách trắng** ở worker chứ không kiểm định dạng — nó đi thẳng vào câu truy vấn, và số bộ là hữu hạn.

## Bia mộ

`deleted_at` là phần dễ bỏ sót nhất. Xoá mà không để lại dấu thì máy khác vẫn giữ bản ghi cũ, lần đồng bộ sau nó đẩy ngược lên, và **thứ vừa xoá sống dậy**.

Bia mộ được đối xử như một lần sửa bình thường — nó chỉ thắng khi mới hơn:

| Tình huống | Kết quả |
|---|---|
| Xoá 10h, cloud có bản 09h | xoá thắng |
| Xoá 10h, sửa 11h | **bản sửa thắng** — người đụng sau cùng biết rõ hơn |
| Bia mộ cho thứ máy này chưa từng có | không làm gì |
| Xoá ở máy, cloud chưa biết | **đẩy bia mộ lên**, nếu không máy khác không bao giờ hay |

## Hoà thì phải hoà giống nhau ở cả hai máy

Mốc mới hơn thì thắng. Nhưng khi **trùng mốc mà khác nội dung**, quy tắc là so chuỗi payload và lấy chuỗi lớn hơn.

Nghe tuỳ tiện, và đó chính là điểm: cả hai máy đều tính ra **cùng một kết quả**, nên chúng hội tụ. Chọn "ưu tiên cloud" thì bất đối xứng — máy A thấy mình thua, máy B cũng thấy mình thua, và hai bên đẩy qua đẩy lại mãi.

Có test riêng cho việc này: mô phỏng cùng một tranh chấp nhìn từ hai phía và khẳng định **đúng một bên** giữ bản của mình.

## Đồng bộ không được làm hỏng việc đang làm

`syncCollection` **không bao giờ ném lỗi ra ngoài**. Nó chạy nền; một lần mất mạng làm hỏng thao tác người dùng đang gõ dở là đánh đổi sai. Lỗi trả về trong kết quả để giao diện hiện trạng thái.

Và khi lỗi thì **mốc đồng bộ không nhích**. Nhích sớm là lần sau bỏ qua đúng những bản ghi vừa lỗi — mất dữ liệu im lặng, đúng thứ lớp này sinh ra để tránh.

Một bộ hỏng không làm dừng bốn bộ còn lại.

## Mỗi kho một hình dạng, không gộp mù

Đây là chỗ dễ viết sai nhất:

| Bộ | Khoá | Mốc thời gian |
|---|---|---|
| agencyClients, agencyCampaigns, articleLibrary, managedAccounts | `id` | `updatedAt` |
| **publishLedger** | **`fingerprint`** | **`finishedAt` ?? `startedAt`** |

Sổ cái đăng bài khoá theo `fingerprint` để lần đăng lại cùng nội dung tìm đúng bản ghi cũ, và nó **không có `updatedAt`**. Viết một adapter chung giả định mọi kho đều `{ id, updatedAt }` thì sổ cái đồng bộ sai mà không báo gì — mọi bản ghi mang `id: ''` và `updatedAt: 0`.

Bản ghi còn treo chưa có `finishedAt`, lúc đó `startedAt` là mốc mới nhất biết chắc.

## Kiểm chứng

```bash
npx vitest run tests/workspaceSync.test.ts
```

32 test. Đáng chú ý:

- Trùng mốc khác nội dung → **đúng một bên** giữ bản của mình, không cả hai cùng nhường
- Sửa sau khi xoá thì bản sửa thắng; xoá sau khi sửa thì bản xoá thắng
- Bia mộ được đẩy lên cloud, không im lặng bỏ qua
- Mất mạng → không ném lỗi, **và không nhích mốc**
- Đẩy hỏng cũng không nhích mốc
- Sổ cái lấy đúng `fingerprint` và đúng `finishedAt ?? startedAt`
- Cả năm bộ đều có hình dạng khai báo sẵn — thêm bộ thứ sáu mà quên khai là test đỏ

580 test / 42 file toàn bộ xanh, `tsc` sạch, build sạch, `node --check` worker sạch.

## Chưa làm

- **Chưa nối vào giao diện.** Không có nút, không có chỉ báo trạng thái, không tự chạy nền. Lớp logic xong nhưng chưa ai gọi nó.
- **Endpoint worker chưa chạy thử lần nào** — cần deploy. Cùng lý do với OAuth ở Phase B: `node --check` chỉ bảo đảm cú pháp, không bảo đảm câu SQL chạy đúng trên D1 thật.
- Chưa có giới hạn tốc độ hay gộp lô theo thời gian; hiện đồng bộ là gọi thẳng.
- Chưa xử lý bản ghi quá 1 MB (worker trả 413) — cần cắt hoặc đẩy media ra R2 trước.
