-- ============================================================
-- NovelForge · D1 Migration #0015
-- 版本：v4.2
-- 说明：为 check_logs 表添加 volume_progress_result 字段，存储卷完成度检查的详细结果
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- 修改 check_logs 表
-- 1. 更新 check_type 的 CHECK 约束，添加 'volume_progress' 类型
-- 2. 添加 volume_progress_result 字段，存储卷完成度检查的详细结果
-- ============================================================

-- 1. 重新创建表，添加新字段和更新 CHECK 约束
ALTER TABLE check_logs RENAME TO check_logs_old;

CREATE TABLE check_logs (
  id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id                TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_id              TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  check_type              TEXT NOT NULL CHECK(check_type IN ('character_consistency', 'chapter_coherence', 'combined', 'volume_progress')),
  score                   INTEGER NOT NULL DEFAULT 100,
  status                  TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('success', 'failed', 'error')),
  character_result        TEXT,  -- JSON: 角色一致性检查结果 { conflicts, warnings }
  coherence_result        TEXT,  -- JSON: 连贯性检查结果 { hasIssues, issues, score }
  volume_progress_result  TEXT,  -- JSON: 卷完成度检查结果 { volumeId, currentChapter, targetChapter, healthStatus, ... }
  issues_count            INTEGER NOT NULL DEFAULT 0,
  error_message           TEXT,
  created_at              INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 复制数据
INSERT INTO check_logs
  (id, novel_id, chapter_id, check_type, score, status, character_result, coherence_result, issues_count, error_message, created_at)
SELECT
  id, novel_id, chapter_id, check_type, score, status, character_result, coherence_result, issues_count, error_message, created_at
FROM check_logs_old;

-- 删除旧表
DROP TABLE check_logs_old;

-- 重建索引
CREATE INDEX IF NOT EXISTS idx_check_logs_chapter ON check_logs(chapter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_check_logs_novel ON check_logs(novel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_check_logs_type ON check_logs(chapter_id, check_type, created_at DESC);

-- ============================================================
-- Migration 完成
-- ============================================================
