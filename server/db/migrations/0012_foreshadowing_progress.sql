-- ============================================================
-- NovelForge · D1 Migration #0012
-- 版本：v4.2
-- 说明：新增伏笔推进记录表（foreshadowing_progress），追踪伏笔在章节中的渐进式推进（hint/advance/partial_reveal）
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- 20. 伏笔推进记录表
-- 说明：记录伏笔在各章节中被推进的轨迹，支持 hint(暗示)/advance(推进)/partial_reveal(半揭露) 三种类型
-- ============================================================
CREATE TABLE IF NOT EXISTS foreshadowing_progress (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  foreshadowing_id    TEXT NOT NULL REFERENCES foreshadowing(id) ON DELETE CASCADE,
  chapter_id          TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  progress_type       TEXT NOT NULL CHECK(progress_type IN ('hint', 'advance', 'partial_reveal')),
  summary             TEXT,
  mentioned_keywords  TEXT,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_progress_foreshadowing ON foreshadowing_progress(foreshadowing_id, created_at DESC);
CREATE INDEX idx_progress_chapter ON foreshadowing_progress(chapter_id, created_at DESC);

-- ============================================================
-- Migration 完成
-- ============================================================
