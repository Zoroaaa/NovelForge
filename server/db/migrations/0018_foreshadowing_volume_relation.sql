-- 迁移：volumes 表增加 foreshadowingSetup/Resolve 专用字段，foreshadowing 表增加 volume_id 关联
-- 说明：伏笔数据从此独立存储于 foreshadowing 表，volumes.notes 仅保留真正的创作备注

-- 1. volumes 表增加伏笔专用字段（JSON 数组）
ALTER TABLE volumes ADD COLUMN foreshadowing_setup TEXT;
ALTER TABLE volumes ADD COLUMN foreshadowing_resolve TEXT;

-- 2. foreshadowing 表增加 volume_id 外键关联
ALTER TABLE foreshadowing ADD COLUMN volume_id TEXT;

-- 3. 建立索引（可选但推荐）
CREATE INDEX IF NOT EXISTS idx_foreshadowing_volume ON foreshadowing(volume_id) WHERE volume_id IS NOT NULL;
