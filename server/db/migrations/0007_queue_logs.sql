-- Queue 任务日志表
-- 用于记录队列任务执行状态，支持前端监控页面展示

CREATE TABLE IF NOT EXISTS queue_task_logs (
  id TEXT PRIMARY KEY,
  novel_id TEXT,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT,
  error_msg TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_queue_logs_novel ON queue_task_logs(novel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_queue_logs_status ON queue_task_logs(status, created_at DESC);
