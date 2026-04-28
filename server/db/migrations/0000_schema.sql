-- ============================================================
-- NovelForge · D1 Schema (合并版)
-- 版本：v4.x
-- 说明：合并所有迁移文件 (0010~0020)，直接部署即可
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- 1. 小说主表
-- ============================================================
CREATE TABLE IF NOT EXISTS novels (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title               TEXT NOT NULL,
  description         TEXT,
  genre               TEXT,
  status              TEXT NOT NULL DEFAULT 'draft',
  cover_r2_key        TEXT,
  word_count          INTEGER NOT NULL DEFAULT 0,
  chapter_count       INTEGER NOT NULL DEFAULT 0,
  target_word_count   INTEGER,
  target_chapter_count INTEGER,
  system_prompt       TEXT,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at          INTEGER
);

CREATE INDEX idx_novels_status ON novels(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_novels_updated ON novels(updated_at DESC) WHERE deleted_at IS NULL;

-- ============================================================
-- 2. 角色表
-- ============================================================
CREATE TABLE IF NOT EXISTS characters (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id        TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  aliases         TEXT,
  role            TEXT,
  description     TEXT,
  image_r2_key    TEXT,
  attributes      TEXT,
  power_level     TEXT,
  vector_id       TEXT,
  indexed_at      INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at      INTEGER
);

CREATE INDEX idx_characters_novel ON characters(novel_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_characters_role ON characters(novel_id, role) WHERE deleted_at IS NULL;

-- ============================================================
-- 3. 卷表
-- ============================================================
CREATE TABLE IF NOT EXISTS volumes (
  id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id                TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  event_line              TEXT,
  blueprint               TEXT,
  summary                 TEXT,
  word_count              INTEGER NOT NULL DEFAULT 0,
  chapter_count           INTEGER NOT NULL DEFAULT 0,
  target_word_count       INTEGER,
  target_chapter_count    INTEGER,
  foreshadowing_setup     TEXT,
  foreshadowing_resolve   TEXT,
  status                  TEXT NOT NULL DEFAULT 'draft',
  notes                   TEXT,
  created_at              INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at              INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at              INTEGER
);

CREATE INDEX idx_volumes_novel ON volumes(novel_id) WHERE deleted_at IS NULL;

-- ============================================================
-- 4. 章节表
-- ============================================================
CREATE TABLE IF NOT EXISTS chapters (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id            TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  volume_id           TEXT REFERENCES volumes(id),
  title               TEXT NOT NULL,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  content             TEXT,
  snapshot_keys       TEXT,
  word_count          INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'draft',
  model_used          TEXT,
  prompt_tokens       INTEGER,
  completion_tokens   INTEGER,
  generation_time     INTEGER,
  summary             TEXT,
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

CREATE VIRTUAL TABLE IF NOT EXISTS chapters_fts USING fts5(
  title, content, summary,
  content='chapters',
  content_rowid='rowid'
);

-- ============================================================
-- 5. 总纲表
-- ============================================================
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

-- ============================================================
-- 6. 创作规则表
-- ============================================================
CREATE TABLE IF NOT EXISTS writing_rules (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id        TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  priority        INTEGER NOT NULL DEFAULT 3,
  is_active       INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at      INTEGER
);

CREATE INDEX idx_writing_rules_novel ON writing_rules(novel_id, category) WHERE deleted_at IS NULL;
CREATE INDEX idx_writing_rules_priority ON writing_rules(priority) WHERE is_active = 1;

-- ============================================================
-- 7. 小说设定表
-- ============================================================
CREATE TABLE IF NOT EXISTS novel_settings (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id        TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  category        TEXT,
  name            TEXT NOT NULL,
  content         TEXT NOT NULL,
  summary         TEXT,
  attributes      TEXT,
  parent_id       TEXT,
  importance      TEXT NOT NULL DEFAULT 'normal',
  related_ids     TEXT,
  vector_id       TEXT,
  indexed_at      INTEGER,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at      INTEGER
);

CREATE INDEX idx_novel_settings_novel ON novel_settings(novel_id, type) WHERE deleted_at IS NULL;
CREATE INDEX idx_novel_settings_type ON novel_settings(type, category);
CREATE INDEX idx_novel_settings_parent ON novel_settings(parent_id);
CREATE INDEX idx_novel_settings_importance ON novel_settings(novel_id, importance) WHERE deleted_at IS NULL;

-- ============================================================
-- 8. 伏笔追踪表
-- ============================================================
CREATE TABLE IF NOT EXISTS foreshadowing (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id              TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  volume_id             TEXT,
  chapter_id            TEXT,
  title                 TEXT NOT NULL,
  description           TEXT,
  status                TEXT NOT NULL DEFAULT 'open',
  resolved_chapter_id   TEXT,
  importance            TEXT NOT NULL DEFAULT 'normal',
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at            INTEGER
);

CREATE INDEX idx_foreshadowing_novel ON foreshadowing(novel_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_foreshadowing_chapter ON foreshadowing(chapter_id);
CREATE INDEX idx_foreshadowing_importance ON foreshadowing(importance) WHERE status = 'open';
CREATE INDEX idx_foreshadowing_volume ON foreshadowing(volume_id) WHERE volume_id IS NOT NULL;

-- ============================================================
-- 9. 伏笔推进记录表
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
-- 10. 章节检查日志表
-- ============================================================
CREATE TABLE IF NOT EXISTS check_logs (
  id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id                TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_id              TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  check_type              TEXT NOT NULL CHECK(check_type IN ('character_consistency', 'chapter_coherence', 'combined', 'volume_progress')),
  score                   INTEGER NOT NULL DEFAULT 100,
  status                  TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('success', 'failed', 'error')),
  character_result        TEXT,
  coherence_result        TEXT,
  volume_progress_result  TEXT,
  issues_count            INTEGER NOT NULL DEFAULT 0,
  error_message           TEXT,
  created_at              INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_check_logs_chapter ON check_logs(chapter_id, created_at DESC);
CREATE INDEX idx_check_logs_novel ON check_logs(novel_id, created_at DESC);
CREATE INDEX idx_check_logs_type ON check_logs(chapter_id, check_type, created_at DESC);

-- ============================================================
-- 11. 质量评分表
-- ============================================================
CREATE TABLE IF NOT EXISTS quality_scores (
  id                  TEXT PRIMARY KEY,
  novel_id            TEXT NOT NULL,
  chapter_id          TEXT NOT NULL,
  total_score         INTEGER,
  plot_score          INTEGER,
  consistency_score   INTEGER,
  foreshadowing_score INTEGER,
  pacing_score        INTEGER,
  fluency_score       INTEGER,
  details             TEXT,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_quality_chapter ON quality_scores(chapter_id);
CREATE INDEX idx_quality_novel ON quality_scores(novel_id, created_at DESC);

-- ============================================================
-- 12. 模型配置表
-- ============================================================
CREATE TABLE IF NOT EXISTS model_configs (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id    TEXT REFERENCES novels(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL,
  stage       TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model_id    TEXT NOT NULL,
  api_base    TEXT,
  api_key     TEXT,
  params      TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_model_configs_lookup ON model_configs(scope, stage, novel_id);

-- ============================================================
-- 13. 生成任务日志
-- ============================================================
CREATE TABLE IF NOT EXISTS generation_logs (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id            TEXT NOT NULL REFERENCES novels(id),
  chapter_id          TEXT REFERENCES chapters(id),
  stage               TEXT NOT NULL,
  model_id            TEXT NOT NULL,
  context_snapshot    TEXT,
  prompt_tokens       INTEGER,
  completion_tokens   INTEGER,
  duration_ms         INTEGER,
  status              TEXT NOT NULL DEFAULT 'success',
  error_msg           TEXT,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_gen_logs_chapter ON generation_logs(chapter_id);
CREATE INDEX idx_gen_logs_novel ON generation_logs(novel_id, created_at DESC);

-- ============================================================
-- 14. 批量生成任务表
-- ============================================================
CREATE TABLE IF NOT EXISTS batch_generation_tasks (
  id                    TEXT PRIMARY KEY,
  novel_id              TEXT NOT NULL,
  volume_id             TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'running',
  start_chapter_order   INTEGER NOT NULL,
  target_count          INTEGER NOT NULL,
  completed_count       INTEGER NOT NULL DEFAULT 0,
  failed_count          INTEGER NOT NULL DEFAULT 0,
  current_chapter_order INTEGER,
  error_msg             TEXT,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_batch_novel ON batch_generation_tasks(novel_id);
CREATE INDEX idx_batch_status ON batch_generation_tasks(status);

-- ============================================================
-- 15. 导出记录
-- ============================================================
CREATE TABLE IF NOT EXISTS exports (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  novel_id    TEXT NOT NULL REFERENCES novels(id),
  format      TEXT NOT NULL,
  scope       TEXT NOT NULL,
  scope_meta  TEXT,
  r2_key      TEXT,
  file_size   INTEGER,
  status      TEXT NOT NULL DEFAULT 'pending',
  error_msg   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at  INTEGER
);

CREATE INDEX idx_exports_novel ON exports(novel_id, created_at DESC);

-- ============================================================
-- 16. 向量索引追踪
-- ============================================================
CREATE TABLE IF NOT EXISTS vector_index (
  id            TEXT PRIMARY KEY,
  novel_id      TEXT NOT NULL,
  source_type   TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  chunk_index   INTEGER NOT NULL DEFAULT 0,
  content_hash  TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_vector_source ON vector_index(source_type, source_id, chunk_index);
CREATE INDEX idx_vector_novel ON vector_index(novel_id);

-- ============================================================
-- 17. 总索引表
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_index (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  novel_id      TEXT NOT NULL,
  parent_id     TEXT,
  title         TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  depth         INTEGER NOT NULL DEFAULT 0,
  meta          TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at    INTEGER
);

CREATE INDEX idx_entity_lookup ON entity_index(entity_type, entity_id);
CREATE INDEX idx_entity_novel ON entity_index(novel_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_entity_parent ON entity_index(parent_id);
CREATE INDEX idx_entity_depth ON entity_index(novel_id, depth);

-- ============================================================
-- 18. 创作工坊会话表
-- ============================================================
CREATE TABLE IF NOT EXISTS workshop_sessions (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title           TEXT,
  novel_id        TEXT REFERENCES novels(id) ON DELETE SET NULL,
  stage           TEXT NOT NULL DEFAULT 'concept',
  messages        TEXT NOT NULL DEFAULT '[]',
  extracted_data  TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at      INTEGER
);

CREATE INDEX idx_workshop_status ON workshop_sessions(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_workshop_novel ON workshop_sessions(novel_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_workshop_stage ON workshop_sessions(stage);

-- ============================================================
-- 19. 用户表
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user',
  status          TEXT NOT NULL DEFAULT 'active',
  invite_code_id  TEXT,
  last_login_at   INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at      INTEGER
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status) WHERE deleted_at IS NULL;

-- ============================================================
-- 20. 邀请码表
-- ============================================================
CREATE TABLE IF NOT EXISTS invite_codes (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  created_by  TEXT NOT NULL,
  max_uses    INTEGER NOT NULL DEFAULT 1,
  used_count  INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_invite_codes_code ON invite_codes(code);
CREATE INDEX idx_invite_codes_status ON invite_codes(status);

-- ============================================================
-- 21. 系统设置表
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============================================================
-- 22. 队列任务日志表
-- ============================================================
CREATE TABLE IF NOT EXISTS queue_task_logs (
  id          TEXT PRIMARY KEY,
  novel_id    TEXT,
  task_type   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  payload     TEXT,
  error_msg   TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER
);

CREATE INDEX idx_queue_logs_novel ON queue_task_logs(novel_id, created_at DESC);
CREATE INDEX idx_queue_logs_status ON queue_task_logs(status, created_at DESC);

-- ============================================================
-- 触发器：自动维护字数和章数统计
-- ============================================================

CREATE TRIGGER IF NOT EXISTS trg_chapter_insert
AFTER INSERT ON chapters
WHEN NEW.deleted_at IS NULL
BEGIN
  UPDATE novels
  SET chapter_count = chapter_count + 1,
      word_count = word_count + NEW.word_count,
      updated_at = unixepoch()
  WHERE id = NEW.novel_id;

  UPDATE volumes
  SET chapter_count = chapter_count + 1,
      word_count = word_count + NEW.word_count,
      updated_at = unixepoch()
  WHERE id = NEW.volume_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_chapter_delete
AFTER DELETE ON chapters
WHEN OLD.deleted_at IS NULL
BEGIN
  UPDATE novels
  SET chapter_count = chapter_count - 1,
      word_count = word_count - OLD.word_count,
      updated_at = unixepoch()
  WHERE id = OLD.novel_id;

  UPDATE volumes
  SET chapter_count = chapter_count - 1,
      word_count = word_count - OLD.word_count,
      updated_at = unixepoch()
  WHERE id = OLD.volume_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_chapter_word_count_update
AFTER UPDATE OF word_count ON chapters
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL
BEGIN
  UPDATE novels
  SET word_count = word_count + (NEW.word_count - OLD.word_count),
      updated_at = unixepoch()
  WHERE id = NEW.novel_id;

  UPDATE volumes
  SET word_count = word_count + (NEW.word_count - OLD.word_count),
      updated_at = unixepoch()
  WHERE id = NEW.volume_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_chapter_soft_delete
AFTER UPDATE OF deleted_at ON chapters
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  UPDATE novels
  SET chapter_count = chapter_count - 1,
      word_count = word_count - OLD.word_count,
      updated_at = unixepoch()
  WHERE id = NEW.novel_id;

  UPDATE volumes
  SET chapter_count = chapter_count - 1,
      word_count = word_count - OLD.word_count,
      updated_at = unixepoch()
  WHERE id = NEW.volume_id;
END;

-- ============================================================
-- 初始化默认系统设置
-- ============================================================
INSERT OR IGNORE INTO system_settings (key, value, description, updated_at)
VALUES ('registration_enabled', 'true', '用户注册开关', unixepoch());

INSERT OR IGNORE INTO system_settings (key, value, description, updated_at)
VALUES ('admin_initialized', 'false', '是否已初始化管理员账号', unixepoch());

INSERT OR IGNORE INTO system_settings (key, value, description, updated_at)
VALUES ('jwt_secret_placeholder', 'CHANGE_ME_IN_PRODUCTION', 'JWT密钥占位符（请使用环境变量 JWT_SECRET）', unixepoch());

-- ============================================================
-- 数据校正：基于现有章节数据重新统计字数和章数
-- ============================================================
UPDATE novels
SET chapter_count = (
    SELECT COUNT(*) FROM chapters
    WHERE chapters.novel_id = novels.id AND chapters.deleted_at IS NULL
),
word_count = (
    SELECT COALESCE(SUM(word_count), 0) FROM chapters
    WHERE chapters.novel_id = novels.id AND chapters.deleted_at IS NULL
),
updated_at = unixepoch();

UPDATE volumes
SET chapter_count = (
    SELECT COUNT(*) FROM chapters
    WHERE chapters.volume_id = volumes.id AND chapters.deleted_at IS NULL
),
word_count = (
    SELECT COALESCE(SUM(word_count), 0) FROM chapters
    WHERE chapters.volume_id = volumes.id AND chapters.deleted_at IS NULL
),
updated_at = unixepoch();

-- ============================================================
-- Schema 完成
-- ============================================================

-- ============================================================
-- 23. 情节图谱节点表（Phase 4）
-- ============================================================
CREATE TABLE IF NOT EXISTS plot_nodes (
  id            TEXT PRIMARY KEY,
  novel_id      TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('event', 'character', 'location', 'item', 'foreshadowing')),
  title         TEXT NOT NULL,
  description   TEXT,
  chapter_id    TEXT,
  meta          TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_plot_nodes_novel ON plot_nodes(novel_id);
CREATE INDEX idx_plot_nodes_type ON plot_nodes(novel_id, type);
CREATE INDEX idx_plot_nodes_chapter ON plot_nodes(chapter_id);

-- ============================================================
-- 24. 情节图谱边表（Phase 4）
-- ============================================================
CREATE TABLE IF NOT EXISTS plot_edges (
  id            TEXT PRIMARY KEY,
  novel_id      TEXT NOT NULL,
  from_id       TEXT NOT NULL,
  to_id         TEXT NOT NULL,
  relation      TEXT NOT NULL CHECK(relation IN ('caused_by', 'participated_in', 'occurred_at', 'owned_by', 'related_to', 'leads_to')),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_plot_edges_novel ON plot_edges(novel_id);
CREATE INDEX idx_plot_edges_from ON plot_edges(from_id);
CREATE INDEX idx_plot_edges_to ON plot_edges(to_id);
