-- 跨章一致性系统 v2.1：新增6张数据表
-- Migration: 0002_cross_chapter_consistency

-- 1. 章节内提取的临时实体注册中心
CREATE TABLE IF NOT EXISTS novel_inline_entities (
  id               TEXT PRIMARY KEY,
  novel_id         TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  name             TEXT NOT NULL,
  aliases          TEXT,
  description      TEXT NOT NULL,
  summary          TEXT,
  first_chapter_id TEXT NOT NULL,
  first_chapter_order INTEGER NOT NULL,
  last_chapter_id  TEXT,
  last_chapter_order INTEGER,
  is_growable      INTEGER NOT NULL DEFAULT 0,
  promoted_to_setting_id TEXT,
  vector_id        TEXT,
  indexed_at       INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_inline_entities_novel ON novel_inline_entities(novel_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inline_entities_type ON novel_inline_entities(novel_id, entity_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inline_entities_name ON novel_inline_entities(novel_id, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inline_entities_growable ON novel_inline_entities(novel_id, is_growable) WHERE deleted_at IS NULL;

-- 2. 成长性实体的全历史状态链
CREATE TABLE IF NOT EXISTS entity_state_log (
  id               TEXT PRIMARY KEY,
  novel_id         TEXT NOT NULL,
  source_type      TEXT NOT NULL,
  source_id        TEXT NOT NULL,
  entity_name      TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  chapter_id       TEXT NOT NULL,
  chapter_order    INTEGER NOT NULL,
  state_type       TEXT NOT NULL,
  state_summary    TEXT NOT NULL,
  state_detail     TEXT,
  prev_state       TEXT,
  curr_state       TEXT NOT NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_state_log_entity ON entity_state_log(source_type, source_id, chapter_order);
CREATE INDEX IF NOT EXISTS idx_state_log_novel ON entity_state_log(novel_id, chapter_order);
CREATE INDEX IF NOT EXISTS idx_state_log_chapter ON entity_state_log(chapter_id);

-- 3. 检测到的矛盾记录
CREATE TABLE IF NOT EXISTS entity_conflict_log (
  id               TEXT PRIMARY KEY,
  novel_id         TEXT NOT NULL,
  detected_chapter_id     TEXT NOT NULL,
  detected_chapter_order  INTEGER NOT NULL,
  entity_name      TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  source_type      TEXT NOT NULL,
  source_id        TEXT NOT NULL,
  conflict_type    TEXT NOT NULL,
  description      TEXT NOT NULL,
  current_chapter_excerpt TEXT,
  historical_record       TEXT,
  historical_chapter_order INTEGER,
  severity         TEXT NOT NULL,
  resolution       TEXT,
  resolved_at      INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_conflict_log_novel ON entity_conflict_log(novel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conflict_log_chapter ON entity_conflict_log(detected_chapter_id);
CREATE INDEX IF NOT EXISTS idx_conflict_log_pending ON entity_conflict_log(novel_id, resolution) WHERE resolution IS NULL;

-- 4. 角色成长历史链（7维度）
CREATE TABLE IF NOT EXISTS character_growth_log (
  id                TEXT PRIMARY KEY,
  novel_id          TEXT NOT NULL,
  character_id      TEXT NOT NULL,
  character_name    TEXT NOT NULL,
  chapter_id        TEXT NOT NULL,
  chapter_order     INTEGER NOT NULL,
  growth_dimension  TEXT NOT NULL,
  character_id_target TEXT,
  character_name_target TEXT,
  prev_state        TEXT,
  curr_state        TEXT NOT NULL,
  detail            TEXT,
  is_secret         INTEGER DEFAULT 0,
  is_public         INTEGER DEFAULT 1,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_char_growth_character ON character_growth_log(character_id, chapter_order);
CREATE INDEX IF NOT EXISTS idx_char_growth_novel ON character_growth_log(novel_id, chapter_order);
CREATE INDEX IF NOT EXISTS idx_char_growth_dimension ON character_growth_log(novel_id, growth_dimension);
CREATE INDEX IF NOT EXISTS idx_char_growth_knowledge ON character_growth_log(character_id, growth_dimension)
  WHERE growth_dimension = 'knowledge';

-- 5. 关系网络当前快照
CREATE TABLE IF NOT EXISTS character_relationships (
  id                TEXT PRIMARY KEY,
  novel_id          TEXT NOT NULL,
  character_id_a    TEXT NOT NULL,
  character_name_a  TEXT NOT NULL,
  character_id_b    TEXT NOT NULL,
  character_name_b  TEXT NOT NULL,
  relation_type     TEXT NOT NULL,
  relation_desc     TEXT NOT NULL,
  established_chapter_order INTEGER,
  last_updated_chapter_order INTEGER NOT NULL,
  last_updated_chapter_id TEXT NOT NULL,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at        INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_relationship_pair ON character_relationships(novel_id, character_id_a, character_id_b)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relationship_novel ON character_relationships(novel_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relationship_char_a ON character_relationships(character_id_a) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relationship_char_b ON character_relationships(character_id_b) WHERE deleted_at IS NULL;

-- 6. 摘要结构化缓存
CREATE TABLE IF NOT EXISTS chapter_structured_data (
  id                TEXT PRIMARY KEY,
  novel_id          TEXT NOT NULL,
  chapter_id        TEXT NOT NULL UNIQUE,
  chapter_order     INTEGER NOT NULL,
  character_changes TEXT,
  new_entities      TEXT,
  chapter_end_state TEXT,
  key_events        TEXT,
  knowledge_reveals TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_structured_data_novel ON chapter_structured_data(novel_id, chapter_order);
CREATE INDEX IF NOT EXISTS idx_structured_data_chapter ON chapter_structured_data(chapter_id);
