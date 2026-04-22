-- ============================================================
-- NovelForge · D1 Migration 0004
-- 功能：用户认证系统 - 用户表、邀请码表、系统设置表
-- 版本：v2.2 → v3.0
-- 日期：2026-04-22
-- ============================================================

-- ------------------------------------------------------------
-- 变更概要：
-- 1. 新增 users 表（用户认证）
-- 2. 新增 invite_codes 表（邀请码管理）
-- 3. 新增 system_settings 表（系统配置）
-- 4. 初始化默认系统设置（注册开关）
-- ------------------------------------------------------------

-- ============================================================
-- 1. 用户表
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  invite_code_id INTEGER,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status) WHERE deleted_at IS NULL;

-- ============================================================
-- 2. 邀请码表
-- ============================================================
CREATE TABLE IF NOT EXISTS invite_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_codes_status ON invite_codes(status);

-- ============================================================
-- 3. 系统设置表
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============================================================
-- 4. 初始化默认系统设置
-- ============================================================

-- 注册开关（默认开启）
INSERT OR IGNORE INTO system_settings (key, value, description, updated_at)
VALUES ('registration_enabled', 'true', '用户注册开关', unixepoch());

-- 默认管理员账号（首次部署时创建）
-- 注意：密码需要通过API或脚本设置，此处仅作占位
INSERT OR IGNORE INTO system_settings (key, value, description, updated_at)
VALUES ('admin_initialized', 'false', '是否已初始化管理员账号', unixepoch());

-- JWT Secret（生产环境应使用环境变量）
INSERT OR IGNORE INTO system_settings (key, value, description, updated_at)
VALUES ('jwt_secret_placeholder', 'CHANGE_ME_IN_PRODUCTION', 'JWT密钥占位符（请使用环境变量 JWT_SECRET）', unixepoch());

-- ============================================================
-- 验证脚本
-- ============================================================

-- 检查表是否存在
SELECT 'users' AS table_name,
       (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='users') AS exists_flag
UNION ALL
SELECT 'invite_codes', (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='invite_codes')
UNION ALL
SELECT 'system_settings', (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='system_settings');

-- 检查索引
SELECT name, tbl_name
FROM sqlite_master
WHERE type = 'index'
  AND name IN ('idx_users_username', 'idx_users_email', 'idx_users_status',
               'idx_invite_codes_code', 'idx_invite_codes_status');

-- 检查初始数据
SELECT key, value FROM system_settings WHERE key = 'registration_enabled';

-- ============================================================
-- 迁移完成
-- 版本: v3.0
-- 影响范围:
--   - 新增 users 表（10字段 + 3索引）
--   - 新增 invite_codes 表（9字段 + 2索引）
--   - 新增 system_settings 表（4字段）
--   - 初始化 3 条系统设置记录
-- 向后兼容: ✓ 是（新增表，不影响现有数据）
-- 数据影响: 无数据丢失
-- ============================================================
