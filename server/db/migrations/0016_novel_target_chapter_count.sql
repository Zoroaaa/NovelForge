-- 0016_novel_target_chapter_count.sql
-- 为小说表添加预计总章数字段
ALTER TABLE novels ADD COLUMN target_chapter_count INTEGER;