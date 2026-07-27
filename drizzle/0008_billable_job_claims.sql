DROP INDEX IF EXISTS egoric_jobs_owner_project_idempotency_idx;

-- Dữ liệu cũ chưa có unique constraint. Nếu từng có hai snapshot cùng khóa,
-- giữ bản an toàn nhất và đóng bản dư trước khi tạo index để migration không
-- thất bại giữa chừng. Ưu tiên completed, rồi running/interrupted/queued.
WITH ranked_claims AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY owner_email, project_id, idempotency_key
      ORDER BY
        CASE status
          WHEN 'completed' THEN 0
          WHEN 'running' THEN 1
          WHEN 'interrupted' THEN 2
          ELSE 3
        END,
        updated_at DESC,
        id DESC
    ) AS claim_rank
  FROM egoric_jobs
  WHERE idempotency_key IS NOT NULL
    AND status IN ('queued', 'running', 'completed', 'interrupted')
)
UPDATE egoric_jobs
SET
  status = 'cancelled',
  detail = COALESCE(detail || ' ', '') || 'Đã đóng snapshot trùng khi nâng cấp khóa chống trừ credit hai lần.'
WHERE id IN (SELECT id FROM ranked_claims WHERE claim_rank > 1);

CREATE UNIQUE INDEX egoric_jobs_owner_project_idempotency_idx
  ON egoric_jobs (owner_email, project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND status IN ('queued', 'running', 'completed', 'interrupted');
