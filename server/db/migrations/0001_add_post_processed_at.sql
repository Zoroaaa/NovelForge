-- 给 chapters 表加 post_processed_at 字段，用于 post_process_chapter 幂等锁
-- 防止 Cloudflare Queue visibility timeout 导致同一章节后处理被重复执行
ALTER TABLE chapters ADD COLUMN post_processed_at INTEGER;
