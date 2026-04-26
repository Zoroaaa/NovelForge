-- 0017_novel_system_prompt.sql
-- 为小说表添加System Prompt字段（用于存储小说专属约束，以system message权重注入生成流程）
ALTER TABLE novels ADD COLUMN system_prompt TEXT;
