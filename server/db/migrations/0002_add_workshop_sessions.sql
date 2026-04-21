-- ============================================================
-- NovelForge · D1 Migration 0002
-- 功能：添加创作工坊会话表（Phase 3 - 对话式创作引擎）
-- 版本：v2.1
-- 日期：2026-04-21
-- ============================================================

-- ------------------------------------------------------------
-- 14. 创作工坊会话表（Phase 3 新增）
-- 用途：记录用户与 AI 的多轮对话，提取结构化小说数据
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workshop_sessions (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8))),
  novel_id        TEXT REFERENCES novels(id) ON DELETE SET NULL,  -- 关联的小说ID（可选，创建时可为空）
  stage           TEXT NOT NULL DEFAULT 'concept',               -- 当前阶段：concept | worldbuild | characters | volumes | chapters
  messages        TEXT NOT NULL DEFAULT '[]',                     -- JSON 对话历史 [{role, content, timestamp}]
  extracted_data  TEXT NOT NULL DEFAULT '{}',                    -- JSON 当前提取的结构化数据 {title, genre, outline, characters, ...}
  status          TEXT NOT NULL DEFAULT 'active',                 -- active | committed | abandoned
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_workshop_status ON workshop_sessions(status);
CREATE INDEX idx_workshop_novel ON workshop_sessions(novel_id);
CREATE INDEX idx_workshop_stage ON workshop_sessions(stage);

-- ============================================================
-- 迁移完成
-- ============================================================
