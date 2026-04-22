/**
 * @file setup.ts
 * @description 系统初始化API - 首次部署时创建管理员账号
 * @version 1.0.0
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { Env } from '../lib/types'
import { hashPassword, generateToken, getJwtSecret } from '../lib/auth'

const app = new Hono<{ Bindings: Env }>()

const setupSchema = z.object({
  username: z.string()
    .min(3, '用户名至少3个字符')
    .max(20, '用户名最多20个字符')
    .regex(/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字和下划线'),
  email: z.string().email('请输入有效的邮箱地址'),
  password: z.string()
    .min(8, '密码至少8个字符')
    .max(64, '密码最多64个字符')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, '密码必须包含大小写字母和数字'),
})

app.get('/status', async (c) => {
  try {
    const result = await c.env.DB.prepare(
      "SELECT value FROM system_settings WHERE key = 'admin_initialized'"
    ).first<{ value: string }>()
    
    const initialized = result?.value === 'true'
    
    let adminExists = false
    if (initialized) {
      const adminCount = await c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND deleted_at IS NULL"
      ).first<{ count: number }>()
      adminExists = (adminCount?.count || 0) > 0
    }
    
    return c.json({
      success: true,
      data: {
        initialized,
        adminExists,
      }
    })
  } catch (error) {
    console.error('Check setup status error:', error)
    return c.json({
      error: 'Internal Server Error',
      code: 'CHECK_STATUS_FAILED',
    }, 500)
  }
})

app.post('/', zValidator('json', setupSchema), async (c) => {
  try {
    const { username, email, password } = c.req.valid('json')
    
    // 检查是否已初始化
    const initStatus = await c.env.DB.prepare(
      "SELECT value FROM system_settings WHERE key = 'admin_initialized'"
    ).first<{ value: string }>()
    
    if (initStatus?.value === 'true') {
      // 检查是否已有管理员
      const adminCount = await c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND deleted_at IS NULL"
      ).first<{ count: number }>()
      
      if ((adminCount?.count || 0) > 0) {
        return c.json({
          error: 'Forbidden',
          code: 'ALREADY_INITIALIZED',
          message: '系统已初始化，无法重复设置管理员'
        }, 403)
      }
    }
    
    // 检查用户名/邮箱是否已被使用
    const existingUser = await c.env.DB.prepare(
      "SELECT id FROM users WHERE (username = ? OR email = ?) AND deleted_at IS NULL"
    ).bind(username, email).first()
    
    if (existingUser) {
      return c.json({
        error: 'Conflict',
        code: 'USER_EXISTS',
        message: '用户名或邮箱已被使用'
      }, 409)
    }
    
    // 创建管理员账号
    const userId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    
    const passwordHash = await hashPassword(password)
    
    await c.env.DB.prepare(
      `INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at) 
       VALUES (?, ?, ?, ?, 'admin', 'active', unixepoch(), unixepoch())`
    ).bind(userId, username, email, passwordHash).run()
    
    // 标记系统已初始化
    await c.env.DB.prepare(
      "UPDATE system_settings SET value = 'true', updated_at = unixepoch() WHERE key = 'admin_initialized'"
    ).run()
    
    // 生成JWT Token
    const secret = await getJwtSecret(c.env)
    const token = await generateToken({
      userId,
      username,
      role: 'admin'
    }, secret)
    
    // 更新最后登录时间
    await c.env.DB.prepare(
      'UPDATE users SET last_login_at = unixepoch() WHERE id = ?'
    ).bind(userId).run()
    
    return c.json({
      success: true,
      data: {
        token,
        user: {
          id: userId,
          username,
          email,
          role: 'admin'
        }
      },
      message: '管理员账号创建成功！欢迎来到 NovelForge'
    })
  } catch (error) {
    console.error('Setup error:', error)
    return c.json({
      error: 'Internal Server Error',
      code: 'SETUP_FAILED',
      message: '初始化失败，请重试'
    }, 500)
  }
})

export default app
