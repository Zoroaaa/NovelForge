-- ============================================================
-- NovelForge · D1 Schema
-- 设计原则：扁平化索引 + 向量 ID 可追溯 + 软删除 + 模型配置可扩展
-- 版本：v2.0（合并版）
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- 1. 小说主表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS novels (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title         TEXT NOT NULL,
  description   TEXT,
  genre         TEXT,                          -- 玄幻/仙侠/都市/科幻...
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | writing | completed | archived
  cover_r2_key  TEXT,                          -- R2 封面图 key
  word_count    INTEGER NOT NULL DEFAULT 0,    -- 实时累计，章节写入时更新
  chapter_count INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at    INTEGER                        -- 软删除
);

CREATE INDEX idx_novels_status ON novels(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_novels_updated ON novels(updated_at DESC) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- 2. 角色表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS characters (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id      TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  aliases       TEXT,           -- JSON 数组，别名/称号
  role          TEXT,           -- protagonist | antagonist | supporting | minor
  description   TEXT,           -- AI 自动生成或手动填写的文字描述
  image_r2_key  TEXT,           -- 参考图片（多模态用）
  attributes    TEXT,           -- JSON: { realm, power, faction, ... }  可自定义字段
  power_level   TEXT,           -- JSON: 境界信息 (v2.0 新增)
  vector_id     TEXT,
  indexed_at    INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at    INTEGER
);

CREATE INDEX idx_characters_novel ON characters(novel_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_characters_role ON characters(novel_id, role) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- 3. 卷表 (v2.0)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS volumes (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id            TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  outline             TEXT,               -- 卷大纲 (Markdown)
  blueprint           TEXT,               -- 卷蓝图 (JSON)
  summary             TEXT,               -- 卷完结后 AI 生成的整卷摘要
  word_count          INTEGER NOT NULL DEFAULT 0,
  chapter_count       INTEGER NOT NULL DEFAULT 0,
  target_word_count   INTEGER,            -- 目标字数
  status              TEXT NOT NULL DEFAULT 'draft',
  notes               TEXT,               -- 作者笔记
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at          INTEGER
);

CREATE INDEX idx_volumes_novel ON volumes(novel_id);

-- ------------------------------------------------------------
-- 4. 章节表 (v2.0)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chapters (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id            TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  volume_id           TEXT REFERENCES volumes(id),
  title               TEXT NOT NULL,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  content             TEXT,               -- 章节正文 Markdown
  snapshot_keys       TEXT,               -- 章节快照
  word_count          INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'draft', -- draft | generated | revised | published
  model_used          TEXT,               -- 实际用于生成本章的模型 ID
  prompt_tokens       INTEGER,
  completion_tokens   INTEGER,
  generation_time     INTEGER,            -- ms
  summary             TEXT,               -- 本章摘要（~200字）
  summary_model       TEXT,
  summary_at          INTEGER,
  vector_id           TEXT,
  indexed_at          INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at          INTEGER
);

CREATE INDEX idx_chapters_novel ON chapters(novel_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX idx_chapters_volume ON chapters(volume_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX idx_chapters_status ON chapters(novel_id, status) WHERE deleted_at IS NULL;

-- FTS5 全文检索（章节内容）
CREATE VIRTUAL TABLE IF NOT EXISTS chapters_fts USING fts5(
  title, content, summary,
  content='chapters',
  content_rowid='rowid'
);

-- ------------------------------------------------------------
-- 5. 总纲表 (v2.0 新增，替代原 outlines 多层结构)
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
-- 6. 创作规则表 (v2.0 新增)
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
-- 7. 小说设定表 (v2.0 新增，统一管理世界观/境界/势力/地理/宝物功法)
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
-- 8. 伏笔追踪表 (v2.0 新增)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS foreshadowing (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
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
-- 9. 模型配置表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_configs (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id    TEXT REFERENCES novels(id) ON DELETE CASCADE, -- NULL = 全局默认
  scope       TEXT NOT NULL,  -- global | novel
  stage       TEXT NOT NULL,  -- outline_gen | chapter_gen | summary_gen | embedding | vision
  provider    TEXT NOT NULL,  -- volcengine | anthropic | openai | custom
  model_id    TEXT NOT NULL,  -- doubao-seed-2-pro / claude-sonnet-4-20250514 / ...
  api_base    TEXT,           -- 自定义 OpenAI 兼容接口 base URL
  api_key     TEXT,           -- 明文 API Key（本地开发用）
  params      TEXT,           -- JSON: { temperature, max_tokens, top_p, ... }
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_model_configs_lookup ON model_configs(scope, stage, novel_id);

-- ------------------------------------------------------------
-- 10. 生成任务日志（可追溯每次生成的上下文快照）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generation_logs (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id        TEXT NOT NULL REFERENCES novels(id),
  chapter_id      TEXT REFERENCES chapters(id),
  stage           TEXT NOT NULL,           -- chapter_gen | summary_gen | outline_gen
  model_id        TEXT NOT NULL,
  context_snapshot TEXT,                   -- JSON: 本次实际注入的上下文
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  duration_ms     INTEGER,
  status          TEXT NOT NULL DEFAULT 'success', -- success | error | cancelled
  error_msg       TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_gen_logs_chapter ON generation_logs(chapter_id);
CREATE INDEX idx_gen_logs_novel ON generation_logs(novel_id, created_at DESC);

-- ------------------------------------------------------------
-- 11. 导出记录
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exports (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id    TEXT NOT NULL REFERENCES novels(id),
  format      TEXT NOT NULL,         -- epub | pdf | md | txt | zip
  scope       TEXT NOT NULL,         -- full | volume | chapter_range
  scope_meta  TEXT,                  -- JSON: { volume_id } 或 { from_chapter, to_chapter }
  r2_key      TEXT,                  -- R2 中的文件 key
  file_size   INTEGER,               -- bytes
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | processing | done | error
  error_msg   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at  INTEGER                -- 签名 URL 过期时间
);

CREATE INDEX idx_exports_novel ON exports(novel_id, created_at DESC);

-- ------------------------------------------------------------
-- 12. 向量索引追踪（统一管理所有向量化记录）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vector_index (
  id          TEXT PRIMARY KEY,       -- 与 Vectorize 中的 ID 对应
  novel_id    TEXT NOT NULL,
  source_type TEXT NOT NULL,          -- outline | chapter | character | summary
  source_id   TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0, -- 同一文档可能切多块
  content_hash TEXT,                  -- 内容 hash，用于判断是否需要重新索引
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX idx_vector_source ON vector_index(source_type, source_id, chunk_index);
CREATE INDEX idx_vector_novel ON vector_index(novel_id);

-- ------------------------------------------------------------
-- 13. 总索引表 (v2.0 新增，串联所有实体形成树形结构)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entity_index (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
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
