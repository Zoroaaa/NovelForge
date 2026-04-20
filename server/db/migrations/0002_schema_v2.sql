-- ============================================================
-- NovelForge · Schema v2.0 迁移脚本（全新架构）
-- 
-- 变更内容：
-- 1. 新增 master_outline 总纲表（替代原 outlines 多层结构）
-- 2. 新增 writing_rules 创作规则表
-- 3. 新增 novel_settings 小说设定表（统一管理世界观/境界/势力/地理/宝物功法）
-- 4. 增强 volumes 卷表（添加 outline/blueprint/notes 等字段）
-- 5. 新增 foreshadowing 伏笔追踪表
-- 6. 新增 entity_index 总索引表（树形结构）
-- 7. characters 表新增 power_level 字段
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- 1. 总纲表（新增，完全替代原 outlines 表）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS master_outline (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id      TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  content       TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  summary       TEXT,
  word_count    INTEGER NOT NULL DEFAULT 0,
  vector_id     TEXT,
  indexed_at    INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at    INTEGER
);

CREATE INDEX idx_master_outline_novel ON master_outline(novel_id) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- 2. 创作规则表（新增）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS writing_rules (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id      TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,     -- style | pacing | character | plot | world | taboo | custom
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  priority      INTEGER NOT NULL DEFAULT 3,   -- 1=最高优先级, 5=最低
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at    INTEGER
);

CREATE INDEX idx_writing_rules_novel ON writing_rules(novel_id, category) WHERE deleted_at IS NULL;
CREATE INDEX idx_writing_rules_priority ON writing_rules(priority) WHERE is_active = 1;

-- ------------------------------------------------------------
-- 3. 小说设定表（新增，统一管理所有世界设定）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS novel_settings (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id      TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,     -- worldview | power_system | faction | geography | item_skill | misc
  category      TEXT,              -- 子分类
  name          TEXT NOT NULL,     -- 设定名称
  content       TEXT NOT NULL,     -- 详细描述 (Markdown)
  attributes    TEXT,              -- JSON: 额外结构化数据
  parent_id     TEXT,              -- 支持层级
  importance    TEXT NOT NULL DEFAULT 'normal',  -- high | normal | low
  related_ids   TEXT,              -- JSON array: 关联 ID 列表
  vector_id     TEXT,
  indexed_at    INTEGER,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at    INTEGER
);

CREATE INDEX idx_novel_settings_novel ON novel_settings(novel_id, type) WHERE deleted_at IS NULL;
CREATE INDEX idx_novel_settings_type ON novel_settings(type, category);
CREATE INDEX idx_novel_settings_parent ON novel_settings(parent_id);

-- ------------------------------------------------------------
-- 4. 增强卷表（添加新字段）
-- ------------------------------------------------------------
ALTER TABLE volumes ADD COLUMN outline           TEXT;         -- 卷大纲 (Markdown)
ALTER TABLE volumes ADD COLUMN blueprint         TEXT;         -- 卷蓝图 (JSON)
ALTER TABLE volumes ADD COLUMN target_word_count INTEGER;     -- 目标字数
ALTER TABLE volumes ADD COLUMN notes             TEXT;         -- 作者笔记
ALTER TABLE volumes ADD COLUMN chapter_count     INTEGER NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- 5. 伏笔追踪表（新增）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS foreshadowing (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8))),
  novel_id            TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_id          TEXT,
  title               TEXT NOT NULL,
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'open',        -- open | resolved | abandoned
  resolved_chapter_id TEXT,
  importance          TEXT NOT NULL DEFAULT 'normal',      -- high | normal | low
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at          INTEGER
);

CREATE INDEX idx_foreshadowing_novel ON foreshadowing(novel_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_foreshadowing_chapter ON foreshadowing(chapter_id);
CREATE INDEX idx_foreshadowing_importance ON foreshadowing(importance) WHERE status = 'open';

-- ------------------------------------------------------------
-- 6. 角色表增强（添加境界字段）
-- ------------------------------------------------------------
ALTER TABLE characters ADD COLUMN power_level TEXT;   -- JSON: 境界信息

-- ------------------------------------------------------------
-- 7. 总索引表（新增，串联所有实体形成树形结构）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entity_index (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8))),
  entity_type   TEXT NOT NULL,     -- novel | volume | chapter | character | setting | rule | foreshadowing
  entity_id     TEXT NOT NULL,     -- 对应实体的实际 ID
  novel_id      TEXT NOT NULL,     -- 所属小说
  parent_id     TEXT,              -- 父节点 ID
  title         TEXT NOT NULL,     -- 显示标题
  sort_order    INTEGER NOT NULL DEFAULT 0,
  depth         INTEGER NOT NULL DEFAULT 0,   -- 层级深度
  meta          TEXT,              -- JSON: 元数据
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX idx_entity_lookup ON entity_index(entity_type, entity_id);
CREATE INDEX idx_entity_novel ON entity_index(novel_id);
CREATE INDEX idx_entity_parent ON entity_index(parent_id);
CREATE INDEX idx_entity_depth ON entity_index(novel_id, depth);

-- ============================================================
-- 迁移完成
-- ============================================================
