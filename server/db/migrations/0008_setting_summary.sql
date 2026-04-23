-- v4: novelSettings 增加 summary 字段（用于 RAG 索引）
ALTER TABLE novel_settings ADD COLUMN summary TEXT;

-- 新增 importance 复合索引（用于高重要性设定快速查询）
CREATE INDEX IF NOT EXISTS idx_novel_settings_importance
  ON novel_settings(novel_id, importance)
  WHERE deleted_at IS NULL;
