-- ============================================================
-- NovelForge · D1 Migration 0006
-- 功能：卷表重构 - 大纲字段改名为事件线
-- 版本：v3.0 → v3.1
-- 日期：2026-04-22
-- ============================================================

-- ------------------------------------------------------------
-- 变更概要：
-- 1. volumes.outline → volumes.event_line（事件线）
-- 2. 语义调整：卷的"大纲"改名为"事件线"，作为卷的情节发展记录
-- ------------------------------------------------------------

-- ============================================================
-- 1. 重命名字段：outline → event_line
-- ============================================================
ALTER TABLE volumes RENAME COLUMN outline TO event_line;

-- ============================================================
-- 2. 验证
-- ============================================================

-- 检查 volumes 表结构
PRAGMA table_info(volumes);

-- 验证 event_line 字段存在
SELECT 'volumes' AS table_name,
       'event_line' AS column_name,
       (SELECT COUNT(*) FROM pragma_table_info('volumes') WHERE name = 'event_line') AS exists_flag;

-- 验证 outline 字段已不存在
SELECT 'volumes' AS table_name,
       'outline' AS column_name,
       (SELECT COUNT(*) FROM pragma_table_info('volumes') WHERE name = 'outline') AS should_be_zero;

-- ============================================================
-- 迁移完成
-- 版本: v3.1
-- 影响范围:
--   - volumes 表：outline → event_line
-- 向后兼容: ✗ 否（字段名变更，需要代码适配）
-- 数据影响: 无数据丢失（字段值完整迁移）
-- ============================================================
