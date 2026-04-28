-- 迁移：批量生成任务表
-- 说明：Phase 1 批量章节生成功能，记录生成任务状态和进度

CREATE TABLE IF NOT EXISTS batch_generation_tasks (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  volume_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  start_chapter_order INTEGER NOT NULL,
  target_count INTEGER NOT NULL,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  current_chapter_order INTEGER,
  error_msg TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_batch_novel ON batch_generation_tasks(novel_id);
CREATE INDEX IF NOT EXISTS idx_batch_status ON batch_generation_tasks(status);
