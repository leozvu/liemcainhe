# Trí nhớ theo khách hàng

Epic 2 trong [AI_INTELLIGENCE_PLAN.vi.md](AI_INTELLIGENCE_PLAN.vi.md).

## Vấn đề

Brand Kit là bộ quy tắc **người nhập**. Nó nói khách *muốn* gì. Lớp này giữ thứ quan trọng hơn: cái gì **thực sự đã được duyệt**, và cái gì **thực sự chạy tốt**.

Trước đó mọi dự án bắt đầu từ con số không. Bài thứ hai mươi viết cho một khách không hề tốt hơn bài thứ nhất.

## Không thu thập gì mới

Dữ liệu đã tự sinh ra rồi:

| Nguồn | Có sẵn từ |
|---|---|
| Quyết định duyệt / yêu cầu sửa | Bàn duyệt |
| **Lý do người duyệt ghi** | Ô ghi chú khi bấm "Yêu cầu sửa" |
| Lượt tiếp cận, tỷ lệ tương tác | Lớp thu số liệu |

Việc ở đây chỉ là đọc chúng và biến thành ngữ cảnh cho prompt.

## Gom theo khách, không theo dự án

Một khách chạy nhiều chiến dịch, và bài học từ chiến dịch trước phải dùng được cho chiến dịch sau. `SavedArticle` nay mang `clientId`.

Bài cũ chưa gắn khách vẫn dùng được: không nêu `clientId` thì gom tất cả, thay vì bỏ đi dữ liệu đã có.

## Xếp bài chạy tốt lên trước

Mẫu đưa vào prompt được xếp theo tỷ lệ tương tác thật, tra qua nhật ký đăng bài bằng chính vân tay nội dung — không cần lưu thêm quan hệ nào giữa thư viện và nhật ký.

Bài chưa đo được hiệu quả vẫn dùng, chỉ xếp sau. **Có mẫu còn hơn không.**

## Cố ý giữ ít mẫu

`MAX_EXAMPLES = 3`, `MAX_REJECTIONS = 4`.

Nhồi hai mươi bài mẫu vừa tốn token vừa **làm loãng**: model bắt đầu trộn giọng của tất cả thay vì học một giọng nhất quán.

## Thứ tự ba khối trong prompt

```
1. Quy tắc viết tiếng Việt      (chung, không đổi)
2. Brand Kit                    (quy tắc người nhập)
3. Trí nhớ                      (bằng chứng thật)
```

Trí nhớ đứng cuối vì nó **cụ thể nhất** và gần chỗ áp dụng nhất — mẫu bài thật đè lên mô tả trừu tượng khi hai bên gợi ý khác nhau.

Trong khối trí nhớ, phần đã duyệt đứng trước phần bị từ chối: model bám mẫu tích cực tốt hơn bám lệnh cấm, và lệnh cấm đứng cuối thì nằm gần nhất với chỗ nó phải áp dụng.

Trí nhớ rỗng thì **không chèn khối trống** — prompt giữ nguyên như trước.

## Lý do bị từ chối là tín hiệu quý nhất

Khi người duyệt bấm "Yêu cầu sửa" và ghi *"Sapo quá dài, bỏ đoạn cuối"*, câu đó đi thẳng vào prompt lần sau dưới mục **tuyệt đối tránh lặp lại**.

Đây là thứ Brand Kit không bao giờ có được, vì không ai ngồi liệt kê trước mọi cách viết sai.

## Kiểm chứng

```bash
npx vitest run tests/clientMemory.test.ts
```

19 test.

Đã chạy thật trên trình duyệt, đúng vòng khép kín:

| Bước | Kết quả |
|---|---|
| Viết bài 1, thư viện trống | Prompt **không** có khối trí nhớ |
| Lưu bài 1 → Bàn duyệt → Duyệt | Ghi `approved` xuống IndexedDB |
| Viết bài 2 | Prompt **có** khối trí nhớ, nêu đúng tên bài 1, góc tiếp cận, giọng, mở bài và đoạn trích |
| Giao diện | Hiện *"Đang học từ 1 bài đã duyệt"* cạnh nút Viết bài |

Không lỗi console.
