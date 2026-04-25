-- 0014_volume_target_chapter_count.sql
-- 为卷表添加目标章节数字段
ALTER TABLE volumes ADD COLUMN target_chapter_count INTEGER;
