-- 0013_novel_target_word_count.sql
-- 为小说表添加目标字数字段
ALTER TABLE novels ADD COLUMN target_word_count INTEGER;
