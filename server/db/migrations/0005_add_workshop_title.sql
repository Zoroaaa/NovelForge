-- 0005_add_workshop_title.sql
-- 为workshop_sessions表添加title字段

ALTER TABLE workshop_sessions ADD COLUMN title text;
