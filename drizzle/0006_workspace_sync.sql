-- Dữ liệu cấp workspace: khách hàng, chiến dịch, thư viện bài, sổ cái đăng bài,
-- sổ tài khoản đăng bài.
--
-- Trước đây năm bộ này chỉ nằm trong IndexedDB của đúng một trình duyệt. Xoá
-- dữ liệu duyệt web là mất sạch, không cảnh báo, không khôi phục được.
--
-- Một bảng chung thay vì năm bảng riêng: cả năm đều là "danh sách bản ghi có
-- id, có mốc sửa đổi", nên tách ra chỉ nhân bản cùng một đoạn mã năm lần.

CREATE TABLE IF NOT EXISTS egoric_workspace_items (
  owner_email TEXT NOT NULL,
  collection TEXT NOT NULL,
  item_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Bia mộ. Xoá mà không để lại dấu thì máy khác sẽ đẩy bản ghi cũ lên lại và
  -- thứ vừa xoá sống dậy.
  deleted_at INTEGER,
  PRIMARY KEY (owner_email, collection, item_id)
);

-- Đồng bộ luôn hỏi "có gì đổi sau mốc N", nên index theo đúng thứ tự đó.
CREATE INDEX IF NOT EXISTS egoric_workspace_items_sync_idx
  ON egoric_workspace_items (owner_email, collection, updated_at);
