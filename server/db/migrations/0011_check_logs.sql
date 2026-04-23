-- ============================================================
-- NovelForge · D1 Migration #0011
-- 版本：v4.1
-- 说明：新增章节检查日志表（check_logs），用于存储角色一致性检查和章节连贯性检查的记录
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- 19. 章节检查日志表
-- 说明：存储角色一致性检查、连贯性检查、组合检查的结果日志
-- ============================================================
CREATE TABLE IF NOT EXISTS check_logs (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id            TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_id          TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  check_type          TEXT NOT NULL CHECK(check_type IN ('character_consistency', 'chapter_coherence', 'combined')),
  score               INTEGER NOT NULL DEFAULT 100,
  status              TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('success', 'failed', 'error')),
  character_result    TEXT,  -- JSON: 角色一致性检查结果 { conflicts, warnings }
  coherence_result    TEXT,  -- JSON: 连贯性检查结果 { hasIssues, issues, score }
  issues_count        INTEGER NOT NULL DEFAULT 0,
  error_message       TEXT,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_check_logs_chapter ON check_logs(chapter_id, created_at DESC);
CREATE INDEX idx_check_logs_novel ON check_logs(novel_id, created_at DESC);
CREATE INDEX idx_check_logs_type ON check_logs(chapter_id, check_type, created_at DESC);

-- ============================================================
-- Migration 完成
-- ============================================================
