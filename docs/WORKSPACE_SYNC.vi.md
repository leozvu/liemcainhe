# Đồng bộ dữ liệu workspace

Phase 2 trong [ROADMAP_2026H2](ROADMAP_2026H2.vi.md).

## Vấn đề

Sáu bộ dữ liệu từng chỉ nằm trong IndexedDB của **đúng một trình duyệt**:

```
agencyClients · agencyCampaigns · articleLibrary · publishLedger · managedAccounts · campaignZeroRuns
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

Một bộ hỏng không làm dừng các bộ còn lại.

## Entry point và nhịp tự động

Đồng bộ nay được khởi động một lần ở App root và có hai entry point nhìn thấy
được: trạng thái trên thanh đầu Dashboard và trạng thái trong sidebar dự án.
Bấm vào trạng thái mở **Trung tâm đồng bộ workspace**. Tại đây team thấy được:

- số bản ghi sống, thay đổi đang chờ và bia mộ trên thiết bị;
- số bản ghi sống và bia mộ trên D1 theo từng collection;
- kết quả kéo/đẩy/xóa và lỗi riêng của từng collection;
- năm phiên gần nhất, cùng báo cáo chẩn đoán có thể sao chép mà không chứa API key;
- checklist A/B để kiểm chứng tạo, sửa và xóa trên hai thiết bị.

Checklist nay có một protocol bằng chứng cloud chạy ngay trong UI:

1. Thiết bị A đặt tên và tạo mã 8 ký tự.
2. Thiết bị B đăng nhập cùng workspace, nhập mã và xác nhận.
3. Worker từ chối nếu A và B có cùng danh tính cục bộ.
4. Thiết bị A đọc lại trạng thái rồi chốt bằng chứng.
5. Campaign 0 nạp bằng chứng đã chốt từ D1; bằng chứng còn hiệu lực 7 ngày.

Phiên chờ hết hạn sau 24 giờ. Worker lưu protocol trong collection nội bộ
`syncFieldTests` của `egoric_workspace_items`, tách khỏi danh sách trắng sáu kho
đồng bộ nên nó không bị kéo vào IndexedDB hoặc làm sai số liệu health. Payload
chỉ chứa mã ngẫu nhiên, nhãn/danh tính thiết bị và thời điểm; không chứa API key,
nội dung khách hàng hay media. Luồng không gọi provider AI nên chi phí bằng 0.

Nút **Kiểm tra và đồng bộ toàn bộ** chạy full pull rồi đọc lại local và endpoint
`/api/cloud/workspace/health`. Health endpoint chỉ trả số lượng và mốc mới nhất,
không tải payload khách hàng và không gọi bất kỳ model AI nào.

App tự chạy:

- full pull khi mở app, có mạng trở lại hoặc quay lại tab sau hơn một phút;
- incremental sync sau 1,2 giây kể từ lần ghi workspace gần nhất;
- heartbeat incremental mỗi phút;
- gộp tín hiệu đến cùng lúc thành một hàng đợi, không chạy chồng request.

Khi cloud kéo dữ liệu mới, Campaign Hub, Thư viện nội dung và Sổ tài khoản đang
mở sẽ tự đọc lại IndexedDB. Mất mạng không chặn thao tác; UI nói rõ bản local
đang an toàn và tự thử lại.

## Bia mộ local thật

IndexedDB version 8 có store `workspaceTombstones`. Xóa khách hàng, chiến dịch,
bài viết hoặc tài khoản sẽ xóa bản sống và ghi bia mộ trong **cùng transaction**.
Lần sync kế tiếp đẩy bia mộ lên cloud. Nếu một bản sửa mới hơn được tải về, việc
ghi bản sống đồng thời gỡ bia mộ cũ.

Điểm này sửa một lỗ hổng của lớp logic ban đầu: merge đã hiểu bia mộ nhưng các
hàm xóa local chưa từng tạo nó, nên bật autosync ngay có thể làm dữ liệu đã xóa
sống lại.

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

Các test đáng chú ý:

- Trùng mốc khác nội dung → **đúng một bên** giữ bản của mình, không cả hai cùng nhường
- Sửa sau khi xoá thì bản sửa thắng; xoá sau khi sửa thì bản xoá thắng
- Bia mộ được đẩy lên cloud, không im lặng bỏ qua
- Mất mạng → không ném lỗi, **và không nhích mốc**
- Đẩy hỏng cũng không nhích mốc
- Sổ cái lấy đúng `fingerprint` và đúng `finishedAt ?? startedAt`
- Cả sáu bộ đều có hình dạng khai báo sẵn — thêm bộ mới mà quên khai là test đỏ
- Health endpoint trả đủ sáu bộ, kể cả kho cloud đang rỗng, và chặn người chưa đăng nhập
- Protocol hai thiết bị chặn cùng device, chặn B chốt thay A và chỉ trả bằng chứng đã xác minh
- Coordinator giữ tối đa 12 phiên chẩn đoán, không để lịch sử phình bộ nhớ

Các test bao phủ merge, bia mộ local, incremental sync, lỗi từng nhóm, offline,
full recovery và gộp nhiều yêu cầu cùng lúc. CI chạy `tsc`, toàn bộ Vitest,
build Sites và kiểm tra whitespace trước khi merge.

## Còn lại

- Chưa xử lý bản ghi quá 1 MB (worker trả 413) — cần cắt hoặc đẩy media ra R2 trước.
- Chưa có compaction bia mộ lâu năm; giữ lại hiện an toàn hơn xóa sớm và làm dữ liệu sống lại.
- Protocol D1 đã tạo được bằng chứng máy A ↔ máy B. Vẫn cần hoàn tất checklist
  tạo/sửa/xóa dữ liệu thử trên hai máy thật để chứng minh cả sáu adapter và bia
  mộ hội tụ. Chỉ sau bằng chứng thực địa đó mới nâng năng lực từ cấp 4 lên cấp 5.
