-- ============================================================
-- NovelForge · D1 Migration 0003
-- 功能：P0 严重问题修复 - 数据库结构增量变更
-- 版本：v2.1 → v2.2
-- 日期：2026-04-21
-- 对应修复：BUG-002(索引补全)、BUG-003/005/020(软删除)
-- ============================================================

-- ------------------------------------------------------------
-- 变更概要：
-- 1. workshop_sessions 表添加 soft-delete 支持
-- 2. entity_index 表添加 soft-delete 支持
-- 3. volumes 索引升级为部分索引（过滤已删除记录）
-- 4. vector_index 移除 UNIQUE 约束（与 Drizzle ORM 兼容）
-- ------------------------------------------------------------

-- ============================================================
-- 1. workshop_sessions 表：添加 deleted_at 字段
-- BUG-003: 工坊会话表缺少软删除支持
-- ============================================================
ALTER TABLE workshop_sessions ADD COLUMN deleted_at INTEGER;

-- 升级索引为部分索引（仅包含未删除记录）
DROP INDEX IF EXISTS idx_workshop_status;
CREATE INDEX idx_workshop_status ON workshop_sessions(status) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS idx_workshop_novel;
CREATE INDEX idx_workshop_novel ON workshop_sessions(novel_id) WHERE deleted_at IS NULL;

-- stage 索引保持不变（用于活跃会话查询）
DROP INDEX IF EXISTS idx_workshop_stage;
CREATE INDEX idx_workshop_stage ON workshop_sessions(stage);

-- ============================================================
-- 2. entity_index 表：添加 deleted_at 字段
-- BUG-020: 实体索引表缺少软删除支持
-- ============================================================
ALTER TABLE entity_index ADD COLUMN deleted_at INTEGER;

-- 升级索引为部分索引
DROP INDEX IF EXISTS idx_entity_lookup;
CREATE INDEX idx_entity_lookup ON entity_index(entity_type, entity_id);

DROP INDEX IF EXISTS idx_entity_novel;
CREATE INDEX idx_entity_novel ON entity_index(novel_id) WHERE deleted_at IS NULL;

-- parent 和 depth 索引保持不变
-- （parent_id 可能引用已删除节点的 ID）

-- ============================================================
-- 3. volumes 表：升级索引为部分索引
-- BUG-005 + BUG-014: 卷列表查询需过滤软删除记录
-- ============================================================
DROP INDEX IF EXISTS idx_volumes_novel;
CREATE INDEX idx_volumes_novel ON volumes(novel_id) WHERE deleted_at IS NULL;

-- ============================================================
-- 4. vector_index 表：移除 UNIQUE 约束
-- 说明：Drizzle ORM 的 index builder 不支持 .unique()
--       改为应用层保证唯一性或使用普通索引
-- ============================================================
DROP INDEX IF EXISTS idx_vector_source;
CREATE INDEX idx_vector_source ON vector_index(source_type, source_id, chunk_index);

-- idx_vector_novel 保持不变

-- ============================================================
-- 验证脚本（可选执行，不影响数据）
-- ============================================================

-- 检查所有表的字段完整性
SELECT 'workshop_sessions' AS table_name,
       COUNT(*) AS column_count,
       CASE WHEN COUNT(CASE WHEN name = 'deleted_at' THEN 1 END) > 0 THEN '✓' ELSE '✗' END AS has_deleted_at
FROM pragma_table_info('workshop_sessions')
UNION ALL
SELECT 'entity_index', COUNT(*),
       CASE WHEN COUNT(CASE WHEN name = 'deleted_at' THEN 1 END) > 0 THEN '✓' ELSE '✗' END
FROM pragma_table_info('entity_index');

-- 检查关键索引是否为部分索引
SELECT name,
       sql
FROM sqlite_master
WHERE type = 'index'
  AND tbl_name IN ('volumes', 'workshop_sessions', 'entity_index')
  AND sql LIKE '%WHERE deleted_at IS NULL%';

-- ============================================================
-- 迁移完成
-- 版本: v2.2
-- 影响范围:
--   - workshop_sessions: +1列 (deleted_at), 2个索引升级
--   - entity_index: +1列 (deleted_at), 1个索引升级
--   - volumes: 1个索引升级
--   - vector_index: 1个索引降级 (UNIQUE → 普通)
-- 向后兼容: ✓ 是（仅添加字段和优化索引）
-- 数据影响: 无数据丢失
-- ============================================================
