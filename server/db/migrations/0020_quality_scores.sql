-- 迁移：质量评分表
-- 说明：Phase 2 章节写作质量评分，存储多维度评分结果

CREATE TABLE IF NOT EXISTS quality_scores (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  total_score INTEGER,
  plot_score INTEGER,
  consistency_score INTEGER,
  foreshadowing_score INTEGER,
  pacing_score INTEGER,
  fluency_score INTEGER,
  details TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_quality_chapter ON quality_scores(chapter_id);
CREATE INDEX IF NOT EXISTS idx_quality_novel ON quality_scores(novel_id, created_at DESC);
